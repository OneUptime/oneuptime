/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * Wherever something failed, a list says what and why where the reader
 * already is (#9537), not only on the failed thing's own page:
 *
 *   - a host collector config's Hosts tab: "Config failed" says why under
 *     the pill, in the collector's own one line;
 *   - a Kubernetes list: a crash-looping pod's row says how its last run
 *     ended under "CrashLoopBackOff", never the same word twice;
 *   - the Network Overview: "2 down" opens those two devices.
 */

import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesHealthAssessment,
  KubernetesHealthText,
  assessKubernetesResource,
} from "../../../Types/Kubernetes/KubernetesHealth";
import { HostCollectorConfigStatus } from "../../../Types/HostCollector/HostCollector";
import HostCollectorStatePill from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorStatePill";
import { getHostCollectorErrorSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorStatus";
import {
  getKubernetesListStatusReasons,
  kubernetesHealthTextInEnglish,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils";
import {
  DEVICE_STATUS_FACET_KEY,
  DOWN_DEVICES_FACET_SELECTION,
  DeviceStatusFacetValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import { DEVICE_SUMMARY_TILES } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryTiles";

afterEach(() => {
  cleanup();
});

const NOW: Date = new Date();

const FAILED_START: string = [
  "2026-11-01T12:00:00.000Z info service@v0.110.0/service.go:143 Starting otelcol-contrib...",
  '2026-11-01T12:00:01.000Z error Error: cannot start pipelines: failed to start "systemd" receiver: journalctl not found',
].join("\n");

describe("a host collector's pill, in a list of the hosts a config runs on", () => {
  const failedHost: {
    collectorInstanceUid: string;
    collectorLastContactAt: Date;
    collectorConfigStatus: string;
    collectorConfigError: string;
    isCollectorHealthy: boolean;
  } = {
    collectorInstanceUid: "c-1",
    collectorLastContactAt: NOW,
    collectorConfigStatus: HostCollectorConfigStatus.Failed,
    collectorConfigError: FAILED_START,
    isCollectorHealthy: true,
  };

  test("Config failed says why under it: the collector's own one line", () => {
    render(<HostCollectorStatePill host={failedHost} isErrorShown={true} />);

    expect(screen.getByText("Config failed")).toBeInTheDocument();
    const error: HTMLElement = screen.getByTestId("host-collector-error");
    expect(error).toHaveTextContent(
      'cannot start pipelines: failed to start "systemd" receiver: journalctl not found',
    );
    expect(error).toHaveClass("text-red-700");
  });

  test("Collector error says the error the running collector reports, in amber", () => {
    render(
      <HostCollectorStatePill
        host={{
          collectorInstanceUid: "c-1",
          collectorLastContactAt: NOW,
          collectorConfigStatus: HostCollectorConfigStatus.Applied,
          isCollectorHealthy: false,
          collectorHealthError: "exporter otlphttp: 401 Unauthorized",
        }}
        isErrorShown={true}
      />,
    );

    const error: HTMLElement = screen.getByTestId("host-collector-error");
    expect(error).toHaveTextContent("exporter otlphttp: 401 Unauthorized");
    expect(error).toHaveClass("text-amber-700");
  });

  test("where a list does not ask for it, the pill stays a pill", () => {
    render(<HostCollectorStatePill host={failedHost} />);

    expect(screen.getByText("Config failed")).toBeInTheDocument();
    expect(screen.queryByTestId("host-collector-error")).toBeNull();
  });

  test("a running collector, or one whose error was not read, says nothing more", () => {
    expect(
      getHostCollectorErrorSummary({
        collectorInstanceUid: "c-1",
        collectorLastContactAt: NOW,
        collectorConfigStatus: HostCollectorConfigStatus.Applied,
        isCollectorHealthy: true,
        collectorHealthError: "stale error from before",
      }),
    ).toBeNull();
    expect(
      getHostCollectorErrorSummary({
        collectorInstanceUid: "c-1",
        collectorLastContactAt: NOW,
        collectorConfigStatus: HostCollectorConfigStatus.Failed,
      }),
    ).toBeNull();
  });
});

describe("a Kubernetes list row says why under its status", () => {
  function words(reasons: Array<KubernetesHealthText>): Array<string> {
    return reasons.map(kubernetesHealthTextInEnglish);
  }

  function podAssessment(
    status: Record<string, unknown>,
  ): KubernetesHealthAssessment {
    return assessKubernetesResource({
      kind: "Pod",
      namespaceKey: "shop",
      name: "checkout-1",
      phase: String(status["phase"]),
      ownerReferences: { items: [] } as unknown as JSONObject,
      spec: { nodeName: "node-1" } as unknown as JSONObject,
      status: status as unknown as JSONObject,
      lastSeenAt: NOW,
      resourceCreationTimestamp: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
  }

  test("a crash loop: how its last run ended, never CrashLoopBackOff twice", () => {
    const assessment: KubernetesHealthAssessment = podAssessment({
      phase: "Running",
      conditions: [],
      containerStatuses: [
        {
          name: "app",
          ready: false,
          restartCount: 9,
          state: "waiting",
          reason: "CrashLoopBackOff",
          lastTerminationReason: "Error",
          lastTerminationExitCode: 2,
          lastTerminatedAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
        },
      ],
      initContainerStatuses: [],
    });

    expect(kubernetesHealthTextInEnglish(assessment.status)).toBe(
      "CrashLoopBackOff",
    );
    expect(words(getKubernetesListStatusReasons(assessment))).toEqual([
      "Last restart: Error, exit code 2",
    ]);
  });

  test("a failed pod: its container's word and exit code under Failed", () => {
    const assessment: KubernetesHealthAssessment = podAssessment({
      phase: "Failed",
      conditions: [
        {
          type: "Ready",
          status: "False",
          lastTransitionTime: new Date(
            NOW.getTime() - 5 * 60 * 1000,
          ).toISOString(),
        },
      ],
      containerStatuses: [
        {
          name: "app",
          ready: false,
          state: "terminated",
          reason: "Error",
          exitCode: 1,
        },
      ],
      initContainerStatuses: [],
    });

    expect(words(getKubernetesListStatusReasons(assessment))).toEqual([
      "Error, exit code 1",
    ]);
  });

  test("a healthy pod has nothing under its status", () => {
    const assessment: KubernetesHealthAssessment = podAssessment({
      phase: "Running",
      conditions: [{ type: "Ready", status: "True" }],
      containerStatuses: [
        { name: "app", ready: true, state: "running", reason: "" },
      ],
      initContainerStatuses: [],
    });

    expect(getKubernetesListStatusReasons(assessment)).toEqual([]);
  });
});

describe("a count of devices down opens those devices", () => {
  test("the one selection the Devices page's tile and the Network Overview's link share", () => {
    expect(DOWN_DEVICES_FACET_SELECTION).toEqual({
      facetKey: DEVICE_STATUS_FACET_KEY,
      values: [DeviceStatusFacetValue.Down],
      operator: "is",
    });
    expect(
      DEVICE_SUMMARY_TILES.find((tile: { key: string }): boolean => {
        return tile.key === "devices-down";
      })?.selection,
    ).toBe(DOWN_DEVICES_FACET_SELECTION);
  });
});
