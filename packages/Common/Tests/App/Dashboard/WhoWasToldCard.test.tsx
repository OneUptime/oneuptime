/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Read by a self-hosted server's member, whatever the environment says: a
 * server failure's reference goes to whoever runs the server. CI's
 * config.env sets BILLING_ENABLED=true, which reads as OneUptime's cloud.
 */
jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

import WhoWasToldCard from "../../../../App/FeatureSet/Dashboard/src/Components/WhoWasTold/WhoWasToldCard";
import WhoWasToldApi, {
  getWhoWasToldUrl,
  isWhoWasToldResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/WhoWasTold/WhoWasToldApi";
import {
  WHO_WAS_TOLD_PEOPLE_SHOWN,
  getNotificationReason,
  getPageThroughWords,
  getWhoWasToldHiddenSentences,
  getWhoWasToldSentences,
} from "../../../../App/FeatureSet/Dashboard/src/Components/WhoWasTold/WhoWasToldWords";
import MailStatus from "../../../Types/Mail/MailStatus";
import {
  WhoWasToldLogKind,
  WhoWasToldLogRow,
  WhoWasToldResult,
  WhoWasToldRun,
  WhoWasToldStepRow,
  buildWhoWasTold,
} from "../../../Types/Notification/WhoWasTold";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageDeliveryStatus,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import SmsStatus from "../../../Types/SmsStatus";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  createTranslator,
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

/*
 * WHO WAS TOLD ON AN INCIDENT OR AN ALERT, AS IT HAPPENED (#7075): who
 * OneUptime told, by what, and what failed - one line per person and
 * channel, the details folded away, live while the record is open, and
 * nothing the reader may not read: a private incident they may not see is
 * not found, and what they may not read is counted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "70751111-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "70751111-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("70751111-0000-4000-8000-000000000003");

const translator: Translator = getGlobalTranslator();
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

const DASHBOARD_LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// The Dashboard's own words in `language`.
function localeTranslator(language: string): Translator {
  const words: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];
    return typeof value === "string" ? value : undefined;
  }, language);
}

const AT: (minute: number) => string = (minute: number): string => {
  return new Date(Date.UTC(2026, 10, 17, 10, minute, 0)).toISOString();
};

const RUN: WhoWasToldRun = {
  id: "run-1",
  policyId: "policy-1",
  policyName: "Primary",
  isDirectPage: false,
  status: OnCallDutyPolicyStatus.Executing,
  statusMessage: "",
  startedAt: AT(0),
};

function step(data: Partial<WhoWasToldStepRow>): WhoWasToldStepRow {
  return {
    id: data.id || `step-${data.userId || "none"}`,
    runId: "run-1",
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    statusMessage: "",
    createdAt: AT(1),
    channels: [],
    ...data,
  };
}

function log(data: Partial<WhoWasToldLogRow>): WhoWasToldLogRow {
  return {
    id: data.id || "log",
    kind: WhoWasToldLogKind.Email,
    status: MailStatus.Success,
    createdAt: AT(1),
    isOnCallPage: false,
    ...data,
  };
}

function answer(data: {
  recordKind?: OnCallTestPageRecordKind;
  runs?: Array<WhoWasToldRun>;
  steps?: Array<WhoWasToldStepRow>;
  logs?: Array<WhoWasToldLogRow>;
  subscribers?: WhoWasToldResult["subscribers"];
  hiddenNotificationCount?: number;
  hiddenRunCount?: number;
  isTruncated?: boolean;
}): WhoWasToldResult {
  return buildWhoWasTold({
    recordKind: data.recordKind || OnCallTestPageRecordKind.Incident,
    recordId: INCIDENT_ID.toString(),
    checkedAt: AT(30),
    runs: data.runs || [RUN],
    steps: data.steps || [],
    logs: data.logs || [],
    subscribers: data.subscribers,
    hiddenNotificationCount: data.hiddenNotificationCount || 0,
    hiddenRunCount: data.hiddenRunCount || 0,
    isTruncated: Boolean(data.isTruncated),
  });
}

// A busy incident's answer: one page to Ana, acknowledged, and its trail.
function acknowledgedByAna(): WhoWasToldResult {
  return answer({
    runs: [{ ...RUN, acknowledgedAt: AT(4), acknowledgedByName: "Ana Lopez" }],
    steps: [
      step({
        userId: "ana",
        userName: "Ana Lopez",
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        isAcknowledged: true,
        acknowledgedAt: AT(4),
        levelOrder: 1,
        teamName: "Platform",
        channels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
      }),
    ],
    logs: [
      log({
        id: "sms-ana",
        kind: WhoWasToldLogKind.SMS,
        status: SmsStatus.Delivered,
        userId: "ana",
        userName: "Ana Lopez",
        isOnCallPage: true,
        createdAt: AT(1),
      }),
      log({
        id: "email-ana",
        userId: "ana",
        userName: "Ana Lopez",
        isOnCallPage: true,
        createdAt: AT(2),
      }),
    ],
  });
}

let get: SpyInstance<typeof WhoWasToldApi.get>;

function renderCard(props?: {
  recordKind?: OnCallTestPageRecordKind;
  isLive?: boolean;
  refreshIntervalInMs?: number;
  refreshToken?: number;
}): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <WhoWasToldCard
        recordKind={props?.recordKind || OnCallTestPageRecordKind.Incident}
        recordId={
          props?.recordKind === OnCallTestPageRecordKind.Alert
            ? ALERT_ID
            : INCIDENT_ID
        }
        isLive={Boolean(props?.isLive)}
        refreshIntervalInMs={props?.refreshIntervalInMs}
        refreshToken={props?.refreshToken}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(PROJECT_ID as never);
  get = jest.spyOn(WhoWasToldApi, "get");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the card's first words", () => {
  test("how many people OneUptime told, who acknowledged it first and how soon after the first page", () => {
    expect(getWhoWasToldSentences(acknowledgedByAna(), translator)).toEqual([
      "OneUptime told 1 person.",
      // The figure held to its unit's word (NumbersKeepTheirUnits).
      `Ana Lopez acknowledged it 3${NO_BREAK_SPACE}minutes after the first page.`,
    ]);
  });

  test("people and channels in one sentence, and the failures counted", () => {
    const result: WhoWasToldResult = answer({
      logs: [
        log({ id: "a", userId: "ana", userName: "Ana Lopez" }),
        log({ id: "b", userId: "ben", userName: "Ben Ito" }),
        log({
          id: "c",
          userId: "cara",
          userName: "Cara Diaz",
          status: MailStatus.Error,
        }),
        log({
          id: "s",
          kind: WhoWasToldLogKind.Workspace,
          status: WorkspaceNotificationStatus.Success,
          workspaceType: WorkspaceType.Slack,
          channelName: "#incidents",
        }),
      ],
    });

    expect(getWhoWasToldSentences(result, translator)).toEqual([
      "OneUptime told 2 people and posted to 1 channel.",
      "1 notification failed.",
    ]);
  });

  test("channels alone", () => {
    expect(
      getWhoWasToldSentences(
        answer({
          logs: [
            log({
              kind: WhoWasToldLogKind.Workspace,
              status: WorkspaceNotificationStatus.Success,
              channelName: "#ops",
              workspaceType: WorkspaceType.Slack,
            }),
          ],
        }),
        translator,
      ),
    ).toEqual(["OneUptime posted to 1 channel."]);
  });

  test("nobody yet, said of an incident or an alert", () => {
    expect(getWhoWasToldSentences(answer({}), translator)).toEqual([
      "Nobody has been told about this incident yet.",
    ]);
    expect(
      getWhoWasToldSentences(
        answer({ recordKind: OnCallTestPageRecordKind.Alert }),
        translator,
      ),
    ).toEqual(["Nobody has been told about this alert yet."]);
  });

  test("what the reader may not read is counted, never named", () => {
    expect(
      getWhoWasToldHiddenSentences(
        { hiddenNotificationCount: 3, hiddenRunCount: 1 },
        translator,
      ),
    ).toEqual([
      "3 notifications aren't listed: you can't open their logs.",
      "1 on-call policy run isn't listed: you can't see its policy.",
    ]);
    expect(
      getWhoWasToldHiddenSentences(
        { hiddenNotificationCount: 0, hiddenRunCount: 0 },
        translator,
      ),
    ).toEqual([]);
  });

  test("in German, every sentence is the locale's own", () => {
    const german: Translator = localeTranslator("de");

    expect(getWhoWasToldSentences(acknowledgedByAna(), german)).toEqual([
      "OneUptime hat 1 Person benachrichtigt.",
      `Ana Lopez hat 3${NO_BREAK_SPACE}Minuten nach der ersten Alarmierung bestätigt.`,
    ]);
    expect(
      getPageThroughWords(german, {
        policyName: "Primary",
        isDirectPage: false,
        levelOrder: 1,
        teamName: "Platform",
      }),
    ).toEqual(["Alarmiert über Primary", "Stufe 1", "Team Platform"]);
  });
});

describe("a failure's reason", () => {
  test("a workspace's refusal is said in OneUptime's words, as the Workspace Logs say it", () => {
    const reason: string | null = getNotificationReason({
      statusMessage: "Error from Slack is_archived",
      status: OnCallTestPageDeliveryStatus.Failed,
      workspaceType: WorkspaceType.Slack,
      channel: OnCallPageChannel.Slack,
    });

    expect(reason).toContain("archived");
    expect(reason).not.toBe("Error from Slack is_archived");
  });

  test("any other is said as its log wrote it", () => {
    expect(
      getNotificationReason({
        statusMessage: "The number is unreachable.",
        status: OnCallTestPageDeliveryStatus.Failed,
        channel: OnCallPageChannel.SMS,
      }),
    ).toBe("The number is unreachable.");
  });
});

describe("the request", () => {
  test("asks for the incident's or the alert's answer by its id", () => {
    expect(
      getWhoWasToldUrl({
        recordKind: OnCallTestPageRecordKind.Incident,
        recordId: INCIDENT_ID,
      }).toString(),
    ).toContain(`/who-was-told/incident/${INCIDENT_ID.toString()}`);
    expect(
      getWhoWasToldUrl({
        recordKind: OnCallTestPageRecordKind.Alert,
        recordId: ALERT_ID,
      }).toString(),
    ).toContain(`/who-was-told/alert/${ALERT_ID.toString()}`);
  });

  test("only an answer of the card's shape is drawn", () => {
    expect(isWhoWasToldResult(answer({}))).toBe(true);
    expect(isWhoWasToldResult({ data: [], count: 0 })).toBe(false);
    expect(isWhoWasToldResult(null)).toBe(false);
    expect(isWhoWasToldResult([])).toBe(false);
    expect(isWhoWasToldResult({ ...answer({}), people: undefined })).toBe(
      false,
    );
  });
});

describe("WhoWasToldCard", () => {
  test("loads in the shape of its rows, then says who was told, one line each", async () => {
    get.mockResolvedValue(acknowledgedByAna());
    renderCard();

    expect(screen.getByTestId("who-was-told-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("who-was-told-summary")).toHaveTextContent(
      "OneUptime told 1 person. Ana Lopez acknowledged it 3 minutes after the first page.",
    );
    expect(screen.getByText("Who Was Told")).toBeInTheDocument();

    const ana: HTMLElement = screen.getByTestId("who-was-told-person");
    expect(ana).toHaveAttribute("data-status", "Acknowledged");
    expect(ana).toHaveTextContent("Ana Lopez");
    expect(ana).toHaveTextContent("Paged by Primary");
    expect(ana).toHaveTextContent("Level 1");
    expect(ana).toHaveTextContent("Team Platform");
    expect(ana).toHaveTextContent("SMS");
    expect(ana).toHaveTextContent("Email");
    expect(get).toHaveBeenCalledWith({
      recordKind: OnCallTestPageRecordKind.Incident,
      recordId: INCIDENT_ID,
    });
  });

  test("each page and notification is folded away until asked for, then listed in order of time", async () => {
    get.mockResolvedValue(acknowledgedByAna());
    renderCard();

    const toggle: HTMLElement = await screen.findByTestId(
      "who-was-told-details-toggle",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Show details");
    expect(
      screen.queryByTestId("who-was-told-details"),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Hide details");
    const details: HTMLElement = screen.getByTestId("who-was-told-details");
    const lines: Array<HTMLElement> = within(details).getAllByRole("listitem");
    expect(
      lines.map((line: HTMLElement): string | null => {
        return line.getAttribute("data-testid");
      }),
    ).toEqual([
      "who-was-told-page",
      "who-was-told-notification",
      "who-was-told-notification",
    ]);
    expect(lines[1]).toHaveAttribute("data-status", "Delivered");
    expect(lines[2]).toHaveAttribute("data-status", "Sent");
  });

  test("a busy incident lists the first people, and the rest one click away", async () => {
    const people: Array<WhoWasToldLogRow> = Array.from(
      { length: 20 },
      (_unused: unknown, index: number): WhoWasToldLogRow => {
        return log({
          id: `p${index}`,
          userId: `user-${index}`,
          userName: `Person ${String(index).padStart(2, "0")}`,
          createdAt: AT(index + 1),
        });
      },
    );
    get.mockResolvedValue(answer({ logs: people }));
    renderCard();

    await screen.findByTestId("who-was-told-summary");
    expect(screen.getAllByTestId("who-was-told-person")).toHaveLength(
      WHO_WAS_TOLD_PEOPLE_SHOWN,
    );
    // In order of time: the first told first.
    expect(screen.getAllByTestId("who-was-told-person")[0]).toHaveTextContent(
      "Person 00",
    );

    const more: HTMLElement = screen.getByTestId("who-was-told-show-more");
    expect(more).toHaveTextContent(
      `Show ${20 - WHO_WAS_TOLD_PEOPLE_SHOWN} more`,
    );
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);

    expect(screen.getAllByTestId("who-was-told-person")).toHaveLength(20);
    expect(more).toHaveTextContent("Show fewer");
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  test("failures: each says why, a workspace's refusal in OneUptime's words, and the first words count them", async () => {
    get.mockResolvedValue(
      answer({
        logs: [
          log({
            id: "sms-cara",
            kind: WhoWasToldLogKind.SMS,
            status: SmsStatus.Undelivered,
            statusMessage: "The carrier could not deliver it.",
            userId: "cara",
            userName: "Cara Diaz",
          }),
          log({
            id: "slack",
            kind: WhoWasToldLogKind.Workspace,
            status: WorkspaceNotificationStatus.Error,
            statusMessage: "Error from Slack is_archived",
            workspaceType: WorkspaceType.Slack,
            channelId: "C1",
            channelName: "#incidents",
          }),
        ],
      }),
    );
    renderCard();

    expect(await screen.findByTestId("who-was-told-summary")).toHaveTextContent(
      "2 notifications failed.",
    );

    const cara: HTMLElement = screen.getByTestId("who-was-told-person");
    expect(cara).toHaveAttribute("data-status", "Failed");
    expect(cara).toHaveTextContent("1 failed");

    fireEvent.click(within(cara).getByTestId("who-was-told-details-toggle"));
    expect(within(cara).getByTestId("who-was-told-reason")).toHaveTextContent(
      "The carrier could not deliver it.",
    );

    const slack: HTMLElement = screen.getByTestId("who-was-told-channel");
    expect(slack).toHaveAttribute("data-status", "Failed");
    expect(slack).toHaveTextContent("#incidents");
    expect(within(slack).getByTestId("who-was-told-reason")).toHaveTextContent(
      "archived",
    );
    expect(slack).not.toHaveTextContent("Error from Slack is_archived");
  });

  test("a person not paged says why, and a target that reached nobody is a row of its own", async () => {
    get.mockResolvedValue(
      answer({
        steps: [
          step({
            userId: "dan",
            userName: "Dan Wu",
            status: OnCallDutyExecutionLogTimelineStatus.Skipped,
            statusMessage: "Dan Wu opted out of pages of this severity.",
          }),
          step({
            id: "gap",
            status: OnCallDutyExecutionLogTimelineStatus.Skipped,
            statusMessage: "Nobody was on call in schedule Night shift.",
            scheduleName: "Night shift",
            levelOrder: 2,
            createdAt: AT(6),
          }),
        ],
      }),
    );
    renderCard();

    const dan: HTMLElement = await screen.findByTestId("who-was-told-person");
    expect(dan).toHaveAttribute("data-status", "Skipped");
    expect(dan).toHaveTextContent("Not paged");
    expect(within(dan).getByTestId("who-was-told-reason")).toHaveTextContent(
      "opted out",
    );

    const gap: HTMLElement = screen.getByTestId("who-was-told-not-paged");
    expect(gap).toHaveTextContent("Night shift");
    expect(gap).toHaveTextContent("Level 2");
    expect(gap).toHaveTextContent("Paged by Primary");
  });

  test("a run that paged nobody yet says why: one waiting for working hours", async () => {
    get.mockResolvedValue(
      answer({
        runs: [
          {
            ...RUN,
            status: OnCallDutyPolicyStatus.Waiting,
            statusMessage: "Waits for working hours.",
          },
        ],
      }),
    );
    renderCard();

    const run: HTMLElement = await screen.findByTestId("who-was-told-run");
    expect(run).toHaveTextContent("Primary");
    expect(run).toHaveTextContent("Waiting");
    expect(screen.getByTestId("who-was-told-summary")).toHaveTextContent(
      "Nobody has been told about this incident yet.",
    );
  });

  test("an incident's status page subscribers are counted, never listed, and why they were not told is said", async () => {
    get.mockResolvedValue(
      answer({
        subscribers: {
          status: StatusPageSubscriberNotificationStatus.Skipped,
          statusMessage:
            "No monitors are attached to this incident. Skipping notifications to subscribers.",
          sentCount: 0,
          failedCount: 0,
          areCountsReadable: true,
        },
      }),
    );
    renderCard();

    const subscribers: HTMLElement = await screen.findByTestId(
      "who-was-told-subscribers",
    );
    expect(subscribers).toHaveTextContent("Status Page Subscribers");
    expect(subscribers).toHaveTextContent("Not notified");
    expect(subscribers).toHaveTextContent("No monitors are attached");
  });

  test("subscribers told: how many notifications went, and how many failed", async () => {
    get.mockResolvedValue(
      answer({
        subscribers: {
          status: StatusPageSubscriberNotificationStatus.Success,
          sentCount: 1204,
          failedCount: 3,
          areCountsReadable: true,
        },
      }),
    );
    renderCard();

    const subscribers: HTMLElement = await screen.findByTestId(
      "who-was-told-subscribers",
    );
    expect(subscribers).toHaveTextContent("Notified");
    expect(subscribers).toHaveTextContent("notifications sent");
    expect(subscribers).toHaveTextContent("3 failed");
  });

  test("an alert has no subscribers' row, and opens its own Notification Logs", async () => {
    get.mockResolvedValue(
      answer({ recordKind: OnCallTestPageRecordKind.Alert }),
    );
    renderCard({ recordKind: OnCallTestPageRecordKind.Alert });

    await screen.findByTestId("who-was-told-summary");
    expect(
      screen.queryByTestId("who-was-told-subscribers"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("who-was-told-logs-link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}/notification-logs`,
    );
    expect(get.mock.calls[0]![0]).toEqual({
      recordKind: OnCallTestPageRecordKind.Alert,
      recordId: ALERT_ID,
    });
  });

  test("an incident opens its own Notification Logs", async () => {
    get.mockResolvedValue(acknowledgedByAna());
    renderCard();

    expect(await screen.findByTestId("who-was-told-logs-link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}/notification-logs`,
    );
  });

  test("what the reader may not read is counted under the list, and a cut list says so", async () => {
    get.mockResolvedValue(
      answer({
        logs: [log({ userId: "ana", userName: "Ana Lopez" })],
        hiddenNotificationCount: 4,
        hiddenRunCount: 2,
        isTruncated: true,
      }),
    );
    renderCard();

    expect(await screen.findByTestId("who-was-told-hidden")).toHaveTextContent(
      "4 notifications aren't listed: you can't open their logs. 2 on-call policy runs aren't listed: you can't see their policies.",
    );
    expect(screen.getByTestId("who-was-told-truncated")).toHaveTextContent(
      "Only the latest notifications are listed.",
    );
  });

  test("a private incident the reader may not see: not found, and nothing about it is drawn", async () => {
    get.mockRejectedValue(new Error("Incident not found."));
    renderCard();

    expect(await screen.findByTestId("who-was-told-error")).toHaveTextContent(
      "Couldn't read who was told.",
    );
    expect(screen.getByTestId("who-was-told-error")).toHaveTextContent(
      "Incident not found.",
    );
    expect(screen.queryByTestId("who-was-told-person")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("who-was-told-summary"),
    ).not.toBeInTheDocument();
  });

  test("Try again reads it again", async () => {
    get.mockRejectedValueOnce(new Error("The server did not answer."));
    get.mockResolvedValue(acknowledgedByAna());
    renderCard();

    fireEvent.click(await screen.findByTestId("who-was-told-try-again"));

    expect(
      await screen.findByTestId("who-was-told-summary"),
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("WhoWasToldCard while the record is open", () => {
  test("reads again on its own while the record is live, and draws what came in", async () => {
    get.mockResolvedValueOnce(answer({}));
    get.mockResolvedValue(acknowledgedByAna());
    renderCard({ isLive: true, refreshIntervalInMs: 40 });

    expect(await screen.findByTestId("who-was-told-summary")).toHaveTextContent(
      "Nobody has been told about this incident yet.",
    );

    await waitFor(() => {
      expect(screen.getByTestId("who-was-told-summary")).toHaveTextContent(
        "OneUptime told 1 person.",
      );
    });
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test("a resolved record is read once, and not again on its own", async () => {
    get.mockResolvedValue(acknowledgedByAna());
    renderCard({ isLive: false, refreshIntervalInMs: 20 });

    await screen.findByTestId("who-was-told-summary");
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 150);
      });
    });

    expect(get).toHaveBeenCalledTimes(1);
  });

  test("nothing is read while the tab is hidden; looking again reads once", async () => {
    get.mockResolvedValue(acknowledgedByAna());
    let visibility: DocumentVisibilityState = "visible";
    jest
      .spyOn(document, "visibilityState", "get")
      .mockImplementation((): DocumentVisibilityState => {
        return visibility;
      });

    renderCard({ isLive: true, refreshIntervalInMs: 20 });
    await screen.findByTestId("who-was-told-summary");

    visibility = "hidden";
    const before: number = get.mock.calls.length;
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 150);
      });
    });
    expect(get.mock.calls.length).toBe(before);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(get.mock.calls.length).toBeGreaterThan(before);
  });

  test("a read again that fails keeps the list on show", async () => {
    get.mockResolvedValueOnce(acknowledgedByAna());
    get.mockRejectedValue(new Error("The gateway answered 502."));
    renderCard({ isLive: true, refreshIntervalInMs: 30 });

    await screen.findByTestId("who-was-told-summary");
    await waitFor(() => {
      expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(screen.getByTestId("who-was-told-person")).toHaveTextContent(
      "Ana Lopez",
    );
    expect(screen.queryByTestId("who-was-told-error")).not.toBeInTheDocument();
  });

  test("the page doing something that tells people reads it again", async () => {
    get.mockResolvedValue(acknowledgedByAna());
    const { rerender } = renderCard({ refreshToken: 1 });

    await screen.findByTestId("who-was-told-summary");
    expect(get).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <WhoWasToldCard
          recordKind={OnCallTestPageRecordKind.Incident}
          recordId={INCIDENT_ID}
          isLive={false}
          refreshToken={2}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2);
    });
  });
});
