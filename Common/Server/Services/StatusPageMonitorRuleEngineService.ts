import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "../../Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import MonitorService from "./MonitorService";
import StatusPageMonitorRuleService from "./StatusPageMonitorRuleService";
import StatusPageResourceService from "./StatusPageResourceService";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";

/**
 * What a sync did, so callers (and tests) can assert on the outcome without
 * re-reading the status page.
 */
export interface StatusPageMonitorRuleSyncResult {
  monitorIdsAdded: Array<string>;
  statusPageResourceIdsRemoved: Array<string>;
  statusPageResourceIdsUpdated: Array<string>;
  /*
   * The monitors whose resources this pass removed. Same event as
   * statusPageResourceIdsRemoved, keyed by monitor instead of by resource,
   * because the caller's next question is "does another rule still want this
   * monitor" and that is asked by monitor id.
   */
  monitorIdsReleased: Array<string>;
}

function emptyResult(): StatusPageMonitorRuleSyncResult {
  return {
    monitorIdsAdded: [],
    statusPageResourceIdsRemoved: [],
    statusPageResourceIdsUpdated: [],
    monitorIdsReleased: [],
  };
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

/**
 * Everything the engine needs to know about one rule to decide membership.
 * `findBy` hands back partial models, so this is the shape actually selected
 * rather than the full entity.
 */
const RULE_SELECT: {
  [key: string]: boolean | { [key: string]: boolean };
} = {
  _id: true,
  projectId: true,
  statusPageId: true,
  statusPageGroupId: true,
  isEnabled: true,
  monitorLabels: { _id: true },
  monitorNamePattern: true,
  monitorDescriptionPattern: true,
  showCurrentStatus: true,
  showUptimePercent: true,
  uptimePercentPrecision: true,
  showStatusHistoryChart: true,
};

/**
 * Keeps a status page's resources in step with its monitor rules.
 *
 * A status page can say "show every monitor labelled Production in the Core
 * Platform group" instead of adding monitors one at a time and typing a
 * display name for each. That promise has two halves, and both have to hold:
 *
 *   - a monitor that starts matching gets added to the group the rule names,
 *     and a monitor that stops matching gets removed again;
 *
 *   - a resource a human added by hand is never touched — not adopted into a
 *     rule when it happens to match, and never removed when it stops matching
 *     or when the rule is deleted.
 *
 * StatusPageResource.statusPageMonitorRuleId is what makes the second half
 * possible: it records which rule owns a resource, and only owned resources
 * are ever removed.
 *
 * Membership can be invalidated from either side, so there are two entry
 * points:
 *
 *   - the rule side (the rule was created or edited) -> syncResourcesForRule
 *   - the monitor side (its labels or name changed)  -> syncRulesForMonitor
 */
export class StatusPageMonitorRuleEngineServiceClass {
  /**
   * Re-evaluates one rule against every monitor in its project. Use when the
   * rule itself changed — it is the authoritative, self-healing path and
   * repairs any drift it finds.
   */
  @CaptureSpan()
  public async syncResourcesForRule(data: {
    statusPageMonitorRuleId: ObjectID;
  }): Promise<StatusPageMonitorRuleSyncResult> {
    const rule: StatusPageMonitorRule | null =
      await StatusPageMonitorRuleService.findOneById({
        id: data.statusPageMonitorRuleId,
        select: RULE_SELECT as any,
        props: {
          isRoot: true,
        },
      });

    if (!rule || !rule.id || !rule.projectId || !rule.statusPageId) {
      return emptyResult();
    }

    /*
     * A disabled rule matches nothing, which detaches everything it had added.
     * Toggling a rule off therefore undoes it rather than leaving its monitors
     * stranded on a page nobody remembers configuring.
     */
    const matchedMonitors: Array<Monitor> = rule.isEnabled
      ? await this.findMatchingMonitors({ rule: rule })
      : [];

    const result: StatusPageMonitorRuleSyncResult = await this.writeMembership({
      rule: rule,
      matchedMonitors: matchedMonitors,
      /*
       * This entry point runs because the rule itself changed, so it is the
       * one that re-homes and re-styles the resources the rule already owns.
       * The monitor-side path deliberately does not: nothing about the rule
       * moved there, and reconciling on an unrelated monitor edit would
       * silently revert per-resource tweaks at a surprising moment.
       */
      reconcileOwnedResources: true,
    });

    /*
     * A monitor this rule just released may still be claimed by another rule
     * on the same page — narrowing this rule does not mean the monitor should
     * vanish from the page. Re-running the monitor-side sync for each released
     * monitor lets whichever other rule still wants it pick it up.
     *
     * Bounded: syncRulesForMonitor only calls writeMembership, never back into
     * this method, so there is no cycle.
     */
    for (const monitorId of result.monitorIdsReleased) {
      try {
        await this.syncRulesForMonitor({
          monitorId: new ObjectID(monitorId),
          projectId: rule.projectId,
        });
      } catch (error) {
        logger.error(
          `Error re-homing monitor ${monitorId} after status page monitor rule ${rule.id.toString()} released it: ${error}`,
          { projectId: rule.projectId.toString() } as LogAttributes,
        );
      }
    }

    return result;
  }

  /**
   * Re-evaluates every rule in the project against a single monitor. Use when
   * the monitor changed: it costs one query per project regardless of how many
   * monitors the rules match.
   */
  @CaptureSpan()
  public async syncRulesForMonitor(data: {
    monitorId: ObjectID;
    projectId?: ObjectID | undefined;
  }): Promise<Array<StatusPageMonitorRuleSyncResult>> {
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

    const rules: Array<StatusPageMonitorRule> =
      await StatusPageMonitorRuleService.findBy({
        query: {
          projectId: projectId,
          isEnabled: true,
        },
        select: RULE_SELECT as any,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    logIfRuleReadWasTruncated({
      ruleKind: "StatusPageMonitorRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    const results: Array<StatusPageMonitorRuleSyncResult> = [];

    /*
     * Two passes, removals before additions, and the order matters.
     *
     * Two rules on the same page can match the same monitor; only the first
     * one to see it creates the resource, and the page shows it once. If the
     * monitor then stops matching the OWNING rule but still matches the other,
     * a single interleaved pass gives an order-dependent answer: evaluate the
     * still-matching rule first and it skips the add (the monitor is still on
     * the page), then the owning rule deletes — and the monitor silently
     * disappears from a public page even though a rule still claims it.
     *
     * Draining the removals first means the addition pass sees the page as it
     * will actually be, so whichever rule still claims the monitor picks it up.
     */
    for (const skipAdds of [true, false]) {
      for (const rule of rules) {
        if (!rule.id || !rule.statusPageId) {
          continue;
        }

        const doesMatch: boolean = this.doesMonitorMatchRule({
          monitor: monitor,
          rule: rule,
        });

        try {
          const result: StatusPageMonitorRuleSyncResult =
            await this.writeMembership({
              rule: rule,
              matchedMonitors: doesMatch ? [monitor] : [],
              /*
               * Only this monitor's membership is in question. Every other
               * resource the rule owns is left exactly where it is.
               */
              restrictToMonitorId: monitor.id,
              skipAdds: skipAdds,
              skipRemoves: !skipAdds,
            });

          if (
            result.monitorIdsAdded.length > 0 ||
            result.statusPageResourceIdsRemoved.length > 0
          ) {
            results.push(result);
          }
        } catch (error) {
          /*
           * One rule failing must not stop the others: the monitor has already
           * changed, and half a sync is better than none.
           */
          logger.error(
            `Error syncing status page monitor rule ${rule.id.toString()} for monitor ${monitor.id.toString()}: ${error}`,
            {
              projectId: projectId.toString(),
              monitorId: monitor.id.toString(),
            } as LogAttributes,
          );
        }
      }
    }

    return results;
  }

  /**
   * Removes every resource a rule added, without touching anything else on the
   * page. Called before the rule row goes away so deleting a rule undoes it.
   */
  @CaptureSpan()
  public async removeResourcesAddedByRule(data: {
    statusPageMonitorRuleId: ObjectID;
  }): Promise<Array<string>> {
    const ownedResources: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: {
          statusPageMonitorRuleId: data.statusPageMonitorRuleId,
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

    const removedIds: Array<string> = [];

    for (const resource of ownedResources) {
      if (!resource.id) {
        continue;
      }

      await StatusPageResourceService.deleteOneById({
        id: resource.id,
        props: {
          isRoot: true,
        },
      });

      removedIds.push(resource.id.toString());
    }

    return removedIds;
  }

  /**
   * Does this monitor satisfy every criterion the rule specifies?
   *
   * Criteria are ANDed and empty ones are skipped, which mirrors how every
   * other rule in the product reads. A rule with no criteria at all matches
   * nothing — silently putting the entire project on a public status page is
   * not a reasonable reading of an empty form. Users who genuinely want that
   * write `.*` as the name pattern.
   *
   * Pattern matching goes through RulePatternMatchUtil, the same matcher the
   * network device rules use, so a pattern means the same thing everywhere in
   * the product: a case-insensitive regex, or a `*` wildcard glob. Rolling a
   * private regex test here would have reintroduced #2940 — a user typing
   * `*api*` (a glob, not a regex) gets a rule that silently matches nothing.
   */
  public doesMonitorMatchRule(data: {
    monitor: Monitor;
    rule: StatusPageMonitorRule;
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
   * Every monitor in the rule's project that the rule matches.
   *
   * The label filter is pushed into the query when there is one, because it is
   * the criterion that usually narrows the project the most. The regexes are
   * then applied in memory — Postgres regex semantics and JavaScript's are not
   * the same dialect, and the pattern a user typed has to mean one thing.
   */
  @CaptureSpan()
  private async findMatchingMonitors(data: {
    rule: StatusPageMonitorRule;
  }): Promise<Array<Monitor>> {
    const { rule } = data;

    if (!rule.projectId) {
      return [];
    }

    const hasLabelCriteria: boolean = Boolean(
      rule.monitorLabels && rule.monitorLabels.length > 0,
    );
    const hasNameCriteria: boolean = Boolean(rule.monitorNamePattern);
    const hasDescriptionCriteria: boolean = Boolean(
      rule.monitorDescriptionPattern,
    );

    if (!hasLabelCriteria && !hasNameCriteria && !hasDescriptionCriteria) {
      return [];
    }

    const query: {
      projectId: ObjectID;
      labels?: Array<ObjectID>;
    } = {
      projectId: rule.projectId,
    };

    if (hasLabelCriteria) {
      query.labels = (rule.monitorLabels || [])
        .filter((label: Label) => {
          return Boolean(label.id);
        })
        .map((label: Label) => {
          return label.id!;
        });
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: query as any,
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

    return monitors.filter((monitor: Monitor) => {
      return this.doesMonitorMatchRule({ monitor: monitor, rule: rule });
    });
  }

  /**
   * Applies a computed match set to one rule and persists the difference.
   *
   * `matchedMonitors` is what the rule claims. A claimed monitor that has no
   * resource on the page yet gets one; a resource the rule owns whose monitor
   * it no longer claims is deleted. Resources that are not rule-owned are
   * invisible to both halves, which is what keeps manual resources safe — and
   * a monitor a human already added is not added a second time, so the page
   * never shows a duplicate.
   *
   * `restrictToMonitorId` narrows both halves to a single monitor, for the
   * monitor-side entry point where every other monitor's membership is
   * unchanged and re-deriving it would be wasted work.
   *
   * `reconcileOwnedResources` additionally drags resources the rule already
   * owns back into line with the rule — see reconcileResource. Only the
   * rule-side entry point asks for it.
   */
  private async writeMembership(data: {
    rule: StatusPageMonitorRule;
    matchedMonitors: Array<Monitor>;
    restrictToMonitorId?: ObjectID | undefined;
    reconcileOwnedResources?: boolean | undefined;
    skipAdds?: boolean | undefined;
    skipRemoves?: boolean | undefined;
  }): Promise<StatusPageMonitorRuleSyncResult> {
    const { rule, matchedMonitors, restrictToMonitorId } = data;

    if (!rule.id || !rule.statusPageId || !rule.projectId) {
      return emptyResult();
    }

    const existingResources: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: {
          statusPageId: rule.statusPageId,
        },
        select: {
          _id: true,
          monitorId: true,
          statusPageMonitorRuleId: true,
          statusPageGroupId: true,
          showCurrentStatus: true,
          showUptimePercent: true,
          uptimePercentPrecision: true,
          showStatusHistoryChart: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const monitorIdsOnPage: Set<string> = new Set<string>();
    const ownedResourcesByMonitorId: Map<string, StatusPageResource> = new Map<
      string,
      StatusPageResource
    >();

    for (const resource of existingResources) {
      const monitorId: string = resource.monitorId?.toString() || "";

      if (!monitorId) {
        continue;
      }

      monitorIdsOnPage.add(monitorId);

      if (resource.statusPageMonitorRuleId?.toString() === rule.id.toString()) {
        ownedResourcesByMonitorId.set(monitorId, resource);
      }
    }

    const matchedMonitorIds: Set<string> = toIdSet(matchedMonitors);

    const monitorIdsAdded: Array<string> = [];
    const statusPageResourceIdsRemoved: Array<string> = [];
    const statusPageResourceIdsUpdated: Array<string> = [];
    const monitorIdsReleased: Array<string> = [];

    // Remove: resources this rule owns whose monitor it no longer claims.
    if (!data.skipRemoves) {
      for (const [monitorId, resource] of ownedResourcesByMonitorId) {
        if (matchedMonitorIds.has(monitorId)) {
          continue;
        }

        if (
          restrictToMonitorId &&
          restrictToMonitorId.toString() !== monitorId
        ) {
          continue;
        }

        if (!resource.id) {
          continue;
        }

        await StatusPageResourceService.deleteOneById({
          id: resource.id,
          props: {
            isRoot: true,
          },
        });

        statusPageResourceIdsRemoved.push(resource.id.toString());
        monitorIdsReleased.push(monitorId);
        monitorIdsOnPage.delete(monitorId);
      }
    }

    /*
     * Add: matched monitors that are not on the page at all yet.
     *
     * "Not on the page" and not merely "not owned by this rule" — a monitor a
     * human already added, or that another rule added, must not get a second
     * resource, because the public page would then list it twice.
     */
    if (!data.skipAdds) {
      for (const monitor of matchedMonitors) {
        const monitorId: string = monitor.id?.toString() || "";

        if (!monitorId || monitorIdsOnPage.has(monitorId)) {
          continue;
        }

        await this.createResource({ rule: rule, monitor: monitor });
        monitorIdsAdded.push(monitorId);
      }
    }

    /*
     * Reconcile: resources the rule still owns and still claims are dragged
     * back into line with the rule. Without this, editing "Add Monitors To
     * Group" (or any display option) silently does nothing to the monitors the
     * rule already added - it would only apply to ones it adds in future,
     * which is not what changing a rule looks like it should do.
     */
    if (data.reconcileOwnedResources) {
      for (const [monitorId, resource] of ownedResourcesByMonitorId) {
        if (!matchedMonitorIds.has(monitorId) || !resource.id) {
          continue;
        }

        if (await this.reconcileResource({ rule: rule, resource: resource })) {
          statusPageResourceIdsUpdated.push(resource.id.toString());
        }
      }
    }

    if (
      monitorIdsAdded.length > 0 ||
      statusPageResourceIdsRemoved.length > 0 ||
      statusPageResourceIdsUpdated.length > 0
    ) {
      logger.debug(
        `Status page monitor rule ${rule.id.toString()} synced status page ${rule.statusPageId.toString()}: +${monitorIdsAdded.length} / -${statusPageResourceIdsRemoved.length} / ~${statusPageResourceIdsUpdated.length} resources`,
        { projectId: rule.projectId.toString() } as LogAttributes,
      );
    }

    return {
      monitorIdsAdded: monitorIdsAdded,
      statusPageResourceIdsRemoved: statusPageResourceIdsRemoved,
      statusPageResourceIdsUpdated: statusPageResourceIdsUpdated,
      monitorIdsReleased: monitorIdsReleased,
    };
  }

  /**
   * Brings one rule-owned resource back into line with its rule, and reports
   * whether anything actually changed.
   *
   * Only the fields the rule owns are considered — the group it places
   * monitors in and the display options it sets. displayName is deliberately
   * not among them: it is seeded from the monitor at creation time and then
   * belongs to the status page, so renaming a monitor does not rewrite a
   * display name someone may have polished for customers.
   *
   * Writes nothing when the resource already agrees, so re-running a rule that
   * did not change costs a read and no writes.
   */
  private async reconcileResource(data: {
    rule: StatusPageMonitorRule;
    resource: StatusPageResource;
  }): Promise<boolean> {
    const { rule, resource } = data;

    if (!resource.id) {
      return false;
    }

    const desiredGroupId: string = rule.statusPageGroupId?.toString() || "";
    const currentGroupId: string = resource.statusPageGroupId?.toString() || "";

    const desired: {
      statusPageGroupId: ObjectID | null;
      showCurrentStatus: boolean;
      showUptimePercent: boolean;
      showStatusHistoryChart: boolean;
      uptimePercentPrecision: UptimePrecision | null;
    } = {
      statusPageGroupId: rule.statusPageGroupId || null,
      showCurrentStatus: rule.showCurrentStatus ?? true,
      showUptimePercent: rule.showUptimePercent ?? true,
      showStatusHistoryChart: rule.showStatusHistoryChart ?? true,
      uptimePercentPrecision: rule.uptimePercentPrecision || null,
    };

    const isSame: boolean =
      desiredGroupId === currentGroupId &&
      desired.showCurrentStatus === (resource.showCurrentStatus ?? true) &&
      desired.showUptimePercent === (resource.showUptimePercent ?? true) &&
      desired.showStatusHistoryChart ===
        (resource.showStatusHistoryChart ?? true) &&
      desired.uptimePercentPrecision ===
        (resource.uptimePercentPrecision || null);

    if (isSame) {
      return false;
    }

    await StatusPageResourceService.updateOneById({
      id: resource.id,
      data: desired as never,
      props: {
        isRoot: true,
      },
    });

    return true;
  }

  private async createResource(data: {
    rule: StatusPageMonitorRule;
    monitor: Monitor;
  }): Promise<void> {
    const { rule, monitor } = data;

    const resource: StatusPageResource = new StatusPageResource();

    resource.projectId = rule.projectId!;
    resource.statusPageId = rule.statusPageId!;
    resource.monitorId = monitor.id!;
    resource.statusPageMonitorRuleId = rule.id!;

    if (rule.statusPageGroupId) {
      resource.statusPageGroupId = rule.statusPageGroupId;
    }

    /*
     * displayName is required on the resource and the whole point of the rule
     * is not having to type one, so it mirrors the monitor. Renaming the
     * monitor later does not rewrite it — the display name belongs to the
     * status page from the moment the resource exists.
     */
    resource.displayName = monitor.name || "";

    resource.showCurrentStatus = rule.showCurrentStatus ?? true;
    resource.showUptimePercent = rule.showUptimePercent ?? true;
    resource.showStatusHistoryChart = rule.showStatusHistoryChart ?? true;

    if (rule.uptimePercentPrecision) {
      resource.uptimePercentPrecision = rule.uptimePercentPrecision;
    }

    await StatusPageResourceService.create({
      data: resource,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new StatusPageMonitorRuleEngineServiceClass();
