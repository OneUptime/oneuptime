import DataObservabilityApi from "./DataObservabilityApi";
import {
  CollectionRequest,
  getCollectionPollDelayInMs,
  hasRequestedCollectionEnded,
  hasWaitedForCollectionTooLong,
  startCollectionRequest,
} from "./CollectionProgress";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import { useCallback, useEffect, useState } from "react";

/*
 * COLLECT NOW, AND THE WAIT FOR THE COLLECTION IT ASKED FOR.
 *
 * Pressed, it asks the server for a collection, then reads the stores
 * again (refresh) - often at first, then less (CollectionProgress) - until
 * the collection has ended, collected or failed: the page then shows how
 * it went. Until then the store is collecting, and its Collect Now waits.
 * A wait longer than a collection may take stops, and says so. The store
 * Overview and the Databases list both use it, so the two say the same.
 */

export interface CollectNow {
  // Whether a collection asked for here is being asked for or running.
  isCollecting: (dataStoreId: string) => boolean;
  // Whether the page waited as long as a collection may take, and it had not ended.
  hasWaitedLong: (dataStoreId: string) => boolean;
  collectNow: (store: DataObservabilityStoreSummary) => Promise<void>;
  // Why the last Collect Now could not be asked for, as API.getFriendlyMessage says it.
  error: string;
}

function without<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next: Set<T> = new Set(set);

  next.delete(value);

  return next;
}

function withoutKeys<K, V>(
  map: ReadonlyMap<K, V>,
  keys: Array<K>,
): ReadonlyMap<K, V> {
  const next: Map<K, V> = new Map(map);

  for (const key of keys) {
    next.delete(key);
  }

  return next;
}

export default function useCollectNow(data: {
  // The stores as the page last read them.
  stores: ReadonlyArray<DataObservabilityStoreSummary>;
  // Reads the stores again; it must keep its identity between renders.
  refresh: () => void;
  // The time now, in milliseconds; replaced in tests.
  now?: (() => number) | undefined;
}): CollectNow {
  const { stores, refresh } = data;
  const now: () => number =
    data.now ||
    ((): number => {
      return Date.now();
    });
  const [asking, setAsking] = useState<ReadonlySet<string>>(new Set());
  const [requests, setRequests] = useState<
    ReadonlyMap<string, CollectionRequest>
  >(new Map());
  const [waitedLong, setWaitedLong] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>("");

  // A collection asked for that has ended, by the stores as last read, stops being waited for.
  useEffect(() => {
    const ended: Array<string> = Array.from(requests.entries())
      .filter(([dataStoreId, request]: [string, CollectionRequest]) => {
        const store: DataObservabilityStoreSummary | undefined = stores.find(
          (candidate: DataObservabilityStoreSummary): boolean => {
            return candidate.dataStoreId === dataStoreId;
          },
        );

        // A store no longer listed has nothing left to wait for.
        return !store || hasRequestedCollectionEnded(store, request);
      })
      .map(([dataStoreId]: [string, CollectionRequest]): string => {
        return dataStoreId;
      });

    if (ended.length > 0) {
      setRequests(
        (
          previous: ReadonlyMap<string, CollectionRequest>,
        ): ReadonlyMap<string, CollectionRequest> => {
          return withoutKeys(previous, ended);
        },
      );
    }
  }, [stores, requests]);

  // Which collections are waited for, so the reads start again when one is asked for.
  const waitingFor: string = Array.from(requests.entries())
    .map(([dataStoreId, request]: [string, CollectionRequest]): string => {
      return `${dataStoreId}@${request.startedAtMs}`;
    })
    .join(",");

  // Reads the stores again while a collection asked for runs, until it ends or the wait is over.
  useEffect(() => {
    if (requests.size === 0) {
      return undefined;
    }

    let looks: number = 0;
    let isStopped: boolean = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const lookLater: () => void = (): void => {
      timer = setTimeout(() => {
        if (isStopped) {
          return;
        }

        const overdue: Array<string> = Array.from(requests.entries())
          .filter(([, request]: [string, CollectionRequest]): boolean => {
            return hasWaitedForCollectionTooLong(request, now());
          })
          .map(([dataStoreId]: [string, CollectionRequest]): string => {
            return dataStoreId;
          });

        if (overdue.length > 0) {
          setWaitedLong(
            (previous: ReadonlySet<string>): ReadonlySet<string> => {
              return new Set([...Array.from(previous), ...overdue]);
            },
          );
          setRequests(
            (
              previous: ReadonlyMap<string, CollectionRequest>,
            ): ReadonlyMap<string, CollectionRequest> => {
              return withoutKeys(previous, overdue);
            },
          );
        }

        looks++;
        refresh();
        lookLater();
      }, getCollectionPollDelayInMs(looks));
    };

    lookLater();

    return () => {
      isStopped = true;

      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [waitingFor, refresh]);

  const collectNow: (store: DataObservabilityStoreSummary) => Promise<void> =
    useCallback(
      async (store: DataObservabilityStoreSummary): Promise<void> => {
        const dataStoreId: string = store.dataStoreId;

        setError("");
        setWaitedLong((previous: ReadonlySet<string>): ReadonlySet<string> => {
          return without(previous, dataStoreId);
        });
        setAsking((previous: ReadonlySet<string>): ReadonlySet<string> => {
          return new Set([...Array.from(previous), dataStoreId]);
        });

        try {
          const requestedAt: string | null =
            await DataObservabilityApi.collectNow(new ObjectID(dataStoreId));

          setRequests(
            (
              previous: ReadonlyMap<string, CollectionRequest>,
            ): ReadonlyMap<string, CollectionRequest> => {
              const next: Map<string, CollectionRequest> = new Map(previous);

              next.set(
                dataStoreId,
                startCollectionRequest({ store, requestedAt, nowMs: now() }),
              );

              return next;
            },
          );
          refresh();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }

        setAsking((previous: ReadonlySet<string>): ReadonlySet<string> => {
          return without(previous, dataStoreId);
        });
      },
      [refresh],
    );

  return {
    isCollecting: (dataStoreId: string): boolean => {
      return asking.has(dataStoreId) || requests.has(dataStoreId);
    },
    hasWaitedLong: (dataStoreId: string): boolean => {
      return waitedLong.has(dataStoreId);
    },
    collectNow,
    error,
  };
}
