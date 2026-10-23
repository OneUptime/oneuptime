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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import SnmpWalkCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkCard";
import { SNMP_WALK_SERVER_MESSAGES } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkViewModel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import Probe from "../../../Models/DatabaseModels/Probe";
import SnmpDataType from "../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_ALREADY_RUNNING_MESSAGE,
  SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SNMP_WALK_PROBE_UPGRADE_MESSAGE,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "../../../Types/NetworkDevice/NetworkDeviceSnmpWalk";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #5184, the UI review: a device's SNMP Walk page in the reader's
 * language, end to end through the real locale files - what Collect came
 * to, why a walk stopped, the server's own refusals and the list's
 * "Showing 100 of 250" - which an English-only test cannot see fall back
 * to English. The server words its refusals in English
 * (Common/Types/NetworkDevice/NetworkDeviceSnmpWalk.ts); the page knows
 * them as locale keys, so they read in German like the rest of the page.
 */

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// A {{placeholder}} the page fills.
const PLACEHOLDER: RegExp = /\{\{[a-z]+\}\}/gi;

type Locale = Record<string, unknown>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");
const GERMAN: Locale = readLocale("de");

// The sentences this review added to the page, which every language says.
const REVIEW_KEYS: Array<string> = [
  "Collected from the next poll on, and charted on the device's Metrics page.",
  "Collected from the next poll on, so you can alert on its value.",
  "Every device using {{template}} collects it from its next poll on.",
  "A busy device sometimes goes quiet part of the way. Continue walking to read the rest.",
  ...SNMP_WALK_SERVER_MESSAGES,
  "This device has not been walked yet. Walking it needs the Create Network Device Diagnostic permission.",
  "Showing {{shown}} of {{total}}",
];

function german(key: string): string {
  return GERMAN[key] as string;
}

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const WALK_ID: string = "22222222-2222-4222-8222-222222222222";
const OLD_WALK_ID: string = "33333333-3333-4333-8333-333333333333";

const getDeviceMock: MockFunction = getJestMockFunction();
const getWalkMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateMock: MockFunction = getJestMockFunction();

const fakeModelAPI: typeof ModelAPI = {
  getItem: (request: { modelType: unknown }) => {
    if (request.modelType === NetworkDevice) {
      return getDeviceMock(request);
    }

    return getWalkMock(request);
  },
  getList: getListMock,
  create: createMock,
  updateById: updateMock,
} as unknown as typeof ModelAPI;

const SYS_NAME: SnmpWalkRow = {
  oid: "1.3.6.1.2.1.1.5.0",
  type: SnmpDataType.OctetString,
  value: "edge-sw-01",
};
const CISCO_CPU: SnmpWalkRow = {
  oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1",
  type: SnmpDataType.Gauge32,
  value: 7,
};

function completedWalk(
  overrides: Partial<NetworkDeviceDiagnosticSnmpWalkResult> = {},
): NetworkDeviceDiagnostic {
  const result: NetworkDeviceDiagnosticSnmpWalkResult = {
    rootOid: "1.3.6.1",
    rows: [SYS_NAME, CISCO_CPU],
    stopReason: SnmpWalkStopReason.Complete,
    snmpVersion: "2c",
    requestCount: 2,
    durationInMs: 40,
    ...overrides,
  };

  return Object.assign(new NetworkDeviceDiagnostic(), {
    _id: OLD_WALK_ID,
    status: "Completed",
    diagnosticType: "SNMP Walk",
    createdAt: new Date(),
    snmpWalkRootOid: result.rootOid,
    snmpWalkResult: result,
  });
}

function history(walk: NetworkDeviceDiagnostic): void {
  getListMock.mockResolvedValue({ data: [walk], count: 1, skip: 0, limit: 5 });
}

async function renderCard(): Promise<void> {
  render(
    <SnmpWalkCard
      networkDeviceId={new ObjectID(DEVICE_ID)}
      canWalk={true}
      canEditDevice={true}
      canEditTemplate={true}
      canCreateMonitor={true}
      modelAPI={fakeModelAPI}
    />,
  );

  await act(async () => {});
  await act(async () => {});
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

function rowFor(oid: string): HTMLElement {
  return screen
    .getAllByTestId("snmp-walk-row")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-oid") === oid;
    })!;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: GERMAN },
      en: { translation: ENGLISH },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  getDeviceMock.mockReset();
  getWalkMock.mockReset();
  getListMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();

  getDeviceMock.mockResolvedValue(
    Object.assign(new NetworkDevice(), {
      _id: DEVICE_ID,
      name: "edge-sw-01",
      probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
      probe: Object.assign(new Probe(), { name: "Rack 3" }),
      monitoringMethod: "Probe",
      snmpOids: [],
    }),
  );
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 5 });
  updateMock.mockResolvedValue({ data: {} });

  await act(async () => {
    await i18next.changeLanguage("de");
  });
});

