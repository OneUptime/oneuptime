import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * A RESOURCE'S ACTIVE INCIDENTS, ALERTS AND MAINTENANCE, IN THE READER'S
 * DIGITS (issue #7106).
 *
 * Every resource's Overview opens with three cards counting what is active
 * on it. The count was drawn with toString(), so a Persian host's page read
 * "12" and "0" under Persian headings, beside the Persian digits of every
 * other figure on it. It is written the reader's way now: Persian digits in
 * Persian, Latin ones in Arabic and German's thousands point; English reads
 * as before.
 */

const COUNTS: Record<string, number> = {
  Incident: 12,
  Alert: 0,
  ScheduledMaintenance: 1234,
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (data: { modelType: { name: string } }): Promise<number> => {
        return Promise.resolve(COUNTS[data.modelType.name] ?? 0);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

import ResourceActivityCards from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LANGUAGES: Array<string> = ["en", "de", "fa", "ar"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const countsIn: (language: string) => Promise<Array<string>> = async (
  language: string,
): Promise<Array<string>> => {
  const result: RenderResult = render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>
        <ResourceActivityCards
          modelId={new ObjectID("20000000-0000-4000-8000-000000000002")}
          resourceQueryKey="hosts"
          incidentsRoute={new Route("/incidents")}
          alertsRoute={new Route("/alerts")}
          scheduledMaintenanceRoute={new Route("/maintenance")}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  return result
    .getAllByTestId("resource-activity-count")
    .map((count: HTMLElement): string => {
      return withoutIsolateMarks(count.textContent || "");
    });
};

describe("a resource's activity counts", () => {
  test("in Persian: Persian digits, its own thousands sign", async () => {
    expect(await countsIn("fa")).toEqual(["۱۲", "۰", "۱٬۲۳۴"]);
  });

  test("in German: its thousands point", async () => {
    expect(await countsIn("de")).toEqual(["12", "0", "1.234"]);
  });

  test("in Arabic: Latin digits, never Arabic-Indic ones", async () => {
    const counts: Array<string> = await countsIn("ar");

    expect(counts).toEqual(["12", "0", "1,234"]);
    expect(counts.join(" ")).not.toMatch(/[٠-٩]/);
  });

  test("in English, as before but for a thousands comma", async () => {
    expect(await countsIn("en")).toEqual(["12", "0", "1,234"]);
  });
});
