import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  OPENSTACK_DISABLED_LABEL,
  OPENSTACK_LOST_LABEL,
  OPENSTACK_SCRAPE_FAILED_REASON,
  OPENSTACK_STUCK_LABEL,
  OPENSTACK_STATUS_WORDS,
  OpenStackStatusReading,
  getOpenStackStatusReading,
  isOpenStackAdminDisabled,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackStatus";
import OpenStackStatusCell, {
  toOpenStackStatusResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackStatusCell";
import { getResourceStatusLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

/*
 * How a row's state reads in an OpenStack list. Two things must hold whatever else
 * changes:
 *
 *  - Planned work never reads as a failure. A service someone disabled, or a Neutron
 *    agent with its admin state down, reads Disabled with the operator's reason,
 *    whatever its state says. Most disabled services are down: that is why they were
 *    disabled. #5433 found an alert that paged on planned shutdowns.
 *  - A status word stays OpenStack's own, in every language: ACTIVE is what
 *    `openstack server list` shows the same person.
 */

afterEach(() => {
  cleanup();
});

function readingOf(data: {
  kind: OpenStackResourceKind;
  status?: string;
  adminState?: string;
  disabledReason?: string;
  isScrapeFailed?: boolean;
  stateChangedAt?: Date;
  now?: Date;
}): OpenStackStatusReading {
  const reading: OpenStackStatusReading | null = getOpenStackStatusReading({
    ...data,
    status: data.status,
  });

  if (!reading) {
    throw new Error("Expected a reading");
  }

  return reading;
}

describe("a disabled service never reads as a failure", () => {
  test.each([
    ["Nova, disabled and down", "down", "disabled"],
    ["Nova, disabled and still up", "up", "disabled"],
    ["Neutron, admin state down and not alive", "down", "down"],
    ["Neutron, admin state down and alive", "up", "down"],
  ])(
    "%s reads Disabled",
    (_name: string, status: string, adminState: string) => {
      const reading: OpenStackStatusReading = readingOf({
        kind: OpenStackResourceKind.Service,
        status,
        adminState,
      });

      expect(reading.label).toBe("Disabled");
      expect(reading.tone).toBe("neutral");
      expect(reading.tone).not.toBe("danger");
      expect(reading.tone).not.toBe("warning");
    },
  );

  test("it carries the operator's reason, as they wrote it", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Service,
      status: "down",
      adminState: "disabled",
      disabledReason: "  Hardware swap, CHG-1042  ",
    });

    expect(reading.writtenReason).toBe("Hardware swap, CHG-1042");
    expect(reading.reasonKey).toBeUndefined();
  });

  test("a disabled service with no reason says only Disabled", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Service,
      status: "down",
      adminState: "disabled",
    });

    expect(reading.writtenReason).toBeUndefined();
  });

  test("the word is case-blind, as the exporter's labels are not promised", () => {
    expect(isOpenStackAdminDisabled("Disabled")).toBe(true);
    expect(isOpenStackAdminDisabled("DOWN")).toBe(true);
    expect(isOpenStackAdminDisabled(" down ")).toBe(true);
    expect(isOpenStackAdminDisabled("enabled")).toBe(false);
    expect(isOpenStackAdminDisabled("up")).toBe(false);
    expect(isOpenStackAdminDisabled(undefined)).toBe(false);
    expect(isOpenStackAdminDisabled(null)).toBe(false);
  });

  test("a router someone set down is planned too", () => {
    expect(
      readingOf({
        kind: OpenStackResourceKind.Router,
        status: "ACTIVE",
        adminState: "down",
      }).label,
    ).toBe("Disabled");
  });
});

