import { describe, expect, test } from "@jest/globals";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import VMwareProbeCollectionStore from "../../../Server/Utils/VMware/VMwareProbeCollectionStore";
import {
  VMwareCollectionStop,
  VMwareCollectionStopFacts,
  getVMwareCollectionStop,
} from "../../../Utils/VMware/VMwareCollectionStop";

/*
 * Why no probe collects a probe-collected vCenter, read from the vCenter's
 * own row (OneUptime issue #8042). The probes' claim sets a vCenter nothing
 * may collect aside a quarter of an hour at a time, so its due time keeps
 * moving: the card read its last status ("Collecting") for good.
 *
 * The last part reads the claim's own SQL (getCollectableSql) condition by
 * condition, reads each one over a vCenter in plain code, and checks that
 * this rule stops a vCenter exactly when a condition the page can see is
 * false: alone, and in every pair, on OneUptime Cloud and self-hosted. A
 * condition added to the claim fails it until the page knows it.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "33333333-3333-4333-8333-333333333333";

const OWN_PROBE: NonNullable<VMwareCollectionStopFacts["collectionProbe"]> = {
  isGlobalProbe: false,
  projectId: PROJECT_ID,
  connectionStatus: ProbeConnectionStatus.Connected,
};

function vcenter(
  overrides: Partial<VMwareCollectionStopFacts> = {},
): VMwareCollectionStopFacts {
  return {
    projectId: PROJECT_ID,
    isVCenterPasswordSet: true,
    vcenterUrl: "https://vcenter.example.com",
    vcenterUsername: "monitoring@vsphere.local",
    collectionProbeId: PROBE_ID,
    collectionProbe: OWN_PROBE,
    ...overrides,
  };
}

describe("why no probe collects a vCenter", () => {
  test("nothing stops a vCenter with its password, address, user name and the project's own connected probe", () => {
    expect(getVMwareCollectionStop(vcenter(), true)).toBeNull();
    expect(getVMwareCollectionStop(vcenter(), false)).toBeNull();
  });

  test.each([
    [
      "no password saved",
      vcenter({ isVCenterPasswordSet: false }),
      VMwareCollectionStop.NoPassword,
    ],
    [
      "no address",
      vcenter({ vcenterUrl: null }),
      VMwareCollectionStop.NoAddress,
    ],
    [
      "an empty address",
      vcenter({ vcenterUrl: "" }),
      VMwareCollectionStop.NoAddress,
    ],
    [
      "no user name",
      vcenter({ vcenterUsername: null }),
      VMwareCollectionStop.NoUserName,
    ],
    [
      "no probe named",
      vcenter({ collectionProbeId: null, collectionProbe: null }),
      VMwareCollectionStop.NoProbe,
    ],
    [
      "another project's probe",
      vcenter({
        collectionProbe: { ...OWN_PROBE, projectId: OTHER_PROJECT_ID },
      }),
      VMwareCollectionStop.ProbeNotAllowed,
    ],
    [
      "a disconnected probe",
      vcenter({
        collectionProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      }),
      VMwareCollectionStop.ProbeDisconnected,
    ],
  ])(
    "%s",
    (
      _name: string,
      facts: VMwareCollectionStopFacts,
      stop: VMwareCollectionStop,
    ) => {
      expect(getVMwareCollectionStop(facts, true)).toBe(stop);
      expect(getVMwareCollectionStop(facts, false)).toBe(stop);
    },
  );

  test("a shared probe on OneUptime Cloud may not collect it; an instance's own may", () => {
    const shared: VMwareCollectionStopFacts = vcenter({
      collectionProbe: { isGlobalProbe: true, projectId: null },
    });

    expect(getVMwareCollectionStop(shared, true)).toBe(
      VMwareCollectionStop.ProbeNotAllowed,
    );
    expect(getVMwareCollectionStop(shared, false)).toBeNull();
  });

  test("a probe the reader could not read says nothing about the probe", () => {
    for (const collectionProbe of [
      undefined,
      null,
      { projectId: OTHER_PROJECT_ID },
    ]) {
      expect(
        getVMwareCollectionStop(vcenter({ collectionProbe }), true),
      ).toBeNull();
    }
  });

  test("a password not read says nothing: only a read false is no password", () => {
    expect(
      getVMwareCollectionStop(
        vcenter({ isVCenterPasswordSet: undefined }),
        true,
      ),
    ).toBeNull();
  });

  test("an archived vCenter is still collected: archiving is not a stop", () => {
    expect(
      getVMwareCollectionStop(
        { ...vcenter(), isArchived: true } as VMwareCollectionStopFacts,
        true,
      ),
    ).toBeNull();
  });
});

interface ClaimRow {
  vcenter: VMwareCollectionStopFacts;
  probe: {
    isGlobalProbe: boolean;
    projectId: string | null;
    isDeleted: boolean;
  };
  isBillingEnabled: boolean;
}

type ClauseReading =
  | {
      kind: "row";
      holds: (row: ClaimRow) => boolean;
      breaks: (row: ClaimRow) => ClaimRow;
    }
  | { kind: "not shown" };

const CLAUSES: Record<string, ClauseReading> = {
  // The card is drawn only for a vCenter a probe collects.
  'vc."collectionMethod" = $5': { kind: "not shown" },
  'vc."deletedAt" IS NULL': { kind: "not shown" },
  'vc."isVCenterPasswordSet" = true': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.vcenter.isVCenterPasswordSet === true;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return {
        ...row,
        vcenter: { ...row.vcenter, isVCenterPasswordSet: false },
      };
    },
  },
  'vc."vcenterUrl" IS NOT NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return (
        row.vcenter.vcenterUrl !== null && row.vcenter.vcenterUrl !== undefined
      );
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, vcenter: { ...row.vcenter, vcenterUrl: null } };
    },
  },
  'vc."vcenterUsername" IS NOT NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return (
        row.vcenter.vcenterUsername !== null &&
        row.vcenter.vcenterUsername !== undefined
      );
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, vcenter: { ...row.vcenter, vcenterUsername: null } };
    },
  },
  '((pr."isGlobalProbe" = false AND pr."projectId" = vc."projectId") OR (pr."isGlobalProbe" = true AND $7::boolean = false))':
    {
      kind: "row",
      holds: (row: ClaimRow): boolean => {
        return (
          (!row.probe.isGlobalProbe &&
            row.probe.projectId === String(row.vcenter.projectId)) ||
          (row.probe.isGlobalProbe && !row.isBillingEnabled)
        );
      },
      breaks: (row: ClaimRow): ClaimRow => {
        return { ...row, probe: { ...row.probe, projectId: OTHER_PROJECT_ID } };
      },
    },
  'pr."deletedAt" IS NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return !row.probe.isDeleted;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, probe: { ...row.probe, isDeleted: true } };
    },
  },
  'p."deletedAt" IS NULL': { kind: "not shown" },
  'p."isBlocked" = false': { kind: "not shown" },
  '(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY($4::text[]))':
    { kind: "not shown" },
  '(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY($4::text[]))':
    { kind: "not shown" },
};

const CLAIM_CLAUSES: Array<string> =
  VMwareProbeCollectionStore.getCollectableSql({
    collectionMethodParameter: "$5",
    statusesParameter: "$4",
    isBillingEnabledParameter: "$7",
  })
    .split(/\n\s*AND /)
    .map((clause: string): string => {
      return clause.trim();
    });

const ROW_CLAUSES: Array<string> = Object.keys(CLAUSES).filter(
  (clause: string): boolean => {
    return CLAUSES[clause]!.kind === "row";
  },
);

function claimable(isBillingEnabled: boolean): ClaimRow {
  return {
    vcenter: vcenter(),
    probe: { isGlobalProbe: false, projectId: PROJECT_ID, isDeleted: false },
    isBillingEnabled: isBillingEnabled,
  };
}

function isClaimable(row: ClaimRow): boolean {
  // The claim reads the vCenters its probe names: none is one no probe takes.
  return (
    Boolean(row.vcenter.collectionProbeId) &&
    ROW_CLAUSES.every((clause: string): boolean => {
      const reading: ClauseReading = CLAUSES[clause]!;
      return reading.kind === "row" && reading.holds(row);
    })
  );
}

// What the card reads of a row: a probe deleted leaves none named (ON DELETE SET NULL).
function cardFacts(row: ClaimRow): VMwareCollectionStopFacts {
  return {
    ...row.vcenter,
    collectionProbe: row.probe.isDeleted
      ? null
      : {
          isGlobalProbe: row.probe.isGlobalProbe,
          projectId: row.probe.projectId,
          connectionStatus: ProbeConnectionStatus.Connected,
        },
    collectionProbeId: row.probe.isDeleted
      ? null
      : row.vcenter.collectionProbeId,
  };
}

describe("the card's rule is the claim's (VMwareProbeCollectionStore.getCollectableSql)", () => {
  test("every condition of the claim is one the card reads, or about a vCenter it is not drawn for", () => {
    expect(CLAIM_CLAUSES.length).toBeGreaterThan(8);
    expect([...CLAIM_CLAUSES].sort()).toEqual(Object.keys(CLAUSES).sort());
  });

  for (const isBillingEnabled of [true, false]) {
    const where: string = isBillingEnabled
      ? "on OneUptime Cloud"
      : "self-hosted";

    test(`${where}, the vCenter the suite starts from is one the claim hands out, and the card agrees`, () => {
      const row: ClaimRow = claimable(isBillingEnabled);

      expect(isClaimable(row)).toBe(true);
      expect(
        getVMwareCollectionStop(cardFacts(row), isBillingEnabled),
      ).toBeNull();
    });

    test(`${where}, each condition false alone stops the vCenter on the card`, () => {
      for (const clause of ROW_CLAUSES) {
        const reading: ClauseReading = CLAUSES[clause]!;

        if (reading.kind !== "row") {
          continue;
        }

        const row: ClaimRow = reading.breaks(claimable(isBillingEnabled));

        expect(reading.holds(row)).toBe(false);
        expect(isClaimable(row)).toBe(false);
        expect(
          getVMwareCollectionStop(cardFacts(row), isBillingEnabled),
        ).not.toBeNull();
      }
    });

    test(`${where}, with any two conditions false, the claim and the card agree`, () => {
      for (const first of ROW_CLAUSES) {
        for (const second of ROW_CLAUSES) {
          const readingOfFirst: ClauseReading = CLAUSES[first]!;
          const readingOfSecond: ClauseReading = CLAUSES[second]!;

          if (readingOfFirst.kind !== "row" || readingOfSecond.kind !== "row") {
            continue;
          }

          const row: ClaimRow = readingOfSecond.breaks(
            readingOfFirst.breaks(claimable(isBillingEnabled)),
          );

          expect(
            getVMwareCollectionStop(cardFacts(row), isBillingEnabled) === null,
          ).toBe(isClaimable(row));
        }
      }
    });

    test(`${where}, a global probe is the claim's to judge as the card does`, () => {
      const row: ClaimRow = {
        ...claimable(isBillingEnabled),
        probe: { isGlobalProbe: true, projectId: null, isDeleted: false },
      };

      expect(
        getVMwareCollectionStop(cardFacts(row), isBillingEnabled) === null,
      ).toBe(isClaimable(row));
      expect(isClaimable(row)).toBe(!isBillingEnabled);
    });
  }

  test("the claim does not read isArchived: an archived vCenter is collected", () => {
    expect(
      CLAIM_CLAUSES.some((clause: string): boolean => {
        return clause.includes("isArchived");
      }),
    ).toBe(false);
  });
});
