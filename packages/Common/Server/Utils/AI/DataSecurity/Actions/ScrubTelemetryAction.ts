import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import TraceScrubRule from "../../../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  FINDING_FRESHNESS_IN_DAYS,
  getDataSecurityCheck,
  isTelemetryFindingCheck,
} from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataStoreKind,
  isDataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../../../../Types/DataSecurity/DataStoreKind";
import { ScrubRuleWriterPlace } from "../../../../../Types/DataSecurity/ScrubRuleWriterPlace";
import {
  ScrubRuleSignal,
  ScrubTarget,
} from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describeScrubRuleProof } from "../../../../../Types/Telemetry/ScrubRuleProof";
import {
  isEveryTelemetryFieldReaderChecked,
  TELEMETRY_FIELD_READER_KINDS,
  TelemetryFieldReaderKind,
  TelemetryFieldReaders,
} from "../../../../../Types/Telemetry/TelemetryFieldReaders";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityAiProposalService from "../../../../Services/DataSecurityAiProposalService";
import DataStoreFindingService from "../../../../Services/DataStoreFindingService";
import DataStoreService from "../../../../Services/DataStoreService";
import LogScrubRuleService from "../../../../Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../Services/MetricPipelineRuleService";
import TraceScrubRuleService from "../../../../Services/TraceScrubRuleService";
import DataSecurityContainmentNotice from "../../../DataSecurity/DataSecurityContainmentNotice";
import { readCountedTelemetryFindings } from "../../../DataSecurity/DataSecurityIssueFindings";
import { queueDataSecurityEvaluation } from "../../../DataSecurity/DataSecurityJobs";
import DataSecurityRunner from "../../../DataSecurity/DataSecurityRunner";
import { ContentScanOptions } from "../../../DataSecurity/DataSecurityScanTypes";
import {
  CoveringScrubRule,
  CreatedScrubRule,
  createScrubRuleForFinding,
  describeRule,
  findCoveringScrubRule,
  getScrubCoverage,
  nameScrubItRule,
  previewScrubRuleForFinding,
  readFindingServiceId,
  readScrubbableTarget,
  SCRUB_SERVICE_GONE,
  ScrubCoverage,
  ScrubRuleOrigin,
  ScrubRulePlan,
  ScrubRulePreview,
  ScrubRuleScopeOfFinding,
  TelemetryFindingReference,
} from "../../../DataSecurity/Telemetry/TelemetryScrubCoverage";
import { findScrubRuleReaders } from "../../../DataSecurity/Telemetry/TelemetryScrubImpact";
import {
  planProvenScrubItRule,
  ProvenScrubItRule,
  saveProvenScrubItRule,
} from "../../../DataSecurity/Telemetry/TelemetryScrubIt";
import {
  canMergeScrubRules,
  MergeableScrubRule,
  mergeScrubRuleKeys,
  mergeScrubRuleProofs,
} from "../../../DataSecurity/Telemetry/TelemetryScrubMerge";
import {
  readScrubPlanFindingRecord,
  ScrubPlanFindingRecord,
} from "../../../DataSecurity/Telemetry/TelemetryScrubPlan";
import {
  getAttributeKeyOfTarget,
  getScrubFindingCategory,
  ScrubRuleCandidate,
} from "../../../DataSecurity/Telemetry/TelemetryScrubPlanner";
import { describeScrubPlace } from "../../../DataSecurity/Telemetry/TelemetryScrubShapes";
import logger from "../../../Logger";
import CallerPermission from "../../../Permission/CallerPermission";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiIssueContext,
  DataSecurityAiPlanOutcome,
  DataSecurityAiPlannedChange,
} from "../DataSecurityAiAction";
import ScrubRuleWriter, {
  ScrubRuleWriterOutcome,
  toScrubRuleCandidate,
} from "../ScrubRuleWriter";
import {
  describeScrubPlanRule,
  getScrubLane,
  getScrubPlanKey,
  getScrubRotateLines,
  getScrubWaitReasons,
  joinRuleLines,
  MAX_SCRUB_PLACES_PER_PROPOSAL,
  placeKey,
  readScrubPlan,
  readScrubResult,
  ScrubLane,
  ScrubPlace,
  ScrubPlan,
  ScrubPlanRule,
  ScrubReaderCounts,
  ScrubRuleUsed,
  SCRUB_PLAN_VERSION,
} from "./ScrubTelemetryPlan";

export {
  getScrubPlanKey,
  MAX_SCRUB_PLACES_PER_PROPOSAL,
  readScrubPlan,
  readScrubResult,
  ScrubLane,
};
export type { ScrubPlace, ScrubPlan, ScrubPlanRule, ScrubRuleUsed };

/*
 * CONTAIN A TELEMETRY ISSUE ON ITS OWN WHERE IT IS PROVEN SAFE, AND
 * PROPOSE THE REST (#10364, #10366).
 *
 * A telemetry issue - card numbers in a service's logs, a password in a
 * span attribute - keeps writing the data with every request until the
 * code is fixed. For every place the issue's check counts, this plans the
 * rule Scrub It would make (TelemetryScrubIt): the narrowest candidate the
 * planner has, proven by the verifier on the very records the finding was
 * seen in - and, where none of Scrub It's rules can hide the data, one
 * OneUptime AI wrote from the names and shapes around it, never a value
 * (ScrubRuleWriter), proven the same way. Rules that hide the same way in
 * the same records are one (TelemetryScrubMerge), and what reads each is
 * looked up (TelemetryScrubImpact.findScrubRuleReaders).
 *
 * Each rule then goes in a lane (ScrubTelemetryPlan), and each lane is its
 * own proposal: a secret's rule that is proven, its service's, changed
 * nothing else at its place, and hides what nothing reads runs without
 * asking out of the box; the same for other data runs on its own only where
 * an AI rule says so; everything else waits for a person, whatever a rule
 * says. A change made without asking is on the issue's timeline with its
 * proof and an Undo, and its store's and service's owners are emailed -
 * for a secret, that it must be rotated, and where it was seen.
 *
 * Approving makes each rule as the person who approved, with their own
 * permission to create log scrub rules, trace scrub rules or metric
 * pipeline rules - refused, with which, when they lack one. A place a rule
 * already covers keeps that rule and is not undone. The issue's own check
 * decides whether it worked: the findings it covers are marked scrubbed,
 * the store is evaluated again, and the issue resolves when none is left.
 */

