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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import Color from "../../../Types/Color";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * "Default Monitor Status" moves under a folded Advanced section.
 *
 * Below every criteria list sat a required dropdown - "What should the monitor
 * status be when none of the above criteria is met?" - that everyone saw and
 * almost nobody changes: a new monitor already falls back to its operational
 * status. It now sits folded under "Advanced", whose header says which status
 * the monitor falls back to, in that status's colour. It stays folded when
 * the status is set (like every Advanced section in the product), and opens
 * by itself when no status is set - the one case the monitor cannot be saved.
 *
 * MonitorStep is mocked out: what is under test is this component's own
 * section, not the criteria cards its child renders.
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
const DELETED_STATUS_ID: string = "99999999-9999-4999-8999-999999999999";
const INCIDENT_SEVERITY_ID: string = "44444444-4444-4444-8444-444444444444";
const ALERT_SEVERITY_ID: string = "55555555-5555-4555-8555-555555555555";

const OPERATIONAL_GREEN: string = "#10b981";
const OFFLINE_RED: string = "#ef4444";

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
  color: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = data.id;
  status.name = data.name;
  status.color = new Color(data.color);
  status.isOperationalState = data.isOperationalState;
  status.isOfflineState = data.isOfflineState;
  return status;
}

const OPERATIONAL: MonitorStatus = monitorStatus({
  id: ONLINE_STATUS_ID,
  name: "Operational",
  color: OPERATIONAL_GREEN,
  isOperationalState: true,
  isOfflineState: false,
});

const OFFLINE: MonitorStatus = monitorStatus({
  id: OFFLINE_STATUS_ID,
  name: "Offline",
  color: OFFLINE_RED,
  isOperationalState: false,
  isOfflineState: true,
});

// The statuses the API answers with; the operational one is left out in one test.
let monitorStatuses: Array<MonitorStatus> = [];

function mockModelApi(): void {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((request: { modelType: unknown }): never => {
      const modelType: unknown = request.modelType;

      if (modelType === MonitorStatus) {
        return listOf(monitorStatuses) as never;
      }

      if (modelType === IncidentSeverity) {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = INCIDENT_SEVERITY_ID;
        severity.name = "Critical";
        return listOf([severity]) as never;
      }

      if (modelType === AlertSeverity) {
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = ALERT_SEVERITY_ID;
        severity.name = "Critical";
        return listOf([severity]) as never;
      }

      return listOf([]) as never;
    });
}

function seededSteps(
  options: { defaultMonitorStatusId?: string } = {},
): MonitorSteps {
  const monitorSteps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
    monitorType: MonitorType.Website,
    monitorName: MONITOR_NAME,
    defaultMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
    onlineMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
    offlineMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
    defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
    defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
  });

  if (options.defaultMonitorStatusId) {
    monitorSteps.setDefaultMonitorStatusId(
      new ObjectID(options.defaultMonitorStatusId),
    );
  }

  return monitorSteps;
}

interface MountedForm {
  changes: Array<MonitorSteps>;
  latest: () => MonitorSteps;
}

async function mountWith(data: {
  initialValue?: MonitorSteps | undefined;
}): Promise<MountedForm> {
  const changes: Array<MonitorSteps> = [];

  render(
    <MonitorStepsElement
      monitorType={MonitorType.Website}
      monitorName={MONITOR_NAME}
      {...(data.initialValue ? { initialValue: data.initialValue } : {})}
      onChange={(value: MonitorSteps) => {
        changes.push(value);
      }}
    />,
  );

  // Drawn once the statuses have loaded; until then it is a loader.
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Advanced" }),
    ).toBeInTheDocument();
  });

  return {
    changes: changes,
    latest: () => {
      return changes[changes.length - 1]!;
    },
  };
}

function advancedHeader(): HTMLElement {
  return screen.getByRole("button", { name: "Advanced" });
}

function advancedBody(): HTMLElement {
  return document.getElementById(
    advancedHeader().getAttribute("aria-controls")!,
  )!;
}

function summary(): HTMLElement | null {
  return screen.queryByTestId("monitor-default-status-summary");
}

function criteriaIn(
  monitorSteps: MonitorSteps,
): Array<MonitorCriteriaInstance> {
  return (monitorSteps.data?.monitorStepsInstanceArray || []).flatMap(
    (monitorStep: MonitorStep) => {
      return (
        monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray ||
        []
      );
    },
  );
}

