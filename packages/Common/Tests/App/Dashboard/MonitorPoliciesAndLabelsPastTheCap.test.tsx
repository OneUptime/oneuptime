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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import MonitorStepsView, {
  getCriteriaHeldIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorSteps";
import MonitorRecommendationCreateSideOver from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCreateSideOver";
import { loadMonitorRecommendationProjectSetup } from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationProjectSetup";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { MonitorRecommendation } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { createTranslator } from "../../../Types/Translator";

/*
 * A MONITOR'S ON-CALL POLICIES AND LABELS, PICKED AND SHOWN HOWEVER MANY THE
 * PROJECT HAS (#10646).
 *
 * - A monitor's criteria page (the read-only view of its steps) read the
 *   project's first 10,000 on-call policies, labels, teams and users -
 *   unsorted - and showed of each criteria's only those it found there: a
 *   policy past them was left off what the monitor pages.
 * - The recommended monitors' create panel offered the project's first
 *   10,000 policies and labels as static options: one past them could not
 *   be picked.
 *
 * The view reads what the criteria hold by their ids; the panel's pickers
 * search the server (CriteriaRecordPicker), and its setup reads one policy,
 * only to know there is one. ModelAPI answers from a project faked whole
 * (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const LATE_POLICY_ID: string = "e0000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_POLICY_ID: string = "e0000000-0000-4000-8000-0000000000ab";
const LATE_LABEL_ID: string = "c0000000-0000-4000-8000-0000000000aa";
const OPERATIONAL_ID: string = "a0000000-0000-4000-8000-000000000001";
const OFFLINE_ID: string = "a0000000-0000-4000-8000-000000000002";
const INCIDENT_SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000003";
const ALERT_SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000004";

const BEFORE_WB: number = LIMIT_PER_PROJECT + 50;

let server: CappedListServer;

beforeAll(() => {
  server = new CappedListServer();

  for (const modelType of [OnCallDutyPolicy, Label]) {
    server.add(
      modelType as { new (): OnCallDutyPolicy | Label },
      namesSortingFirst(BEFORE_WB).map(
        (name: string): Record<string, unknown> => {
          return { _id: ObjectID.generate().toString(), name: name };
        },
      ),
    );
  }

  server.add(OnCallDutyPolicy, [
    { _id: LATE_POLICY_ID, name: "WB Payments Escalation", isArchived: false },
    {
      _id: OTHER_LATE_POLICY_ID,
      name: "WB Search Escalation",
      isArchived: false,
    },
  ]);
  server.add(Label, [
    { _id: LATE_LABEL_ID, name: "WB-kiosk", isArchived: false },
  ]);
  server.add(MonitorStatus, [
    {
      _id: OPERATIONAL_ID,
      name: "Operational",
      isOperationalState: true,
      priority: 1,
    },
    { _id: OFFLINE_ID, name: "Offline", isOfflineState: true, priority: 2 },
  ]);
  server.add(IncidentSeverity, [
    { _id: INCIDENT_SEVERITY_ID, name: "Critical", order: 1 },
  ]);
  server.add(AlertSeverity, [
    { _id: ALERT_SEVERITY_ID, name: "High", order: 1 },
  ]);
});

beforeEach(() => {
  server.calls.length = 0;
  server.install();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// A Website monitor's steps, its incidents paging the late policy.
function stepsHolding(): MonitorSteps {
  const steps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Website,
    monitorName: "Kiosk",
    defaultMonitorStatusId: new ObjectID(OPERATIONAL_ID),
    onlineMonitorStatusId: new ObjectID(OPERATIONAL_ID),
    offlineMonitorStatusId: new ObjectID(OFFLINE_ID),
    defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
    defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
  });

  for (const step of steps.data?.monitorStepsInstanceArray || []) {
    for (const instance of step.data?.monitorCriteria.data
      ?.monitorCriteriaInstanceArray || []) {
      for (const incident of instance.data?.incidents || []) {
        incident.onCallPolicyIds = [new ObjectID(LATE_POLICY_ID)];
        incident.labelIds = [new ObjectID(LATE_LABEL_ID)];
      }
    }
  }

  return steps;
}

// Whether a criteria of the steps opens an incident at all.
function opensIncidents(steps: MonitorSteps): boolean {
  return (steps.data?.monitorStepsInstanceArray || []).some(
    (step: MonitorStep): boolean => {
      return (
        step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray || []
      ).some((instance: MonitorCriteriaInstance): boolean => {
        return (instance.data?.incidents || []).length > 0;
      });
    },
  );
}

describe("a monitor's criteria page", () => {
  test("knows every policy, label, team and person the criteria hold", () => {
    const steps: MonitorSteps = stepsHolding();

    expect(opensIncidents(steps)).toBe(true);

    const held: ReturnType<typeof getCriteriaHeldIds> =
      getCriteriaHeldIds(steps);

    expect(new Set(held.onCallPolicyIds)).toEqual(new Set([LATE_POLICY_ID]));
    expect(new Set(held.labelIds)).toEqual(new Set([LATE_LABEL_ID]));
    expect(getCriteriaHeldIds(undefined)).toEqual({
      onCallPolicyIds: [],
      labelIds: [],
      teamIds: [],
      userIds: [],
    });
  });

  test("REGRESSION: names the policy and label past the 10,000th that the criteria hold, read by their ids", async () => {
    render(
      <MemoryRouter>
        <MonitorStepsView
          monitorType={MonitorType.Website}
          monitorSteps={stepsHolding()}
        />
      </MemoryRouter>,
    );

    expect(
      (await screen.findAllByText("WB Payments Escalation")).length,
    ).toBeGreaterThan(0);
    expect((await screen.findAllByText("WB-kiosk")).length).toBeGreaterThan(0);

    // Read by the ids the criteria hold: never the project's whole list.
    for (const modelType of [OnCallDutyPolicy, Label]) {
      expect(server.callsFor(modelType).length).toBeGreaterThan(0);

      for (const call of server.callsFor(modelType)) {
        expect(call.query["_id"]).toBeInstanceOf(Includes);
      }
    }
  });
});

const RECOMMENDATION: MonitorRecommendation = {
  recommendationId: "Host:host-high-cpu",
  recommendationType: "Monitor",
  resourceType: "Host",
  monitorType: MonitorType.Host,
  templateId: "host-high-cpu",
  name: "High CPU",
  description: "CPU above 90% for 5 minutes.",
  category: "Resources",
  severity: "Critical",
  getMonitorStep: () => {
    throw new Error("Not built in this test.");
  },
} as unknown as MonitorRecommendation;

describe("the recommended monitors' create panel", () => {
  test("its setup reads one policy, to know there is one, and no labels", async () => {
    const setup: Awaited<
      ReturnType<typeof loadMonitorRecommendationProjectSetup>
    > = await loadMonitorRecommendationProjectSetup(
      createTranslator(undefined, "en"),
    );

    expect(setup.hasOnCallPolicies).toBe(true);
    expect(server.callsFor(Label)).toHaveLength(0);
    expect(
      server.callsFor(OnCallDutyPolicy).map((call: { limit: number }) => {
        return call.limit;
      }),
    ).toEqual([1]);
  });

  test("finds a policy past the 10,000th by its name, and pages it", async () => {
    render(
      <MemoryRouter>
        <MonitorRecommendationCreateSideOver
          selectedRecommendations={[RECOMMENDATION]}
          resourceLabel="Host"
          hasOnCallPolicies={true}
          incidentSeverityOptions={[]}
          alertSeverityOptions={[]}
          isCreating={false}
          onClose={() => {}}
          onSubmit={() => {}}
        />
      </MemoryRouter>,
    );

    const picker: HTMLElement = screen.getByTestId(
      "monitor-recommendations-onCallPolicyIds",
    );

    await act(async () => {
      fireEvent.focus(picker);
      fireEvent.change(picker, { target: { value: "WB Search" } });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /WB Search Escalation/,
    });

    // Asked of the server, by name: never the first 10,000 filtered here.
    const searched: Record<string, unknown> | undefined = server
      .callsFor(OnCallDutyPolicy)
      .map((call: { query: Record<string, unknown> }) => {
        return call.query;
      })
      .find((query: Record<string, unknown>): boolean => {
        return query["name"] instanceof Search;
      });

    expect((searched?.["name"] as Search<string>).toString()).toBe("WB Search");

    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      expect(
        screen.getAllByTestId("entity-dropdown-chip-label")[0],
      ).toHaveTextContent("WB Search Escalation");
    });
  });

  test("says the project has no policy only when it has none", () => {
    render(
      <MemoryRouter>
        <MonitorRecommendationCreateSideOver
          selectedRecommendations={[RECOMMENDATION]}
          resourceLabel="Host"
          hasOnCallPolicies={false}
          incidentSeverityOptions={[]}
          alertSeverityOptions={[]}
          isCreating={false}
          onClose={() => {}}
          onSubmit={() => {}}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/This project has no on-call policies\./),
    ).toBeInTheDocument();
  });
});
