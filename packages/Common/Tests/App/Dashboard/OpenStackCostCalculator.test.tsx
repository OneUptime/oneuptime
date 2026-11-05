import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import OpenStackCostCalculator, {
  OpenStackCostView,
  getOpenStackCostView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackCostCalculator";
import {
  OpenStackCollectionSummary,
  OpenStackServiceSummary,
} from "../../../Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
  OpenStackInstanceMetricSource,
  estimateOpenStackInstanceMetricsVolume,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_LARGE_CLOUD,
  OPENSTACK_MEDIUM_CLOUD,
  OPENSTACK_SMALL_CLOUD,
  OpenStackCloudCounts,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  estimateOpenStackVolume,
  getOpenStackProbeRequestsPerMinute,
} from "../../../Types/OpenStack/OpenStackScale";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  getOpenStackGentlerRows,
  getOpenStackSummaryModeLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackProbeCollectionView";

jest.mock("../../../UI/Components/Card/Card", () => {
  return {
    __esModule: true,
    default: (props: { title: string; children: React.ReactNode }) => {
      return (
        <section aria-label={props.title}>
          <h2>{props.title}</h2>
          {props.children}
        </section>
      );
    },
  };
});

/*
 * What the guide shows someone before they install anything, which has to be the same numbers the
 * docs publish and the collector is held to.
 */

describe("the numbers behind the card", () => {
  test.each([
    ["small", OPENSTACK_SMALL_CLOUD],
    ["medium", OPENSTACK_MEDIUM_CLOUD],
    ["large", OPENSTACK_LARGE_CLOUD],
  ])(
    "a %s cloud reads what the scale module says",
    (_size: string, counts: OpenStackCloudCounts) => {
      const view: OpenStackCostView = getOpenStackCostView({
        hypervisors: counts.hypervisors,
        instances: counts.instances,
        projects: counts.projects,
      });

      expect(view.requestsPerMinute).toEqual(
        getOpenStackProbeRequestsPerMinute(counts),
      );
      expect(view.everySeries).toEqual(estimateOpenStackVolume({ counts }));
      expect(view.isSummaryMode).toBe(
        counts.instances > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
      );
    },
  );

  test("a cloud in summary mode costs less than one that keeps every series, and says what it would have", () => {
    const view: OpenStackCostView = getOpenStackCostView({
      hypervisors: OPENSTACK_LARGE_CLOUD.hypervisors,
      instances: OPENSTACK_LARGE_CLOUD.instances,
      projects: OPENSTACK_LARGE_CLOUD.projects,
    });

    expect(view.volume.gigabytesPerDay).toBeLessThan(
      view.everySeries.gigabytesPerDay / 2,
    );
    expect(view.isDatabasePathOffered).toBe(true);
  });

  describe("real usage per instance", () => {
    test.each([
      [100, true],
      [OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT, true],
      [OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT + 1, false],
      [5000, false],
    ])(
      "%i instances are on by default: %s, at the size the agent stops by itself",
      (instances: number, isOn: boolean) => {
        expect(
          getOpenStackCostView({
            hypervisors: 10,
            instances,
            projects: 10,
          }).instanceMetrics.isOnByDefault,
        ).toBe(isOn);
      },
    );

    test("costs what the row count comes to, at the same row size and price as the rest", () => {
      const view: OpenStackCostView = getOpenStackCostView({
        hypervisors: 10,
        instances: 100,
        projects: 10,
      });
      const rows: number = estimateOpenStackInstanceMetricsVolume({
        source: OpenStackInstanceMetricSource.Libvirt,
        instances: 100,
      }).rowsPerHour;
      const expected: number = (rows * 24 * 1024) / (1024 * 1024 * 1024);
      expect(view.instanceMetrics.libvirt.gigabytesPerDay).toBeCloseTo(
        expected,
        6,
      );
      // $0.10 a GB kept 15 days, for 30 days.
      expect(view.instanceMetrics.libvirt.costInUSDPerMonth).toBeCloseTo(
        expected * 0.1 * 30,
        6,
      );
    });

    test("Ceilometer costs less than libvirt, because it adds rows once a poll", () => {
      const view: OpenStackCostView = getOpenStackCostView({
        hypervisors: 10,
        instances: 100,
        projects: 10,
      });
      expect(view.instanceMetrics.ceilometer.rowsPerHour).toBeLessThan(
        view.instanceMetrics.libvirt.rowsPerHour,
      );
    });

    test("an empty cloud costs nothing", () => {
      const view: OpenStackCostView = getOpenStackCostView({
        hypervisors: 0,
        instances: 0,
        projects: 0,
      });
      expect(view.instanceMetrics.libvirt.costInUSDPerMonth).toBe(0);
    });
  });
});