const RULE_PERMISSIONS: Readonly<
  Record<
    ScrubRuleSignal,
    {
      create: Array<Permission>;
      delete: Array<Permission>;
      what: string;
      createPermission: string;
      deletePermission: string;
    }
  >
> = {
  log: {
    create: new LogScrubRule().createRecordPermissions,
    delete: new LogScrubRule().deleteRecordPermissions,
    what: "log scrub rules",
    createPermission: "Create Project Log Scrub Rule",
    deletePermission: "Delete Project Log Scrub Rule",
  },
  trace: {
    create: new TraceScrubRule().createRecordPermissions,
    delete: new TraceScrubRule().deleteRecordPermissions,
    what: "trace scrub rules",
    createPermission: "Create Project Trace Scrub Rule",
    deletePermission: "Delete Project Trace Scrub Rule",
  },
  metric: {
    create: new MetricPipelineRule().createRecordPermissions,
    delete: new MetricPipelineRule().deleteRecordPermissions,
    what: "metric pipeline rules",
    createPermission: "Create Project Metric Pipeline Rule",
    deletePermission: "Delete Project Metric Pipeline Rule",
  },
};

/*
 * The statuses of an earlier change a person said no to, or that made a
 * rule: a place of one that is not covered now - undone, dismissed, or its
 * rule deleted or changed since - asks first.
 */
const SAID_NO_OR_MADE_STATUSES: ReadonlyArray<DataSecurityAiProposalStatus> = [
  DataSecurityAiProposalStatus.Applied,
  DataSecurityAiProposalStatus.AppliedWithoutAsking,
  DataSecurityAiProposalStatus.Undone,
  DataSecurityAiProposalStatus.Dismissed,
];

// One place planned: its rule, a log's or a span's, or a metric's.
interface PlannedPlace {
  place: ScrubPlace;
  // The attribute it is in, when it is in one: what the readers lookup knows holds the data.
  attributeKey: string | null;
  rule?: ProvenScrubItRule | undefined;
  metric?: ScrubRulePreview | undefined;
}

// A rule the plan makes, with the places it is for.
interface MergedRule {
  rule: ScrubPlanRule;
  places: Array<PlannedPlace>;
  // As saved: a log's or a span's rule.
  mergeable?: MergeableScrubRule | undefined;
}

function hasAnyOf(
  props: DatabaseCommonInteractionProps,
  permissions: Array<Permission>,
): boolean {
  return (
    props.isRoot === true ||
    props.isMasterAdmin === true ||
    CallerPermission.holdsAnyOf(props, permissions)
  );
}

function signalsOf(
  items: ReadonlyArray<{ signal: ScrubRuleSignal }>,
): Array<ScrubRuleSignal> {
  return Array.from(
    new Set(
      items.map((item: { signal: ScrubRuleSignal }): ScrubRuleSignal => {
        return item.signal;
      }),
    ),
  ).sort();
}

function referenceOf(
  plan: ScrubPlan,
  place: ScrubPlace,
): TelemetryFindingReference {
  return {
    kind: plan.kind,
    dataTypeId: place.dataTypeId,
    location: place.location,
    serviceId: plan.serviceId || null,
  };
}

// Whether a rule the change made is still there: one deleted since is undone already.
async function ruleExists(rule: ScrubRuleUsed): Promise<boolean> {
  const id: ObjectID = new ObjectID(rule.scrubRuleId);
  const query: {
    id: ObjectID;
    select: { _id: true };
    props: { isRoot: true };
  } = { id, select: { _id: true }, props: { isRoot: true } };

  switch (rule.signal) {
    case "log":
      return Boolean(await LogScrubRuleService.findOneById(query));
    case "trace":
      return Boolean(await TraceScrubRuleService.findOneById(query));
    case "metric":
      return Boolean(await MetricPipelineRuleService.findOneById(query));
  }
}

async function deleteRule(data: {
  rule: ScrubRuleUsed;
  props: DatabaseCommonInteractionProps;
}): Promise<void> {
  if (!(await ruleExists(data.rule))) {
    return;
  }

  const id: ObjectID = new ObjectID(data.rule.scrubRuleId);

  switch (data.rule.signal) {
    case "log":
      await LogScrubRuleService.deleteOneById({ id, props: data.props });
      return;
    case "trace":
      await TraceScrubRuleService.deleteOneById({ id, props: data.props });
      return;
    case "metric":
      await MetricPipelineRuleService.deleteOneById({ id, props: data.props });
      return;
  }
}

/*
 * Each finding the change was about: marked scrubbed while a rule covers
 * it, and not once none does - as Scrub It and the scans mark it - so the
 * issue's check reads it as it is now.
 */
async function markFindings(data: {
  projectId: ObjectID;
  plan: ScrubPlan;
}): Promise<void> {
  const coverage: ScrubCoverage = await getScrubCoverage(data.projectId);

  for (const place of data.plan.places) {
    await DataStoreFindingService.updateColumnsByIdWithoutHooks({
      id: new ObjectID(place.findingId),
      data: {
        isScrubbed: Boolean(
          findCoveringScrubRule(coverage, referenceOf(data.plan, place)),
        ),
      },
    });
  }
}

function placesPhrase(count: number): string {
  return count === 1 ? "1 place" : `${count} places`;
}

/*
 * The places of this issue a person said no to a rule for: a change that
 * was dismissed or undone, or that made a rule - approved, or made without
 * asking - for a place no rule covers any more (only uncovered places are
 * planned). Such a place's rule never runs on its own again.
 */
async function readTakenBackPlaces(data: {
  projectId: ObjectID;
  issueId: ObjectID | undefined;
}): Promise<Set<string>> {
  const keys: Set<string> = new Set<string>();

  if (!data.issueId) {
    return keys;
  }

  const proposals: Array<DataSecurityAiProposal> =
    await DataSecurityAiProposalService.findBy({
      query: {
        projectId: data.projectId,
        dataSecurityIssueId: data.issueId,
        kind: DataSecurityAiProposalKind.ScrubTelemetry,
        status: new Includes([...SAID_NO_OR_MADE_STATUSES]),
      },
      select: { _id: true, plan: true },
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });

  for (const proposal of proposals) {
    for (const place of readScrubPlan(proposal.plan)?.places || []) {
      keys.add(placeKey(place));
    }
  }

  return keys;
}

