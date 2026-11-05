import {
  OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS,
  OPENSTACK_BARE_METAL_STUCK_MINUTES,
  OPENSTACK_QUIET_SERVICE_MINUTES,
  canOpenStackBareMetalNodeTakeAnInstance,
  isOpenStackBareMetalMaintenanceTooLong,
  isOpenStackBareMetalNodeId,
  isOpenStackBareMetalNodeInError,
  isOpenStackBareMetalNodeInMaintenance,
  isOpenStackBareMetalNodeStuck,
  isOpenStackBareMetalPowerUnexpected,
  isOpenStackServiceQuiet,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_BARE_METAL_ERROR_STATES,
  OPENSTACK_BARE_METAL_IN_MAINTENANCE,
  OPENSTACK_BARE_METAL_IN_SERVICE,
  OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
  OPENSTACK_SERVICES_EVERY_CLOUD_RUNS,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

const NOW: Date = new Date("2026-11-05T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("which words say a node failed", () => {
  test.each([
    ["deploy failed", true],
    ["clean failed", true],
    ["inspect failed", true],
    ["adopt failed", true],
    ["rescue failed", true],
    ["unrescue failed", true],
    ["service failed", true],
    // A failed teardown, which is the one word for failing without "failed" in it.
    ["error", true],
    ["available", false],
    ["active", false],
    ["enroll", false],
    ["manageable", false],
    ["wait call-back", false],
    ["clean wait", false],
    ["deploy hold", false],
    ["", false],
    [null, false],
    [undefined, false],
    // Case matters: it is compared with what Ironic says, and Ironic says these in lower case.
    ["Clean Failed", false],
  ] as Array<[string | null | undefined, boolean]>)(
    "%s: %s",
    (status: string | null | undefined, failed: boolean) => {
      expect(isOpenStackBareMetalNodeInError(status)).toBe(failed);
    },
  );

  test("no word is both failed and on its way", () => {
    for (const word of OPENSTACK_BARE_METAL_ERROR_STATES) {
      expect(OPENSTACK_BARE_METAL_TRANSITIONAL_STATES.has(word)).toBe(false);
    }
  });
});

