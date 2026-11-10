# Order Monitoring

Order Monitoring is available to every signed-in registered WM app user. The navigation item follows Admin when Admin is visible, and remains available when Admin is hidden. The API independently verifies a valid Supabase session on every request; a WM application access record is required, but no Admin permission is required. Other application permissions remain independently enforced.

Orders are application monitoring records confirmed from Excel. The summary card strip and Add PO button are intentionally omitted; Excel import is the entry point for new orders. This feature does not read or mutate Arctanis.

## Persistence

Each PO is stored as an individual JSON document in the existing `public.report_snapshots` table, under `order-monitoring:v1:<encoded canonical PO number>`. Its materials, actions and all dates are saved in the same atomic row write. `version` is an optimistic concurrency counter; updates include the previously read version. A conflicting save returns 409 instead of overwriting the other session. Canonical PO keys make concurrent duplicate creates fail on the table primary key. PO numbers are stable record identifiers after creation.

The server-only endpoint `/api/order-monitoring` uses the deployment's existing `SUPABASE_SERVICE_ROLE_KEY` after verifying the user's bearer token. Credentials are never sent to the browser or downloaded. Direct client access to these keys is denied by the existing report snapshot policy. There is no database migration or new permission column. The endpoint returns a clear configuration error if deployment storage is not configured, and requires the existing report_snapshots schema.

`GET` lists all monitoring documents with pagination. `POST` creates a unique PO. `PATCH` supports complete replacement, PO or material status changes, pickup/shipment changes, and next-action completion. All successful saves return database-confirmed records. Database failures leave the editor open with all unsaved values retained. UI state is never presented as saved before acknowledgement.

## Workbook import

The actual `Order Monitoring.xlsx` file was not supplied with the implementation request; the parser follows the described PO section followed by a materials table. It supports vertical label/value pairs, horizontal metadata headers, multiple worksheets, numeric Excel dates (1900 and 1904 systems), explicit full-year calendar dates, quantities with units, and blank unknowns. Original material descriptions and quantity strings are retained. A sheet must include WM material, Required, Available - Reserved, Incoming, Shortage, PO, ETA and Status. The PO within the materials table belongs to the material supplier, not the main order.

Preview never writes. Customer, status and other details can be supplied before confirmation. Invalid source values are listed for explicit review; required identity/quantity fields must still pass validation. Missing material columns are review notes; users may fill the missing values in the preview or explicitly acknowledge unknown values. Updates to an existing PO require an explicit checkbox and retain saved fields not supplied by the workbook, preserve next actions, and replace the material table shown in the preview. Every sheet is reviewed and confirmed separately; cancel stops the remaining queue. Already confirmed sheets remain saved.

Calculated shortage is `max(required - available after reservations, 0)`. Incoming never counts as available. Unknown inputs produce unknown shortage. Uploaded shortages remain separate; discrepancies require acknowledgement. Material status is independent of PO status. Each expanded material row has an immediately saved dropdown with Sent, Confirmed, Delayed, In transit and Delivered, also available in Edit materials. Legacy imported labels remain visible until explicitly changed. Status changes do not receive stock or alter quantities, ETAs or PO status. Failed saves retain the previous saved selection.

## Timeline

Bars use saved dates only, in one compact lane. The calendar begins on today's New York business date (or a later selected From date), clips historical portions of bars, and advances on focus and at midnight. Historical source dates remain unchanged in details. Undated endpoints remain To confirm, and COA is Not applicable when not required. COA spans saved production finish to expected/actual COA release. Required and expected/actual delivery markers remain separate when their dates differ. Up to 366 future days are shown.

Pickup/Shipment is optional on each order, editable in both the summary row and PO form. Legacy records remain To confirm until a user chooses a method. The method filter scopes the order rows.

Order rows follow the current filters. Delayed includes explicit Delayed status or an overdue expected delivery without actual delivery. At risk is flagged only when a needed material has a saved ETA later than production start. An ETA on or before the production date is on time. A shortage, missing ETA, insufficient incoming quantity, unconfirmed material status, overdue action/COA or expected delivery later than required does not independently flag At risk. Materials already covered by available stock do not depend on later replenishment. Unknown dates remain To confirm. Stock readiness and incoming quantities remain separate from this date-only risk rule. Exact late-material reasons appear in the row tooltip and expanded details.

## Validation

