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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Kubernetes pod / container detail pages render their Logs tab through
 * KubernetesLogsTab. Its locked chips read the cluster's machine identifier
 * ("Cluster: prod-eks-01") although the page had the cluster's name, and the
 * container page's `podName=""` became a `pod.name = ""` filter — logs
 * WITHOUT a pod name — plus an empty "Pod:" chip.
 *
 * The heavy logs viewer is replaced by a probe that records its props; the
 * recorded logQuery / display overrides are then fed through the real chip
 * builder and chip component, so these assert what the user actually reads.
 */

const logsViewerProbe: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so the probe above is still unassigned when the factory runs.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: any) => {
        logsViewerProbe(props);
        return null;
      },
    };
  },
);

import KubernetesLogsTab from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesLogsTab";
import { buildAttributeFilterChips } from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";

type RecordedProps = {
  id: string;
  logQuery: { attributes: Record<string, string> };
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  attributeFilterDisplayValues?: Record<string, string> | undefined;
};

type LastViewerPropsFunction = () => RecordedProps;

const lastViewerProps: LastViewerPropsFunction = (): RecordedProps => {
  const calls: Array<Array<any>> = logsViewerProbe.mock.calls;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![0] as RecordedProps;
};

type ChipsFromPropsFunction = (props: RecordedProps) => Array<ActiveFilter>;

const chipsFromProps: ChipsFromPropsFunction = (
  props: RecordedProps,
): Array<ActiveFilter> => {
  return buildAttributeFilterChips(props.logQuery.attributes, {
    displayKeys: props.attributeFilterDisplayKeys,
    displayValues: props.attributeFilterDisplayValues,
  });
};

type RenderChipsFunction = (filters: Array<ActiveFilter>) => void;

const renderChips: RenderChipsFunction = (
  filters: Array<ActiveFilter>,
): void => {
  render(
    <ActiveFilterChips
      filters={filters}
      onRemove={() => {}}
      onClearAll={() => {}}
    />,
  );
};

describe("KubernetesLogsTab — pod page", () => {
  beforeEach(() => {
    logsViewerProbe.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("filters by the cluster identifier, pod and namespace", () => {
    render(
      <KubernetesLogsTab
        clusterIdentifier="prod-eks-01"
        clusterName="Production EKS"
        podName="api-7d9f8c-abcde"
        namespace="payments"
      />,
    );

    const props: RecordedProps = lastViewerProps();

    expect(props.logQuery.attributes).toEqual({
      "resource.k8s.cluster.name": "prod-eks-01",
      "resource.k8s.pod.name": "api-7d9f8c-abcde",
      "resource.k8s.namespace.name": "payments",
    });
    expect(props.id).toBe("k8s-logs-api-7d9f8c-abcde");
  });

  test("hands the viewer friendly chip keys and the cluster name", () => {
    render(
      <KubernetesLogsTab
        clusterIdentifier="prod-eks-01"
        clusterName="Production EKS"
        podName="api-1"
      />,
    );

    const props: RecordedProps = lastViewerProps();

    expect(props.attributeFilterDisplayKeys).toEqual({
      "resource.k8s.cluster.name": "Cluster",
      "resource.k8s.pod.name": "Pod",
      "resource.k8s.container.name": "Container",
      "resource.k8s.namespace.name": "Namespace",
    });
    expect(props.attributeFilterDisplayValues).toEqual({
      "resource.k8s.cluster.name": "Production EKS",
    });
  });

  test("the rendered cluster chip reads the name, and its filter value stays the identifier", () => {
    render(
      <KubernetesLogsTab
        clusterIdentifier="prod-eks-01"
        clusterName="Production EKS"
        podName="api-1"
        namespace="payments"
      />,
    );

    const chips: Array<ActiveFilter> = chipsFromProps(lastViewerProps());
    cleanup();

    const clusterChip: ActiveFilter | undefined = chips.find(
      (chip: ActiveFilter) => {
        return chip.facetKey === "attributes.resource.k8s.cluster.name";
      },
    );

    expect(clusterChip).toBeDefined();
    expect(clusterChip!.displayKey).toBe("Cluster");
    expect(clusterChip!.displayValue).toBe("Production EKS");
    expect(clusterChip!.value).toBe("prod-eks-01");
    expect(clusterChip!.readOnly).toBe(true);

    renderChips(chips);

    expect(screen.getByText("Production EKS")).toBeInTheDocument();
    expect(screen.queryByText("prod-eks-01")).not.toBeInTheDocument();
    expect(screen.queryByText(/resource\.k8s\./)).not.toBeInTheDocument();
    expect(screen.getByText("api-1")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  test("falls back to the identifier when no cluster name is passed", () => {
    render(
      <KubernetesLogsTab clusterIdentifier="prod-eks-01" podName="api-1" />,
    );

    const props: RecordedProps = lastViewerProps();

    expect(props.attributeFilterDisplayValues).toEqual({
      "resource.k8s.cluster.name": "prod-eks-01",
    });

    const chips: Array<ActiveFilter> = chipsFromProps(props);
    cleanup();
    renderChips(chips);

    expect(screen.getByText("prod-eks-01")).toBeInTheDocument();
  });

  test("updates the chip when the cluster name arrives after the first render", () => {
    const view: ReturnType<typeof render> = render(
      <KubernetesLogsTab clusterIdentifier="prod-eks-01" podName="api-1" />,
    );

    const firstQuery: RecordedProps["logQuery"] = lastViewerProps().logQuery;

    view.rerender(
      <KubernetesLogsTab
        clusterIdentifier="prod-eks-01"
        clusterName="Production EKS"
        podName="api-1"
      />,
    );

    const props: RecordedProps = lastViewerProps();

    expect(props.attributeFilterDisplayValues).toEqual({
      "resource.k8s.cluster.name": "Production EKS",
    });

    /*
     * A display-only change must not hand the viewer a new query object —
     * the viewer refetches when logQuery's identity changes.
     */
    expect(props.logQuery).toBe(firstQuery);
  });
});

describe("KubernetesLogsTab — container page (no pod)", () => {
  beforeEach(() => {
    logsViewerProbe.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  test("regression: an empty podName is not sent as pod.name = ''", () => {
    render(
      <KubernetesLogsTab
        clusterIdentifier="prod-eks-01"
        clusterName="Production EKS"
        podName=""
        containerName="nginx"
      />,
    );

    const props: RecordedProps = lastViewerProps();

    expect(props.logQuery.attributes).toEqual({
      "resource.k8s.cluster.name": "prod-eks-01",
      "resource.k8s.container.name": "nginx",
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        props.logQuery.attributes,
        "resource.k8s.pod.name",
      ),
    ).toBe(false);
  });

  test("renders Cluster and Container chips and no empty Pod chip", () => {
    render(
      <KubernetesLogsTab
        clusterIdentifier="prod-eks-01"
        clusterName="Production EKS"
        podName=""
        containerName="nginx"
      />,
    );

    const chips: Array<ActiveFilter> = chipsFromProps(lastViewerProps());
    cleanup();

    expect(
      chips.map((chip: ActiveFilter) => {
        return [chip.displayKey, chip.displayValue];
      }),
    ).toEqual([
      ["Cluster", "Production EKS"],
      ["Container", "nginx"],
    ]);

    renderChips(chips);

    expect(screen.getByText("Production EKS")).toBeInTheDocument();
    expect(screen.getByText("nginx")).toBeInTheDocument();
    expect(screen.queryByText(/^Pod/)).not.toBeInTheDocument();
  });
});
