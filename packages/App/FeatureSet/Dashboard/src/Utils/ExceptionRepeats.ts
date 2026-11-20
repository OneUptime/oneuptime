import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { MATCH_WINDOW_MS } from "Common/Utils/Telemetry/AppleCrashMatch";

/*
 * WHICH OCCURRENCES ANOTHER REPORT REPEATS (#9923).
 *
 * An iOS crash KSCrash and MetricKit both report is one occurrence: the
 * first report. The second is kept beside it as evidence, under the same
 * exception, naming the first in duplicateOf, and is listed and counted
 * nowhere (ExceptionInstanceService). The occurrences table says of an
 * occurrence that it was reported twice, so the evidence shows where the
 * crash does.
 *
 * One read per page of the table: the repeats of the page's occurrences,
 * within the window two reports of one crash are paired in
 * (AppleCrashMatch.MATCH_WINDOW_MS) either side of the page, so the read
 * scans the days the page covers, never the project's whole history.
 */

export interface RepeatsQueryInput {
  projectId: ObjectID;
  occurrences: Array<{ id: string; time: Date | undefined }>;
}

export function buildRepeatsQuery(
  input: RepeatsQueryInput,
): Record<string, unknown> | null {
  const ids: Array<string> = [];
  let earliest: number = Number.POSITIVE_INFINITY;
  let latest: number = Number.NEGATIVE_INFINITY;

  for (const occurrence of input.occurrences) {
    const time: number = occurrence.time ? occurrence.time.getTime() : NaN;

    if (!occurrence.id || !Number.isFinite(time)) {
      continue;
    }

    if (!ids.includes(occurrence.id)) {
      ids.push(occurrence.id);
    }

    earliest = Math.min(earliest, time);
    latest = Math.max(latest, time);
  }

  if (ids.length === 0) {
    return null;
  }

  return {
    projectId: input.projectId,
    duplicateOf: new Includes(ids),
    time: new InBetween<Date>(
      new Date(earliest - MATCH_WINDOW_MS),
      new Date(latest + MATCH_WINDOW_MS),
    ),
  };
}

/*
 * The ids of the occurrences another report repeats. Empty when the page
 * holds none, and when the read fails: the mark is an aside on the table.
 */
export async function findRepeatedOccurrences(
  input: RepeatsQueryInput,
): Promise<Set<string>> {
  const query: Record<string, unknown> | null = buildRepeatsQuery(input);

  if (!query) {
    return new Set<string>();
  }

  try {
    const result: AnalyticsListResult<ExceptionInstance> =
      await AnalyticsModelAPI.getList<ExceptionInstance>({
        modelType: ExceptionInstance,
        query: query,
        select: { duplicateOf: true },
        sort: { time: SortOrder.Descending },
        skip: 0,
        limit: (query["duplicateOf"] as Includes).values.length,
      });

    const repeated: Set<string> = new Set<string>();

    for (const repeat of result.data || []) {
      const original: string = repeat.duplicateOf || "";

      if (original) {
        repeated.add(original);
      }
    }

    return repeated;
  } catch {
    return new Set<string>();
  }
}
