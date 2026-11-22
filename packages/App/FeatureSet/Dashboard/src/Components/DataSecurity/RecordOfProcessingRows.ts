import { DataSecurityRecordOfProcessingRow } from "Common/Types/DataSecurity/DataSecurityApiTypes";

/*
 * THE RECORD OF PROCESSING'S ROWS, AS COMPLIANCE LISTS THEM: by store name,
 * as an auditor reads the record down the page - the stores OneUptime
 * declares among the rest, not set apart from them. React-free, so a plain
 * test holds the order.
 */
export function sortRecordRows(
  rows: Array<DataSecurityRecordOfProcessingRow>,
): Array<DataSecurityRecordOfProcessingRow> {
  return [...rows].sort(
    (
      a: DataSecurityRecordOfProcessingRow,
      b: DataSecurityRecordOfProcessingRow,
    ): number => {
      return (a.name || "").localeCompare(b.name || "");
    },
  );
}