// What reads what a rule hides, by kind, as OneUptime counts it - or none when it could not be read.
function countReaders(
  readers: TelemetryFieldReaders,
): ScrubReaderCounts | undefined {
  if (!isEveryTelemetryFieldReaderChecked(readers)) {
    return undefined;
  }

  const counts: ScrubReaderCounts = {};

  for (const kind of TELEMETRY_FIELD_READER_KINDS) {
    counts[kind as TelemetryFieldReaderKind] =
      readers.kinds[kind].readers.length + readers.kinds[kind].hiddenCount;
  }

  return counts;
}

function toMergeable(rule: ProvenScrubItRule): MergeableScrubRule {
  return {
    signal: rule.signal,
    patternType: rule.plan.patternType,
    customRegex: rule.plan.customRegex,
    attributeKeys: rule.plan.attributeKeys,
    scrubAction: rule.plan.scrubAction,
    fieldsToScrub: rule.plan.fieldsToScrub,
    serviceId: rule.scope.serviceId?.toString().toLowerCase() || null,
  };
}

function isSecretCategory(category: string): boolean {
  return category === DataCategory.SecretsAndCredentials;
}

function typeNamesOf(
  context: DataSecurityAiIssueContext,
  places: ReadonlyArray<ScrubPlace>,
): Array<string> {
  return Array.from(
    new Set(
      places.map((place: ScrubPlace): string => {
        return context.dataTypeNamer.nameOf(
          place.dataTypeId,
          place.dataTypeName,
        );
      }),
    ),
  );
}

/*
 * The planned places' rules, as few as do the same: log and trace rules
 * that hide the same way in the same records become one, named and
 * described for every place it is for, with every place's proof. A
 * metric's pipeline rule is its own place's.
 */
function mergePlannedPlaces(data: {
  context: DataSecurityAiIssueContext;
  kind: DataStoreKind;
  planned: ReadonlyArray<PlannedPlace>;
}): Array<MergedRule> {
  const merged: Array<MergedRule> = [];

  for (const planned of data.planned) {
    if (planned.metric) {
      merged.push({
        rule: {
          signal: "metric",
          name: planned.metric.name,
          description: planned.metric.description,
          findingIds: [planned.place.findingId],
          waitReasons: [],
        },
        places: [planned],
      });
      continue;
    }

    if (!planned.rule) {
      continue;
    }

    const mergeable: MergeableScrubRule = toMergeable(planned.rule);
    const into: MergedRule | undefined = merged.find(
      (rule: MergedRule): boolean => {
        return Boolean(
          rule.mergeable && canMergeScrubRules(rule.mergeable, mergeable),
        );
      },
    );

    if (!into) {
      merged.push({
        rule: {
          signal: planned.rule.signal,
          name: planned.rule.name,
          description: planned.rule.description,
          findingIds: [planned.place.findingId],
          waitReasons: [],
        },
        places: [planned],
        mergeable,
      });
      continue;
    }

    into.places.push(planned);
    into.rule.findingIds.push(planned.place.findingId);

    if ((into.mergeable!.attributeKeys || []).length > 0) {
      into.mergeable = {
        ...into.mergeable!,
        attributeKeys: mergeScrubRuleKeys(
          into.mergeable!.attributeKeys || [],
          mergeable.attributeKeys || [],
        ),
      };
    }
  }

  // Each merged rule's own name, description, keys and proof.
  for (const rule of merged) {
    if (!rule.mergeable) {
      continue;
    }

    const first: ProvenScrubItRule = rule.places[0]!.rule!;
    const plan: ScrubRulePlan = {
      ...first.plan,
      ...(rule.mergeable.attributeKeys
        ? { attributeKeys: [...rule.mergeable.attributeKeys] }
        : {}),
    };
    const places: Array<ScrubPlace> = rule.places.map(
      (planned: PlannedPlace): ScrubPlace => {
        return planned.place;
      },
    );
    const dataTypeName: string = typeNamesOf(data.context, places).join(", ");

    if (rule.places.length > 1) {
      rule.rule.name = nameScrubItRule({
        plan,
        signal: first.signal,
        dataTypeName,
        scope: first.scope,
      });
      rule.rule.description = describeRule({
        plan,
        signal: first.signal,
        dataTypeName,
        location: places
          .map((place: ScrubPlace): string => {
            return place.location;
          })
          .join(", "),
        kind: data.kind,
        scope: first.scope,
        origin: ScrubRuleOrigin.OneUptimeAi,
        findingCount: places.length,
      });
    }

    rule.rule.patternType = plan.patternType;
    rule.rule.scrubAction = plan.scrubAction;
    rule.rule.fieldsToScrub = plan.fieldsToScrub;
    rule.rule.source = first.source;

    if (plan.customRegex) {
      rule.rule.customRegex = plan.customRegex;
    }

    if ((plan.attributeKeys || []).length > 0) {
      rule.rule.attributeKeys = [...plan.attributeKeys!];
    }

    const proof: ReturnType<typeof mergeScrubRuleProofs> =
      rule.places.length === 1
        ? first.proof
        : mergeScrubRuleProofs({
            rule: rule.mergeable,
            proofs: rule.places.map((planned: PlannedPlace) => {
              return planned.rule?.proof || null;
            }),
            now: data.context.now,
          });

    if (proof) {
      rule.rule.proof = proof;
    }
  }

  return merged;
}

/*
 * OneUptime AI's rules for the places no rule of Scrub It's can hide: each
 * place told as names and shapes (TelemetryScrubShapes), the rules it
 * writes proven on the finding's records as the planner's are - and only
 * a proven one is kept.
 */