describe("an enabled service that stops is a failure", () => {
  test.each([
    ["Nova", "enabled"],
    ["Neutron", "up"],
    ["no admin state reported", undefined],
  ])("%s, down, reads down in red", (_name: string, adminState?: string) => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Service,
      status: "down",
      ...(adminState ? { adminState } : {}),
    });

    expect(reading.label).toBe("down");
    expect(reading.tone).toBe("danger");
  });

  test("up reads up, in green", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Service,
      status: "up",
      adminState: "enabled",
    });

    expect(reading.label).toBe("up");
    expect(reading.tone).toBe("positive");
  });

  test("an API down says when the agent's read is why", () => {
    expect(
      readingOf({
        kind: OpenStackResourceKind.Api,
        status: "down",
        isScrapeFailed: true,
      }).reasonKey,
    ).toBe(OPENSTACK_SCRAPE_FAILED_REASON);

    expect(
      readingOf({
        kind: OpenStackResourceKind.Api,
        status: "down",
      }).reasonKey,
    ).toBeUndefined();

    expect(
      readingOf({
        kind: OpenStackResourceKind.Api,
        status: "up",
        isScrapeFailed: true,
      }).reasonKey,
    ).toBeUndefined();
  });
});

describe("each family keeps its own words, with its own tones", () => {
  test.each([
    // Nova.
    [OpenStackResourceKind.Instance, "ACTIVE", "positive"],
    [OpenStackResourceKind.Instance, "ERROR", "danger"],
    [OpenStackResourceKind.Instance, "SHUTOFF", "neutral"],
    [OpenStackResourceKind.Instance, "PAUSED", "neutral"],
    [OpenStackResourceKind.Instance, "SUSPENDED", "neutral"],
    [OpenStackResourceKind.Instance, "SHELVED_OFFLOADED", "neutral"],
    [OpenStackResourceKind.Instance, "BUILD", "warning"],
    [OpenStackResourceKind.Instance, "BUILD(spawning)", "warning"],
    [OpenStackResourceKind.Instance, "REBOOT", "warning"],
    [OpenStackResourceKind.Instance, "VERIFY_RESIZE", "warning"],
    [OpenStackResourceKind.Instance, "UNKNOWN", "warning"],
    // Cinder.
    [OpenStackResourceKind.Volume, "available", "positive"],
    [OpenStackResourceKind.Volume, "in-use", "positive"],
    [OpenStackResourceKind.Volume, "error", "danger"],
    [OpenStackResourceKind.Volume, "error_deleting", "danger"],
    [OpenStackResourceKind.Volume, "attaching", "warning"],
    [OpenStackResourceKind.Volume, "creating", "warning"],
    // Glance.
    [OpenStackResourceKind.Image, "active", "positive"],
    [OpenStackResourceKind.Image, "killed", "danger"],
    [OpenStackResourceKind.Image, "saving", "warning"],
    [OpenStackResourceKind.Image, "deactivated", "neutral"],
    // Neutron.
    [OpenStackResourceKind.Network, "ACTIVE", "positive"],
    [OpenStackResourceKind.Network, "ERROR", "danger"],
    [OpenStackResourceKind.Network, "BUILD", "warning"],
    [OpenStackResourceKind.Router, "ACTIVE", "positive"],
    [OpenStackResourceKind.Router, "ERROR", "danger"],
    [OpenStackResourceKind.FloatingIp, "ACTIVE", "positive"],
    [OpenStackResourceKind.FloatingIp, "ERROR", "danger"],
    // A floating IP with nothing behind it is DOWN, and nothing is wrong.
    [OpenStackResourceKind.FloatingIp, "DOWN", "neutral"],
    // Keystone.
    [OpenStackResourceKind.Project, "enabled", "positive"],
    [OpenStackResourceKind.Project, "disabled", "neutral"],
    // A word this list does not know is shown, and is not called a failure.
    [OpenStackResourceKind.Instance, "SOMETHING_NEW", "neutral"],
    [OpenStackResourceKind.Volume, "something-new", "neutral"],
    [OpenStackResourceKind.Service, "maybe", "neutral"],
  ] as Array<[OpenStackResourceKind, string, string]>)(
    "%s %s reads as it is, %s",
    (kind: OpenStackResourceKind, status: string, tone: string) => {
      const reading: OpenStackStatusReading = readingOf({ kind, status });

      expect(reading.label).toBe(status);
      expect(reading.tone).toBe(tone);
      expect(reading.isOpenStackWord).toBe(true);
    },
  );

  test("a row with no state has no reading, rather than a guess", () => {
    expect(
      getOpenStackStatusReading({
        kind: OpenStackResourceKind.Hypervisor,
        status: undefined,
      }),
    ).toBeNull();
    expect(
      getOpenStackStatusReading({
        kind: OpenStackResourceKind.StoragePool,
        status: "  ",
      }),
    ).toBeNull();
  });

  test.each(
    Object.keys(OPENSTACK_STATUS_WORDS) as Array<OpenStackResourceKind>,
  )("the %s filter offers no word twice", (kind: OpenStackResourceKind) => {
    const words: ReadonlyArray<string> = OPENSTACK_STATUS_WORDS[kind] || [];

    expect(words.length).toBeGreaterThan(1);
    expect(new Set(words).size).toBe(words.length);
  });

  test("the filters offer the words the rules read", () => {
    const instance: ReadonlyArray<string> =
      OPENSTACK_STATUS_WORDS[OpenStackResourceKind.Instance] || [];
    const volume: ReadonlyArray<string> =
      OPENSTACK_STATUS_WORDS[OpenStackResourceKind.Volume] || [];

    for (const word of ["ACTIVE", "ERROR", "SHUTOFF", "BUILD"]) {
      expect(instance).toContain(word);
    }
    for (const word of ["available", "in-use", "error", "attaching"]) {
      expect(volume).toContain(word);
    }
  });
});

