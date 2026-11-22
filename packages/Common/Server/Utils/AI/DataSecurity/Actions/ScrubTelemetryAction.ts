import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import TraceScrubRule from "../../../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { sha256Hex } from "../../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
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
import { ScrubRuleSignal } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import DataStoreFindingService from "../../../../Services/DataStoreFindingService";
import LogScrubRuleService from "../../../../Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../Services/MetricPipelineRuleService";
import TraceScrubRuleService from "../../../../Services/TraceScrubRuleService";
import { readCountedTelemetryFindings } from "../../../DataSecurity/DataSecurityIssueFindings";
import { queueDataSecurityEvaluation } from "../../../DataSecurity/DataSecurityJobs";
import {
  CoveringScrubRule,
  CreatedScrubRule,
  createScrubRuleForFinding,
  findCoveringScrubRule,
  getScrubCoverage,
  previewScrubRuleForFinding,
  readFindingServiceId,
  ScrubCoverage,
  ScrubRulePreview,
  TelemetryFindingReference,
} from "../../../DataSecurity/Telemetry/TelemetryScrubCoverage";
import logger from "../../../Logger";
import CallerPermission from "../../../Permission/CallerPermission";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiIssueContext,
  DataSecurityAiPlanOutcome,
  DataSecurityAiPlannedChange,
} from "../DataSecurityAiAction";

/*
 * CONTAIN A TELEMETRY ISSUE WITH SCRUB IT (#10364).
 *
 * A telemetry issue - card numbers in a service's logs, a password in a
 * span attribute - keeps writing the data with every request until the
 * code is fixed. Scrub It (TelemetryScrubCoverage) makes the rule that
 * hides a finding's data type at its place from now on, as a person makes
 * it with one press on the finding. This proposes those rules for every
 * place the issue's check counts, in one change: what each rule is called
 * and does, read from what Scrub It would make, never a value.
 *
 * It only hides data in OneUptime, and Undo deletes the rules it made, so
 * it is a mask-only change: it runs without asking where a Data Security AI
 * rule says so. Out of the box it is proposed - a scrub rule can break a
 * team that searches its logs by what it hides, and #10366 adds what lets
 * a secret's rule run on its own: the rule proven on the very records the
 * finding was seen in, scoped to its service, for an attribute nothing in
 * the project reads (meetsDefaultConditions).
 *
 * Approving it makes each rule as the person who approved, with their own
 * permission to create log scrub rules, trace scrub rules or metric
 * pipeline rules - refused, with which, when they lack one. A place a rule
 * already covers keeps that rule and is not undone. The issue's own check
 * decides whether it worked: the findings it covers are marked scrubbed,
 * the store is evaluated again, and the issue resolves when none is left.
 */

// The most places one proposal scrubs: the issue's most matched first.
export const MAX_SCRUB_PLACES_PER_PROPOSAL: number = 20;

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

// One place the proposal scrubs, as its plan holds it.
export interface ScrubPlace {
  findingId: string;
  dataTypeId: string;
  // The name the finding kept for its type: what a rule calls a type that is gone.
  dataTypeName?: string | undefined;
  location: string;
  signal: ScrubRuleSignal;
}

export interface ScrubPlan {
  kind: DataStoreKind;
  // The service the store is the telemetry of: a metric rule is its own.
  serviceId?: string | undefined;
  places: Array<ScrubPlace>;
}

// One rule the change used, as its result holds it.
export interface ScrubRuleUsed {
  findingId: string;
  signal: ScrubRuleSignal;
  scrubRuleId: string;
  scrubRuleName: string;
  // Made by this change: Undo deletes it. One that was there stays.
  created: boolean;
}

function isSignal(value: unknown): value is ScrubRuleSignal {
  return value === "log" || value === "trace" || value === "metric";
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// A plan as stored, read strictly: a place that is not one is left out.
export function readScrubPlan(value: unknown): ScrubPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw: JSONObject = value as JSONObject;

  if (!isDataStoreKind(raw["kind"])) {
    return null;
  }

  const places: Array<ScrubPlace> = [];

  for (const item of Array.isArray(raw["places"]) ? raw["places"] : []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const place: JSONObject = item as JSONObject;
    const findingId: string = readText(place["findingId"]);
    const dataTypeId: string = readText(place["dataTypeId"]);
    const location: string = readText(place["location"]);

    if (
      !ObjectID.isValidUUID(findingId) ||
      !dataTypeId ||
      !location ||
      !isSignal(place["signal"])
    ) {
      continue;
    }

    places.push({
      findingId,
      dataTypeId,
      dataTypeName: readText(place["dataTypeName"]) || undefined,
      location,
      signal: place["signal"],
    });
  }

  return {
    kind: raw["kind"] as DataStoreKind,
    serviceId: readText(raw["serviceId"]) || undefined,
    places: places.slice(0, MAX_SCRUB_PLACES_PER_PROPOSAL),
  };
}

