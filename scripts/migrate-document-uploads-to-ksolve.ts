import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const FROM_BUCKET = process.env.FROM_DOCUMENT_BUCKET || "document-uploads";
const TO_BUCKET = process.env.TO_DOCUMENT_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || "ksolve-documents";
const DELETE_SOURCE = process.env.DELETE_SOURCE_DOCUMENTS === "true";

const supabase = createClient(supabaseUrl, serviceRoleKey);

type UploadRecord = {
  id: number;
  file_name: string | null;
  file_path: string | null;
};

async function copyObject(filePath: string) {
  const { data: existingTarget } = await supabase.storage
    .from(TO_BUCKET)
    .list(filePath.split("/").slice(0, -1).join("/"), {
      search: filePath.split("/").pop(),
      limit: 1,
    });

  if (existingTarget && existingTarget.length > 0) {
    return "exists" as const;
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(FROM_BUCKET)
    .download(filePath);

  if (downloadError || !blob) {
    throw new Error(downloadError?.message || `No file returned for ${filePath}`);
  }

  const { error: uploadError } = await supabase.storage
    .from(TO_BUCKET)
    .upload(filePath, blob, {
      upsert: true,
      contentType: blob.type || "application/octet-stream",
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  if (DELETE_SOURCE) {
    const { error: removeError } = await supabase.storage
      .from(FROM_BUCKET)
      .remove([filePath]);

    if (removeError) {
      console.warn(`Copied ${filePath}, but failed removing source: ${removeError.message}`);
    }
  }

  return "copied" as const;
}

async function main() {
  if (FROM_BUCKET === TO_BUCKET) {
    throw new Error(`FROM_DOCUMENT_BUCKET and TO_DOCUMENT_BUCKET are both ${FROM_BUCKET}. Nothing to migrate.`);
  }

  console.log(`Migrating documents from ${FROM_BUCKET} to ${TO_BUCKET}...`);
  console.log(`Delete source after copy: ${DELETE_SOURCE ? "yes" : "no"}`);

  const { data: uploads, error } = await supabase
    .from("uploads")
    .select("id, file_name, file_path")
    .not("file_path", "is", null)
    .order("id", { ascending: true });

  if (error) throw new Error(`Failed loading uploads: ${error.message}`);

  let copied = 0;
  let exists = 0;
  let failed = 0;

  for (const upload of (uploads || []) as UploadRecord[]) {
    if (!upload.file_path) continue;

    try {
      const result = await copyObject(upload.file_path);
      if (result === "copied") copied++;
      if (result === "exists") exists++;
      console.log(`${result}: ${upload.file_path}`);
    } catch (err) {
      failed++;
      console.error(`failed: ${upload.file_path}`, err);
    }
  }

  console.log("Migration complete.");
  console.log({ copied, exists, failed, total: uploads?.length || 0 });

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