describe("a status word stays OpenStack's own in every language", () => {
  const GERMAN: Translator = createTranslator((text: string) => {
    const words: Record<string, string> = {
      Disabled: "Deaktiviert",
      // A locale may well word these for other pages. They are not looked up.
      available: "verfügbar",
      "{{status}}": "{{status}}",
    };
    return words[text];
  }, "de");

  test("the word reads as written", () => {
    for (const [kind, status] of [
      [OpenStackResourceKind.Volume, "available"],
      [OpenStackResourceKind.Instance, "ACTIVE"],
      [OpenStackResourceKind.Service, "down"],
    ] as Array<[OpenStackResourceKind, string]>) {
      expect(
        getResourceStatusLabel(
          toOpenStackStatusResource(readingOf({ kind, status }), true),
          GERMAN,
        ),
      ).toBe(status);
    }
  });

  test("only Disabled is ours to translate", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Service,
      status: "down",
      adminState: "disabled",
    });

    expect(reading.isOpenStackWord).toBe(false);
    expect(reading.label).toBe(OPENSTACK_DISABLED_LABEL);
    expect(
      getResourceStatusLabel(toOpenStackStatusResource(reading, true), GERMAN),
    ).toBe("Deaktiviert");
  });

  test("the operator's reason is never looked up", () => {
    const resource: ReturnType<typeof toOpenStackStatusResource> =
      toOpenStackStatusResource(
        readingOf({
          kind: OpenStackResourceKind.Service,
          status: "down",
          adminState: "disabled",
          disabledReason: "available",
        }),
        true,
      );

    expect(resource.statusReasons).toEqual([
      { text: "{{reason}}", values: { reason: "available" } },
    ]);
  });

  test("a list with a Reason column of its own leaves the line out", () => {
    const resource: ReturnType<typeof toOpenStackStatusResource> =
      toOpenStackStatusResource(
        readingOf({
          kind: OpenStackResourceKind.Service,
          status: "down",
          adminState: "disabled",
          disabledReason: "Hardware swap",
        }),
        false,
      );

    expect(resource.statusReasons).toEqual([]);
  });
});

