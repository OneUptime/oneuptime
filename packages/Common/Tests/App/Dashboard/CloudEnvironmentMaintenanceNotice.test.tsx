import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * WHILE MAINTENANCE HOLDS AN APP PLATFORMS ENVIRONMENT
 * (CloudEnvironmentMaintenanceNotice).
 *
 * A scheduled maintenance event in progress that holds an environment holds
 * the monitors of every app in it: they open no incident or alert until it
 * ends (MonitorMaintenanceSuppression). A team that opens an app's page
 * mid-deploy reads why nothing pages at the top - which event, until when -
 * with the event a click away and the environment's events beside it. The
 * environment's Overview says the same of its apps. Nothing is drawn while
 * nothing holds it, and a read that fails draws nothing either: a notice is
 * not worth an error of its own.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");

const getListMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve(null);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import CloudEnvironmentMaintenanceNotice, {
  CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID,
  CLOUD_ENVIRONMENT_MAINTENANCE_SENTENCES,
  CloudEnvironmentMaintenanceNoticeScope,
  getLongestHoldingEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudEnvironmentMaintenanceNotice";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import ProjectUtil from "../../../UI/Utils/Project";

const ENVIRONMENT_ID: string = "71000000-0000-4000-8000-000000000001";
const EVENT_ID: string = "e0000000-0000-4000-8000-000000000001";
const LATER_EVENT_ID: string = "e0000000-0000-4000-8000-000000000002";

const ONGOING_STATE: string = "44000000-0000-4000-8000-000000000002";
// A state of the project's own, placed between Ongoing and Ended.
const VERIFYING_STATE: string = "44000000-0000-4000-8000-000000000003";

function state(data: {
  id: string;
  name: string;
  order: number;
  flag?: string;
}): ScheduledMaintenanceState {
  const row: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  const record: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  record["_id"] = data.id;
  record["name"] = data.name;
  record["order"] = data.order;

  if (data.flag) {
    record[data.flag] = true;
  }

  return row;
}

// The project's states, as a new project has them, and one of its own.
function projectStates(): Array<ScheduledMaintenanceState> {
  return [
    state({
      id: "44000000-0000-4000-8000-000000000001",
      name: "Scheduled",
      order: 1,
      flag: "isScheduledState",
    }),
    state({
      id: ONGOING_STATE,
      name: "Ongoing",
      order: 2,
      flag: "isOngoingState",
    }),
    state({ id: VERIFYING_STATE, name: "Verifying", order: 3 }),
    state({
      id: "44000000-0000-4000-8000-000000000004",
      name: "Ended",
      order: 4,
      flag: "isEndedState",
    }),
    state({
      id: "44000000-0000-4000-8000-000000000005",
      name: "Completed",
      order: 5,
      flag: "isResolvedState",
    }),
  ];
}

function event(data: {
  id?: string;
  title: string;
  endsAt: Date | null;
}): ScheduledMaintenance {
  const row: ScheduledMaintenance = new ScheduledMaintenance();
  const record: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  record["_id"] = data.id || EVENT_ID;
  record["title"] = data.title;

  if (data.endsAt) {
    record["endsAt"] = data.endsAt;
  }

  return row;
}

const IN_TWO_HOURS: Date = OneUptimeDate.addRemoveHours(
  OneUptimeDate.getCurrentDate(),
  2,
);

let states: Array<ScheduledMaintenanceState> = [];
let events: Array<ScheduledMaintenance> = [];
let failEventsRead: boolean = false;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  getListMock.mockReset();
  ModelListCache.invalidateAll();
  await i18next.changeLanguage("en");

  states = projectStates();
  events = [];
  failEventsRead = false;

  goTo(`/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}`);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  getListMock.mockImplementation((args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;

    if (modelType === ScheduledMaintenanceState) {
      return Promise.resolve({ data: states, count: states.length });
    }

    if (modelType === ScheduledMaintenance) {
      if (failEventsRead) {
        return Promise.reject(new Error("Permission denied."));
      }

      return Promise.resolve({ data: events, count: events.length });
    }

    return Promise.resolve({ data: [], count: 0 });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function eventReads(): Array<Record<string, unknown>> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((args: Record<string, unknown>): boolean => {
      return args["modelType"] === ScheduledMaintenance;
    });
}

function renderNotice(scope: CloudEnvironmentMaintenanceNoticeScope): void {
  render(
    <MemoryRouter>
      <div data-testid="page">
        <CloudEnvironmentMaintenanceNotice
          environmentId={new ObjectID(ENVIRONMENT_ID)}
          scope={scope}
        />
      </div>
    </MemoryRouter>,
  );
}

async function notice(): Promise<HTMLElement> {
  return await screen.findByTestId(
    CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID,
  );
}

const WHITESPACE: RegExp = /\s+/g;

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "").replace(
    WHITESPACE,
    " ",
  );
}

