import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The line a copied link opens (#9794, #9620), read as whoever opens it: by
 * its id, through the reader's own session - the address carries nothing
 * that reads it any other way - in the project they are in, around when it
 * was written. A line their role may not read is said to be not found,
 * exactly as one that is gone, so a link never tells which.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import useOpenedLogLine, {
  OPENED_LOG_LINE_TIME_SLACK_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/useOpenedLogLine";
import { buildLogLineLink } from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogLineLink";
import Log from "../../../Models/AnalyticsModels/Log";
import { LogsViewerOpenedLog } from "../../../UI/Components/LogsViewer/components/OpenedLogLine";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const LOG_ID: string = "0192f1a0-0000-7000-8000-000000000001";
const WRITTEN: Date = new Date("2026-10-27T06:45:12.345Z");

let getList: ReturnType<typeof jest.spyOn>;
let state: LogsViewerOpenedLog | undefined;

function Probe(): ReactElement {
  state = useOpenedLogLine({ isEnabled: true, select: { body: true } });

  return (
    <p data-testid="probe">
      {state?.isLoading ? "loading" : ""}
      {state?.log ? "opened" : ""}
      {state?.isNotFound ? "not found" : ""}
      {state?.error || ""}
    </p>
  );
}

// Opens the explorer at the link Copy Link copied for the line.
function openCopiedLink(): void {
  const link: string = buildLogLineLink({
    logsPageUrl: `${window.location.origin}/dashboard/${PROJECT_ID.toString()}/logs`,
    line: { id: LOG_ID, time: WRITTEN, primaryEntityId: "" },
    list: { facetFilters: new Map(), window: null, isLogsPage: true },
  })!;
  const url: URL = new URL(link);

  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  render(<Probe />);
}

beforeEach(() => {
  state = undefined;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getList = jest.spyOn(AnalyticsModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("the line a copied link opens", () => {
  test("is read by its id, in the opener's project, around when it was written, through their own session", async () => {
    const log: Log = new Log();
    log.body = "GET /admin 403";
    getList.mockResolvedValue({ data: [log], count: 1 } as never);

    openCopiedLink();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("opened");
    });

    expect(getList).toHaveBeenCalledTimes(1);

    const read: {
      modelType: unknown;
      query: { projectId: ObjectID; _id: string; time: InBetween<Date> };
      requestOptions: Record<string, unknown>;
      limit: number;
    } = getList.mock.calls[0]![0] as never;

    expect(read.modelType).toBe(Log);
    expect(read.query._id).toBe(LOG_ID);
    expect(read.query.projectId).toEqual(PROJECT_ID);
    expect(read.query.time.startValue).toEqual(
      new Date(WRITTEN.getTime() - OPENED_LOG_LINE_TIME_SLACK_IN_MS),
    );
    expect(read.query.time.endValue).toEqual(
      new Date(WRITTEN.getTime() + OPENED_LOG_LINE_TIME_SLACK_IN_MS),
    );
    expect(read.limit).toBe(1);
    // Nothing but the reader's own session reads it: no override of any kind.
    expect(read.requestOptions).toEqual({});
  });

  test.each([401, 403, 404])(
    "refused (%i), it is not found - said as a line that is gone, never which",
    async (statusCode: number) => {
      getList.mockRejectedValue(
        Object.assign(new Error("You do not have permission"), {
          statusCode,
        }) as never,
      );

      openCopiedLink();

      await waitFor(() => {
        expect(screen.getByTestId("probe")).toHaveTextContent("not found");
      });

      expect(state?.error).toBe("");
      expect(screen.getByTestId("probe")).not.toHaveTextContent("permission");
    },
  );

  test("a line that is gone reads the same way as one the reader may not read", async () => {
    getList.mockResolvedValue({ data: [], count: 0 } as never);

    openCopiedLink();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("not found");
    });
    expect(state?.error).toBe("");
  });

  test("closing it takes the line off the address and leaves the explorer as it is", async () => {
    getList.mockResolvedValue({ data: [new Log()], count: 1 } as never);

    openCopiedLink();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("opened");
    });

    act(() => {
      state!.onClose();
    });

    expect(window.location.search).not.toContain("log=");
    expect(window.location.search).not.toContain("logTime=");
  });
});
