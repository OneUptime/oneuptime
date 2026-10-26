import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Follow-up of #5201: the last line of a cluster's Events page says whether
 * its warnings raise alerts - and, when nothing alerts on them, offers the
 * cluster's Warning Events recommendation, selected, on its
 * Recommendations page. Rendered for real over a fake monitor list.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
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
        return new ObjectIDType("aaaaaaaa-0000-4000-8000-000000000001");
      },
    },
  };
});

import KubernetesWarningEventsAlertLine, {
  KUBERNETES_WARNING_ALERTS_LINE_CLASS_NAME,
  KUBERNETES_WARNING_ALERTS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesWarningEventsAlertLine";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { buildKubernetesWarningEventsLogMonitor } from "../../../Types/Monitor/KubernetesEventAlertTemplates";
import MonitorStepLogMonitor from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

const CLUSTER_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000003",
);
const CLUSTER: string = "aks-prod-westeurope";

function logsMonitor(data: {
  id: string;
  name: string;
  logMonitor: MonitorStepLogMonitor;
  disabled?: boolean;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = data.id;
  monitor.name = data.name;
  monitor.monitorType = MonitorType.Logs;
  monitor.disableActiveMonitoring = data.disabled ?? false;

  const step: MonitorStep = new MonitorStep();
  step.data = { logMonitor: data.logMonitor } as MonitorStep["data"];

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  monitor.monitorSteps = steps;

  return monitor;
}

function arrange(monitors: Array<Monitor>): void {
  getListMock.mockImplementation(async () => {
    return {
      data: monitors,
      count: monitors.length,
      skip: 0,
      limit: 10000,
    };
  });
}

function renderLine(clusterIdentifier: string = CLUSTER): void {
  render(
    <MemoryRouter>
      <KubernetesWarningEventsAlertLine
        clusterId={CLUSTER_ID}
        clusterIdentifier={clusterIdentifier}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("nothing alerts on the cluster's warnings", () => {
  test("offers to turn the warning alerts on, on the cluster's Recommendations with them selected", async () => {
    arrange([]);
    renderLine();

    const line: HTMLElement = await screen.findByTestId(
      KUBERNETES_WARNING_ALERTS_TEST_ID,
    );
    expect(line).toHaveTextContent(
      "Get an alert when Kubernetes reports a warning. Turn on warning alerts",
    );

    const link: HTMLElement = screen.getByTestId(
      `${KUBERNETES_WARNING_ALERTS_TEST_ID}-turn-on`,
    );
    const href: string = link.getAttribute("href") || "";
    const url: URL = new URL(href, "https://oneuptime.example.com");

    expect(url.pathname).toContain(
      `/kubernetes/${CLUSTER_ID.toString()}/recommendations`,
    );
    expect(url.searchParams.get("select")).toBe(
      "Kubernetes:k8s-warning-events",
    );
  });

  test("another cluster's alert, or one that is turned off, is not this cluster's", async () => {
    arrange([
      logsMonitor({
        id: "dddddddd-0000-4000-8000-000000000001",
        name: "Staging warnings",
        logMonitor: buildKubernetesWarningEventsLogMonitor("eks-staging"),
      }),
      logsMonitor({
        id: "dddddddd-0000-4000-8000-000000000002",
        name: "Paused warnings",
        logMonitor: buildKubernetesWarningEventsLogMonitor(CLUSTER),
        disabled: true,
      }),
    ]);
    renderLine();

    expect(
      await screen.findByTestId(`${KUBERNETES_WARNING_ALERTS_TEST_ID}-turn-on`),
    ).toBeInTheDocument();
    expect(screen.queryByText("Staging warnings")).not.toBeInTheDocument();
    expect(screen.queryByText("Paused warnings")).not.toBeInTheDocument();
  });
});

describe("a monitor alerts on the cluster's warnings", () => {
  test("names it, linked to its page, and offers nothing more", async () => {
    arrange([
      logsMonitor({
        id: "dddddddd-0000-4000-8000-000000000010",
        name: "aks-prod-westeurope - Warning Events",
        logMonitor: buildKubernetesWarningEventsLogMonitor(CLUSTER),
      }),
    ]);
    renderLine();

    const line: HTMLElement = await screen.findByTestId(
      KUBERNETES_WARNING_ALERTS_TEST_ID,
    );
    expect(line).toHaveTextContent(
      "Warnings raise alerts through aks-prod-westeurope - Warning Events.",
    );

    const link: HTMLElement = screen.getByTestId(
      `${KUBERNETES_WARNING_ALERTS_TEST_ID}-monitor`,
    );
    expect(
      new URL(link.getAttribute("href") || "", "https://oneuptime.example.com")
        .pathname,
    ).toContain("/monitors/dddddddd-0000-4000-8000-000000000010");
    expect(
      screen.queryByTestId(`${KUBERNETES_WARNING_ALERTS_TEST_ID}-turn-on`),
    ).not.toBeInTheDocument();
  });

  test("several: names the first and counts the rest", async () => {
    arrange([
      logsMonitor({
        id: "dddddddd-0000-4000-8000-000000000011",
        name: "OOM kills",
        logMonitor: {
          ...buildKubernetesWarningEventsLogMonitor(CLUSTER),
          attributes: {
            ...buildKubernetesWarningEventsLogMonitor(CLUSTER).attributes,
            "k8s.event.reason": "OOMKilling",
          },
        },
      }),
      logsMonitor({
        id: "dddddddd-0000-4000-8000-000000000012",
        name: "All warnings",
        logMonitor: buildKubernetesWarningEventsLogMonitor(CLUSTER),
      }),
    ]);
    renderLine();

    expect(
      await screen.findByTestId(KUBERNETES_WARNING_ALERTS_TEST_ID),
    ).toHaveTextContent(
      "Warnings raise alerts through OOM kills and 1 other monitor.",
    );
  });
});

describe("what it reads, and when it says nothing", () => {
  test("reads the project's Logs monitors once, with their steps", async () => {
    arrange([]);
    renderLine();

    await screen.findByTestId(KUBERNETES_WARNING_ALERTS_TEST_ID);

    expect(getListMock).toHaveBeenCalledTimes(1);
    const options: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0] as {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(options.modelType).toBe(Monitor);
    expect(options.query).toEqual({ monitorType: MonitorType.Logs });
    expect(options.select).toEqual(
      expect.objectContaining({
        name: true,
        monitorSteps: true,
        disableActiveMonitoring: true,
      }),
    );
  });

  test("a read that fails - no permission, no network - draws nothing", async () => {
    getListMock.mockImplementation(async () => {
      throw new Error("You do not have permission to read monitors.");
    });
    renderLine();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(
      screen.queryByTestId(KUBERNETES_WARNING_ALERTS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("no cluster identifier yet: reads nothing and draws nothing", async () => {
    arrange([]);
    renderLine("");

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(getListMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(KUBERNETES_WARNING_ALERTS_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

/*
 * #5298's UI review: the line sat right under the events list's "Showing
 * 1-11 of 11 events", in the pager's grey, and read as part of the pager.
 * It is a line of its own under a rule now, in either state.
 */
describe("a line of its own, under a rule", () => {
  function classesOf(element: HTMLElement): Array<string> {
    return element.className.split(" ").filter(Boolean);
  }

  test("the class: a rule above it, room on either side of the rule, no card", () => {
    const classes: Array<string> =
      KUBERNETES_WARNING_ALERTS_LINE_CLASS_NAME.split(" ");

    expect(classes).toEqual(
      expect.arrayContaining(["border-t", "border-gray-100", "mt-5", "pt-4"]),
    );
    // Its words and icon side by side, the icon on the first line.
    expect(classes).toEqual(
      expect.arrayContaining(["flex", "items-start", "gap-2"]),
    );
    // A line, not a box: no background, no rounded border of its own.
    for (const className of classes) {
      expect(className).not.toMatch(/^(bg-|rounded|shadow|border$)/);
    }
  });

  test("offering to turn the alerts on, it is drawn that way", async () => {
    arrange([]);
    renderLine();

    const line: HTMLElement = await screen.findByTestId(
      KUBERNETES_WARNING_ALERTS_TEST_ID,
    );
    expect(classesOf(line)).toEqual(
      KUBERNETES_WARNING_ALERTS_LINE_CLASS_NAME.split(" "),
    );
  });

  test("naming the monitor that alerts, it is drawn the same way", async () => {
    arrange([
      logsMonitor({
        id: "dddddddd-0000-4000-8000-000000000011",
        name: "AKS Production - Warning Events",
        logMonitor: buildKubernetesWarningEventsLogMonitor(CLUSTER),
      }),
    ]);
    renderLine();

    const monitorLink: HTMLElement = await screen.findByTestId(
      KUBERNETES_WARNING_ALERTS_TEST_ID + "-monitor",
    );
    expect(monitorLink).toHaveTextContent("AKS Production - Warning Events");
    expect(
      classesOf(screen.getByTestId(KUBERNETES_WARNING_ALERTS_TEST_ID)),
    ).toEqual(KUBERNETES_WARNING_ALERTS_LINE_CLASS_NAME.split(" "));
  });
});
