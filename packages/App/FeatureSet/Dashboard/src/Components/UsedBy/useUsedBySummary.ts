import UsedByApi from "./UsedByApi";
import { COULD_NOT_LOAD_USED_BY } from "./UsedByWords";
import ObjectID from "Common/Types/ObjectID";
import { UsedByRecordKind, UsedBySummary } from "Common/Types/UsedBy/UsedBy";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * What refers to one record, read once per record (and again on
 * `refreshToken` or retry): the card, a Delete page's notice and its
 * dialog all read the same answer.
 */

export type UsedBySummaryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; summary: UsedBySummary };

export interface UseUsedBySummaryResult {
  state: UsedBySummaryState;
  retry: () => void;
}

export default function useUsedBySummary(data: {
  recordKind: UsedByRecordKind;
  recordId: ObjectID;
  refreshToken?: number | string | undefined;
  // Read nothing until it is needed (an Archive dialog that is not open).
  isEnabled?: boolean | undefined;
}): UseUsedBySummaryResult {
  const recordIdString: string = data.recordId.toString();
  const isEnabled: boolean = data.isEnabled !== false;
  const [state, setState] = useState<UsedBySummaryState>({
    status: "loading",
  });
  const [retryCount, setRetryCount] = useState<number>(0);

  // The read the page is waiting for: a slower, older one is dropped.
  const latestRead: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const read: number = latestRead.current + 1;
    latestRead.current = read;
    setState({ status: "loading" });

    UsedByApi.getSummary({
      recordKind: data.recordKind,
      recordId: new ObjectID(recordIdString),
    })
      .then((summary: UsedBySummary) => {
        if (latestRead.current === read) {
          setState({ status: "loaded", summary: summary });
        }
      })
      .catch((error: unknown) => {
        if (latestRead.current === read) {
          setState({
            status: "error",
            message:
              error instanceof Error && error.message
                ? error.message
                : COULD_NOT_LOAD_USED_BY,
          });
        }
      });
  }, [
    data.recordKind,
    recordIdString,
    data.refreshToken,
    retryCount,
    isEnabled,
  ]);

  const retry: () => void = useCallback((): void => {
    setRetryCount((count: number): number => {
      return count + 1;
    });
  }, []);

  return { state: state, retry: retry };
}
