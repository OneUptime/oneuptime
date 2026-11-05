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
  OPENSTACK_LARGE_CLOUD,
  OPENSTACK_MEDIUM_CLOUD,
  OPENSTACK_SMALL_CLOUD,
  OpenStackCloudCounts,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  estimateOpenStackVolume,
  getOpenStackExporterRequestsPerMinute,
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
      expect(view.exporterRequestsPerMinute).toEqual(
        getOpenStackExporterRequestsPerMinute(counts),
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
});

describe("the card", () => {
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
        `openstack-cost-probe-requests-${OpenStackServiceType.Placement}`,
      ).textContent,
    ).toBe("1,001");
    expect(
      screen.getByTestId(
        `openstack-cost-agent-requests-${OpenStackServiceType.Placement}`,
      ).textContent,
    ).toBe("7,501");
    expect(screen.getByTestId("openstack-cost-probe-volume")).toBeTruthy();
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

  test("a new cloud in summary mode says its lists are still filling, and until when", () => {
    const filling: string | null = getOpenStackSummaryModeLine(
      summary([], {
        isSummaryMode: true,
        refreshCycleInMinutes: 44,
        firstCycleEndsAt: new Date(Date.now() + 44 * 60_000).toISOString(),
      }),
      translator,
    );

    expect(filling).toContain("still filling");
    expect(
      getOpenStackSummaryModeLine(
        summary([], { isSummaryMode: true, refreshCycleInMinutes: 44 }),
        translator,
      ),
    ).not.toContain("still filling");
  });
});
