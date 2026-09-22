import DatabaseService from "./DatabaseService";
import LabelService from "./LabelService";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveMonitorRuleEngineService from "./ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import Label from "../../Models/DatabaseModels/Label";
import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import { Gray500, Green500, Red500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import MonitorType from "../../Types/Monitor/MonitorType";
import {
  getMonitorTypeCriteriaValidationError,
  isMonitorTypeCriteriaValue,
} from "../../Utils/Rules/MonitorTypeRuleCriteria";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import {
  getRuleCriteriaValidationError,
  isValidRuleCriteria,
} from "../../Utils/Rules/RuleCriteriaMatcher";
import {
  describeSloMonitorRuleCriteria,
  getSloMonitorRuleCriteriaKey,
  getSloMonitorRuleLabelIds,
} from "../../Utils/Slo/SloMonitorRuleCriteria";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import { resolveReferenceId } from "../Utils/Database/ProjectScopedReferenceValidator";
import SloRecordReferenceValidator from "../Utils/Slo/SloRecordReferenceValidator";
import SloLegacyMonitorLabelAdoption from "../Utils/Slo/SloLegacyMonitorLabelAdoption";
import logger, { LogAttributes } from "../Utils/Logger";
import MonitorRulePatternValidator from "../Utils/Rules/MonitorRulePatternValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Everything a hook needs to validate a rule, describe it in the SLO feed,
 * and find the SLO to re-sync. One select for all three, so a single read
 * serves the validation and the before-snapshot.
 */
const RULE_SNAPSHOT_SELECT: Select<Model> = {
  _id: true,
  projectId: true,
  serviceLevelObjectiveId: true,
  name: true,
  description: true,
  isEnabled: true,
  monitorLabels: {
    _id: true,
    name: true,
  },
  monitorType: true,
  monitorNamePattern: true,
  monitorDescriptionPattern: true,
  criteria: true,
};

type BuildRuleFeedSentenceFunction = (data: {
  sloLink: string;
  ruleName: string;
}) => string;

interface RuleUpdateCarryForward {
  rulesBeforeUpdate: Array<Model>;
}

interface RuleDeleteCarryForward {
  rulesToDelete: Array<Model>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const serviceLevelObjectiveId: ObjectID | string | undefined =
      resolveReferenceId(
        createBy.data.serviceLevelObjectiveId ||
          createBy.data.serviceLevelObjective,
      );

    if (!serviceLevelObjectiveId) {
      throw new BadDataException(
        "Service Level Objective ID is required to create an SLO monitor rule.",
      );
    }

    this.assertHasMatchCriteria({
      monitorLabelCount: (createBy.data.monitorLabels || []).length,
      monitorType: createBy.data.monitorType,
      monitorNamePattern: createBy.data.monitorNamePattern,
      monitorDescriptionPattern: createBy.data.monitorDescriptionPattern,
      criteria: createBy.data.criteria,
    });

    MonitorRulePatternValidator.validate({
      namePattern: createBy.data.monitorNamePattern,
      descriptionPattern: createBy.data.monitorDescriptionPattern,
    });

    await this.assertServiceLevelObjectiveIsInScope({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      // Both spellings: the id column and the relation write one join column.
      serviceLevelObjective: [
        createBy.data.serviceLevelObjectiveId,
        createBy.data.serviceLevelObjective,
      ],
    });

    // Last: only a create every check above accepted may change the SLO.
    await this.adoptLegacyMonitorLabelsBeforeCreate({
      createBy: createBy,
      projectId: createBy.props.tenantId || createBy.data.projectId,
      serviceLevelObjectiveId: serviceLevelObjectiveId,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.id) {
      return createdItem;
    }

    /*
     * Read back what was actually stored rather than trusting the payload:
     * a criteria save rewrites the legacy columns (the safety shadow), and
     * the feed item should describe the rule the engine will evaluate.
     */
    const rule: Model =
      (await this.findRuleSnapshotQuietly(createdItem.id)) || createdItem;

    const serviceLevelObjectiveId: ObjectID | undefined =
      rule.serviceLevelObjectiveId || createdItem.serviceLevelObjectiveId;

    /*
     * Posted before the sync, so the feed reads cause then effect: the rule
     * was added, then the monitors it matched were attached.
     */
    await this.postRuleFeedItem({
      rule: rule,
      eventType: ServiceLevelObjectiveFeedEventType.MonitorRuleAdded,
      displayColor: Green500,
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      buildFeedInfoInMarkdown: (data: {
        sloLink: string;
        ruleName: string;
      }): string => {
        return rule.isEnabled === false
          ? `🧩 Added monitor rule ${data.ruleName} to ${data.sloLink}. It was added disabled, so it does not attach any monitors yet.`
          : `🧩 Added monitor rule ${data.ruleName} to ${data.sloLink}. Monitors it matches are attached to this SLO.`;
      },
      moreInformationInMarkdown: await this.describeRuleForFeed(rule),
    });

    /*
     * Backfill: a rule the user just wrote should attach the monitors that
     * already match, not only ones created after it.
     */
    if (serviceLevelObjectiveId) {
      await this.syncQuietly(serviceLevelObjectiveId);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    MonitorRulePatternValidator.validate({
      namePattern: updateBy.data.monitorNamePattern as string | undefined,
      descriptionPattern: updateBy.data.monitorDescriptionPattern as
        | string
        | undefined,
    });

    const touchesCriteria: boolean =
      updateBy.data.monitorLabels !== undefined ||
      updateBy.data.monitorType !== undefined ||
      updateBy.data.monitorNamePattern !== undefined ||
      updateBy.data.monitorDescriptionPattern !== undefined ||
      updateBy.data.criteria !== undefined;

    const touchesFeedColumns: boolean =
      touchesCriteria ||
      updateBy.data.name !== undefined ||
      updateBy.data.description !== undefined ||
      updateBy.data.isEnabled !== undefined;

    /*
     * One read serves two purposes: the merged criteria check below, and the
     * before-snapshot onUpdateSuccess compares against to decide whether the
     * edit changed anything worth a feed item. An edit that touches none of
     * those columns needs neither, so it pays for no read.
     */
    const rulesBeforeUpdate: Array<Model> = touchesFeedColumns
      ? await this.findRulesForQuery(updateBy)
      : [];

    /*
     * An edit can empty a rule out just as easily as a create can, and the
     * result is the same useless rule. The merged view is what matters, so
     * fields the edit does not mention are read back off the stored row -
     * clearing only the labels on a rule that also has a name pattern is
     * perfectly fine, and must not be refused.
     */
    if (touchesCriteria) {
      this.assertUpdateKeepsMatchCriteria({
        updateBy: updateBy,
        rules: rulesBeforeUpdate,
      });
    }

    const carryForward: RuleUpdateCarryForward = {
      rulesBeforeUpdate: rulesBeforeUpdate,
    };

    return { updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const updatedIds: Set<string> = new Set<string>(
      updatedItemIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    /*
     * The snapshot was read with the caller's raw (tenant-pinned) query,
     * before the permission check narrowed it. updatedItemIds is the set that
     * was actually written, so only those rows are described.
     */
    const rulesBeforeUpdate: Array<Model> = (
      (onUpdate.carryForward as RuleUpdateCarryForward | null)
        ?.rulesBeforeUpdate || []
    ).filter((rule: Model): boolean => {
      return Boolean(rule.id && updatedIds.has(rule.id.toString()));
    });

    const ruleBeforeUpdateById: Map<string, Model> = new Map<string, Model>();

    for (const rule of rulesBeforeUpdate) {
      ruleBeforeUpdateById.set(rule.id!.toString(), rule);
    }

    let rulesAfterUpdate: Array<Model> = [];

    if (updatedItemIds.length > 0) {
      try {
        rulesAfterUpdate = await this.findBy({
          query: {
            _id: QueryHelper.any(updatedItemIds),
          },
          select: RULE_SNAPSHOT_SELECT,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      } catch (error) {
        logger.error(
          `Error reading SLO monitor rules back after an update: ${error}`,
        );
      }
    }

    for (const rule of rulesAfterUpdate) {
      const ruleBeforeUpdate: Model | undefined = rule.id
        ? ruleBeforeUpdateById.get(rule.id.toString())
        : undefined;

      if (!ruleBeforeUpdate) {
        continue;
      }

      await this.postRuleChangedFeedItem({
        previous: ruleBeforeUpdate,
        current: rule,
        userId: onUpdate.updateBy.props.userId,
      });
    }

    /*
     * Every editable column changes what the rule matches, whether it is
     * enabled, or neither (name, description) - and the sync is idempotent,
     * so re-running it after an edit that changed nothing costs a read and
     * repairs any drift it finds.
     */
    for (const serviceLevelObjectiveId of this.uniqueServiceLevelObjectiveIds([
      ...rulesAfterUpdate,
      ...rulesBeforeUpdate,
    ])) {
      await this.syncQuietly(serviceLevelObjectiveId);
    }

    return onUpdate;
  }

  /**
   * Notes down which SLO each doomed rule belongs to, so onDeleteSuccess can
   * re-sync those SLOs and tell their feeds.
   *
   * This has to happen before the delete: once the row is gone there is
   * nothing left to read the SLO id or the rule name off.
   *
   * It is READ ONLY, and reads through the caller's own props rather than as
   * root. DatabaseService runs onBeforeDelete before checkDeleteQueryPermission,
   * so the query here is the caller's raw one - anything this hook did as root
   * would act on rows the caller may not be allowed to delete.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    let rulesToDelete: Array<Model> = [];

    try {
      rulesToDelete = await this.findBy({
        query: deleteBy.query,
        select: {
          _id: true,
          projectId: true,
          serviceLevelObjectiveId: true,
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: deleteBy.props,
      });
    } catch (error) {
      /*
       * Best effort. Failing to note the rules down must not block the
       * delete; the worst case is that their monitors stay attached until the
       * next edit to a rule on that SLO, or the next change to the monitor.
       */
      logger.error(
        `Error collecting SLO monitor rules before delete: ${error}`,
      );
    }

    const carryForward: RuleDeleteCarryForward = {
      rulesToDelete: rulesToDelete,
    };

    return { deleteBy, carryForward: carryForward };
  }

  /**
   * Deleting a rule undoes it: every monitor only that rule attached is
   * detached, and monitors another enabled rule of the SLO still matches stay
   * - the union of the remaining rules takes effect. Monitors attached by hand
   * are never touched.
   *
   * Acts only on `itemIdsBeforeDelete`, the permission-checked set that was
   * actually deleted, never on the raw carry-forward.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedIds: Set<string> = new Set<string>(
      itemIdsBeforeDelete.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    const deletedRules: Array<Model> = (
      (onDelete.carryForward as RuleDeleteCarryForward | null)?.rulesToDelete ||
      []
    ).filter((rule: Model): boolean => {
      return Boolean(rule.id && deletedIds.has(rule.id.toString()));
    });

    for (const rule of deletedRules) {
      await this.postRuleFeedItem({
        rule: rule,
        eventType: ServiceLevelObjectiveFeedEventType.MonitorRuleRemoved,
        displayColor: Red500,
        userId: onDelete.deleteBy.props.userId,
        buildFeedInfoInMarkdown: (data: {
          sloLink: string;
          ruleName: string;
        }): string => {
          return `🗑️ Removed monitor rule ${data.ruleName} from ${data.sloLink}. Monitors only this rule attached are detached; monitors attached by hand, or matched by another enabled rule, stay.`;
        },
      });
    }

    for (const serviceLevelObjectiveId of this.uniqueServiceLevelObjectiveIds(
      deletedRules,
    )) {
      await this.syncQuietly(serviceLevelObjectiveId);
    }

    return onDelete;
  }

  /**
   * The SLOs whose monitor rules refer to any of these labels - through the
   * legacy label join table or inside configurable criteria. LabelService
   * asks this before a label delete cascades those references away, so it can
   * re-sync the SLOs once the label is gone.
   *
   * Two lookups, deliberately: the legacy relation query keeps using its join
   * table index, and criteria keep relation ids inside jsonb where only the
   * JSON operator can see them. A criteria-backed rule can show up in both (a
   * criteria save leaves the legacy join rows in place), hence the dedupe.
   */
  @CaptureSpan()
  public async findServiceLevelObjectiveIdsForRulesUsingLabels(
    labelIds: Array<ObjectID>,
  ): Promise<Array<ObjectID>> {
    if (labelIds.length === 0) {
      return [];
    }

    const legacyRules: Array<Model> = await this.findBy({
      query: {
        monitorLabels: labelIds,
      },
      select: {
        _id: true,
        serviceLevelObjectiveId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const criteriaRules: Array<Model> = await this.findBy({
      query: {
        criteria: QueryHelper.jsonArrayObjectsContainAnyArrayValue({
          arrayKey: "filters",
          discriminatorKey: "field",
          discriminatorValue: "monitorLabels",
          valueArrayKey: "value",
          values: labelIds,
        }),
      },
      select: {
        _id: true,
        serviceLevelObjectiveId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return this.uniqueServiceLevelObjectiveIds([
      ...legacyRules,
      ...criteriaRules,
    ]);
  }

  /**
   * Which of these SLOs have at least one enabled monitor rule, as lower-case
   * id strings. The SLO service asks this to refuse hand-edits to a monitor
   * list the rules own. Read as root: the caller has already pinned the SLOs
   * to the caller's tenant.
   */
  @CaptureSpan()
  public async findServiceLevelObjectiveIdsWithEnabledRules(
    serviceLevelObjectiveIds: Array<ObjectID>,
  ): Promise<Set<string>> {
    return await this.findServiceLevelObjectiveIdsHavingRules({
      serviceLevelObjectiveIds: serviceLevelObjectiveIds,
      isEnabledOnly: true,
    });
  }

  /**
   * Which of these SLOs have at least one monitor rule row, enabled OR
   * disabled, as lower-case id strings. The SLO service asks this before it
   * acts on a write of the deprecated monitor label list: once an SLO has
   * rules of any kind, they - not that list - decide what it measures. A
   * disabled rule counts, for the same reason it stops legacy adoption: it is
   * a decision somebody made on the Monitor Rules page. Read as root: the
   * caller hands in ids a permission-checked write already touched.
   */
  @CaptureSpan()
  public async findServiceLevelObjectiveIdsWithAnyRule(
    serviceLevelObjectiveIds: Array<ObjectID>,
  ): Promise<Set<string>> {
    return await this.findServiceLevelObjectiveIdsHavingRules({
      serviceLevelObjectiveIds: serviceLevelObjectiveIds,
      isEnabledOnly: false,
    });
  }

  private async findServiceLevelObjectiveIdsHavingRules(data: {
    serviceLevelObjectiveIds: Array<ObjectID>;
    isEnabledOnly: boolean;
  }): Promise<Set<string>> {
    const { serviceLevelObjectiveIds } = data;

    const result: Set<string> = new Set<string>();

    if (serviceLevelObjectiveIds.length === 0) {
      return result;
    }

    const rules: Array<Model> = await this.findBy({
      query: data.isEnabledOnly
        ? {
            serviceLevelObjectiveId: QueryHelper.any(serviceLevelObjectiveIds),
            isEnabled: true,
          }
        : {
            serviceLevelObjectiveId: QueryHelper.any(serviceLevelObjectiveIds),
          },
      select: {
        _id: true,
        serviceLevelObjectiveId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const rule of rules) {
      const id: string =
        rule.serviceLevelObjectiveId?.toString().toLowerCase() || "";

      if (id) {
        result.add(id);
      }
    }

    return result;
  }

  /*
   * A rule points at an SLO, and nothing in the framework checks that the SLO
   * belongs to the rule's project. A rule created against another tenant's
   * SLO would attach this project's monitors to it - and reveal, through the
   * feed and the Monitors page, which monitors this project has.
   *
   * SloRecordReferenceValidator rather than ProjectScopedReferenceValidator.
   * That one reads the referenced row as root and names a foreign one in its
   * error ("belong to a different project: Service Level Objective <name>"),
   * which confirms another tenant's SLO exists and hands its name to anyone
   * holding its id. This lookup is pinned to the rule's project, selects only
   * ids, and gives a foreign id the same answer as an id that matches nothing.
   */
  private async assertServiceLevelObjectiveIsInScope(data: {
    projectId: ObjectID | undefined;
    // The id column and/or the relation, in any shape the payload used.
    serviceLevelObjective: unknown;
  }): Promise<void> {
    await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
      {
        projectId: data.projectId,
        serviceLevelObjectives: data.serviceLevelObjective,
        subject: "SLO monitor rule",
      },
    );
  }

  /**
   * Converts the SLO's deprecated "Auto-Add Monitors With Labels" list into a
   * rule before this create writes a rule of its own.
   *
   * onCreateSuccess re-syncs the SLO with every enabled rule it has. For an
   * SLO whose list a previous-release pod wrote after the backfill - and whose
   * monitors that pod's engine attached - that would be the new rule alone,
   * and every monitor the list attached that the new rule does not match
   * would be detached. Adopting first puts the list's rule next to the new
   * one, so the sync keeps those monitors (the SLO measures the union of its
   * rules) and adds the new rule's matches.
   *
   * Why before the create and not in onCreateSuccess: adoption only acts on an
   * SLO with no rule row at all (see SloLegacyMonitorLabelAdoption), which is
   * never true once the new row is written. Excluding the new row's id instead
   * breaks exactly when it matters - two first rules created at once (an API
   * client creating several in parallel) each see the other, and neither
   * adopts. Before any of them is written, the SLO row lock serialises the
   * adoptions and exactly one rule is adopted.
   *
   * Only with rule-attached monitors as evidence: an SLO whose user deleted
   * the converted rule keeps its label rows too, and a new rule must not bring
   * that one back (the delete's sync released its monitors). Rule edits and
   * deletes never adopt: an edited rule is itself a rule row, and after a
   * delete "no rule, monitors still attached" is what a deliberate delete
   * looks like.
   *
   * DatabaseService applies the create permission check only after this hook,
   * and adoption is a write - so it runs only for a caller that same check
   * lets through: a caller without permission to create the rule must not
   * change the SLO. DatabaseService still applies the check again afterwards.
   * The gate is the permission check only. A create refused later (required
   * fields, uniqueness, the insert itself) may already have adopted, which is
   * harmless: with rule-attached monitors as evidence, adoption only makes
   * visible a list whose monitors are already attached, and the next monitor
   * edit would adopt it anyway.
   *
   * A failed adoption fails the create. Creating the rule anyway would let its
   * sync detach the monitors the list attached, silently - the loss this
   * exists to prevent. Nothing has been written yet, so a retry is clean.
   */
  private async adoptLegacyMonitorLabelsBeforeCreate(data: {
    createBy: CreateBy<Model>;
    projectId: ObjectID | undefined;
    serviceLevelObjectiveId: ObjectID | string;
  }): Promise<void> {
    if (!data.projectId) {
      // Nothing to pin the adoption to - and a rule needs a project anyway.
      return;
    }

    try {
      ModelPermission.checkCreatePermissions(
        Model,
        data.createBy.data,
        data.createBy.props,
      );
    } catch {
      // DatabaseService refuses this create right after the hook, and says why.
      return;
    }

    await SloLegacyMonitorLabelAdoption.adoptLegacyMonitorLabels({
      projectId: data.projectId,
      serviceLevelObjectiveIds: [data.serviceLevelObjectiveId],
      requireRuleAttachedMonitors: true,
    });
  }

  /*
   * A rule with no criteria matches nothing, yet an enabled one still counts
   * as "this SLO's monitors are managed by rules" and blocks adding monitors
   * by hand. An empty form is far more likely to be an unfinished one, so say
   * so instead of saving a rule that silently locks the monitor list.
   */
  private assertHasMatchCriteria(data: {
    monitorLabelCount: number;
    monitorType?: MonitorType | undefined;
    monitorNamePattern?: string | undefined;
    monitorDescriptionPattern?: string | undefined;
    criteria?: Model["criteria"];
  }): void {
    if (data.criteria !== undefined && data.criteria !== null) {
      const validationError: string | null = getRuleCriteriaValidationError(
        data.criteria,
      );

      if (validationError) {
        throw new BadDataException(validationError);
      }

      if (
        isValidRuleCriteria(data.criteria) &&
        data.criteria.filters.length > 0
      ) {
        for (const filter of data.criteria.filters) {
          if (filter.field === "monitorType") {
            const typeError: string | null =
              getMonitorTypeCriteriaValidationError(filter);

            if (typeError) {
              throw new BadDataException(typeError);
            }
          }
        }

        return;
      }

      throw new BadDataException(
        "An SLO monitor rule needs at least one match condition.",
      );
    }

    if (
      data.monitorType !== undefined &&
      data.monitorType !== null &&
      !isMonitorTypeCriteriaValue(data.monitorType)
    ) {
      throw new BadDataException(
        "Monitor type criteria require a valid monitor type.",
      );
    }

    if (
      data.monitorLabelCount === 0 &&
      !data.monitorType &&
      !data.monitorNamePattern &&
      !data.monitorDescriptionPattern
    ) {
      throw new BadDataException(
        "An SLO monitor rule needs at least one match criterion: monitor labels, a monitor type, a monitor name pattern, or a monitor description pattern. Use .* as the name pattern to match every monitor in the project.",
      );
    }
  }

  /**
   * The rules an update actually touches, read for validation and for the
   * feed's before-snapshot.
   *
   * onBeforeUpdate runs before DatabaseService applies the update query's
   * permission check, so the query here is still the caller's raw one. The
   * tenant is pinned onto it when the caller has one, so a validation read can
   * never reach across projects and answer questions about another tenant's
   * rules. Genuinely root callers (the engines, migrations) have no tenantId
   * and are trusted.
   */
  private async findRulesForQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<Model>> {
    const query: Record<string, unknown> = {
      ...(updateBy.query as Record<string, unknown>),
    };

    if (updateBy.props.tenantId) {
      query["projectId"] = updateBy.props.tenantId;
    }

    return await this.findBy({
      query: query as UpdateBy<Model>["query"],
      select: RULE_SNAPSHOT_SELECT,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * The create-time criteria check, applied to what each rule will look like
   * after this edit. Every rule the edit touches has to survive it.
   */
  private assertUpdateKeepsMatchCriteria(data: {
    updateBy: UpdateBy<Model>;
    rules: Array<Model>;
  }): void {
    const { updateBy } = data;

    const nextLabels: Array<unknown> | undefined = updateBy.data
      .monitorLabels as Array<unknown> | undefined;

    for (const rule of data.rules) {
      this.assertHasMatchCriteria({
        monitorLabelCount: (nextLabels === undefined
          ? rule.monitorLabels || []
          : nextLabels || []
        ).length,
        monitorType:
          updateBy.data.monitorType === undefined
            ? rule.monitorType
            : (updateBy.data.monitorType as MonitorType | undefined),
        monitorNamePattern:
          updateBy.data.monitorNamePattern === undefined
            ? rule.monitorNamePattern
            : (updateBy.data.monitorNamePattern as string | undefined),
        monitorDescriptionPattern:
          updateBy.data.monitorDescriptionPattern === undefined
            ? rule.monitorDescriptionPattern
            : (updateBy.data.monitorDescriptionPattern as string | undefined),
        criteria:
          updateBy.data.criteria === undefined
            ? rule.criteria
            : (updateBy.data.criteria as Model["criteria"]),
      });
    }
  }

  /*
   * Describes a meaningful edit in the SLO feed, and stays silent for an edit
   * that changed nothing a reader would care about. The dashboard's edit form
   * resubmits every field, so presence in the payload proves nothing - the
   * stored row before and after is compared instead.
   */
  private async postRuleChangedFeedItem(data: {
    previous: Model;
    current: Model;
    userId: ObjectID | undefined;
  }): Promise<void> {
    const { previous, current } = data;

    const isNameChanged: boolean =
      (previous.name || "") !== (current.name || "");
    const isDescriptionChanged: boolean =
      (previous.description || "") !== (current.description || "");
    const wasEnabled: boolean = previous.isEnabled !== false;
    const isEnabled: boolean = current.isEnabled !== false;
    const isEnabledChanged: boolean = wasEnabled !== isEnabled;
    const isCriteriaChanged: boolean =
      getSloMonitorRuleCriteriaKey(previous) !==
      getSloMonitorRuleCriteriaKey(current);

    if (
      !isNameChanged &&
      !isDescriptionChanged &&
      !isEnabledChanged &&
      !isCriteriaChanged
    ) {
      return;
    }

    const details: Array<string> = [];

    if (isNameChanged) {
      details.push(
        `- **Name:** ${this.formatRuleName(previous.name)} → ${this.formatRuleName(current.name)}`,
      );
    }

    if (isDescriptionChanged) {
      details.push(
        `- **Description:** ${
          !previous.description
            ? "added"
            : !current.description
              ? "removed"
              : "updated"
        }`,
      );
    }

    if (isEnabledChanged) {
      details.push(
        `- **Status:** ${wasEnabled ? "Enabled" : "Disabled"} → ${isEnabled ? "Enabled" : "Disabled"}`,
      );
    }

    if (isCriteriaChanged) {
      const labelNameById: Map<string, string> = await this.getLabelNamesById([
        ...getSloMonitorRuleLabelIds(previous),
        ...getSloMonitorRuleLabelIds(current),
      ]);

      details.push(
        `- **Match criteria (before):** ${escapeMarkdownInline(
          describeSloMonitorRuleCriteria({
            rule: previous,
            labelNameById: labelNameById,
          }),
        )}`,
      );
      details.push(
        `- **Match criteria (now):** ${escapeMarkdownInline(
          describeSloMonitorRuleCriteria({
            rule: current,
            labelNameById: labelNameById,
          }),
        )}`,
      );
    }

    const isOnlyEnabledChanged: boolean =
      isEnabledChanged &&
      !isNameChanged &&
      !isDescriptionChanged &&
      !isCriteriaChanged;

    await this.postRuleFeedItem({
      rule: current,
      eventType: ServiceLevelObjectiveFeedEventType.MonitorRuleChanged,
      displayColor: Gray500,
      userId: data.userId,
      buildFeedInfoInMarkdown: (sentence: {
        sloLink: string;
        ruleName: string;
      }): string => {
        if (isOnlyEnabledChanged) {
          return isEnabled
            ? `▶️ Enabled monitor rule ${sentence.ruleName} on ${sentence.sloLink}. Monitors it matches are attached to this SLO again.`
            : `⏸️ Disabled monitor rule ${sentence.ruleName} on ${sentence.sloLink}. Monitors only this rule attached are detached.`;
        }

        return `🧩 Updated monitor rule ${sentence.ruleName} on ${sentence.sloLink}.`;
      },
      moreInformationInMarkdown: details.join("\n"),
    });
  }

  /*
   * Posts one rule event to the rule's SLO feed. The rule name and everything
   * else user-controlled is escaped here, once, at the point it becomes
   * markdown. Never throws: the rule is already saved, and a feed item that
   * could not be written must not fail the write it describes.
   */
  private async postRuleFeedItem(data: {
    rule: Model;
    eventType: ServiceLevelObjectiveFeedEventType;
    displayColor: Color;
    userId: ObjectID | undefined;
    buildFeedInfoInMarkdown: BuildRuleFeedSentenceFunction;
    moreInformationInMarkdown?: string | undefined;
  }): Promise<void> {
    const { rule } = data;

    if (!rule.serviceLevelObjectiveId || !rule.projectId) {
      return;
    }

    try {
      const sloLink: string =
        await ServiceLevelObjectiveService.getSloMarkdownLink({
          projectId: rule.projectId,
          sloId: rule.serviceLevelObjectiveId,
        });

      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: rule.serviceLevelObjectiveId,
          projectId: rule.projectId,
          serviceLevelObjectiveFeedEventType: data.eventType,
          displayColor: data.displayColor,
          feedInfoInMarkdown: data.buildFeedInfoInMarkdown({
            sloLink: sloLink,
            ruleName: this.formatRuleName(rule.name),
          }),
          moreInformationInMarkdown:
            data.moreInformationInMarkdown || undefined,
          userId: data.userId || undefined,
        },
      );
    } catch (error) {
      logger.error(
        `Error posting SLO monitor rule feed item for rule ${rule.id?.toString()}: ${error}`,
        { projectId: rule.projectId.toString() } as LogAttributes,
      );
    }
  }

  // "**Production APIs**" - escaped, bold, and never an empty pair of stars.
  private formatRuleName(name: string | undefined): string {
    const escapedName: string = escapeMarkdownInline(name).trim();

    return escapedName ? `**${escapedName}**` : "**an unnamed rule**";
  }

  /*
   * The "more information" half of a MonitorRuleAdded item: whether the rule
   * is on, and what it matches in words.
   */
  private async describeRuleForFeed(rule: Model): Promise<string> {
    const lines: Array<string> = [
      `- **Status:** ${rule.isEnabled === false ? "Disabled" : "Enabled"}`,
    ];

    try {
      const labelNameById: Map<string, string> = await this.getLabelNamesById(
        getSloMonitorRuleLabelIds(rule),
      );

      lines.push(
        `- **Match criteria:** ${escapeMarkdownInline(
          describeSloMonitorRuleCriteria({
            rule: rule,
            labelNameById: labelNameById,
          }),
        )}`,
      );
    } catch (error) {
      logger.error(`Error describing SLO monitor rule criteria: ${error}`);
    }

    if (rule.description) {
      lines.push(
        `- **Description:** ${escapeMarkdownInline(rule.description)}`,
      );
    }

    return lines.join("\n");
  }

  /*
   * Label names for a feed description. Criteria rules store label ids only,
   * so their names are looked up; a lookup that fails leaves the ids to be
   * described as unknown labels rather than losing the feed item.
   */
  private async getLabelNamesById(
    labelIds: Array<string>,
  ): Promise<Map<string, string>> {
    const labelNameById: Map<string, string> = new Map<string, string>();

    const uniqueLabelIds: Array<string> = Array.from(
      new Set<string>(labelIds),
    ).filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    if (uniqueLabelIds.length === 0) {
      return labelNameById;
    }

    try {
      const labels: Array<Label> = await LabelService.findBy({
        query: {
          _id: QueryHelper.any(uniqueLabelIds),
        },
        select: {
          _id: true,
          name: true,
        },
        limit: uniqueLabelIds.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const label of labels) {
        const id: string = label.id?.toString() || "";

        if (id && label.name) {
          labelNameById.set(id, label.name);
        }
      }
    } catch (error) {
      logger.error(
        `Error looking up label names for an SLO monitor rule feed item: ${error}`,
      );
    }

    return labelNameById;
  }

  private async findRuleSnapshotQuietly(id: ObjectID): Promise<Model | null> {
    try {
      return await this.findOneById({
        id: id,
        select: RULE_SNAPSHOT_SELECT,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        `Error reading SLO monitor rule ${id.toString()} back after create: ${error}`,
      );
      return null;
    }
  }

  // De-duplicated SLO ids, in the order the rules first mention them.
  private uniqueServiceLevelObjectiveIds(rules: Array<Model>): Array<ObjectID> {
    const idsByValue: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const rule of rules) {
      const id: ObjectID | undefined = rule.serviceLevelObjectiveId;

      if (id && !idsByValue.has(id.toString().toLowerCase())) {
        idsByValue.set(id.toString().toLowerCase(), id);
      }
    }

    return Array.from(idsByValue.values());
  }

  /**
   * Rule CRUD must not fail because the sync did. The rule is already saved
   * and the next rule edit, or the next change to a monitor, re-runs it.
   */
  private async syncQuietly(serviceLevelObjectiveId: ObjectID): Promise<void> {
    try {
      await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo({
        serviceLevelObjectiveId: serviceLevelObjectiveId,
      });
    } catch (error) {
      logger.error(
        `Error syncing monitor rules for SLO ${serviceLevelObjectiveId.toString()}: ${error}`,
        {
          serviceLevelObjectiveId: serviceLevelObjectiveId.toString(),
        } as LogAttributes,
      );
    }
  }
}

export default new Service();
