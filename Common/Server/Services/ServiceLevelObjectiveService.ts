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
import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertSeverityService from "./AlertSeverityService";
import DatabaseService from "./DatabaseService";
import MonitorStatusService from "./MonitorStatusService";
import ProjectService from "./ProjectService";
import ServiceLevelObjectiveBurnRateRuleService from "./ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveOwnerTeamService from "./ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "./ServiceLevelObjectiveOwnerUserService";
import TeamMemberService from "./TeamMemberService";

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
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
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
    try {
      await this.seedDefaultBurnRateRules(createdItem);
    } catch (err) {
      logger.error(
        `Error seeding default burn rate rules for SLO ${createdItem.id?.toString()}: ${err}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
    }

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

    return {
      updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * When an SLO is disabled, resolve its open burn-rate alerts — the
     * evaluation worker skips disabled SLOs, so nothing else would ever
     * resolve them (and their on-call escalations would stay open forever).
     */
    if ((onUpdate.updateBy.data.isEnabled as boolean | undefined) === false) {
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

          await this.resolveOpenBurnRateAlertsForSlo({
            sloId: updatedItemId,
            projectId: slo.projectId,
          });
        } catch (err) {
          logger.error(
            `Error resolving open burn rate alerts for disabled SLO ${updatedItemId.toString()}: ${err}`,
          );
        }
      }
    }

    /*
     * If the objective's math inputs changed, force a re-evaluation on the
     * worker's next tick.
     */
    const isEvaluationConfigUpdated: boolean =
      onUpdate.updateBy.data.targetPercentage !== undefined ||
      onUpdate.updateBy.data.windowDays !== undefined ||
      onUpdate.updateBy.data.windowType !== undefined ||
      onUpdate.updateBy.data.monitors !== undefined;

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

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
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

    for (const item of itemsToDelete) {
      if (!item.id || !item.projectId) {
        continue;
      }

      try {
        await this.resolveOpenBurnRateAlertsForSlo({
          sloId: item.id,
          projectId: item.projectId,
        });
      } catch (err) {
        logger.error(
          `Error resolving open burn rate alerts for SLO ${item.id?.toString()} before delete: ${err}`,
          { projectId: item.projectId?.toString() } as LogAttributes,
        );
      }
    }

    return {
      deleteBy,
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
    };
  }

  /*
   * Resolve every open Alert fired by any of this SLO's burn rate rules.
   * Called when the SLO is disabled or deleted.
   */
  @CaptureSpan()
  public async resolveOpenBurnRateAlertsForSlo(data: {
    sloId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
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

    for (const rule of burnRateRules) {
      if (!rule.id) {
        continue;
      }

      try {
        await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule(
          {
            serviceLevelObjectiveId: data.sloId,
            burnRateRuleId: rule.id,
            projectId: data.projectId,
            rootCause:
              "Alert auto-resolved because the Service Level Objective was disabled or deleted.",
          },
        );
      } catch (err) {
        logger.error(
          `Error resolving open alerts for burn rate rule ${rule.id?.toString()} of SLO ${data.sloId?.toString()}: ${err}`,
          { projectId: data.projectId?.toString() } as LogAttributes,
        );
      }
    }
  }

  /*
   * All enabled SLOs in active projects that are due for evaluation
   * (nextEvaluationAt in the past, or never evaluated). Selects every config
   * and state column the evaluation worker needs.
   */
  @CaptureSpan()
  public async getDueSlos(): Promise<Array<Model>> {
    return await this.findAllBy({
      query: {
        isEnabled: true,
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

    return users;
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
   * Seed the two canonical Google-SRE multi-window burn rate rules, with
   * thresholds scaled to the SLO's compliance window. The textbook constants
   * (14.4x over 1h/5m, 6x over 6h/30m) are derived from spending 2% / 5% of a
   * 30-day budget: threshold = budgetFraction * windowHours / longWindowHours.
   * A 30-day window reproduces exactly 14.4 and 6; shorter or longer windows
   * stay correctly calibrated.
   */
  private async seedDefaultBurnRateRules(createdItem: Model): Promise<void> {
    if (!createdItem.id || !createdItem.projectId) {
      return;
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
      } catch (err) {
        logger.error(
          `Error seeding default burn rate rule "${defaultRule.name}" for SLO ${createdItem.id?.toString()}: ${err}`,
          { projectId: createdItem.projectId?.toString() } as LogAttributes,
        );
      }
    }
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

    if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 366) {
      throw new BadDataException("SLO window must be between 1 and 366 days.");
    }

    return windowDays;
  }

  private validateAtRiskThresholdPercentage(value: unknown): number {
    const atRiskThresholdPercentage: number = this.normalizeNumericInput(value);

    if (
      !Number.isFinite(atRiskThresholdPercentage) ||
      atRiskThresholdPercentage < 0 ||
      atRiskThresholdPercentage > 100
    ) {
      throw new BadDataException(
        "SLO at-risk threshold must be a percentage between 0 and 100.",
      );
    }

    return atRiskThresholdPercentage;
  }
}

export default new Service();
