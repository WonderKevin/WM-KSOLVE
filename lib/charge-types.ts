export const CHARGE_TYPES = ["Service Level Fine", "Fuel Surcharge"] as const;

export const CHARGE_TYPE_RETAILERS = [
  "Kehe", "Tony's", "Target's", "UNFI", "Hy-Vee", "Wegmans'",
] as const;

export function retailerChargeTypes(retailer: string) {
  return CHARGE_TYPES.map((type) => `${retailer} ${type}`);
}

export function standardChargeType(raw: string | null | undefined) {
  const key = String(raw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const type of CHARGE_TYPES) {
    const typeKey = type.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key === typeKey || CHARGE_TYPE_RETAILERS.some((retailer) =>
      key === retailer.toLowerCase().replace(/[^a-z0-9]/g, "") + typeKey
    )) return type;
  }
  return "";
}
