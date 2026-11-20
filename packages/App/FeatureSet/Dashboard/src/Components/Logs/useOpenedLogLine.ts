import Log from "Common/Models/AnalyticsModels/Log";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import { LogsViewerOpenedLog } from "Common/UI/Components/LogsViewer/components/OpenedLogLine";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  LOGS_EXPLORER_LOG_PARAM,
  LOGS_EXPLORER_LOG_TIME_PARAM,
} from "Common/Utils/Telemetry/CrossSignalScope";
import { useEffect, useState } from "react";
import {
  OPENED_LOG_LINE_ARRIVAL_LOOK_AHEAD_IN_MS,
  OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS,
  OPENED_LOG_LINE_TIME_SLACK_IN_MS,
  OpenedLogLineAddress,
  getOpenedLogLineWindow,
  getTimeOfTimeOrderedId,
  readOpenedLogLineAddress,
} from "./OpenedLogLineAddress";

/*
 * ONE LOG LINE, OPENED BY ITS ID, ON THE LOGS PAGE (#9620).
 *
 * The Logs page's address can name one line: `log` (the line's id) and
 * `logTime` (when it was written) - what a security event's "View log
 * line" links to (getSecurityEventLogLineRoute), and an address anyone can
 * share. The explorer opens it above its list (OpenedLogLine), read by its
 * id with the reader's own permissions, in the second around when it was
 * written. A line that is gone and one the reader may not read are said
 * the same way. Closing it takes the two params off the address and leaves
 * the explorer as it is.
 */

// React-free, for App's tests (OpenedLogLineAddress); re-exported here.
export {
  OPENED_LOG_LINE_ARRIVAL_LOOK_AHEAD_IN_MS,
  OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS,
  OPENED_LOG_LINE_TIME_SLACK_IN_MS,
  getOpenedLogLineWindow,
  getTimeOfTimeOrderedId,
  readOpenedLogLineAddress,
};
export type { OpenedLogLineAddress };

// A refusal reads as a line that is not there: the address never tells which.
function isRefused(error: unknown): boolean {
  const status: unknown = (error as { statusCode?: unknown })?.statusCode;

  return status === 401 || status === 403 || status === 404;
}

interface OpenedLogLineState {
  log: Log | null;
  isLoading: boolean;
  isNotFound: boolean;
  error: string;
}

export default function useOpenedLogLine(options: {
  // Only the Logs page's own explorer reads its address.
  isEnabled: boolean;
  // The columns the line is read with: the list's.
  select: Select<Log>;
}): LogsViewerOpenedLog | undefined {
  const [address, setAddress] = useState<OpenedLogLineAddress | null>(() => {
    return options.isEnabled && typeof window !== "undefined"
      ? readOpenedLogLineAddress(window.location.search)
      : null;
  });
  const [state, setState] = useState<OpenedLogLineState>({
    log: null,
    isLoading: Boolean(address),
    isNotFound: false,
    error: "",
  });
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    if (!address) {
      return;
    }

    let isCurrent: boolean = true;
    const lookIn: { start: Date; end: Date } = getOpenedLogLineWindow({
      address,
      now: new Date(),
    });
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    setState({ log: null, isLoading: true, isNotFound: false, error: "" });

    AnalyticsModelAPI.getList<Log>({
      modelType: Log,
      query: {
        ...(projectId ? { projectId } : {}),
        _id: address.logId,
        time: new InBetween<Date>(lookIn.start, lookIn.end),
      } as Query<Log>,
      limit: 1,
      skip: 0,
      select: options.select,
      sort: {},
      requestOptions: {},
    })
      .then((result: ListResult<Log>): void => {
        if (!isCurrent) {
          return;
        }

        const log: Log | undefined = result.data[0];

        setState({
          log: log || null,
          isLoading: false,
          isNotFound: !log,
          error: "",
        });
      })
      .catch((error: unknown): void => {
        if (!isCurrent) {
          return;
        }

        setState(
          isRefused(error)
            ? { log: null, isLoading: false, isNotFound: true, error: "" }
            : {
                log: null,
                isLoading: false,
                isNotFound: false,
                error: API.getFriendlyMessage(error as Error),
              },
        );
      });

    return () => {
      isCurrent = false;
    };
    // The columns are the list's, fixed for the page.
  }, [address?.logId, address?.logTime?.getTime(), readCount]);

  if (!address) {
    return undefined;
  }

  return {
    log: state.log,
    isLoading: state.isLoading,
    isNotFound: state.isNotFound,
    error: state.error,
    onClose: (): void => {
      Navigation.setQueryString({
        [LOGS_EXPLORER_LOG_PARAM]: null,
        [LOGS_EXPLORER_LOG_TIME_PARAM]: null,
      });
      setAddress(null);
    },
    onRetry: (): void => {
      setReadCount((count: number): number => {
        return count + 1;
      });
    },
  };
}
