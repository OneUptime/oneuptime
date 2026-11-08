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
 * "Response content", on a Website, API or Incoming Request monitor's
 * Settings page: one switch that saves when flipped. On by default, the
 * monitor's incidents and alerts keep the part of the response that matched
 * and the response body, masked; off, none of it. The card says which, in
 * the words of the monitor's kind of check, and is not there for monitor
 * types whose checks carry no body.
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

import ResponseContentCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ResponseContentCard";
import {
  REQUEST_CONTENT_SWITCH_COPY,
  RESPONSE_CONTENT_MONITOR_TYPES,
  RESPONSE_CONTENT_SWITCH_COLUMN,
  RESPONSE_CONTENT_SWITCH_COPY,
  RESPONSE_CONTENT_SWITCH_TEST_ID,
  getResponseContentSwitchCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ResponseContentSwitchCopy";
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

const MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000000cc";

let stored: Partial<Monitor> = {};
let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  stored = { keepResponseContent: true };
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
    <ResponseContentCard
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

describe("the card on a Website or API monitor", () => {
  test.each([MonitorType.Website, MonitorType.API])(
    "%s: one switch, on by default, saying what incidents and alerts keep",
    async (monitorType: MonitorType) => {
      await renderCard(monitorType);

      const control: HTMLElement = await screen.findByRole("switch", {
        name: RESPONSE_CONTENT_SWITCH_COPY.switchTitle,
      });

      expect(screen.getByText("Response content")).toBeInTheDocument();
      expect(
        screen.getByText(RESPONSE_CONTENT_SWITCH_COPY.cardDescription),
      ).toBeInTheDocument();
      expect(control).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByText(RESPONSE_CONTENT_SWITCH_COPY.onDescription),
      ).toBeInTheDocument();

      // It reads the one column it switches.
      const read: { select: Record<string, unknown> } = getItemMock.mock
        .calls[0]![0] as { select: Record<string, unknown> };

      expect(read.select).toEqual({ keepResponseContent: true });
    },
  );

  test("turning it off saves at once, and says what off means", async () => {
    await renderCard(MonitorType.API);

    const control: HTMLElement = await screen.findByRole("switch", {
      name: RESPONSE_CONTENT_SWITCH_COPY.switchTitle,
    });

    await act(async () => {
      fireEvent.click(control);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const call: { id: ObjectID; data: Record<string, unknown> } = updateByIdMock
      .mock.calls[0]![0] as { id: ObjectID; data: Record<string, unknown> };

    expect(call.id.toString()).toBe(MONITOR_ID);
    expect(call.data).toEqual({ keepResponseContent: false });
    expect(
      await screen.findByText(RESPONSE_CONTENT_SWITCH_COPY.offDescription),
    ).toBeInTheDocument();
  });

  test("a monitor already set to keep none reads as off", async () => {
    stored.keepResponseContent = false;

    await renderCard(MonitorType.Website);

    const control: HTMLElement = await screen.findByRole("switch", {
      name: RESPONSE_CONTENT_SWITCH_COPY.switchTitle,
    });

    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("somebody who may not change it sees it locked", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You do not have permission to edit this Monitor.",
    };

    await renderCard(MonitorType.API);

    const control: HTMLElement = await screen.findByRole("switch", {
      name: RESPONSE_CONTENT_SWITCH_COPY.switchTitle,
    });

    await act(async () => {
      fireEvent.click(control);
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("the card on an Incoming Request monitor", () => {
  test("speaks of the request it receives", async () => {
    await renderCard(MonitorType.IncomingRequest);

    expect(
      await screen.findByRole("switch", {
        name: REQUEST_CONTENT_SWITCH_COPY.switchTitle,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Request content")).toBeInTheDocument();
    expect(
      screen.getByText(REQUEST_CONTENT_SWITCH_COPY.onDescription),
    ).toBeInTheDocument();
  });
});

describe("the monitor types whose checks carry no body", () => {
  test.each([
    MonitorType.Ping,
    MonitorType.Port,
    MonitorType.SSLCertificate,
    MonitorType.Logs,
    MonitorType.Metrics,
    MonitorType.Server,
    MonitorType.Manual,
  ])("%s has no card", async (monitorType: MonitorType) => {
    await renderCard(monitorType);

    expect(
      screen.queryByTestId(`${RESPONSE_CONTENT_SWITCH_TEST_ID}-card`),
    ).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("the copy is chosen by type", () => {
    expect(getResponseContentSwitchCopy(MonitorType.API)).toBe(
      RESPONSE_CONTENT_SWITCH_COPY,
    );
    expect(getResponseContentSwitchCopy(MonitorType.Website)).toBe(
      RESPONSE_CONTENT_SWITCH_COPY,
    );
    expect(getResponseContentSwitchCopy(MonitorType.IncomingRequest)).toBe(
      REQUEST_CONTENT_SWITCH_COPY,
    );
    expect(getResponseContentSwitchCopy(undefined)).toBeNull();
    expect(RESPONSE_CONTENT_MONITOR_TYPES).toEqual([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.IncomingRequest,
    ]);
  });
});

describe("the words", () => {
  test("the card's line says when to turn it off; the switch's own line says what is kept, masked - a phone shows only that one", () => {
    expect(RESPONSE_CONTENT_SWITCH_COPY.cardDescription).toBe(
      "Turn this off for a monitor whose responses are sensitive.",
    );
    expect(REQUEST_CONTENT_SWITCH_COPY.cardDescription).toBe(
      "Turn this off for a monitor whose requests are sensitive.",
    );

    for (const copy of [
      RESPONSE_CONTENT_SWITCH_COPY,
      REQUEST_CONTENT_SWITCH_COPY,
    ]) {
      expect(
        copy.onDescription.endsWith("with secrets and personal data masked."),
      ).toBe(true);
      expect(
        copy.offDescription.startsWith("Incidents and alerts keep no "),
      ).toBe(true);
    }
  });

  test("every line of the card is in each of the Dashboard's languages", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const copy of [
        RESPONSE_CONTENT_SWITCH_COPY,
        REQUEST_CONTENT_SWITCH_COPY,
      ]) {
        for (const text of Object.values(copy)) {
          expect(`${language}: ${locale[text] ? "has" : "lacks"} ${text}`).toBe(
            `${language}: has ${text}`,
          );
          expect(locale[text]).not.toBe(text);
        }
      }
    }
  });
});

describe("the column it writes", () => {
  test("is the monitor's keepResponseContent, a boolean on by default", () => {
    const column: { type: string; defaultValue?: unknown; required?: boolean } =
      getTableColumns(new Monitor())[RESPONSE_CONTENT_SWITCH_COLUMN] as {
        type: string;
        defaultValue?: unknown;
        required?: boolean;
      };

    expect(column).toBeDefined();
    expect(column.defaultValue).toBe(true);
    expect(column.required).toBe(true);
  });
});
