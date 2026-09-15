import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveMonitorRule from "../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import { Gray500, Green500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import RuleCriteriaMatcher from "../../Utils/Rules/RuleCriteriaMatcher";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import logger, { LogAttributes } from "../Utils/Logger";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import MonitorService from "./MonitorService";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveMonitorRuleService from "./ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";

/**
 * What a sync did, so callers (and tests) can assert on the outcome without
 * re-reading the SLO.
 */
export interface SloMonitorSyncResult {
  monitorIdsAdded: Array<string>;
  monitorIdsRemoved: Array<string>;
}

function emptyResult(): SloMonitorSyncResult {
  return { monitorIdsAdded: [], monitorIdsRemoved: [] };
}

function toIdSet(
  items: Array<{ id?: ObjectID | null }> | undefined,
): Set<string> {
  const ids: Set<string> = new Set<string>();

  for (const item of items || []) {
    const id: string = item?.id?.toString() || "";

    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

function toMonitors(ids: Iterable<string>): Array<Monitor> {
  const monitors: Array<Monitor> = [];

  for (const id of ids) {
    const monitor: Monitor = new Monitor();
    monitor.id = new ObjectID(id);
    monitors.push(monitor);
  }

  return monitors;
}

function isSameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }

  return true;
}

/*
 * The rule kind named in logs - and the model this engine evaluates, which
 * the rule-criteria runtime coverage contract looks for in this file.
 */
const RULE_KIND: string = "ServiceLevelObjectiveMonitorRule";

/**
 * Everything the engine needs to know about one rule to decide membership.
 * `findBy` hands back partial models, so this is the shape actually selected
 * rather than the full entity. `criteria: true` is load-bearing: without it a
 * criteria-backed rule reads as a legacy one whose shadowed "(?!)" name
 * pattern matches nothing.
 */
const RULE_SELECT: Select<ServiceLevelObjectiveMonitorRule> = {
  _id: true,
  projectId: true,
  serviceLevelObjectiveId: true,
  isEnabled: true,
  monitorLabels: { _id: true },
  monitorNamePattern: true,
  monitorDescriptionPattern: true,
  criteria: true,
};

/*
 * Feed items name the monitors a sync attached or detached. A rule written
 * against a whole estate can move thousands at once, so the sentence names a
 * handful, the "more information" section lists a bounded page of them, and
 * the rest are counted rather than enumerated.
 */
const MAX_MONITORS_NAMED_IN_FEED_HEADLINE: number = 5;
const MAX_MONITORS_LISTED_IN_FEED_DETAILS: number = 50;

/**
 * Keeps an SLO's monitor list in step with its monitor rules.
 *
 * An SLO can carry any number of ServiceLevelObjectiveMonitorRule rows ("every
 * monitor labelled Production", "every monitor whose name starts with api-").
 * Membership is a UNION at the SLO level: a monitor belongs to the SLO while
 * at least one ENABLED rule of that SLO matches it, and stops belonging the
 * moment none does. Two entry points drive that, because membership can be
 * invalidated from either side:
 *
 *   - the SLO side (one of its rules was created, edited, disabled or
 *     deleted) -> syncMonitorsForSlo
 *   - the monitor side (its labels, name or description changed, or it was
 *     just created) -> syncSlosForMonitor
 *
 * Both write through ServiceLevelObjective.autoAddedMonitors, which records
 * which attachments the rules own. Only those are ever detached, so a monitor
 * a human attached by hand survives every rule evaluation - including the one
 * that runs when the last rule is deleted.
 *
 * Membership is kept in sync whatever the SLO's own state: a disabled or
 * archived SLO is skipped by the evaluation worker, not by this engine, so
 * re-enabling or unarchiving one starts from the right monitor set instead of
 * whatever it held when it was switched off.
 */