describe("the card", () => {
  test("says what real usage per instance costs from each exporter, and whether a cloud this size gets it", () => {
    render(<OpenStackCostCalculator />);
    // It starts at 2,000 instances, which is past where it stops by itself.
    expect(
      screen.getByTestId("openstack-cost-instance-metrics-libvirt").textContent,
    ).toContain("GB a day");
    expect(
      screen.getByTestId("openstack-cost-instance-metrics-ceilometer")
        .textContent,
    ).toContain("a month");
    expect(
      screen.getByTestId("openstack-cost-instance-metrics-default").textContent,
    ).toContain("keeps only each hypervisor's totals until you choose");

    fireEvent.change(screen.getByTestId("openstack-cost-instances"), {
      target: { value: "100" },
    });
    expect(
      screen.getByTestId("openstack-cost-instance-metrics-default").textContent,
    ).toContain("until it passes 500");
  });

  test("starts on a cloud someone could have, and follows what is typed", () => {
    render(<OpenStackCostCalculator />);

    expect(screen.getByTestId("openstack-cost-calculator")).toBeTruthy();
    expect(screen.queryByTestId("openstack-cost-summary-mode")).toBeNull();
    expect(screen.queryByTestId("openstack-cost-database-path")).toBeNull();

    fireEvent.change(screen.getByTestId("openstack-cost-instances"), {
      target: { value: "200000" },
    });
    fireEvent.change(screen.getByTestId("openstack-cost-hypervisors"), {
      target: { value: "5000" },
    });

    expect(screen.getByTestId("openstack-cost-summary-mode")).toBeTruthy();
    expect(screen.getByTestId("openstack-cost-database-path")).toBeTruthy();
    expect(
      screen.getByTestId(
        `openstack-cost-requests-${OpenStackServiceType.Placement}`,
      ).textContent,
    ).toContain("1,001");
  });
});

describe("what the Data Collection card says", () => {
  const translator: ReturnType<typeof getGlobalTranslator> =
    getGlobalTranslator();

  const service: (
    overrides: Partial<OpenStackServiceSummary>,
  ) => OpenStackServiceSummary = (
    overrides: Partial<OpenStackServiceSummary>,
  ): OpenStackServiceSummary => {
    return {
      service: OpenStackServiceType.Compute,
      regionName: "RegionOne",
      outcome: "Succeeded",
      durationInMs: 1000,
      requestCount: 10,
      ...overrides,
    };
  };

  const summary: (
    services: Array<OpenStackServiceSummary>,
    more?: Partial<OpenStackCollectionSummary>,
  ) => OpenStackCollectionSummary = (
    services: Array<OpenStackServiceSummary>,
    more?: Partial<OpenStackCollectionSummary>,
  ): OpenStackCollectionSummary => {
    return {
      credentialKind: "applicationCredential",
      regionNames: ["RegionOne"],
      services: services,
      hypervisorCount: 1,
      instanceCount: 1,
      networkCount: 1,
      volumeCount: 1,
      projectCount: 1,
      warnings: [],
      ...more,
    };
  };

  test("a service the probe slowed down for is named, with what it waited", () => {
    const rows: ReturnType<typeof getOpenStackGentlerRows> =
      getOpenStackGentlerRows(
        summary([
          service({ slowestAnswerInMs: 8200, pausedForInMs: 41000 }),
          service({ service: OpenStackServiceType.Network }),
        ]),
        translator,
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain("8.2");
    expect(rows[0]?.message).toContain("41");
    expect(rows[0]?.title).toContain("RegionOne");
  });

  test("nothing slowed down, nothing is said", () => {
    expect(getOpenStackGentlerRows(summary([service({})]), translator)).toEqual(
      [],
    );
    expect(getOpenStackGentlerRows(null, translator)).toEqual([]);
  });

  test("a cloud in summary mode says so, and how long a row can go", () => {
    expect(
      getOpenStackSummaryModeLine(
        summary([], { isSummaryMode: true, refreshCycleInMinutes: 44 }),
        translator,
      ),
    ).toContain("44");
    expect(getOpenStackSummaryModeLine(summary([]), translator)).toBeNull();
  });
});
