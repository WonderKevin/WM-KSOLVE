# Order Monitoring

The navigation item follows Admin. It is visible to the existing User Account or Automation administrators (including the application's administrator account). The API independently verifies the Supabase session and those same permissions on every request.

Orders are application monitoring records entered manually or confirmed from Excel. This feature does not read or mutate Arctanis.

## Persistence

Each PO is stored as an individual JSON document in the existing `public.report_snapshots` table, under `order-monitoring:v1:<encoded canonical PO number>`. Its materials, actions and all dates are saved in the same atomic row write. `version` is an optimistic concurrency counter; updates include the previously read version. A conflicting save returns 409 instead of overwriting the other session. Canonical PO keys make concurrent duplicate creates fail on the table primary key. PO numbers are stable record identifiers after creation.

The server-only endpoint `/api/order-monitoring` uses the deployment's existing `SUPABASE_SERVICE_ROLE_KEY` after verifying the user's bearer token and application permission. Credentials are never sent to the browser or downloaded. Direct client access to these keys is denied by the existing report snapshot policy. There is no database migration or new permission column. The endpoint returns a clear configuration error if deployment storage is not configured, and requires the existing report_snapshots schema.

`GET` lists all monitoring documents with pagination. `POST` creates a unique PO. `PATCH` supports complete replacement, a status change, or a next-action completion change. All successful saves return database-confirmed records. Database failures leave the editor open with all unsaved values retained. UI state is never presented as saved before acknowledgement.

## Workbook import

The actual `Order Monitoring.xlsx` file was not supplied with the implementation request; the parser follows the described PO section followed by a materials table. It supports vertical label/value pairs, horizontal metadata headers, multiple worksheets, numeric Excel dates (1900 and 1904 systems), explicit full-year calendar dates, quantities with units, and blank unknowns. Original material descriptions and quantity strings are retained. A sheet must include WM material, Required, Available - Reserved, Incoming, Shortage, PO, ETA and Status. The PO within the materials table belongs to the material supplier, not the main order.

Preview never writes. Customer, status and other details can be supplied before confirmation. Invalid source values are listed for explicit review; required identity/quantity fields must still pass validation. Missing material columns block import. Updates to an existing PO require an explicit checkbox and retain saved fields not supplied by the workbook, preserve next actions, and replace the material table shown in the preview. Every sheet is reviewed and confirmed separately; cancel stops the remaining queue. Already confirmed sheets remain saved.

Calculated shortage is `max(required - available after reservations, 0)`. Incoming never counts as available. Unknown inputs produce unknown shortage. Uploaded shortages remain separate; discrepancies require acknowledgement. Material status is independent of PO status.

## Timeline

Bars use saved dates only, in one compact lane. The calendar begins on today's New York business date (or a later selected From date), clips historical portions of bars, and advances on focus and at midnight. Historical source dates remain unchanged in details. Undated endpoints remain To confirm, and COA is Not applicable when not required. COA spans saved production finish to expected/actual COA release. Required and expected/actual delivery markers remain separate when their dates differ. Up to 366 future days are shown.

Pickup/Shipment is optional on each order, editable in both the summary row and PO form. Legacy records remain To confirm until a user chooses a method. Summary cards count active pickups and shipments, and the method filter scopes the cards and rows.

Cards follow the current filters. Delayed includes explicit Delayed status or an overdue expected delivery without actual delivery. At risk includes uncovered, overdue or late material arrivals, overdue actions or COA, and expected delivery later than required. Incoming stock that fully covers the current shortage with a non-overdue ETA on/before production and no delayed/unconfirmed material status is planned coverage, not available stock; this alone does not trigger At risk. Missing quantities remain unknown. Each row exposes exact risk reasons in its tooltip and expanded details. No imported facts or Arctanis records are automatically changed by these classifications.

## Validation

Run `node --import tsx --test tests/order-monitoring.test.ts tests/order-monitoring-api.test.ts` for parser, calculation, permission, persistence, duplicate and concurrency regressions, and `npm run build` for production compilation and TypeScript checks. `node scripts/qa-order-monitoring.cjs` checks browser flows against a local production server on port 3017. Browser checks use synthetic isolated records and mocked endpoints, never production business data.