// The rules a change used, as its result holds them.
export function readScrubResult(value: unknown): Array<ScrubRuleUsed> {
  if (!value || typeof value !== "object") {
    return [];
  }

  const rules: unknown = (value as JSONObject)["rules"];
  const used: Array<ScrubRuleUsed> = [];

  for (const item of Array.isArray(rules) ? rules : []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const rule: JSONObject = item as JSONObject;
    const scrubRuleId: string = readText(rule["scrubRuleId"]);

    if (!ObjectID.isValidUUID(scrubRuleId) || !isSignal(rule["signal"])) {
      continue;
    }

    used.push({
      findingId: readText(rule["findingId"]),
      signal: rule["signal"],
      scrubRuleId,
      scrubRuleName: readText(rule["scrubRuleName"]),
      created: rule["created"] === true,
    });
  }

  return used;
}

function placeKey(place: { dataTypeId: string; location: string }): string {
  return `${place.dataTypeId}@${place.location}`;
}

// What makes two scrub proposals for an issue the same: the places they scrub.
export function getScrubPlanKey(places: ReadonlyArray<ScrubPlace>): string {
  const keys: Array<string> = places.map(placeKey).sort();

  return `scrub:${sha256Hex(keys.join("\n")).slice(0, 16)}`;
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
  places: ReadonlyArray<{ signal: ScrubRuleSignal }>,
): Array<ScrubRuleSignal> {
  return Array.from(
    new Set(
      places.map((place: { signal: ScrubRuleSignal }): ScrubRuleSignal => {
        return place.signal;
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
    const places: Array<
      ScrubPlace & { preview: ScrubRulePreview; matchCount: number }
    > = [];
    let unscrubbable: number = 0;
    const seen: Set<string> = new Set();

    for (const finding of counted) {
      if (places.length >= MAX_SCRUB_PLACES_PER_PROPOSAL) {
        break;
      }

      const place: ScrubPlace = {
        findingId: finding.id!.toString(),
        dataTypeId: finding.dataTypeId!,
        dataTypeName: finding.dataTypeName || undefined,
        location: finding.location!,
        signal: "log",
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

      try {
        const preview: ScrubRulePreview = await previewScrubRuleForFinding({
          projectId: context.projectId,
          kind,
          dataTypeId: place.dataTypeId,
          dataTypeName: place.dataTypeName,
          location: place.location,
          serviceId,
        });

        places.push({
          ...place,
          signal: preview.signal,
          preview,
          matchCount: finding.matchCount || 0,
        });
      } catch (error) {
        if (!(error instanceof BadDataException)) {
          throw error;
        }

        // A place no rule reaches, or a type no pattern finds: its code is the fix.
        unscrubbable++;
      }
    }

    if (places.length === 0) {
      return {
        kind: "nothing",
        detail: unscrubbable > 0 ? "not-scrubbable" : "already-scrubbed",
      };
    }

    const check: string =
      getDataSecurityCheck(context.issue.checkId || "")?.title ||
      context.issue.title ||
      "";
    const typeNames: Array<string> = Array.from(
      new Set(
        places.map((place: ScrubPlace): string => {
          return context.dataTypeNamer.nameOf(
            place.dataTypeId,
            place.dataTypeName,
          );
        }),
      ),
    );
    const storeName: string = context.store.name || "";
    const plan: ScrubPlan = {
      kind,
      ...(serviceId ? { serviceId } : {}),
      places: places.map((place: ScrubPlace): ScrubPlace => {
        return {
          findingId: place.findingId,
          dataTypeId: place.dataTypeId,
          ...(place.dataTypeName ? { dataTypeName: place.dataTypeName } : {}),
          location: place.location,
          signal: place.signal,
        };
      }),
    };

    const change: DataSecurityAiPlannedChange = {
      title:
        places.length === 1
          ? `Scrub ${typeNames[0]} in ${places[0]!.location} of ${storeName}`
          : `Scrub ${typeNames.join(", ")} in ${placesPhrase(places.length)} of ${storeName}`,
      changeMarkdown: FeedMarkdown.join(
        [
          places.length === 1
            ? mdText`One scrub rule, made as Scrub It makes it:`
            : mdText`${String(places.length)} scrub rules, made as Scrub It makes them:`,
          FeedMarkdown.bulletList(
            places.map(
              (
                place: ScrubPlace & { preview: ScrubRulePreview },
              ): MarkdownText => {
                return mdText`**${place.preview.name}** (${place.preview.signal}): ${place.preview.description}`;
              },
            ),
          ),
          unscrubbable > 0
            ? mdText`${placesPhrase(unscrubbable)} no scrub rule can reach stay as they are: only the code that writes them can stop them.`
            : mdText``,
        ].filter((part: MarkdownText): boolean => {
          return part.toString().length > 0;
        }),
        "\n\n",
      ).toString(),
      reasonMarkdown: FeedMarkdown.join(
        [
          mdText`**${check}**: ${typeNames.join(", ")} ${typeNames.length === 1 ? "was" : "were"} found in ${placesPhrase(places.length)} of ${storeName} in the last ${String(FINDING_FRESHNESS_IN_DAYS)} days, and no scrub rule hides it as the telemetry arrives. Every new record copies it again until the code stops writing it.`,
          FeedMarkdown.bulletList(
            places.map(
              (place: ScrubPlace & { matchCount: number }): MarkdownText => {
                return mdText`${FeedMarkdown.code(place.location)}: ${context.dataTypeNamer.nameOf(place.dataTypeId, place.dataTypeName)}, ${String(place.matchCount)} matched in the last scans`;
              },
            ),
          ),
        ],
        "\n\n",
      ).toString(),
      proofMarkdown:
        mdText`The issue's own check decides. Once the rules are made, the store is checked again: the issue resolves when none of its data is left unscrubbed, and every later scan keeps checking.`.toString(),
      undoMarkdown:
        mdText`Undo deletes the scrub rules this made - never a rule that was there before - and checks the store again. New telemetry is then stored as it arrives; what was hidden stays hidden.`.toString(),
      plan: plan as unknown as JSONObject,
      planKey: getScrubPlanKey(plan.places),
      /*
       * Never out of the box, yet: #10366 adds what lets a secret's rule
       * run on its own - the rule proven on the very records the finding
       * was seen in, scoped to its service, for an attribute nothing in the
       * project reads.
       */
      meetsDefaultConditions: false,
    };

    return { kind: "planned", changes: [change] };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null {
    const plan: ScrubPlan | null = readScrubPlan(data.proposal.plan);

    for (const signal of signalsOf(plan?.places || [])) {
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

    if (!plan || plan.places.length === 0) {
      throw new BadDataException(
        "This proposal no longer says what to scrub, so nothing was done.",
      );
    }

    const used: Array<ScrubRuleUsed> = [];

    try {
      for (const place of plan.places) {
        const finding: DataStoreFinding | null =
          await DataStoreFindingService.findOneBy({
            query: {
              _id: new ObjectID(place.findingId),
              projectId: data.projectId,
              dataStoreId: data.proposal.dataStoreId!,
            },
            select: { _id: true },
            props: { isRoot: true },
          });

        // Gone with its store's data: nothing of it is left to scrub.
        if (!finding) {
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
            // One this very change made for an earlier place is still its own.
            created: used.some((rule: ScrubRuleUsed): boolean => {
              return rule.created && rule.scrubRuleId === existing.id;
            }),
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
    } catch (error) {
      // All or nothing: the rules this change made before it stopped go too.
      for (const rule of used) {
        if (!rule.created) {
          continue;
        }

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

    return {
      result: { rules: used as unknown as JSONObject[] } as JSONObject,
      summaryMarkdown: (names.length === 0
        ? mdText`Every place was already covered by a scrub rule, so no rule was made. The store is being checked again.`
        : mdText`Scrub rules made: ${FeedMarkdown.join(names)}. The store is being checked again.`
      ).toString(),
    };
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

    for (const rule of made) {
      if (deleted.has(rule.scrubRuleId)) {
        continue;
      }

      // As the person who pressed Undo: refused where they could not delete it.
      await deleteRule({ rule, props: data.actor.props });
      deleted.add(rule.scrubRuleId);
    }

    const plan: ScrubPlan | null = readScrubPlan(data.proposal.plan);

    if (plan) {
      await markFindings({ projectId: data.projectId, plan });
    }

    await queueDataSecurityEvaluation(data.projectId);

    const names: Array<MarkdownText> = made.map(
      (rule: ScrubRuleUsed): MarkdownText => {
        return mdText`**${rule.scrubRuleName}**`;
      },
    );

    return {
      summaryMarkdown: (names.length === 0
        ? mdText`It made no rule of its own, so nothing was deleted. The store is being checked again.`
        : mdText`Scrub rules deleted: ${FeedMarkdown.join(names)}. The store is being checked again.`
      ).toString(),
    };
  },
};

export default ScrubTelemetryAction;
