import {
  SECURITY_CASE_IMPACT_MAX_EVIDENCE,
  SECURITY_CASE_IMPACT_MAX_PEERS,
  SecurityCaseExposureEvidenceJson,
  SecurityCaseExposureEvidenceKind,
  SecurityCaseImpactJson,
  SecurityCaseImpactPeerJson,
  SecurityCaseImpactRecordJson,
  SecurityCaseInternetExposure,
} from "../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectionCertainty,
  SecurityConnectionChangeJson,
} from "../../Types/SecurityCase/SecurityConnection";
import SecurityEventRequestOutcome, {
  getRequestOutcomeRank,
} from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { TopologyConnectionRowJSON } from "../../Types/Topology/TopologyApi";
import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "./SecurityConnectionMatch";

/*
 * WHAT A CASE PUTS AT RISK, FROM FACTS ALREADY READ: the pure half of
 * SecurityCaseImpact (Server/Utils/SecurityCase/Context/SecurityCaseImpact.ts).
 *
 * Kept honest on purpose. A record is said to be reachable from the
 * internet only on evidence OneUptime holds - a request from a public
 * address its trace shows reached the app, or a public address the record
 * reports itself - and "unknown" otherwise: never a guess from a name or a
 * port.
 */

type ChangeWithVersion = SecurityConnectionChangeJson & {
  version?: string | undefined;
};

function timeOf(value: string): number {
  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? NaN : time;
}

/*
 * The change that tells most about the attack: the latest at or before the
 * case's first detection (the release it found), else the first after it.
 */
export function pickLastChange(
  changes: ReadonlyArray<ChangeWithVersion>,
  firstDetectedAt: Date | null,
): (ChangeWithVersion & { isBeforeFirstDetection: boolean }) | null {
  const dated: Array<ChangeWithVersion> = changes.filter(
    (change: ChangeWithVersion): boolean => {
      return !Number.isNaN(timeOf(change.time));
    },
  );

  if (dated.length === 0) {
    return null;
  }

  const firstDetection: number = firstDetectedAt
    ? firstDetectedAt.getTime()
    : Number.POSITIVE_INFINITY;

  let before: ChangeWithVersion | null = null;
  let after: ChangeWithVersion | null = null;

  for (const change of dated) {
    const time: number = timeOf(change.time);

    if (time <= firstDetection) {
      if (!before || time > timeOf(before.time)) {
        before = change;
      }
    } else if (!after || time < timeOf(after.time)) {
      after = change;
    }
  }

  if (before) {
    return { ...before, isBeforeFirstDetection: true };
  }

  return after ? { ...after, isBeforeFirstDetection: false } : null;
}

/*
 * The service map's rows for one section as peers: known ones first, the
 * busiest calls first, then by name; at most `max`.
 */
export function toImpactPeers(
  rows: ReadonlyArray<TopologyConnectionRowJSON>,
  max: number = SECURITY_CASE_IMPACT_MAX_PEERS,
): Array<SecurityCaseImpactPeerJson> {
  return [...rows]
    .sort(
      (
        first: TopologyConnectionRowJSON,
        second: TopologyConnectionRowJSON,
      ): number => {
        if (first.otherKnown !== second.otherKnown) {
          return first.otherKnown ? -1 : 1;
        }

        const byCalls: number =
          (second.callCount || 0) - (first.callCount || 0);

        if (byCalls !== 0) {
          return byCalls;
        }

        const firstName: string = first.otherName || first.otherKey;
        const secondName: string = second.otherName || second.otherKey;

        return firstName < secondName ? -1 : firstName > secondName ? 1 : 0;
      },
    )
    .slice(0, Math.max(0, max))
    .map((row: TopologyConnectionRowJSON): SecurityCaseImpactPeerJson => {
      return {
        key: row.otherKey,
        name: row.otherName || row.otherKey,
        type: row.otherType || "",
        callCount: row.callCount,
        errorCount: row.errorCount,
      };
    });
}

// A request whose trace was followed: where it came from and how far it got.
export interface ReachedRequest {
  address: string;
  time: Date;
  requestOutcome: string;
}

// An address a record reports for itself.
export interface RecordAddress {
  recordName: string;
  address: string;
}

// The outcomes that mean a request reached the app, not just its door.
const REACHED_APP_RANK: number = getRequestOutcomeRank(
  SecurityEventRequestOutcome.ReachedApp,
);

/*
 * Whether OneUptime has seen the case's records reachable from the
 * internet, and why: requests from public addresses that reached the app
 * (the furthest-reaching first, then the earliest), then public addresses the
 * records report. Each address is evidence once; at most `max` pieces.
 */