describe("getLongestHoldingEvent", () => {
  test("of several, the one whose end is last: the monitors alert again when it ends", () => {
    const soon: ScheduledMaintenance = event({
      title: "Patch",
      endsAt: IN_TWO_HOURS,
    });
    const later: ScheduledMaintenance = event({
      id: LATER_EVENT_ID,
      title: "Migration",
      endsAt: OneUptimeDate.addRemoveHours(IN_TWO_HOURS, 3),
    });

    expect(getLongestHoldingEvent([soon, later])?.title).toBe("Migration");
    expect(getLongestHoldingEvent([later, soon])?.title).toBe("Migration");
  });

  test("one with no end written holds it longest of all", () => {
    const open: ScheduledMaintenance = event({
      id: LATER_EVENT_ID,
      title: "Open-ended",
      endsAt: null,
    });

    expect(
      getLongestHoldingEvent([
        event({ title: "Patch", endsAt: IN_TWO_HOURS }),
        open,
      ])?.title,
    ).toBe("Open-ended");
    expect(
      getLongestHoldingEvent([
        open,
        event({ title: "Patch", endsAt: IN_TWO_HOURS }),
      ])?.title,
    ).toBe("Open-ended");
  });

  test("none holds nothing", () => {
    expect(getLongestHoldingEvent([])).toBeNull();
  });
});

describe("on an app's page", () => {
  test("names the event that holds its environment and until when, and says its monitors open nothing until then", async () => {
    events = [event({ title: "ECS cluster upgrade", endsAt: IN_TWO_HOURS })];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);

    const banner: HTMLElement = await notice();

    expect(banner).toHaveTextContent("Under maintenance");
    expect(textOf(banner)).toContain(
      `ECS cluster upgrade covers this app's environment until ${OneUptimeDate.getDateAsCompactLocalString(
        IN_TWO_HOURS,
      )}. Until then, the app's monitors open no incidents or alerts.`,
    );

    // The event a click away; the environment's events beside it.
    expect(
      screen.getByRole("link", { name: "ECS cluster upgrade" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/scheduled-maintenance-events/${EVENT_ID}`,
    );
    expect(screen.getByRole("link", { name: "View events" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}/scheduled-maintenance`,
    );
  });

  test("an event past its planned end, still in progress, holds it until it ends", async () => {
    events = [
      event({
        title: "Database failover",
        endsAt: OneUptimeDate.addRemoveHours(
          OneUptimeDate.getCurrentDate(),
          -1,
        ),
      }),
    ];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);

    expect(textOf(await notice())).toContain(
      "Database failover covers this app's environment. Until it ends, the app's monitors open no incidents or alerts.",
    );
  });

  test("is a quiet status, not an alarm: planned work is not an outage", async () => {
    events = [event({ title: "ECS cluster upgrade", endsAt: IN_TWO_HOURS })];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);

    expect(await notice()).toHaveAttribute("role", "status");
  });
});

