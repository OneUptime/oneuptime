import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * End to end through the real Feed and FeedItem: an AI investigation in the
 * incident or alert feed shows only the compact summary and root cause, and
 * "More Information" opens the whole report. Both renders stay in safeMode,
 * because every word of the report is model-authored.
 */

const getListMock: MockFunction = getJestMockFunction();
const markdownViewerMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      markdownViewerMock(props);
      return React.createElement(
        "div",
        { "data-testid": "markdown", "data-safe-mode": String(props.safeMode) },
        props.text,
      );
    },
  };
});

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: ConfirmModalProps): React.ReactElement => {
      return React.createElement("div", { role: "dialog" }, props.description);
    },
  };
});

import AlertFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed";
import IncidentFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../Models/DatabaseModels/AlertFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import ObjectID from "../../../Types/ObjectID";

interface MarkdownViewerProps {
  text: string;
  safeMode?: boolean | undefined;
}

interface ConfirmModalProps {
  description: React.ReactElement;
}

interface ListResult<T> {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
}

const INCIDENT_ID: ObjectID = new ObjectID(
  "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
);
const ALERT_ID: ObjectID = new ObjectID("d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2");
const AI_RUN_ID: ObjectID = new ObjectID(
  "d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3",
);
const POSTED_AT: Date = new Date("2026-09-14T18:04:00.000Z");

const REPORT: string = [
  "## 🧠 AI — Automated Root Cause Analysis",
  "",
  "**Summary** — checkout-api p95 passed 2s because its pool was cut to 10 [C2][C3].",
  "",
  "**Most likely root cause** — Release 2026.09.14-2 set `max=10` [C5], so requests queued for a connection [C6].",
  "",
  "**Evidence**",
  "- Pool usage pinned at 10 [C6]",
  "",
  "**Suggested next steps**",
  "1. Roll checkout-api back.",
  "",
  "**Evidence checked**",
  "- **[C2]** P95(http.server.request.duration) — 80 row(s)",
  "- **[C3]** Logs — 50 row(s)",
  "",
  "---",
  "*Investigated automatically by OneUptime AI — read-only, 10 queries run across your own telemetry using claude-sonnet-4-5. This is an AI-generated first pass; verify before acting.*",
].join("\n");

const COMPACT_TEXT: string = [
  "**OneUptime AI posted a root cause analysis**",
  "checkout-api p95 passed 2s because its pool was cut to 10.",
  "**Most likely root cause:** Release 2026.09.14-2 set `max=10`, so requests queued for a connection.",
].join("\n\n");

const ENGINEER_ROOT_CAUSE: string =
  "## Root cause\n\nAn engineer found a configuration regression.";

function listResult<T>(data: Array<T>): ListResult<T> {
  return { data, count: data.length, skip: 0, limit: 100 };
}

function incidentItem(
  id: string,
  markdown: string,
  aiRunId?: ObjectID,
): IncidentFeed {
  const item: IncidentFeed = new IncidentFeed();
  item.id = new ObjectID(id);
  item.incidentId = INCIDENT_ID;
  item.incidentFeedEventType = IncidentFeedEventType.RootCause;
  item.feedInfoInMarkdown = markdown;
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;

  if (aiRunId) {
    item.aiRunId = aiRunId;
  }

  return item;
}

function alertItem(
  id: string,
  markdown: string,
  aiRunId?: ObjectID,
): AlertFeed {
  const item: AlertFeed = new AlertFeed();
  item.id = new ObjectID(id);
  item.alertId = ALERT_ID;
  item.alertFeedEventType = AlertFeedEventType.RootCause;
  item.feedInfoInMarkdown = markdown;
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;

  if (aiRunId) {
    item.aiRunId = aiRunId;
  }

  return item;
}

function viewerCallsWithText(text: string): Array<MarkdownViewerProps> {
  return (markdownViewerMock.mock.calls as Array<Array<MarkdownViewerProps>>)
    .map((call: Array<MarkdownViewerProps>): MarkdownViewerProps => {
      return call[0]!;
    })
    .filter((props: MarkdownViewerProps): boolean => {
      return props.text === text;
    });
}

