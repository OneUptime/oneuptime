import { MutableRefObject, useEffect, useRef, useState } from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "Common/Types/BaseDatabase/Query";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  FIRST_RECORD_POLL_INTERVAL_MS,
  getCountAfterCheck,
  isWatchingForFirstRecord,
} from "./FirstRecordWatch";

/*
 * How many records an infrastructure list has, and - while it has none -
 * a quiet watch for the first one, every FIRST_RECORD_POLL_INTERVAL_MS.
 *
 * The page shows its showcase while `count` is 0. When the first record
 * arrives (an agent reported, telemetry was matched) the showcase gives way
 * and `refreshToken` changes, which the list's ModelTable takes as its
 * refreshToggle, so the new row shows without a reload; `onFirstRecord`
 * tells whatever else on the page counts records (the Databases summary
 * strip). A failed background check keeps the showcase; only the first
 * count's failure is an error, and `retry` counts again (the error's
 * Refresh).
 */

export interface FirstRecordWatch {
  // Null until the first count arrives.
  count: number | null;
  isLoading: boolean;
  error: string;
  // For the list's ModelTable refreshToggle: changes when the first record arrives.
  refreshToken: string;
  /*
   * For the list's onCreateSuccess, and its Add dialog's onConnected: one
   * more, so the showcase gives way at once.
   */
  onRecordCreated: () => void;
  // After a failed first count: count again (the page shows its loader meanwhile).
  retry: () => void;
}

export default function useFirstRecordWatch<
  TBaseModel extends BaseModel,
>(data: {
  modelType: { new (): TBaseModel };
  query?: Query<TBaseModel> | undefined;
  // Called when the watch finds the first record (not for one created here).
  onFirstRecord?: (() => void) | undefined;
}): FirstRecordWatch {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string>("");
  const [arrivals, setArrivals] = useState<number>(0);
  // How many times the first count was asked for: retry asks again.
  const [attempts, setAttempts] = useState<number>(0);

  // The latest query, without restarting the watch when a page rebuilds it.
  const queryRef: MutableRefObject<Query<TBaseModel>> = useRef<
    Query<TBaseModel>
  >(data.query || {});
  queryRef.current = data.query || {};
  const onFirstRecordRef: MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(data.onFirstRecord);
  onFirstRecordRef.current = data.onFirstRecord;

  useEffect(() => {
    let isMounted: boolean = true;

    ModelAPI.count<TBaseModel>({
      modelType: data.modelType,
      query: queryRef.current,
    })
      .then((firstCount: number) => {
        if (isMounted) {
          setCount(firstCount);
        }
      })
      .catch((err: Error) => {
        if (isMounted) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [attempts]);

  useEffect(() => {
    if (!isWatchingForFirstRecord(count)) {
      return undefined;
    }

    let isMounted: boolean = true;

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      ModelAPI.count<TBaseModel>({
        modelType: data.modelType,
        query: queryRef.current,
      })
        .then((checked: number) => {
          if (!isMounted) {
            return;
          }

          const next: number | null = getCountAfterCheck({
            current: count,
            checked,
          });

          if (next === count) {
            return;
          }

          setCount(next);
          // The first record is in: the table reads its rows again.
          setArrivals((value: number): number => {
            return value + 1;
          });
          onFirstRecordRef.current?.();
        })
        .catch(() => {
          // A transient failure: keep the showcase, and keep watching.
        });
    }, FIRST_RECORD_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [count]);

  return {
    count,
    isLoading: count === null && !error,
    error,
    refreshToken: `first-record-${arrivals}`,
    onRecordCreated: (): void => {
      setCount((current: number | null): number => {
        return (current || 0) + 1;
      });
    },
    retry: (): void => {
      setError("");
      setAttempts((value: number): number => {
        return value + 1;
      });
    },
  };
}
