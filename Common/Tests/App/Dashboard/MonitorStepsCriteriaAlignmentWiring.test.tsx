import "@testing-library/jest-dom";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * The wiring test for the monitor-type/criteria alignment.
 *
 * CriteriaFilterMonitorTypeChange.test.ts pins the two pure helpers that
 * decide WHAT the criteria should become. Nothing pinned that the criteria
 * form actually calls them - and that wiring is the entire fix, because the
 * reported defect is not a wrong answer from a helper, it is a form that
 * never asked. Delete the effect in MonitorSteps.tsx, or drop
 * props.monitorType from its dependency array, or drop the seed-id capture
 * that the effect early-returns without, and every one of those helper
 * tests still passes while the bug is fully back.
 *
 * So this test does what the user does: it mounts the criteria form the way
 * the create form remounts it - holding criteria seeded for one monitor
 * type, told it is now showing another - and asserts on what the form hands
 * back to the surrounding form through onChange.
 *
 * MonitorStep is mocked out. What is under test is this component's own
 * seeding and alignment, not the several hundred fields its child renders.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
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

import MonitorStepsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const ONLINE_STATUS_ID: string = "22222222-2222-4222-8222-222222222222";
const OFFLINE_STATUS_ID: string = "33333333-3333-4333-8333-333333333333";
const INCIDENT_SEVERITY_ID: string = "44444444-4444-4444-8444-444444444444";
const ALERT_SEVERITY_ID: string = "55555555-5555-4555-8555-555555555555";

const MONITOR_NAME: string = "Acme";

function listOf<T>(data: Array<T>): unknown {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: 50,
  };
}

function monitorStatus(data: {
  id: string;
  name: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = data.id;
  status.name = data.name;
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

function incidentSeverity(): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = INCIDENT_SEVERITY_ID;
  severity.name = "Critical";
  return severity;
}

function alertSeverity(): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = ALERT_SEVERITY_ID;
  severity.name = "Critical";
  return severity;
}

/*
 * The criteria form fetches statuses, severities, on-call policies, labels,
 * teams and incident roles on mount. Only the first three shape what it
 * seeds; the rest just have to answer.
 */
function mockModelApi(): void {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((request: { modelType: unknown }): never => {
      const modelType: unknown = request.modelType;

      if (modelType === MonitorStatus) {
        return listOf([
          monitorStatus({
            id: ONLINE_STATUS_ID,
            name: "Operational",
            isOperationalState: true,
            isOfflineState: false,
          }),
          monitorStatus({
            id: OFFLINE_STATUS_ID,
            name: "Offline",
            isOperationalState: false,
            isOfflineState: true,
          }),
        ]) as never;
      }

      if (modelType === IncidentSeverity) {
        return listOf([incidentSeverity()]) as never;
      }

      if (modelType === AlertSeverity) {
        return listOf([alertSeverity()]) as never;
      }

      return listOf([]) as never;
    });
}

function seededStepsFor(monitorType: MonitorType): MonitorSteps {
  return MonitorSteps.getDefaultMonitorSteps({
    monitorType: monitorType,
    monitorName: MONITOR_NAME,
    defaultMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
    onlineMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
    offlineMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
    defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
    defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
  });
}

function checksIn(monitorSteps: MonitorSteps): Array<CheckOn> {
  return (monitorSteps.data?.monitorStepsInstanceArray || []).flatMap(
    (monitorStep: MonitorStep) => {
      return (
        monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray ||
        []
      ).flatMap((instance: MonitorCriteriaInstance) => {
        return (instance.data?.filters || []).map((filter: CriteriaFilter) => {
          return filter.checkOn;
        });
      });
    },
  );
}

// The checks in `monitorSteps` that this monitor type's form cannot draw.
function unrenderableChecksIn(
  monitorSteps: MonitorSteps,
  monitorType: MonitorType,
): Array<string> {
  const offered: Array<string> =
    CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).map(
      (option: DropdownOption) => {
        return option.value.toString();
      },
    );

  return checksIn(monitorSteps)
    .map((checkOn: CheckOn) => {
      return checkOn.toString();
    })
    .filter((checkOn: string) => {
      return !offered.includes(checkOn);
    });
}