async function expectCompactItemWithFullReportBehindMoreInformation(): Promise<void> {
  expect(
    await screen.findByText(/OneUptime AI posted a root cause analysis/),
  ).toBeVisible();

  /* The feed body: compact, safe, and nothing of the full report yet. */
  const compactCalls: Array<MarkdownViewerProps> =
    viewerCallsWithText(COMPACT_TEXT);
  expect(compactCalls.length).toBeGreaterThan(0);
  compactCalls.forEach((props: MarkdownViewerProps): void => {
    expect(props.safeMode).toBe(true);
  });
  expect(viewerCallsWithText(REPORT)).toHaveLength(0);
  expect(screen.queryByText(/Evidence checked/)).toBeNull();
  expect(screen.queryByText(/\[C\d+\]/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "More Information" }));

  /* More Information: the whole report, still safe. */
  const dialog: HTMLElement = screen.getByRole("dialog");
  expect(dialog).toBeVisible();
  const reportCalls: Array<MarkdownViewerProps> = viewerCallsWithText(REPORT);
  expect(reportCalls.length).toBeGreaterThan(0);
  reportCalls.forEach((props: MarkdownViewerProps): void => {
    expect(props.safeMode).toBe(true);
  });
  const reportViewer: HTMLElement = within(dialog).getByTestId("markdown");
  expect(reportViewer.textContent).toBe(REPORT);
  expect(reportViewer).toHaveAttribute("data-safe-mode", "true");
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  markdownViewerMock.mockReset();
});

describe("AI root-cause feed items through the real feed", () => {
  test("incident feed: compact AI item, full report in More Information, both in safe mode", async () => {
    getListMock.mockResolvedValueOnce(
      listResult<IncidentFeed>([
        incidentItem("d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4", REPORT, AI_RUN_ID),
      ]) as never,
    );

    render(<IncidentFeedElement incidentId={INCIDENT_ID} refreshToken={0} />);

    await expectCompactItemWithFullReportBehindMoreInformation();
  });

  test("alert feed: compact AI item, full report in More Information, both in safe mode", async () => {
    getListMock.mockResolvedValueOnce(
      listResult<AlertFeed>([
        alertItem("d5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5", REPORT, AI_RUN_ID),
      ]) as never,
    );

    render(<AlertFeedElement alertId={ALERT_ID} refreshToken={0} />);

    await expectCompactItemWithFullReportBehindMoreInformation();
  });

  test("an engineer's root cause keeps its text, its normal markdown and no More Information", async () => {
    getListMock.mockResolvedValueOnce(
      listResult<IncidentFeed>([
        incidentItem(
          "d6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6",
          ENGINEER_ROOT_CAUSE,
        ),
      ]) as never,
    );

    const incidentView: ReturnType<typeof render> = render(
      <IncidentFeedElement incidentId={INCIDENT_ID} refreshToken={0} />,
    );

    expect(await screen.findByText(/configuration regression/)).toBeVisible();
    viewerCallsWithText(ENGINEER_ROOT_CAUSE).forEach(
      (props: MarkdownViewerProps): void => {
        expect(props.safeMode).toBe(false);
      },
    );
    expect(viewerCallsWithText(ENGINEER_ROOT_CAUSE).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "More Information" }),
    ).toBeNull();

    incidentView.unmount();
    markdownViewerMock.mockReset();
    getListMock.mockResolvedValueOnce(
      listResult<AlertFeed>([
        alertItem("d7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7", ENGINEER_ROOT_CAUSE),
      ]) as never,
    );

    render(<AlertFeedElement alertId={ALERT_ID} refreshToken={0} />);

    expect(await screen.findByText(/configuration regression/)).toBeVisible();
    expect(viewerCallsWithText(ENGINEER_ROOT_CAUSE).length).toBeGreaterThan(0);
    viewerCallsWithText(ENGINEER_ROOT_CAUSE).forEach(
      (props: MarkdownViewerProps): void => {
        expect(props.safeMode).toBe(false);
      },
    );
    expect(
      screen.queryByRole("button", { name: "More Information" }),
    ).toBeNull();
  });
});