async function writeRulesWithOneUptimeAi(data: {
  context: DataSecurityAiIssueContext;
  kind: DataStoreKind;
  serviceId: string;
  options: ContentScanOptions;
  places: ReadonlyArray<{
    place: ScrubPlace;
    target: ScrubTarget & { signal: "log" | "trace" };
  }>;
}): Promise<{ planned: Array<PlannedPlace>; unscrubbable: number }> {
  const asked: Array<{
    place: ScrubPlace;
    target: ScrubTarget & { signal: "log" | "trace" };
    told: ScrubRuleWriterPlace;
  }> = [];

  for (const item of data.places) {
    const record: ScrubPlanFindingRecord | null =
      await readScrubPlanFindingRecord({
        projectId: data.context.projectId,
        findingId: item.place.findingId,
        kind: data.kind,
        target: item.target,
      });

    if (!record) {
      continue;
    }

    const told: ScrubRuleWriterPlace | null = await describeScrubPlace({
      projectId: data.context.projectId,
      ref: `P${String(asked.length + 1)}`,
      finding: record,
      dataTypeName: data.context.dataTypeNamer.nameOf(
        item.place.dataTypeId,
        item.place.dataTypeName,
      ),
      serviceId: data.serviceId,
      options: data.options,
      now: data.context.now,
    });

    if (told) {
      asked.push({ ...item, told });
    }
  }

  if (asked.length === 0) {
    return { planned: [], unscrubbable: data.places.length };
  }

  const outcome: ScrubRuleWriterOutcome = await ScrubRuleWriter.write({
    projectId: data.context.projectId,
    places: asked.map((item: { told: ScrubRuleWriterPlace }) => {
      return item.told;
    }),
    llmProviderId: data.context.llmProviderId,
  });

  if (outcome.kind === "nothing") {
    logger.debug(
      `DataSecurity AI: OneUptime AI wrote no scrub rule for issue ${data.context.issue.id?.toString()}: ${outcome.detail}`,
    );
    return { planned: [], unscrubbable: data.places.length };
  }

  const planned: Array<PlannedPlace> = [];

  for (const item of asked) {
    const candidates: Array<ScrubRuleCandidate> = outcome.rules
      .filter((rule: { ref: string }): boolean => {
        return rule.ref === item.told.ref;
      })
      .map((rule: (typeof outcome.rules)[number]): ScrubRuleCandidate => {
        return toScrubRuleCandidate({
          rule,
          place: item.told,
          target: item.target,
        });
      });

    if (candidates.length === 0) {
      continue;
    }

    try {
      planned.push({
        place: item.place,
        attributeKey: getAttributeKeyOfTarget(item.target),
        rule: await planProvenScrubItRule({
          projectId: data.context.projectId,
          kind: data.kind,
          dataTypeId: item.place.dataTypeId,
          dataTypeName: item.place.dataTypeName,
          location: item.place.location,
          target: item.target,
          serviceId: data.context.store.serviceId,
          storeKey: data.context.store.storeKey,
          findingId: item.place.findingId,
          onlyCandidates: candidates,
          options: data.options,
          origin: ScrubRuleOrigin.OneUptimeAi,
          now: data.context.now,
        }),
      });
    } catch (error) {
      if (!(error instanceof BadDataException)) {
        throw error;
      }
    }
  }

  return { planned, unscrubbable: data.places.length - planned.length };
}

/*
 * One lane's proposal: its rules, what each was proven on and what reads
 * what it hides, why it waits where it does, and - for a secret - that it
 * must be rotated, and where it was seen.
 */
function buildLaneChange(data: {
  context: DataSecurityAiIssueContext;
  kind: DataStoreKind;
  lane: ScrubLane;
  rules: ReadonlyArray<MergedRule>;
  serviceId?: string | undefined;
  serviceName?: string | undefined;
  unscrubbable: number;
}): DataSecurityAiPlannedChange {
  const places: Array<ScrubPlace> = data.rules.flatMap(
    (rule: MergedRule): Array<ScrubPlace> => {
      return rule.places.map((planned: PlannedPlace): ScrubPlace => {
        return planned.place;
      });
    },
  );
  const storeName: string = data.context.store.name || "";
  const check: string =
    getDataSecurityCheck(data.context.issue.checkId || "")?.title ||
    data.context.issue.title ||
    "";
  const typeNames: Array<string> = typeNamesOf(data.context, places);
  const rotateLines: Array<MarkdownText> = getScrubRotateLines({
    places,
    storeName,
  });
  const plan: ScrubPlan = {
    version: SCRUB_PLAN_VERSION,
    kind: data.kind,
    ...(data.serviceId ? { serviceId: data.serviceId } : {}),
    ...(data.serviceName ? { serviceName: data.serviceName } : {}),
    lane: data.lane,
    places,
    rules: data.rules.map((rule: MergedRule): ScrubPlanRule => {
      return rule.rule;
    }),
  };
  const isMadeOnItsOwn: boolean = data.lane !== ScrubLane.Ask;

  return {
    title:
      places.length === 1
        ? `Scrub ${typeNames[0]} in ${places[0]!.location} of ${storeName}`
        : `Scrub ${typeNames.join(", ")} in ${placesPhrase(places.length)} of ${storeName}`,
    changeMarkdown: FeedMarkdown.join(
      [
        data.rules.length === 1
          ? mdText`One scrub rule, made as Scrub It makes it:`
          : mdText`${String(data.rules.length)} scrub rules, made as Scrub It makes them:`,
        FeedMarkdown.bulletList(
          data.rules.map((rule: MergedRule): MarkdownText => {
            return joinRuleLines(describeScrubPlanRule(rule.rule));
          }),
        ),
        data.unscrubbable > 0
          ? mdText`${placesPhrase(data.unscrubbable)} no scrub rule can reach stay as they are: only the code that writes them can stop them.`
          : mdText``,
      ].filter((part: MarkdownText): boolean => {
        return part.toString().length > 0;
      }),
      "\n\n",
    ).toString(),
    reasonMarkdown: FeedMarkdown.join(
      [
        mdText`**${check}**: ${FeedMarkdown.join(typeNames)} ${typeNames.length === 1 ? "was" : "were"} found in ${placesPhrase(places.length)} of ${storeName} in the last ${String(FINDING_FRESHNESS_IN_DAYS)} days, and no scrub rule hides it as the telemetry arrives. Every new record copies it again until the code stops writing it.`,
        FeedMarkdown.bulletList(
          places.map((place: ScrubPlace): MarkdownText => {
            return mdText`${FeedMarkdown.code(place.location)}: ${data.context.dataTypeNamer.nameOf(place.dataTypeId, place.dataTypeName)}, ${String(place.matchCount || 0)} matched in the last scans`;
          }),
        ),
        ...rotateLines,
      ],
      "\n\n",
    ).toString(),
    proofMarkdown: FeedMarkdown.join(
      [
        isMadeOnItsOwn
          ? mdText`Each rule was proven before anything was made: run through the code ingest runs on the records the data was seen in and the newest of its service, it hid the data in every value that held it, changed none of the others at its place, and nothing in the project reads what it hides.`
          : mdText`Each rule proven before it was offered was run through the code ingest runs on the records the data was seen in and the newest of its service; what each changed is said above.`,
        mdText`The issue's own check decides. Once the rules are made, the store is checked again: the issue resolves when none of its data is left unscrubbed, and every later scan keeps checking.`,
      ],
      " ",
    ).toString(),
    undoMarkdown:
      mdText`Undo deletes the scrub rules this made - never a rule that was there before - and checks the store again: from the issue's timeline, or from Data Security > AI. New telemetry is then stored as it arrives; what was hidden stays hidden.`.toString(),
    plan: plan as unknown as JSONObject,
    planKey: getScrubPlanKey(places, data.lane),
    // A secret's proven rule nothing reads runs on its own out of the box (#10366).
    meetsDefaultConditions: data.lane === ScrubLane.Alone,
    // Anything not proven safe waits for a person, whatever a rule says.
    canRunWithoutAsking: isMadeOnItsOwn,
  };
}