describe("how long a state has held is part of what it says", () => {
  const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
  const ago: (minutes: number) => Date = (minutes: number): Date => {
    return new Date(NOW.getTime() - minutes * 60 * 1000);
  };

  test("a step past its line reads Stuck, in our word rather than Nova's", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Instance,
      status: "BUILD",
      stateChangedAt: ago(120),
      now: NOW,
    });
    expect(reading.label).toBe(OPENSTACK_STUCK_LABEL);
    expect(reading.isStuck).toBe(true);
  });

  test("a step under its line is on its way, and reads as nothing to look at", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Instance,
      status: "BUILD",
      stateChangedAt: ago(5),
      now: NOW,
    });
    expect(reading.label).toBe("BUILD");
    expect(reading.isStuck).toBeFalsy();
    expect(reading.tone).not.toBe("danger");
    expect(reading.tone).not.toBe("warning");
  });

  test("with no time to read by, it never guesses Stuck", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Volume,
      status: "attaching",
    });
    expect(reading.label).toBe("attaching");
    expect(reading.isStuck).toBeFalsy();
  });

  test("a word that isn't a step is never stuck, however long it has held", () => {
    const reading: OpenStackStatusReading = readingOf({
      kind: OpenStackResourceKind.Instance,
      status: "SHUTOFF",
      stateChangedAt: ago(100000),
      now: NOW,
    });
    expect(reading.label).toBe("SHUTOFF");
    expect(reading.isStuck).toBeFalsy();
  });

  test("a hypervisor that stopped answering reads Lost, and one someone disabled doesn't", () => {
    expect(
      readingOf({
        kind: OpenStackResourceKind.Hypervisor,
        status: "down",
        adminState: "enabled",
      }).label,
    ).toBe(OPENSTACK_LOST_LABEL);
    expect(
      readingOf({
        kind: OpenStackResourceKind.Hypervisor,
        status: "down",
        adminState: "disabled",
      }).label,
    ).toBe(OPENSTACK_DISABLED_LABEL);
  });
});

describe("the cell", () => {
  test("draws a disabled service as Disabled, with its reason, and no alarm", () => {
    const { container } = render(
      <OpenStackStatusCell
        kind={OpenStackResourceKind.Service}
        status="down"
        adminState="disabled"
        disabledReason="Hardware swap, CHG-1042"
      />,
    );

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Hardware swap, CHG-1042")).toBeInTheDocument();
    expect(screen.queryByText("down")).not.toBeInTheDocument();
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
    expect(container.querySelector('[data-tone="danger"]')).toBeNull();
  });

  test("draws a Neutron agent with its admin state down the same way", () => {
    const { container } = render(
      <OpenStackStatusCell
        kind={OpenStackResourceKind.Service}
        status="down"
        adminState="down"
      />,
    );

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(container.querySelector('[data-tone="danger"]')).toBeNull();
  });

  test("draws a stopped, enabled service as down, in red", () => {
    const { container } = render(
      <OpenStackStatusCell
        kind={OpenStackResourceKind.Service}
        status="down"
        adminState="enabled"
      />,
    );

    expect(screen.getByText("down")).toBeInTheDocument();
    expect(container.querySelector('[data-tone="danger"]')).not.toBeNull();
  });

  test("draws an instance's word as Nova writes it", () => {
    const { container } = render(
      <OpenStackStatusCell
        kind={OpenStackResourceKind.Instance}
        status="SHUTOFF"
      />,
    );

    expect(screen.getByText("SHUTOFF")).toBeInTheDocument();
    expect(container.querySelector('[data-tone="neutral"]')).not.toBeNull();
  });

  test("draws a dash for a row with no state", () => {
    render(
      <OpenStackStatusCell
        kind={OpenStackResourceKind.Hypervisor}
        status={undefined}
      />,
    );

    expect(screen.getByText("-")).toBeInTheDocument();
  });

  test("leaves the reason to the list's own column when asked", () => {
    render(
      <OpenStackStatusCell
        kind={OpenStackResourceKind.Service}
        status="down"
        adminState="disabled"
        disabledReason="Hardware swap"
        showReason={false}
      />,
    );

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText("Hardware swap")).not.toBeInTheDocument();
  });
});