export function buildInternetExposure(data: {
  requests: ReadonlyArray<ReachedRequest>;
  recordAddresses: ReadonlyArray<RecordAddress>;
  max?: number | undefined;
}): {
  exposure: SecurityCaseInternetExposure;
  evidence: Array<SecurityCaseExposureEvidenceJson>;
} {
  const max: number = Math.max(
    0,
    data.max === undefined ? SECURITY_CASE_IMPACT_MAX_EVIDENCE : data.max,
  );
  const evidence: Array<SecurityCaseExposureEvidenceJson> = [];
  const seen: Set<string> = new Set();

  const requests: Array<ReachedRequest> = data.requests
    .filter((request: ReachedRequest): boolean => {
      return (
        getRequestOutcomeRank(request.requestOutcome) >= REACHED_APP_RANK &&
        getSecurityAddressScope(request.address) === SecurityAddressScope.Public
      );
    })
    .sort((first: ReachedRequest, second: ReachedRequest): number => {
      const byRank: number =
        getRequestOutcomeRank(second.requestOutcome) -
        getRequestOutcomeRank(first.requestOutcome);

      return byRank !== 0
        ? byRank
        : first.time.getTime() - second.time.getTime();
    });

  for (const request of requests) {
    const address: string = canonicalAddress(request.address) || "";

    if (!address || seen.has(address) || evidence.length >= max) {
      continue;
    }

    seen.add(address);
    evidence.push({
      kind: SecurityCaseExposureEvidenceKind.PublicRequestReachedApp,
      address,
      time: request.time.toISOString(),
      requestOutcome: request.requestOutcome,
    });
  }

  for (const record of data.recordAddresses) {
    const address: string = canonicalAddress(record.address) || "";

    if (
      !address ||
      seen.has(address) ||
      evidence.length >= max ||
      getSecurityAddressScope(address) !== SecurityAddressScope.Public
    ) {
      continue;
    }

    seen.add(address);
    evidence.push({
      kind: SecurityCaseExposureEvidenceKind.PublicAddress,
      address,
      recordName: record.recordName,
    });
  }

  return {
    exposure:
      evidence.length > 0
        ? SecurityCaseInternetExposure.Yes
        : SecurityCaseInternetExposure.Unknown,
    evidence,
  };
}

// The figures an impact is summed up by, for the card's first lines.
export interface SecurityCaseImpactSummary {
  recordCount: number;
  // Distinct things the records call, and that call them, on the service map.
  downstreamCount: number;
  upstreamCount: number;
  monitorCount: number;
  statusPageCount: number;
  ownerTeamCount: number;
  ownerUserCount: number;
  isInternetFacing: boolean;
  // Whether any record's calls were known at all (a map to read).
  hasDependencies: boolean;
}

export function summarizeImpact(
  impact: SecurityCaseImpactJson,
): SecurityCaseImpactSummary {
  const downstream: Set<string> = new Set();
  const upstream: Set<string> = new Set();
  const teams: Set<string> = new Set();
  const users: Set<string> = new Set();
  let monitorCount: number = 0;
  let hasDependencies: boolean = false;

  for (const record of impact.records) {
    if (record.calls || record.calledBy) {
      hasDependencies = true;
    }

    for (const peer of record.calls || []) {
      downstream.add(peer.key);
    }

    for (const peer of record.calledBy || []) {
      upstream.add(peer.key);
    }

    monitorCount += record.monitors?.count || 0;

    for (const team of record.owners?.teams || []) {
      teams.add(team.id);
    }

    for (const user of record.owners?.users || []) {
      users.add(user.id);
    }
  }

  return {
    recordCount: impact.records.length,
    downstreamCount: downstream.size,
    upstreamCount: upstream.size,
    monitorCount,
    statusPageCount: impact.statusPages?.length || 0,
    ownerTeamCount: teams.size,
    ownerUserCount: users.size,
    isInternetFacing:
      impact.internet.exposure === SecurityCaseInternetExposure.Yes,
    hasDependencies,
  };
}

// The records the impact lists first: exact connections, then by name.
export function getImpactRecordsInOrder(
  records: ReadonlyArray<SecurityCaseImpactRecordJson>,
): Array<SecurityCaseImpactRecordJson> {
  return [...records].sort(
    (
      first: SecurityCaseImpactRecordJson,
      second: SecurityCaseImpactRecordJson,
    ): number => {
      if (first.certainty !== second.certainty) {
        return first.certainty === SecurityConnectionCertainty.Exact ? -1 : 1;
      }

      return first.name < second.name ? -1 : first.name > second.name ? 1 : 0;
    },
  );
}
