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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
 * AN APP PLATFORMS ENVIRONMENT'S RECOMMENDATIONS IN THE READER'S LANGUAGE -
 * from the Dashboard's shipped locale files.
 *
 * The page says its apps in its own sentences (CloudEnvironmentAppRecommendations
 * hands the shared page its words): every one is a whole sentence of the
 * reader's language - never "Empfohlen für 2" glued to a noun - and the
 * catalog's names and sentences stay English, each in an isolate, so a
 * Persian page keeps their full stops at their ends. The counts in a
 * sentence are written in the reader's digits.
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
const getItemMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      createOrUpdate: () => {
        return Promise.resolve({});
      },
    },
  };
});

// Billing off, whatever the environment says: no charge to acknowledge.
jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: false,
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([]);
      },
    },
  };
});

import CloudEnvironmentAppRecommendations from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudEnvironmentAppRecommendations";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";

const ENVIRONMENT_ID: string = "71000000-0000-4000-8000-000000000001";

function app(id: number, name: string, family: string | null): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: `75000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    name: name,
    cloudResourceId: new ObjectID(ENVIRONMENT_ID),
    cloudPlatform: "aws_ecs",
    groupName: "production",
    telemetryAttributes: family
      ? {
          "aws.ecs.task.family": family,
          "aws.ecs.cluster.arn":
            "arn:aws:ecs:us-east-1:123456789012:cluster/production",
        }
      : {},
  });
}

// Everything a recommended monitor is built with, and what the panel offers.
function projectList(modelType: unknown): { data: Array<unknown> } {
  if (modelType === MonitorStatus) {
    return {
      data: [
        Object.assign(new MonitorStatus(), {
          _id: "55000000-0000-4000-8000-000000000001",
          name: "Operational",
          isOperationalState: true,
        }),
        Object.assign(new MonitorStatus(), {
          _id: "55000000-0000-4000-8000-000000000002",
          name: "Offline",
          isOfflineState: true,
        }),
      ],
    };
  }

  if (modelType === IncidentSeverity || modelType === AlertSeverity) {
    return {
      data: [
        Object.assign(new IncidentSeverity(), {
          _id: "52000000-0000-4000-8000-000000000001",
          name: "Critical",
          order: 1,
        }),
      ],
    };
  }

  return { data: [] };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getListMock.mockReset();
  getItemMock.mockReset();

  goTo(
    `/dashboard/${PROJECT_ID}/app-platforms/${ENVIRONMENT_ID}/recommendations`,
  );

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);

  getItemMock.mockImplementation(() => {
    return Promise.resolve(
      Object.assign(new CloudResource(), {
        _id: ENVIRONMENT_ID,
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      }),
    );
  });

  getListMock.mockImplementation((args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;

    if (modelType === CloudApp) {
      const rows: Array<CloudApp> = [
        app(1, "checkout-api", "checkout-api"),
        app(2, "inventory", "inventory"),
        app(3, "a-very-long-generated-task-family-name", null),
      ];
      return Promise.resolve({ data: rows, count: rows.length });
    }

    return Promise.resolve(projectList(modelType));
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("de");
});

async function renderPage(language: string): Promise<void> {
  await i18next.changeLanguage(language);

  render(
    <MemoryRouter>
      <CloudEnvironmentAppRecommendations
        environmentId={new ObjectID(ENVIRONMENT_ID)}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("cloud-environment-recommendations");
}

const WHITESPACE: RegExp = /\s+/g;

function text(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "").replace(
    WHITESPACE,
    " ",
  );
}

describe("an environment's Recommendations in German", () => {
  test("the card, the group of apps and each row read in German", async () => {
    await renderPage("de");

    expect(
      screen.getByText(
        DE[
          "Monitors OneUptime recommends for this environment's apps, from the requests their OpenTelemetry reports. Add one to an app, or to every app at once."
        ]!,
      ),
    ).toBeInTheDocument();

    const group: HTMLElement = screen.getByTestId(
      "cloud-environment-recommendation-group-apps",
    );

    expect(text(group)).toContain("Empfohlen für 2 Apps");
    expect(text(group)).toContain("Eingerichtet auf 0 von 2 Apps");

    const toggle: HTMLElement = screen.getByTestId(
      "cloud-environment-recommendation-toggle-CloudApp:cloud-app-failed-operations",
    );
    expect(toggle).toHaveTextContent("Apps anzeigen");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Apps ausblenden");

    expect(
      screen.getByTestId(
        "cloud-environment-recommendation-add-CloudApp:cloud-app-failed-operations",
      ),
    ).toHaveTextContent("Zu 2 Apps hinzufügen");
  });

  test("the app it leaves out is named under a German reason", async () => {
    await renderPage("de");

    expect(
      screen.getByTestId(
        "cloud-environment-recommendations-not-listed-NotScoped",
      ),
    ).toHaveTextContent(
      DE[
        "Their names are too long to filter their telemetry by, so no monitor can watch one of them alone. Their telemetry is in this environment's tabs._one"
      ]!,
    );
  });

  test("the create panel says how many apps, in German", async () => {
    await renderPage("de");

    fireEvent.click(
      screen.getByTestId(
        "cloud-environment-recommendation-add-CloudApp:cloud-app-error-burst",
      ),
    );

    expect(
      await screen.findByText(
        "Diese Monitore werden auf 2 Apps dieser Umgebung erstellt. Alles unten gilt für alle.",
      ),
    ).toBeInTheDocument();
  });
});

describe("an environment's Recommendations in Persian", () => {
  test("its own words are Persian, its counts in Persian digits; the catalog's English reads as written", async () => {
    await renderPage("fa");

    const group: HTMLElement = screen.getByTestId(
      "cloud-environment-recommendation-group-apps",
    );

    expect(text(group)).toContain(FA["Apps"]!);
    // The locale's own sentence, its count in Persian digits.
    expect(text(group)).toContain(
      FA["Recommended for {{count}} apps"]!.replace("{{count}}", "۲"),
    );
    expect(text(group)).not.toContain("Recommended for");

    const sentence: HTMLElement = screen.getByText(
      "The app reports a failed operation in ten minutes.",
    );
    expect(sentence.tagName).toBe("BDI");
    expect(sentence).toHaveAttribute("dir", "ltr");
  });
});
