"use client";

import { useState } from "react";

type KsolveDocument = {
  DocumentLink: string;
  DocumentType: string;
  DocumentDisplayName: string;
  FileSizeInBytes: number;
  CreatedOn: string;
  FileSizeDisplayable: string;
  StoragePath?: string;
  SignedUrl?: string | null;
};

export default function AutomationView() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<KsolveDocument[]>([]);
  const [message, setMessage] = useState("");

  async function runAutomation() {
    try {
      setLoading(true);
      setMessage("");
      setDocuments([]);

      const response = await fetch("/api/automation/ksolve/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.message || "Automation failed.");
      }

      const nextDocuments = result?.result?.documents || [];

      setDocuments(nextDocuments);

      setMessage(
        result?.message || "K-Solve automation completed successfully."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Automation failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runScheduleUpload() {
    try {
      setLoading(true);
      setMessage("");

      const response = await fetch("/api/automation/ksolve/schedule", {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.message || "Failed to save schedule.");
      }

      const nextDocuments = result?.result?.documents || [];

      setDocuments(nextDocuments);

      setMessage(
        result?.message || "Scheduled upload completed successfully."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to run scheduled upload."
      );
    } finally {
      setLoading(false);
    }
  }

  function downloadAll() {
    documents.forEach((document, index) => {
      setTimeout(() => {
        window.open(
          document.SignedUrl || document.DocumentLink,
          "_blank"
        );
      }, index * 500);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border p-6 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Manual Run</h2>

          <p className="text-sm text-gray-500 mt-1">
            Select the check date range to download and upload eligible
            documents.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Start date</label>

            <input
              type="date"
              className="w-full border rounded-xl px-4 py-3 mt-2"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium">End date</label>

            <input
              type="date"
              className="w-full border rounded-xl px-4 py-3 mt-2"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={runAutomation}
            disabled={loading}
            className="bg-black text-white px-5 py-3 rounded-xl"
          >
            {loading ? "Running..." : "Run"}
          </button>

          <button
            onClick={runScheduleUpload}
            disabled={loading}
            className="border px-5 py-3 rounded-xl"
          >
            {loading ? "Running..." : "Schedule Upload"}
          </button>

          {documents.length > 0 && (
            <button
              onClick={downloadAll}
              className="bg-blue-600 text-white px-5 py-3 rounded-xl"
            >
              Download All
            </button>
          )}
        </div>

        {message && (
          <div className="rounded-xl bg-gray-100 p-4 text-sm">
            {message}
          </div>
        )}
      </div>

      {documents.length > 0 && (
        <div className="rounded-2xl border p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold">
              Available downloads
            </h3>

            <div className="text-sm text-gray-500">
              {documents.length} file(s)
            </div>
          </div>

          <div className="space-y-4">
            {documents.map((document) => (
              <div
                key={`${document.DocumentDisplayName}-${document.CreatedOn}`}
                className="border rounded-2xl p-5"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium break-all">
                      {document.DocumentDisplayName}
                    </div>

                    <div className="text-sm text-gray-500 mt-1">
                      {document.DocumentType} •{" "}
                      {document.FileSizeDisplayable}
                    </div>
                  </div>

                  <a
                    href={
                      document.SignedUrl || document.DocumentLink
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center bg-black text-white px-4 py-2 rounded-xl whitespace-nowrap"
                  >
                    Download document
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}