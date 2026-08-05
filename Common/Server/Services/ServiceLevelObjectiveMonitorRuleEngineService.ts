import Monitor from "../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import MonitorService from "./MonitorService";
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

/**
 * Keeps an SLO's monitor list in step with its label rule.
 *
 * An SLO can name a set of monitor labels ("Auto-Add Monitors With Labels").
 * Every monitor in the project carrying at least one of them belongs to the
 * SLO, and stops belonging to it the moment it carries none. Two entry points
 * drive that, because the membership can be invalidated from either side:
 *
 *   - the SLO side (its rule changed) -> syncMonitorsForSlo
 *   - the monitor side (its labels changed) -> syncSlosForMonitor
 *
 * Both write through ServiceLevelObjective.autoAddedMonitors, which records
 * which attachments the rule owns. Only those are ever detached, so a monitor
 * a human attached by hand survives every rule evaluation — including the one
 * that runs when the rule is deleted.
 */
export class ServiceLevelObjectiveMonitorRuleEngineServiceClass {
  /**
   * Re-evaluates one SLO's label rule against every monitor in its project.
   * Use when the SLO's rule changed (created, edited, or cleared) — it is the
   * authoritative, self-healing path and repairs any drift it finds.
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
          monitorLabels: {
            _id: true,
          },
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

    const ruleLabelIds: Set<string> = toIdSet(slo.monitorLabels);

    /*
     * No rule (or the rule was just cleared) means nothing matches, which in
     * turn detaches everything the rule had attached. Deleting the rule
     * therefore undoes the rule rather than leaving its monitors stranded on
     * an SLO nobody remembers configuring.
     */
    const matchedMonitorIds: Set<string> =
      ruleLabelIds.size === 0
        ? new Set<string>()
        : await this.findMonitorIdsWithAnyLabel({
            projectId: slo.projectId,
            labelIds: ruleLabelIds,
          });

    return await this.writeMembership({
      slo: slo,
      attachedMonitorIds: toIdSet(slo.monitors),
      autoAddedMonitorIds: toIdSet(slo.autoAddedMonitors),
      matchedMonitorIds: matchedMonitorIds,
    });
  }

  /**
   * Re-evaluates every label rule in the project against a single monitor.
   * Use when the monitor's labels changed: it touches only this monitor's
   * membership, so it costs one query per project regardless of how many
   * monitors the rules match.
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

    const monitorLabelIds: Set<string> = toIdSet(monitor.labels);
    const monitorId: string = monitor.id.toString();

    const slos: Array<ServiceLevelObjective> =
      await ServiceLevelObjectiveService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          projectId: true,
          monitorLabels: {
            _id: true,
          },
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
      const ruleLabelIds: Set<string> = toIdSet(slo.monitorLabels);

      // SLOs without a label rule are curated by hand. Never touch them.
      if (ruleLabelIds.size === 0) {
        continue;
      }

      const attachedMonitorIds: Set<string> = toIdSet(slo.monitors);
      const autoAddedMonitorIds: Set<string> = toIdSet(slo.autoAddedMonitors);

      const doesMatch: boolean = this.doesLabelSetMatchRule({
        labelIds: monitorLabelIds,
        ruleLabelIds: ruleLabelIds,
      });

      /*
       * Only this monitor's membership is in question, so the "matched" set
       * handed to writeMembership is the SLO's current auto-added set with
       * this monitor toggled in or out. Every other auto-added monitor is
       * reported as still matching and is left exactly where it is.
       */
      const matchedMonitorIds: Set<string> = new Set<string>(
        autoAddedMonitorIds,
      );

      if (doesMatch) {
        matchedMonitorIds.add(monitorId);
      } else {
        matchedMonitorIds.delete(monitorId);
      }

      try {
        const result: SloMonitorSyncResult = await this.writeMembership({
          slo: slo,
          attachedMonitorIds: attachedMonitorIds,
          autoAddedMonitorIds: autoAddedMonitorIds,
          matchedMonitorIds: matchedMonitorIds,
        });

        if (
          result.monitorIdsAdded.length > 0 ||
          result.monitorIdsRemoved.length > 0
        ) {
          results.push(result);
        }
      } catch (error) {
        /*
         * One SLO failing must not stop the others: the monitor's labels have
         * already changed, and half a sync is better than none.
         */
        logger.error(
          `Error syncing SLO ${slo.id?.toString()} for monitor ${monitorId}: ${error}`,
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
   * Every monitor in the project carrying at least one of `labelIds`.
   */
  @CaptureSpan()
  private async findMonitorIdsWithAnyLabel(data: {
    projectId: ObjectID;
    labelIds: Set<string>;
  }): Promise<Set<string>> {
    const labelIds: Array<ObjectID> = Array.from(data.labelIds).map(
      (id: string) => {
        return new ObjectID(id);
      },
    );

    if (labelIds.length === 0) {
      return new Set<string>();
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        labels: labelIds,
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

    return toIdSet(monitors);
  }

  public doesLabelSetMatchRule(data: {
    labelIds: Set<string>;
    ruleLabelIds: Set<string>;
  }): boolean {
    if (data.ruleLabelIds.size === 0 || data.labelIds.size === 0) {
      return false;
    }

    for (const labelId of data.labelIds) {
      if (data.ruleLabelIds.has(labelId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Applies a computed match set to one SLO and persists the difference.
   *
   * `matchedMonitorIds` is the full set of monitors the rule claims. Anything
   * in it that is not attached gets attached and recorded as rule-owned;
   * anything recorded as rule-owned that the rule no longer claims gets
   * detached. Attachments that are not rule-owned are invisible to both
   * halves, which is what keeps manual monitors safe.
   */
  private async writeMembership(data: {
    slo: ServiceLevelObjective;
    attachedMonitorIds: Set<string>;
    autoAddedMonitorIds: Set<string>;
    matchedMonitorIds: Set<string>;
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
     * A monitor the rule still matches but that a human attached by hand stays
     * manual: it is never promoted into autoAddedMonitors, so dropping the
     * label later detaches nothing.
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
      `SLO monitor label rule synced SLO ${slo.id.toString()}: +${monitorIdsAdded.length} / -${monitorIdsRemoved.length} monitors`,
      { projectId: slo.projectId?.toString() } as LogAttributes,
    );

    return {
      monitorIdsAdded: monitorIdsAdded,
      monitorIdsRemoved: monitorIdsRemoved,
    };
  }
}

export default new ServiceLevelObjectiveMonitorRuleEngineServiceClass();
