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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * "During Incidents", on a monitor's Settings page (issue #11141): one
 * switch, "Keep monitoring during incidents", that saves when flipped. Off
 * by default, as every monitor always was: an incident someone declares on
 * the monitor pauses its checks until it is resolved. On, they keep running
 * - what an Incoming Request monitor that other systems post alerts to
 * needs, so no event goes unevaluated while an incident is open. Off, a
 * monitor whose results come from outside says what arrives meanwhile is
 * listed in its Logs. A manual monitor runs no checks, so it has no card.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import KeepMonitoringDuringIncidentsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/KeepMonitoringDuringIncidentsCard";
import KeepMonitoringDuringIncidentsCopy, {
  KEEP_MONITORING_DURING_INCIDENTS_COLUMN,
  KEEP_MONITORING_DURING_INCIDENTS_TEST_ID,
  getKeepMonitoringOffDescription,
  isKeepMonitoringDuringIncidentsOffered,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/KeepMonitoringDuringIncidentsCopy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const MONITOR_ID: string = "11141d00-0000-4000-8000-0000000000cc";

let stored: Partial<Monitor> = {};
let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  stored = { keepMonitoringDuringIncidents: false };
  gate = { isAllowed: true };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    Object.assign(monitor, stored);
    return monitor;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      Object.assign(
        stored,
        (options as { data: Record<string, unknown> }).data,
      );
      return {};
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(monitorType: MonitorType): Promise<void> {
  render(
    <KeepMonitoringDuringIncidentsCard
      monitorId={new ObjectID(MONITOR_ID)}
      monitorType={monitorType}
    />,
  );

  await act(async () => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

async function theSwitch(): Promise<HTMLElement> {
  return screen.findByRole("switch", {
    name: KeepMonitoringDuringIncidentsCopy.switchTitle,
  });
}

describe("the card", () => {
  test("one switch, off by default, under a title that says when an incident pauses the monitor", async () => {
    await renderCard(MonitorType.Website);

    const control: HTMLElement = await theSwitch();

    expect(screen.getByText("During Incidents")).toBeInTheDocument();
    expect(
      screen.getByText(KeepMonitoringDuringIncidentsCopy.cardDescription),
    ).toBeInTheDocument();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(KeepMonitoringDuringIncidentsCopy.offDescription),
    ).toBeInTheDocument();

    // It reads the one column it switches.
    const read: { select: Record<string, unknown> } = getItemMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };

    expect(read.select).toEqual({ keepMonitoringDuringIncidents: true });
  });

  test("turning it on saves at once, and says what on means", async () => {
    await renderCard(MonitorType.IncomingRequest);

    await act(async () => {
      fireEvent.click(await theSwitch());
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const call: { id: ObjectID; data: Record<string, unknown> } = updateByIdMock
      .mock.calls[0]![0] as { id: ObjectID; data: Record<string, unknown> };

    expect(call.id.toString()).toBe(MONITOR_ID);
    expect(call.data).toEqual({ keepMonitoringDuringIncidents: true });
    expect(
      await screen.findByText(KeepMonitoringDuringIncidentsCopy.onDescription),
    ).toBeInTheDocument();
  });

  test("a monitor already set to keep monitoring reads as on, and turning it off saves false", async () => {
    stored.keepMonitoringDuringIncidents = true;

    await renderCard(MonitorType.API);

    const control: HTMLElement = await theSwitch();
    expect(control).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      fireEvent.click(control);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: Record<string, unknown> })
        .data,
    ).toEqual({ keepMonitoringDuringIncidents: false });
  });

  test("somebody who may not change it sees it locked", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to edit this Monitor.",
    };

    await renderCard(MonitorType.IncomingRequest);

    await act(async () => {
      fireEvent.click(await theSwitch());
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a manual monitor runs no checks: no card, and nothing is read", async () => {
    await renderCard(MonitorType.Manual);

    expect(
      screen.queryByTestId(`${KEEP_MONITORING_DURING_INCIDENTS_TEST_ID}-card`),
    ).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(getItemMock).not.toHaveBeenCalled();
  });
});

describe("what off says, by the monitor's kind", () => {
  test.each([
    [
      MonitorType.IncomingRequest,
      "Such an incident pauses checks until it is resolved. Requests that arrive meanwhile are listed in Logs, not evaluated.",
    ],
    [
      MonitorType.IncomingEmail,
      "Such an incident pauses checks until it is resolved. Emails that arrive meanwhile are listed in Logs, not evaluated.",
    ],
    [
      MonitorType.Server,
      "Such an incident pauses checks until it is resolved. Reports the agent sends meanwhile are listed in Logs, not evaluated.",
    ],
    [
      MonitorType.Website,
      "Such an incident pauses this monitor's checks until it is resolved.",
    ],
    [
      MonitorType.Metrics,
      "Such an incident pauses this monitor's checks until it is resolved.",
    ],
  ])("%s", (monitorType: MonitorType, expected: string) => {
    expect(getKeepMonitoringOffDescription(monitorType)).toBe(expected);
  });

  test("an Incoming Request monitor's card says it under the switch", async () => {
    await renderCard(MonitorType.IncomingRequest);
    await theSwitch();

    expect(
      screen.getByText(
        getKeepMonitoringOffDescription(MonitorType.IncomingRequest),
      ),
    ).toBeInTheDocument();
  });

  test("without a type, the general words", () => {
    expect(getKeepMonitoringOffDescription(undefined)).toBe(
      KeepMonitoringDuringIncidentsCopy.offDescription,
    );
  });

  test("every type but Manual is offered the switch", () => {
    for (const monitorType of Object.values(MonitorType)) {
      expect(isKeepMonitoringDuringIncidentsOffered(monitorType)).toBe(
        monitorType !== MonitorType.Manual,
      );
    }

    expect(isKeepMonitoringDuringIncidentsOffered(undefined)).toBe(false);
  });
});

describe("the words", () => {
  const everyLine: Array<string> = [
    ...Object.values(KeepMonitoringDuringIncidentsCopy),
    getKeepMonitoringOffDescription(MonitorType.IncomingRequest),
    getKeepMonitoringOffDescription(MonitorType.IncomingEmail),
    getKeepMonitoringOffDescription(MonitorType.Server),
  ];

  test("a switch's lines are one short sentence or two, under 150 characters; the card's under 210", () => {
    expect(
      KeepMonitoringDuringIncidentsCopy.cardDescription.length,
    ).toBeLessThanOrEqual(210);

    for (const line of everyLine) {
      if (line === KeepMonitoringDuringIncidentsCopy.cardDescription) {
        continue;
      }

      expect(line.length).toBeLessThanOrEqual(150);
    }
  });

  test("every line of the card is in each of the Dashboard's languages", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const text of everyLine) {
        expect(`${language}: ${locale[text] ? "has" : "lacks"} ${text}`).toBe(
          `${language}: has ${text}`,
        );
        expect(locale[text]).not.toBe(text);
      }
    }
  });
});

describe("the column it writes", () => {
  test("is the monitor's keepMonitoringDuringIncidents, a boolean off by default", () => {
    const column: { type: string; defaultValue?: unknown; required?: boolean } =
      getTableColumns(new Monitor())[KEEP_MONITORING_DURING_INCIDENTS_COLUMN] as {
        type: string;
        defaultValue?: unknown;
        required?: boolean;
      };

    expect(column).toBeDefined();
    expect(column.defaultValue).toBe(false);
    expect(column.required).toBe(true);
  });
});
