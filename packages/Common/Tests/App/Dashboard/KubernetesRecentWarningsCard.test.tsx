import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import {
  KubernetesEventFields,
  issue5179Events,
  normalPodEvent,
} from "../../Helpers/KubernetesEventRecords";
import {
  eventLogStore,
  putEvent,
  resetEventLogStore,
} from "./KubernetesEventsLogStore";

/*
 * A cluster Overview's Recent Warnings (issue #5179): read from the
 * cluster's warning Events alone - never the newest few hundred events of
 * the whole project - one line per reason and object, with how many times
 * it happened, what it says, what it is about, where and who reported it.
 */

const CLUSTER: string = "aks-prod-westeurope";
const CLUSTER_ID: string = "0193c0de-2222-4aaa-8bbb-000000000005";
const NOW: Date = new Date();
const ISSUE_EVENTS: Array<KubernetesEventFields> = issue5179Events(NOW);

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  const store: {
    eventLogStoreGetList: (...args: Array<unknown>) => unknown;
  } = jest.requireActual("./KubernetesEventsLogStore");

  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return store.eventLogStoreGetList(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import KubernetesRecentWarningsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesRecentWarningsCard";
import { KubernetesWarningSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";
import {
  CLUSTER_WARNINGS_WINDOW_IN_HOURS,
  fetchClusterWarningEvents,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher";
import ObjectID from "../../../Types/ObjectID";

function lines(): Array<HTMLElement> {
  return screen.queryAllByTestId("kubernetes-recent-warning");
}

function lineOf(reason: string, objectName: string): HTMLElement {
  const line: HTMLElement | undefined = lines().find(
    (candidate: HTMLElement): boolean => {
      return (
        within(candidate).getByTestId("kubernetes-recent-warning-reason")
          .textContent === reason &&
        (
          within(candidate).getByTestId("kubernetes-recent-warning-object")
            .textContent || ""
        ).includes(objectName)
      );
    },
  );

  if (!line) {
    throw new Error(`No line for ${reason} on ${objectName}`);
  }

  return line;
}

beforeEach(() => {
  resetEventLogStore();
  for (const fields of ISSUE_EVENTS) {
    putEvent(fields, { clusterName: CLUSTER });
  }
  // A busy cluster's Normal events.
  for (let index: number = 0; index < 1500; index++) {
    putEvent(normalPodEvent(index, NOW), { clusterName: CLUSTER });
  }
  // Another cluster's warning.
  putEvent(
    {
      ...ISSUE_EVENTS[0]!,
      uid: "99999999-0000-4000-8000-000000000001",
      reason: "FailedMount",
    },
    { clusterName: "aks-staging" },
  );
});

afterEach(() => {
  cleanup();
});

describe("fetchClusterWarningEvents", () => {
  test("reads the cluster's warnings alone, however busy the cluster is", async () => {
    const warnings: Array<KubernetesWarningSummary> =
      await fetchClusterWarningEvents({
        clusterIdentifier: CLUSTER,
        limit: 10,
      });

    expect(eventLogStore.requests).toHaveLength(1);
    expect(eventLogStore.requests[0]!.attributes).toMatchObject({
      "resource.k8s.cluster.name": CLUSTER,
      "k8s.event.type": "Warning",
    });
    expect(
      warnings.map((warning: KubernetesWarningSummary) => {
        return warning.reason;
      }),
    ).not.toContain("FailedMount");
    // Seven Events: two nodes, two reasons on each of two HPAs.
    expect(warnings).toHaveLength(6);
    expect(CLUSTER_WARNINGS_WINDOW_IN_HOURS).toBe(24);
  });

  test("holds to the limit, newest first", async () => {
    const warnings: Array<KubernetesWarningSummary> =
      await fetchClusterWarningEvents({
        clusterIdentifier: CLUSTER,
        limit: 2,
      });

    expect(
      warnings.map((warning: KubernetesWarningSummary) => {
        return warning.objectName;
      }),
    ).toEqual(["istiod", "istiod"]);
  });

  test("a failed read is no warnings, not a broken Overview", async () => {
    eventLogStore.failNextRead = "timeout";

    await expect(
      fetchClusterWarningEvents({ clusterIdentifier: CLUSTER }),
    ).resolves.toEqual([]);
  });
});

describe("the Recent Warnings card", () => {
  async function renderCard(): Promise<void> {
    const warnings: Array<KubernetesWarningSummary> =
      await fetchClusterWarningEvents({
        clusterIdentifier: CLUSTER,
        limit: 10,
      });

    render(
      <KubernetesRecentWarningsCard
        warnings={warnings}
        isLoading={false}
        clusterId={new ObjectID(CLUSTER_ID)}
      />,
    );
  }

  test("one line per reason and object, with how many times", async () => {
    await renderCard();

    expect(lines()).toHaveLength(6);
    // Two OOM kills on aks-agentpool-...0: 2 + 1 times.
    expect(
      within(
        lineOf("OOMKilling", "aks-agentpool-19172126-vmss000000"),
      ).getByTestId("kubernetes-recent-warning-count"),
    ).toHaveTextContent("3 times");
    // Once is said by the line alone.
    expect(
      within(lineOf("FailedGetResourceMetric", "nginx")).queryByTestId(
        "kubernetes-recent-warning-count",
      ),
    ).toBeNull();
  });

  test("what it says, what it is about, where, and who reported it", async () => {
    await renderCard();

    const oom: HTMLElement = lineOf(
      "OOMKilling",
      "aks-userpool-11935137-vmss00000o",
    );
    expect(
      within(oom).getByTestId("kubernetes-recent-warning-message"),
    ).toHaveTextContent("Memory cgroup out of memory");
    expect(
      within(oom).getByTestId("kubernetes-recent-warning-namespace"),
    ).toHaveTextContent("default");
    expect(
      within(oom).getByTestId("kubernetes-recent-warning-source"),
    ).toHaveTextContent(
      "Reported by kernel-monitor · aks-userpool-11935137-vmss00000o",
    );
    expect(
      within(oom)
        .getByRole("link", { name: "aks-userpool-11935137-vmss00000o" })
        .getAttribute("href"),
    ).toContain(
      `/kubernetes/${CLUSTER_ID}/nodes/aks-userpool-11935137-vmss00000o`,
    );

    const hpa: HTMLElement = lineOf("FailedComputeMetricsReplicas", "istiod");
    expect(
      within(hpa).getByTestId("kubernetes-recent-warning-namespace"),
    ).toHaveTextContent("aks-istio-system");
    expect(
      within(hpa).getByRole("link", { name: "istiod" }).getAttribute("href"),
    ).toContain(`/kubernetes/${CLUSTER_ID}/hpas/istiod`);
  });

  test("View all warnings opens the cluster's Events page", async () => {
    await renderCard();

    expect(
      screen
        .getByTestId("kubernetes-recent-warnings-view-all")
        .getAttribute("href"),
    ).toContain(`/kubernetes/${CLUSTER_ID}/events`);
  });

  test("while reading: the card and a loader; with no warnings: nothing", () => {
    const { rerender } = render(
      <KubernetesRecentWarningsCard
        warnings={[]}
        isLoading={true}
        clusterId={new ObjectID(CLUSTER_ID)}
      />,
    );

    expect(screen.getByText("Recent Warnings")).toBeInTheDocument();

    rerender(
      <KubernetesRecentWarningsCard
        warnings={[]}
        isLoading={false}
        clusterId={new ObjectID(CLUSTER_ID)}
      />,
    );

    expect(screen.queryByText("Recent Warnings")).toBeNull();
  });
});
