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

export interface OpenedLogLineAddress {
  logId: string;
  // When it was written, when the address says.
  logTime: Date | null;
}

// How far either side of when the line was written it is looked for.
export const OPENED_LOG_LINE_TIME_SLACK_IN_MS: number = 1000;

/*
 * Without a time: a line's id is made as it arrives (time-ordered), so it
 * is looked for in the day before its id says it arrived, and a few
 * minutes after.
 */
export const OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS: number =
  24 * 60 * 60 * 1000;
export const OPENED_LOG_LINE_ARRIVAL_LOOK_AHEAD_IN_MS: number = 5 * 60 * 1000;

// The line an address opens: none for an address that names no line, or one that is not an id.
export function readOpenedLogLineAddress(
  search: string,
): OpenedLogLineAddress | null {
  const params: URLSearchParams = new URLSearchParams(search);
  const logId: string = (params.get(LOGS_EXPLORER_LOG_PARAM) || "").trim();

  if (!logId || !ObjectID.isValidUUID(logId)) {
    return null;
  }

  const timeText: string = (
    params.get(LOGS_EXPLORER_LOG_TIME_PARAM) || ""
  ).trim();
  const time: Date | null = timeText ? new Date(timeText) : null;

  return {
    logId,
    logTime: time && !Number.isNaN(time.getTime()) ? time : null,
  };
}

// A UUID's 32 hex digits, its dashes taken out.
const UUID_HEX_DIGITS: RegExp = /^[0-9a-f]{32}$/;
const UUID_DASHES: RegExp = /-/g;

/*
 * When a time-ordered id (UUID version 7) was made: its first 48 bits, in
 * milliseconds. Null for any other id.
 */
export function getTimeOfTimeOrderedId(id: string): Date | null {
  const hex: string = id.replace(UUID_DASHES, "").toLowerCase();

  if (!UUID_HEX_DIGITS.test(hex) || hex.charAt(12) !== "7") {
    return null;
  }

  const time: Date = new Date(parseInt(hex.substring(0, 12), 16));

  return Number.isNaN(time.getTime()) ? null : time;
}

// The window the line is looked for in.
export function getOpenedLogLineWindow(data: {
  address: OpenedLogLineAddress;
  now: Date;
}): { start: Date; end: Date } {
  if (data.address.logTime) {
    const time: number = data.address.logTime.getTime();

    return {
      start: new Date(time - OPENED_LOG_LINE_TIME_SLACK_IN_MS),
      end: new Date(time + OPENED_LOG_LINE_TIME_SLACK_IN_MS),
    };
  }

  const arrived: Date | null = getTimeOfTimeOrderedId(data.address.logId);
  const anchor: number = (arrived || data.now).getTime();

  return {
    start: new Date(anchor - OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS),
    end: new Date(anchor + OPENED_LOG_LINE_ARRIVAL_LOOK_AHEAD_IN_MS),
  };
}

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