// The proven rule of each lane's rule, under its bullet: what the timeline and the email say.
function provenLinesOf(plan: ScrubPlan): Array<MarkdownText> {
  return (plan.rules || [])
    .filter((rule: ScrubPlanRule): boolean => {
      return Boolean(rule.proof);
    })
    .map((rule: ScrubPlanRule): MarkdownText => {
      return mdText`**${rule.name}**: ${describeScrubRuleProof(rule.proof!)}`;
    });
}

/*
 * Make a plan's log or trace rule: the very rule that was proven, with its
 * keys and its proof, as the actor - or as OneUptime, for a change made
 * without asking.
 */
async function makeRule(data: {
  projectId: ObjectID;
  actor: DataSecurityAiActor;
  plan: ScrubPlan;
  rule: ScrubPlanRule;
}): Promise<CreatedScrubRule> {
  const scope: ScrubRuleScopeOfFinding = {
    serviceId:
      data.plan.serviceId && ObjectID.isValidUUID(data.plan.serviceId)
        ? new ObjectID(data.plan.serviceId)
        : null,
    serviceName: data.plan.serviceName || "",
  };

  return await saveProvenScrubItRule({
    projectId: data.projectId,
    userId: data.actor.userId,
    planned: {
      signal: data.rule.signal as "log" | "trace",
      plan: {
        patternType: data.rule.patternType || "",
        scrubAction: data.rule.scrubAction || "",
        fieldsToScrub: data.rule.fieldsToScrub || "",
        ...(data.rule.customRegex
          ? { customRegex: data.rule.customRegex }
          : {}),
        ...(data.rule.attributeKeys
          ? { attributeKeys: [...data.rule.attributeKeys] }
          : {}),
      },
      scope,
      name: data.rule.name,
      description: data.rule.description,
      proof: data.rule.proof || null,
    },
  });
}

