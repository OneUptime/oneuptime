import { describe, expect, test } from "@jest/globals";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import OpenStackProbeCollectionStore from "../../../Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import {
  OpenStackCollectionStop,
  OpenStackCollectionStopFacts,
  getOpenStackCollectionStop,
} from "../../../Utils/OpenStack/OpenStackCollectionStop";

/*
 * Why no probe collects a probe-collected OpenStack cloud, read from the
 * cloud's own row (OneUptime issue #8042). The probes' claim sets a cloud
 * nothing may collect aside a quarter of an hour at a time, so its due
 * time keeps moving and is never overdue: the card read its last status
 * ("Collecting") for good.
 *
 * The last part reads the claim's own SQL (getCollectableSql) condition by
 * condition, reads each one over a cloud in plain code, and checks that
 * this rule stops a cloud exactly when a condition the page can see is
 * false: alone, and in every pair, on OneUptime Cloud and self-hosted. A
 * condition added to the claim fails it until the page knows it.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "33333333-3333-4333-8333-333333333333";

const OWN_PROBE: NonNullable<OpenStackCollectionStopFacts["collectionProbe"]> =
  {
    isGlobalProbe: false,
    projectId: PROJECT_ID,
    connectionStatus: ProbeConnectionStatus.Connected,
  };

function cloud(
  overrides: Partial<OpenStackCollectionStopFacts> = {},
): OpenStackCollectionStopFacts {
  return {
    projectId: PROJECT_ID,
    isArchived: false,
    isCredentialSet: true,
    authUrl: "https://keystone.example.com:5000/v3",
    collectionProbeId: PROBE_ID,
    collectionProbe: OWN_PROBE,
    ...overrides,
  };
}

describe("why no probe collects a cloud", () => {
  test("nothing stops a cloud with its credential, address and the project's own connected probe", () => {
    expect(getOpenStackCollectionStop(cloud(), true)).toBeNull();
    expect(getOpenStackCollectionStop(cloud(), false)).toBeNull();
  });

  test.each([
    ["archived", cloud({ isArchived: true }), OpenStackCollectionStop.Archived],
    [
      "no credential saved",
      cloud({ isCredentialSet: false }),
      OpenStackCollectionStop.NoCredential,
    ],
    [
      "no Keystone address",
      cloud({ authUrl: null }),
      OpenStackCollectionStop.NoAddress,
    ],
    [
      "an empty Keystone address",
      cloud({ authUrl: "" }),
      OpenStackCollectionStop.NoAddress,
    ],
    [
      "no probe named",
      cloud({ collectionProbeId: null, collectionProbe: null }),
      OpenStackCollectionStop.NoProbe,
    ],
    [
      "another project's probe",
      cloud({ collectionProbe: { ...OWN_PROBE, projectId: OTHER_PROJECT_ID } }),
      OpenStackCollectionStop.ProbeNotAllowed,
    ],
    [
      "a disconnected probe",
      cloud({
        collectionProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      }),
      OpenStackCollectionStop.ProbeDisconnected,
    ],
  ])(
    "%s",
    (
      _name: string,
      facts: OpenStackCollectionStopFacts,
      stop: OpenStackCollectionStop,
    ) => {
      expect(getOpenStackCollectionStop(facts, true)).toBe(stop);
      expect(getOpenStackCollectionStop(facts, false)).toBe(stop);
    },
  );

  test("a shared probe on OneUptime Cloud may not collect it; an instance's own may", () => {
    const shared: OpenStackCollectionStopFacts = cloud({
      collectionProbe: { isGlobalProbe: true, projectId: null },
    });

    expect(getOpenStackCollectionStop(shared, true)).toBe(
      OpenStackCollectionStop.ProbeNotAllowed,
    );
    expect(getOpenStackCollectionStop(shared, false)).toBeNull();
  });

  test("a probe the reader could not read says nothing about the probe", () => {
    for (const collectionProbe of [
      undefined,
      null,
      // Read without isGlobalProbe: nothing to judge it by.
      { projectId: OTHER_PROJECT_ID },
    ]) {
      expect(
        getOpenStackCollectionStop(cloud({ collectionProbe }), true),
      ).toBeNull();
    }
  });

  test("the probe's project is judged only with the cloud's own known", () => {
    expect(
      getOpenStackCollectionStop(
        cloud({
          projectId: undefined,
          collectionProbe: { ...OWN_PROBE, projectId: OTHER_PROJECT_ID },
        }),
        true,
      ),
    ).toBeNull();
  });

  test("a credential not read says nothing: only a read false is no credential", () => {
    expect(
      getOpenStackCollectionStop(cloud({ isCredentialSet: undefined }), true),
    ).toBeNull();
  });

  test("archived is said first", () => {
    expect(
      getOpenStackCollectionStop(
        cloud({ isArchived: true, isCredentialSet: false, authUrl: null }),
        true,
      ),
    ).toBe(OpenStackCollectionStop.Archived);
  });
});

/*
 * THE CLAIM'S CONDITIONS, READ ONE BY ONE: "row" over what the card reads
 * of the cloud and its probe, and "not shown" for a cloud or project
 * nobody's page shows, or one the card is not drawn for (an agent's cloud).
 */
