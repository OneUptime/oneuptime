import Alert from "../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import {
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
} from "../../Utils/Slo/SloBurnRateTemplate";
import PartialEntity from "../../Types/Database/PartialEntity";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
  resolveReferenceId,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertService from "./AlertService";
import AlertSeverityService from "./AlertSeverityService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateTimelineService from "./IncidentStateTimelineService";
import LabelService from "./LabelService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import TeamMemberService from "./TeamMemberService";
import TeamService from "./TeamService";
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

type BurnRateRuleOptionFlag = keyof typeof BURN_RATE_RULE_OPTION_FLAG_DEFAULTS;

/*
 * Template columns and their limits, from the module the dashboard form reads
 * too, so the browser refuses exactly what this hook would.
 *
 * Titles are varchar(ColumnLength.LongText) - on this rule and on the Alert and
 * Incident they render into - so the column's own length is the limit, and
 * saying so here beats Postgres' raw "value too long". The worker still clamps
 * the RENDERED title, because `{{sloName}}` can expand a template that fit.
 *
 * Markdown columns are unbounded text, but a template is copied into every
 * record the rule opens and into the notifications each of those sends, so
 * they get a generous cap rather than none.
 */
export const BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH: number =
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH;

export const BURN_RATE_RULE_TITLE_TEMPLATE_MAX_LENGTH: number =
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH;

type BurnRateRuleTemplateColumn =
  | "alertTitleTemplate"
  | "alertDescriptionTemplate"
  | "alertRemediationNotes"
  | "incidentTitleTemplate"
  | "incidentDescriptionTemplate"
  | "incidentRemediationNotes";

