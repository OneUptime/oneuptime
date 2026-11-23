import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { ScrubTarget } from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  getScrubOverreach,
  ScrubOverreach,
  ScrubRuleProof,
} from "../../../../Types/Telemetry/ScrubRuleProof";
import LogScrubRuleService from "../../../Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../Services/TraceScrubRuleService";
import WorkspaceActionAuthorization from "../../Workspace/WorkspaceActionAuthorization";
import DataSecurityRunner from "../DataSecurityRunner";
import { ContentScanOptions } from "../DataSecurityScanTypes";
import {
  CoveringScrubRule,
  CreatedScrubRule,
  createScrubRuleForFinding,
  describeRule,
  findCoveringScrubRule,
  getScrubCoverage,
  nameScrubItRule,
  planScrubRule,
  readFindingServiceId,
  readScrubbableTarget,
  readScrubScopeOfFinding,
  ScrubItRule,
  ScrubRuleOrigin,
  ScrubRulePlan,
  ScrubRuleScopeOfFinding,
  nameTypeForRule,
} from "./TelemetryScrubCoverage";
import {
  findSecurityEventsSources,
  SecurityEventsSources,
} from "../../SecurityEvent/SecurityEventsFieldReaders";
import {
  planProvenScrubRule,
  readProjectDataTypePattern,
  readScrubPlanFindingRecord,
  ScrubPlanFindingRecord,
  ScrubRulePlanOfFinding,
} from "./TelemetryScrubPlan";
import { ScrubProofRowReader } from "./TelemetryScrubProof";
import {
  planScrubRuleCandidates,
  ScrubRuleCandidate,
  ScrubRuleSource,
} from "./TelemetryScrubPlanner";

/*
 * SCRUB IT, WITH THE PROVEN, NARROW RULE (#10366).
 *
 * Scrub It used to make one kind of rule a finding's type allowed - its
 * built-in pattern, the sensitive-keys denylist, a custom pattern of its
 * detectors - and said "no rule can" to the rest: a person's name, a
 * routing number, one of the project's own types. Now a press, the dialog
 * before it, and OneUptime AI's proposals all get the rule the planner and
 * the verifier choose for the finding (TelemetryScrubPlan): the narrowest
 * candidate that hides the data on the very records the finding was seen
 * in, with its proof, for the finding's service. Where nothing can be read
 * to prove it on, it is the narrowest candidate, unproven, as Scrub It
 * always made its rule. A metric's attribute keeps its pipeline rule.
 */

export interface ProvenScrubItRule extends ScrubItRule {
  // How the rule was chosen: the planner's candidate, or OneUptime AI's.
  source: ScrubRuleSource;
  // Proven on the finding's records, or null when nothing could be read to prove it on.
  proof: ScrubRuleProof | null;
  // How much of the place's other data it changed; null when unproven.
  overreach: ScrubOverreach | null;
  // The finding the proof was made on, when there was one.
  findingId?: string | undefined;
}

function toPlan(candidate: ScrubRuleCandidate): ScrubRulePlan {
  const plan: ScrubRulePlan = {
    patternType: candidate.patternType,
    scrubAction: candidate.scrubAction,
    fieldsToScrub: candidate.fieldsToScrub,
  };

  if (candidate.customRegex) {
    plan.customRegex = candidate.customRegex;
  }

  if ((candidate.attributeKeys || []).length > 0) {
    plan.attributeKeys = [...candidate.attributeKeys!];
  }

  if (candidate.hashesForSecurityEvents) {
    plan.hashesForSecurityEvents = true;
  }

  return plan;
}

/*
 * The rule Scrub It - or OneUptime AI - makes for a finding of logs or
 * traces no rule covers yet, with its proof: refused (BadDataException),
 * in the words Scrub It answers with, where no rule can hide it.
 */
