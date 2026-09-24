import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import Model from "../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveOwnerTeam from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import User from "../../Models/DatabaseModels/User";
import URL from "../../Types/API/URL";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import { resolveReferenceId } from "../Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertSeverityService from "./AlertSeverityService";
import DatabaseService from "./DatabaseService";
import MonitorStatusService from "./MonitorStatusService";
import ProjectService from "./ProjectService";
import ServiceLevelObjectiveBurnRateRuleService from "./ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveLabelRuleEngineService from "./ServiceLevelObjectiveLabelRuleEngineService";
import ServiceLevelObjectiveOwnerRuleEngineService from "./ServiceLevelObjectiveOwnerRuleEngineService";
import ServiceLevelObjectiveMonitorRuleEngineService from "./ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveMonitorRuleService from "./ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveOwnerTeamService from "./ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "./ServiceLevelObjectiveOwnerUserService";
import TeamMemberService from "./TeamMemberService";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import Monitor from "../../Models/DatabaseModels/Monitor";
import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import {
  Blue500,
  Gray500,
  Green500,
  Orange500,
  Yellow500,
} from "../../Types/BrandColors";
import Color from "../../Types/Color";
import Dictionary from "../../Types/Dictionary";
import {
  SLO_FEED_IS_ARCHIVED_COLUMN,
  SLO_FEED_IS_ENABLED_COLUMN,
  SLO_FEED_MONITORS_COLUMN,
  SLO_FEED_UPDATE_COLUMNS,
  SloFeedColumn,
  SloFeedColumnChange,
  SloFeedMarkdown,
  SloFeedMonitorReference,
  SloFeedRow,
  getSloArchivedFeedMarkdown,
  getSloCreatedFeedMarkdown,
  getSloEnabledFeedMarkdown,
  getSloFeedColumnChanges,
  getSloFeedEntityIds,
  getSloFeedSelect,
  getSloFeedWatchedColumns,
  getSloMonitorsChangedFeedMarkdown,
  getSloUpdatedFeedMarkdown,
  isSloFeedValueEqual,
  normalizeSloFeedBoolean,
} from "../../Utils/Slo/SloFeedMarkdown";
import Select from "../Types/Database/Select";
import SloFeedUtil from "../Utils/Slo/SloFeedUtil";
import SloLegacyMonitorLabelAdoption from "../Utils/Slo/SloLegacyMonitorLabelAdoption";

/*
 * What the SLO feed carries from onBeforeUpdate to onUpdateSuccess: the watched
 * columns the payload wrote, and each matched SLO as it was BEFORE the write.
 * The rows are gone from memory by the time the write lands, and "old -> new"
 * and "did it actually change" both need them.
 */
interface SloFeedUpdateSnapshot {
  columns: Array<SloFeedColumn>;
  rowsById: Dictionary<Model>;
}

// One feed item an update earned, built once the SLO's link is known.
interface SloFeedPendingItem {
  eventType: ServiceLevelObjectiveFeedEventType;
  displayColor: Color;
  getMarkdown: (sloMarkdownLink: string) => SloFeedMarkdown;
}

/*
 * The root cause stamped on every burn-rate alert and incident an archive
 * resolves. Distinct from the disable/delete default so a responder reading a
 * closed page can tell "somebody retired this SLO" from "somebody paused it" -
 * the first will not come back on its own, the second may.
 */
export const SLO_ARCHIVED_ROOT_CAUSE: string =
  "Auto-resolved because the Service Level Objective was archived.";

export const SLO_DISABLED_OR_DELETED_ROOT_CAUSE: string =
  "Auto-resolved because the Service Level Objective was disabled or deleted.";

/*
 * What onBeforeDelete reads for onDeleteSuccess: the SLOs the delete may
 * remove, and the burn rate rules of each - Postgres cascades those away with
 * the SLO, so they cannot be read afterwards.
 */
