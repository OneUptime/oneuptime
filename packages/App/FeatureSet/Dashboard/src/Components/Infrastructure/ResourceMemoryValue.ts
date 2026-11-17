import { formatReaderFigure } from "Common/Types/DateLanguage";

/*
 * How a resource list writes an amount of memory: the number in the
 * reader's digits, the unit as written ("۱۲٫۵ MB").
 *
 * A module of its own, apart from the table that writes its Memory column
 * with it (ResourceTable, which exports it as before), because a widget
 * writes memory too: the Ceph Pool List widget draws its own rows
 * (DashboardModelResourceListBase). Read from ResourceTable, it brought the
 * table with it - the shared Table, its filters, its bulk update form and
 * its pagination, some 140 KB before gzip - into the first load of every
 * public dashboard, which draws none of them
 * (packages/Common/Scripts/first-load-budgets.js).
 */
export function formatMemoryValue(bytes: number | null): string {
  if (bytes === null || bytes === undefined) {
    return "N/A";
  }

  // The number in the reader's digits, the unit as written: "۱۲٫۵ MB".
  if (bytes < 1024) {
    return `${formatReaderFigure(bytes, {
      decimals: 1,
      dropTrailingZeros: true,
    })}\u00A0B`;
  }

  if (bytes < 1024 * 1024) {
    return `${formatReaderFigure(bytes / 1024, { decimals: 1 })}\u00A0KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${formatReaderFigure(bytes / (1024 * 1024), { decimals: 1 })}\u00A0MB`;
  }

  return `${formatReaderFigure(bytes / (1024 * 1024 * 1024), {
    decimals: 2,
  })}\u00A0GB`;
}