afterEach(() => {
  cleanup();
});

describe("every sentence the review added is said in every language", () => {
  test.each(REVIEW_KEYS)("%s", (key: string) => {
    expect(ENGLISH[key]).toBe(key);

    for (const code of LANGUAGES) {
      const locale: Locale = readLocale(code);
      const text: unknown = locale[key];

      expect({ code, isText: typeof text === "string" }).toEqual({
        code,
        isText: true,
      });
      // Translated, not the English left in as a placeholder.
      expect({ code, text }).not.toEqual({ code, text: key });

      // The placeholders the page fills, kept.
      for (const placeholder of key.match(PLACEHOLDER) || []) {
        expect({ code, has: (text as string).includes(placeholder) }).toEqual({
          code,
          has: true,
        });
      }
    }
  });
});

describe("the page in German", () => {
  test("Collect says when and where the OID shows up, in the row", async () => {
    history(completedWalk());

    await renderCard();
    await click(
      within(rowFor(CISCO_CPU.oid)).getByTestId("snmp-walk-row-collect"),
    );
    await act(async () => {});

    expect(
      within(rowFor(CISCO_CPU.oid)).getByTestId("snmp-walk-collect-notice"),
    ).toHaveTextContent(
      german(
        "Collected from the next poll on, and charted on the device's Metrics page.",
      ),
    );
  });

  test("a device that went quiet part of the way says what to do", async () => {
    history(
      completedWalk({
        stopReason: SnmpWalkStopReason.Failed,
        nextOid: CISCO_CPU.oid,
        failure: { kind: SnmpWalkFailureKind.Timeout, message: "timed out" },
      }),
    );

    await renderCard();

    expect(screen.getByTestId("snmp-walk-failure")).toHaveTextContent(
      german(
        "A busy device sometimes goes quiet part of the way. Continue walking to read the rest.",
      ),
    );
  });

  test.each([
    SNMP_WALK_NO_CREDENTIALS_MESSAGE,
    SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
    SNMP_WALK_ALREADY_RUNNING_MESSAGE,
  ])("the server's refusal reads in German: %s", async (message: string) => {
    createMock.mockRejectedValue(new Error(message));

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));

    const error: HTMLElement = screen.getByTestId("snmp-walk-error");
    expect(error).toHaveTextContent(german(message));
    expect(error).not.toHaveTextContent(message);
  });

  test("a probe too old to walk says so in German", async () => {
    jest.useFakeTimers();

    try {
      createMock.mockResolvedValue({
        data: Object.assign(new NetworkDeviceDiagnostic(), { _id: WALK_ID }),
      });
      getWalkMock.mockResolvedValue(
        Object.assign(new NetworkDeviceDiagnostic(), {
          _id: WALK_ID,
          status: "Failed",
          statusMessage: SNMP_WALK_PROBE_UPGRADE_MESSAGE,
        }),
      );

      await renderCard();
      await click(screen.getByTestId("snmp-walk-start"));
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      await act(async () => {});

      expect(screen.getByTestId("snmp-walk-error")).toHaveTextContent(
        german(SNMP_WALK_PROBE_UPGRADE_MESSAGE),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test("a message the walk does not know is shown as the server wrote it", async () => {
    createMock.mockRejectedValue(new Error("Something else went wrong."));

    await renderCard();
    await click(screen.getByTestId("snmp-walk-start"));

    expect(screen.getByTestId("snmp-walk-error")).toHaveTextContent(
      "Something else went wrong.",
    );
  });

  test("a long walk counts what it shows in German", async () => {
    history(
      completedWalk({
        rows: Array.from(
          { length: 250 },
          (_: unknown, index: number): SnmpWalkRow => {
            return {
              oid: `1.3.6.1.2.1.2.2.1.10.${index + 1}`,
              type: SnmpDataType.Counter32,
              value: index,
            };
          },
        ),
      }),
    );

    await renderCard();

    expect(screen.getByTestId("snmp-walk-results")).toHaveTextContent(
      "100 von 250 angezeigt",
    );
  });
});

describe("the page knows the server's refusals by their words", () => {
  test("each sentence the server answers a walk with is a key the page looks up", () => {
    expect([...SNMP_WALK_SERVER_MESSAGES].sort()).toEqual(
      [
        SNMP_WALK_NO_CREDENTIALS_MESSAGE,
        SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
        SNMP_WALK_ALREADY_RUNNING_MESSAGE,
        SNMP_WALK_PROBE_UPGRADE_MESSAGE,
      ].sort(),
    );
  });
});