interface MountedForm {
  // Everything the form has pushed up through onChange, in order.
  changes: Array<MonitorSteps>;
  latest: () => MonitorSteps;
}

/*
 * Mount the criteria form the way the create form remounts it after the
 * user has been away on another step: holding the criteria it seeded
 * earlier, told the monitor type is now something else.
 *
 * Waits for the form to finish loading rather than for its first onChange.
 * The first onChange is the component handing straight back what it was
 * given, which happens on mount, before the statuses and severities it
 * needs have arrived and therefore before it can align anything - so a
 * test that stops there reads the stale value and would pass whether or
 * not the alignment exists.
 */
async function mountWith(data: {
  initialValue?: MonitorSteps | undefined;
  monitorType: MonitorType;
}): Promise<MountedForm> {
  const changes: Array<MonitorSteps> = [];

  render(
    <MonitorStepsElement
      monitorType={data.monitorType}
      monitorName={MONITOR_NAME}
      {...(data.initialValue ? { initialValue: data.initialValue } : {})}
      onChange={(value: MonitorSteps) => {
        changes.push(value);
      }}
    />,
  );

  /*
   * Rendered only once isLoading is false - until then the component is a
   * bare loader.
   */
  await waitFor(() => {
    expect(screen.getByText("Default status")).toBeInTheDocument();
  });

  return {
    changes: changes,
    latest: () => {
      return changes[changes.length - 1]!;
    },
  };
}

describe("the criteria form keeps its criteria in step with the monitor type", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    mockModelApi();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("criteria seeded for a Website do not survive a switch to External Status Page", async () => {
    /*
     * The reported defect, end to end. The user seeded criteria on a
     * Website monitor, went back a step, picked External Status Page, and
     * came forward again - which unmounts and remounts this component with
     * the criteria it seeded the first time round.
     */
    const form: MountedForm = await mountWith({
      initialValue: seededStepsFor(MonitorType.Website),
      monitorType: MonitorType.ExternalStatusPage,
    });

    /*
     * Before the fix the criteria still checked "Is Online" and "Response
     * Status Code", which an External Status Page monitor does not offer,
     * so the Filter Type dropdown rendered react-select's empty
     * "Select...". Without the fix this waits out its timeout and reports
     * exactly which checks were left behind.
     */
    await waitFor(() => {
      expect(
        unrenderableChecksIn(form.latest(), MonitorType.ExternalStatusPage),
      ).toEqual([]);
    });

    /*
     * And the corrected criteria were pushed up to the surrounding form,
     * rather than merely held in this component's own state - that second
     * onChange is what gets saved.
     */
    expect(form.changes.length).toBeGreaterThan(1);
    expect(checksIn(form.latest()).length).toBeGreaterThan(0);
  });

  test("criteria that already suit the monitor type are handed back unchanged", async () => {
    /*
     * The ordinary path - the user never changed their mind. The form must
     * not rewrite criteria that are already right, or every mount would
     * churn their generated ids and dirty an untouched form.
     */
    const seeded: MonitorSteps = seededStepsFor(MonitorType.Website);

    const form: MountedForm = await mountWith({
      initialValue: seeded,
      monitorType: MonitorType.Website,
    });

    expect(form.latest().toJSON()).toEqual(seeded.toJSON());

    /*
     * Exactly one onChange: the component handing back what it was given.
     * A second one would mean it had rewritten criteria that were already
     * correct.
     */
    expect(form.changes).toHaveLength(1);
  });

  test("with no criteria to start from, the form still seeds for the monitor type it was given", async () => {
    // The other way into this component: the criteria step, first visit.
    const form: MountedForm = await mountWith({
      initialValue: undefined,
      monitorType: MonitorType.ExternalStatusPage,
    });

    expect(checksIn(form.latest())).toContain(
      CheckOn.ExternalStatusPageIsOnline,
    );
    expect(
      unrenderableChecksIn(form.latest(), MonitorType.ExternalStatusPage),
    ).toEqual([]);
  });
});
