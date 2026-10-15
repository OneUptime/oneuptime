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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A RUNBOOK'S TRIGGERS PAGE: RUN IT ON A SCHEDULE, OR FROM A WEBHOOK.
 *
 * "Can you build an option that can help me execute Runbook with a webhook
 * or on schedule? ... Make the UI easy to understand and simple to use." -
 * the maintainer.
 *
 * Two cards. Schedule: a runbook without one says what one does and offers
 * Set Up Schedule; the dialog picks every few minutes, every few hours,
 * every day, days of the week or a cron expression, on a time zone's clock,
 * and says the schedule in a sentence with its next runs as it changes - or
 * what is wrong with it, before the server is asked. Webhook: one switch,
 * then the URL - masked until shown - with Copy URL, a curl example, what
 * to send, Send Test Request and Reset URL. The URL holds the key that
 * starts runs, so only people who may edit AND run the runbook see it.
 *
 * The real page, cards, dialog, form, Dropdown and switch run; only the
 * network, the clock and the signed-in user's permissions are stubbed. The
 * fake runbook answers with what was last saved, as the server would.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const sessionPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "the-project" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return sessionPostMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return (error as { message?: string })?.message || String(error);
      },
    },
  };
});

import RunbookTriggers from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Triggers";
import {
  RunbookTriggersDocs,
  RunbookTriggersTestIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import {
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
} from "../../../Types/Runbook/RunbookSchedule";
import RunbookTriggerType from "../../../Types/Runbook/RunbookTriggerType";
import {
  RUNBOOK_WEBHOOK_EXAMPLE_BODY,
  RUNBOOK_WEBHOOK_SECRET_MASK,
  getRunbookWebhookUrl,
} from "../../../Types/Runbook/RunbookWebhook";
import Timezone from "../../../Types/Timezone";
import { RUNBOOK_URL } from "../../../UI/Config";
import Clipboard from "../../../UI/Utils/Clipboard";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import PlainAPI from "../../../Utils/API";

const PROJECT_ID: ObjectID = new ObjectID(
  "7c1e5a90-2b44-4f1d-9a63-5e0c2d9b1a01",
);
const RUNBOOK_ID: string = "7c1e5a90-2b44-4f1d-9a63-5e0c2d9b1a02";
const LAST_RUN_ID: string = "7c1e5a90-2b44-4f1d-9a63-5e0c2d9b1a03";
const TEST_RUN_ID: string = "7c1e5a90-2b44-4f1d-9a63-5e0c2d9b1a04";
const FIRST_KEY: string = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
const SECOND_KEY: string = "ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210-_wxyz";

// Thursday 15 October 2026, 07:00 in London (BST).
const NOW: Date = new Date("2026-10-15T06:00:00.000Z");

interface StoredRunbook {
  isEnabled: boolean;
  steps: Array<JSONObject>;
  isScheduleEnabled: boolean;
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  scheduleOverlapPolicy: RunbookScheduleOverlapPolicy | null;
  scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy | null;
  scheduleNextRunAt: Date | null;
  scheduleQueuedRunAt: Date | null;
  isWebhookEnabled: boolean;
}

let stored: StoredRunbook;
let storedKey: string | null;
let lastScheduledRun: RunbookExecution | null;
let keyRefusal: HTTPErrorResponse | null;
let webhookAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let copied: Array<string>;

const plainPostMock: MockFunction = getJestMockFunction();

const EDIT_AND_RUN: Array<Permission> = [Permission.ProjectOwner];
const EDIT_ONLY: Array<Permission> = [Permission.EditRunbook];
const RUN_ONLY: Array<Permission> = [Permission.RunbookMember];

function grant(permissions: Array<Permission>): void {
  getJestSpyOn(User, "isMasterAdmin").mockReturnValue(false);

  const all: Array<Permission> = [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectUser,
    ...permissions,
  ];

  getJestSpyOn(PermissionUtil, "getAllPermissions").mockReturnValue(all);
  getJestSpyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  getJestSpyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    permissions: all.map((permission: Permission) => {
      return {
        permission,
        labelIds: [],
        isBlockPermission: false,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function readRunbook(): Runbook {
  const runbook: Runbook = new Runbook();
  runbook._id = RUNBOOK_ID;
  runbook.isEnabled = stored.isEnabled;
  runbook.steps = stored.steps;
  runbook.isScheduleEnabled = stored.isScheduleEnabled;
  runbook.isWebhookEnabled = stored.isWebhookEnabled;

  if (stored.scheduleCron) {
    runbook.scheduleCron = stored.scheduleCron;
  }

  if (stored.scheduleTimezone) {
    runbook.scheduleTimezone = stored.scheduleTimezone;
  }

  if (stored.scheduleOverlapPolicy) {
    runbook.scheduleOverlapPolicy = stored.scheduleOverlapPolicy;
  }

  if (stored.scheduleMissedRunPolicy) {
    runbook.scheduleMissedRunPolicy = stored.scheduleMissedRunPolicy;
  }

  if (stored.scheduleQueuedRunAt) {
    runbook.scheduleQueuedRunAt = stored.scheduleQueuedRunAt;
  }

  return runbook;
}

beforeEach(() => {
  stored = {
    isEnabled: true,
    steps: [{ id: "step-1", title: "Restart the service" }],
    isScheduleEnabled: false,
    scheduleCron: null,
    scheduleTimezone: null,
    scheduleOverlapPolicy: null,
    scheduleMissedRunPolicy: null,
    scheduleNextRunAt: null,
    scheduleQueuedRunAt: null,
    isWebhookEnabled: false,
  };
  storedKey = null;
  lastScheduledRun = null;
  keyRefusal = null;
  copied = [];
  webhookAnswer = new HTTPResponse<JSONObject>(
    200,
    { runbookExecutionId: TEST_RUN_ID, status: "Scheduled" },
    {},
  );

  PermissionGate.clearPermissionPropsCache();
  grant(EDIT_AND_RUN);

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(RUNBOOK_ID),
  );
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  getJestSpyOn(OneUptimeDate, "getCurrentTimezone").mockReturnValue(
    "Europe/London" as Timezone,
  );
  getJestSpyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(
    false,
  );
  getJestSpyOn(Clipboard, "copyToClipboard").mockImplementation(
    async (text: string): Promise<boolean> => {
      copied.push(text);
      return true;
    },
  );

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<Runbook> => {
    return readRunbook();
  });

  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return {
      data: lastScheduledRun ? [lastScheduledRun] : [],
      count: lastScheduledRun ? 1 : 0,
      skip: 0,
      limit: 1,
    };
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const data: Record<string, unknown> = (
        options as { data: Record<string, unknown> }
      ).data;

      Object.assign(stored, data);

      // The server gives the runbook its key the first time the webhook is on.
      if (data["isWebhookEnabled"] === true && !storedKey) {
        storedKey = FIRST_KEY;
      }

      return {};
    },
  );

  sessionPostMock.mockReset();
  sessionPostMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const url: string = (options as { url: URL }).url.toString();

      if (keyRefusal) {
        return keyRefusal;
      }

      if (url.endsWith(`/webhook-secret/${RUNBOOK_ID}/reset`)) {
        storedKey = SECOND_KEY;
        return new HTTPResponse<JSONObject>(200, { secretKey: storedKey }, {});
      }

      if (url.endsWith(`/webhook-secret/${RUNBOOK_ID}`)) {
        return new HTTPResponse<JSONObject>(
          200,
          { secretKey: storedKey, isWebhookEnabled: stored.isWebhookEnabled },
          {},
        );
      }

      throw new Error(`Unexpected session POST to ${url}`);
    },
  );

  plainPostMock.mockReset();
  plainPostMock.mockImplementation(async (): Promise<unknown> => {
    return webhookAnswer;
  });
  getJestSpyOn(PlainAPI, "post").mockImplementation(
    (...args: Array<unknown>): Promise<never> => {
      return plainPostMock(...args) as Promise<never>;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 12; i++) {
      await Promise.resolve();
    }
  });
}