export const BURN_RATE_RULE_TEMPLATE_COLUMNS: Array<{
  column: BurnRateRuleTemplateColumn;
  title: string;
  maxLength: number;
}> = [
  {
    column: "alertTitleTemplate",
    title: "Alert title template",
    maxLength: BURN_RATE_RULE_TITLE_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "alertDescriptionTemplate",
    title: "Alert description template",
    maxLength: BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "alertRemediationNotes",
    title: "Alert remediation notes",
    maxLength: BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "incidentTitleTemplate",
    title: "Incident title template",
    maxLength: BURN_RATE_RULE_TITLE_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "incidentDescriptionTemplate",
    title: "Incident description template",
    maxLength: BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
  {
    column: "incidentRemediationNotes",
    title: "Incident remediation notes",
    maxLength: BURN_RATE_RULE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  },
];

// Every many-to-many list the rule copies onto the records it opens.
type BurnRateRuleProjectScopedRelationColumn =
  | "onCallDutyPolicies"
  | "incidentOnCallDutyPolicies"
  | "alertLabels"
  | "incidentLabels"
  | "alertOwnerTeams"
  | "incidentOwnerTeams";

type BurnRateRuleOwnerUserColumn = "alertOwnerUsers" | "incidentOwnerUsers";

type BurnRateRuleRelationColumn =
  | BurnRateRuleProjectScopedRelationColumn
  | BurnRateRuleOwnerUserColumn;

const OWNER_USER_COLUMNS: Array<BurnRateRuleOwnerUserColumn> = [
  "alertOwnerUsers",
  "incidentOwnerUsers",
];

const PROJECT_SCOPED_RELATION_COLUMNS: Array<BurnRateRuleProjectScopedRelationColumn> =
  [
    "onCallDutyPolicies",
    "incidentOnCallDutyPolicies",
    "alertLabels",
    "incidentLabels",
    "alertOwnerTeams",
    "incidentOwnerTeams",
  ];

const RELATION_COLUMNS: Array<BurnRateRuleRelationColumn> = [
  ...PROJECT_SCOPED_RELATION_COLUMNS,
  ...OWNER_USER_COLUMNS,
];

export const OWNER_USERS_NOT_IN_PROJECT_ERROR_PREFIX: string =
  "This SLO burn rate rule names owner users who are not members of this project:";

/*
 * Ids compare case-insensitively: ObjectID keeps whatever case it was handed,
 * while Postgres renders a uuid lower-cased (ProjectScopedReferenceValidator
 * explains the same trap).
 */
type NormalizeIdFunction = (id: string) => string;

const normalizeId: NormalizeIdFunction = (id: string): string => {
  return id.trim().toLowerCase();
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
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
    const shouldCreateAlert: boolean = this.normalizeBooleanInput(
      createBy.data.shouldCreateAlert,
      DEFAULT_SHOULD_CREATE_ALERT,
    );
    const shouldCreateIncident: boolean = this.normalizeBooleanInput(
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
     * reason as the two output flags - and coerced for the same "false"-string
     * reason: the worker reads autoResolve with `!== false` and the private
     * flags with `=== true`, so an uncoerced "false" would keep auto-resolving
     * and an uncoerced "true" would publish a record the user asked to hide.
     */
    this.normalizeOptionFlags(createBy.data as unknown as Dictionary<unknown>, {
      applyDefaults: true,
    });

    this.normalizeTemplates(createBy.data as unknown as Dictionary<unknown>);

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

    await this.validateSeverityReferences({
      projectId: projectId,
      alertSeverityId: createBy.data.alertSeverityId,
      incidentSeverityId: createBy.data.incidentSeverityId,
    });

    await this.validateRoutingReferences({
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
   * BurnRateRuleAdded on the SLO feed. Skipped for the two rules OneUptime
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

    await this.validateSeverityReferencesOnUpdate(updateBy);

    /*
     * Only the options this update actually carries are coerced - an absent
     * flag must stay absent, or a form that saves just the name would reset
     * every other option to its default.
     */
    this.normalizeOptionFlags(updateBy.data as unknown as Dictionary<unknown>, {
      applyDefaults: false,
    });

    this.normalizeTemplates(updateBy.data as unknown as Dictionary<unknown>);

    await this.validateRoutingReferencesOnUpdate(updateBy);

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
        const normalizedNewWindow: number = this.normalizeNumericInput(
          isLongWindowUpdated ? newLongWindow : newShortWindow,
        );

        if (!Number.isFinite(normalizedNewWindow)) {
          throw new BadDataException(WINDOWS_NOT_NUMERIC_ERROR_MESSAGE);
        }

        const rulesToUpdate: Array<Model> = await this.findBy({
          query: updateBy.query,
          select: {
            _id: true,
            longWindowInMinutes: true,
            shortWindowInMinutes: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
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
    const itemsToDelete: Array<Model> = await this.findBy({
      query: SloFeedUtil.getTenantPinnedQuery({
        query: deleteBy.query,
        tenantId: deleteBy.props.isMultiTenantRequest
          ? undefined
          : deleteBy.props.tenantId,
      }),
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
        serviceLevelObjectiveId: true,
        // What the SLO feed's "rule removed" item says - the row is gone after.
        name: true,
        burnRateThreshold: true,
        longWindowInMinutes: true,
        shortWindowInMinutes: true,
      },
      props: {
        isRoot: true,
      },
    });

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
              isEnabledOnlyChange && changes[0]!.to === "On"
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
     * These three reads are strict `=== false`, and that is only sound because
     * onBeforeUpdate ran first: validateOutputsOnUpdate coerces both output
     * flags, so the string `"false"` a form or a raw API call can send has
     * already become a real boolean by the time it reaches here. If a path
     * ever reaches onUpdateSuccess without that coercion, `"false" === false`
     * is false and the orphaned record silently stays open — so the coercion
     * is load-bearing, not tidiness.
     *
     * `isEnabled` is a plain Boolean column with no coercion hook, so a
     * literal "false" string would slip past this check. That is pre-existing
     * across every model in the codebase and is not worked around here; the
     * dashboard's toggle sends a real boolean.
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
      updateBy.data.shouldCreateAlert = this.normalizeBooleanInput(
        newShouldCreateAlert,
        DEFAULT_SHOULD_CREATE_ALERT,
      );
    }

    if (isShouldCreateIncidentUpdated) {
      updateBy.data.shouldCreateIncident = this.normalizeBooleanInput(
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

    const rulesToUpdate: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        shouldCreateAlert: true,
        shouldCreateIncident: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const rule of rulesToUpdate) {
      const resultingShouldCreateAlert: boolean = isShouldCreateAlertUpdated
        ? updatedShouldCreateAlert
        : this.normalizeBooleanInput(
            rule.shouldCreateAlert,
            DEFAULT_SHOULD_CREATE_ALERT,
          );
      const resultingShouldCreateIncident: boolean =
        isShouldCreateIncidentUpdated
          ? updatedShouldCreateIncident
          : this.normalizeBooleanInput(
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
   * resolved AlertStateTimeline row. Mirrors
   * MonitorAlert.resolveOpenAlert mechanics, including tolerating the benign
   * same-state concurrency race.
   */
  @CaptureSpan()
  public async resolveOpenAlertsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const fingerprint: string = this.getBurnRateFingerprint({
      serviceLevelObjectiveId: data.serviceLevelObjectiveId,
      burnRateRuleId: data.burnRateRuleId,
    });

    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.projectId,
        seriesFingerprint: fingerprint,
        currentAlertState: {
          isResolvedState: false,
        },
      },
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    if (openAlerts.length === 0) {
      return;
    }

    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(
        data.projectId,
      );

    /*
     * Per-record isolation, but NOT per-record silence: one record that fails
     * to resolve must not stop the others, and must still reach the caller.
     * Every caller above this treats a clean return as "there is nothing left
     * open" — the worker stamps the rule resolved, and its Paused /
     * Misconfigured guard commits a status change that makes the whole attempt
     * one-shot. Swallowing a single failed state-timeline write therefore
     * strands that record, and its on-call escalation, permanently.
     *
     * The idempotent same-state race below is not a failure and is
     * deliberately not counted.
     */
    let firstError: unknown = null;

    for (const openAlert of openAlerts) {
      try {
        const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
        alertStateTimeline.alertId = openAlert.id!;
        alertStateTimeline.alertStateId = resolvedStateId;
        alertStateTimeline.projectId = openAlert.projectId!;
        alertStateTimeline.rootCause =
          data.rootCause ||
          "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.";

        try {
          await AlertStateTimelineService.create({
            data: alertStateTimeline,
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          /*
           * Idempotent concurrency race: the evaluation worker and a
           * lifecycle hook can both decide to resolve the same open alert
           * near-simultaneously. The loser's onBeforeCreate dedupe throws
           * this exact BadDataException. Treat as a no-op at debug level.
           * Mirrors MonitorAlert.resolveOpenAlert.
           */
          if (
            err instanceof BadDataException &&
            err.message === "Alert state cannot be same as previous state."
          ) {
            logger.debug(
              `${openAlert.id?.toString()} - Alert already in resolved state; skipping duplicate state timeline (concurrent race).`,
            );
          } else {
            throw err;
          }
        }
      } catch (err) {
        logger.error(
          `Error resolving open alert ${openAlert.id?.toString()} for SLO burn rate rule ${data.burnRateRuleId?.toString()}: ${err}`,
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
   * Both severity columns are plain foreign keys with no project scoping of
   * their own, so the public CRUD API will happily persist a severity that
   * belongs to a different project. Nothing notices until the worker fires:
   * IncidentService.onBeforeCreate rejects the cross-project reference on
   * EVERY tick, the evaluation loop swallows the throw into a log line, and
   * the rule looks configured while declaring nothing forever.
   *
   * The validator also rejects an id that matches no row at all, which is the
   * other way a hand-written API call produces a rule that can never fire.
   */
  private async validateSeverityReferences(data: {
    projectId: ObjectID | undefined;
    alertSeverityId: ObjectID | undefined;
    incidentSeverityId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      /*
       * No project to validate against. The tenant column is required, so the
       * write is going to fail anyway — and failing here would turn a clear
       * "projectId is required" into a confusing severity error.
       */
      return;
    }

    if (!data.alertSeverityId && !data.incidentSeverityId) {
      return;
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: data.projectId,
      subject: "SLO burn rate rule",
      references: [
        {
          modelName: "Alert Severity",
          id: data.alertSeverityId,
          service: AlertSeverityService,
        },
        {
          modelName: "Incident Severity",
          id: data.incidentSeverityId,
          service: IncidentSeverityService,
        },
      ],
    });
  }

  /*
   * The update twin. A root or API update does not always carry a tenantId, so
   * fall back to the projects of the rows the query actually matches — the
   * shape ScheduledMaintenanceService uses for the same problem.
   */
  private async validateSeverityReferencesOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const alertSeverityId: ObjectID | undefined = updateBy.data
      .alertSeverityId as ObjectID | undefined;
    const incidentSeverityId: ObjectID | undefined = updateBy.data
      .incidentSeverityId as ObjectID | undefined;

    if (!alertSeverityId && !incidentSeverityId) {
      return;
    }

    const projectIds: Array<ObjectID> = updateBy.props.tenantId
      ? [updateBy.props.tenantId]
      : await this.getProjectIdsForUpdateQuery(updateBy);

    for (const projectId of projectIds) {
      await this.validateSeverityReferences({
        projectId: projectId,
        alertSeverityId: alertSeverityId,
        incidentSeverityId: incidentSeverityId,
      });
    }
  }

  /*
   * Coerce the five option flags. `applyDefaults` is the create path, where a
   * flag the payload never mentions is written as its default; on update an
   * absent flag stays absent.
   *
   * An explicit null is not "absent", though. All five are NOT NULL columns,
   * so writing null would fail the update with a raw constraint error - it is
   * read the way the create path reads it, as the column default.
   */
  private normalizeOptionFlags(
    data: Dictionary<unknown>,
    options: { applyDefaults: boolean },
  ): void {
    const flags: Array<BurnRateRuleOptionFlag> = Object.keys(
      BURN_RATE_RULE_OPTION_FLAG_DEFAULTS,
    ) as Array<BurnRateRuleOptionFlag>;

    for (const flag of flags) {
      const value: unknown = data[flag];

      if (!options.applyDefaults && value === undefined) {
        continue;
      }

      data[flag] = this.normalizeBooleanInput(
        value,
        BURN_RATE_RULE_OPTION_FLAG_DEFAULTS[flag],
      );
    }
  }

  /*
   * Titles, descriptions and remediation notes. A blank template is stored as
   * NULL: the worker treats blank and absent the same (it falls back to the
   * built-in text), and NULL keeps the table and the edit form honest about
   * which rules have a template at all. Content is never trimmed - leading
   * whitespace is meaningful in markdown.
   */
  private normalizeTemplates(data: Dictionary<unknown>): void {
    for (const template of BURN_RATE_RULE_TEMPLATE_COLUMNS) {
      const value: unknown = data[template.column];

      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value !== "string") {
        throw new BadDataException(`${template.title} must be text.`);
      }

      if (value.trim() === "") {
        data[template.column] = null;
        continue;
      }

      if (value.length > template.maxLength) {
        throw new BadDataException(
          `${template.title} must be ${template.maxLength} characters or fewer. It is ${value.length} characters long.`,
        );
      }
    }
  }

  /*
   * Labels, owner teams and on-call policies are project-scoped rows joined to
   * the rule by plain many-to-many tables, so nothing stopped an API caller
   * attaching another project's team - and the worker would then copy it onto
   * every alert this rule opens, handing that team another project's page.
   * The on-call lists were never validated either; they are the same hazard
   * with an escalation attached, so they are checked here too.
   *
   * `storedIds` is the update path's inheritance: ids a rule already holds are
   * carried forward unchecked (the dashboard re-submits whole lists on every
   * save), and only what the write INTRODUCES is validated - the rule
   * MonitorStepsProjectValidator follows for the same reason.
   */
  private async validateRoutingReferences(data: {
    projectId: ObjectID | undefined;
    payload: Dictionary<unknown>;
    storedIds: Dictionary<Set<string>> | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      // Same reasoning as validateSeverityReferences: nothing to compare to.
      return;
    }

    const references: Array<ProjectScopedReference> = [];

    for (const relation of this.getProjectScopedRelations()) {
      const ids: Array<string> = this.getIntroducedRelationIds(
        data.payload[relation.column],
        data.storedIds?.[relation.column],
      );

      for (const id of ids) {
        references.push({
          modelName: relation.modelName,
          id: id,
          service: relation.service,
        });
      }
    }

    if (references.length > 0) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: data.projectId,
        subject: "SLO burn rate rule",
        references: references,
      });
    }

    const ownerUserIds: Array<string> = [];

    for (const column of OWNER_USER_COLUMNS) {
      ownerUserIds.push(
        ...this.getIntroducedRelationIds(
          data.payload[column],
          data.storedIds?.[column],
        ),
      );
    }

    await this.validateOwnerUsersAreProjectMembers({
      projectId: data.projectId,
      userIds: ownerUserIds,
    });
  }

  /*
   * The update twin. One read serves both halves: it names the projects the
   * update touches (when the caller carries no tenant) and what each matched
   * rule already stores, and it only happens when the payload carries a list.
   */
  private async validateRoutingReferencesOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const payload: Dictionary<unknown> =
      updateBy.data as unknown as Dictionary<unknown>;

    const columnsInPayload: Array<BurnRateRuleRelationColumn> =
      RELATION_COLUMNS.filter((column: BurnRateRuleRelationColumn): boolean => {
        return payload[column] !== undefined && payload[column] !== null;
      });

    if (columnsInPayload.length === 0) {
      return;
    }

    const select: Dictionary<unknown> = {
      _id: true,
      projectId: true,
    };

    for (const column of columnsInPayload) {
      select[column] = {
        _id: true,
      };
    }

    const rules: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: select as unknown as Select<Model>,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    if (updateBy.props.tenantId) {
      projectIds[updateBy.props.tenantId.toString()] = updateBy.props.tenantId;
    } else {
      for (const rule of rules) {
        if (rule.projectId) {
          projectIds[rule.projectId.toString()] = rule.projectId;
        }
      }
    }

    for (const projectId of Object.values(projectIds)) {
      const storedIds: Dictionary<Set<string>> = {};

      for (const column of columnsInPayload) {
        const idsForColumn: Set<string> = new Set<string>();

        for (const rule of rules) {
          if (
            rule.projectId &&
            rule.projectId.toString() !== projectId.toString()
          ) {
            continue;
          }

          const stored: Array<DatabaseBaseModel> =
            (rule.getValue(column) as unknown as
              | Array<DatabaseBaseModel>
              | undefined) || [];

          for (const related of stored) {
            const relatedId: string | undefined =
              resolveReferenceId(related)?.toString();

            if (relatedId) {
              idsForColumn.add(normalizeId(relatedId));
            }
          }
        }

        storedIds[column] = idsForColumn;
      }

      await this.validateRoutingReferences({
        projectId: projectId,
        payload: payload,
        storedIds: storedIds,
      });
    }
  }

  /*
   * User is a global model with no tenant column, so the reference validator
   * could only confirm a user EXISTS - any account on the instance would pass.
   * Owners are notified with the record's title and a link to it, so naming a
   * stranger as an owner would tell them about another project's alert.
   *
   * Team membership is what "in this project" means, and it is exactly the set
   * the dashboard's owner picker offers (ProjectUser lists TeamMember rows).
   * Pending invitations count for that reason: refusing a user the picker just
   * offered would fail a save nobody could explain.
   *
   * The error echoes the ids the caller sent and never a name or email -
   * resolving an id from outside the project into a person would leak it.
   */
  private async validateOwnerUsersAreProjectMembers(data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<void> {
    const requestedById: Map<string, string> = new Map<string, string>();

    for (const userId of data.userIds) {
      const key: string = normalizeId(userId);

      if (key && !requestedById.has(key)) {
        requestedById.set(key, userId);
      }
    }

    if (requestedById.size === 0) {
      return;
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(Array.from(requestedById.values())),
      },
      select: {
        userId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const memberIds: Set<string> = new Set<string>();

    for (const membership of memberships) {
      if (membership.userId) {
        memberIds.add(normalizeId(membership.userId.toString()));
      }
    }

    const nonMembers: Array<string> = [];

    for (const [key, userId] of requestedById) {
      if (!memberIds.has(key)) {
        nonMembers.push(userId);
      }
    }

    if (nonMembers.length === 0) {
      return;
    }

    throw new BadDataException(
      `${OWNER_USERS_NOT_IN_PROJECT_ERROR_PREFIX} ${nonMembers
        .map((userId: string): string => {
          return `"${userId}"`;
        })
        .join(", ")}. Please pick users from this project and try again.`,
    );
  }

  /*
   * The ids a many-to-many payload introduces. The same list reaches a hook as
   * entity stubs, `{ _id }` objects, ObjectIDs or bare uuid strings depending
   * on the caller, which resolveReferenceId already reads; anything it cannot
   * read is not an id and is left for the write itself to reject.
   */
  private getIntroducedRelationIds(
    value: unknown,
    storedIds: Set<string> | undefined,
  ): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    const items: Array<unknown> = Array.isArray(value) ? value : [value];
    const seen: Set<string> = new Set<string>();
    const ids: Array<string> = [];

    for (const item of items) {
      const id: string = resolveReferenceId(item)?.toString().trim() || "";

      if (!id) {
        continue;
      }

      const key: string = normalizeId(id);

      if (seen.has(key) || storedIds?.has(key)) {
        continue;
      }

      seen.add(key);
      ids.push(id);
    }

    return ids;
  }

  /*
   * Built per call rather than at module load: these services sit in an import
   * graph that loops back to this one, and a module-level table would capture
   * whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<{
    column: BurnRateRuleProjectScopedRelationColumn;
    modelName: string;
    service: DatabaseService<DatabaseBaseModel>;
  }> {
    const onCallDutyPolicyService: DatabaseService<DatabaseBaseModel> =
      OnCallDutyPolicyService as unknown as DatabaseService<DatabaseBaseModel>;
    const labelService: DatabaseService<DatabaseBaseModel> =
      LabelService as unknown as DatabaseService<DatabaseBaseModel>;
    const teamService: DatabaseService<DatabaseBaseModel> =
      TeamService as unknown as DatabaseService<DatabaseBaseModel>;

    return [
      {
        column: "onCallDutyPolicies",
        modelName: "On-Call Duty Policy",
        service: onCallDutyPolicyService,
      },
      {
        column: "incidentOnCallDutyPolicies",
        modelName: "On-Call Duty Policy",
        service: onCallDutyPolicyService,
      },
      {
        column: "alertLabels",
        modelName: "Label",
        service: labelService,
      },
      {
        column: "incidentLabels",
        modelName: "Label",
        service: labelService,
      },
      {
        column: "alertOwnerTeams",
        modelName: "Team",
        service: teamService,
      },
      {
        column: "incidentOwnerTeams",
        modelName: "Team",
        service: teamService,
      },
    ];
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const rules: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    for (const rule of rules) {
      if (rule.projectId) {
        projectIds[rule.projectId.toString()] = rule.projectId;
      }
    }

    return Object.values(projectIds);
  }

  /*
   * Forget that the rule has an output open, WITHOUT stamping a resolve.
   *
   * The rule's four lifecycle columns are what the evaluation worker reads to
   * decide whether an output is already open, so a path that closes the record
   * but leaves `lastAlertCreatedAt` / `lastIncidentCreatedAt` set tells the
   * next tick "there is already an alert open" when there is not — and the
   * worker then refuses to declare anything for the rest of the burn. That is
   * how "turn Create Alert off to stop the noise, then turn it back on" used
   * to silence a live 14.4x fast burn.
   *
   * Clearing the CREATED column rather than stamping the RESOLVED one is the
   * whole point. Stamping a resolve would open a re-fire suppression window of
   * up to the rule's long window (six hours for the seeded Slow burn), so
   * re-enabling a rule mid-outage would go quiet anyway. Nothing about the
   * burn rate recovered here; an administrator ended the lifecycle, and the
   * honest record of that is "nothing is open", not "it just resolved".
   *
   * The cost is the rule's "last fired" history: a rule whose SLO was disabled
   * once reads as never having fired. That is the right trade against silently
   * losing a page, and it is the same reset an administrator just performed.
   *
   * Hookless on purpose. These are worker-owned columns that no workflow can
   * meaningfully trigger on, and the caller is often onUpdateSuccess — a
   * hooked write from inside an update hook re-enters the whole pipeline to
   * write two nullable timestamps.
   */
  @CaptureSpan()
  public async clearOpenOutputStateForRule(data: {
    burnRateRuleId: ObjectID;
    clearAlert: boolean;
    clearIncident: boolean;
  }): Promise<void> {
    const columns: {
      lastAlertCreatedAt?: null;
      lastIncidentCreatedAt?: null;
    } = {};

    if (data.clearAlert) {
      columns.lastAlertCreatedAt = null;
    }

    if (data.clearIncident) {
      columns.lastIncidentCreatedAt = null;
    }

    if (Object.keys(columns).length === 0) {
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.burnRateRuleId,
      data: columns as unknown as PartialEntity<Model>,
    });
  }

  /*
   * The Incident twin of resolveOpenAlertsForRule. Same shape, different
   * table: find every open Incident carrying this rule's fingerprint and
   * append a resolved IncidentStateTimeline row.
   *
   * Kept as its own method rather than folded into the alert path because the
   * two are resolved independently — turning `shouldCreateIncident` off must close
   * the incident and leave the alert alone, and vice versa.
   */
  @CaptureSpan()
  public async resolveOpenIncidentsForRule(data: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause?: string | undefined;
  }): Promise<void> {
    const fingerprint: string = this.getBurnRateFingerprint({
      serviceLevelObjectiveId: data.serviceLevelObjectiveId,
      burnRateRuleId: data.burnRateRuleId,
    });

    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        seriesFingerprint: fingerprint,
        currentIncidentState: {
          isResolvedState: false,
        },
      },
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    if (openIncidents.length === 0) {
      return;
    }

    /*
     * Looked up once for the batch, and only once there is something to
     * resolve: it throws when the project has no resolved incident state, and
     * a project with nothing open must not be failed for a state it never
     * needed.
     */
    const resolvedStateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        data.projectId,
      );

    /*
     * Per-record isolation, but NOT per-record silence: one record that fails
     * to resolve must not stop the others, and must still reach the caller.
     * Every caller above this treats a clean return as "there is nothing left
     * open" — the worker stamps the rule resolved, and its Paused /
     * Misconfigured guard commits a status change that makes the whole attempt
     * one-shot. Swallowing a single failed state-timeline write therefore
     * strands that record, and its on-call escalation, permanently.
     *
     * The idempotent same-state race below is not a failure and is
     * deliberately not counted.
     */
    let firstError: unknown = null;

    for (const openIncident of openIncidents) {
      try {
        const incidentStateTimeline: IncidentStateTimeline =
          new IncidentStateTimeline();
        incidentStateTimeline.incidentId = openIncident.id!;
        incidentStateTimeline.incidentStateId = resolvedStateId;
        incidentStateTimeline.projectId = openIncident.projectId!;
        incidentStateTimeline.rootCause =
          data.rootCause ||
          "Incident auto-resolved because the SLO burn rate rule that declared it is no longer active.";

        try {
          await IncidentStateTimelineService.create({
            data: incidentStateTimeline,
            props: {
              isRoot: true,
            },
          });
        } catch (err) {
          /*
           * Idempotent concurrency race, exactly as on the alert path: the
           * evaluation worker and a lifecycle hook can both decide to resolve
           * the same open incident. The loser's onBeforeCreate dedupe throws
           * this exact BadDataException. Match the message so unrelated
           * BadDataExceptions (state ordering, for instance) still propagate.
           */
          if (
            err instanceof BadDataException &&
            err.message === "Incident state cannot be same as previous state."
          ) {
            logger.debug(
              `${openIncident.id?.toString()} - Incident already in resolved state; skipping duplicate state timeline (concurrent race).`,
            );
          } else {
            throw err;
          }
        }
      } catch (err) {
        logger.error(
          `Error resolving open incident ${openIncident.id?.toString()} for SLO burn rate rule ${data.burnRateRuleId?.toString()}: ${err}`,
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

  /*
   * Coerce an API-supplied boolean column. Toggles in the dashboard send real
   * booleans, but the CRUD API is public and BaseModel.fromJSON does not
   * coerce Boolean columns, so `"false"` arrives as a non-empty string — which
   * is truthy, and would quietly turn a rule that declares nothing into a rule
   * that declares both. An absent value means "leave it at the default", which
   * is what a create payload that never mentions the field intends.
   */
  private normalizeBooleanInput(
    value: unknown,
    defaultValue: boolean,
  ): boolean {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized: string = value.trim().toLowerCase();

      if (normalized === "") {
        return defaultValue;
      }

      return normalized !== "false" && normalized !== "0";
    }

    return Boolean(value);
  }

  /*
   * Coerce an API-supplied numeric column to a number. HTML number inputs hand
   * Formik strings and neither ModelForm nor BaseModel.fromJSON coerces
   * Number/Decimal columns, so "1440" reaches these hooks as a string — and
   * `"1440" <= "60"` is a lexicographic comparison that is true. Anything that
   * is not a finite numeric string or number becomes NaN, which every caller
   * below rejects. Mirrors GlobalConfigService.normalizePercent.
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

  private validateBurnRateThreshold(value: unknown): number {
    const burnRateThreshold: number = this.normalizeNumericInput(value);

    if (!Number.isFinite(burnRateThreshold) || burnRateThreshold <= 0) {
      throw new BadDataException(THRESHOLD_ERROR_MESSAGE);
    }

    return burnRateThreshold;
  }

  private validateMinimumSampleCount(value: unknown): number {
    const minimumSampleCount: number = this.normalizeNumericInput(value);

    if (!Number.isFinite(minimumSampleCount) || minimumSampleCount < 0) {
      throw new BadDataException(
        "Minimum sample count must be a number greater than or equal to 0.",
      );
    }

    return minimumSampleCount;
  }

  private validateRefireSuppressionMinutes(value: unknown): number {
    const refireSuppressionMinutes: number = this.normalizeNumericInput(value);

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
    const longWindowInMinutes: number = this.normalizeNumericInput(
      data.longWindowInMinutes,
    );
    const shortWindowInMinutes: number = this.normalizeNumericInput(
      data.shortWindowInMinutes,
    );

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
