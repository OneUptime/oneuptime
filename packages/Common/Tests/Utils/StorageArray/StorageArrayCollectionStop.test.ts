import { describe, expect, test } from "@jest/globals";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import StorageArrayProbeCollectionStore from "../../../Server/Utils/StorageArray/StorageArrayProbeCollectionStore";
import {
  StorageArrayCollectionStop,
  StorageArrayCollectionStopFacts,
  getStorageArrayCollectionStop,
} from "../../../Utils/StorageArray/StorageArrayCollectionStop";

/*
 * Why no probe reads a storage array connection (#11004), read from the
 * connection's own row: the claim sets a connection nothing may collect
 * aside a quarter of an hour at a time, so its due time keeps moving and its
 * last status ("Collecting") would read for good.
 *
 * The last part reads the claim's own SQL (getCollectableSql) condition by
 * condition, reads each one over a connection in plain code, and checks
 * that this rule stops a connection exactly when a condition the page can
 * see is false - alone and in every pair, on OneUptime Cloud and
 * self-hosted. A condition added to the claim fails it until the page knows
 * it.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "33333333-3333-4333-8333-333333333333";

const OWN_PROBE: NonNullable<
  StorageArrayCollectionStopFacts["collectionProbe"]
> = {
  isGlobalProbe: false,
  projectId: PROJECT_ID,
  connectionStatus: ProbeConnectionStatus.Connected,
};

function connection(
  overrides: Partial<StorageArrayCollectionStopFacts> = {},
): StorageArrayCollectionStopFacts {
  return {
    projectId: PROJECT_ID,
    isPasswordSet: true,
    address: "https://unisphere.example.com:8443",
    username: "oneuptime-monitor",
    collectionProbeId: PROBE_ID,
    collectionProbe: OWN_PROBE,
    ...overrides,
  };
}

describe("why no probe reads a storage array connection", () => {
  test("nothing stops a connection with its password, address, user name and the project's own connected probe", () => {
    expect(getStorageArrayCollectionStop(connection(), true)).toBeNull();
    expect(getStorageArrayCollectionStop(connection(), false)).toBeNull();
  });

  test.each([
    [
      "no password saved",
      connection({ isPasswordSet: false }),
      StorageArrayCollectionStop.NoPassword,
    ],
    [
      "no address",
      connection({ address: null }),
      StorageArrayCollectionStop.NoAddress,
    ],
    [
      "an empty address",
      connection({ address: "" }),
      StorageArrayCollectionStop.NoAddress,
    ],
    [
      "no user name",
      connection({ username: null }),
      StorageArrayCollectionStop.NoUserName,
    ],
    [
      "no probe named",
      connection({ collectionProbeId: null, collectionProbe: null }),
      StorageArrayCollectionStop.NoProbe,
    ],
    [
      "another project's probe",
      connection({
        collectionProbe: { ...OWN_PROBE, projectId: OTHER_PROJECT_ID },
      }),
      StorageArrayCollectionStop.ProbeNotAllowed,
    ],
    [
      "a disconnected probe",
      connection({
        collectionProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      }),
      StorageArrayCollectionStop.ProbeDisconnected,
    ],
  ])(
    "%s",
    (
      _name: string,
      facts: StorageArrayCollectionStopFacts,
      stop: StorageArrayCollectionStop,
    ) => {
      expect(getStorageArrayCollectionStop(facts, true)).toBe(stop);
      expect(getStorageArrayCollectionStop(facts, false)).toBe(stop);
    },
  );

  test("the first thing missing is the one said: the password before the address", () => {
    expect(
      getStorageArrayCollectionStop(
        connection({ isPasswordSet: false, address: null, username: null }),
        true,
      ),
    ).toBe(StorageArrayCollectionStop.NoPassword);
    expect(
      getStorageArrayCollectionStop(
        connection({ address: null, username: null }),
        true,
      ),
    ).toBe(StorageArrayCollectionStop.NoAddress);
  });

  test("a shared probe on OneUptime Cloud may not read it; an instance's own may", () => {
    const shared: StorageArrayCollectionStopFacts = connection({
      collectionProbe: { isGlobalProbe: true, projectId: null },
    });

    expect(getStorageArrayCollectionStop(shared, true)).toBe(
      StorageArrayCollectionStop.ProbeNotAllowed,
    );
    expect(getStorageArrayCollectionStop(shared, false)).toBeNull();
  });

  test("a probe the reader could not read says nothing about the probe", () => {
    for (const collectionProbe of [
      undefined,
      null,
      { projectId: OTHER_PROJECT_ID },
    ]) {
      expect(
        getStorageArrayCollectionStop(connection({ collectionProbe }), true),
      ).toBeNull();
    }
  });

  test("a password not read says nothing: only a read false is no password", () => {
    expect(
      getStorageArrayCollectionStop(
        connection({ isPasswordSet: undefined }),
        true,
      ),
    ).toBeNull();
  });

  test("ids and project ids may be any value that writes itself as text", () => {
    expect(
      getStorageArrayCollectionStop(
        connection({
          projectId: {
            toString: () => {
              return PROJECT_ID;
            },
          },
          collectionProbeId: {
            toString: () => {
              return PROBE_ID;
            },
          },
          collectionProbe: {
            ...OWN_PROBE,
            projectId: {
              toString: () => {
                return PROJECT_ID;
              },
            },
          },
        }),
        true,
      ),
    ).toBeNull();
  });
});

interface ClaimRow {
  connection: StorageArrayCollectionStopFacts;
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
  'sac."deletedAt" IS NULL': { kind: "not shown" },
  'sac."isPasswordSet" = true': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return row.connection.isPasswordSet === true;
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return {
        ...row,
        connection: { ...row.connection, isPasswordSet: false },
      };
    },
  },
  'sac."address" IS NOT NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return (
        row.connection.address !== null && row.connection.address !== undefined
      );
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, connection: { ...row.connection, address: null } };
    },
  },
  'sac."username" IS NOT NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return (
        row.connection.username !== null &&
        row.connection.username !== undefined
      );
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, connection: { ...row.connection, username: null } };
    },
  },
  // A connection of a platform no probe collects is never made: the save refuses it.
  'sac."storageSystem" = ANY($8::text[])': { kind: "not shown" },
  '((pr."isGlobalProbe" = false AND pr."projectId" = sac."projectId") OR (pr."isGlobalProbe" = true AND $7::boolean = false))':
    {
      kind: "row",
      holds: (row: ClaimRow): boolean => {
        return (
          (!row.probe.isGlobalProbe &&
            row.probe.projectId === String(row.connection.projectId)) ||
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
  StorageArrayProbeCollectionStore.getCollectableSql({
    statusesParameter: "$4",
    isBillingEnabledParameter: "$7",
    storageSystemsParameter: "$8",
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
    connection: connection(),
    probe: { isGlobalProbe: false, projectId: PROJECT_ID, isDeleted: false },
    isBillingEnabled: isBillingEnabled,
  };
}

function isClaimable(row: ClaimRow): boolean {
  // The claim reads the connections its probe names: none is one no probe takes.
  return (
    Boolean(row.connection.collectionProbeId) &&
    ROW_CLAUSES.every((clause: string): boolean => {
      const reading: ClauseReading = CLAUSES[clause]!;
      return reading.kind === "row" && reading.holds(row);
    })
  );
}

// What the page reads of a row: a probe deleted leaves none named (ON DELETE SET NULL).
function pageFacts(row: ClaimRow): StorageArrayCollectionStopFacts {
  return {
    ...row.connection,
    collectionProbe: row.probe.isDeleted
      ? null
      : {
          isGlobalProbe: row.probe.isGlobalProbe,
          projectId: row.probe.projectId,
          connectionStatus: ProbeConnectionStatus.Connected,
        },
    collectionProbeId: row.probe.isDeleted
      ? null
      : row.connection.collectionProbeId,
  };
}

describe("the page's rule is the claim's (StorageArrayProbeCollectionStore.getCollectableSql)", () => {
  test("every condition of the claim is one the page reads, or about a connection it is not drawn for", () => {
    expect(CLAIM_CLAUSES.length).toBeGreaterThan(8);
    expect([...CLAIM_CLAUSES].sort()).toEqual(Object.keys(CLAUSES).sort());
  });

  for (const isBillingEnabled of [true, false]) {
    const where: string = isBillingEnabled
      ? "on OneUptime Cloud"
      : "self-hosted";

    test(`${where}, the connection the suite starts from is one the claim hands out, and the page agrees`, () => {
      const row: ClaimRow = claimable(isBillingEnabled);

      expect(isClaimable(row)).toBe(true);
      expect(
        getStorageArrayCollectionStop(pageFacts(row), isBillingEnabled),
      ).toBeNull();
    });

    test(`${where}, each condition false alone stops the connection on the page`, () => {
      for (const clause of ROW_CLAUSES) {
        const reading: ClauseReading = CLAUSES[clause]!;
        if (reading.kind !== "row") {
          continue;
        }
        const row: ClaimRow = reading.breaks(claimable(isBillingEnabled));

        expect(reading.holds(row)).toBe(false);
        expect(isClaimable(row)).toBe(false);
        expect(
          getStorageArrayCollectionStop(pageFacts(row), isBillingEnabled),
        ).not.toBeNull();
      }
    });

    test(`${where}, with any two conditions false, the claim and the page agree`, () => {
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
            getStorageArrayCollectionStop(pageFacts(row), isBillingEnabled) ===
              null,
          ).toBe(isClaimable(row));
        }
      }
    });

    test(`${where}, a global probe is the claim's to judge as the page does`, () => {
      const row: ClaimRow = {
        ...claimable(isBillingEnabled),
        probe: { isGlobalProbe: true, projectId: null, isDeleted: false },
      };

      expect(
        getStorageArrayCollectionStop(pageFacts(row), isBillingEnabled) ===
          null,
      ).toBe(isClaimable(row));
      expect(isClaimable(row)).toBe(!isBillingEnabled);
    });
  }
});