export class ServiceLevelObjectiveMonitorRuleEngineServiceClass {
  /**
   * Re-evaluates every enabled rule of one SLO against every monitor in its
   * project. Use when a rule changed - it is the authoritative, self-healing
   * path and repairs any drift it finds.
   */
  @CaptureSpan()
  public async syncMonitorsForSlo(data: {
    serviceLevelObjectiveId: ObjectID;
  }): Promise<SloMonitorSyncResult> {
    const slo: ServiceLevelObjective | null =
      await ServiceLevelObjectiveService.findOneById({
        id: data.serviceLevelObjectiveId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          monitors: {
            _id: true,
          },
          autoAddedMonitors: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!slo || !slo.id || !slo.projectId) {
      return emptyResult();
    }

    const rules: Array<ServiceLevelObjectiveMonitorRule> =
      await this.findEnabledRules({
        projectId: slo.projectId,
        serviceLevelObjectiveId: slo.id,
      });

    /*
     * No enabled rule (the last one was just disabled or deleted) means
     * nothing matches, which in turn detaches everything the rules had
     * attached. Removing the rules therefore undoes them rather than leaving
     * their monitors stranded on an SLO nobody remembers configuring.
     */
    const matchedMonitors: Array<Monitor> =
      rules.length === 0
        ? []
        : await this.findMatchingMonitors({
            projectId: slo.projectId,
            rules: rules,
          });

    return await this.writeMembership({
      slo: slo,
      attachedMonitorIds: toIdSet(slo.monitors),
      autoAddedMonitorIds: toIdSet(slo.autoAddedMonitors),
      matchedMonitorIds: toIdSet(matchedMonitors),
      knownMonitors: matchedMonitors,
    });
  }

  /**
   * Re-evaluates every enabled SLO monitor rule in the project against a
   * single monitor. Use when the monitor changed: it touches only this
   * monitor's membership, and costs a fixed handful of queries per project
   * regardless of how many monitors the rules match.
   */
  @CaptureSpan()
  public async syncSlosForMonitor(data: {
    monitorId: ObjectID;
    projectId?: ObjectID | undefined;
  }): Promise<Array<SloMonitorSyncResult>> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        description: true,
        labels: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor || !monitor.id) {
      return [];
    }

    const projectId: ObjectID | undefined =
      monitor.projectId || data.projectId || undefined;

    if (!projectId) {
      return [];
    }

    const monitorId: string = monitor.id.toString();

    const rules: Array<ServiceLevelObjectiveMonitorRule> =
      await this.findEnabledRules({ projectId: projectId });

    const rulesBySloId: Map<
      string,
      Array<ServiceLevelObjectiveMonitorRule>
    > = new Map<string, Array<ServiceLevelObjectiveMonitorRule>>();

    for (const rule of rules) {
      const sloId: string = rule.serviceLevelObjectiveId?.toString() || "";

      if (!sloId) {
        continue;
      }

      const sloRules: Array<ServiceLevelObjectiveMonitorRule> =
        rulesBySloId.get(sloId) || [];
      sloRules.push(rule);
      rulesBySloId.set(sloId, sloRules);
    }

    /*
     * The SLOs this monitor's membership can change on: every SLO with an
     * enabled rule, plus every SLO that still records this monitor as
     * rule-attached. The second group has no enabled rule left (a disable or
     * delete whose own sync failed), so nothing matches there any more and
     * the monitor is released - without it, that drift would only ever be
     * repaired by the next edit to a rule on that SLO.
     */
    const candidateSloIds: Set<string> = new Set<string>(rulesBySloId.keys());

    for (const sloId of await this.findSloIdsHoldingAutoAddedMonitor({
      projectId: projectId,
      monitorId: monitor.id,
    })) {
      candidateSloIds.add(sloId);
    }

    if (candidateSloIds.size === 0) {
      return [];
    }