describe("stuck", () => {
  const onItsWay: Array<string> = Array.from(
    OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
  );

  test.each(onItsWay)("%s: stuck at the line and not before it", (status) => {
    const under: boolean = isOpenStackBareMetalNodeStuck({
      status,
      stateChangedAt: minutesAgo(OPENSTACK_BARE_METAL_STUCK_MINUTES - 1),
      now: NOW,
    });
    const at: boolean = isOpenStackBareMetalNodeStuck({
      status,
      stateChangedAt: minutesAgo(OPENSTACK_BARE_METAL_STUCK_MINUTES),
      now: NOW,
    });

    expect([under, at]).toEqual([false, true]);
  });

  test.each([
    "available",
    "active",
    "enroll",
    "manageable",
    "clean failed",
    // Where a step someone wrote asked Ironic to wait: as long as they like.
    "deploy hold",
    "clean hold",
    "service hold",
  ])("%s never is, however long it has been", (status: string) => {
    expect(
      isOpenStackBareMetalNodeStuck({
        status,
        stateChangedAt: minutesAgo(100000),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("Ironic's own time wins over when a read noticed, either way", () => {
    // A long erase heartbeats: a read noticed it hours ago, and Ironic saw it move just now.
    expect(
      isOpenStackBareMetalNodeStuck({
        status: "clean wait",
        stateChangedAt: minutesAgo(600),
        provisionUpdatedAt: minutesAgo(3),
        now: NOW,
      }),
    ).toBe(false);
    // Stuck long before anyone was watching.
    expect(
      isOpenStackBareMetalNodeStuck({
        status: "deploying",
        stateChangedAt: minutesAgo(2),
        provisionUpdatedAt: minutesAgo(600),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("a node someone put in maintenance is planned, whatever word it stopped at", () => {
    expect(
      isOpenStackBareMetalNodeStuck({
        status: "clean wait",
        adminState: OPENSTACK_BARE_METAL_IN_MAINTENANCE,
        stateChangedAt: minutesAgo(600),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("with no time at all it cannot be said", () => {
    expect(
      isOpenStackBareMetalNodeStuck({ status: "deploying", now: NOW }),
    ).toBe(false);
    expect(
      isOpenStackBareMetalNodeStuck({
        status: "deploying",
        stateChangedAt: "not a date",
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("in maintenance too long", () => {
  const line: number = OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS * 24 * 60;

  test("at the line and not before it", () => {
    expect(
      isOpenStackBareMetalMaintenanceTooLong({
        adminState: OPENSTACK_BARE_METAL_IN_MAINTENANCE,
        stateChangedAt: minutesAgo(line - 1),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isOpenStackBareMetalMaintenanceTooLong({
        adminState: OPENSTACK_BARE_METAL_IN_MAINTENANCE,
        stateChangedAt: minutesAgo(line),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("a node in service never is", () => {
    expect(
      isOpenStackBareMetalMaintenanceTooLong({
        adminState: OPENSTACK_BARE_METAL_IN_SERVICE,
        stateChangedAt: minutesAgo(line * 10),
        now: NOW,
      }),
    ).toBe(false);
    expect(isOpenStackBareMetalNodeInMaintenance(null)).toBe(false);
  });
});

describe("power state unexpected", () => {
  test.each([
    // A deployed node, off: whatever runs on it stopped.
    ["active", "power off", undefined, undefined, true],
    ["active", "power off", undefined, "ACTIVE", true],
    ["active", "power off", undefined, null, true],
    // Unless someone stopped the instance on it, which powers it off through Nova.
    ["active", "power off", undefined, "SHUTOFF", false],
    // Or put it in maintenance.
    [
      "active",
      "power off",
      OPENSTACK_BARE_METAL_IN_MAINTENANCE,
      undefined,
      false,
    ],
    ["active", "power on", undefined, undefined, false],
    // Going to be one or the other: nothing to say yet.
    ["active", "rebooting", undefined, undefined, false],
    ["active", "soft power off", undefined, undefined, false],
    // Not known is not wrong: `available` nodes read None until something sets it (recorded).
    ["active", null, undefined, undefined, false],
    ["available", null, undefined, undefined, false],
    // A failed deploy leaves it on (recorded), and a node between deploys may stay on or off.
    ["deploy failed", "power on", undefined, undefined, false],
    ["available", "power on", undefined, undefined, false],
    ["available", "power off", undefined, undefined, false],
    ["manageable", "power off", undefined, undefined, false],
  ] as Array<
    [
      string,
      string | null,
      string | undefined,
      string | null | undefined,
      boolean,
    ]
  >)(
    "%s, %s, %s, instance %s: %s",
    (
      status: string,
      powerState: string | null,
      adminState: string | undefined,
      instanceStatus: string | null | undefined,
      expected: boolean,
    ) => {
      expect(
        isOpenStackBareMetalPowerUnexpected({
          status,
          powerState,
          adminState,
          instanceStatus,
        }),
      ).toBe(expected);
    },
  );
});

describe("whether Nova could put an instance on a node", () => {
  test.each([
    ["available", undefined, "power off", false, true],
    ["available", undefined, "power on", false, true],
    // What Nova's Ironic driver reports reserved for (_node_resources_unavailable).
    [
      "available",
      OPENSTACK_BARE_METAL_IN_MAINTENANCE,
      "power off",
      false,
      false,
    ],
    ["available", undefined, null, false, false],
    ["available", undefined, "error", false, false],
    ["active", undefined, "power on", false, false],
    ["manageable", undefined, "power off", false, false],
    ["clean failed", undefined, "power off", false, false],
    // On its way out: Ironic will not make it available again.
    ["available", undefined, "power off", true, false],
  ] as Array<[string, string | undefined, string | null, boolean, boolean]>)(
    "%s, %s, %s, retired %s: %s",
    (
      status: string,
      adminState: string | undefined,
      powerState: string | null,
      isRetired: boolean,
      expected: boolean,
    ) => {
      expect(
        canOpenStackBareMetalNodeTakeAnInstance({
          status,
          adminState,
          powerState,
          isRetired,
        }),
      ).toBe(expected);
    },
  );
});

describe("a node's UUID, which is what Nova and Placement call it", () => {
  test.each([
    ["1062b540-62b5-44a7-805f-212d8778807c", true],
    ["1062B540-62B5-44A7-805F-212D8778807C", true],
    // What other drivers call a hypervisor.
    ["compute-01", false],
    ["compute-01.example.internal", false],
    ["domain-c7.1062b540-62b5-44a7-805f-212d8778807c", false],
    // The right length, in the wrong shape.
    ["1062b540162b5144a71805f1212d8778807c", false],
    ["1062b540-62b5-44a7-805f-212d8778807g", false],
    ["1062b540-62b5-44a7-805f-212d8778807", false],
    ["1062b540-62b5-44a7-805f-212d8778807cc", false],
    ["", false],
    [null, false],
    [undefined, false],
  ] as Array<[string | null | undefined, boolean]>)(
    "%s: %s",
    (name: string | null | undefined, expected: boolean) => {
      expect(isOpenStackBareMetalNodeId(name)).toBe(expected);
    },
  );

  test("reads nothing past 36 characters, whatever it is handed", () => {
    const long: string = "a".repeat(16 * 1024 * 1024);
    const started: number = Date.now();

    expect(isOpenStackBareMetalNodeId(long)).toBe(false);
    expect(Date.now() - started).toBeLessThan(50);
  });

  test("anything else of its length is refused, on any bytes", () => {
    const texts: Array<string> = generatedTexts(20000, 5742, [
      "a",
      "0",
      "-",
      "Z",
      "é",
      " ",
      "\n",
      "%",
      "1062b540",
      "62b5",
      "-44a7-",
      "212d8778807c",
    ]);

    for (const text of texts) {
      const isUuidShaped: boolean =
        text.length === 36 &&
        text.split("-").length === 5 &&
        text
          .split("-")
          .map((group: string): number => {
            return group.length;
          })
          .join() === "8,4,4,4,12" &&
        !(/[^a-fA-F0-9-]/).test(text);

      expect(isOpenStackBareMetalNodeId(text)).toBe(isUuidShaped);
    }
  });
});

describe("a service going quiet", () => {
  test("a service a cloud may not run goes quiet at the line", () => {
    const reading: { service: string; now: Date } = {
      service: OpenStackServiceType.BareMetal,
      now: NOW,
    };

    expect(
      isOpenStackServiceQuiet({
        ...reading,
        lastSeenAt: minutesAgo(OPENSTACK_QUIET_SERVICE_MINUTES - 1),
      }),
    ).toBe(false);
    expect(
      isOpenStackServiceQuiet({
        ...reading,
        lastSeenAt: minutesAgo(OPENSTACK_QUIET_SERVICE_MINUTES),
      }),
    ).toBe(true);
  });

  test("the line holds three of its collections, which are 5 minutes apart", () => {
    expect(OPENSTACK_QUIET_SERVICE_MINUTES).toBeGreaterThanOrEqual(3 * 5);
  });

  test.each(Array.from(OPENSTACK_SERVICES_EVERY_CLOUD_RUNS))(
    "%s never does: every cloud runs it, and a read of it says its own 0",
    (service: string) => {
      expect(
        isOpenStackServiceQuiet({
          service,
          lastSeenAt: minutesAgo(100000),
          now: NOW,
        }),
      ).toBe(false);
    },
  );

  test("nothing to go on, nothing to say", () => {
    expect(
      isOpenStackServiceQuiet({
        service: OpenStackServiceType.BareMetal,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isOpenStackServiceQuiet({ lastSeenAt: minutesAgo(1000), now: NOW }),
    ).toBe(false);
  });
});