async function openPage(): Promise<void> {
  render(
    <MemoryRouter>
      <RunbookTriggers
        pageRoute={new Route("/dashboard/runbooks/triggers")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
  await flush();
  await waitFor(() => {
    expect(
      within(scheduleCard()).queryByRole("progressbar"),
    ).not.toBeInTheDocument();
  });
}

function scheduleCard(): HTMLElement {
  return screen.getByTestId(RunbookTriggersTestIds.scheduleCard);
}

function webhookCard(): HTMLElement {
  return screen.getByTestId(RunbookTriggersTestIds.webhookCard);
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function webhookUrl(key: string): string {
  return getRunbookWebhookUrl({
    runbookServiceUrl: RUNBOOK_URL.toString(),
    runbookId: RUNBOOK_ID,
    secretKey: key,
  });
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCalls(): Array<UpdateCall> {
  return updateByIdMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as UpdateCall;
  });
}

function preview(): HTMLElement {
  return screen.getByTestId(RunbookTriggersTestIds.schedulePreview);
}

function repeatCombobox(): HTMLElement {
  return within(dialog()).getByRole("combobox", { name: "Repeat" });
}

async function pickRepeat(label: string): Promise<void> {
  fireEvent.keyDown(repeatCombobox(), { key: "ArrowDown", code: "ArrowDown" });
  const option: HTMLElement = screen.getByRole("option", { name: label });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await flush();
}

async function saveDialog(): Promise<void> {
  fireEvent.click(
    within(dialog()).getByRole("button", { name: "Save Schedule" }),
  );
  await flush();
}

describe("the Schedule card of a runbook with no schedule", () => {
  test("says what a schedule does, links the docs and offers Set Up Schedule", async () => {
    await openPage();

    const empty: HTMLElement = screen.getByTestId(
      RunbookTriggersTestIds.scheduleEmpty,
    );
    expect(within(empty).getByText("No schedule yet")).toBeInTheDocument();
    expect(
      within(empty).getByText(
        "Run it every few minutes, every day, or on the days of the week you pick.",
        { exact: false },
      ),
    ).toBeInTheDocument();

    const docs: HTMLElement = within(empty).getByRole("link", {
      name: "How schedules work",
    });
    expect(docs).toHaveAttribute("href", RunbookTriggersDocs.schedule);
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", "noopener noreferrer");

    expect(
      within(empty).getByRole("button", { name: "Set Up Schedule" }),
    ).toBeEnabled();
    // Nothing to switch before there is a schedule.
    expect(
      screen.queryByTestId(RunbookTriggersTestIds.scheduleSwitch),
    ).not.toBeInTheDocument();
  });

  test("Set Up Schedule starts at every weekday at 09:00 on the browser's clock, and says so with the next runs", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();

    expect(
      within(dialog()).getByRole("heading", { name: "Set Up Schedule" }),
    ).toBeInTheDocument();
    expect(preview()).toHaveAttribute("data-state", "ok");
    expect(
      within(preview()).getByText("Runs every weekday at 09:00"),
    ).toBeInTheDocument();

    const runs: Array<string> = within(
      within(preview()).getByTestId(RunbookTriggersTestIds.nextRuns),
    )
      .getAllByRole("listitem")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });

    expect(runs).toHaveLength(3);
    // On the zone's clock, with how far off each is; no year this year.
    expect(runs[0]).toBe("Thu, Oct 15, 09:00 BSTin 2 hours");
    expect(runs[1]).toBe("Fri, Oct 16, 09:00 BSTin 1 day");
    expect(runs[2]).toBe("Mon, Oct 19, 09:00 BSTin 4 days");

    // The day buttons say which days are picked.
    expect(
      screen.getByTestId(`${RunbookTriggersTestIds.scheduleField}-day-1`),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByTestId(`${RunbookTriggersTestIds.scheduleField}-day-0`),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("saving the first schedule writes its cron, zone and policies, and turns it on", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();
    await saveDialog();

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.modelType).toBe(Runbook);
    expect(updateCalls()[0]!.id.toString()).toBe(RUNBOOK_ID);
    expect(updateCalls()[0]!.data).toEqual({
      scheduleCron: "0 9 * * 1,2,3,4,5",
      scheduleTimezone: "Europe/London",
      scheduleOverlapPolicy: RunbookScheduleOverlapPolicy.Skip,
      scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy.RunOnce,
      isScheduleEnabled: true,
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const theSwitch: HTMLElement = screen.getByTestId(
      RunbookTriggersTestIds.scheduleSwitch,
    );
    expect(theSwitch).toHaveAttribute("aria-checked", "true");
    expect(
      within(scheduleCard()).getByText(
        "Runs every weekday at 09:00 · Europe/London",
      ),
    ).toBeInTheDocument();
  });

  test("the day buttons read the whole day's name", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();

    expect(
      within(dialog()).getByRole("button", { name: "Monday", pressed: true }),
    ).toHaveTextContent("Mon");
    expect(
      within(dialog()).getByRole("button", { name: "Sunday", pressed: false }),
    ).toHaveTextContent("Sun");
  });

  test("a problem is said under the schedule, and the next runs under the time zone they are read in", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();

    const timezone: HTMLElement = within(dialog()).getByRole("combobox", {
      name: "Time zone",
    });
    const follows: (element: HTMLElement) => boolean = (
      element: HTMLElement,
    ): boolean => {
      return Boolean(
        timezone.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    };

    expect(preview()).toHaveAttribute("data-state", "ok");
    expect(follows(preview())).toBe(true);

    for (const day of [1, 2, 3, 4, 5]) {
      fireEvent.click(
        screen.getByTestId(
          `${RunbookTriggersTestIds.scheduleField}-day-${day}`,
        ),
      );
    }
    await flush();

    // One answer at a time: the problem, under the days, before the zone.
    expect(
      screen.getAllByTestId(RunbookTriggersTestIds.schedulePreview),
    ).toHaveLength(1);
    expect(preview()).toHaveAttribute("data-state", "error");
    expect(follows(preview())).toBe(false);
    expect(
      within(dialog()).queryByTestId(RunbookTriggersTestIds.nextRuns),
    ).not.toBeInTheDocument();
  });

  test("days are picked by pressing them, with Weekdays and Every day as shortcuts", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();

    // Monday off, Saturday on.
    fireEvent.click(
      screen.getByTestId(`${RunbookTriggersTestIds.scheduleField}-day-1`),
    );
    fireEvent.click(
      screen.getByTestId(`${RunbookTriggersTestIds.scheduleField}-day-6`),
    );
    await flush();

    expect(
      within(preview()).getByText(
        "Runs every Tuesday, Wednesday, Thursday, Friday and Saturday at 09:00",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(`${RunbookTriggersTestIds.scheduleField}-every-day`),
    );
    await flush();
    expect(
      within(preview()).getByText("Runs every day at 09:00"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(`${RunbookTriggersTestIds.scheduleField}-weekdays`),
    );
    await flush();
    expect(
      within(preview()).getByText("Runs every weekday at 09:00"),
    ).toBeInTheDocument();
  });

  test("no day picked is said at once and refused before the server is asked", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();

    for (const day of [1, 2, 3, 4, 5]) {
      fireEvent.click(
        screen.getByTestId(
          `${RunbookTriggersTestIds.scheduleField}-day-${day}`,
        ),
      );
    }
    await flush();

    expect(preview()).toHaveAttribute("data-state", "error");
    expect(within(preview()).getByRole("alert")).toHaveTextContent(
      "Pick at least one day.",
    );

    await saveDialog();

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("a cron expression starts from the schedule picked so far, and a wrong one is explained", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();
    await pickRepeat("Custom (cron expression)");

    const cron: HTMLInputElement = screen.getByTestId(
      `${RunbookTriggersTestIds.scheduleField}-cron`,
    ) as HTMLInputElement;
    expect(cron.value).toBe("0 9 * * 1,2,3,4,5");

    // The hint's example is code, in one piece that never breaks after "0".
    const hint: HTMLElement = within(dialog()).getByText(
      (_content: string, element: Element | null): boolean => {
        return (
          element?.tagName === "P" &&
          (element.textContent || "").startsWith("Five fields:")
        );
      },
    );
    expect(hint).toHaveTextContent(
      "Five fields: minute, hour, day of month, month and day of week. For example, 0 9 * * 1-5 runs at 09:00 on weekdays.",
    );
    const example: HTMLElement = hint.querySelector("code") as HTMLElement;
    expect(example).toHaveTextContent("0 9 * * 1-5");
    expect(example).toHaveClass("whitespace-nowrap");
    expect(
      within(preview()).getByText(
        "Runs on the cron schedule 0 9 * * 1,2,3,4,5",
      ),
    ).toBeInTheDocument();

    fireEvent.change(cron, { target: { value: "0 9 * *" } });
    await flush();

    expect(within(preview()).getByRole("alert")).toHaveTextContent(
      "A runbook schedule has five fields - minute, hour, day of month, month and day of week - and this one has 4.",
    );

    fireEvent.change(cron, { target: { value: "0 0 31 2 *" } });
    await flush();
    expect(within(preview()).getByRole("alert")).toHaveTextContent(
      "This schedule never runs: no date matches it, such as the 31st of February.",
    );

    await saveDialog();
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.change(cron, { target: { value: "30 2 1 * *" } });
    await flush();
    await saveDialog();

    expect(updateCalls()[0]!.data["scheduleCron"]).toBe("30 2 1 * *");
  });

  test("every few minutes offers its own steps", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Set Up Schedule" }));
    await flush();
    await pickRepeat("Every few minutes");

    expect(
      within(preview()).getByText("Runs every 15 minutes"),
    ).toBeInTheDocument();

    await saveDialog();
    expect(updateCalls()[0]!.data["scheduleCron"]).toBe("*/15 * * * *");
  });

  test("someone who may edit the runbook but not run it is told why they cannot set one up", async () => {
    grant(EDIT_ONLY);
    await openPage();

    const button: HTMLElement = screen.getByRole("button", {
      name: "Set Up Schedule",
    });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    await flush();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("someone who may run the runbook but not edit it cannot set one up either", async () => {
    grant(RUN_ONLY);
    await openPage();

    expect(
      screen.getByRole("button", { name: "Set Up Schedule" }),
    ).toBeDisabled();
  });
});

describe("the Schedule card of a runbook with a schedule", () => {
  beforeEach(() => {
    stored.isScheduleEnabled = true;
    stored.scheduleCron = "*/15 * * * *";
    stored.scheduleTimezone = "UTC";
    stored.scheduleOverlapPolicy = RunbookScheduleOverlapPolicy.RunAfter;
    stored.scheduleMissedRunPolicy = RunbookScheduleMissedRunPolicy.Skip;
  });

  test("shows the schedule in a sentence, its next runs, what it does when busy or behind, and the last run it started", async () => {
    const run: RunbookExecution = new RunbookExecution();
    run._id = LAST_RUN_ID;
    run.status = RunbookExecutionStatus.Completed;
    run.createdAt = new Date("2026-10-15T05:45:00.000Z");
    lastScheduledRun = run;

    await openPage();

    expect(
      screen.getByTestId(RunbookTriggersTestIds.scheduleSwitch),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(scheduleCard()).getByText("Runs every 15 minutes · UTC"),
    ).toBeInTheDocument();

    const runs: Array<string> = within(
      within(scheduleCard()).getByTestId(RunbookTriggersTestIds.nextRuns),
    )
      .getAllByRole("listitem")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });
    expect(runs[0]).toContain("Thu, Oct 15, 06:15 UTC");
    expect(runs[1]).toContain("06:30 UTC");

    const details: HTMLElement = screen.getByTestId(
      RunbookTriggersTestIds.scheduleDetails,
    );
    expect(within(details).getByText("Run after it ends")).toBeInTheDocument();
    expect(
      within(details).getByText("Skip the missed times"),
    ).toBeInTheDocument();
    const lastRunPart: HTMLElement = within(details).getByTestId(
      `${RunbookTriggersTestIds.scheduleDetails}-last-run`,
    );
    expect(within(lastRunPart).getByText("Last scheduled run")).toBeVisible();
    expect(within(lastRunPart).getByText("Completed")).toBeInTheDocument();
    // 05:45 UTC, on the schedule's clock (UTC), as its next runs are.
    expect(
      within(lastRunPart).getByText("Thu, Oct 15, 05:45 UTC"),
    ).toHaveAttribute("datetime", "2026-10-15T05:45:00.000Z");
    expect(
      within(details).getByRole("link", { name: "View run" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/executions/${LAST_RUN_ID}`,
    );

    // The last run is read by what started it.
    const query: JSONObject = (
      getListMock.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect(query["triggerType"]).toBe(RunbookTriggerType.Schedule);
  });

  test("turning it off saves only the switch, and the card says it is paused", async () => {
    await openPage();

    fireEvent.click(screen.getByTestId(RunbookTriggersTestIds.scheduleSwitch));
    await flush();

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.data).toEqual({ isScheduleEnabled: false });
    expect(
      within(scheduleCard()).getByTestId(
        `${RunbookTriggersTestIds.scheduleDetails}-paused`,
      ),
    ).toHaveTextContent(
      "Paused. Nothing runs on this schedule until you turn it on.",
    );
    expect(
      within(scheduleCard()).queryByTestId(RunbookTriggersTestIds.nextRuns),
    ).not.toBeInTheDocument();
    // A paused schedule keeps its times, and the card still says them.
    expect(
      within(scheduleCard()).getByText("Runs every 15 minutes · UTC"),
    ).toBeInTheDocument();
  });

  test("a schedule saved paused says what it is, and that it is paused", async () => {
    stored.isScheduleEnabled = false;
    await openPage();

    expect(
      screen.getByTestId(RunbookTriggersTestIds.scheduleSwitch),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      within(scheduleCard()).getByText("Runs every 15 minutes · UTC"),
    ).toBeInTheDocument();
    expect(
      within(scheduleCard()).getByTestId(
        `${RunbookTriggersTestIds.scheduleDetails}-paused`,
      ),
    ).toBeInTheDocument();
    expect(
      within(scheduleCard()).queryByTestId(RunbookTriggersTestIds.nextRuns),
    ).not.toBeInTheDocument();
  });

  test("what it does when busy or behind is a quieter list under the runs", async () => {
    await openPage();

    const policies: HTMLElement = within(scheduleCard()).getByTestId(
      `${RunbookTriggersTestIds.scheduleDetails}-policies`,
    );
    expect(
      Array.from(policies.querySelectorAll("dt, dd")).map(
        (element: Element): string => {
          return element.textContent || "";
        },
      ),
    ).toEqual([
      "If a run is still going",
      "Run after it ends",
      "If OneUptime missed a time",
      "Skip the missed times",
    ]);
  });

  test("Edit Schedule opens the dialog on the saved schedule, and a save keeps the switch as it is", async () => {
    await openPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Schedule" }));
    await flush();

    expect(
      within(dialog()).getByRole("heading", { name: "Edit Schedule" }),
    ).toBeInTheDocument();
    expect(
      within(preview()).getByText("Runs every 15 minutes"),
    ).toBeInTheDocument();

    await saveDialog();

    expect(updateCalls()[0]!.data).toEqual({
      scheduleCron: "*/15 * * * *",
      scheduleTimezone: "UTC",
      scheduleOverlapPolicy: RunbookScheduleOverlapPolicy.RunAfter,
      scheduleMissedRunPolicy: RunbookScheduleMissedRunPolicy.Skip,
    });
  });

  test("a turned-off runbook, or one with no steps, is said to start nothing, with a link to fix it", async () => {
    stored.isEnabled = false;
    await openPage();

    let note: HTMLElement = within(scheduleCard()).getByTestId(
      RunbookTriggersTestIds.note,
    );
    expect(note).toHaveTextContent(
      "This runbook is turned off, so its schedule starts nothing. Turn it on under Settings.",
    );
    expect(
      within(note).getByRole("link", { name: "Settings" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/settings`,
    );
    // Its times start nothing, so none is listed as if it would run.
    expect(
      within(scheduleCard()).queryByTestId(RunbookTriggersTestIds.nextRuns),
    ).not.toBeInTheDocument();

    cleanup();
    stored.isEnabled = true;
    stored.steps = [];
    await openPage();

    note = within(scheduleCard()).getByTestId(RunbookTriggersTestIds.note);
    expect(note).toHaveTextContent(
      "This runbook has no steps yet, so its schedule starts nothing. Add steps under Steps.",
    );
    expect(within(note).getByRole("link", { name: "Steps" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/steps`,
    );
    expect(
      within(scheduleCard()).queryByTestId(RunbookTriggersTestIds.nextRuns),
    ).not.toBeInTheDocument();
  });

  test("a run waiting for the one before it is said", async () => {
    stored.scheduleQueuedRunAt = new Date("2026-10-15T06:00:00.000Z");
    await openPage();

    expect(
      within(scheduleCard()).getByText(
        "A scheduled run is waiting for the run in progress to end.",
      ),
    ).toBeInTheDocument();
  });

  test("someone who may not run the runbook can turn a schedule off but not on, nor edit it", async () => {
    grant(EDIT_ONLY);
    await openPage();

    const edit: HTMLElement = screen.getByRole("button", {
      name: "Edit Schedule",
    });
    expect(edit).toBeDisabled();
    // An outline button keeps its colours when disabled: this one is dimmed.
    expect(edit).toHaveClass("opacity-50");
    const theSwitch: HTMLElement = screen.getByTestId(
      RunbookTriggersTestIds.scheduleSwitch,
    );
    expect(theSwitch).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(theSwitch);
    await flush();
    expect(updateCalls()[0]!.data).toEqual({ isScheduleEnabled: false });

    // Off now: turning it back on would start runs, so it is locked.
    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.scheduleSwitch),
      ).toHaveAttribute("aria-disabled", "true");
    });
  });
});

describe("the Webhook card", () => {
  test("off: one switch saying what turning it on gives, and no URL", async () => {
    await openPage();

    const theSwitch: HTMLElement = screen.getByRole("switch", {
      name: "Run when this URL is called",
    });
    expect(theSwitch).toHaveAttribute("aria-checked", "false");
    expect(
      within(webhookCard()).getByText(
        "Turn it on to get a URL that starts this runbook.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(RunbookTriggersTestIds.webhookUrl),
    ).not.toBeInTheDocument();
    expect(sessionPostMock).not.toHaveBeenCalled();
  });

  test("turning it on saves the switch, then shows the URL the server made - masked until asked for", async () => {
    await openPage();

    fireEvent.click(screen.getByTestId(RunbookTriggersTestIds.webhookSwitch));
    await flush();

    expect(updateCalls()[0]!.data).toEqual({ isWebhookEnabled: true });

    // The key is read once the server has the webhook on, with the session.
    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookUrl),
      ).toBeInTheDocument();
    });
    const keyRead: { url: URL; headers: Record<string, string> } =
      sessionPostMock.mock.calls[0]![0] as {
        url: URL;
        headers: Record<string, string>;
      };
    expect(keyRead.url.toString()).toBe(
      `${RUNBOOK_URL.toString()}/webhook-secret/${RUNBOOK_ID}`,
    );
    expect(keyRead.headers).toEqual({ tenantid: "the-project" });

    const shown: HTMLElement = screen.getByTestId(
      RunbookTriggersTestIds.webhookUrl,
    );
    expect(shown).toHaveAttribute("data-url-shown", "false");
    expect(shown.textContent).not.toContain(FIRST_KEY);
    expect(shown.textContent).toContain(RUNBOOK_WEBHOOK_SECRET_MASK);
    expect(
      screen.getByTestId(RunbookTriggersTestIds.webhookCurl).textContent,
    ).not.toContain(FIRST_KEY);

    fireEvent.click(
      screen.getByTestId(RunbookTriggersTestIds.webhookVisibility),
    );
    await flush();

    expect(shown).toHaveAttribute("data-url-shown", "true");
    expect(shown.textContent).toBe(webhookUrl(FIRST_KEY));
    expect(
      screen.getByTestId(RunbookTriggersTestIds.webhookCurl).textContent,
    ).toContain(webhookUrl(FIRST_KEY));
  });

  test("Copy URL copies the whole URL even while it is masked", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookUrl),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      within(webhookCard()).getByRole("button", {
        name: "Copy the webhook URL",
      }),
    );
    await flush();
    expect(copied).toEqual([webhookUrl(FIRST_KEY)]);

    fireEvent.click(
      within(webhookCard()).getByRole("button", {
        name: "Copy the example request",
      }),
    );
    await flush();
    expect(copied[1]).toContain(`curl -X POST "${webhookUrl(FIRST_KEY)}"`);
  });

  test("says what to send and how the steps read it, with the docs", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookUrl),
      ).toBeInTheDocument();
    });

    expect(
      within(webhookCard()).getByText("Values you send"),
    ).toBeInTheDocument();
    expect(
      within(webhookCard()).getByText('"$ONEUPTIME_INPUT_HOST"'),
    ).toBeInTheDocument();
    expect(
      within(webhookCard()).getByText("args.inputs.host"),
    ).toBeInTheDocument();
    expect(
      within(webhookCard()).getByRole("link", { name: "How to call it" }),
    ).toHaveAttribute("href", RunbookTriggersDocs.webhook);
  });

  test("Reset URL asks first, then shows the new URL and says the old one stopped working", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookUrl),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(RunbookTriggersTestIds.webhookReset));
    await flush();

    expect(
      within(dialog()).getByText(
        "The runbook gets a new URL, and the current one stops working at once. Anything that still calls it will fail until you give it the new URL.",
      ),
    ).toBeInTheDocument();
    // Nothing was reset by asking.
    expect(
      sessionPostMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as { url: URL }).url.toString().endsWith("/reset");
      }),
    ).toHaveLength(0);

    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Reset URL" }),
    );
    await flush();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId(RunbookTriggersTestIds.webhookResetDone),
    ).toHaveTextContent(
      "URL reset. The old one no longer works, so copy this one into anything that should start the runbook.",
    );

    fireEvent.click(
      screen.getByTestId(RunbookTriggersTestIds.webhookVisibility),
    );
    await flush();
    expect(
      screen.getByTestId(RunbookTriggersTestIds.webhookUrl).textContent,
    ).toBe(webhookUrl(SECOND_KEY));
  });

  test("Send Test Request posts the body to the URL as another tool would, and links the run it started", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookTest),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(RunbookTriggersTestIds.webhookTest));
    await flush();

    const body: HTMLTextAreaElement = within(dialog()).getByRole("textbox", {
      name: /Request body/,
    }) as HTMLTextAreaElement;
    expect(JSON.parse(body.value)).toEqual(
      JSON.parse(RUNBOOK_WEBHOOK_EXAMPLE_BODY),
    );

    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Send Request" }),
    );
    await flush();

    expect(plainPostMock).toHaveBeenCalledTimes(1);
    const call: { url: URL; data: JSONObject; headers: JSONObject } =
      plainPostMock.mock.calls[0]![0] as {
        url: URL;
        data: JSONObject;
        headers: JSONObject;
      };
    expect(call.url.toString()).toBe(webhookUrl(FIRST_KEY));
    expect(call.data).toEqual(JSON.parse(RUNBOOK_WEBHOOK_EXAMPLE_BODY));
    // No session: the webhook is called as anyone else would call it.
    expect(call.headers).toEqual({});
    // And not through the dashboard's session client.
    expect(
      sessionPostMock.mock.calls.some((args: Array<unknown>): boolean => {
        return (args[0] as { url: URL }).url.toString().includes("/webhook/");
      }),
    ).toBe(false);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const result: HTMLElement = screen.getByTestId(
      RunbookTriggersTestIds.webhookTestResult,
    );
    expect(result).toHaveTextContent("The webhook started a run.");
    // Right above the row with Send Test Request, where the eye is.
    expect(
      within(result.nextElementSibling as HTMLElement).getByTestId(
        RunbookTriggersTestIds.webhookTest,
      ),
    ).toBeInTheDocument();
    expect(
      within(result).getByRole("link", { name: "View the run" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/executions/${TEST_RUN_ID}`,
    );
  });

  test("a refused test request is shown in the dialog, without leaving the page", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    webhookAnswer = new HTTPErrorResponse(
      403,
      {
        message:
          "This runbook is turned off, so its webhook starts nothing. Turn the runbook on to run it.",
      },
      {},
    );
    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookTest),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(RunbookTriggersTestIds.webhookTest));
    await flush();
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Send Request" }),
    );
    await flush();

    await waitFor(() => {
      expect(dialog()).toHaveTextContent(
        "This runbook is turned off, so its webhook starts nothing.",
      );
    });
    expect(
      screen.queryByTestId(RunbookTriggersTestIds.webhookTestResult),
    ).not.toBeInTheDocument();
  });

  test("a test body that is not a JSON object is refused before anything is sent", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookTest),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(RunbookTriggersTestIds.webhookTest));
    await flush();

    const body: HTMLElement = within(dialog()).getByRole("textbox", {
      name: /Request body/,
    });
    fireEvent.change(body, { target: { value: '["web-1"]' } });
    fireEvent.blur(body);
    await flush();
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Send Request" }),
    );
    await flush();

    // Said where the body is written, once the editor has read it.
    await waitFor(() => {
      expect(dialog()).toHaveTextContent(
        'Write the body as a JSON object, such as {"host": "web-1"}.',
      );
    });
    expect(plainPostMock).not.toHaveBeenCalled();
  });

  test("the URL stays hidden from someone who may not run the runbook, and is never fetched", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    grant(EDIT_ONLY);
    await openPage();

    expect(
      screen.getByTestId(RunbookTriggersTestIds.webhookHidden),
    ).toHaveTextContent(
      "The webhook URL holds this runbook's secret key, so only people who may edit and run this runbook can see it. Ask one of them for it.",
    );
    expect(sessionPostMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(RunbookTriggersTestIds.webhookUrl),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(RunbookTriggersTestIds.webhookTest),
    ).not.toBeInTheDocument();
  });

  test("a refusal the dashboard could not foresee (labels, team blocks) hides the URL the same way", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    keyRefusal = new HTTPErrorResponse(
      422,
      {
        message:
          "You do not have permission to see this runbook's webhook URL.",
      },
      {},
    );
    await openPage();

    await waitFor(() => {
      expect(
        screen.getByTestId(RunbookTriggersTestIds.webhookHidden),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(RunbookTriggersTestIds.webhookUrl),
    ).not.toBeInTheDocument();
  });

  test("a turned-off runbook, or one with no steps, is said to refuse calls", async () => {
    stored.isWebhookEnabled = true;
    storedKey = FIRST_KEY;
    stored.isEnabled = false;
    await openPage();

    let note: HTMLElement = within(webhookCard()).getByTestId(
      RunbookTriggersTestIds.note,
    );
    expect(note).toHaveTextContent(
      "This runbook is turned off, so calls to this URL are refused. Turn it on under Settings.",
    );
    expect(
      within(note).getByRole("link", { name: "Settings" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/settings`,
    );

    cleanup();
    stored.isEnabled = true;
    stored.steps = [];
    await openPage();

    note = within(webhookCard()).getByTestId(RunbookTriggersTestIds.note);
    expect(note).toHaveTextContent(
      "This runbook has no steps yet, so calls to this URL are refused. Add steps under Steps.",
    );
    expect(within(note).getByRole("link", { name: "Steps" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/steps`,
    );
  });

  test("someone who may not run the runbook cannot turn the webhook on", async () => {
    grant(EDIT_ONLY);
    await openPage();

    expect(
      screen.getByTestId(RunbookTriggersTestIds.webhookSwitch),
    ).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByTestId(RunbookTriggersTestIds.webhookSwitch));
    await flush();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});