export async function planProvenScrubItRule(data: {
  projectId: ObjectID;
  kind: DataStoreKind;
  dataTypeId: string;
  dataTypeName?: string | null | undefined;
  location: string;
  target: ScrubTarget & { signal: "log" | "trace" };
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
  // The finding: its records are what the rule is proven on.
  findingId?: string | null | undefined;
  // OneUptime AI's candidates, tried after the planner's own.
  extraCandidates?: ReadonlyArray<ScrubRuleCandidate> | undefined;
  /*
   * These candidates and no others - OneUptime AI's, once the planner's
   * were tried: refused (BadDataException) when none is proven.
   */
  onlyCandidates?: ReadonlyArray<ScrubRuleCandidate> | undefined;
  options?: ContentScanOptions | undefined;
  origin?: ScrubRuleOrigin | undefined;
  readRows?: ScrubProofRowReader | undefined;
  now?: Date | undefined;
}): Promise<ProvenScrubItRule> {
  const scope: ScrubRuleScopeOfFinding = await readScrubScopeOfFinding(data);
  const record: ScrubPlanFindingRecord | null =
    data.findingId && scope.serviceId
      ? await readScrubPlanFindingRecord({
          projectId: data.projectId,
          findingId: data.findingId,
          kind: data.kind,
          target: data.target,
        })
      : null;
  let candidate: ScrubRuleCandidate | null = null;
  let proof: ScrubRuleProof | null = null;
  let overreach: ScrubOverreach | null = null;

  if (record && scope.serviceId) {
    const planned: ScrubRulePlanOfFinding = await planProvenScrubRule({
      projectId: data.projectId,
      finding: record,
      serviceId: scope.serviceId.toString().toLowerCase(),
      options:
        data.options ||
        (await DataSecurityRunner.getScanSetup(data.projectId)).options,
      extraCandidates: data.extraCandidates,
      onlyCandidates: data.onlyCandidates,
      readRows: data.readRows,
      now: data.now,
    });

    if (data.onlyCandidates && !planned.isProven) {
      throw new BadDataException(
        "None of the rules given hides this data on the records it was seen in.",
      );
    }

    if (planned.chosen) {
      candidate = planned.chosen.candidate;

      if (planned.isProven) {
        proof = planned.chosen.outcome.proof;
        overreach = getScrubOverreach(planned.chosen.outcome.overreach);
      }
    } else if (planned.tried.length > 0) {
      throw new BadDataException(
        "No rule OneUptime can make hides this data without hiding far more than it: each one tried was proven on the records it was seen in, and failed. Stop sending it in the code that writes it.",
      );
    }
  }

  if (!candidate) {
    /*
     * Nothing to prove it on - a replay's, a finding kept without its
     * records: the narrowest candidate, unproven, as Scrub It always made
     * its rule - refused in Scrub It's own words where there is none.
     */
    const sources: SecurityEventsSources | null =
      data.dataTypeId === "ip-address"
        ? await findSecurityEventsSources({
            projectId: data.projectId,
            signal: data.target.signal,
          })
        : null;

    candidate =
      planScrubRuleCandidates({
        finding: {
          dataTypeId: data.dataTypeId,
          dataCategory: record?.dataCategory || null,
          location: data.location,
          target: data.target,
          projectType:
            record?.projectType ||
            (await readProjectDataTypePattern({
              projectId: data.projectId,
              dataTypeId: data.dataTypeId,
            })),
        },
        securityEventsSources: sources?.isChecked ? sources.sources : [],
        serviceId: scope.serviceId?.toString().toLowerCase() || null,
      })[0] || null;

    if (!candidate) {
      // Throws, saying why no rule can hide this data.
      const plan: ScrubRulePlan = planScrubRule({
        dataTypeId: data.dataTypeId,
        location: data.location,
        target: data.target,
      });

      candidate = {
        source: ScrubRuleSource.TypePattern,
        signal: data.target.signal,
        ...plan,
      };
    }
  }

  const plan: ScrubRulePlan = toPlan(candidate);
  const dataTypeName: string = await nameTypeForRule({
    projectId: data.projectId,
    dataTypeId: data.dataTypeId,
    dataTypeName: data.dataTypeName,
  });

  return {
    signal: data.target.signal,
    plan,
    dataTypeId: data.dataTypeId,
    dataTypeName,
    scope,
    name: nameScrubItRule({
      plan,
      signal: data.target.signal,
      dataTypeName,
      scope,
    }),
    description: describeRule({
      plan,
      signal: data.target.signal,
      dataTypeName,
      location: data.location,
      kind: data.kind,
      scope,
      origin: data.origin,
    }),
    source: candidate.source,
    proof,
    overreach,
    ...(data.findingId ? { findingId: data.findingId } : {}),
  };
}

/*
 * The props a rule is made with: as the person who pressed or approved,
 * with their own permission to create it - or as OneUptime, for a change
 * made without asking.
 */
async function propsFor(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
}): Promise<DatabaseCommonInteractionProps> {
  if (!data.userId) {
    return { isRoot: true };
  }

  return await WorkspaceActionAuthorization.getProjectMemberProps({
    userId: data.userId,
    projectId: data.projectId,
  });
}

