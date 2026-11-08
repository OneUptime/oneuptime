import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import {
  SloRecommendedAlertSeverities,
  SloRecommendedAlertSeverity,
  SloRecommendedBurnRateRule,
  getMissingSloRecommendedBurnRateRules,
  pickSloRecommendedAlertSeverities,
} from "../../Utils/Slo/SloRecommendedBurnRateRules";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertSeverityService from "./AlertSeverityService";
import ProjectReferencesService from "./ProjectReferencesService";
import {
  SLO_RECORD_OUTPUT_CHECKED_RELATIONS,
  SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_RECORD_OUTPUT_RELATION_COLUMNS,
  SLO_RECORD_OUTPUT_TEMPLATE_COLUMNS,
  SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH,
  SloRecordOutputTemplateColumn,
} from "../../Utils/Slo/SloRecordOutputColumns";
import SloRecordSourceSettings from "../Utils/Slo/SloRecordSourceSettings";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import { Gray500, Green500, Red500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import {
  SLO_BURN_RATE_RULE_FEED_COLUMNS,
  SloFeedColumn,
  SloFeedColumnChange,
  SloFeedMarkdown,
  SloFeedRow,
  getBurnRateRuleAddedFeedMarkdown,
  getBurnRateRuleChangedFeedMarkdown,
  getBurnRateRuleRemovedFeedMarkdown,
  getSloFeedColumnChanges,
  getSloFeedColumnsInPayload,
  getSloFeedSelect,
} from "../../Utils/Slo/SloFeedMarkdown";
import SloFeedUtil from "../Utils/Slo/SloFeedUtil";
import SloRecordReferenceValidator from "../Utils/Slo/SloRecordReferenceValidator";

/*
 * What the SLO feed carries from onBeforeUpdate to onUpdateSuccess for a
 * hand-made rule edit: the watched columns it writes, and each rule as it was.
 */
interface BurnRateRuleFeedSnapshot {
  columns: Array<SloFeedColumn>;
  rowsById: Dictionary<Model>;
}

const THRESHOLD_ERROR_MESSAGE: string =
  "Burn rate threshold must be greater than 0.";
const WINDOWS_REQUIRED_ERROR_MESSAGE: string =
  "Long window and short window are required for a burn rate rule.";
const WINDOWS_NOT_NUMERIC_ERROR_MESSAGE: string =
  "Long window and short window must be a number of minutes.";
export const NO_OUTPUT_ERROR_MESSAGE: string =
  "A burn rate rule must create an alert, declare an incident, or both.";

// An SLO the caller may not read is not found either, so it says nothing about itself.
export const SLO_NOT_FOUND_MESSAGE: string =
  "Service Level Objective not found.";

/*
 * The lock "Add recommended rules" holds per SLO, and how long a second
 * request waits for it: adding three rules takes well under a second.
 */
const RECOMMENDED_RULES_LOCK_NAMESPACE: string =
  "ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules";
const RECOMMENDED_RULES_LOCK_TIMEOUT_MS: number = 30000;

// A recommended rule an SLO is missing, and the severity it would raise at.
export interface SloMissingRecommendedRule {
  recommended: SloRecommendedBurnRateRule;
  // Null when the project has no alert severity to pick.
  alertSeverity: AlertSeverity | null;
}

export interface SloMissingRecommendedRules {
  serviceLevelObjectiveId: ObjectID;
  projectId: ObjectID;
  rules: Array<SloMissingRecommendedRule>;
}

export interface SloAddedRecommendedRule extends SloMissingRecommendedRule {
  ruleId: ObjectID | null;
}

export interface SloAddedRecommendedRules {
  serviceLevelObjectiveId: ObjectID;
  rules: Array<SloAddedRecommendedRule>;
}

/*
 * Mirrors the column defaults on the model. Every rule that predates incident
 * support raised an alert and declared nothing, so that is what an unset
 * payload still means.
 */
const DEFAULT_SHOULD_CREATE_ALERT: boolean = true;
const DEFAULT_SHOULD_CREATE_INCIDENT: boolean = false;

/*
 * The alert and incident options, defaulted exactly like their columns. A
 * payload that never mentions them - every seeded rule, every rule an older API
 * client creates - therefore raises what burn rate rules always raised: a
 * record everyone in the project can see, resolved automatically when the burn
 * recovers, with no owners added. Exported so the tests can pin these against
 * the model's own column metadata instead of a second copy of the literals.
 */
export const BURN_RATE_RULE_OPTION_FLAG_DEFAULTS: {
  isAlertPrivate: boolean;
  autoResolveAlert: boolean;
  isIncidentPrivate: boolean;
  autoResolveIncident: boolean;
  addSloOwnersAsOwners: boolean;
} = {
  isAlertPrivate: false,
  autoResolveAlert: true,
  isIncidentPrivate: false,
  autoResolveIncident: true,
  addSloOwnersAsOwners: false,
};

/*
 * Template columns and their limits. They are SloRecordSourceService's, which
 * a policy tier shares; the names are kept for the readers that import them
 * from here.
 */
export const BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH: number =
  SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH;

export const BURN_RATE_RULE_TITLE_TEMPLATE_MAX_LENGTH: number =
  SLO_RECORD_OUTPUT_TITLE_TEMPLATE_MAX_LENGTH;

export const BURN_RATE_RULE_TEMPLATE_COLUMNS: Array<{
  column: SloRecordOutputTemplateColumn;
  title: string;
  maxLength: number;
}> = SLO_RECORD_OUTPUT_TEMPLATE_COLUMNS;

// SloRecordSourceService.getOwnerUsersNotInProjectErrorPrefix, for a rule.
export const OWNER_USERS_NOT_IN_PROJECT_ERROR_PREFIX: string =
  "This SLO burn rate rule names owner users who are not members of this project:";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The SLO the rule belongs to, the severities, the on-call policies, the
   * labels and the owners the rule copies onto what it opens are checked by
   * SloRecordSourceService's hooks, which a policy tier shares, with their
   * own words - the SLO first, on create and on update (a workflow can move a
   * rule; a person cannot).
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return [...SLO_RECORD_OUTPUT_CHECKED_RELATIONS];
  }

  protected override getListsCheckedByService(): Array<string> {
    return [...SLO_RECORD_OUTPUT_RELATION_COLUMNS];
  }

  // Built on first use: see SloRecordSourceSettings on the import loop.
  private recordSettings: SloRecordSourceSettings<Model> | null = null;

  private getRecordSettings(): SloRecordSourceSettings<Model> {
    if (!this.recordSettings) {
      this.recordSettings = new SloRecordSourceSettings<Model>({
        service: this,
        subject: "SLO burn rate rule",
        optionFlagDefaults: BURN_RATE_RULE_OPTION_FLAG_DEFAULTS,
      });
    }

    return this.recordSettings;
  }

  /*
   * Deterministic fingerprint carried on everything a burn rate rule
   * declares — the Alert it raises, the Incident it declares, or both. The
   * evaluation worker sets it as `seriesFingerprint` when the rule fires, and
   * lifecycle hooks use it to find (and resolve) those records when the rule
   * or its SLO goes away.
   *
   * One fingerprint serves both because Alert and Incident are separate
   * tables: a rule can have at most one open Alert and one open Incident, and
   * each dedupe query is already scoped to its own table.
   */
  public getBurnRateFingerprint(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
  }): string {
    return `slo:${data.serviceLevelObjectiveId.toString()}:burn-rule:${data.burnRateRuleId.toString()}`;
  }

  /*
   * The project's most and least severe alert severities, for the rules
   * OneUptime adds itself: Fast burn and Slow burn raise at the most severe,
   * Slow leak - a ticket, not a page - at the least severe
   * (pickSloRecommendedAlertSeverities says how each is chosen).
   *
   * One read for every rule: projects keep a handful of severities. Archived
   * ones are left out - a default OneUptime picks itself is never archived.
   * A failed read throws, and each caller decides what that costs: seeding a
   * new SLO's rules goes on without severities rather than without rules, and
   * "Add recommended rules" refuses, so a ticket rule is never added without
   * the severity that keeps it from paging.
   */
  @CaptureSpan()
  public async getRecommendedRuleAlertSeverities(
    projectId: ObjectID,
  ): Promise<SloRecommendedAlertSeverities<AlertSeverity>> {
    const severities: Array<AlertSeverity> = await AlertSeverityService.findBy({
      query: {
        projectId: projectId,
        isArchived: false,
      },
      select: {
        _id: true,
        name: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return pickSloRecommendedAlertSeverities<AlertSeverity>(severities);
  }

  /*
   * A recommended rule (SloRecommendedBurnRateRules) as the row OneUptime
   * creates for it. Only what the recommendation says is set: the output
   * flags and every alert and incident option keep their column defaults, so
   * the rule raises an alert, declares no incident, and says what a hand-made
   * rule with no options says.
   */
  public buildRecommendedRule(data: {
    projectId: ObjectID;
    serviceLevelObjectiveId: ObjectID;
    recommended: SloRecommendedBurnRateRule;
    alertSeverityId?: ObjectID | undefined;
  }): Model {
    const rule: Model = new Model();
    rule.projectId = data.projectId;
    rule.serviceLevelObjectiveId = data.serviceLevelObjectiveId;
    rule.name = data.recommended.name;
    rule.isEnabled = true;
    rule.burnRateThreshold = data.recommended.burnRateThreshold;
    rule.longWindowInMinutes = data.recommended.longWindowInMinutes;
    rule.shortWindowInMinutes = data.recommended.shortWindowInMinutes;

    if (data.recommended.refireSuppressionMinutes !== null) {
      rule.refireSuppressionMinutes = data.recommended.refireSuppressionMinutes;
    }

    if (data.alertSeverityId) {
      rule.alertSeverityId = data.alertSeverityId;
    }

    return rule;
  }

  /*
   * The recommended rules an SLO is missing, scaled to its window, each with
   * the severity it would raise at: what "Add recommended rules" asks about.
   *
   * The SLO is read as the caller, so an SLO they may not read - or another
   * project's - is not found, and says nothing about itself. Its rules are
   * read as root, all of them: whether a recommended rule is missing has to
   * be answered from every rule the SLO has, not from the ones this caller
   * happens to be allowed to see, and the answer names only recommended
   * rules, never the SLO's own.
   */
  @CaptureSpan()
  public async getMissingRecommendedRules(data: {
    serviceLevelObjectiveId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SloMissingRecommendedRules> {
    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const slo: ServiceLevelObjective | null =
      await ServiceLevelObjectiveService.findOneBy({
        query: {
          _id: data.serviceLevelObjectiveId.toString(),
          projectId: projectId,
        },
        select: {
          _id: true,
          projectId: true,
          windowType: true,
          windowDays: true,
        },
        props: data.props,
      });

    if (!slo || !slo.id) {
      throw new NotFoundException(SLO_NOT_FOUND_MESSAGE);
    }

    const existingRules: Array<Model> = await this.findBy({
      query: {
        serviceLevelObjectiveId: slo.id,
        projectId: projectId,
      },
      select: {
        _id: true,
        name: true,
        longWindowInMinutes: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const missing: Array<SloRecommendedBurnRateRule> =
      getMissingSloRecommendedBurnRateRules({
        window: {
          windowType: slo.windowType,
          windowDays: slo.windowDays,
        },
        existingRules: existingRules,
      });

    // Nothing to add asks for no severities.
    if (missing.length === 0) {
      return {
        serviceLevelObjectiveId: slo.id,
        projectId: projectId,
        rules: [],
      };
    }

    const severities: SloRecommendedAlertSeverities<AlertSeverity> =
      await this.getRecommendedRuleAlertSeverities(projectId);

    return {
      serviceLevelObjectiveId: slo.id,
      projectId: projectId,
      rules: missing.map(
        (
          recommended: SloRecommendedBurnRateRule,
        ): SloMissingRecommendedRule => {
          return {
            recommended: recommended,
            alertSeverity:
              recommended.alertSeverity ===
              SloRecommendedAlertSeverity.LeastSevere
                ? severities.leastSevere
                : severities.mostSevere,
          };
        },
      ),
    };
  }

  /*
   * "Add recommended rules": creates the recommended rules the SLO is
   * missing, and only those, as the caller.
   *
   * Each rule is created exactly as one made by hand on the Burn Rate Rules
   * page: through create() with the caller's props, so the same permission
   * checks refuse what the caller may not create, the same hooks validate it,
   * the SLO feed gets its "rule added" item, and the audit log records the
   * caller creating it.
   *
   * Idempotent: what is missing is worked out again inside a lock held per
   * SLO, so a second request - a double click, a second tab, a retry -
   * waits for the first and then finds nothing left to add. Without the lock
   * (Redis unreachable) the request still runs; only two arriving at the same
   * moment could then both add the same rule. Rules are created one at a
   * time, and the first that fails stops the request: the ones already added
   * stay, and asking again adds only what is still missing.
   */
  @CaptureSpan()
  public async addMissingRecommendedRules(data: {
    serviceLevelObjectiveId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SloAddedRecommendedRules> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.serviceLevelObjectiveId.toString(),
        namespace: RECOMMENDED_RULES_LOCK_NAMESPACE,
        lockTimeout: RECOMMENDED_RULES_LOCK_TIMEOUT_MS,
        acquireTimeout: RECOMMENDED_RULES_LOCK_TIMEOUT_MS,
      });
    } catch (err) {
      logger.error(
        `Could not take the lock for adding the recommended burn rate rules of SLO ${data.serviceLevelObjectiveId.toString()}; adding them without it: ${err}`,
        { projectId: data.props.tenantId?.toString() } as LogAttributes,
      );
    }

    try {
      const missing: SloMissingRecommendedRules =
        await this.getMissingRecommendedRules(data);

      const added: Array<SloAddedRecommendedRule> = [];

      for (const rule of missing.rules) {
        const created: Model = await this.create({
          data: this.buildRecommendedRule({
            projectId: missing.projectId,
            serviceLevelObjectiveId: missing.serviceLevelObjectiveId,
            recommended: rule.recommended,
            alertSeverityId: rule.alertSeverity?.id || undefined,
          }),
          props: data.props,
        });

        added.push({
          ...rule,
          ruleId: created.id || null,
        });
      }

      return {
        serviceLevelObjectiveId: missing.serviceLevelObjectiveId,
        rules: added,
      };
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          // It runs out on its own timeout.
          logger.error(
            `Could not release the lock for adding the recommended burn rate rules of SLO ${data.serviceLevelObjectiveId.toString()}: ${err}`,
            { projectId: data.props.tenantId?.toString() } as LogAttributes,
          );
        }
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * Every numeric column can arrive as a string: the dashboard's number
     * fields hand Formik `e.target.value`, ModelForm copies it verbatim and
     * BaseModel.fromJSON does not coerce Number/Decimal columns. Comparing
     * those strings is lexicographic ("1440" <= "60" is true), so coerce
     * first, then validate, then write the number back onto the payload so
     * Postgres never sees a string either.
     */
    createBy.data.burnRateThreshold = this.validateBurnRateThreshold(
      createBy.data.burnRateThreshold,
    );

    if (
      createBy.data.longWindowInMinutes === undefined ||
      createBy.data.longWindowInMinutes === null ||
      createBy.data.shortWindowInMinutes === undefined ||
      createBy.data.shortWindowInMinutes === null
    ) {
      throw new BadDataException(WINDOWS_REQUIRED_ERROR_MESSAGE);
    }

    const windows: {
      longWindowInMinutes: number;
      shortWindowInMinutes: number;
    } = this.validateWindows({
      longWindowInMinutes: createBy.data.longWindowInMinutes,
      shortWindowInMinutes: createBy.data.shortWindowInMinutes,
    });

    createBy.data.longWindowInMinutes = windows.longWindowInMinutes;
    createBy.data.shortWindowInMinutes = windows.shortWindowInMinutes;

    if (
      createBy.data.minimumSampleCount !== undefined &&
      createBy.data.minimumSampleCount !== null
    ) {
      createBy.data.minimumSampleCount = this.validateMinimumSampleCount(
        createBy.data.minimumSampleCount,
      );
    }

    if (
      createBy.data.refireSuppressionMinutes !== undefined &&
      createBy.data.refireSuppressionMinutes !== null
    ) {
      createBy.data.refireSuppressionMinutes =
        this.validateRefireSuppressionMinutes(
          createBy.data.refireSuppressionMinutes,
        );
    }

    /*
     * What the rule declares. Both are written back explicitly — leaving them
     * off would let Postgres apply the column default, which is right for a
     * fresh create but hides the decision from the row that the update hook
     * later reads back.
     */
    const shouldCreateAlert: boolean =
      this.getRecordSettings().normalizeBooleanInput(
        createBy.data.shouldCreateAlert,
        DEFAULT_SHOULD_CREATE_ALERT,
      );
    const shouldCreateIncident: boolean =
      this.getRecordSettings().normalizeBooleanInput(
        createBy.data.shouldCreateIncident,
        DEFAULT_SHOULD_CREATE_INCIDENT,
      );

    if (!shouldCreateAlert && !shouldCreateIncident) {
      throw new BadDataException(NO_OUTPUT_ERROR_MESSAGE);
    }

    createBy.data.shouldCreateAlert = shouldCreateAlert;
    createBy.data.shouldCreateIncident = shouldCreateIncident;

    /*
     * The alert and incident options, written back explicitly for the same
     * reason as the two output flags: the worker reads autoResolve with
     * `!== false` and the private flags with `=== true`, so each holds a
     * real boolean - the one written, or its default.
     */
    this.getRecordSettings().normalizeOptionFlags(
      createBy.data as unknown as Dictionary<unknown>,
      {
        applyDefaults: true,
      },
    );

    this.getRecordSettings().normalizeTemplates(
      createBy.data as unknown as Dictionary<unknown>,
    );

    /*
     * Tenant first, for every reference check below, like the other SLO child
     * rows: DatabaseService stamps the tenant onto the payload before this
     * hook, but the tenancy checks must not depend on that ordering - a
     * payload projectId must never pick the project a severity, routing
     * target or owner is checked against.
     */
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    /*
     * The SLO first. Nothing else checks that it belongs to the rule's
     * project, and a rule hung off another tenant's SLO is wrong in every
     * direction: it can never fire (the worker reads rules pinned to the SLO's
     * project), its feed items are written against that SLO's id, and that
     * project deleting its SLO cascades into this project's rule.
     * serviceLevelObjectiveId is create-only (update is [] in its column ACL),
     * so create is the one write to check. The lookup is pinned to this
     * project and a foreign id gets the same answer as a missing one, so the
     * error never confirms or names another tenant's SLO. Both spellings are
     * checked: the id column and the relation write the same join column.
     */
    await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
      {
        projectId: projectId,
        serviceLevelObjectives: [
          createBy.data.serviceLevelObjectiveId,
          createBy.data.serviceLevelObjective,
        ],
        subject: "SLO burn rate rule",
      },
    );

    await this.getRecordSettings().validateSeverityReferences({
      projectId: projectId,
      ...this.getRecordSettings().readSeverityIds(
        createBy.data as unknown as Dictionary<unknown>,
      ),
    });

    await this.getRecordSettings().validateRoutingReferences({
      projectId: projectId,
      payload: createBy.data as unknown as Dictionary<unknown>,
      storedIds: undefined,
    });

    return {
      createBy,
      carryForward: null,
    };
  }

  /*
   * BurnRateRuleAdded on the SLO feed. Skipped for the rules OneUptime
   * seeds while creating an SLO: the SLO's own "created" item already
   * describes them (SloFeedUtil.runWhileSeedingDefaultBurnRateRules explains
   * how they are told apart). Fire-and-forget - the rule exists whether or not
   * its feed item does.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (
      createdItem.serviceLevelObjectiveId &&
      !SloFeedUtil.isSeedingDefaultBurnRateRules(
        createdItem.serviceLevelObjectiveId,
      )
    ) {
      const createdAt: Date =
        createdItem.createdAt || OneUptimeDate.getCurrentDate();

      this.writeBurnRateRuleAddedFeed({
        onCreate: onCreate,
        createdItem: createdItem,
        postedAt: createdAt,
      }).catch((err: Error) => {
        logger.error(
          `Error writing the feed item for added SLO burn rate rule ${createdItem.id?.toString()}: ${err}`,
          { projectId: createdItem.projectId?.toString() } as LogAttributes,
        );
      });
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    // Same string-arrival path as onBeforeCreate: coerce, validate, write back.
    const newThreshold: unknown = updateBy.data.burnRateThreshold as unknown;

    if (newThreshold !== undefined && newThreshold !== null) {
      updateBy.data.burnRateThreshold =
        this.validateBurnRateThreshold(newThreshold);
    }

    if (
      updateBy.data.minimumSampleCount !== undefined &&
      updateBy.data.minimumSampleCount !== null
    ) {
      updateBy.data.minimumSampleCount = this.validateMinimumSampleCount(
        updateBy.data.minimumSampleCount as unknown,
      );
    }

    if (
      updateBy.data.refireSuppressionMinutes !== undefined &&
      updateBy.data.refireSuppressionMinutes !== null
    ) {
      updateBy.data.refireSuppressionMinutes =
        this.validateRefireSuppressionMinutes(
          updateBy.data.refireSuppressionMinutes as unknown,
        );
    }

    await this.validateOutputsOnUpdate(updateBy);

    await this.getRecordSettings().validateServiceLevelObjectiveOnUpdate(
      updateBy,
    );

    await this.getRecordSettings().validateSeverityReferencesOnUpdate(updateBy);

    /*
     * Only the options this update actually carries are coerced - an absent
     * flag must stay absent, or a form that saves just the name would reset
     * every other option to its default.
     */
    this.getRecordSettings().normalizeOptionFlags(
      updateBy.data as unknown as Dictionary<unknown>,
      {
        applyDefaults: false,
      },
    );

    this.getRecordSettings().normalizeTemplates(
      updateBy.data as unknown as Dictionary<unknown>,
    );

    await this.getRecordSettings().validateRoutingReferencesOnUpdate(updateBy);

    const newLongWindow: unknown = updateBy.data.longWindowInMinutes as unknown;
    const newShortWindow: unknown = updateBy.data
      .shortWindowInMinutes as unknown;

    const isLongWindowUpdated: boolean =
      newLongWindow !== undefined && newLongWindow !== null;
    const isShortWindowUpdated: boolean =
      newShortWindow !== undefined && newShortWindow !== null;

    if (isLongWindowUpdated || isShortWindowUpdated) {
      if (isLongWindowUpdated && isShortWindowUpdated) {
        const windows: {
          longWindowInMinutes: number;
          shortWindowInMinutes: number;
        } = this.validateWindows({
          longWindowInMinutes: newLongWindow,
          shortWindowInMinutes: newShortWindow,
        });

        updateBy.data.longWindowInMinutes = windows.longWindowInMinutes;
        updateBy.data.shortWindowInMinutes = windows.shortWindowInMinutes;
      } else {
        /*
         * Only one of the two windows is being updated. Coerce it up front so
         * a non-numeric value is rejected even when the query matches no rows,
         * then load the affected rules so the updated value can be validated
         * against the value that will remain on each row.
         */
        const normalizedNewWindow: number =
          this.getRecordSettings().normalizeNumericInput(
            isLongWindowUpdated ? newLongWindow : newShortWindow,
          );

        if (!Number.isFinite(normalizedNewWindow)) {
          throw new BadDataException(WINDOWS_NOT_NUMERIC_ERROR_MESSAGE);
        }

        const rulesToUpdate: Array<Model> =
          await this.findRowsAndHoldUpdateToThem(updateBy, {
            _id: true,
            longWindowInMinutes: true,
            shortWindowInMinutes: true,
          });

        for (const rule of rulesToUpdate) {
          /*
           * The persisted sibling is coerced too — rows written before numeric
           * coercion existed can still hold a string in a Decimal/Number
           * column, and validateWindows must not compare against it as text.
           */
          this.validateWindows({
            longWindowInMinutes: isLongWindowUpdated
              ? normalizedNewWindow
              : rule.longWindowInMinutes,
            shortWindowInMinutes: isShortWindowUpdated
              ? normalizedNewWindow
              : rule.shortWindowInMinutes,
          });
        }

        if (isLongWindowUpdated) {
          updateBy.data.longWindowInMinutes = normalizedNewWindow;
        } else {
          updateBy.data.shortWindowInMinutes = normalizedNewWindow;
        }
      }
    }

    /*
     * Last, so a payload the checks above rejected never costs the feed a
     * read. Null unless this is a hand-made edit of a watched column.
     */
    const feedSnapshot: BurnRateRuleFeedSnapshot | null =
      await this.readFeedSnapshotBeforeUpdate(updateBy);

    return {
      updateBy,
      carryForward: {
        feedSnapshot: feedSnapshot,
      },
    };
  }

  /*
   * READ ONLY: notes down the rules this delete may remove. onDeleteSuccess
   * needs each one's SLO, project and name - to resolve what the rule left
   * open and to describe it on the SLO feed - and the row is gone by then.
   *
   * Nothing is resolved here. DatabaseService runs this hook BEFORE it applies
   * the caller's delete permissions, and the CRUD API passes a raw id, so these
   * rows are only candidates. Resolving here as root let a delete that named
   * another project's rule close that project's burn rate alerts and incidents
   * while deleting nothing. onDeleteSuccess acts only on the ids the delete
   * really removed, and the tenant pin keeps this read from even seeing
   * another project's rules. A multi-tenant request is left unpinned because
   * DatabaseService does not pin it either.
   *
   * The widest page rather than the caller's limit and skip: the
   * permission-checked query can page a narrower set differently, and a rule
   * the delete removed that this read missed would keep its records open.
   *
   * A failed read is deliberately not caught: the evaluation worker only
   * resolves records for rules that still exist, so deleting a rule without
   * knowing what it opened would strand those records, and their on-call
   * escalations, forever.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The rules the delete removes, and the delete held to them.
    const itemsToDelete: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        serviceLevelObjectiveId: true,
        // What the SLO feed's "rule removed" item says - the row is gone after.
        name: true,
        burnRateThreshold: true,
        longWindowInMinutes: true,
        shortWindowInMinutes: true,
      },
    );

    return {
      deleteBy,
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
    };
  }

  /*
   * What the rules this delete really removed leave behind: every alert and
   * incident they opened is resolved, and the SLO feed gets a
   * BurnRateRuleRemoved item built from the rows onBeforeDelete read.
   *
   * Only rows whose ids DatabaseService reports as deleted are acted on
   * (SloFeedUtil.getRowsActuallyDeleted): onBeforeDelete read candidates
   * before permissions were applied, and a delete naming another project's
   * rule removes nothing, so it must resolve and describe nothing either.
   *
   * Resolving after the delete is safe: open records are found by fingerprint
   * in the Alert and Incident tables, which do not need the rule row. It is
   * also the honest order - a delete that fails leaves the rule and its
   * records exactly as they were - and the worker cannot re-fire a rule that
   * no longer exists in between.
   *
   * (Deleting the SLO itself cascades its rules in Postgres without this hook;
   * ServiceLevelObjectiveService.onDeleteSuccess resolves those, and the SLO's
   * feed goes with it, so there is nothing to describe.)
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    // Taken first, so the feed item's time is the delete's, not the resolve's.
    const deletedAt: Date = OneUptimeDate.getCurrentDate();

    const itemsToDelete: Array<Model> = SloFeedUtil.getRowsActuallyDeleted({
      rows:
        (onDelete.carryForward?.itemsToDelete as Array<Model> | undefined) ||
        [],
      deletedIds: itemIdsBeforeDelete,
    });

    for (const item of itemsToDelete) {
      if (!item.id || !item.projectId || !item.serviceLevelObjectiveId) {
        continue;
      }

      try {
        await this.resolveOpenAlertsAndIncidentsForRule({
          serviceLevelObjectiveId: item.serviceLevelObjectiveId,
          burnRateRuleId: item.id,
          projectId: item.projectId,
          rootCause:
            "Auto-resolved because the SLO burn rate rule that created it was deleted.",
        });
      } catch (err) {
        /*
         * Never fail the request - the rule is already gone - and never let
         * one rule's failure cost the next rule its resolve.
         */
        logger.error(
          `Error resolving open alerts and incidents for deleted SLO burn rate rule ${item.id.toString()}: ${err}`,
          { projectId: item.projectId.toString() } as LogAttributes,
        );
      }
    }

    // Fire-and-forget like the other rule items.
    if (itemsToDelete.length > 0) {
      this.writeBurnRateRuleRemovedFeed({
        onDelete: onDelete,
        itemsToDelete: itemsToDelete,
        postedAt: deletedAt,
      }).catch((err: Error) => {
        logger.error(
          `Error writing the feed items for removed SLO burn rate rules: ${err}`,
        );
      });
    }

    return onDelete;
  }

  private async writeBurnRateRuleAddedFeed(data: {
    onCreate: OnCreate<Model>;
    createdItem: Model;
    postedAt: Date;
  }): Promise<void> {
    const serviceLevelObjectiveId: ObjectID | undefined =
      data.createdItem.serviceLevelObjectiveId;
    const projectId: ObjectID | undefined = data.createdItem.projectId;

    if (!serviceLevelObjectiveId || !projectId) {
      return;
    }

    const markdown: SloFeedMarkdown = getBurnRateRuleAddedFeedMarkdown({
      sloMarkdownLink: await ServiceLevelObjectiveService.getSloMarkdownLink({
        projectId: projectId,
        sloId: serviceLevelObjectiveId,
      }),
      rule: data.createdItem,
    });

    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: serviceLevelObjectiveId,
      projectId: projectId,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.BurnRateRuleAdded,
      displayColor: Gray500,
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: markdown.moreInformationInMarkdown,
      userId:
        data.createdItem.createdByUserId ||
        data.onCreate.createBy.props.userId ||
        undefined,
      postedAt: data.postedAt,
    });
  }

  /*
   * The before-half of BurnRateRuleChanged: the watched columns a hand-made
   * edit writes, and each rule as it was before it.
   *
   * Only a non-root write takes a snapshot, and only a write with a snapshot
   * posts. Root writes to a rule are OneUptime's own code paths - the
   * evaluation worker stamping lifecycle columns, the SLO seeding its default
   * rules - so the rule feed describes what people change through the
   * dashboard and the API, and describes it properly: "old -> new", with the
   * untouched fields of a re-submitted form left out. The column check comes
   * before any read, and a failed read never blocks the update.
   */
  private async readFeedSnapshotBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<BurnRateRuleFeedSnapshot | null> {
    if (updateBy.props.isRoot) {
      return null;
    }

    const columns: Array<SloFeedColumn> = getSloFeedColumnsInPayload(
      updateBy.data,
      SLO_BURN_RATE_RULE_FEED_COLUMNS,
    );

    if (columns.length === 0) {
      return null;
    }

    try {
      const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        this.getFeedSelect(columns),
      );

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
        `Error reading SLO burn rate rules before an update for the SLO feed: ${err}`,
      );
      return null;
    }
  }

  private getFeedSelect(columns: Array<SloFeedColumn>): Select<Model> {
    return {
      _id: true,
      projectId: true,
      serviceLevelObjectiveId: true,
      name: true,
      ...getSloFeedSelect(columns),
    } as Select<Model>;
  }

  private async writeBurnRateRuleChangedFeed(data: {
    onUpdate: OnUpdate<Model>;
    updatedItemIds: Array<ObjectID>;
    postedAt: Date;
  }): Promise<void> {
    const snapshot: BurnRateRuleFeedSnapshot | null =
      (data.onUpdate.carryForward?.feedSnapshot as
        | BurnRateRuleFeedSnapshot
        | null
        | undefined) || null;

    if (
      !snapshot ||
      snapshot.columns.length === 0 ||
      data.updatedItemIds.length === 0
    ) {
      return;
    }

    const userId: ObjectID | undefined =
      data.onUpdate.updateBy.props.userId || undefined;

    for (const ruleId of data.updatedItemIds) {
      const before: Model | undefined = snapshot.rowsById[ruleId.toString()];

      if (!before) {
        continue;
      }

      try {
        const after: Model | null = await this.findOneById({
          id: ruleId,
          select: this.getFeedSelect(snapshot.columns),
          props: {
            isRoot: true,
          },
        });

        if (!after || !after.projectId || !after.serviceLevelObjectiveId) {
          continue;
        }

        const changes: Array<SloFeedColumnChange> = getSloFeedColumnChanges({
          columns: snapshot.columns,
          before: before as unknown as SloFeedRow,
          after: after as unknown as SloFeedRow,
        });

        // A form re-submitted without a real change describes nothing.
        if (changes.length === 0) {
          continue;
        }

        const markdown: SloFeedMarkdown = getBurnRateRuleChangedFeedMarkdown({
          sloMarkdownLink:
            await ServiceLevelObjectiveService.getSloMarkdownLink({
              projectId: after.projectId,
              sloId: after.serviceLevelObjectiveId,
            }),
          ruleName: after.name || before.name,
          changes: changes,
        });

        const isEnabledOnlyChange: boolean =
          changes.length === 1 && changes[0]!.column === "isEnabled";

        await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
          {
            serviceLevelObjectiveId: after.serviceLevelObjectiveId,
            projectId: after.projectId,
            serviceLevelObjectiveFeedEventType:
              ServiceLevelObjectiveFeedEventType.BurnRateRuleChanged,
            displayColor:
              isEnabledOnlyChange && changes[0]!.to.toString() === "On"
                ? Green500
                : Gray500,
            feedInfoInMarkdown: markdown.feedInfoInMarkdown,
            moreInformationInMarkdown: markdown.moreInformationInMarkdown,
            userId: userId,
            postedAt: data.postedAt,
          },
        );
      } catch (err) {
        logger.error(
          `Error writing the feed item for changed SLO burn rate rule ${ruleId.toString()}: ${err}`,
          { projectId: before.projectId?.toString() } as LogAttributes,
        );
      }
    }
  }

  private async writeBurnRateRuleRemovedFeed(data: {
    onDelete: OnDelete<Model>;
    itemsToDelete: Array<Model>;
    postedAt: Date;
  }): Promise<void> {
    const deletedByUserId: ObjectID | undefined =
      data.onDelete.deleteBy.deletedByUser?.id ||
      data.onDelete.deleteBy.props.userId ||
      undefined;

    for (const rule of data.itemsToDelete) {
      const serviceLevelObjectiveId: ObjectID | undefined =
        rule.serviceLevelObjectiveId;
      const projectId: ObjectID | undefined = rule.projectId;

      if (!serviceLevelObjectiveId || !projectId) {
        continue;
      }

      try {
        const markdown: SloFeedMarkdown = getBurnRateRuleRemovedFeedMarkdown({
          sloMarkdownLink:
            await ServiceLevelObjectiveService.getSloMarkdownLink({
              projectId: projectId,
              sloId: serviceLevelObjectiveId,
            }),
          rule: rule,
        });

        await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
          {
            serviceLevelObjectiveId: serviceLevelObjectiveId,
            projectId: projectId,
            serviceLevelObjectiveFeedEventType:
              ServiceLevelObjectiveFeedEventType.BurnRateRuleRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: markdown.feedInfoInMarkdown,
            moreInformationInMarkdown: markdown.moreInformationInMarkdown,
            userId: deletedByUserId,
            postedAt: data.postedAt,
          },
        );
      } catch (err) {
        logger.error(
          `Error writing the feed item for removed SLO burn rate rule ${rule.id?.toString()}: ${err}`,
          { projectId: projectId.toString() } as LogAttributes,
        );
      }
    }
  }

  /*
   * A rule stops declaring something — it is disabled, or one of its two
   * outputs is switched off — and whatever it already has open is now an
   * orphan. The evaluation worker cannot clean it up: it only loads rules
   * where `isEnabled` is true, and for an enabled rule it only resolves the
   * output it is still allowed to create. So the alert (or incident) and its
   * on-call escalation would page someone about a rule that can no longer
   * justify the page.
   *
   * Runs after the write commits, so an update that was rejected leaves the
   * open records exactly where they were.
   *
   * Switching autoResolveAlert or autoResolveIncident OFF is deliberately not
   * a trigger. Those switches only decide what the worker does when the burn
   * recovers; a rule with auto-resolve off still stands behind what it has
   * open, so nothing is resolved and nothing is forgotten. The reverse is also
   * true: disabling the rule or switching an output off resolves regardless of
   * the auto-resolve switches, because then the rule cannot justify the record
   * at all - the same stance the SLO-level resolves take.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * BurnRateRuleChanged on the SLO feed - fire-and-forget, and only when
     * onBeforeUpdate took a snapshot (a hand-made edit of a watched column), so
     * the worker's lifecycle stamps do no feed work at all.
     */
    if (onUpdate.carryForward?.feedSnapshot) {
      const updatedAt: Date = OneUptimeDate.getCurrentDate();

      this.writeBurnRateRuleChangedFeed({
        onUpdate: onUpdate,
        updatedItemIds: updatedItemIds,
        postedAt: updatedAt,
      }).catch((err: Error) => {
        logger.error(
          `Error writing SLO feed items after a burn rate rule update: ${err}`,
        );
      });
    }

    /*
     * These three reads are strict `=== false`, and that is sound: DatabaseService
     * turns every Boolean column of a write into the boolean the database
     * stores before any hook runs (Types/Database/BooleanColumnValue), so a
     * `"false"` a form or a raw API call sends - for the output flags and for
     * isEnabled alike - is false by the time it reaches here, and a value the
     * database would refuse never gets this far.
     */
    const isRuleDisabled: boolean =
      (onUpdate.updateBy.data.isEnabled as boolean | undefined) === false;
    const areAlertsTurnedOff: boolean =
      (onUpdate.updateBy.data.shouldCreateAlert as boolean | undefined) ===
      false;
    const areIncidentsTurnedOff: boolean =
      (onUpdate.updateBy.data.shouldCreateIncident as boolean | undefined) ===
      false;

    if (!isRuleDisabled && !areAlertsTurnedOff && !areIncidentsTurnedOff) {
      return onUpdate;
    }

    for (const updatedItemId of updatedItemIds) {
      try {
        const rule: Model | null = await this.findOneById({
          id: updatedItemId,
          select: {
            _id: true,
            projectId: true,
            serviceLevelObjectiveId: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!rule || !rule.projectId || !rule.serviceLevelObjectiveId) {
          continue;
        }

        /*
         * The two outputs get their own try: they are independent lifecycles,
         * and an alert that fails to resolve must not take the incident's
         * resolve down with it — that is exactly how a live incident ends up
         * escalating for a rule that no longer declares incidents.
         */
        let clearAlert: boolean = false;
        let clearIncident: boolean = false;

        if (isRuleDisabled || areAlertsTurnedOff) {
          try {
            await this.resolveOpenAlertsForRule({
              serviceLevelObjectiveId: rule.serviceLevelObjectiveId,
              burnRateRuleId: updatedItemId,
              projectId: rule.projectId,
              rootCause: isRuleDisabled
                ? "Alert auto-resolved because the SLO burn rate rule that created it was disabled."
                : "Alert auto-resolved because the SLO burn rate rule that created it no longer raises alerts.",
            });
            clearAlert = true;
          } catch (err) {
            logger.error(
              `Error resolving open alerts for SLO burn rate rule ${updatedItemId.toString()} after update: ${err}`,
            );
          }
        }

        if (isRuleDisabled || areIncidentsTurnedOff) {
          try {
            await this.resolveOpenIncidentsForRule({
              serviceLevelObjectiveId: rule.serviceLevelObjectiveId,
              burnRateRuleId: updatedItemId,
              projectId: rule.projectId,
              rootCause: isRuleDisabled
                ? "Incident auto-resolved because the SLO burn rate rule that declared it was disabled."
                : "Incident auto-resolved because the SLO burn rate rule that declared it no longer declares incidents.",
            });
            clearIncident = true;
          } catch (err) {
            logger.error(
              `Error resolving open incidents for SLO burn rate rule ${updatedItemId.toString()} after update: ${err}`,
            );
          }
        }

        /*
         * Only forget the outputs that actually closed. A side that threw
         * still has its record open, and clearing its column would tell the
         * worker to declare a second one on top.
         */
        await this.clearOpenOutputStateForRule({
          burnRateRuleId: updatedItemId,
          clearAlert: clearAlert,
          clearIncident: clearIncident,
        });
      } catch (err) {
        logger.error(
          `Error resolving open alerts and incidents for SLO burn rate rule ${updatedItemId.toString()} after update: ${err}`,
        );
      }
    }

    return onUpdate;
  }

  /*
   * "A rule must declare something", enforced against the row that will
   * EXIST after the update rather than against the payload alone.
   *
   * A form that only sends the field the user touched is the common case, so
   * turning alerts off on a rule that already declares incidents has to be
   * allowed while turning them off on a rule that declares nothing else must
   * not be. Same shape as the single-window update path below: coerce the
   * incoming value, then check it against each affected row's persisted
   * sibling.
   */
  private async validateOutputsOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const newShouldCreateAlert: unknown = updateBy.data
      .shouldCreateAlert as unknown;
    const newShouldCreateIncident: unknown = updateBy.data
      .shouldCreateIncident as unknown;

    const isShouldCreateAlertUpdated: boolean =
      newShouldCreateAlert !== undefined && newShouldCreateAlert !== null;
    const isShouldCreateIncidentUpdated: boolean =
      newShouldCreateIncident !== undefined && newShouldCreateIncident !== null;

    if (!isShouldCreateAlertUpdated && !isShouldCreateIncidentUpdated) {
      return;
    }

    if (isShouldCreateAlertUpdated) {
      updateBy.data.shouldCreateAlert =
        this.getRecordSettings().normalizeBooleanInput(
          newShouldCreateAlert,
          DEFAULT_SHOULD_CREATE_ALERT,
        );
    }

    if (isShouldCreateIncidentUpdated) {
      updateBy.data.shouldCreateIncident =
        this.getRecordSettings().normalizeBooleanInput(
          newShouldCreateIncident,
          DEFAULT_SHOULD_CREATE_INCIDENT,
        );
    }

    const updatedShouldCreateAlert: boolean = Boolean(
      updateBy.data.shouldCreateAlert,
    );
    const updatedShouldCreateIncident: boolean = Boolean(
      updateBy.data.shouldCreateIncident,
    );

    if (isShouldCreateAlertUpdated && isShouldCreateIncidentUpdated) {
      if (!updatedShouldCreateAlert && !updatedShouldCreateIncident) {
        throw new BadDataException(NO_OUTPUT_ERROR_MESSAGE);
      }

      return;
    }

    /*
     * Only one flag is being written. Switching one ON can never leave a rule
     * with nothing, so there is nothing to read back for it.
     */
    if (
      (isShouldCreateAlertUpdated && updatedShouldCreateAlert) ||
      (isShouldCreateIncidentUpdated && updatedShouldCreateIncident)
    ) {
      return;
    }

    const rulesToUpdate: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        shouldCreateAlert: true,
        shouldCreateIncident: true,
      },
    );

    for (const rule of rulesToUpdate) {
      const resultingShouldCreateAlert: boolean = isShouldCreateAlertUpdated
        ? updatedShouldCreateAlert
        : this.getRecordSettings().normalizeBooleanInput(
            rule.shouldCreateAlert,
            DEFAULT_SHOULD_CREATE_ALERT,
          );
      const resultingShouldCreateIncident: boolean =
        isShouldCreateIncidentUpdated
          ? updatedShouldCreateIncident
          : this.getRecordSettings().normalizeBooleanInput(
              rule.shouldCreateIncident,
              DEFAULT_SHOULD_CREATE_INCIDENT,
            );

      if (!resultingShouldCreateAlert && !resultingShouldCreateIncident) {
        throw new BadDataException(NO_OUTPUT_ERROR_MESSAGE);
      }
    }
  }

  /*
   * Resolve all open Alerts carrying this rule's fingerprint by appending a
   * resolved AlertStateTimeline row (SloRecordSourceService
   * .resolveOpenAlertsByFingerprint, shared with policy tiers).
   */
  @CaptureSpan()
  public async resolveOpenAlertsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    await this.getRecordSettings().resolveOpenAlertsByFingerprint({
      fingerprint: this.getBurnRateFingerprint({
        serviceLevelObjectiveId: data.serviceLevelObjectiveId,
        burnRateRuleId: data.burnRateRuleId,
      }),
      projectId: data.projectId,
      rootCause:
        data.rootCause ||
        "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.",
      sourceDescription: `SLO burn rate rule ${data.burnRateRuleId?.toString()}`,
    });
  }

  /*
   * Forget that the rule has an output open, WITHOUT stamping a resolve -
   * SloRecordSourceService.clearOpenOutputState says why that, and not a
   * resolve stamp, is what ends a lifecycle an administrator ended. For a
   * rule, the stamp would also open its re-fire suppression window of up to
   * its long window (six hours for the seeded Slow burn), so re-enabling it
   * mid-outage would go quiet anyway. The cost is the rule's "last fired"
   * history: a rule whose SLO was disabled once reads as never having fired.
   */
  @CaptureSpan()
  public async clearOpenOutputStateForRule(data: {
    burnRateRuleId: ObjectID;
    clearAlert: boolean;
    clearIncident: boolean;
  }): Promise<void> {
    await this.getRecordSettings().clearOpenOutputState({
      id: data.burnRateRuleId,
      clearAlert: data.clearAlert,
      clearIncident: data.clearIncident,
    });
  }

  /*
   * The Incident twin of resolveOpenAlertsForRule: every open Incident
   * carrying this rule's fingerprint gets a resolved IncidentStateTimeline
   * row. Its own method because the two are resolved independently - turning
   * `shouldCreateIncident` off must close the incident and leave the alert
   * alone, and vice versa.
   */
  @CaptureSpan()
  public async resolveOpenIncidentsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    await this.getRecordSettings().resolveOpenIncidentsByFingerprint({
      fingerprint: this.getBurnRateFingerprint({
        serviceLevelObjectiveId: data.serviceLevelObjectiveId,
        burnRateRuleId: data.burnRateRuleId,
      }),
      projectId: data.projectId,
      rootCause:
        data.rootCause ||
        "Incident auto-resolved because the SLO burn rate rule that declared it is no longer active.",
      sourceDescription: `SLO burn rate rule ${data.burnRateRuleId?.toString()}`,
    });
  }

  /*
   * Close everything a rule has open, whichever of the two outputs produced
   * it. This is what every "the rule can no longer justify what it opened"
   * caller wants — the worker's recovery branch, the delete hook, and the
   * SLO-level disable/delete path — because a rule's configuration can have
   * changed since the record was opened, so "it declares incidents now" is not
   * a safe proxy for "it has no open alert".
   *
   * A failure on one side must not strand the other, so the incident pass runs
   * even when the alert pass throws, and the first error is rethrown after
   * both have run.
   */
  @CaptureSpan()
  public async resolveOpenAlertsAndIncidentsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    let firstError: unknown = null;

    try {
      await this.resolveOpenAlertsForRule(data);
    } catch (err) {
      firstError = err;
    }

    try {
      await this.resolveOpenIncidentsForRule(data);
    } catch (err) {
      if (firstError === null) {
        firstError = err;
      }
    }

    if (firstError !== null) {
      throw firstError;
    }
  }

  private validateBurnRateThreshold(value: unknown): number {
    const burnRateThreshold: number =
      this.getRecordSettings().normalizeNumericInput(value);

    if (!Number.isFinite(burnRateThreshold) || burnRateThreshold <= 0) {
      throw new BadDataException(THRESHOLD_ERROR_MESSAGE);
    }

    return burnRateThreshold;
  }

  private validateMinimumSampleCount(value: unknown): number {
    const minimumSampleCount: number =
      this.getRecordSettings().normalizeNumericInput(value);

    if (!Number.isFinite(minimumSampleCount) || minimumSampleCount < 0) {
      throw new BadDataException(
        "Minimum sample count must be a number greater than or equal to 0.",
      );
    }

    return minimumSampleCount;
  }

  private validateRefireSuppressionMinutes(value: unknown): number {
    const refireSuppressionMinutes: number =
      this.getRecordSettings().normalizeNumericInput(value);

    if (
      !Number.isFinite(refireSuppressionMinutes) ||
      refireSuppressionMinutes < 0
    ) {
      throw new BadDataException(
        "Re-fire suppression must be a number of minutes greater than or equal to 0.",
      );
    }

    return refireSuppressionMinutes;
  }

  /*
   * Coerces both windows, then enforces the multi-window invariant numerically.
   * Returns the coerced pair so callers can write numbers back onto the
   * create/update payload.
   */
  private validateWindows(data: {
    longWindowInMinutes: unknown;
    shortWindowInMinutes: unknown;
  }): { longWindowInMinutes: number; shortWindowInMinutes: number } {
    const longWindowInMinutes: number =
      this.getRecordSettings().normalizeNumericInput(data.longWindowInMinutes);
    const shortWindowInMinutes: number =
      this.getRecordSettings().normalizeNumericInput(data.shortWindowInMinutes);

    if (
      !Number.isFinite(longWindowInMinutes) ||
      !Number.isFinite(shortWindowInMinutes)
    ) {
      throw new BadDataException(WINDOWS_NOT_NUMERIC_ERROR_MESSAGE);
    }

    if (shortWindowInMinutes <= 0) {
      throw new BadDataException(
        "Short window must be greater than 0 minutes.",
      );
    }

    if (longWindowInMinutes <= shortWindowInMinutes) {
      throw new BadDataException(
        "Long window must be greater than the short window.",
      );
    }

    return {
      longWindowInMinutes: longWindowInMinutes,
      shortWindowInMinutes: shortWindowInMinutes,
    };
  }
}

export default new Service();
