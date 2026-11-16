import { writeReaderMoment } from "Common/UI/Utils/ReaderMoments";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";

/*
 * A time the health pages read from the server (an ISO timestamp): a
 * migration's run, an instance health log's entry. Written as the
 * Dashboard writes a moment - in the zone the reader picked, on their
 * clock and in their language - and to the second, since these are
 * records read in order. The browser wrote them in its own zone and on the
 * language's clock (issue #8231). Nothing reads as a dash; a value that is
 * no date is shown as it came.
 */
export function formatHealthDateTime(value: unknown): string {
  const raw: string = String(value || "");

  if (!raw) {
    return EMPTY_VALUE_MARK;
  }

  const date: Date = new Date(raw);

  if (isNaN(date.getTime())) {
    return raw;
  }

  return writeReaderMoment(date, { includeSeconds: true });
}