describe("on the environment's Overview", () => {
  test("says the same of the environment's apps", async () => {
    events = [event({ title: "ECS cluster upgrade", endsAt: IN_TWO_HOURS })];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.Environment);

    expect(textOf(await notice())).toContain(
      `ECS cluster upgrade covers this environment until ${OneUptimeDate.getDateAsCompactLocalString(
        IN_TWO_HOURS,
      )}. Until then, the monitors of its apps open no incidents or alerts.`,
    );
  });

  test("of two events that hold it, names the one that holds it longest", async () => {
    events = [
      event({ title: "Patch", endsAt: IN_TWO_HOURS }),
      event({
        id: LATER_EVENT_ID,
        title: "Migration",
        endsAt: OneUptimeDate.addRemoveHours(IN_TWO_HOURS, 3),
      }),
    ];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.Environment);

    expect(textOf(await notice())).toContain(
      "Migration covers this environment",
    );
    expect(screen.queryByText("Patch")).toBeNull();
  });
});

describe("what it reads", () => {
  test("the events in progress that hold this environment - in the project's ongoing state and its own states before Ended", async () => {
    events = [event({ title: "ECS cluster upgrade", endsAt: IN_TWO_HOURS })];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);
    await notice();

    const read: Record<string, unknown> = eventReads()[0]!;
    const query: Record<string, unknown> = read["query"] as Record<
      string,
      unknown
    >;

    expect(query["projectId"]?.toString()).toBe(PROJECT_ID);
    expect(
      (query["cloudResources"] as Includes).values.map((value: unknown) => {
        return String(value);
      }),
    ).toEqual([ENVIRONMENT_ID]);
    expect(
      (query["currentScheduledMaintenanceStateId"] as Includes).values
        .map((value: unknown) => {
          return String(value);
        })
        .sort(),
    ).toEqual([ONGOING_STATE, VERIFYING_STATE].sort());
  });

  test("draws nothing while nothing holds the environment", async () => {
    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);

    await waitFor(() => {
      expect(eventReads()).toHaveLength(1);
    });

    expect(
      screen.queryByTestId(CLOUD_ENVIRONMENT_MAINTENANCE_NOTICE_TEST_ID),
    ).toBeNull();
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
  });

  test("a project with no state an event is in progress in reads no event", async () => {
    // States not read yet, or a project with none: no state to read events in.
    states = [];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(eventReads()).toEqual([]);
    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
  });

  test("a read that fails draws nothing - no error of its own", async () => {
    failEventsRead = true;

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);

    await waitFor(() => {
      expect(eventReads()).toHaveLength(1);
    });

    expect(screen.getByTestId("page")).toBeEmptyDOMElement();
    expect(screen.queryByText("Permission denied.")).toBeNull();
  });
});

describe("in the reader's language", () => {
  test("German says it in German, with the event's own title", async () => {
    await i18next.changeLanguage("de");
    events = [event({ title: "ECS cluster upgrade", endsAt: IN_TWO_HOURS })];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.App);

    const banner: HTMLElement = await notice();
    const sentence: string =
      CLOUD_ENVIRONMENT_MAINTENANCE_SENTENCES[
        CloudEnvironmentMaintenanceNoticeScope.App
      ].until;

    expect(DE["Under maintenance"]).toBe("In Wartung");
    expect(banner).toHaveTextContent("In Wartung");
    expect(DE[sentence]).toBeTruthy();
    expect(textOf(banner)).toContain(
      "ECS cluster upgrade betrifft die Umgebung dieser App bis",
    );
    expect(textOf(banner)).toContain(
      "Bis dahin eröffnen die Monitore der App keine Vorfälle oder Warnungen.",
    );
    expect(
      screen.getByRole("link", { name: "Ereignisse anzeigen" }),
    ).toBeInTheDocument();
  });

  test("Persian keeps the event's English title whole, in its own isolate", async () => {
    await i18next.changeLanguage("fa");
    events = [event({ title: "ECS cluster upgrade", endsAt: IN_TWO_HOURS })];

    renderNotice(CloudEnvironmentMaintenanceNoticeScope.Environment);

    const banner: HTMLElement = await notice();

    expect(banner).toHaveTextContent(FA["Under maintenance"]!);
    expect(FA["Under maintenance"]).not.toBe("Under maintenance");
    expect(textOf(banner)).toContain("این محیط را در بر می");

    const title: HTMLElement = screen.getByText("ECS cluster upgrade");
    expect(title.tagName).toBe("BDI");
  });
});
