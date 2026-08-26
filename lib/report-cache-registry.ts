"use client";

export type ReportCacheRegistryEntry = {
  browserCacheKey: string;
  reportKey: string;
  permissions: string[];
};

export const SHARED_REPORT_CACHE_ENTRIES: ReportCacheRegistryEntry[] = [
  {
    browserCacheKey: "wmksolve:report-cache:accounting-summary",
    reportKey: "accounting-summary",
    permissions: ["can_view_accounting_summary"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:broker-commission-summary:v3",
    reportKey: "broker-commission-summary",
    permissions: ["can_view_broker_commission_summary"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:broker-data-sets:v3",
    reportKey: "broker-data-sets",
    permissions: ["can_view_broker_commission_data_sets"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:check-details",
    reportKey: "check-details",
    permissions: ["can_view_accounting_check_details"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:deduction-types:v1",
    reportKey: "deduction-types",
    permissions: ["can_view_database_deduction_type"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:hyvee-broker-commission:v1",
    reportKey: "hyvee-broker-commission",
    permissions: [
      "can_view_database_hyvee_invoices",
      "can_view_target_broker_commission",
    ],
  },
  {
    browserCacheKey: "wmksolve:report-cache:hyvee-invoices",
    reportKey: "hyvee-invoices",
    permissions: ["can_view_database_hyvee_invoices"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:kehe-dashboard",
    reportKey: "kehe-dashboard",
    permissions: ["can_view_dashboard", "can_view_kehe_dashboard"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:kehe-velocity",
    reportKey: "kehe-velocity",
    permissions: ["can_view_database_kehe_velocity"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:ksolve-invoices",
    reportKey: "ksolve-invoices",
    permissions: ["can_view_database_ksolve_invoices"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:locations:v1",
    reportKey: "locations",
    permissions: ["can_view_database_locations"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:product-list:v1",
    reportKey: "product-list",
    permissions: ["can_view_database_product_list"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:target-broker-commission:v1",
    reportKey: "target-broker-commission",
    permissions: ["can_view_target_broker_commission"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:target-invoices",
    reportKey: "target-invoices",
    permissions: ["can_view_database_target_invoices"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:tony-dashboard",
    reportKey: "tony-dashboard",
    permissions: ["can_view_tonys_dashboard"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:tony-invoices",
    reportKey: "tony-invoices",
    permissions: ["can_view_database_tony_invoices"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:tony-velocity:v1",
    reportKey: "tony-velocity",
    permissions: ["can_view_database_tony_velocity"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:unfi-invoices",
    reportKey: "unfi-invoices",
    permissions: ["can_view_database_unfi_invoices"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:wegmans-invoices",
    reportKey: "wegmans-invoices",
    permissions: ["can_view_database_wegmans"],
  },
  {
    browserCacheKey: "wmksolve:report-cache:wm-invoice-discrepancy",
    reportKey: "wm-dispute",
    permissions: ["can_view_accounting_wm_invoice_discrepancy"],
  },
];

export function getSharedReportKeyForBrowserCache(browserCacheKey: string) {
  return SHARED_REPORT_CACHE_ENTRIES.find(
    (entry) => entry.browserCacheKey === browserCacheKey
  )?.reportKey;
}
