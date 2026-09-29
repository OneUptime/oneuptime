import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The Threat Intel page leads with the "how threat intel works" card, and
 * its feeds table's help (?) modal shows the same guide, so the two cannot
 * disagree. Both tables are mocked to capture their props and render a
 * marker, so the page's own composition is what is under test.
 */

type CapturedFormField = {
  field: Record<string, boolean>;
  title: string;
  validation?:
    | { minValue?: number | undefined; maxValue?: number | undefined }
    | undefined;
};

type CapturedTableProps = {
  formFields?: Array<CapturedFormField>;
  createInitialValues?: Record<string, unknown>;
  helpContent?:
    | {
        title?: string | undefined;
        description?: string | undefined;
        markdown?: string | undefined;
      }
    | undefined;
};

let capturedFeedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedFeedTableProps = props;
      return React.createElement("div", { "data-testid": "feeds-table" });
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return React.createElement("div", { "data-testid": "indicators-table" });
    },
  };
});

import ThreatIntelPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/ThreatIntel";
import ThreatIntelGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import { guideToMarkdown } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import {
  THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
  THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
} from "../../../Types/SecurityEvent/ThreatIntelConstants";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function renderPage(project?: Project): void {
  const currentProject: Project = project || new Project();
  currentProject.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <ThreatIntelPage
        pageRoute={new Route("/dashboard/security-events/threat-intel")}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function fieldTitled(title: string): CapturedFormField {
  const field: CapturedFormField | undefined =
    capturedFeedTableProps?.formFields?.find(
      (formField: CapturedFormField): boolean => {
        return formField.title === title;
      },
    );

  expect(field).toBeDefined();

  return field!;
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("Threat Intel page", () => {
  beforeEach(() => {
    capturedFeedTableProps = null;
    window.localStorage.clear();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  test("leads with the how-it-works card, above the feeds and indicators tables", () => {
    renderPage();

    const card: HTMLElement = screen.getByTestId(
      `how-it-works-${ThreatIntelGuide.id}`,
    );

    expect(card).toHaveTextContent(ThreatIntelGuide.title);
    expect(isBefore(card, screen.getByTestId("feeds-table"))).toBe(true);
    expect(
      isBefore(
        screen.getByTestId("feeds-table"),
        screen.getByTestId("indicators-table"),
      ),
    ).toBe(true);
  });

  test("the card shows the threat levels, one chip per confidence band plus unscored", () => {
    renderPage();

    expect(screen.getAllByTestId("how-it-works-level")).toHaveLength(
      ThreatIntelGuide.levels.items.length,
    );
    expect(screen.getByText("Threat levels")).toBeInTheDocument();
  });

  test("the feeds table's help (?) modal shows the same guide as the card", () => {
    renderPage();

    expect(capturedFeedTableProps?.helpContent).toEqual({
      title: ThreatIntelGuide.guideTitle,
      description: ThreatIntelGuide.guideDescription,
      markdown: guideToMarkdown(ThreatIntelGuide),
    });
  });

  test("the poll interval form bounds are the ones the guide states", () => {
    renderPage();

    const pollInterval: CapturedFormField = fieldTitled(
      "Poll Interval (Minutes)",
    );

    expect(pollInterval.validation?.minValue).toBe(
      THREAT_INTEL_POLL_INTERVAL_MIN_IN_MINUTES,
    );
    expect(pollInterval.validation?.maxValue).toBe(
      THREAT_INTEL_POLL_INTERVAL_MAX_IN_MINUTES,
    );
    expect(capturedFeedTableProps?.createInitialValues).toMatchObject({
      pollIntervalInMinutes: THREAT_INTEL_DEFAULT_POLL_INTERVAL_IN_MINUTES,
    });
  });

  test("a reseller plan without telemetry sees neither the card nor the tables", () => {
    const project: Project = new Project();
    const reseller: Reseller = new Reseller();
    reseller.enableTelemetryFeatures = false;
    project.reseller = reseller;

    renderPage(project);

    expect(
      screen.queryByTestId(`how-it-works-${ThreatIntelGuide.id}`),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("feeds-table")).not.toBeInTheDocument();
    expect(
      screen.getByText(/did not include telemetry features/),
    ).toBeInTheDocument();
  });
});
