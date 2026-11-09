import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import {
  RUM_SIGNAL_APPLICATION_SELECT,
  getRumClientKind,
} from "./RumSignalFacts";
import {
  fetchNewestRumExceptionAt,
  fetchNewestRumWebVitalAt,
  fetchRecentIngestRefusals,
} from "./RumSignalReads";
import { IngestRefusalFact } from "./RumIngestRefusals";

/*
 * The reads behind a RUM application's setup check (issue #5770): its
 * record (when traces, logs and metrics last arrived, and whether anything
 * did), its newest exception and - for a browser app - its newest Web
 * Vital. Read when the card opens and on every reloadToken; while it reads
 * again, the last answers stay on screen.
 *
 * Each read stands alone: a viewer who may not read exceptions still sees
 * the rest, with "Couldn't be checked" on that one row. What the project's
 * keys were refused (issue #6378) is read beside them; a viewer who may not
 * read the keys gets the check without it, as it was before.
 */

export interface RumSignalArrivalRead {
  at: Date | null;
  failed: boolean;
}

export interface RumSetupCheckReads {
  // null until the first read lands.
  application: RumApplication | null;
  applicationFailed: boolean;
  // null while it loads.
  newestException: RumSignalArrivalRead | null;
  // null while it loads; at: null, never failed, for a mobile app.
  newestWebVital: RumSignalArrivalRead | null;
  /*
   * What the project's ingestion keys were refused in the past day; null
   * while it loads, and when it could not be read.
   */
  refusals: Array<IngestRefusalFact> | null;
  isRefreshing: boolean;
  // The clock the reads were answered against.
  checkedAt: Date;
}

function failedRead(): RumSignalArrivalRead {
  return { at: null, failed: true };
}

export default function useRumSetupCheck(
  rumApplicationId: ObjectID,
  reloadToken: number,
): RumSetupCheckReads {
  const [reads, setReads] = useState<RumSetupCheckReads>({
    application: null,
    applicationFailed: false,
    newestException: null,
    newestWebVital: null,
    refusals: null,
    isRefreshing: true,
    checkedAt: OneUptimeDate.getCurrentDate(),
  });

  // A slow read never overwrites a newer one.
  const generationRef: MutableRefObject<number> = useRef<number>(0);
  const id: string = rumApplicationId.toString();

  useEffect(() => {
    generationRef.current += 1;
    const generation: number = generationRef.current;
    const isCurrent: () => boolean = (): boolean => {
      return generation === generationRef.current;
    };

    setReads((previous: RumSetupCheckReads): RumSetupCheckReads => {
      return { ...previous, isRefreshing: true };
    });

    const run: () => Promise<void> = async (): Promise<void> => {
      const now: Date = OneUptimeDate.getCurrentDate();

      let application: RumApplication | null = null;
      let applicationFailed: boolean = false;

      try {
        application = await ModelAPI.getItem<RumApplication>({
          modelType: RumApplication,
          id: new ObjectID(id),
          select: RUM_SIGNAL_APPLICATION_SELECT,
        });
        applicationFailed = !application;
      } catch {
        applicationFailed = true;
      }

      const isBrowser: boolean =
        !application || getRumClientKind(application) === "browser";

      const [newestException, newestWebVital, refusals]: [
        RumSignalArrivalRead,
        RumSignalArrivalRead,
        Array<IngestRefusalFact> | null,
      ] = await Promise.all([
        fetchNewestRumExceptionAt(new ObjectID(id))
          .then((at: Date | null): RumSignalArrivalRead => {
            return { at, failed: false };
          })
          .catch(failedRead),
        isBrowser
          ? fetchNewestRumWebVitalAt({
              rumApplicationId: new ObjectID(id),
              now,
            })
              .then((at: Date | null): RumSignalArrivalRead => {
                return { at, failed: false };
              })
              .catch(failedRead)
          : Promise.resolve({ at: null, failed: false }),
        fetchRecentIngestRefusals(now).catch(() => {
          return null;
        }),
      ]);

      if (!isCurrent()) {
        return;
      }

      setReads((previous: RumSetupCheckReads): RumSetupCheckReads => {
        return {
          // A failed re-read keeps the record it had.
          application: application || previous.application,
          applicationFailed: applicationFailed && !previous.application,
          newestException,
          newestWebVital,
          refusals,
          isRefreshing: false,
          checkedAt: now,
        };
      });
    };

    run().catch(() => {
      if (!isCurrent()) {
        return;
      }

      setReads((previous: RumSetupCheckReads): RumSetupCheckReads => {
        return { ...previous, isRefreshing: false };
      });
    });

    return () => {
      generationRef.current += 1;
    };
  }, [id, reloadToken]);

  return reads;
}