describe("the default monitor status lives under Advanced", () => {
  beforeEach(() => {
    monitorStatuses = [OPERATIONAL, OFFLINE];
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    mockModelApi();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a new monitor's form shows it folded, saying where the monitor falls back to", async () => {
    await mountWith({});

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(summary()).toHaveTextContent("When no criteria match: Operational");

    // The field is there, folded away: out of sight and out of the tab order.
    const field: HTMLElement = screen.getByTestId(
      "monitor-default-status-field",
    );
    expect(advancedBody()).toContainElement(field);
    expect(advancedBody()).toHaveClass("invisible");
  });

  test("the summary wears the status's colour", async () => {
    await mountWith({});

    const dot: HTMLElement | null = summary()!.querySelector(
      "span[aria-hidden='true']",
    );

    expect(dot).not.toBeNull();
    expect(dot!.style.backgroundColor).toBe("rgb(16, 185, 129)");
  });

  test("opens and folds again from its header", async () => {
    await mountWith({});

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(advancedBody()).not.toHaveClass("invisible");
    expect(
      within(advancedBody()).getByText("Default Monitor Status"),
    ).toBeInTheDocument();
    expect(
      within(advancedBody()).getByText(
        "What should the monitor status be when none of the above criteria is met?",
      ),
    ).toBeInTheDocument();
    // The summary is for the folded header only.
    expect(summary()).toBeNull();

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(summary()).toHaveTextContent("When no criteria match: Operational");
  });

  test("a monitor that falls back to another status stays folded, and says which", async () => {
    await mountWith({
      initialValue: seededSteps({ defaultMonitorStatusId: OFFLINE_STATUS_ID }),
    });

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(summary()).toHaveTextContent("When no criteria match: Offline");

    const dot: HTMLElement | null = summary()!.querySelector(
      "span[aria-hidden='true']",
    );
    expect(dot!.style.backgroundColor).toBe("rgb(239, 68, 68)");
  });

  test("opens by itself when the status it falls back to no longer exists", async () => {
    await mountWith({
      initialValue: seededSteps({ defaultMonitorStatusId: DELETED_STATUS_ID }),
    });

    await waitFor(() => {
      expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    });

    expect(within(advancedBody()).getByRole("alert")).toHaveTextContent(
      "Pick the status the monitor shows when no criteria match.",
    );
  });

  test("opens by itself when the project has no operational status to start from", async () => {
    // Nothing to seed the fallback with, so a new monitor starts without one.
    monitorStatuses = [OFFLINE];

    await mountWith({});

    await waitFor(() => {
      expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    });

    expect(within(advancedBody()).getByRole("alert")).toHaveTextContent(
      "Pick the status the monitor shows when no criteria match.",
    );
  });

  test("a status picked in the open section is what the monitor saves, and what the header says", async () => {
    const form: MountedForm = await mountWith({});

    fireEvent.click(advancedHeader());

    const combobox: HTMLElement = within(
      screen.getByTestId("monitor-default-status-field"),
    ).getByRole("combobox");

    fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /Offline/ }));

    await waitFor(() => {
      expect(form.latest().data?.defaultMonitorStatusId?.toString()).toBe(
        OFFLINE_STATUS_ID,
      );
    });

    fireEvent.click(advancedHeader());

    expect(summary()).toHaveTextContent("When no criteria match: Offline");
    // A picked status is no error.
    expect(within(advancedBody()).queryByRole("alert")).toBeNull();
  });

  test("the required field no longer sits open under the criteria", async () => {
    await mountWith({});

    // The only "Default Monitor Status" on the page is the folded one.
    const labels: Array<HTMLElement> = screen.getAllByText(
      "Default Monitor Status",
    );
    expect(labels).toHaveLength(1);
    expect(advancedBody()).toContainElement(labels[0]!);
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("criteria that arrive without a name are named when the form loads", () => {
  beforeEach(() => {
    monitorStatuses = [OPERATIONAL, OFFLINE];
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    mockModelApi();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("an unnamed criteria gets the name its filters give, the others keep theirs", async () => {
    const initialValue: MonitorSteps = seededSteps();
    const [offline, online] = criteriaIn(initialValue);
    const onlineName: string = online!.data!.name;

    // As the API can store it: no name at all.
    offline!.data!.name = "";

    const form: MountedForm = await mountWith({ initialValue: initialValue });

    await waitFor(() => {
      expect(criteriaIn(form.latest())[0]!.data!.name).not.toBe("");
    });

    const [namedOffline, keptOnline] = criteriaIn(form.latest());

    expect(namedOffline!.data!.name).toBe(
      "Is Online is false or Response Status Code is at least 400 or Response Status Code is below 200",
    );
    expect(keptOnline!.data!.name).toBe(onlineName);
    // The criteria can be saved now; it could not without a name.
    expect(
      MonitorCriteriaInstance.getValidationError(
        namedOffline!,
        MonitorType.Website,
      ),
    ).toBeNull();
    expect(
      MonitorCriteriaInstance.getValidationError(offline!, MonitorType.Website),
    ).toBe("Name is required for every criteria.");
  });

  test("criteria that all have names are handed back untouched", async () => {
    const initialValue: MonitorSteps = seededSteps();

    const form: MountedForm = await mountWith({ initialValue: initialValue });

    expect(form.latest().toJSON()).toEqual(initialValue.toJSON());
    expect(form.changes).toHaveLength(1);
  });
});
