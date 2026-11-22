import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import { readCustomDataTypeRowId } from "../../../../Types/DataSecurity/CustomDataTypeId";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  FindingSampleRecord,
  readFindingSampleRecords,
} from "../../../../Types/DataSecurity/FindingSampleRecord";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  getScrubOverreach,
  ScrubOverreach,
  ScrubRuleProof,
} from "../../../../Types/Telemetry/ScrubRuleProof";
import { SecurityEventsTelemetrySource } from "../../../../Types/Telemetry/TelemetryFieldReaders";
import DataSecurityCustomDataTypeService from "../../../Services/DataSecurityCustomDataTypeService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import logger from "../../Logger";
import {
  findSecurityEventsSources,
  SecurityEventsSources,
} from "../../SecurityEvent/SecurityEventsFieldReaders";
import { ContentScanOptions } from "../DataSecurityScanTypes";
import {
  proveScrubRule,
  readEachStatementOnce,
  readRowsWithRunner,
  ScrubProofFailure,
  ScrubProofOutcome,
  ScrubProofRowReader,
} from "./TelemetryScrubProof";
import {
  planScrubRuleCandidates,
  ProjectDataTypePattern,
  ScrubPlanFinding,
  ScrubRuleCandidate,
  ScrubRuleSource,
} from "./TelemetryScrubPlanner";
import { ScrubTarget } from "../../../../Types/DataSecurity/TelemetryScrubTarget";

/*
 * THE PROVEN, NARROW RULE A TELEMETRY FINDING GETS (#10366).
 *
 * Scrub It, a person's press, and OneUptime AI's containment ask the same
 * question here, so both get the same rule: the narrowest candidate the
 * planner has for the finding (TelemetryScrubPlanner) - and any OneUptime
 * AI wrote for it (Server/Utils/AI/DataSecurity/ScrubRuleWriter) - each
 * proven on the finding's records by the verifier (TelemetryScrubProof),
 * in order:
 *
 *  - the first that hides the data in every record that held it, changing
 *    at most 5 in 100 of the place's other values, is the rule;
 *  - a pattern that changes more is never offered: the planner's next
 *    candidate, the rule that names the attribute, is (#10366's decision -
 *    above the threshold, only the named-keys rule). That one is offered
 *    whatever it changes, with what it changes said;
 *  - where no candidate could be proven - the records are gone, or are of
 *    a kind no rule is proven on (exceptions, replays) - the first
 *    candidate is the rule, unproven: Scrub It makes it as it always did,
 *    and OneUptime AI only proposes it.
 *
 * Reads the finding's records as the server (it is a check, not a page);
 * nothing it reads leaves it but counts.
 */

export interface ProvenScrubCandidate {
  candidate: ScrubRuleCandidate;
  outcome: ScrubProofOutcome;
  overreach: ScrubOverreach;
}

export interface ScrubRulePlanOfFinding {
  // The rule the finding gets, or null when no rule can hide it.
  chosen: ProvenScrubCandidate | null;
  // Whether the chosen rule carries a proof: proven on the finding's records.
  isProven: boolean;
  // Every candidate tried, in order, and how each fared.
  tried: Array<ProvenScrubCandidate>;
}

// A finding as a plan reads it: its place, and the records it was seen in.
export interface ScrubPlanFindingRecord {
  findingId?: string | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  dataCategory?: string | null | undefined;
  location: string;
  target: ScrubTarget & { signal: "log" | "trace" };
  sampleRecords?: ReadonlyArray<FindingSampleRecord> | undefined;
  lastSeenAt?: Date | null | undefined;
  projectType?: ProjectDataTypePattern | undefined;
}

/*
 * Whether a proof failed in a way no other candidate fixes: nothing could
 * be read or proven. A function, not a set made when this loads: the
 * services that load the scrub action load this before the verifier is
 * done loading.
 */
function isUnprovable(failure: ScrubProofFailure | undefined): boolean {
  return (
    failure === ScrubProofFailure.NotProvable ||
    failure === ScrubProofFailure.CouldNotRead ||
    failure === ScrubProofFailure.NothingToProveOn
  );
}

/*
 * A finding's records and category as the server keeps them, read by id -
 * or null for a finding that is gone.
 */
export async function readScrubPlanFindingRecord(data: {
  projectId: ObjectID;
  findingId: string;
  kind: DataStoreKind;
  target: ScrubTarget & { signal: "log" | "trace" };
}): Promise<ScrubPlanFindingRecord | null> {
  if (!ObjectID.isValidUUID(data.findingId)) {
    return null;
  }

  const finding: DataStoreFinding | null =
    await DataStoreFindingService.findOneBy({
      query: { _id: data.findingId, projectId: data.projectId },
      select: {
        _id: true,
        dataTypeId: true,
        dataCategory: true,
        location: true,
        sampleRecords: true,
        lastSeenAt: true,
      },
      props: { isRoot: true },
    });

  if (!finding?.dataTypeId || !finding.location) {
    return null;
  }

  return {
    findingId: data.findingId,
    kind: data.kind,
    dataTypeId: finding.dataTypeId,
    dataCategory: finding.dataCategory || null,
    location: finding.location,
    target: data.target,
    sampleRecords: readFindingSampleRecords(finding.sampleRecords),
    lastSeenAt: finding.lastSeenAt || null,
    projectType: await readProjectDataTypePattern({
      projectId: data.projectId,
      dataTypeId: finding.dataTypeId,
    }),
  };
}