    const slos: Array<ServiceLevelObjective> =
      await ServiceLevelObjectiveService.findBy({
        query: {
          projectId: projectId,
          _id: QueryHelper.any(
            Array.from(candidateSloIds).map((id: string) => {
              return new ObjectID(id);
            }),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          monitors: {
            _id: true,
          },
          autoAddedMonitors: {
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const results: Array<SloMonitorSyncResult> = [];

    for (const slo of slos) {
      if (!slo.id) {
        continue;
      }

      try {
        const sloRules: Array<ServiceLevelObjectiveMonitorRule> =
          rulesBySloId.get(slo.id.toString()) || [];

        const doesMatch: boolean = sloRules.some(
          (rule: ServiceLevelObjectiveMonitorRule): boolean => {
            return this.doesMonitorMatchRule({ monitor: monitor, rule: rule });
          },
        );

        const autoAddedMonitorIds: Set<string> = toIdSet(slo.autoAddedMonitors);

        /*
         * Only this monitor's membership is in question, so the "matched" set
         * handed to writeMembership is the SLO's current rule-attached set
         * with this monitor toggled in or out. Every other rule-attached
         * monitor is reported as still matching and is left exactly where it
         * is.
         */
        const matchedMonitorIds: Set<string> = new Set<string>(
          autoAddedMonitorIds,
        );

        if (doesMatch) {
          matchedMonitorIds.add(monitorId);
        } else {
          matchedMonitorIds.delete(monitorId);
        }

        const result: SloMonitorSyncResult = await this.writeMembership({
          slo: slo,
          attachedMonitorIds: toIdSet(slo.monitors),
          autoAddedMonitorIds: autoAddedMonitorIds,
          matchedMonitorIds: matchedMonitorIds,
          knownMonitors: [monitor],
        });

        if (
          result.monitorIdsAdded.length > 0 ||
          result.monitorIdsRemoved.length > 0
        ) {
          results.push(result);
        }
      } catch (error) {
        /*
         * One SLO failing must not stop the others: the monitor has already
         * changed, and half a sync is better than none.
         */
        logger.error(
          `Error syncing SLO ${slo.id.toString()} monitor rules for monitor ${monitorId}: ${error}`,
          {
            projectId: projectId.toString(),
            monitorId: monitorId,
          } as LogAttributes,
        );
      }
    }

    return results;
  }

  /**
   * Does this monitor satisfy the rule?
   *
   * A rule with configurable `criteria` is evaluated filter by filter through
   * the shared matcher (All / Any, text and label operators). A rule without
   * it uses its legacy columns, which are ANDed with empty ones skipped - the
   * way every other monitor rule in the product reads. Either way, a rule
   * with no criteria at all matches nothing: silently measuring the entire
   * project is not a reasonable reading of an empty form. Users who genuinely
   * want that write `.*` as the name pattern.
   *
   * Pattern matching goes through RulePatternMatchUtil, the same matcher the
   * status page and network device rules use, so a pattern means the same
   * thing everywhere in the product: a case-insensitive regex, or a `*`
   * wildcard glob (#2940).
   */
  public doesMonitorMatchRule(data: {
    monitor: Monitor;
    rule: ServiceLevelObjectiveMonitorRule;
  }): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: data.rule,
      legacyFields: [
        "monitorLabels",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: false,
      matchesLegacyRule: (
        legacyRule: ServiceLevelObjectiveMonitorRule,
      ): boolean => {
        return this.doesMonitorMatchLegacyRule({
          monitor: data.monitor,
          rule: legacyRule,
        });
      },
    });
  }

  private doesMonitorMatchLegacyRule(data: {
    monitor: Monitor;
    rule: ServiceLevelObjectiveMonitorRule;
  }): boolean {
    const { monitor, rule } = data;

    const hasLabelCriteria: boolean = Boolean(
      rule.monitorLabels && rule.monitorLabels.length > 0,
    );
    const hasNameCriteria: boolean = Boolean(rule.monitorNamePattern);
    const hasDescriptionCriteria: boolean = Boolean(
      rule.monitorDescriptionPattern,
    );

    if (!hasLabelCriteria && !hasNameCriteria && !hasDescriptionCriteria) {
      return false;
    }

    if (hasLabelCriteria) {
      const ruleLabelIds: Set<string> = toIdSet(rule.monitorLabels);
      const monitorLabelIds: Set<string> = toIdSet(monitor.labels);

      let hasAnyLabel: boolean = false;

      for (const labelId of monitorLabelIds) {
        if (ruleLabelIds.has(labelId)) {
          hasAnyLabel = true;
          break;
        }
      }

      if (!hasAnyLabel) {
        return false;
      }
    }

    if (hasNameCriteria) {
      if (
        !RulePatternMatchUtil.matches(monitor.name, rule.monitorNamePattern)
      ) {
        return false;
      }
    }

    if (hasDescriptionCriteria) {
      if (
        !RulePatternMatchUtil.matches(
          monitor.description,
          rule.monitorDescriptionPattern,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * The enabled rules of a project, or of one SLO in it. Disabled rules are
   * filtered in the query rather than in memory: they match nothing, so there
   * is no reason to count them against the per-project read ceiling.
   */
  @CaptureSpan()
  private async findEnabledRules(data: {
    projectId: ObjectID;
    serviceLevelObjectiveId?: ObjectID | undefined;
  }): Promise<Array<ServiceLevelObjectiveMonitorRule>> {
    const rules: Array<ServiceLevelObjectiveMonitorRule> =
      await ServiceLevelObjectiveMonitorRuleService.findBy({
        query: data.serviceLevelObjectiveId
          ? {
              projectId: data.projectId,
              serviceLevelObjectiveId: data.serviceLevelObjectiveId,
              isEnabled: true,
            }
          : {
              projectId: data.projectId,
              isEnabled: true,
            },
        select: RULE_SELECT,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    logIfRuleReadWasTruncated({
      ruleKind: RULE_KIND,
      projectId: data.projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /**
   * Every monitor in the project at least one of `rules` matches.
   *
   * When every rule is a legacy rule with a label list, a monitor can only
   * match if it carries at least one label from the union of those lists, so
   * that union is pushed into the query - it is the criterion that usually
   * narrows the project the most. Anything else (a criteria-backed rule, a
   * pattern-only rule) could match a monitor with no labels at all, so the
   * project's monitors are read once and matched in memory. Regexes are always
   * applied in memory: Postgres regex semantics and JavaScript's are not the
   * same dialect, and the pattern a user typed has to mean one thing.
   */
  @CaptureSpan()
  private async findMatchingMonitors(data: {
    projectId: ObjectID;
    rules: Array<ServiceLevelObjectiveMonitorRule>;
  }): Promise<Array<Monitor>> {
    const rules: Array<ServiceLevelObjectiveMonitorRule> = data.rules.filter(
      (rule: ServiceLevelObjectiveMonitorRule): boolean => {
        return this.hasAnyMatchCriteria(rule);
      },
    );

    if (rules.length === 0) {
      return [];
    }

    const labelPrefilter: Array<ObjectID> | null =
      this.getLabelPrefilter(rules);

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: labelPrefilter
        ? {
            projectId: data.projectId,
            labels: labelPrefilter,
          }
        : {
            projectId: data.projectId,
          },
      select: {
        _id: true,
        name: true,
        description: true,
        labels: {
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return monitors.filter((monitor: Monitor): boolean => {
      return rules.some((rule: ServiceLevelObjectiveMonitorRule): boolean => {
        return this.doesMonitorMatchRule({ monitor: monitor, rule: rule });
      });
    });
  }

  private hasAnyMatchCriteria(rule: ServiceLevelObjectiveMonitorRule): boolean {
    if (rule.criteria !== undefined && rule.criteria !== null) {
      return true;
    }

    return Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );
  }

  /*
   * The label ids to push into the monitor query, or null when no safe
   * pre-filter exists. Safe only when EVERY rule is a legacy rule with labels:
   * each such rule requires any-of its own labels, so no monitor outside the
   * union can match any of them. The query may hand back only the matching
   * label rows, which still leaves every rule its evidence.
   */
  private getLabelPrefilter(
    rules: Array<ServiceLevelObjectiveMonitorRule>,
  ): Array<ObjectID> | null {
    const labelIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const rule of rules) {
      if (rule.criteria !== undefined && rule.criteria !== null) {
        return null;
      }

      const ruleLabels: Array<Label> = (rule.monitorLabels || []).filter(
        (label: Label): boolean => {
          return Boolean(label.id);
        },
      );

      if (ruleLabels.length === 0) {
        return null;
      }

      for (const label of ruleLabels) {
        labelIds.set(label.id!.toString(), label.id!);
      }
    }

    return labelIds.size > 0 ? Array.from(labelIds.values()) : null;
  }

  /*
   * The SLOs that record this monitor as rule-attached. Selects ids only: a
   * relation filter can narrow the joined relation rows it hands back, so the
   * membership itself is read separately by id.
   */
  private async findSloIdsHoldingAutoAddedMonitor(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<Array<string>> {
    const slos: Array<ServiceLevelObjective> =
      await ServiceLevelObjectiveService.findBy({
        query: {
          projectId: data.projectId,
          autoAddedMonitors: [data.monitorId],
        },
        select: {
          _id: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return slos
      .map((slo: ServiceLevelObjective): string => {
        return slo.id?.toString() || "";
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });
  }

  /**
   * Applies a computed match set to one SLO and persists the difference.
   *
   * `matchedMonitorIds` is the full set of monitors the rules claim. Anything
   * in it that is not attached gets attached and recorded as rule-owned;
   * anything recorded as rule-owned that the rules no longer claim gets
   * detached. Attachments that are not rule-owned are invisible to both
   * halves, which is what keeps manual monitors safe.
   *
   * `knownMonitors` are monitors the caller already read, so the feed item
   * can name them without another lookup.
   */
  private async writeMembership(data: {
    slo: ServiceLevelObjective;
    attachedMonitorIds: Set<string>;
    autoAddedMonitorIds: Set<string>;
    matchedMonitorIds: Set<string>;
    knownMonitors?: Array<Monitor> | undefined;
  }): Promise<SloMonitorSyncResult> {
    const { slo, attachedMonitorIds, autoAddedMonitorIds, matchedMonitorIds } =
      data;

    if (!slo.id) {
      return emptyResult();
    }

    const monitorIdsAdded: Array<string> = Array.from(matchedMonitorIds).filter(
      (id: string) => {
        return !attachedMonitorIds.has(id);
      },
    );

    const monitorIdsRemoved: Array<string> = Array.from(
      autoAddedMonitorIds,
    ).filter((id: string) => {
      return !matchedMonitorIds.has(id);
    });

    /*
     * A monitor a rule matches but that a human attached by hand stays
     * manual: it is never promoted into autoAddedMonitors, so the rule
     * letting go of it later detaches nothing.
     */
    const nextAutoAddedMonitorIds: Set<string> = new Set<string>(
      Array.from(autoAddedMonitorIds).filter((id: string) => {
        return matchedMonitorIds.has(id);
      }),
    );

    for (const id of monitorIdsAdded) {
      nextAutoAddedMonitorIds.add(id);
    }

    const nextAttachedMonitorIds: Set<string> = new Set<string>(
      Array.from(attachedMonitorIds).filter((id: string) => {
        return !monitorIdsRemoved.includes(id);
      }),
    );

    for (const id of monitorIdsAdded) {
      nextAttachedMonitorIds.add(id);
    }

    /*
     * Nothing to write. Checked against both sets rather than against
     * added/removed alone, because a repair can leave the monitor list
     * untouched while still needing to fix the auto-added bookkeeping.
     */
    if (
      isSameSet(nextAttachedMonitorIds, attachedMonitorIds) &&
      isSameSet(nextAutoAddedMonitorIds, autoAddedMonitorIds)
    ) {
      return emptyResult();
    }

    /*
     * Cast through unknown: PartialEntity is a deep mapped type, and letting
     * the compiler infer it for two arrays of Monitor (whose own relations
     * fan out across most of the schema) trips TS2589 "type instantiation is
     * excessively deep". The shape is exactly what the column types say.
     *
     * Written as root on purpose: rules are server-side configuration, and
     * the manual-add guard in ServiceLevelObjectiveService lets root writes
     * through precisely so this one is never refused.
     */
    const updateData: PartialEntity<ServiceLevelObjective> = {
      monitors: toMonitors(nextAttachedMonitorIds),
      autoAddedMonitors: toMonitors(nextAutoAddedMonitorIds),
    } as unknown as PartialEntity<ServiceLevelObjective>;

    await ServiceLevelObjectiveService.updateOneById({
      id: slo.id,
      data: updateData,
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      `SLO monitor rules synced SLO ${slo.id.toString()}: +${monitorIdsAdded.length} / -${monitorIdsRemoved.length} monitors`,
      { projectId: slo.projectId?.toString() } as LogAttributes,
    );

    /*
     * Only monitors that were really on the list count as detached. A repair
     * that drops a stale bookkeeping entry for a monitor no longer attached
     * changed nothing a reader of the feed could see.
     */
    await this.postMembershipFeedItems({
      slo: slo,
      monitorIdsAttached: monitorIdsAdded,
      monitorIdsDetached: monitorIdsRemoved.filter((id: string) => {
        return attachedMonitorIds.has(id);
      }),
      knownMonitors: data.knownMonitors || [],
    });

    return {
      monitorIdsAdded: monitorIdsAdded,
      monitorIdsRemoved: monitorIdsRemoved,
    };
  }

  /*
   * Tells the SLO's feed which monitors the rules just attached or detached.
   * Posted without a user: nobody clicked anything, a rule reacted to a
   * change. Manual attaches from the Monitors page are posted by the SLO
   * service instead, and this engine writes as root with no user, which is
   * how the two never double-post.
   *
   * Never throws. The membership is already saved; a feed item that could
   * not be written must not turn a successful sync into a failed one.
   */
  private async postMembershipFeedItems(data: {
    slo: ServiceLevelObjective;
    monitorIdsAttached: Array<string>;
    monitorIdsDetached: Array<string>;
    knownMonitors: Array<Monitor>;
  }): Promise<void> {
    const { slo } = data;

    if (
      !slo.id ||
      !slo.projectId ||
      (data.monitorIdsAttached.length === 0 &&
        data.monitorIdsDetached.length === 0)
    ) {
      return;
    }

    try {
      const sloLink: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: slo.projectId,
          sloId: slo.id,
          sloName: slo.name || undefined,
        });

      const monitorNameById: Map<string, string> =
        await this.getMonitorNamesById({
          monitorIds: [
            ...data.monitorIdsAttached.slice(
              0,
              MAX_MONITORS_LISTED_IN_FEED_DETAILS,
            ),
            ...data.monitorIdsDetached.slice(
              0,
              MAX_MONITORS_LISTED_IN_FEED_DETAILS,
            ),
          ],
          knownMonitors: data.knownMonitors,
        });

      if (data.monitorIdsAttached.length > 0) {
        const count: number = data.monitorIdsAttached.length;

        await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
          {
            serviceLevelObjectiveId: slo.id,
            projectId: slo.projectId,
            serviceLevelObjectiveFeedEventType:
              ServiceLevelObjectiveFeedEventType.MonitorsAttached,
            displayColor: Green500,
            feedInfoInMarkdown:
              count === 1
                ? `🔗 Monitor rules attached ${this.describeMonitorNames({
                    monitorIds: data.monitorIdsAttached,
                    monitorNameById: monitorNameById,
                  })} to ${sloLink}. It now counts towards this SLO.`
                : `🔗 Monitor rules attached ${count} monitors to ${sloLink}: ${this.describeMonitorNames(
                    {
                      monitorIds: data.monitorIdsAttached,
                      monitorNameById: monitorNameById,
                    },
                  )}.`,
            moreInformationInMarkdown: this.listMonitorsInDetails({
              title: "Monitors attached",
              monitorIds: data.monitorIdsAttached,
              monitorNameById: monitorNameById,
            }),
          },
        );
      }

      if (data.monitorIdsDetached.length > 0) {
        const count: number = data.monitorIdsDetached.length;

        await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
          {
            serviceLevelObjectiveId: slo.id,
            projectId: slo.projectId,
            serviceLevelObjectiveFeedEventType:
              ServiceLevelObjectiveFeedEventType.MonitorsDetached,
            displayColor: Gray500,
            feedInfoInMarkdown:
              count === 1
                ? `✂️ Monitor rules detached ${this.describeMonitorNames({
                    monitorIds: data.monitorIdsDetached,
                    monitorNameById: monitorNameById,
                  })} from ${sloLink}. It no longer matches any enabled monitor rule of this SLO.`
                : `✂️ Monitor rules detached ${count} monitors from ${sloLink}: ${this.describeMonitorNames(
                    {
                      monitorIds: data.monitorIdsDetached,
                      monitorNameById: monitorNameById,
                    },
                  )}.`,
            moreInformationInMarkdown: this.listMonitorsInDetails({
              title: "Monitors detached",
              monitorIds: data.monitorIdsDetached,
              monitorNameById: monitorNameById,
            }),
          },
        );
      }
    } catch (error) {
      logger.error(
        `Error posting SLO monitor rule membership feed items for SLO ${slo.id.toString()}: ${error}`,
        { projectId: slo.projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * Names for the monitors a feed item mentions. Monitors the caller already
   * holds are used as they are; the rest (a detached monitor is by definition
   * no longer among the matches) are read in one bounded query.
   */
  private async getMonitorNamesById(data: {
    monitorIds: Array<string>;
    knownMonitors: Array<Monitor>;
  }): Promise<Map<string, string>> {
    const monitorNameById: Map<string, string> = new Map<string, string>();

    for (const monitor of data.knownMonitors) {
      const id: string = monitor.id?.toString() || "";

      if (id && monitor.name) {
        monitorNameById.set(id, monitor.name);
      }
    }

    const missingIds: Array<string> = Array.from(
      new Set<string>(data.monitorIds),
    ).filter((id: string): boolean => {
      return !monitorNameById.has(id);
    });

    if (missingIds.length === 0) {
      return monitorNameById;
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(
          missingIds.map((id: string) => {
            return new ObjectID(id);
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: missingIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const monitor of monitors) {
      const id: string = monitor.id?.toString() || "";

      if (id && monitor.name) {
        monitorNameById.set(id, monitor.name);
      }
    }

    return monitorNameById;
  }

  /*
   * The display names, escaped, sorted so the same set always reads the same
   * way. A name that could not be resolved still counts - it is shown as
   * "a monitor" rather than dropped from the sentence.
   */
  private getSortedMonitorNames(data: {
    monitorIds: Array<string>;
    monitorNameById: Map<string, string>;
  }): Array<string> {
    return data.monitorIds
      .slice(0, MAX_MONITORS_LISTED_IN_FEED_DETAILS)
      .map((id: string): string => {
        return data.monitorNameById.get(id) || "";
      })
      .sort((a: string, b: string): number => {
        if (!a || !b) {
          return a ? -1 : b ? 1 : 0;
        }

        return a.localeCompare(b, undefined, { sensitivity: "base" });
      })
      .map((name: string): string => {
        return name ? `**${escapeMarkdownInline(name)}**` : "a monitor";
      });
  }

  // "**A**", "**A** and **B**", "**A**, **B**, ... and 7 more".
  private describeMonitorNames(data: {
    monitorIds: Array<string>;
    monitorNameById: Map<string, string>;
  }): string {
    const names: Array<string> = this.getSortedMonitorNames(data);
    const named: Array<string> = names.slice(
      0,
      MAX_MONITORS_NAMED_IN_FEED_HEADLINE,
    );
    const remaining: number = data.monitorIds.length - named.length;

    if (remaining > 0) {
      return `${named.join(", ")} and ${remaining} more`;
    }

    if (named.length <= 1) {
      return named[0] || "a monitor";
    }

    return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  }

  /*
   * The full (bounded) list, only when the sentence could not name everyone -
   * a single monitor, or a handful, is already fully described above.
   */
  private listMonitorsInDetails(data: {
    title: string;
    monitorIds: Array<string>;
    monitorNameById: Map<string, string>;
  }): string | undefined {
    if (data.monitorIds.length <= MAX_MONITORS_NAMED_IN_FEED_HEADLINE) {
      return undefined;
    }

    const names: Array<string> = this.getSortedMonitorNames(data);
    const notListed: number = data.monitorIds.length - names.length;

    const lines: Array<string> = [
      `**${data.title} (${data.monitorIds.length})**`,
      "",
      ...names.map((name: string): string => {
        return `- ${name}`;
      }),
    ];

    if (notListed > 0) {
      lines.push(`- …and ${notListed} more not listed here.`);
    }

    return lines.join("\n");
  }
}

export default new ServiceLevelObjectiveMonitorRuleEngineServiceClass();
