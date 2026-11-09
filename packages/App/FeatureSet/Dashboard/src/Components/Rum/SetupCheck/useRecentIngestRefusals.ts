import OneUptimeDate from "Common/Types/Date";
import { useEffect, useState } from "react";
import { IngestRefusalFact } from "./RumIngestRefusals";
import { fetchRecentIngestRefusals } from "./RumSignalReads";

/*
 * What the project's ingestion keys were refused in the past day (issue
 * #6378), for a RUM application's empty Exceptions and Logs: read when the
 * page opens and on every reloadToken - while isWanted, so a page whose
 * charts all have something to draw reads nothing. null until it is read,
 * and when it could not be read - a reader who may not read the project's
 * keys gets the empty charts as they were, without it.
 */
export default function useRecentIngestRefusals(
  reloadToken: number,
  isWanted: boolean = true,
): Array<IngestRefusalFact> | null {
  const [refusals, setRefusals] = useState<Array<IngestRefusalFact> | null>(
    null,
  );

  useEffect(() => {
    if (!isWanted) {
      return undefined;
    }

    let isCurrent: boolean = true;

    fetchRecentIngestRefusals(OneUptimeDate.getCurrentDate())
      .then((facts: Array<IngestRefusalFact>) => {
        if (isCurrent) {
          setRefusals(facts);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setRefusals(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [reloadToken, isWanted]);

  return refusals;
}
