import {
  OPENSTACK_LOAD_BALANCER_STUCK_MINUTES,
  isOpenStackAmphoraInError,
  isOpenStackLoadBalancerInError,
  isOpenStackLoadBalancerStuck,
  isOpenStackPoolWithoutHealthyMembers,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_KINDS_BY_SERVICE,
  OPENSTACK_SERVICE_TITLES,
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  getOpenStackOptionalService,
  getOpenStackOptionalServicesOf,
  hasOpenStackOptionalServiceLeft,
} from "../../../Types/OpenStack/OpenStackOptionalServices";

const NOW: Date = new Date("2026-11-05T12:00:00Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60000);
}

describe("Octavia's rules", () => {
  test.each([
    ["ERROR", true],
    ["ACTIVE", false],
    ["PENDING_UPDATE", false],
    ["PENDING_CREATE", false],
    ["PENDING_DELETE", false],
    ["DELETED", false],
    ["error", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])(
    "a load balancer reading %p is in error: %p",
    (status: string | null | undefined, expected: boolean) => {
      expect(isOpenStackLoadBalancerInError(status)).toBe(expected);
    },
  );

  test.each([
    ["PENDING_CREATE", 59, false],
    ["PENDING_CREATE", 60, true],
    ["PENDING_UPDATE", 61, true],
    ["PENDING_DELETE", 600, true],
    ["ACTIVE", 6000, false],
    ["ERROR", 6000, false],
    ["DELETED", 6000, false],
    ["pending_update", 6000, false],
    [undefined, 6000, false],
  ])(
    "a load balancer reading %p for %p minutes is stuck: %p",
    (status: string | undefined, minutes: number, expected: boolean) => {
      expect(
        isOpenStackLoadBalancerStuck({
          status,
          stateChangedAt: minutesAgo(minutes),
          now: NOW,
        }),
      ).toBe(expected);
    },
  );

  test("one that nobody knows the time of is not called stuck, and nor is one with a date that is no date", () => {
    for (const stateChangedAt of [null, undefined, "", "not a date"]) {
      expect(
        isOpenStackLoadBalancerStuck({
          status: "PENDING_UPDATE",
          stateChangedAt,
          now: NOW,
        }),
      ).toBe(false);
    }
  });

  test("an hour is the line, as Canonical's own rule has it", () => {
    expect(OPENSTACK_LOAD_BALANCER_STUCK_MINUTES).toBe(60);
  });

  test.each([
    ["ERROR", true],
    ["DEGRADED", false],
    ["OFFLINE", false],
    ["ONLINE", false],
    ["NO_MONITOR", false],
    ["DRAINING", false],
    [null, false],
  ])(
    "a pool whose operating status is %p has no healthy member: %p",
    (status: string | null, expected: boolean) => {
      expect(isOpenStackPoolWithoutHealthyMembers(status)).toBe(expected);
    },
  );

  test.each([
    ["ERROR", true],
    ["ALLOCATED", false],
    ["READY", false],
    ["BOOTING", false],
    ["PENDING_DELETE", false],
    [undefined, false],
  ])(
    "an amphora reading %p is in error: %p",
    (status: string | undefined, expected: boolean) => {
      expect(isOpenStackAmphoraInError(status)).toBe(expected);
    },
  );
});

describe("Octavia is a service a cloud may not run", () => {
  test("is one, whose stopped API reads as nothing rather than as 0", () => {
    const entry: ReturnType<typeof getOpenStackOptionalService> =
      getOpenStackOptionalService(OpenStackServiceType.LoadBalancer);

    expect(entry?.upMetricName).toBe("openstack_loadbalancer_up");
    expect(entry?.isEmptyWhenStopped).toBe(true);
  });

  test("a cloud runs it only when its rows say so", () => {
    expect(getOpenStackOptionalServicesOf(["compute", "network"])).toEqual([]);
    expect(
      getOpenStackOptionalServicesOf(["compute", "load-balancer"]),
    ).toEqual([OpenStackServiceType.LoadBalancer]);
  });

  test("names three kinds and a title", () => {
    expect(
      OPENSTACK_KINDS_BY_SERVICE[OpenStackServiceType.LoadBalancer],
    ).toEqual([
      OpenStackResourceKind.LoadBalancer,
      OpenStackResourceKind.LoadBalancerPool,
      OpenStackResourceKind.Amphora,
    ]);
    expect(OPENSTACK_SERVICE_TITLES[OpenStackServiceType.LoadBalancer]).toBe(
      "Load Balancers (Octavia)",
    );
  });

  test("its rows go once the rest of the cloud has answered for 15 minutes since it went empty", () => {
    expect(
      hasOpenStackOptionalServiceLeft({
        emptySince: minutesAgo(16),
        coreAnsweredAt: NOW,
        windowInMinutes: 10,
      }),
    ).toBe(true);
    expect(
      hasOpenStackOptionalServiceLeft({
        emptySince: minutesAgo(14),
        coreAnsweredAt: NOW,
        windowInMinutes: 10,
      }),
    ).toBe(false);
  });
});
