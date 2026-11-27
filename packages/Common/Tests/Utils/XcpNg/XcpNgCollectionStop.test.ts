import { describe, expect, test } from "@jest/globals";
import { ProbeConnectionStatus } from "../../../Models/DatabaseModels/Probe";
import XcpNgProbeCollectionStore from "../../../Server/Utils/XcpNg/XcpNgProbeCollectionStore";
import XcpNgConnectionType from "../../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgCollectionStop,
  XcpNgCollectionStopFacts,
  getXcpNgCollectionStop,
} from "../../../Utils/XcpNg/XcpNgCollectionStop";

/*
 * Why no probe reads an XCP-ng connection, read from the connection's own
 * row - the vCenter rule (VMwareCollectionStop, OneUptime issue #8042) for
 * the two kinds of connection: a Xen Orchestra needs its OpenMetrics
 * secret, a pool its user name and password.
 *
 * The last part reads the claim's own SQL (getCollectableSql) condition by
 * condition, reads each over a connection in plain code, and checks that
 * this rule stops a connection exactly when a condition the page can see
 * is false: alone and in every pair, for both kinds, on OneUptime Cloud and
 * self-hosted. A condition added to the claim fails it until the page
 * knows it.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "33333333-3333-4333-8333-333333333333";

const OWN_PROBE: NonNullable<XcpNgCollectionStopFacts["collectionProbe"]> = {
  isGlobalProbe: false,
  projectId: PROJECT_ID,
  connectionStatus: ProbeConnectionStatus.Connected,
};

function xenOrchestra(
  overrides: Partial<XcpNgCollectionStopFacts> = {},
): XcpNgCollectionStopFacts {
  return {
    projectId: PROJECT_ID,
    connectionType: XcpNgConnectionType.XenOrchestra,
    address: "https://xo.example.com",
    isOpenMetricsSecretSet: true,
    collectionProbeId: PROBE_ID,
    collectionProbe: OWN_PROBE,
    ...overrides,
  };
}

function xapi(
  overrides: Partial<XcpNgCollectionStopFacts> = {},
): XcpNgCollectionStopFacts {
  return {
    projectId: PROJECT_ID,
    connectionType: XcpNgConnectionType.Xapi,
    address: "https://10.0.0.10",
    username: "root",
    isPasswordSet: true,
    collectionProbeId: PROBE_ID,
    collectionProbe: OWN_PROBE,
    ...overrides,
  };
}

describe("why no probe reads a connection", () => {
  test("nothing stops one with what its kind needs and the project's own connected probe", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        getXcpNgCollectionStop(xenOrchestra(), isBillingEnabled),
      ).toBeNull();
      expect(getXcpNgCollectionStop(xapi(), isBillingEnabled)).toBeNull();
    }
  });

  test.each([
    [
      "a Xen Orchestra with no address",
      xenOrchestra({ address: null }),
      XcpNgCollectionStop.NoAddress,
    ],
    [
      "a Xen Orchestra with no secret",
      xenOrchestra({ isOpenMetricsSecretSet: false }),
      XcpNgCollectionStop.NoSecret,
    ],
    [
      "a pool with no user name",
      xapi({ username: null }),
      XcpNgCollectionStop.NoUserName,
    ],
    [
      "a pool with no password",
      xapi({ isPasswordSet: false }),
      XcpNgCollectionStop.NoPassword,
    ],
    [
      "one with no probe",
      xenOrchestra({ collectionProbeId: null, collectionProbe: null }),
      XcpNgCollectionStop.NoProbe,
    ],
    [
      "one read by another project's probe",
      xapi({ collectionProbe: { ...OWN_PROBE, projectId: OTHER_PROJECT_ID } }),
      XcpNgCollectionStop.ProbeNotAllowed,
    ],
    [
      "one read by a disconnected probe",
      xenOrchestra({
        collectionProbe: {
          ...OWN_PROBE,
          connectionStatus: ProbeConnectionStatus.Disconnected,
        },
      }),
      XcpNgCollectionStop.ProbeDisconnected,
    ],
  ])(
    "%s",
    (
      _name: string,
      facts: XcpNgCollectionStopFacts,
      stop: XcpNgCollectionStop,
    ) => {
      expect(getXcpNgCollectionStop(facts, true)).toBe(stop);
    },
  );

  test("a pool's secret is its password, a Xen Orchestra's its OpenMetrics secret: the other kind's is not asked for", () => {
    expect(
      getXcpNgCollectionStop(
        xenOrchestra({ isPasswordSet: false, username: null }),
        true,
      ),
    ).toBeNull();
    expect(
      getXcpNgCollectionStop(xapi({ isOpenMetricsSecretSet: false }), true),
    ).toBeNull();
  });

  test("a shared probe stops a connection on OneUptime Cloud, never on a self-hosted instance", () => {
    const shared: XcpNgCollectionStopFacts = xenOrchestra({
      collectionProbe: {
        isGlobalProbe: true,
        projectId: null,
        connectionStatus: ProbeConnectionStatus.Connected,
      },
    });

    expect(getXcpNgCollectionStop(shared, true)).toBe(
      XcpNgCollectionStop.ProbeNotAllowed,
    );
    expect(getXcpNgCollectionStop(shared, false)).toBeNull();
  });

  test("a probe the reader may not read says nothing about it", () => {
    expect(
      getXcpNgCollectionStop(xenOrchestra({ collectionProbe: null }), true),
    ).toBeNull();
    expect(
      getXcpNgCollectionStop(xenOrchestra({ collectionProbe: {} }), true),
    ).toBeNull();
  });
});

interface ClaimRow {
  connection: XcpNgCollectionStopFacts;
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
      // A row where this condition, and only this one, is false.
      breaks: (row: ClaimRow) => ClaimRow;
    }
  | { kind: "not shown" };

const isXapiRow: (row: ClaimRow) => boolean = (row: ClaimRow): boolean => {
  return row.connection.connectionType === XcpNgConnectionType.Xapi;
};

const CLAUSES: Record<string, ClauseReading> = {
  'c."deletedAt" IS NULL': { kind: "not shown" },
  'c."address" IS NOT NULL': {
    kind: "row",
    holds: (row: ClaimRow): boolean => {
      return Boolean(row.connection.address);
    },
    breaks: (row: ClaimRow): ClaimRow => {
      return { ...row, connection: { ...row.connection, address: null } };
    },
  },
  [`((c."connectionType" = 'XenOrchestra' AND c."isOpenMetricsSecretSet" = true) OR (c."connectionType" = 'Xapi' AND c."isPasswordSet" = true AND c."username" IS NOT NULL))`]:
    {
      kind: "row",
      holds: (row: ClaimRow): boolean => {
        return isXapiRow(row)
          ? row.connection.isPasswordSet === true &&
              Boolean(row.connection.username)
          : row.connection.isOpenMetricsSecretSet === true;
      },
      breaks: (row: ClaimRow): ClaimRow => {
        return isXapiRow(row)
          ? { ...row, connection: { ...row.connection, isPasswordSet: false } }
          : {
              ...row,
              connection: { ...row.connection, isOpenMetricsSecretSet: false },
            };
      },
    },
  '((pr."isGlobalProbe" = false AND pr."projectId" = c."projectId") OR (pr."isGlobalProbe" = true AND $7::boolean = false))':
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
  '(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY($6::text[]))':
    { kind: "not shown" },
  '(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY($6::text[]))':
    { kind: "not shown" },
};

const CLAIM_CLAUSES: Array<string> =
  XcpNgProbeCollectionStore.getCollectableSql({
    statusesParameter: "$6",
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

function claimable(
  kind: XcpNgConnectionType,
  isBillingEnabled: boolean,
): ClaimRow {
  return {
    connection: kind === XcpNgConnectionType.Xapi ? xapi() : xenOrchestra(),
    probe: { isGlobalProbe: false, projectId: PROJECT_ID, isDeleted: false },
    isBillingEnabled: isBillingEnabled,
  };
}

function isClaimable(row: ClaimRow): boolean {
  // The claim reads the connections its probe names.
  return (
    Boolean(row.connection.collectionProbeId) &&
    ROW_CLAUSES.every((clause: string): boolean => {
      const reading: ClauseReading = CLAUSES[clause]!;
      return reading.kind === "row" && reading.holds(row);
    })
  );
}

// What the page reads of a row: a probe deleted leaves none named (ON DELETE SET NULL).
function pageFacts(row: ClaimRow): XcpNgCollectionStopFacts {
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

describe("the page's rule is the claim's (XcpNgProbeCollectionStore.getCollectableSql)", () => {
  test("every condition of the claim is one the page reads, or about a connection it is not drawn for", () => {
    expect(CLAIM_CLAUSES.length).toBeGreaterThan(7);
    expect([...CLAIM_CLAUSES].sort()).toEqual(Object.keys(CLAUSES).sort());
  });

  for (const kind of connectionKinds()) {
    for (const isBillingEnabled of [true, false]) {
      const where: string = `${kind}, ${
        isBillingEnabled ? "on OneUptime Cloud" : "self-hosted"
      }`;

      test(`${where}: the connection the suite starts from is claimed, and the page agrees`, () => {
        const row: ClaimRow = claimable(kind, isBillingEnabled);

        expect(isClaimable(row)).toBe(true);
        expect(
          getXcpNgCollectionStop(pageFacts(row), isBillingEnabled),
        ).toBeNull();
      });

      test(`${where}: each condition false alone stops it on the page`, () => {
        for (const clause of ROW_CLAUSES) {
          const reading: ClauseReading = CLAUSES[clause]!;

          if (reading.kind !== "row") {
            continue;
          }

          const row: ClaimRow = reading.breaks(
            claimable(kind, isBillingEnabled),
          );

          expect(reading.holds(row)).toBe(false);
          expect(isClaimable(row)).toBe(false);
          expect(
            getXcpNgCollectionStop(pageFacts(row), isBillingEnabled),
          ).not.toBeNull();
        }
      });

      test(`${where}: with any two conditions false, the claim and the page agree`, () => {
        for (const first of ROW_CLAUSES) {
          for (const second of ROW_CLAUSES) {
            const firstReading: ClauseReading = CLAUSES[first]!;
            const secondReading: ClauseReading = CLAUSES[second]!;

            if (firstReading.kind !== "row" || secondReading.kind !== "row") {
              continue;
            }

            const row: ClaimRow = secondReading.breaks(
              firstReading.breaks(claimable(kind, isBillingEnabled)),
            );

            expect(
              getXcpNgCollectionStop(pageFacts(row), isBillingEnabled) === null,
            ).toBe(isClaimable(row));
          }
        }
      });
    }
  }
});

function connectionKinds(): Array<XcpNgConnectionType> {
  return [XcpNgConnectionType.XenOrchestra, XcpNgConnectionType.Xapi];
}