interface ClaimRow {
  cloud: OpenStackCollectionStopFacts;
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
  // The card is drawn only for a cloud a probe collects.
  'c."collectionMethod" = $5': { kind: "not shown" },
  'c."deletedAt" IS NULL': { kind: "not shown" },
  'c."isArchived" = false': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.cloud.isArchived === false;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, cloud: { ...row.cloud, isArchived: true } };
    },
  },
  'c."isCredentialSet" = true': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.cloud.isCredentialSet === true;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, cloud: { ...row.cloud, isCredentialSet: false } };
    },
  },
  'c."authUrl" IS NOT NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.cloud.authUrl !== null && row.cloud.authUrl !== undefined;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, cloud: { ...row.cloud, authUrl: null } };
    },
  },
  '((pr."isGlobalProbe" = false AND pr."projectId" = c."projectId") OR (pr."isGlobalProbe" = true AND $7::boolean = false))':
    {
      kind: "row",
      holds: (row: ClaimRow): boolean => {
        return (
          (!row.probe.isGlobalProbe &&
            row.probe.projectId === String(row.cloud.projectId)) ||
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
  'p."isSampleProject" = false': { kind: "not shown" },
  '(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY($4::text[]))':
    { kind: "not shown" },
  '(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY($4::text[]))':
    { kind: "not shown" },
};

const CLAIM_CLAUSES: Array<string> =
  OpenStackProbeCollectionStore.getCollectableSql({
    collectionMethodParameter: "$5",
    statusesParameter: "$4",
    isBillingEnabledParameter: "$7",
  })
    .split(/\n\s*AND (?=[a-z(])/)
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
    cloud: cloud(),
    probe: { isGlobalProbe: false, projectId: PROJECT_ID, isDeleted: false },
    isBillingEnabled: isBillingEnabled,
  };
}

function isClaimable(row: ClaimRow): boolean {
  // The claim reads the clouds its probe names: none is a cloud no probe takes.
  return (
    Boolean(row.cloud.collectionProbeId) &&
    ROW_CLAUSES.every((clause: string): boolean => {
      const reading: ClauseReading = CLAUSES[clause]!;
      return reading.kind === "row" && reading.holds(row);
    })
  );
}

// What the card reads of a row: the probe through its relation, gone once deleted.
function cardFacts(row: ClaimRow): OpenStackCollectionStopFacts {
  return {
    ...row.cloud,
    collectionProbe: row.probe.isDeleted
      ? null
      : {
          isGlobalProbe: row.probe.isGlobalProbe,
          projectId: row.probe.projectId,
          connectionStatus: ProbeConnectionStatus.Connected,
        },
    // A probe deleted for good leaves no probe named (ON DELETE SET NULL).
    collectionProbeId: row.probe.isDeleted ? null : row.cloud.collectionProbeId,
  };
}

describe("the card's rule is the claim's (OpenStackProbeCollectionStore.getCollectableSql)", () => {
  test("every condition of the claim is one the card reads, or about a cloud it is not drawn for", () => {
    expect(CLAIM_CLAUSES.length).toBeGreaterThan(8);
    expect([...CLAIM_CLAUSES].sort()).toEqual(Object.keys(CLAUSES).sort());
  });

  for (const isBillingEnabled of [true, false]) {
    const where: string = isBillingEnabled
      ? "on OneUptime Cloud"
      : "self-hosted";

    test(`${where}, the cloud the suite starts from is one the claim hands out, and the card agrees`, () => {
      const row: ClaimRow = claimable(isBillingEnabled);

      expect(isClaimable(row)).toBe(true);
      expect(
        getOpenStackCollectionStop(cardFacts(row), isBillingEnabled),
      ).toBeNull();
    });

    test(`${where}, each condition false alone stops the cloud on the card`, () => {
      for (const clause of ROW_CLAUSES) {
        const reading: ClauseReading = CLAUSES[clause]!;

        if (reading.kind !== "row") {
          continue;
        }

        const row: ClaimRow = reading.breaks(claimable(isBillingEnabled));

        expect(reading.holds(row)).toBe(false);
        expect(isClaimable(row)).toBe(false);
        expect(
          getOpenStackCollectionStop(cardFacts(row), isBillingEnabled),
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
            getOpenStackCollectionStop(cardFacts(row), isBillingEnabled) ===
              null,
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
        getOpenStackCollectionStop(cardFacts(row), isBillingEnabled) === null,
      ).toBe(isClaimable(row));
      expect(isClaimable(row)).toBe(!isBillingEnabled);
    });
  }

  test("no probe named: the claim never reads the cloud, and the card says so", () => {
    const row: ClaimRow = {
      ...claimable(true),
      cloud: cloud({ collectionProbeId: null }),
    };

    expect(isClaimable(row)).toBe(false);
    expect(getOpenStackCollectionStop(cardFacts(row), true)).toBe(
      OpenStackCollectionStop.NoProbe,
    );
  });
});