async function isFindingThere(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID;
  findingId: string;
}): Promise<boolean> {
  const finding: DataStoreFinding | null =
    await DataStoreFindingService.findOneBy({
      query: {
        _id: new ObjectID(data.findingId),
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

  return Boolean(finding);
}

const ScrubTelemetryAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.ScrubTelemetry,

  appliesToCheck(checkId: string | undefined): boolean {
    return isTelemetryFindingCheck(checkId);
  },

  async plan(
    context: DataSecurityAiIssueContext,
  ): Promise<DataSecurityAiPlanOutcome> {
    const kind: unknown = context.store.kind;

    if (
      !isTelemetryFindingCheck(context.issue.checkId) ||
      !isDataStoreKind(kind) ||
      !TELEMETRY_DATA_STORE_KINDS.includes(kind)
    ) {
      return { kind: "nothing", detail: "not-telemetry" };
    }

    const counted: Array<DataStoreFinding> = (
      await readCountedTelemetryFindings({
        projectId: context.projectId,
        dataStoreId: context.store.id || context.issue.dataStoreId,
        checkId: context.issue.checkId,
        now: context.now,
      })
    ).filter((finding: DataStoreFinding): boolean => {
      return Boolean(finding.id && finding.dataTypeId && finding.location);
    });

    if (counted.length === 0) {
      return { kind: "nothing", detail: "no-unscrubbed-finding" };
    }

    const coverage: ScrubCoverage = await getScrubCoverage(context.projectId);
    // The store's service: each rule is that service's (#10433).
    const serviceId: string | undefined =
      readFindingServiceId({
        kind,
        serviceId: context.store.serviceId,
        storeKey: context.store.storeKey,
      }) ||
      context.store.serviceId?.toString() ||
      undefined;
    const takenBack: Set<string> = await readTakenBackPlaces({
      projectId: context.projectId,
      issueId: context.issue.id || undefined,
    });
    let options: ContentScanOptions | null = null;
    const planned: Array<PlannedPlace> = [];
    const forOneUptimeAi: Array<{
      place: ScrubPlace;
      target: ScrubTarget & { signal: "log" | "trace" };
    }> = [];
    let unscrubbable: number = 0;
    const seen: Set<string> = new Set();

    for (const finding of counted) {
      if (
        planned.length + forOneUptimeAi.length >=
        MAX_SCRUB_PLACES_PER_PROPOSAL
      ) {
        break;
      }

      const category: string = getScrubFindingCategory({
        dataTypeId: finding.dataTypeId!,
        dataCategory: finding.dataCategory,
      });
      const place: ScrubPlace = {
        findingId: finding.id!.toString(),
        dataTypeId: finding.dataTypeId!,
        dataTypeName: finding.dataTypeName || undefined,
        location: finding.location!,
        signal: "log",
        ...(isSecretCategory(category) ? { isSecret: true } : {}),
        ...(finding.lastSeenAt
          ? { lastSeenAt: new Date(finding.lastSeenAt).toISOString() }
          : {}),
        matchCount: finding.matchCount || 0,
      };

      if (seen.has(placeKey(place))) {
        continue;
      }

      seen.add(placeKey(place));

      // Covered already: the next scan reads it as scrubbed.
      if (
        findCoveringScrubRule(coverage, {
          kind,
          dataTypeId: place.dataTypeId,
          location: place.location,
          serviceId: serviceId || null,
        })
      ) {
        continue;
      }

      let target: ScrubTarget;

      try {
        target = readScrubbableTarget({
          kind,
          dataTypeId: place.dataTypeId,
          location: place.location,
        }).target;
      } catch (error) {
        if (!(error instanceof BadDataException)) {
          throw error;
        }

        // A place no rule reaches: its code is the fix.
        unscrubbable++;
        continue;
      }

      if (target.signal === "metric") {
        try {
          const preview: ScrubRulePreview = await previewScrubRuleForFinding({
            projectId: context.projectId,
            kind,
            dataTypeId: place.dataTypeId,
            dataTypeName: place.dataTypeName,
            location: place.location,
            serviceId,
          });

          planned.push({
            place: { ...place, signal: "metric" },
            attributeKey: null,
            metric: preview,
          });
        } catch (error) {
          if (!(error instanceof BadDataException)) {
            throw error;
          }

          unscrubbable++;
        }

        continue;
      }

      const logOrTrace: ScrubTarget & { signal: "log" | "trace" } =
        target as ScrubTarget & { signal: "log" | "trace" };
      const placed: ScrubPlace = { ...place, signal: logOrTrace.signal };

      options =
        options ||
        (await DataSecurityRunner.getScanSetup(context.projectId)).options;

      try {
        planned.push({
          place: placed,
          attributeKey: getAttributeKeyOfTarget(logOrTrace),
          rule: await planProvenScrubItRule({
            projectId: context.projectId,
            kind,
            dataTypeId: place.dataTypeId,
            dataTypeName: place.dataTypeName,
            location: place.location,
            target: logOrTrace,
            serviceId: context.store.serviceId,
            storeKey: context.store.storeKey,
            findingId: place.findingId,
            options,
            origin: ScrubRuleOrigin.OneUptimeAi,
            now: context.now,
          }),
        });
      } catch (error) {
        if (!(error instanceof BadDataException)) {
          throw error;
        }

        // A service that is gone gets no rule, whoever writes it.
        if (error.message === SCRUB_SERVICE_GONE) {
          unscrubbable++;
          continue;
        }

        // None of Scrub It's rules hides it: OneUptime AI is asked for one.
        forOneUptimeAi.push({ place: placed, target: logOrTrace });
      }
    }

    if (forOneUptimeAi.length > 0 && serviceId && options) {
      const written: { planned: Array<PlannedPlace>; unscrubbable: number } =
        await writeRulesWithOneUptimeAi({
          context,
          kind,
          serviceId: serviceId.toLowerCase(),
          options,
          places: forOneUptimeAi,
        });

      planned.push(...written.planned);
      unscrubbable += written.unscrubbable;
    } else {
      unscrubbable += forOneUptimeAi.length;
    }

    if (planned.length === 0) {
      return {
        kind: "nothing",
        detail: unscrubbable > 0 ? "not-scrubbable" : "already-scrubbed",
      };
    }

    const rules: Array<MergedRule> = mergePlannedPlaces({
      context,
      kind,
      planned,
    });

    // What reads what each rule hides, and so whether it may run on its own.
    for (const merged of rules) {
      if (merged.rule.signal !== "metric") {
        try {
          const readers: TelemetryFieldReaders = await findScrubRuleReaders({
            projectId: context.projectId,
            rule: {
              signal: merged.rule.signal,
              patternType: merged.rule.patternType || "",
              customRegex: merged.rule.customRegex,
              scrubAction: merged.rule.scrubAction,
              fieldsToScrub: merged.rule.fieldsToScrub,
              serviceId: merged.mergeable?.serviceId || null,
              dataTypeId:
                new Set(
                  merged.places.map((planned: PlannedPlace): string => {
                    return planned.place.dataTypeId;
                  }),
                ).size === 1
                  ? merged.places[0]!.place.dataTypeId
                  : null,
              attributeKeys: merged.rule.attributeKeys,
            },
            knownKeys: merged.places
              .map((planned: PlannedPlace): string => {
                return planned.attributeKey || "";
              })
              .filter(Boolean),
            // As OneUptime: counted, never named, in the plan.
            props: { isRoot: true },
          });

          merged.rule.readers = countReaders(readers);

          if (readers.securityEvents.loses.length > 0) {
            merged.rule.securityEventsLoses = true;
          }
        } catch (error) {
          logger.warn(
            `DataSecurity AI: could not read what reads scrub rule ${merged.rule.name} of project ${context.projectId.toString()}: ${error}`,
          );
        }
      }

      merged.rule.waitReasons = getScrubWaitReasons({
        rule: merged.rule,
        serviceId: merged.mergeable?.serviceId || serviceId,
        isTakenBack: merged.places.some((planned: PlannedPlace): boolean => {
          return takenBack.has(placeKey(planned.place));
        }),
      });
    }

    const allPlaces: Array<ScrubPlace> = planned.map(
      (item: PlannedPlace): ScrubPlace => {
        return item.place;
      },
    );
    const byLane: Map<ScrubLane, Array<MergedRule>> = new Map();

    for (const merged of rules) {
      const lane: ScrubLane = getScrubLane({
        rule: merged.rule,
        places: allPlaces,
      });

      byLane.set(lane, [...(byLane.get(lane) || []), merged]);
    }

    const serviceName: string =
      rules.find((merged: MergedRule): boolean => {
        return Boolean(merged.places[0]?.rule?.scope.serviceName);
      })?.places[0]?.rule?.scope.serviceName || "";
    const changes: Array<DataSecurityAiPlannedChange> = [];
    const lanes: Array<ScrubLane> = [
      ScrubLane.Alone,
      ScrubLane.Widen,
      ScrubLane.Ask,
    ].filter((lane: ScrubLane): boolean => {
      return (byLane.get(lane) || []).length > 0;
    });

    for (const lane of lanes) {
      changes.push(
        buildLaneChange({
          context,
          kind,
          lane,
          rules: byLane.get(lane)!,
          serviceId,
          serviceName: serviceName || undefined,
          // Said once: on the proposal that waits, the last there is.
          unscrubbable: lane === lanes[lanes.length - 1] ? unscrubbable : 0,
        }),
      );
    }

    return { kind: "planned", changes };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    const plan: ScrubPlan | null = readScrubPlan(data.proposal.plan);

    for (const signal of signalsOf(plan?.rules || plan?.places || [])) {
      const rule: (typeof RULE_PERMISSIONS)[ScrubRuleSignal] =
        RULE_PERMISSIONS[signal];

      if (!hasAnyOf(data.props, rule.create)) {
        return `Approving this makes ${rule.what}, and you do not have permission to create them. Ask a Project Owner or Project Admin, or for ${rule.createPermission}.`;
      }
    }

    return null;
  },

  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    const made: Array<ScrubRuleUsed> = readScrubResult(
      data.proposal.result,
    ).filter((rule: ScrubRuleUsed): boolean => {
      return rule.created;
    });

    for (const signal of signalsOf(made)) {
      const rule: (typeof RULE_PERMISSIONS)[ScrubRuleSignal] =
        RULE_PERMISSIONS[signal];

      if (!hasAnyOf(data.props, rule.delete)) {
        return `Undoing this deletes ${rule.what}, and you do not have permission to delete them. Ask a Project Owner or Project Admin, or for ${rule.deletePermission}.`;
      }
    }

    return null;
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeMade> {
    const plan: ScrubPlan | null = readScrubPlan(data.proposal.plan);

    if (
      !plan ||
      plan.places.length === 0 ||
      (plan.rules !== undefined && plan.rules.length === 0)
    ) {
      throw new BadDataException(
        "This proposal no longer says what to scrub, so nothing was done.",
      );
    }

    const used: Array<ScrubRuleUsed> = [];

    // A rule this very change made for an earlier place is still its own.
    const isMadeHere: (id: string) => boolean = (id: string): boolean => {
      return used.some((rule: ScrubRuleUsed): boolean => {
        return rule.created && rule.scrubRuleId === id;
      });
    };

    try {
      // A plan made before #10366: Scrub It's rule for each place, as it was proposed.
      if (!plan.rules) {
        for (const place of plan.places) {
          if (
            !(await isFindingThere({
              projectId: data.projectId,
              dataStoreId: data.proposal.dataStoreId!,
              findingId: place.findingId,
            }))
          ) {
            continue;
          }

          const existing: CoveringScrubRule | null = findCoveringScrubRule(
            await getScrubCoverage(data.projectId),
            referenceOf(plan, place),
          );

          if (existing) {
            used.push({
              findingId: place.findingId,
              signal: existing.signal,
              scrubRuleId: existing.id,
              scrubRuleName: existing.name,
              created: isMadeHere(existing.id),
            });
            continue;
          }

          const created: CreatedScrubRule = await createScrubRuleForFinding({
            projectId: data.projectId,
            userId: data.actor.userId,
            kind: plan.kind,
            dataTypeId: place.dataTypeId,
            dataTypeName: place.dataTypeName,
            location: place.location,
            serviceId: plan.serviceId || null,
          });

          used.push({
            findingId: place.findingId,
            signal: created.signal,
            scrubRuleId: created.scrubRuleId,
            scrubRuleName: created.scrubRuleName,
            created: true,
          });
        }
      }

      for (const rule of plan.rules || []) {
        const places: Array<ScrubPlace> = [];

        for (const findingId of rule.findingIds) {
          const place: ScrubPlace | undefined = plan.places.find(
            (item: ScrubPlace): boolean => {
              return item.findingId === findingId;
            },
          );

          // Gone with its store's data: nothing of it is left to scrub.
          if (
            place &&
            (await isFindingThere({
              projectId: data.projectId,
              dataStoreId: data.proposal.dataStoreId!,
              findingId,
            }))
          ) {
            places.push(place);
          }
        }

        if (places.length === 0) {
          continue;
        }

        const coverage: ScrubCoverage = await getScrubCoverage(data.projectId);
        const covering: Array<CoveringScrubRule | null> = places.map(
          (place: ScrubPlace): CoveringScrubRule | null => {
            return findCoveringScrubRule(coverage, referenceOf(plan, place));
          },
        );

        // Every place covered already: those rules stay theirs.
        if (
          covering.every((existing: CoveringScrubRule | null): boolean => {
            return Boolean(existing);
          })
        ) {
          places.forEach((place: ScrubPlace, index: number): void => {
            const existing: CoveringScrubRule = covering[index]!;

            used.push({
              findingId: place.findingId,
              signal: existing.signal,
              scrubRuleId: existing.id,
              scrubRuleName: existing.name,
              created: isMadeHere(existing.id),
            });
          });
          continue;
        }

        if (rule.signal === "metric") {
          for (const place of places) {
            const created: CreatedScrubRule = await createScrubRuleForFinding({
              projectId: data.projectId,
              userId: data.actor.userId,
              kind: plan.kind,
              dataTypeId: place.dataTypeId,
              dataTypeName: place.dataTypeName,
              location: place.location,
              serviceId: plan.serviceId || null,
            });

            used.push({
              findingId: place.findingId,
              signal: created.signal,
              scrubRuleId: created.scrubRuleId,
              scrubRuleName: created.scrubRuleName,
              created: true,
            });
          }
          continue;
        }

        const created: CreatedScrubRule = await makeRule({
          projectId: data.projectId,
          actor: data.actor,
          plan,
          rule,
        });

        for (const place of places) {
          used.push({
            findingId: place.findingId,
            signal: created.signal,
            scrubRuleId: created.scrubRuleId,
            scrubRuleName: created.scrubRuleName,
            created: true,
          });
        }
      }
    } catch (error) {
      // All or nothing: the rules this change made before it stopped go too.
      const deleted: Set<string> = new Set<string>();

      for (const rule of used) {
        if (!rule.created || deleted.has(rule.scrubRuleId)) {
          continue;
        }

        deleted.add(rule.scrubRuleId);

        try {
          await deleteRule({ rule, props: { isRoot: true } });
        } catch (rollbackError) {
          logger.error(
            `DataSecurity AI: could not take back scrub rule ${rule.scrubRuleId} after a change failed: ${rollbackError}`,
          );
        }
      }

      throw error;
    }

    await markFindings({ projectId: data.projectId, plan });
    await queueDataSecurityEvaluation(data.projectId);

    const made: Array<ScrubRuleUsed> = used.filter(
      (rule: ScrubRuleUsed): boolean => {
        return rule.created;
      },
    );
    const names: Array<MarkdownText> = Array.from(
      new Set(
        made.map((rule: ScrubRuleUsed): string => {
          return rule.scrubRuleName;
        }),
      ),
    ).map((name: string): MarkdownText => {
      return mdText`**${name}**`;
    });
    const storeName: string = await readStoreName(data);
    const details: Array<MarkdownText> = [
      ...provenLinesOf(plan),
      ...getScrubRotateLines({ places: plan.places, storeName }),
    ];

    if (names.length > 0) {
      details.push(
        mdText`Undo deletes these rules - never one that was there before: press Undo on this entry, or in Data Security > AI.`,
      );
    }

    return {
      result: { rules: used as unknown as JSONObject[] } as JSONObject,
      summaryMarkdown: (names.length === 0
        ? mdText`Every place was already covered by a scrub rule, so no rule was made. The store is being checked again.`
        : mdText`Scrub rules made: ${FeedMarkdown.join(names)}. The store is being checked again.`
      ).toString(),
      ...(details.length > 0
        ? { detailsMarkdown: FeedMarkdown.join(details, "\n\n").toString() }
        : {}),
    };
  },

  /*
   * A change made without asking: the store's and the service's owners are
   * emailed what was done, how it was proven and how to undo it - and, for
   * a secret, to rotate it, and where it was seen.
   */
  async onMadeWithoutAsking(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    made: DataSecurityAiChangeMade;
  }): Promise<void> {
    const plan: ScrubPlan | null = readScrubPlan(data.proposal.plan);

    if (!plan || !data.proposal.dataStoreId) {
      return;
    }

    const made: Array<ScrubRuleUsed> = readScrubResult(data.made.result).filter(
      (rule: ScrubRuleUsed): boolean => {
        return rule.created;
      },
    );

    // Nothing made, nothing to tell.
    if (made.length === 0) {
      return;
    }

    const store: DataStore | null = await DataStoreService.findOneById({
      id: data.proposal.dataStoreId,
      select: { _id: true, name: true, serviceId: true },
      props: { isRoot: true },
    });
    const storeName: string = store?.name || "";
    const madeFor: Set<string> = new Set(
      made.map((rule: ScrubRuleUsed): string => {
        return rule.findingId;
      }),
    );

    await DataSecurityContainmentNotice.send({
      projectId: data.projectId,
      dataStoreId: data.proposal.dataStoreId,
      dataStoreName: storeName,
      serviceId:
        store?.serviceId ||
        (plan.serviceId && ObjectID.isValidUUID(plan.serviceId)
          ? new ObjectID(plan.serviceId)
          : null),
      dataSecurityIssueId: data.proposal.dataSecurityIssueId || null,
      isSecret: plan.places.some((place: ScrubPlace): boolean => {
        return place.isSecret === true;
      }),
      content: {
        title: data.proposal.title || "",
        ruleLines: (plan.rules || [])
          .filter((rule: ScrubPlanRule): boolean => {
            return rule.findingIds.some((id: string): boolean => {
              return madeFor.has(id);
            });
          })
          .map((rule: ScrubPlanRule): MarkdownText => {
            return mdText`**${rule.name}**: ${rule.description}`;
          }),
        proofLines: (plan.rules || [])
          .filter((rule: ScrubPlanRule): boolean => {
            return Boolean(rule.proof);
          })
          .map((rule: ScrubPlanRule): MarkdownText => {
            return mdText`${describeScrubRuleProof(rule.proof!)} Nothing in the project reads what it hides.`;
          }),
        actionLines: getScrubRotateLines({ places: plan.places, storeName }),
      },
    });
  },

  async undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone> {
    const made: Array<ScrubRuleUsed> = readScrubResult(
      data.proposal.result,
    ).filter((rule: ScrubRuleUsed): boolean => {
      return rule.created;
    });
    const deleted: Set<string> = new Set();
    const names: Array<MarkdownText> = [];

    for (const rule of made) {
      if (deleted.has(rule.scrubRuleId)) {
        continue;
      }

      // As the person who pressed Undo: refused where they could not delete it.
      await deleteRule({ rule, props: data.actor.props });
      deleted.add(rule.scrubRuleId);
      names.push(mdText`**${rule.scrubRuleName}**`);
    }

    const plan: ScrubPlan | null = readScrubPlan(data.proposal.plan);

    if (plan) {
      await markFindings({ projectId: data.projectId, plan });
    }

    await queueDataSecurityEvaluation(data.projectId);

    return {
      summaryMarkdown: (names.length === 0
        ? mdText`It made no rule of its own, so nothing was deleted. The store is being checked again.`
        : mdText`Scrub rules deleted: ${FeedMarkdown.join(names)}. The store is being checked again.`
      ).toString(),
    };
  },
};

// The store's name, for where a secret was seen: "" when it is gone.
async function readStoreName(data: {
  proposal: DataSecurityAiProposal;
}): Promise<string> {
  if (!data.proposal.dataStoreId) {
    return "";
  }

  const store: DataStore | null = await DataStoreService.findOneById({
    id: data.proposal.dataStoreId,
    select: { _id: true, name: true },
    props: { isRoot: true },
  });

  return store?.name || "";
}

export default ScrubTelemetryAction;