// One of the project's own data types, by its custom:<id>: its pattern and category.
export async function readProjectDataTypePattern(data: {
  projectId: ObjectID;
  dataTypeId: string;
}): Promise<ProjectDataTypePattern | undefined> {
  const rowId: string | null = readCustomDataTypeRowId(data.dataTypeId);

  if (!rowId || !ObjectID.isValidUUID(rowId)) {
    return undefined;
  }

  try {
    const row: DataSecurityCustomDataType | null =
      await DataSecurityCustomDataTypeService.findOneBy({
        query: { _id: rowId, projectId: data.projectId },
        select: { _id: true, category: true, pattern: true, ignoreCase: true },
        props: { isRoot: true },
      });

    return row
      ? {
          category: row.category || null,
          pattern: row.pattern || null,
          ignoreCase: row.ignoreCase === true,
        }
      : undefined;
  } catch (error) {
    logger.warn(
      `DataSecurity: could not read the data type ${data.dataTypeId} of project ${data.projectId.toString()}:`,
    );
    logger.warn(error);
    return undefined;
  }
}

// Security Events' scans that read a kind of record, asked only for an IP address (#10396).
async function readSecurityEventsSources(data: {
  projectId: ObjectID;
  finding: ScrubPlanFindingRecord;
}): Promise<Array<SecurityEventsTelemetrySource>> {
  if (data.finding.dataTypeId !== "ip-address") {
    return [];
  }

  const read: SecurityEventsSources = await findSecurityEventsSources({
    projectId: data.projectId,
    signal: data.finding.target.signal,
  });

  return read.isChecked ? read.sources : [];
}

/*
 * Prove each candidate in turn, and pick the rule: the first that hides
 * the data with at most the overreach a pattern may have, a named-keys
 * rule whatever it changes, or - where nothing could be proven at all -
 * the first candidate, unproven.
 */
export async function planProvenScrubRule(data: {
  projectId: ObjectID;
  finding: ScrubPlanFindingRecord;
  // The service the rule is for: the finding's.
  serviceId: string;
  options: ContentScanOptions;
  // OneUptime AI's candidates, tried after the planner's own.
  extraCandidates?: ReadonlyArray<ScrubRuleCandidate> | undefined;
  // These candidates and no others: the planner's were tried already.
  onlyCandidates?: ReadonlyArray<ScrubRuleCandidate> | undefined;
  now?: Date | undefined;
  readRows?: ScrubProofRowReader | undefined;
}): Promise<ScrubRulePlanOfFinding> {
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const planFinding: ScrubPlanFinding = {
    dataTypeId: data.finding.dataTypeId,
    dataCategory: data.finding.dataCategory,
    location: data.finding.location,
    target: data.finding.target,
    projectType: data.finding.projectType,
  };
  const candidates: Array<ScrubRuleCandidate> = data.onlyCandidates
    ? [...data.onlyCandidates]
    : [
        ...planScrubRuleCandidates({
          finding: planFinding,
          securityEventsSources: await readSecurityEventsSources({
            projectId: data.projectId,
            finding: data.finding,
          }),
          serviceId: data.serviceId,
        }),
        ...(data.extraCandidates || []),
      ];
  const tried: Array<ProvenScrubCandidate> = [];
  let cannotProve: boolean = true;
  // Every candidate on the same records, read once.
  const readRows: ScrubProofRowReader = readEachStatementOnce(
    data.readRows || readRowsWithRunner,
  );

  for (const candidate of candidates) {
    const outcome: ScrubProofOutcome = await proveScrubRule({
      projectId: data.projectId,
      rule: {
        signal: candidate.signal,
        patternType: candidate.patternType,
        customRegex: candidate.customRegex,
        attributeKeys: candidate.attributeKeys,
        scrubAction: candidate.scrubAction,
        fieldsToScrub: candidate.fieldsToScrub,
        serviceId: data.serviceId,
      },
      finding: {
        findingId: data.finding.findingId,
        kind: data.finding.kind,
        dataTypeId: data.finding.dataTypeId,
        location: data.finding.location,
        sampleRecords: data.finding.sampleRecords,
        lastSeenAt: data.finding.lastSeenAt,
      },
      options: data.options,
      now,
      readRows,
    });
    const proven: ProvenScrubCandidate = {
      candidate,
      outcome,
      overreach: getScrubOverreach(outcome.overreach),
    };

    tried.push(proven);

    if (!isUnprovable(outcome.failure)) {
      cannotProve = false;
    }

    if (!outcome.covers) {
      continue;
    }

    // Above the threshold a pattern is not offered; the rule that names the attribute is.
    if (
      proven.overreach === ScrubOverreach.TooMuch &&
      candidate.source !== ScrubRuleSource.NamedKeys
    ) {
      continue;
    }

    return { chosen: proven, isProven: true, tried };
  }

  // Nothing could be proven at all: the narrowest candidate, as Scrub It always made it.
  if (cannotProve && tried.length > 0) {
    return { chosen: tried[0]!, isProven: false, tried };
  }

  return { chosen: null, isProven: false, tried };
}

// The proof a chosen rule keeps, or null for one that was not proven.
export function getProofOfPlan(
  plan: ScrubRulePlanOfFinding,
): ScrubRuleProof | null {
  return plan.isProven && plan.chosen ? plan.chosen.outcome.proof : null;
}
