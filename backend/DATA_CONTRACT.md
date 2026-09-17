# Transaction Data Contract v1

## Accepted source formats

- `.xlsx` / `.xls`: every sheet is read and concatenated;
- `.csv`: one table;
- `.zip`: accepted only by the downloader, which extracts a single retail workbook.

Column names are trimmed and normalized through an explicit alias map. Matching is case-insensitive after spaces, `_`, and `-` are removed.

| Canonical field | Accepted examples | Required | Canonical type |
| --- | --- | --- | --- |
| `invoice_no` | `Invoice`, `InvoiceNo` | yes | string |
| `stock_code` | `StockCode` | yes | string |
| `description` | `Description` | no | nullable string |
| `quantity` | `Quantity` | yes | integer-compatible number |
| `invoice_date` | `InvoiceDate` | yes | UTC-naive datetime |
| `unit_price` | `Price`, `UnitPrice` | yes | number |
| `customer_id` | `Customer ID`, `CustomerID` | yes (value may be null) | normalized string |
| `country` | `Country` | yes | string |

Unknown columns are ignored. Missing required columns fail the entire input before any output is written.

## Canonical derived fields

| Field | Definition |
| --- | --- |
| `source_file` | basename of input file |
| `source_sheet` | Excel sheet name or `csv` |
| `source_row_number` | 1-based data-row position within the source table (header excluded) |
| `source_row_id` | deterministic SHA-256 prefix from file, sheet, row number, and raw canonical values |
| `is_cancellation` | invoice number begins with `C`, ignoring leading whitespace and case |
| `line_amount` | `quantity * unit_price`; negative for negative-quantity return lines |
| `rejection_reasons` | pipe-delimited, stable list of violated row rules |

## Classification rules

A row is **rejected** when one or more of the following apply:

- `missing_invoice_no`
- `missing_stock_code`
- `missing_customer_id`
- `missing_country`
- `invalid_invoice_date`
- `invalid_quantity`
- `zero_quantity`
- `nonintegral_quantity`
- `invalid_unit_price`
- `negative_unit_price`
- `duplicate_row`
- `purchase_nonpositive_quantity`
- `cancellation_positive_quantity`

After rejection rules:

- valid `is_cancellation = false` rows become purchases;
- valid `is_cancellation = true` rows become returns;
- returns retain negative `quantity` and `line_amount` to enable reconciliation.

These rules intentionally prioritize trustworthy customer modeling over retaining anonymous sales totals. Aggregate finance reporting may later ingest anonymous rows through a separate contract.

## Duplicate definition

The first occurrence of the same canonical business fields is retained. Later exact matches across `invoice_no`, `stock_code`, `description`, `quantity`, `invoice_date`, `unit_price`, `customer_id`, and `country` are rejected as `duplicate_row`.

This is deliberately conservative. It does not merge distinct product lines merely because they share an invoice and stock code.

## Quality invariants

- `input_rows = purchase_rows + return_rows + rejected_rows`
- source row IDs are unique in every output and across their union;
- purchase rows have quantity `> 0`, price `>= 0`, known customer, and valid datetime;
- return rows have cancellation invoice prefix and quantity `< 0`;
- numeric money calculations use unrounded source values; display rounding happens later;
- all outputs use a stable canonical column order.

## Dataset limitations

- source product descriptions are noisy and can be missing;
- customer identity is a pseudonymous numeric ID, not a complete CRM profile;
- country is order-level and the dataset is heavily UK-weighted;
- cancellations do not always map cleanly to an original invoice line;
- there are no product categories, margins, campaigns, support events, or explicit churn events;
- timestamps are treated as source-local/UTC-naive because source timezone is unspecified.

Downstream features and claims must respect these limitations.