interface SloDeleteCarryForward {
  itemsToDelete: Array<Model>;
  burnRateRules: Array<ServiceLevelObjectiveBurnRateRule>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.projectId) {
      throw new BadDataException("projectId is required");
    }

    /*
     * Numeric columns arrive as strings from the dashboard: the "Target (%)"
     * form field is a `<input type="number">`, whose onChange hands Formik
     * `e.target.value` (a string), ModelForm copies it verbatim and
     * BaseModel.fromJSON does not coerce Number/Decimal columns. So every
     * validator here coerces first and writes the coerced number back onto the
     * payload, which also keeps Postgres from ever receiving a string.
     */
    createBy.data.targetPercentage = this.validateTargetPercentage(
      createBy.data.targetPercentage,
    );

    /*
     * Validate windowDays whenever it is supplied, regardless of windowType.
     * A CalendarMonth SLO ignores the column today, but it is persisted, and
     * switching that SLO to Rolling later (in an update that does not carry
     * windowDays) would otherwise start evaluating against an out-of-range
     * window. Validating on the way in also keeps create and update symmetric
     * — onBeforeUpdate validates unconditionally, so a value accepted here
     * but rejected there would make the column permanently un-updatable.
     */
    if (
      createBy.data.windowDays !== undefined &&
      createBy.data.windowDays !== null
    ) {
      createBy.data.windowDays = this.validateWindowDays(
        createBy.data.windowDays,
      );
    }

    if (
      createBy.data.atRiskThresholdPercentage !== undefined &&
      createBy.data.atRiskThresholdPercentage !== null
    ) {
      createBy.data.atRiskThresholdPercentage =
        this.validateAtRiskThresholdPercentage(
          createBy.data.atRiskThresholdPercentage,
        );
    }

    /*
     * Default the downtime statuses to all non-operational monitor statuses
     * of the project (StatusPageService pattern).
     */
    if (!createBy.data.downtimeMonitorStatuses) {
      const monitorStatuses: Array<MonitorStatus> =
        await MonitorStatusService.findBy({
          query: {
            projectId: createBy.data.projectId,
          },
          select: {
            _id: true,
            isOperationalState: true,
          },
          props: {
            isRoot: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      const nonOperationalStatuses: Array<MonitorStatus> =
        monitorStatuses.filter((monitorStatus: MonitorStatus) => {
          return !monitorStatus.isOperationalState;
        });

      createBy.data.downtimeMonitorStatuses = nonOperationalStatuses;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * The row's own creation time, so the "created" feed item - written last,
     * and without waiting - still sorts ahead of everything the create sets
     * off, like the creator being added as an owner.
     */
    const createdAt: Date =
      createdItem.createdAt || OneUptimeDate.getCurrentDate();

    /*
     * Stamp nextEvaluationAt = now so the evaluation worker picks this SLO up
     * on its next tick. Done here (isRoot update) instead of onBeforeCreate
     * because the column is worker-owned (`create: []` access control) — a
     * non-root dashboard create would fail the column permission check if the
     * hook injected it into the create payload.
     */
    try {
      await this.updateOneById({
        id: createdItem.id!,
        data: {
          nextEvaluationAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        `Error setting nextEvaluationAt for SLO ${createdItem.id?.toString()}: ${err}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
    }

    // Seed the two canonical multi-window burn rate rules. Non-fatal.
    let seededBurnRateRules: Array<ServiceLevelObjectiveBurnRateRule> = [];

    try {
      /*
       * Marked as seeding so the burn rate rule service does not post its own
       * "rule added" items for these two: they are part of creating the SLO
       * and are described by its "created" item (see SloFeedUtil for why this
       * signal and not "root with no user").
       */
      seededBurnRateRules = createdItem.id
        ? await SloFeedUtil.runWhileSeedingDefaultBurnRateRules({
            sloId: createdItem.id,
            seed: (): Promise<Array<ServiceLevelObjectiveBurnRateRule>> => {
              return this.seedDefaultBurnRateRules(createdItem);
            },
          })
        : await this.seedDefaultBurnRateRules(createdItem);
    } catch (err) {
      logger.error(
        `Error seeding default burn rate rules for SLO ${createdItem.id?.toString()}: ${err}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
    }

    /*
     * A create that still carries the deprecated "Auto-Add Monitors With
     * Labels" list gets it as a monitor rule first, so the sync below attaches
     * what the list matches - as the previous release did. See
     * applyDeprecatedMonitorLabelWrite for who still sends it and why.
     */
    await this.adoptDeprecatedMonitorLabelsWrittenOnCreate(createdItem);

    /*
     * Reconcile the new SLO's monitor list with its monitor rules. A brand-new
     * SLO normally has none yet (rules are added afterwards, on the Monitor
     * Rules page), so this is usually a read and no write - but it keeps an
     * SLO created with rows already pointing at it (an API import, a rolling
     * deploy's backfill) from reading "no monitors attached" until someone
     * happens to edit a rule or a monitor.
     */
    try {
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: createdItem.id!,
      });
    } catch (err) {
      logger.error(
        `Error applying the monitor rules for SLO ${createdItem.id?.toString()}: ${err}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
    }

    /*
     * Label rules first, so the labels they attach are persisted - and on
     * createdItem - before owner rules run: an owner rule can then key on a
     * rule-added label. Fire-and-forget, like every other resource's rules: a
     * rule must never slow down or fail the create.
     */
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await ServiceLevelObjectiveLabelRuleEngineService.applyRulesToServiceLevelObjective(
            createdItem,
          );
        })
        .then(async () => {
          await ServiceLevelObjectiveOwnerRuleEngineService.applyRulesToServiceLevelObjective(
            createdItem,
          );
        })
        .catch((err: Error) => {
          logger.error(
            `Error applying the label and owner rules for SLO ${createdItem.id?.toString()}: ${err}`,
            { projectId: createdItem.projectId?.toString() } as LogAttributes,
          );
        });
    }

    /*
     * Fire-and-forget, like ServiceService's created item: the SLO exists
     * whether or not its feed item does, and the create request should not
     * wait on user and link lookups just to describe itself.
     */
    this.writeSloCreatedFeed({
      onCreate: onCreate,
      createdItem: createdItem,
      seededBurnRateRules: seededBurnRateRules,
      postedAt: createdAt,
    }).catch((err: Error) => {
      logger.error(
        `Error writing the created feed item for SLO ${createdItem.id?.toString()}: ${err}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Same string-arrival path as onBeforeCreate — coerce, validate, and write
     * the number back onto the update payload.
     */
    const newTargetPercentage: unknown = updateBy.data
      .targetPercentage as unknown;

    if (newTargetPercentage !== undefined && newTargetPercentage !== null) {
      updateBy.data.targetPercentage =
        this.validateTargetPercentage(newTargetPercentage);
    }

    const newWindowDays: unknown = updateBy.data.windowDays as unknown;

    if (newWindowDays !== undefined && newWindowDays !== null) {
      updateBy.data.windowDays = this.validateWindowDays(newWindowDays);
    }

    const newAtRiskThresholdPercentage: unknown = updateBy.data
      .atRiskThresholdPercentage as unknown;

    if (
      newAtRiskThresholdPercentage !== undefined &&
      newAtRiskThresholdPercentage !== null
    ) {
      updateBy.data.atRiskThresholdPercentage =
        this.validateAtRiskThresholdPercentage(newAtRiskThresholdPercentage);
    }

    await this.assertMonitorEditRespectsMonitorRules(updateBy);

    /*
     * Last, so a payload the checks above rejected never costs the feed a
     * read. Null unless the payload writes a column the feed describes.
     */
    const feedSnapshot: SloFeedUpdateSnapshot | null =
      await this.readFeedSnapshotBeforeUpdate(updateBy);

    // Null unless the payload writes the deprecated monitor label list.
    const monitorLabelIdsBeforeUpdate: Dictionary<Array<string>> | null =
      await this.readDeprecatedMonitorLabelsBeforeUpdate(updateBy);

    return {
      updateBy,
      carryForward: {
        feedSnapshot: feedSnapshot,
        monitorLabelIdsBeforeUpdate: monitorLabelIdsBeforeUpdate,
      },
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Fire-and-forget, and only when onBeforeUpdate took a snapshot - so the
     * worker's per-tick state write does no feed work at all. The time is
     * taken here so the items sort where the edit happened, not where their
     * lookups finished.
     */
    if (onUpdate.carryForward?.feedSnapshot) {
      const updatedAt: Date = OneUptimeDate.getCurrentDate();

      this.writeSloUpdatedFeed({
        onUpdate: onUpdate,
        updatedItemIds: updatedItemIds,
        postedAt: updatedAt,
      }).catch((err: Error) => {
        logger.error(`Error writing SLO feed items after an update: ${err}`);
      });
    }

    /*
     * When an SLO is disabled or archived, resolve everything its burn-rate
     * rules have open — the evaluation worker skips disabled and archived
     * SLOs alike, so nothing else would ever resolve them (and their on-call
     * escalations would stay open forever).
     *
     * One pass even when a single write both disables and archives: the
     * second would only re-query every rule for records the first already
     * closed. The archive wording wins, because it is the more permanent of
     * the two and the one a responder reading the root cause needs to know.
     */
    const isDisablingSlo: boolean =
      (onUpdate.updateBy.data.isEnabled as boolean | undefined) === false;
    const isArchivingSlo: boolean =
      (onUpdate.updateBy.data.isArchived as boolean | undefined) === true;

    if (isDisablingSlo || isArchivingSlo) {
      for (const updatedItemId of updatedItemIds) {
        try {
          const slo: Model | null = await this.findOneById({
            id: updatedItemId,
            select: {
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!slo || !slo.projectId) {
            continue;
          }

          /*
           * rootCause is only set for an archive, so a plain disable keeps
           * calling with exactly the payload it always has.
           */
          const resolveData: {
            sloId: ObjectID;
            projectId: ObjectID;
            rootCause?: string | undefined;
          } = {
            sloId: updatedItemId,
            projectId: slo.projectId,
          };

          if (isArchivingSlo) {
            resolveData.rootCause = SLO_ARCHIVED_ROOT_CAUSE;
          }

          await this.resolveOpenBurnRateAlertsAndIncidentsForSlo(resolveData);
        } catch (err) {
          /*
           * Never fail the user's write: the disable or archive already
           * landed, and refusing it over a stale open record would be worse
           * than the record itself.
           */
          logger.error(
            `Error resolving open burn rate alerts and incidents for ${
              isArchivingSlo ? "archived" : "disabled"
            } SLO ${updatedItemId.toString()}: ${err}`,
          );
        }
      }
    }

    /*
     * Monitor membership follows the SLO's monitor rules, and
     * ServiceLevelObjectiveMonitorRuleService re-syncs whenever one of those
     * changes, so an ordinary SLO edit needs no sync. The exception is a write
     * of the deprecated "Auto-Add Monitors With Labels" list, which nothing
     * else on this release would act on - see applyDeprecatedMonitorLabelWrite.
     */
    if (
      onUpdate.updateBy.data.monitorLabels !== undefined &&
      updatedItemIds.length > 0
    ) {
      await this.applyDeprecatedMonitorLabelWrite({
        serviceLevelObjectiveIds: updatedItemIds,
        writtenMonitorLabels: onUpdate.updateBy.data.monitorLabels as unknown,
        labelIdsBeforeUpdateBySloId:
          (onUpdate.carryForward?.monitorLabelIdsBeforeUpdate as
            | Dictionary<Array<string>>
            | null
            | undefined) || {},
      });
    }

    /*
     * If the objective's math inputs changed, force a re-evaluation on the
     * worker's next tick.
     *
     * "Inputs" means every column the worker's result depends on, not only
     * the objective's: the downtime statuses and multi-monitor mode decide
     * which seconds count as bad, the timezone moves calendar-month
     * boundaries, and the at-risk threshold decides the status. All four are
     * edited on the Settings page, and without them a saved change kept
     * showing the old numbers until the SLO's regular cadence came round.
     */
    const isEvaluationConfigUpdated: boolean =
      onUpdate.updateBy.data.targetPercentage !== undefined ||
      onUpdate.updateBy.data.windowDays !== undefined ||
      onUpdate.updateBy.data.windowType !== undefined ||
      onUpdate.updateBy.data.monitors !== undefined ||
      onUpdate.updateBy.data.multiMonitorMode !== undefined ||
      onUpdate.updateBy.data.downtimeMonitorStatuses !== undefined ||
      onUpdate.updateBy.data.atRiskThresholdPercentage !== undefined ||
      onUpdate.updateBy.data.timezone !== undefined ||
      /*
       * Unarchived: the worker stopped looking at this SLO while it was
       * archived, so its status and budget are frozen at archive time. Its
       * nextEvaluationAt is normally already in the past, but stamping it
       * explicitly guarantees the numbers refresh on the very next tick.
       * (A still-disabled SLO stays skipped by getDueSlos regardless.)
       */
      (onUpdate.updateBy.data.isArchived as boolean | undefined) === false;

    if (isEvaluationConfigUpdated) {
      for (const updatedItemId of updatedItemIds) {
        try {
          await this.updateOneById({
            id: updatedItemId,
            data: {
              nextEvaluationAt: OneUptimeDate.getCurrentDate(),
            },
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          logger.error(
            `Error forcing re-evaluation of SLO ${updatedItemId.toString()}: ${err}`,
          );
        }
      }
    }

    return onUpdate;
  }

  /*
   * READ ONLY: notes down the SLOs this delete may remove and, for each, the
   * burn rate rules whose open alerts and incidents onDeleteSuccess resolves.
   *
   * The rules have to be read now. They cascade away with the SLO in Postgres,
   * with no hook of their own, and a rule's id is half of the fingerprint that
   * finds what it opened.
   *
   * Nothing is resolved here. DatabaseService runs this hook BEFORE it applies
   * the caller's delete permissions, and the CRUD API passes a raw id, so these
   * rows are only candidates. Resolving here as root let a delete that named
   * another project's SLO close that project's burn rate alerts and incidents
   * while deleting nothing. onDeleteSuccess acts only on the ids the delete
   * really removed, and the tenant pin keeps this read from even seeing
   * another project's SLOs. A multi-tenant request is left unpinned because
   * DatabaseService does not pin it either: candidates narrower than what the
   * delete removes would strand records instead.
   *
   * A failed read is deliberately not caught: deleting an SLO without knowing
   * its rules would strand everything they opened, and the on-call escalations
   * with it, because the evaluation worker never looks at a deleted SLO again.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = await this.findBy({
      query: SloFeedUtil.getTenantPinnedQuery({
        query: deleteBy.query,
        tenantId: deleteBy.props.isMultiTenantRequest
          ? undefined
          : deleteBy.props.tenantId,
      }),
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    const burnRateRules: Array<ServiceLevelObjectiveBurnRateRule> = [];

    for (const item of itemsToDelete) {
      if (!item.id || !item.projectId) {
        continue;
      }

      const rulesOfSlo: Array<ServiceLevelObjectiveBurnRateRule> =
        await ServiceLevelObjectiveBurnRateRuleService.findBy({
          query: {
            serviceLevelObjectiveId: item.id,
            projectId: item.projectId,
          },
          select: {
            _id: true,
            projectId: true,
            serviceLevelObjectiveId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      burnRateRules.push(...rulesOfSlo);
    }

    const carryForward: SloDeleteCarryForward = {
      itemsToDelete: itemsToDelete,
      burnRateRules: burnRateRules,
    };

    return {
      deleteBy,
      carryForward: carryForward,
    };
  }

  /*
   * Resolves what the burn rate rules of every SLO this delete really removed
   * left open. Nothing else ever will: the evaluation worker never looks at a
   * deleted SLO again, so those alerts and incidents, and their on-call
   * escalations, would otherwise stay open forever.
   *
   * Only the SLOs whose ids DatabaseService reports as deleted are acted on
   * (SloFeedUtil.getRowsActuallyDeleted), never every candidate onBeforeDelete
   * read - see there for why.
   *
   * Resolving after the delete is safe: open records are found by fingerprint
   * in the Alert and Incident tables, not through the SLO or rule rows. It is
   * also the honest order - a delete that fails leaves its records open next
   * to the SLO that still stands behind them.
   *
   * Rule by rule rather than through resolveOpenBurnRateAlertsAndIncidentsForSlo:
   * that one reads the SLO's rules, which the cascade has already removed, and
   * clears their lifecycle columns, which no longer exist.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carryForward: SloDeleteCarryForward | null =
      (onDelete.carryForward as SloDeleteCarryForward | null) || null;

    const deletedSlos: Array<Model> = SloFeedUtil.getRowsActuallyDeleted({
      rows: carryForward?.itemsToDelete || [],
      deletedIds: itemIdsBeforeDelete,
    });

    for (const slo of deletedSlos) {
      if (!slo.id || !slo.projectId) {
        continue;
      }

      const sloId: ObjectID = slo.id;
      const projectId: ObjectID = slo.projectId;

      const rulesOfSlo: Array<ServiceLevelObjectiveBurnRateRule> = (
        carryForward?.burnRateRules || []
      ).filter((rule: ServiceLevelObjectiveBurnRateRule): boolean => {
        return (
          rule.serviceLevelObjectiveId?.toString().toLowerCase() ===
          sloId.toString().toLowerCase()
        );
      });

      for (const rule of rulesOfSlo) {
        if (!rule.id) {
          continue;
        }

        try {
          await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsAndIncidentsForRule(
            {
              serviceLevelObjectiveId: sloId,
              burnRateRuleId: rule.id,
              projectId: projectId,
              rootCause: SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
            },
          );
        } catch (err) {
          /*
           * Never fail the request - the SLO is already gone - and never let
           * one rule's failure cost the next rule its resolve.
           */
          logger.error(
            `Error resolving open alerts and incidents for burn rate rule ${rule.id.toString()} of deleted SLO ${sloId.toString()}: ${err}`,
            { projectId: projectId.toString() } as LogAttributes,
          );
        }
      }
    }

    return onDelete;
  }

  /*
   * Resolve everything any of this SLO's burn rate rules has left open — the
   * Alerts they raised and the Incidents they declared. Called when the SLO is
   * disabled, archived or deleted, and by the worker's Misconfigured / Paused
   * guards.
   *
   * `rootCause` is what the resolved records say closed them; it defaults to
   * the disable/delete wording so every existing caller is unchanged.
   */
  @CaptureSpan()
  public async resolveOpenBurnRateAlertsAndIncidentsForSlo(data: {
    sloId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const rootCause: string =
      data.rootCause || SLO_DISABLED_OR_DELETED_ROOT_CAUSE;

    const burnRateRules: Array<ServiceLevelObjectiveBurnRateRule> =
      await ServiceLevelObjectiveBurnRateRuleService.findBy({
        query: {
          serviceLevelObjectiveId: data.sloId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    /*
     * One rule failing must not skip the rest — but the failure must still
     * REACH the caller. The worker's guard path (Paused / Misconfigured)
     * deliberately resolves before it commits the new status so that a failed
     * resolve is retried on the next tick; swallowing the error here would
     * hand it a success, let it commit, and the next tick would see no
     * transition and never retry, stranding the record and its on-call
     * escalation forever. So: attempt every rule, then rethrow the first
     * error.
     *
     * The lifecycle-hook callers (SLO disabled / deleted) already wrap this in
     * their own try/catch, so propagating changes nothing for them.
     */
    let firstError: unknown = null;

    for (const rule of burnRateRules) {
      if (!rule.id) {
        continue;
      }

      try {
        await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsAndIncidentsForRule(
          {
            serviceLevelObjectiveId: data.sloId,
            burnRateRuleId: rule.id,
            projectId: data.projectId,
            rootCause: rootCause,
          },
        );

        /*
         * The rule's own lifecycle columns still say it has something open —
         * this path deliberately does not stamp a resolve, because that would
         * start a re-fire suppression window of up to the rule's long window.
         * But the evaluation worker reads those same columns to decide whether
         * an output is already open, so leaving them set silences the rule for
         * the rest of the burn once the SLO is re-enabled. Forget the open
         * state instead: nothing is open, and nothing just recovered.
         */
        await ServiceLevelObjectiveBurnRateRuleService.clearOpenOutputStateForRule(
          {
            burnRateRuleId: rule.id,
            clearAlert: true,
            clearIncident: true,
          },
        );
      } catch (err) {
        logger.error(
          `Error resolving open alerts and incidents for burn rate rule ${rule.id?.toString()} of SLO ${data.sloId?.toString()}: ${err}`,
          { projectId: data.projectId?.toString() } as LogAttributes,
        );

        if (firstError === null) {
          firstError = err;
        }
      }
    }

    if (firstError !== null) {
      throw firstError;
    }
  }

  /*
   * All enabled, unarchived SLOs in active projects that are due for
   * evaluation (nextEvaluationAt in the past, or never evaluated). Selects
   * every config and state column the evaluation worker needs.
   *
   * Archived is checked separately from enabled on purpose: the two flags are
   * independent (unarchiving must not re-enable an SLO somebody paused), and
   * either one alone takes the SLO out of evaluation. The worker re-reads both
   * right before a burn rate rule fires, because this snapshot can go stale
   * while a long sweep is still running.
   */
  @CaptureSpan()
  public async getDueSlos(): Promise<Array<Model>> {
    return await this.findAllBy({
      query: {
        isEnabled: true,
        isArchived: false,
        nextEvaluationAt: QueryHelper.lessThanEqualToOrNull(
          OneUptimeDate.getCurrentDate(),
        ),
        project: {
          ...ProjectService.getActiveProjectStatusQuery(),
        },
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        /*
         * Stamped as oneuptime.label.* on the oneuptime.slo.* metrics the
         * worker posts (SloMetricUtil), so SLO series group and filter by
         * the same labels as the SLO list.
         */
        labels: {
          _id: true,
          name: true,
        },
        isEnabled: true,
        sliType: true,
        multiMonitorMode: true,
        monitors: {
          _id: true,
        },
        downtimeMonitorStatuses: {
          _id: true,
        },
        metricQueryConfig: true,
        targetPercentage: true,
        windowType: true,
        windowDays: true,
        timezone: true,
        atRiskThresholdPercentage: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
        errorBudgetRemainingSeconds: true,
        errorBudgetTotalSeconds: true,
        currentBurnRate: true,
        sloStatus: true,
        statusChangeNotificationSentAt: true,
        lastEvaluatedAt: true,
        nextEvaluationAt: true,
        lastAccumulatedBucketEndAt: true,
      },
      sort: {
        nextEvaluationAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async findOwners(
    serviceLevelObjectiveId: ObjectID,
  ): Promise<Array<User>> {
    if (!serviceLevelObjectiveId) {
      throw new BadDataException("serviceLevelObjectiveId is required");
    }

    const ownerUsers: Array<ServiceLevelObjectiveOwnerUser> =
      await ServiceLevelObjectiveOwnerUserService.findBy({
        query: {
          serviceLevelObjectiveId: serviceLevelObjectiveId,
        },
        select: {
          _id: true,
          projectId: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<ServiceLevelObjectiveOwnerTeam> =
      await ServiceLevelObjectiveOwnerTeamService.findBy({
        query: {
          serviceLevelObjectiveId: serviceLevelObjectiveId,
        },
        select: {
          _id: true,
          projectId: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: ServiceLevelObjectiveOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: ServiceLevelObjectiveOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        // check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    const projectId: ObjectID | undefined =
      ownerUsers[0]?.projectId || ownerTeams[0]?.projectId;

    if (!projectId) {
      return [];
    }

    // Owners who left the project are not notified, nor listed as notified.
    return await TeamMemberService.filterUsersToProjectMembers({
      projectId: projectId,
      users: users,
    });
  }

  @CaptureSpan()
  public async getSloLinkInDashboard(
    projectId: ObjectID,
    serviceLevelObjectiveId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/slos/${serviceLevelObjectiveId.toString()}`,
    );
  }

  /*
   * `[SLO <name>](<dashboard link>)` for feed items and notifications.
   *
   * The name is user-controlled and feeds render without safe mode, so it is
   * escaped here, once, at the point it becomes markdown - a name like
   * `x](https://evil)` must not be able to re-point the link.
   *
   * Pass `sloName` whenever the caller already has it (the worker always
   * does); the lookup is only a fallback for callers holding just an id. An
   * SLO that cannot be found still gets a working link, labelled "SLO".
   *
   * The lookup is pinned to `projectId`. Its callers are feed writers running
   * after a write, and several of them hold an SLO id nobody checked against
   * the tenant (an owner row or burn rate rule created with another project's
   * SLO id). Read as root without the pin, that id would copy another
   * project's SLO name into a feed item the caller's project can read. An SLO
   * outside the project is treated exactly like one that does not exist.
   */
  @CaptureSpan()
  public async getSloMarkdownLink(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    sloName?: string | undefined;
  }): Promise<string> {
    let sloName: string | undefined = data.sloName;

    if (sloName === undefined) {
      const slo: Model | null = await this.findOneBy({
        query: {
          _id: data.sloId.toString(),
          projectId: data.projectId,
        },
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      sloName = slo?.name || undefined;
    }

    const link: URL = await this.getSloLinkInDashboard(
      data.projectId,
      data.sloId,
    );

    const escapedName: string = escapeMarkdownInline(sloName).trim();

    const linkText: string = escapedName ? `SLO ${escapedName}` : "SLO";

    return `[${linkText}](${link.toString()})`;
  }

  /*
   * Seed the two canonical Google-SRE multi-window burn rate rules, with
   * thresholds scaled to the SLO's compliance window. The textbook constants
   * (14.4x over 1h/5m, 6x over 6h/30m) are derived from spending 2% / 5% of a
   * 30-day budget: threshold = budgetFraction * windowHours / longWindowHours.
   * A 30-day window reproduces exactly 14.4 and 6; shorter or longer windows
   * stay correctly calibrated.
   */
  private async seedDefaultBurnRateRules(
    createdItem: Model,
  ): Promise<Array<ServiceLevelObjectiveBurnRateRule>> {
    // The rules actually written, for the SLO's "created" feed item.
    const seededRules: Array<ServiceLevelObjectiveBurnRateRule> = [];

    if (!createdItem.id || !createdItem.projectId) {
      return seededRules;
    }

    const windowHours: number =
      createdItem.windowType === SloWindowType.CalendarMonth
        ? 720
        : (createdItem.windowDays || 30) * 24;

    /*
     * Default severity: the project's lowest-order (most severe) severity.
     * A failure here must not cost the SLO its burn-rate rules — the rules are
     * still useful without a severity (the worker falls back to the lowest
     * order severity when it creates the alert), so a transient lookup error
     * degrades to "no default severity" rather than "no rules at all".
     */
    let severity: AlertSeverity | null = null;

    try {
      severity = await AlertSeverityService.findOneBy({
        query: {
          projectId: createdItem.projectId,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        `Could not look up the default alert severity for SLO ${createdItem.id.toString()}. Seeding burn rate rules without one.`,
      );
      logger.error(error);
    }

    const defaultRules: Array<{
      name: string;
      burnRateThreshold: number;
      longWindowInMinutes: number;
      shortWindowInMinutes: number;
    }> = [
      {
        name: "Fast burn",
        burnRateThreshold: this.roundToTwoDecimals((0.02 * windowHours) / 1),
        longWindowInMinutes: 60,
        shortWindowInMinutes: 5,
      },
      {
        name: "Slow burn",
        burnRateThreshold: this.roundToTwoDecimals((0.05 * windowHours) / 6),
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      },
    ];

    for (const defaultRule of defaultRules) {
      try {
        const rule: ServiceLevelObjectiveBurnRateRule =
          new ServiceLevelObjectiveBurnRateRule();
        rule.projectId = createdItem.projectId;
        rule.serviceLevelObjectiveId = createdItem.id;
        rule.name = defaultRule.name;
        rule.isEnabled = true;
        rule.burnRateThreshold = defaultRule.burnRateThreshold;
        rule.longWindowInMinutes = defaultRule.longWindowInMinutes;
        rule.shortWindowInMinutes = defaultRule.shortWindowInMinutes;

        if (severity && severity.id) {
          rule.alertSeverityId = severity.id;
        }

        await ServiceLevelObjectiveBurnRateRuleService.create({
          data: rule,
          props: {
            isRoot: true,
          },
        });

        seededRules.push(rule);
      } catch (err) {
        logger.error(
          `Error seeding default burn rate rule "${defaultRule.name}" for SLO ${createdItem.id?.toString()}: ${err}`,
          { projectId: createdItem.projectId?.toString() } as LogAttributes,
        );
      }
    }

    return seededRules;
  }

  /*
   * The SLO's "created" feed item: who created it, what it promises, and the
   * default burn rate rules that came with it (folded in here rather than
   * posted as two more items underneath).
   */
  private async writeSloCreatedFeed(data: {
    onCreate: OnCreate<Model>;
    createdItem: Model;
    seededBurnRateRules: Array<ServiceLevelObjectiveBurnRateRule>;
    postedAt: Date;
  }): Promise<void> {
    const sloId: ObjectID | undefined = data.createdItem.id || undefined;
    const projectId: ObjectID | undefined = data.createdItem.projectId;

    if (!sloId || !projectId) {
      return;
    }

    /*
     * A dashboard, API-key or Terraform create carries an acting user; a
     * workflow or other automation creating as root does not, and the item
     * then says so instead of naming somebody.
     */
    const createdByUserId: ObjectID | undefined =
      data.createdItem.createdByUserId ||
      data.onCreate.createBy.props.userId ||
      undefined;

    const createdByUserMarkdown: string | null =
      await SloFeedUtil.getUserMarkdown({
        userId: createdByUserId,
        projectId: projectId,
      });

    const markdown: SloFeedMarkdown = getSloCreatedFeedMarkdown({
      sloMarkdownLink: await this.getSloMarkdownLink({
        projectId: projectId,
        sloId: sloId,
        sloName: data.createdItem.name || "",
      }),
      createdByUserMarkdown: createdByUserMarkdown,
      targetPercentage: data.createdItem.targetPercentage,
      windowType: data.createdItem.windowType,
      windowDays: data.createdItem.windowDays,
      timezone: data.createdItem.timezone,
      sliType: data.createdItem.sliType,
      atRiskThresholdPercentage: data.createdItem.atRiskThresholdPercentage,
      description: data.createdItem.description,
      defaultBurnRateRules: data.seededBurnRateRules,
    });

    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: sloId,
      projectId: projectId,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveCreated,
      displayColor: Green500,
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: markdown.moreInformationInMarkdown,
      // Only a user who still exists gets the avatar; otherwise "no user".
      userId: createdByUserMarkdown ? createdByUserId : undefined,
      postedAt: data.postedAt,
    });
  }

  /*
   * The before-half of the feed's change detection: the watched columns this
   * payload writes, and every matched SLO as it is before the write.
   *
   * Two rules keep this off the hot paths:
   *
   *   - It reads ONLY when the payload writes a watched column, and that is
   *     checked before any query. The evaluation worker writes this row on
   *     every tick (SLI, budget, burn rate, status) and the cadence stamps go
   *     through here too; none of those columns is watched, so they cost
   *     nothing.
   *
   *   - A root write of `monitors` is the monitor rule engine keeping
   *     rule-owned monitors in sync. The engine posts its own attach/detach
   *     items, so `monitors` is only watched on a non-root (hand-made) edit -
   *     which also spares every engine sync a read.
   *
   * A failed read never blocks the update; the feed just does not describe it.
   */
  private async readFeedSnapshotBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<SloFeedUpdateSnapshot | null> {
    const columns: Array<SloFeedColumn> = getSloFeedWatchedColumns({
      payload: updateBy.data,
      includeMonitors: !updateBy.props.isRoot,
    });

    if (columns.length === 0) {
      return null;
    }

    try {
      const rows: Array<Model> = await this.findBy({
        // Pinned: this hook runs before DatabaseService applies permissions.
        query: SloFeedUtil.getTenantPinnedQuery({
          query: updateBy.query,
          tenantId: updateBy.props.tenantId,
        }),
        select: this.getFeedSelect(columns),
        limit: updateBy.limit,
        skip: updateBy.skip,
        props: {
          isRoot: true,
        },
      });

      const rowsById: Dictionary<Model> = {};

      for (const row of rows) {
        if (row.id) {
          rowsById[row.id.toString()] = row;
        }
      }

      return {
        columns: columns,
        rowsById: rowsById,
      };
    } catch (err) {
      logger.error(
        `Error reading SLOs before an update for the SLO feed: ${err}`,
      );
      return null;
    }
  }

  private getFeedSelect(columns: Array<SloFeedColumn>): Select<Model> {
    return {
      _id: true,
      projectId: true,
      name: true,
      // Both flags word the enable / archive items, whichever one changed.
      isEnabled: true,
      isArchived: true,
      ...getSloFeedSelect(columns),
    } as Select<Model>;
  }

  private async writeSloUpdatedFeed(data: {
    onUpdate: OnUpdate<Model>;
    updatedItemIds: Array<ObjectID>;
    postedAt: Date;
  }): Promise<void> {
    const snapshot: SloFeedUpdateSnapshot | null =
      (data.onUpdate.carryForward?.feedSnapshot as
        | SloFeedUpdateSnapshot
        | null
        | undefined) || null;

    if (
      !snapshot ||
      snapshot.columns.length === 0 ||
      data.updatedItemIds.length === 0
    ) {
      return;
    }

    for (const sloId of data.updatedItemIds) {
      const before: Model | undefined = snapshot.rowsById[sloId.toString()];

      // Not in the snapshot means there is nothing to compare against.
      if (!before) {
        continue;
      }

      try {
        await this.writeFeedItemsForUpdatedSlo({
          sloId: sloId,
          before: before,
          columns: snapshot.columns,
          payload: data.onUpdate.updateBy.data as unknown as Record<
            string,
            unknown
          >,
          userId: data.onUpdate.updateBy.props.userId || undefined,
          postedAt: data.postedAt,
        });
      } catch (err) {
        logger.error(
          `Error writing feed items for updated SLO ${sloId.toString()}: ${err}`,
          { projectId: before.projectId?.toString() } as LogAttributes,
        );
      }
    }
  }

  /*
   * Compares one SLO before and after the write and posts what really
   * changed: archive / restore, enable / disable, an "updated" item with old
   * and new values, and hand-made monitor attaches and detaches. A form that
   * re-submits every field it shows posts nothing for the fields it did not
   * change.
   */
  private async writeFeedItemsForUpdatedSlo(data: {
    sloId: ObjectID;
    before: Model;
    columns: Array<SloFeedColumn>;
    payload: Record<string, unknown>;
    userId: ObjectID | undefined;
    postedAt: Date;
  }): Promise<void> {
    const projectId: ObjectID | undefined = data.before.projectId;

    if (!projectId) {
      return;
    }

    const after: Model | null = await this.findOneById({
      id: data.sloId,
      select: this.getFeedSelect(data.columns),
      props: {
        isRoot: true,
      },
    });

    if (!after) {
      return;
    }

    type IsWatchedFunction = (column: SloFeedColumn) => boolean;

    const isWatched: IsWatchedFunction = (column: SloFeedColumn): boolean => {
      return data.columns.some((watched: SloFeedColumn): boolean => {
        return watched.column === column.column;
      });
    };

    const beforeRow: SloFeedRow = data.before as unknown as SloFeedRow;
    const afterRow: SloFeedRow = after as unknown as SloFeedRow;

    // Unset reads as the column defaults: enabled, not archived.
    const isEnabled: boolean =
      normalizeSloFeedBoolean(after.isEnabled) !== false;
    const isArchived: boolean =
      normalizeSloFeedBoolean(after.isArchived) === true;

    const pendingItems: Array<SloFeedPendingItem> = [];

    if (
      isWatched(SLO_FEED_IS_ARCHIVED_COLUMN) &&
      !isSloFeedValueEqual(SLO_FEED_IS_ARCHIVED_COLUMN, beforeRow, afterRow)
    ) {
      pendingItems.push({
        eventType: isArchived
          ? ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveArchived
          : ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveRestored,
        displayColor: isArchived ? Yellow500 : Blue500,
        getMarkdown: (sloMarkdownLink: string): SloFeedMarkdown => {
          return getSloArchivedFeedMarkdown({
            sloMarkdownLink: sloMarkdownLink,
            isArchived: isArchived,
            isEnabled: isEnabled,
          });
        },
      });
    }

    if (
      isWatched(SLO_FEED_IS_ENABLED_COLUMN) &&
      !isSloFeedValueEqual(SLO_FEED_IS_ENABLED_COLUMN, beforeRow, afterRow)
    ) {
      pendingItems.push({
        eventType: isEnabled
          ? ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveEnabled
          : ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled,
        displayColor: isEnabled ? Green500 : Gray500,
        getMarkdown: (sloMarkdownLink: string): SloFeedMarkdown => {
          return getSloEnabledFeedMarkdown({
            sloMarkdownLink: sloMarkdownLink,
            isEnabled: isEnabled,
            isArchived: isArchived,
          });
        },
      });
    }

    const changes: Array<SloFeedColumnChange> = getSloFeedColumnChanges({
      columns: data.columns.filter((column: SloFeedColumn): boolean => {
        return SLO_FEED_UPDATE_COLUMNS.some(
          (updateColumn: SloFeedColumn): boolean => {
            return updateColumn.column === column.column;
          },
        );
      }),
      before: beforeRow,
      after: afterRow,
    });

    if (changes.length > 0) {
      pendingItems.push({
        eventType:
          ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveUpdated,
        displayColor: Gray500,
        getMarkdown: (sloMarkdownLink: string): SloFeedMarkdown => {
          return getSloUpdatedFeedMarkdown({
            sloMarkdownLink: sloMarkdownLink,
            changes: changes,
          });
        },
      });
    }

    if (isWatched(SLO_FEED_MONITORS_COLUMN)) {
      pendingItems.push(
        ...(await this.getManualMonitorFeedItems({
          projectId: projectId,
          before: data.before,
          after: after,
          writtenMonitors: data.payload["monitors"],
        })),
      );
    }

    if (pendingItems.length === 0) {
      return;
    }

    const sloMarkdownLink: string = await this.getSloMarkdownLink({
      projectId: projectId,
      sloId: data.sloId,
      sloName: after.name || data.before.name || "",
    });

    for (const pendingItem of pendingItems) {
      const markdown: SloFeedMarkdown =
        pendingItem.getMarkdown(sloMarkdownLink);

      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: data.sloId,
          projectId: projectId,
          serviceLevelObjectiveFeedEventType: pendingItem.eventType,
          displayColor: pendingItem.displayColor,
          feedInfoInMarkdown: markdown.feedInfoInMarkdown,
          moreInformationInMarkdown: markdown.moreInformationInMarkdown,
          userId: data.userId,
          postedAt: data.postedAt,
        },
      );
    }
  }

  /*
   * MonitorsAttached / MonitorsDetached for a hand-made edit of the monitor
   * set (the rule engine's root writes never get here - see
   * readFeedSnapshotBeforeUpdate).
   *
   * The new set is taken from the PAYLOAD, not from the re-read row: this
   * writer runs after the request, and by then a rule sync may already have
   * written the SLO's monitors again. Diffing against that would re-describe
   * the engine's own changes, which the engine posts itself. The re-read is
   * used only to put names on the monitors that were attached.
   */
  private async getManualMonitorFeedItems(data: {
    projectId: ObjectID;
    before: Model;
    after: Model;
    writtenMonitors: unknown;
  }): Promise<Array<SloFeedPendingItem>> {
    const beforeIds: Set<string> = new Set<string>(
      getSloFeedEntityIds(data.before.monitors),
    );
    const writtenIds: Set<string> = new Set<string>(
      getSloFeedEntityIds(data.writtenMonitors),
    );

    const attachedIds: Array<string> = Array.from(writtenIds).filter(
      (id: string): boolean => {
        return !beforeIds.has(id);
      },
    );
    const detachedIds: Array<string> = Array.from(beforeIds).filter(
      (id: string): boolean => {
        return !writtenIds.has(id);
      },
    );

    if (attachedIds.length === 0 && detachedIds.length === 0) {
      return [];
    }

    const nameById: Dictionary<string> = {};

    for (const monitor of [
      ...(data.before.monitors || []),
      ...(data.after.monitors || []),
    ] as Array<Monitor>) {
      const id: string | undefined = getSloFeedEntityIds([monitor])[0];

      if (id && monitor.name) {
        nameById[id] = monitor.name;
      }
    }

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    type ToReferencesFunction = (
      ids: Array<string>,
    ) => Array<SloFeedMonitorReference>;

    const toReferences: ToReferencesFunction = (
      ids: Array<string>,
    ): Array<SloFeedMonitorReference> => {
      return ids.map((id: string): SloFeedMonitorReference => {
        return {
          name: nameById[id] || "",
          link: SloFeedUtil.getMonitorLinkInDashboard({
            dashboardUrl: dashboardUrl,
            projectId: data.projectId,
            monitorId: id,
          }),
        };
      });
    };

    const items: Array<SloFeedPendingItem> = [];

    if (attachedIds.length > 0) {
      const attached: Array<SloFeedMonitorReference> =
        toReferences(attachedIds);

      items.push({
        eventType: ServiceLevelObjectiveFeedEventType.MonitorsAttached,
        displayColor: Blue500,
        getMarkdown: (sloMarkdownLink: string): SloFeedMarkdown => {
          return getSloMonitorsChangedFeedMarkdown({
            sloMarkdownLink: sloMarkdownLink,
            monitors: attached,
            change: "attached",
          });
        },
      });
    }

    if (detachedIds.length > 0) {
      const detached: Array<SloFeedMonitorReference> =
        toReferences(detachedIds);

      items.push({
        eventType: ServiceLevelObjectiveFeedEventType.MonitorsDetached,
        displayColor: Orange500,
        getMarkdown: (sloMarkdownLink: string): SloFeedMarkdown => {
          return getSloMonitorsChangedFeedMarkdown({
            sloMarkdownLink: sloMarkdownLink,
            monitors: detached,
            change: "detached",
          });
        },
      });
    }

    return items;
  }

  /*
   * What a write of the deprecated "Auto-Add Monitors With Labels" list
   * (ServiceLevelObjective.monitorLabels) does on this release.
   *
   * The column stays in the API so upgrades do not break, and it is still
   * written: a dashboard tab opened before the upgrade sends it with every
   * save of the SLO form, and so can an API client or a workflow written
   * against the previous release. Workflows write as root, which is why every
   * caller is handled here, not only users - nothing on this release writes
   * the column for its own reasons. Nothing else on this release reads it
   * either, so storing it and moving on left the SLO measuring something other
   * than what the caller had just saved. It is applied instead, the way this
   * release applies labels - as a monitor rule:
   *
   *   - An SLO with no monitor rule row gets the list as a rule
   *     (SloLegacyMonitorLabelAdoption) and is re-synced straight away, so its
   *     monitors reflect the list at once. A list cleared to empty has nothing
   *     to adopt, and the sync releases the monitors it attached - both what
   *     the previous release did.
   *   - An SLO that already has monitor rules, enabled or disabled, IGNORES
   *     the list, with a warning in the log when the list changed. Its rules
   *     are what it measures and what its Monitor Rules page shows. Folding the
   *     list into one of them was rejected: the form that sends it cannot show
   *     rules and re-submits the list it loaded, so it would undo edits made on
   *     the Monitor Rules page, and once the converted rule has been renamed,
   *     edited or deleted there is no rule the list reliably "is".
   *
   * Only a CHANGED list is adopted without evidence. The same list re-submitted
   * by an out-of-date form is adopted only while monitors are still attached
   * by it (the previous release's engine attached them), so re-saving that
   * form cannot bring back a converted rule the user deleted. See
   * readDeprecatedMonitorLabelsBeforeUpdate.
   *
   * Never throws: the write has landed, and a failure here must not fail the
   * request. An SLO whose adoption failed is not synced this time, because a
   * sync without its rule would release the monitors the list attached.
   */
  private async applyDeprecatedMonitorLabelWrite(data: {
    serviceLevelObjectiveIds: Array<ObjectID>;
    writtenMonitorLabels: unknown;
    labelIdsBeforeUpdateBySloId: Dictionary<Array<string>>;
  }): Promise<void> {
    // One adoption call per project, and per answer to "is evidence needed".
    interface AdoptionGroup {
      projectId: ObjectID;
      requireRuleAttachedMonitors: boolean;
      serviceLevelObjectiveIds: Array<string>;
    }

    try {
      // Sorted, de-duplicated and lower-case, so two lists compare joined.
      const writtenLabelIds: Array<string> = getSloFeedEntityIds(
        data.writtenMonitorLabels,
      );

      // Root, by id: these are the rows the permission-checked write changed.
      const slos: Array<Model> = await this.findBy({
        query: {
          _id: QueryHelper.any(data.serviceLevelObjectiveIds),
        },
        select: {
          _id: true,
          projectId: true,
        },
        limit: data.serviceLevelObjectiveIds.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const sloIdsWithRules: Set<string> =
        await ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsWithAnyRule(
          slos
            .map((slo: Model): ObjectID | null => {
              return slo.id;
            })
            .filter((id: ObjectID | null): id is ObjectID => {
              return Boolean(id);
            }),
        );

      const adoptionGroups: Map<string, AdoptionGroup> = new Map<
        string,
        AdoptionGroup
      >();
      const sloIdsToSync: Array<string> = [];

      for (const slo of slos) {
        if (!slo.id || !slo.projectId) {
          continue;
        }

        const sloId: string = slo.id.toString().toLowerCase();

        const labelIdsBeforeUpdate: Array<string> | undefined =
          data.labelIdsBeforeUpdateBySloId[sloId];

        // Unknown (the read before the write failed) counts as re-submitted.
        const isListChanged: boolean =
          labelIdsBeforeUpdate !== undefined &&
          labelIdsBeforeUpdate.join(",") !== writtenLabelIds.join(",");

        if (sloIdsWithRules.has(sloId)) {
          if (isListChanged) {
            logger.warn(
              `Ignored a change to the deprecated "Auto-Add Monitors With Labels" list of SLO ${sloId}: the SLO has monitor rules, and they decide which monitors it measures. Change its monitor rules instead.`,
              {
                projectId: slo.projectId.toString(),
                serviceLevelObjectiveId: sloId,
              } as LogAttributes,
            );
          }

          continue;
        }

        sloIdsToSync.push(sloId);

        // An empty list has nothing to adopt; the sync alone releases it.
        if (writtenLabelIds.length === 0) {
          continue;
        }

        const groupKey: string = `${slo.projectId.toString()}|${isListChanged}`;

        const group: AdoptionGroup = adoptionGroups.get(groupKey) || {
          projectId: slo.projectId,
          requireRuleAttachedMonitors: !isListChanged,
          serviceLevelObjectiveIds: [],
        };

        group.serviceLevelObjectiveIds.push(sloId);
        adoptionGroups.set(groupKey, group);
      }

      const sloIdsNotToSync: Set<string> = new Set<string>();

      for (const group of adoptionGroups.values()) {
        try {
          await SloLegacyMonitorLabelAdoption.adoptLegacyMonitorLabels({
            projectId: group.projectId,
            serviceLevelObjectiveIds: group.serviceLevelObjectiveIds,
            requireRuleAttachedMonitors: group.requireRuleAttachedMonitors,
          });
        } catch (err) {
          logger.error(
            `Error converting the deprecated monitor label list of SLOs ${group.serviceLevelObjectiveIds.join(", ")} into monitor rules; not re-syncing their monitors this time: ${err}`,
            { projectId: group.projectId.toString() } as LogAttributes,
          );

          for (const sloId of group.serviceLevelObjectiveIds) {
            sloIdsNotToSync.add(sloId);
          }
        }
      }

      for (const sloId of sloIdsToSync) {
        if (sloIdsNotToSync.has(sloId)) {
          continue;
        }

        try {
          await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo(
            {
              serviceLevelObjectiveId: new ObjectID(sloId),
            },
          );
        } catch (err) {
          // One SLO failing must not cost the others their sync.
          logger.error(
            `Error applying the monitor rules of SLO ${sloId} after its deprecated monitor label list was written: ${err}`,
          );
        }
      }
    } catch (err) {
      logger.error(
        `Error applying a write of the deprecated SLO monitor label list: ${err}`,
      );
    }
  }

  /*
   * The create half of applyDeprecatedMonitorLabelWrite: a create carrying a
   * non-empty deprecated label list gets it as a monitor rule before
   * onCreateSuccess syncs the SLO's monitors. No evidence is asked for - a
   * brand-new SLO has attached nothing and has no deleted rule to bring back -
   * and it cannot have rules yet, so there is nothing to ignore it for.
   *
   * Never throws. A failed adoption is logged and leaves the SLO without the
   * rule; the sync after it releases nothing, because nothing is attached yet.
   */
  private async adoptDeprecatedMonitorLabelsWrittenOnCreate(
    createdItem: Model,
  ): Promise<void> {
    if (
      !createdItem.id ||
      !createdItem.projectId ||
      getSloFeedEntityIds(createdItem.monitorLabels).length === 0
    ) {
      return;
    }

    try {
      await SloLegacyMonitorLabelAdoption.adoptLegacyMonitorLabels({
        projectId: createdItem.projectId,
        serviceLevelObjectiveIds: [createdItem.id],
        requireRuleAttachedMonitors: false,
      });
    } catch (err) {
      logger.error(
        `Error converting the deprecated monitor label list of new SLO ${createdItem.id.toString()} into a monitor rule: ${err}`,
        { projectId: createdItem.projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * The deprecated label list of every SLO this update may write, as it is
   * BEFORE the write, keyed by lower-case SLO id - or null when the payload
   * does not write that list, which is every update this release's own
   * clients make, so they pay nothing.
   *
   * applyDeprecatedMonitorLabelWrite compares it with the written list,
   * because only a CHANGED list is somebody asking for something: an
   * out-of-date SLO form re-sends every field it loaded, labels included, on
   * every save.
   *
   * Pinned to the caller's tenant like the feed snapshot, since this runs
   * before DatabaseService applies the update's permissions. A failed read
   * never blocks the update; its SLOs then count as re-submitting their list,
   * the reading that can never bring a deleted rule back.
   */
  private async readDeprecatedMonitorLabelsBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<Dictionary<Array<string>> | null> {
    if ((updateBy.data.monitorLabels as unknown) === undefined) {
      return null;
    }

    const labelIdsBySloId: Dictionary<Array<string>> = {};

    try {
      const rows: Array<Model> = await this.findBy({
        query: SloFeedUtil.getTenantPinnedQuery({
          query: updateBy.query,
          tenantId: updateBy.props.tenantId,
        }),
        select: {
          _id: true,
          monitorLabels: {
            _id: true,
          },
        },
        limit: updateBy.limit,
        skip: updateBy.skip,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        if (row.id) {
          labelIdsBySloId[row.id.toString().toLowerCase()] =
            getSloFeedEntityIds(row.monitorLabels);
        }
      }
    } catch (err) {
      logger.error(
        `Error reading SLO monitor label lists before an update: ${err}`,
      );
    }

    return labelIdsBySloId;
  }

  /*
   * The manual-add guard. While an SLO has at least one ENABLED monitor rule,
   * its monitor list belongs to those rules, so a hand-edit may only take away
   * monitors a person attached:
   *
   *   - adding a monitor that is not already attached is refused - the rules
   *     decide what is measured, and the Monitors page says so;
   *   - removing a monitor a rule attached is refused too - it would not
   *     stick: it stays recorded in autoAddedMonitors and the next sync would
   *     attach it again, which reads as the edit silently failing;
   *   - removing a monitor attached by hand (before the rules were enabled)
   *     stays allowed.
   *
   * Root writes pass untouched: the rule engine itself writes `monitors` as
   * root, and it must never be refused by the guard that protects its output.
   *
   * This hook runs before DatabaseService's update permission check, so the
   * caller's raw query is pinned to the caller's tenant before anything is
   * read - a validation read must not answer questions about another
   * project's SLOs.
   */
  private async assertMonitorEditRespectsMonitorRules(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const nextMonitors: unknown = updateBy.data.monitors as unknown;

    if (nextMonitors === undefined || updateBy.props.isRoot) {
      return;
    }

    const query: Record<string, unknown> = {
      ...(updateBy.query as Record<string, unknown>),
    };

    if (updateBy.props.tenantId) {
      query["projectId"] = updateBy.props.tenantId;
    }

    const slos: Array<Model> = await this.findBy({
      query: query as UpdateBy<Model>["query"],
      select: {
        _id: true,
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

    const sloIds: Array<ObjectID> = slos
      .map((slo: Model): ObjectID | null => {
        return slo.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (sloIds.length === 0) {
      return;
    }

    const sloIdsWithEnabledRules: Set<string> =
      await ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsWithEnabledRules(
        sloIds,
      );

    if (sloIdsWithEnabledRules.size === 0) {
      return;
    }

    const nextMonitorIds: Set<string> = this.toMonitorIdSet(nextMonitors);

    for (const slo of slos) {
      if (
        !slo.id ||
        !sloIdsWithEnabledRules.has(slo.id.toString().toLowerCase())
      ) {
        continue;
      }

      const attachedMonitorIds: Set<string> = this.toMonitorIdSet(slo.monitors);

      const isAddingMonitors: boolean = Array.from(nextMonitorIds).some(
        (monitorId: string): boolean => {
          return !attachedMonitorIds.has(monitorId);
        },
      );

      if (isAddingMonitors) {
        throw new BadDataException(
          "This SLO's monitors are managed by its monitor rules. Disable the rules to add monitors by hand.",
        );
      }

      const isRemovingRuleAttachedMonitors: boolean = Array.from(
        this.toMonitorIdSet(slo.autoAddedMonitors),
      ).some((monitorId: string): boolean => {
        return (
          attachedMonitorIds.has(monitorId) && !nextMonitorIds.has(monitorId)
        );
      });

      if (isRemovingRuleAttachedMonitors) {
        throw new BadDataException(
          "A monitor rule attached this monitor, so removing it by hand would not stick: the rule would attach it again. Change or disable the rule to detach it.",
        );
      }
    }
  }

  /*
   * Monitor ids from any shape they reach this service in: Monitor rows from
   * a read, `{ _id }` stubs or bare uuid strings from an API payload (which
   * DatabaseService only turns into entities after onBeforeUpdate). Lower-case,
   * because Postgres renders a uuid lower-case whatever case it was written in.
   */
  private toMonitorIdSet(value: unknown): Set<string> {
    const items: Array<unknown> = Array.isArray(value)
      ? value
      : value === null || value === undefined
        ? []
        : [value];

    const ids: Set<string> = new Set<string>();

    for (const item of items) {
      const id: string =
        resolveReferenceId(item)?.toString().trim().toLowerCase() || "";

      if (id) {
        ids.add(id);
      }
    }

    return ids;
  }

  private roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /*
   * Coerce an API-supplied numeric column to a number. HTML number inputs hand
   * Formik strings, and neither ModelForm nor BaseModel.fromJSON coerces
   * Number/Decimal columns, so a perfectly valid "99.9" reaches these hooks as
   * a string. Anything that is not a finite numeric string or number becomes
   * NaN, which every caller below rejects. Mirrors
   * GlobalConfigService.normalizePercent.
   */
  private normalizeNumericInput(value: unknown): number {
    if (typeof value === "string") {
      const trimmed: string = value.trim();
      return trimmed === "" ? Number.NaN : Number(trimmed);
    }

    if (typeof value === "number") {
      return value;
    }

    return Number.NaN;
  }

  private validateTargetPercentage(value: unknown): number {
    const targetPercentage: number = this.normalizeNumericInput(value);

    if (
      !Number.isFinite(targetPercentage) ||
      targetPercentage <= 0 ||
      targetPercentage > 99.999
    ) {
      throw new BadDataException(
        "SLO target must be greater than 0 and at most 99.999. A 100% target leaves no error budget.",
      );
    }

    return targetPercentage;
  }

  private validateWindowDays(value: unknown): number {
    const windowDays: number = this.normalizeNumericInput(value);

    /*
     * The column is a Postgres integer, so a decimal that cleared only the
     * range check would fail the INSERT with a raw driver error instead of
     * this message.
     */
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) {
      throw new BadDataException(
        "SLO window must be a whole number of days between 1 and 366.",
      );
    }

    return windowDays;
  }

  private validateAtRiskThresholdPercentage(value: unknown): number {
    const atRiskThresholdPercentage: number = this.normalizeNumericInput(value);

    // Integer column — see validateWindowDays.
    if (
      !Number.isInteger(atRiskThresholdPercentage) ||
      atRiskThresholdPercentage < 0 ||
      atRiskThresholdPercentage > 100
    ) {
      throw new BadDataException(
        "SLO at-risk threshold must be a whole percentage between 0 and 100.",
      );
    }

    return atRiskThresholdPercentage;
  }
}

export default new Service();
