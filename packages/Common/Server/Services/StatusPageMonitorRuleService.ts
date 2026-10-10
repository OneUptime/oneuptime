import ProjectReferencesService from "./ProjectReferencesService";
import StatusPageMonitorRuleEngineService from "./StatusPageMonitorRuleEngineService";
import StatusPageGroupService from "./StatusPageGroupService";
import StatusPageResourceService from "./StatusPageResourceService";
import StatusPageService from "./StatusPageService";
import Model from "../../Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectScopedReferenceValidator from "../Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import StatusPageMonitorRulePatternValidator from "../Utils/StatusPage/MonitorRulePatternValidator";
import logger, { LogAttributes } from "../Utils/Logger";
import {
  getRuleCriteriaValidationError,
  isValidRuleCriteria,
} from "../../Utils/Rules/RuleCriteriaMatcher";

/*
 * The two names of a rule's page and of its group, ID column first. A write
 * may name each under either, and the two must agree
 * (RelationIdUtil.readConsistent), so the page and the group checked are the
 * ones stored.
 */
const STATUS_PAGE_KEYS: Array<string> = ["statusPageId", "statusPage"];
const STATUS_PAGE_GROUP_KEYS: Array<string> = [
  "statusPageGroupId",
  "statusPageGroup",
];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The page and its group are checked by assertReferencesAreInScope, which
   * also holds the group to the page. The generic check covers the rest.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["statusPage", "statusPageGroup"];
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeCreate(createBy);

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    const statusPageId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      STATUS_PAGE_KEYS,
      "Status Page",
    );

    const statusPageGroupId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      STATUS_PAGE_GROUP_KEYS,
      "Status Page Group",
    );

    if (!statusPageId) {
      throw new BadDataException(
        "Status Page ID is required to create a status page monitor rule.",
      );
    }

    this.assertHasMatchCriteria({
      monitorLabelCount: (createBy.data.monitorLabels || []).length,
      monitorNamePattern: createBy.data.monitorNamePattern,
      monitorDescriptionPattern: createBy.data.monitorDescriptionPattern,
      criteria: createBy.data.criteria,
    });

    StatusPageMonitorRulePatternValidator.validate({
      namePattern: createBy.data.monitorNamePattern,
      descriptionPattern: createBy.data.monitorDescriptionPattern,
    });

    await this.assertReferencesAreInScope({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      statusPageId: statusPageId,
      statusPageGroupId: statusPageGroupId || undefined,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Backfill: a rule the user just wrote should populate the page with the
     * monitors that already match, not only with ones created after it.
     */
    if (createdItem.id) {
      await this.syncQuietly(createdItem.id);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    StatusPageMonitorRulePatternValidator.validate({
      namePattern: updateBy.data.monitorNamePattern as string | undefined,
      descriptionPattern: updateBy.data.monitorDescriptionPattern as
        | string
        | undefined,
    });

    /*
     * An edit can empty a rule out just as easily as a create can, and the
     * result is the same useless rule. The merged view is what matters, so
     * fields the edit does not mention are read back off the stored row -
     * clearing only the labels on a rule that also has a name pattern is
     * perfectly fine, and must not be refused.
     */
    await this.assertUpdateKeepsMatchCriteria(updateBy);

    /*
     * Re-pointing a rule at a different group is an ordinary edit, so the same
     * scope checks the create path makes apply here. statusPageId is
     * create-only in the column ACL, so only the group can move.
     */
    const nextGroupId: ObjectID | null = RelationIdUtil.readConsistent(
      updateBy.data as unknown as Record<string, unknown>,
      STATUS_PAGE_GROUP_KEYS,
      "Status Page Group",
    );

    if (nextGroupId) {
      for (const rule of await this.findRulesForQuery(updateBy)) {
        await this.assertReferencesAreInScope({
          projectId: updateBy.props.tenantId || rule.projectId,
          statusPageId: rule.statusPageId,
          statusPageGroupId: nextGroupId,
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Every editable field on this model changes what the rule matches or how
     * the resources it owns are rendered, so any edit re-runs the rule. The
     * sync is idempotent, so re-running it after a no-op edit costs a read.
     */
    for (const id of updatedItemIds) {
      await this.syncQuietly(id);
    }

    return onUpdate;
  }

  /**
   * Deleting a rule undoes it: the resources it added go too, and the monitors
   * it was publishing are offered to the rules that survive.
   *
   * Every destructive step lives here rather than in onBeforeDelete, because
   * DatabaseService applies checkDeleteQueryPermission *after* onBeforeDelete.
   * A hook there sees the caller's raw, un-tenant-scoped query, so a
   * root-privileged write from it would let a caller destroy another project's
   * status page resources by naming that project's rule id, with the
   * permission check only rejecting the (already moot) rule delete afterwards.
   * `itemIdsBeforeDelete` is the permission-checked set, so acting on it is
   * safe.
   *
   * By this point the StatusPageResource -> StatusPageMonitorRule foreign key
   * has usually already cascaded the resources away, which makes the removal
   * pass belt-and-braces rather than the primary mechanism. It is kept so the
   * behaviour does not depend on the cascade staying as it is — and it is also
   * why the monitor ids come from carryForward: after the cascade there is
   * nothing left to read them off.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const monitorIdsByRuleId: Record<string, Array<string>> = (
      onDelete.carryForward as {
        monitorIdsByRuleId?: Record<string, Array<string>>;
      } | null
    )?.monitorIdsByRuleId || {};

    for (const statusPageMonitorRuleId of itemIdsBeforeDelete) {
      try {
        await StatusPageMonitorRuleEngineService.removeResourcesAddedByRule({
          statusPageMonitorRuleId: statusPageMonitorRuleId,
        });
      } catch (error) {
        logger.error(
          `Error removing resources added by status page monitor rule ${statusPageMonitorRuleId.toString()}: ${error}`,
          {
            statusPageMonitorRuleId: statusPageMonitorRuleId.toString(),
          } as LogAttributes,
        );
      }

      /*
       * Deleting a rule must behave like disabling one. Disabling routes
       * through syncResourcesForRule, which hands each released monitor to the
       * other rules on the page; without this, deleting would instead drop a
       * monitor that a sibling rule still claims — the same rule, switched off
       * two different ways, giving two different pages.
       */
      for (const monitorId of monitorIdsByRuleId[
        statusPageMonitorRuleId.toString()
      ] || []) {
        try {
          await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
            monitorId: new ObjectID(monitorId),
            projectId: onDelete.deleteBy.props.tenantId as ObjectID | undefined,
          });
        } catch (error) {
          logger.error(
            `Error re-homing monitor ${monitorId} after status page monitor rule ${statusPageMonitorRuleId.toString()} was deleted: ${error}`,
            { monitorId: monitorId } as LogAttributes,
          );
        }
      }
    }

    return onDelete;
  }

  /**
   * Notes down which monitors each doomed rule is publishing, so
   * onDeleteSuccess can offer them to the rules that survive.
   *
   * This has to happen before the delete because the StatusPageResource ->
   * StatusPageMonitorRule foreign key is ON DELETE CASCADE: by the time the
   * rule row is gone, so are the resources that named the monitors.
   *
   * It is READ ONLY, and reads through the caller's own props rather than as
   * root. onBeforeDelete runs before checkDeleteQueryPermission, so anything
   * here sees the caller's raw query — a root-privileged write from this hook
   * would let a caller destroy another project's status page resources by
   * naming that project's rule id.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const monitorIdsByRuleId: Record<string, Array<string>> = {};

    // The rules the delete removes, and the delete held to them.
    const rules: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
      },
    );

    try {
      for (const rule of rules) {
        if (!rule.id) {
          continue;
        }

        const resources: Array<StatusPageResource> =
          await StatusPageResourceService.findBy({
            query: {
              statusPageMonitorRuleId: rule.id,
            },
            select: {
              monitorId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

        monitorIdsByRuleId[rule.id.toString()] = resources
          .map((resource: StatusPageResource) => {
            return resource.monitorId?.toString() || "";
          })
          .filter((monitorId: string) => {
            return monitorId !== "";
          });
      }
    } catch (error) {
      /*
       * Best effort. Failing to note the monitors down must not block the
       * delete; the worst case is that a sibling rule re-adopts them on its
       * next run instead of immediately.
       */
      logger.error(
        `Error collecting monitors published by status page monitor rules before delete: ${error}`,
      );
    }

    return { deleteBy, carryForward: { monitorIdsByRuleId } };
  }

  /**
   * A rule points at a status page, and optionally at a group on that page.
   * Neither is checked by the framework, and both decide what ends up on a
   * PUBLIC page, so both are checked here:
   *
   *   - a status page from another project would let one tenant publish its
   *     monitors on another tenant's status page;
   *   - a group belonging to a different status page would produce resources
   *     that render nowhere, because the page only draws groups that are its
   *     own — a rule that silently adds invisible monitors.
   */
  private async assertReferencesAreInScope(data: {
    projectId: ObjectID | undefined;
    statusPageId: ObjectID | string | undefined;
    statusPageGroupId: ObjectID | string | undefined;
  }): Promise<void> {
    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: data.projectId,
      subject: "status page monitor rule",
      references: [
        {
          modelName: "Status Page",
          id: data.statusPageId,
          service: StatusPageService,
        },
        {
          modelName: "Status Page Group",
          id: data.statusPageGroupId,
          service: StatusPageGroupService,
        },
      ],
    });

    if (!data.statusPageGroupId || !data.statusPageId) {
      return;
    }

    const group: StatusPageGroup | null =
      await StatusPageGroupService.findOneById({
        id: new ObjectID(data.statusPageGroupId.toString()),
        select: {
          _id: true,
          statusPageId: true,
        },
        props: {
          isRoot: true,
        },
      });

    /*
     * A group id that matches no row at all is left to the foreign key to
     * report, the same call the project-scope validator above makes.
     */
    if (!group) {
      return;
    }

    if (group.statusPageId?.toString() !== data.statusPageId.toString()) {
      throw new BadDataException(
        "The group this rule adds monitors to belongs to a different status page. Pick a group on the status page the rule is for.",
      );
    }
  }

  /**
   * A rule with no criteria would claim every monitor in the project. An empty
   * form is much more likely to be an unfinished one, and the cost of guessing
   * wrong is a private monitor on a public page — so say so instead.
   */
  private assertHasMatchCriteria(data: {
    monitorLabelCount: number;
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
        return;
      }

      throw new BadDataException(
        "A status page monitor rule needs at least one match condition.",
      );
    }

    if (
      data.monitorLabelCount === 0 &&
      !data.monitorNamePattern &&
      !data.monitorDescriptionPattern
    ) {
      throw new BadDataException(
        "A status page monitor rule needs at least one match criterion: monitor labels, a monitor name pattern, or a monitor description pattern. Use .* as the name pattern to match every monitor.",
      );
    }
  }

  /**
   * The rules an update actually touches, read for validation.
   *
   * They are the rows the update writes - for a teammate, the rules they may
   * write - and the update is held to them (findRowsAndHoldUpdateToThem), so
   * a validation read never answers questions about another project's rules,
   * and no rule is written that was not validated.
   */
  private async findRulesForQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<Model>> {
    return await this.findRowsAndHoldUpdateToThem(updateBy, {
      _id: true,
      projectId: true,
      statusPageId: true,
      monitorLabels: {
        _id: true,
      },
      monitorNamePattern: true,
      monitorDescriptionPattern: true,
      criteria: true,
    });
  }

  /**
   * The create-time criteria check, applied to what the rule will look like
   * after this edit. Every rule the edit touches has to survive it.
   */
  private async assertUpdateKeepsMatchCriteria(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const touchesCriteria: boolean =
      updateBy.data.monitorLabels !== undefined ||
      updateBy.data.monitorNamePattern !== undefined ||
      updateBy.data.monitorDescriptionPattern !== undefined ||
      updateBy.data.criteria !== undefined;

    if (!touchesCriteria) {
      return;
    }

    const rules: Array<Model> = await this.findRulesForQuery(updateBy);

    const nextLabels: Array<unknown> | undefined = updateBy.data
      .monitorLabels as Array<unknown> | undefined;

    for (const rule of rules) {
      this.assertHasMatchCriteria({
        monitorLabelCount: (nextLabels === undefined
          ? rule.monitorLabels || []
          : nextLabels
        ).length,
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

  /**
   * Rule CRUD must not fail because the sync did. The rule is already saved
   * and the next monitor change (or the next edit) re-runs it.
   */
  private async syncQuietly(statusPageMonitorRuleId: ObjectID): Promise<void> {
    try {
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: statusPageMonitorRuleId,
      });
    } catch (error) {
      logger.error(
        `Error syncing status page monitor rule ${statusPageMonitorRuleId.toString()}: ${error}`,
        {
          statusPageMonitorRuleId: statusPageMonitorRuleId.toString(),
        } as LogAttributes,
      );
    }
  }
}

export default new Service();
