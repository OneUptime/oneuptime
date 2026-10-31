import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceScope,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Kubernetes monitor scoped to one workload. The form asked only for the
 * Workload Name and never set its kind, and the worker applied the filter
 * only when both were set: a monitor scoped to "checkout" watched every
 * workload in the cluster. The form now asks for the kind beside the name,
 * starting on Deployment, and the name always travels with a kind.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

// The query builder and its charts: not what this suite is about.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metric-view" });
      },
    };
  },
);

import KubernetesMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm";

function openAdvanced(
  resourceFilters: MonitorStepKubernetesMonitor["resourceFilters"],
  onChange: (value: MonitorStepKubernetesMonitor) => void = (): void => {},
): void {
  render(
    <KubernetesMonitorStepForm
      monitorStepKubernetesMonitor={{
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod",
        resourceScope: KubernetesResourceScope.Workload,
        resourceFilters: resourceFilters,
      }}
      onChange={onChange}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
}

function lastChange(onChange: MockFunction): MonitorStepKubernetesMonitor {
  const calls: Array<Array<unknown>> = onChange.mock.calls;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![0] as MonitorStepKubernetesMonitor;
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
});

afterEach(() => {
  cleanup();
});

describe("Kubernetes monitor form - a workload is named with its kind", () => {
  test("Workload Kind sits beside Workload Name and starts on Deployment", () => {
    openAdvanced({});

    expect(screen.getByText("Workload Kind")).toBeInTheDocument();
    expect(screen.getByText("Workload Name")).toBeInTheDocument();
    expect(screen.getByText("Deployment")).toBeInTheDocument();
  });

  test("typing a name saves it with the kind, Deployment unless one was picked", () => {
    const onChange: MockFunction = getJestMockFunction();

    openAdvanced({}, onChange);

    fireEvent.change(screen.getByPlaceholderText("e.g. my-deployment"), {
      target: { value: "checkout" },
    });

    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadName: "checkout",
      workloadType: "deployment",
    });
  });

  test("a kind already picked stays with the name", () => {
    const onChange: MockFunction = getJestMockFunction();

    openAdvanced({ workloadType: "statefulset" }, onChange);

    fireEvent.change(screen.getByPlaceholderText("e.g. my-deployment"), {
      target: { value: "postgres" },
    });

    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadName: "postgres",
      workloadType: "statefulset",
    });
    expect(screen.getByText("StatefulSet")).toBeInTheDocument();
  });
});
