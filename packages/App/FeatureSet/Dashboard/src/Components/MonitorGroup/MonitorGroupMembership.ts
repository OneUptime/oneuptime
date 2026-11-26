import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import MonitorGroupMonitorsCopy from "./MonitorGroupMonitorsCopy";

/*
 * The decisions behind a monitor group's Add Monitors, kept free of React so
 * App/Tests can hold them: which monitors the dialog offers, what it says
 * when it has none to offer, and what it says when some of the picked ones
 * could not be added.
 */

/*
 * The monitors Add Monitors offers, as the server lists them: the project's
 * live monitors the group does not hold yet. Offering a monitor the group
 * already has would add it twice: nothing stops a second row pairing the
 * same monitor with the same group.
 *
 * The dialog's picker sends this query with every search and the server
 * searches, 50 names at a time (#10399). It used to read the project's
 * first 10,000 monitors by name and drop the group's in the browser, so in a
 * bigger project a monitor whose name sorted late was never offered, and a
 * search for it found nothing. A monitor never lacks an id, so "not one of
 * these" (IncludesNone, NOT IN) keeps every other monitor.
 */
export const getMonitorsToOfferQuery: (data: {
  monitorIdsInGroup: Array<ObjectID | string>;
}) => Record<string, unknown> = (data: {
  monitorIdsInGroup: Array<ObjectID | string>;
}): Record<string, unknown> => {
  const query: Record<string, unknown> = { isArchived: false };

  if (data.monitorIdsInGroup.length > 0) {
    query["_id"] = new IncludesNone(
      data.monitorIdsInGroup.map((id: ObjectID | string): string => {
        return id.toString();
      }),
    );
  }

  return query;
};

/*
 * How many monitors Add Monitors can offer, as the server counts them when
 * it opens: the project's live monitors, and those the group does not hold.
 * The first is counted only when the second is nothing, to say why.
 */
export interface MonitorsToOfferCounts {
  inProject: number | undefined;
  toOffer: number;
}

/*
 * Why Add Monitors has nothing to offer, once the monitors are counted: the
 * project has none yet, or the group holds every one. Undefined while there
 * is something to pick.
 */
export const getNothingToAddMessage: (
  counts: MonitorsToOfferCounts,
) => string | undefined = (
  counts: MonitorsToOfferCounts,
): string | undefined => {
  if (counts.toOffer > 0) {
    return undefined;
  }

  if (counts.inProject === 0) {
    return MonitorGroupMonitorsCopy.noMonitorsInProject;
  }

  return MonitorGroupMonitorsCopy.everyMonitorInGroup;
};

export interface MonitorGroupAddResult {
  // How many of the picked monitors were added.
  added: number;
  // How many were picked.
  total: number;
  // Why the first one that failed was refused.
  firstError: string | undefined;
}

/*
 * What the dialog says after adding: nothing when every pick was added, the
 * reason when none was, and how many made it plus the reason otherwise.
 */
export const getAddMonitorsErrorMessage: (
  result: MonitorGroupAddResult,
  translator: Translator,
) => string | null = (
  result: MonitorGroupAddResult,
  translator: Translator,
): string | null => {
  if (result.added === result.total || !result.firstError) {
    return null;
  }

  if (result.added === 0) {
    return translator.translateTemplate(
      MonitorGroupMonitorsCopy.noneAddedError,
      {
        reason: result.firstError,
      },
    );
  }

  return translator.translateTemplate(
    MonitorGroupMonitorsCopy.someNotAddedError,
    {
      added: String(result.added),
      total: String(result.total),
      reason: result.firstError,
    },
  );
};
