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
 * The Security Events → Monitors tab is a thin composition over
 * MonitorTable, and the two things that make it correct are both props:
 * the base query that scopes the table to MonitorType.SecurityEvents, and
 * the replacement create button that deep-links into the gated monitor
 * create page with the type preselected. Neither failing looks wrong on
 * screen — an unscoped table just shows more rows, and a plain create
 * button just asks the user to pick the type again — so the captured
 * props are what gets pinned.
 */

type CapturedCardButton = {
  title: string;
  onClick: () => void;
};

type CapturedMonitorTableProps = {
  query?: Record<string, unknown>;
  disableCreate?: boolean;
  cardButtons?: Array<CapturedCardButton>;
  saveFilterProps?: { tableId?: string };
  title?: string;
};

let capturedMonitorTableProps: CapturedMonitorTableProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedMonitorTableProps) => {
        capturedMonitorTableProps = props;
        return null;
      },
    };
  },
);

import SecurityEventsMonitorsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Monitors";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function renderPage(project: Project): void {
  render(
    <MemoryRouter>
      <SecurityEventsMonitorsPage
        pageRoute={new Route("/dashboard/security-events/monitors")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function buildProject(options: { telemetryDisabled?: boolean } = {}): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  if (options.telemetryDisabled) {
    const reseller: Reseller = new Reseller();
    reseller.enableTelemetryFeatures = false;
    project.reseller = reseller;
  }

  return project;
}

describe("Security Events monitors page", () => {
  beforeEach(() => {
    capturedMonitorTableProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    /*
     * Pass the button through unchanged: what the PERMISSION gate does is
     * PermissionGate's own test's problem; this page's contract is that
     * the button it hands the gate deep-links correctly.
     */
    jest
      .spyOn(PermissionGate, "gateCardButton")
      .mockImplementation((button: CardButtonSchema) => {
        return button;
      });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("scopes the table to Security Events monitors in this project", () => {
    renderPage(buildProject());

    expect(capturedMonitorTableProps).not.toBeNull();
    expect(capturedMonitorTableProps?.query).toMatchObject({
      monitorType: MonitorType.SecurityEvents,
    });
    expect(capturedMonitorTableProps?.query?.["projectId"]?.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("keeps its filter state under its own table id", () => {
    renderPage(buildProject());

    expect(capturedMonitorTableProps?.saveFilterProps?.tableId).toBe(
      "security-events-monitors-table",
    );
  });

  test("replaces the built-in create with a type-preselecting deep link", () => {
    renderPage(buildProject());

    expect(capturedMonitorTableProps?.disableCreate).toBe(true);

    const button: CapturedCardButton | undefined =
      capturedMonitorTableProps?.cardButtons?.[0];

    expect(button?.title).toBe("Create Security Events Monitor");

    const navigateSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {
        return undefined;
      });

    button!.onClick();

    const destination: string = String(navigateSpy.mock.calls[0]?.[0]);

    expect(destination).toContain("/monitors/create");
    /*
     * Encoded, not raw: the enum value carries a space, which Route's
     * character validator rejects — this exact assertion is what caught
     * the crash the first time.
     */
    expect(destination).toContain(
      `monitorType=${encodeURIComponent(MonitorType.SecurityEvents)}`,
    );
  });

  test("drops the create button entirely when the permission gate says no", () => {
    jest
      .spyOn(PermissionGate, "gateCardButton")
      .mockImplementation((): CardButtonSchema | null => {
        return null;
      });

    renderPage(buildProject());

    expect(capturedMonitorTableProps?.cardButtons).toEqual([]);
  });

  test("shows the reseller telemetry gate instead of the table", () => {
    renderPage(buildProject({ telemetryDisabled: true }));

    expect(capturedMonitorTableProps).toBeNull();
    expect(
      screen.getByText(/did not include telemetry features/i),
    ).toBeInTheDocument();
  });
});
