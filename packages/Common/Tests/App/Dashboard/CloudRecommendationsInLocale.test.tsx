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
 * A CLOUD ACCOUNT'S RECOMMENDATIONS IN THE READER'S LANGUAGE - from the
 * Dashboard's shipped locale files.
 *
 * The page shares its words with every Recommendations page: the coverage
 * bar, the tiles, the search and the severity filter, the create panel.
 * Before #6150's review a Persian or an Italian page read "Recommended
 * Monitors", "Already created" and "Create Monitors" in English around its
 * own words, the coverage bar's "recommended monitors created" was English
 * in every language, and the create panel's three ways to be told were
 * English everywhere (BasicRadioButtons draws what it is handed). The
 * catalog's names and sentences stay English, in an isolate each, so a
 * Persian page keeps their full stops at their ends; the tiles count in
 * the reader's digits, as the coverage bar does.
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

import CloudAccountMonitorRecommendations from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/CloudAccountMonitorRecommendations";
import { RECOMMENDATION_COVERAGE_SUFFIX } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationToolbar";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";

const AWS_ACCOUNT: string = "123456789012";

function uuid(number: number): string {
  return `40000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function instance(id: number, name: string): CloudResource {
  const resource: CloudResource = new CloudResource();
  const record: Record<string, unknown> = resource as unknown as Record<
    string,
    unknown
  >;
  record["_id"] = uuid(id);
  record["name"] = name;
  record["cloudProvider"] = "aws";
  record["cloudResourceType"] = "AWS::EC2::Instance";
  record["telemetryAttributes"] = {
    Namespace: "AWS/EC2",
    "resource.cloud.account.id": AWS_ACCOUNT,
    "resource.cloud.region": "us-east-1",
    "Dimensions.InstanceId": `i-${id}`,
  };
  record["cloudReadings"] = {};
  record["cloudProperties"] = {};
  record["cloudConnectionId"] = "20000000-0000-4000-8000-000000000001";
  return resource;
}

function vpc(): CloudResource {
  const resource: CloudResource = instance(3, "prod-vpc");
  const record: Record<string, unknown> = resource as unknown as Record<
    string,
    unknown
  >;
  record["cloudResourceType"] = "AWS::EC2::VPC";
  record["telemetryAttributes"] = {};
  return resource;
}

// Everything a recommended monitor is built with, and what the panel offers.
function projectList(modelType: unknown): { data: Array<unknown> } {
  if (modelType === MonitorStatus) {
    const online: MonitorStatus = new MonitorStatus();
    online._id = "55000000-0000-4000-8000-000000000001";
    online.name = "Operational";
    online.isOperationalState = true;
    const offline: MonitorStatus = new MonitorStatus();
    offline._id = "55000000-0000-4000-8000-000000000002";
    offline.name = "Offline";
    offline.isOfflineState = true;
    return { data: [online, offline] };
  }

  if (modelType === IncidentSeverity || modelType === AlertSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = "52000000-0000-4000-8000-000000000001";
    severity.name = "Critical";
    severity.order = 1;
    return { data: [severity] };
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

beforeEach(async () => {
  getListMock.mockReset();

  goTo(
    `/dashboard/${PROJECT_ID}/cloud/accounts/30000000-0000-4000-8000-000000000001/recommendations`,
  );

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);

  getListMock.mockImplementation((args: unknown) => {
    const modelType: unknown = (args as { modelType: unknown }).modelType;

    if (modelType === CloudResource) {
      const rows: Array<CloudResource> = [
        instance(1, "web-1"),
        instance(2, "web-2"),
        vpc(),
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
      <CloudAccountMonitorRecommendations
        provider="aws"
        cloudAccountId={AWS_ACCOUNT}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("cloud-account-recommendations");
}

const WHITESPACE: RegExp = /\s+/g;

function text(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "").replace(
    WHITESPACE,
    " ",
  );
}

describe("a cloud account's Recommendations in German", () => {
  test("the card, the coverage bar, the tiles and the filters are German", async () => {
    await renderPage("de");

    expect(screen.getByText("Empfohlene Monitore")).toBeInTheDocument();
    // Two instances, Status Checks Failing and High CPU on each.
    expect(screen.getByTestId("progress-bar-count")).toHaveTextContent(
      "0 von 4 empfohlenen Monitoren erstellt",
    );

    for (const tile of [
      "Recommended",
      "Not set up yet",
      "Already created",
      "Dismissed",
    ]) {
      expect(DE[tile]).toBeTruthy();
      expect(screen.getByText(DE[tile]!)).toBeInTheDocument();
    }

    expect(
      screen.getByPlaceholderText(DE["Search recommendations..."]!),
    ).toBeInTheDocument();
    expect(screen.getByText(DE["All severities"]!)).toBeInTheDocument();
  });

  test("each type, each row and what is left out read in German", async () => {
    await renderPage("de");

    const ec2: HTMLElement = screen.getByTestId(
      "cloud-account-recommendation-group-aws|aws::ec2::instance",
    );

    expect(text(ec2)).toContain("Empfohlen für 2 Ressourcen");

    const toggle: HTMLElement = within(ec2).getByTestId(
      "cloud-account-recommendation-toggle-CloudResource:cloud-aws-ec2-status-check-failed",
    );
    expect(toggle).toHaveTextContent("Ressourcen anzeigen");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Ressourcen ausblenden");

    expect(
      within(ec2).getByTestId(
        "cloud-account-recommendation-add-CloudResource:cloud-aws-ec2-status-check-failed",
      ),
    ).toHaveTextContent("Zu 2 Ressourcen hinzufügen");
    expect(
      screen.getByText(DE["Not in this list"]!, { exact: true }),
    ).toBeInTheDocument();
  });

  test("the create panel's three ways to be told are German", async () => {
    await renderPage("de");

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          "cloud-account-recommendation-add-all-aws|aws::ec2::instance",
        ),
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    for (const words of [
      "Create an alert",
      "Notifies the team and runs the on-call policy. Not published to your status page.",
      "Declare an incident",
      "Notifies the team, runs the on-call policy, and can be shown on your status page.",
      "Both",
      "One breach opens an alert and an incident. Two records to resolve — pick this only if your workflow needs both.",
    ]) {
      expect(DE[words]).toBeTruthy();
      expect(DE[words]).not.toBe(words);
      expect(within(dialog).getByText(DE[words]!)).toBeInTheDocument();
      expect(within(dialog).queryByText(words)).toBeNull();
    }
  });
});

describe("a cloud account's Recommendations in Persian", () => {
  test("the tiles count in Persian digits, as the coverage bar does", async () => {
    await renderPage("fa");

    const recommended: HTMLElement = screen.getByTestId(
      "recommendation-stat-All",
    );

    expect(text(recommended)).toContain("۴");
    expect(text(recommended)).not.toContain("4");
    expect(text(screen.getByTestId("progress-bar-count"))).toContain("۴");
  });

  test("its own words are Persian; the catalog's English reads as written", async () => {
    await renderPage("fa");

    expect(screen.getByText(FA["Recommended Monitors"]!)).toBeInTheDocument();
    expect(FA["Recommended Monitors"]).not.toBe("Recommended Monitors");
    expect(FA[RECOMMENDATION_COVERAGE_SUFFIX]).not.toBe(
      RECOMMENDATION_COVERAGE_SUFFIX,
    );
    expect(text(screen.getByTestId("progress-bar-count"))).toContain(
      FA[RECOMMENDATION_COVERAGE_SUFFIX]!,
    );

    const sentence: HTMLElement = screen.getByText(
      "The instance or the host it runs on fails a status check.",
    );
    expect(sentence.tagName).toBe("BDI");
    expect(sentence).toHaveAttribute("dir", "ltr");
  });
});