Run `node --import tsx --test tests/order-monitoring.test.ts tests/order-monitoring-api.test.ts` for parser, calculation, permission, persistence, duplicate and concurrency regressions, and `npm run build` for production compilation and TypeScript checks. `node scripts/qa-order-monitoring.cjs` checks browser flows against a local production server on port 3017. Browser checks use synthetic isolated records and mocked endpoints, never production business data.

The PO details editor omits Product/SKU, Pickup/shipment, required/expected/actual delivery, Destination and PO Owner fields. Existing saved values remain stored. Customer or Customer name in the workbook PO information section prepopulates Customer on upload, with manual correction available before confirmation.

The timeline diamond represents Expected pickup / ship date, including when no delivery date or fulfillment mode is saved. A shipping/pickup milestone uses that saved date without requiring a delivery end date. The action menu is portaled above page content to avoid clipping by the timeline, and repositions above its trigger near the bottom of the viewport.

Success notices clear automatically after four seconds; errors stay visible. The board fills the available width by stretching day columns on wide screens (minimum 30px per day), has taller timeline rows and a viewport-based minimum height. Narrow screens retain horizontal scrolling.

Order Date or Order Date: in the workbook PO information section fills Order date on import, alongside Customer. It supports Excel serial dates and explicit calendar dates, preserves unknown dates as blank, and flags invalid dates for review.

Timeline rows sort by Expected pickup / ship date, earliest first. Unknown dates sort last; orders on the same date sort by PO number.

The search/status/date filter panel is removed. Expanding a PO (or choosing View details) focuses the board on that PO and hides the other rows; collapsing restores all orders in expected pickup/ship date order. Timeline dates stay stable during expansion.

A one-time deployment correction, gated by ORDER_MONITORING_ETA_CORRECTION=po10077-20261102, changes only saved material ETAs of 2026-11-09 linked to supplier PO-10077 (or 10077) to 2026-11-02. It preserves quantities/statuses and other dates, uses version checks, and re-reads storage to verify no matching old ETAs remain. It uses existing deployment configuration without exporting credentials and does not write to Arctanis. Ordinary builds do not run the correction.

The sticky customer column is 480px wide and wraps full customer names. Saved Product/SKU appears beneath the PO; the six user-supplied PO/item mappings are used as defaults for later imports and link to their supplied Arctanis documents. A separately gated one-time deployment update persists these item labels to existing monitoring orders and clears only Supplier PO values equal to To confirm. Blank supplier POs display as empty cells.

Material rows are preserved in storage and imports. The readiness table puts shortages or actual supplier PO references first. Zero-shortage rows with no supplier PO are hidden by default, except unresolved uploaded/calculated discrepancies. Unknown quantities remain visible. Show all materials reveals hidden rows; editing always includes all saved materials. The proposed row-deletion change was canceled before deployment and no material rows were deleted.

Import findings re-evaluate corrected PO dates, COA required, cases and missing material values against the current preview. Missing columns no longer permanently disable confirmation: users may fill them or explicitly review unknowns. Not recorded and Not specified are recognized unknown markers; quantity header aliases include Available, Available Qty and Incoming Quantity. All normal current-value validation, duplicate acknowledgement and shortage review still apply.

Next actions includes free-text Notes with explicit Save notes and Cancel notes, plus the same field in Edit actions. Notes use the existing authenticated version-checked document saves; failed saves retain typed text. The requested CBF-Sell update replaces PO-10077 supplier references in monitoring materials and appends PO-10077 was delayed, Delivery on 11/9. once to each affected order’s next-action notes. Other notes, actions, quantities, material ETAs and statuses remain. A gated one-time deployment update backs up original records and verifies the correction. Future imports apply the same mapping and preserve existing notes on duplicate updates. No Arctanis records are changed.

Supply PO is recognized as a supplier-reference column during import. The two explanatory footer patterns (Available - Reserved footnote and Source: Arctanis note) are skipped only when no material identifier, supplier PO, ETA or quantities are present. Material table rows include Delete row with confirmation, authenticated version checks, server-confirmed saving and backup of the original order. The requested one-time repair for PO-10139 fills the seven screenshot-supplied references and removes only the two matching footer rows.

The November 10 access audit covers all existing authentication accounts and adds missing WM membership rows with the same default dashboard access previously used by the UI. Existing permission flags are untouched. Unauthenticated requests and authenticated identities without a WM access record remain blocked. Admin and Automation remain separately restricted.