function idOf(rule: LogScrubRule | TraceScrubRule): string {
  const id: string | undefined = rule.id?.toString() || rule._id?.toString();

  if (!id) {
    throw new BadDataException("The scrub rule was not saved.");
  }

  return id;
}

/*
 * A planned rule, saved: with its keys and its proof - the proof written
 * as OneUptime whoever makes the rule, since no person may write one.
 */
export async function saveProvenScrubItRule(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  planned: Pick<
    ProvenScrubItRule,
    "signal" | "plan" | "scope" | "name" | "description" | "proof"
  >;
}): Promise<CreatedScrubRule> {
  const props: DatabaseCommonInteractionProps = await propsFor(data);
  const plan: ScrubRulePlan = data.planned.plan;
  const rule: LogScrubRule | TraceScrubRule =
    data.planned.signal === "log" ? new LogScrubRule() : new TraceScrubRule();

  rule.projectId = data.projectId;
  rule.name = data.planned.name;
  rule.description = data.planned.description;
  rule.patternType = plan.patternType;
  rule.scrubAction = plan.scrubAction;
  rule.fieldsToScrub = plan.fieldsToScrub;
  rule.isEnabled = true;

  if (data.planned.scope.serviceId) {
    rule.serviceId = data.planned.scope.serviceId;
  }

  if (plan.customRegex) {
    rule.customRegex = plan.customRegex;
  }

  if ((plan.attributeKeys || []).length > 0) {
    rule.attributeKeys = [...plan.attributeKeys!];
  }

  const created: LogScrubRule | TraceScrubRule =
    data.planned.signal === "log"
      ? await LogScrubRuleService.create({
          data: rule as LogScrubRule,
          props,
        })
      : await TraceScrubRuleService.create({
          data: rule as TraceScrubRule,
          props,
        });
  const scrubRuleId: string = idOf(created);

  // The proof, as OneUptime: the column takes no person's write.
  if (data.planned.proof) {
    const proof: JSONObject = data.planned.proof as unknown as JSONObject;

    if (data.planned.signal === "log") {
      await LogScrubRuleService.updateOneById({
        id: new ObjectID(scrubRuleId),
        data: { proof } as never,
        props: { isRoot: true },
      });
    } else {
      await TraceScrubRuleService.updateOneById({
        id: new ObjectID(scrubRuleId),
        data: { proof } as never,
        props: { isRoot: true },
      });
    }
  }

  return {
    signal: data.planned.signal,
    scrubRuleId,
    scrubRuleName: created.name || data.planned.name,
  };
}

/*
 * Scrub It on a telemetry finding: the enabled rule that already hides it,
 * or the proven, narrow rule for it, made as the person who pressed - or,
 * for a metric's attribute, its service's pipeline rule, as always.
 * Refuses (BadDataException) what no rule can hide, in Scrub It's words.
 */
export async function scrubFindingWithProvenRule(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  findingId?: string | null | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  dataTypeName?: string | null | undefined;
  location: string;
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
}): Promise<CreatedScrubRule & { isProven: boolean }> {
  const scrubbable: {
    location: string;
    dataTypeId: string;
    target: ScrubTarget;
  } = readScrubbableTarget(data);

  if (scrubbable.target.signal === "metric") {
    return {
      ...(await createScrubRuleForFinding(data)),
      isProven: false,
    };
  }

  const existing: CoveringScrubRule | null = findCoveringScrubRule(
    await getScrubCoverage(data.projectId),
    {
      kind: data.kind,
      dataTypeId: scrubbable.dataTypeId,
      location: scrubbable.location,
      serviceId: readFindingServiceId(data) || data.serviceId,
    },
  );

  if (existing) {
    return {
      signal: existing.signal,
      scrubRuleId: existing.id,
      scrubRuleName: existing.name,
      isProven: Boolean(existing.provenPlaces?.length),
    };
  }

  const planned: ProvenScrubItRule = await planProvenScrubItRule({
    ...data,
    location: scrubbable.location,
    dataTypeId: scrubbable.dataTypeId,
    target: scrubbable.target as ScrubTarget & { signal: "log" | "trace" },
  });

  return {
    ...(await saveProvenScrubItRule({
      projectId: data.projectId,
      userId: data.userId,
      planned,
    })),
    isProven: Boolean(planned.proof),
  };
}
