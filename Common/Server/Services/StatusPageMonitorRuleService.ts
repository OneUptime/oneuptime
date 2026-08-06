import DatabaseService from "./DatabaseService";
import StatusPageMonitorRuleEngineService from "./StatusPageMonitorRuleEngineService";
import Model from "../../Models/DatabaseModels/StatusPageMonitorRule";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.statusPageId) {
      throw new BadDataException(
        "Status Page ID is required to create a status page monitor rule.",
      );
    }

    this.assertHasMatchCriteria({
      monitorLabelCount: (createBy.data.monitorLabels || []).length,
      monitorNamePattern: createBy.data.monitorNamePattern,
      monitorDescriptionPattern: createBy.data.monitorDescriptionPattern,
    });

    this.assertValidRegex(createBy.data.monitorNamePattern, "name");
    this.assertValidRegex(
      createBy.data.monitorDescriptionPattern,
      "description",
    );

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
    this.assertValidRegex(
      updateBy.data.monitorNamePattern as string | undefined,
      "name",
    );
    this.assertValidRegex(
      updateBy.data.monitorDescriptionPattern as string | undefined,
      "description",
    );

    /*
     * An edit can empty a rule out just as easily as a create can, and the
     * result is the same useless rule. The merged view is what matters, so
     * fields the edit does not mention are read back off the stored row -
     * clearing only the labels on a rule that also has a name pattern is
     * perfectly fine, and must not be refused.
     */
    await this.assertUpdateKeepsMatchCriteria(updateBy);

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

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * Resources are removed while the rule still exists, so the removal goes
     * through StatusPageResourceService and its hooks rather than through the
     * foreign key's cascade. Deleting a rule undoes the rule.
     */
    const rules: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const rule of rules) {
      if (!rule.id) {
        continue;
      }

      try {
        await StatusPageMonitorRuleEngineService.removeResourcesAddedByRule({
          statusPageMonitorRuleId: rule.id,
        });
      } catch (error) {
        logger.error(
          `Error removing resources added by status page monitor rule ${rule.id.toString()}: ${error}`,
          {
            statusPageMonitorRuleId: rule.id.toString(),
          } as LogAttributes,
        );
      }
    }

    return { deleteBy, carryForward: null };
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
  }): void {
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
   * The create-time criteria check, applied to what the rule will look like
   * after this edit. Every rule the edit touches has to survive it.
   */
  private async assertUpdateKeepsMatchCriteria(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const touchesCriteria: boolean =
      updateBy.data.monitorLabels !== undefined ||
      updateBy.data.monitorNamePattern !== undefined ||
      updateBy.data.monitorDescriptionPattern !== undefined;

    if (!touchesCriteria) {
      return;
    }

    const rules: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        monitorLabels: {
          _id: true,
        },
        monitorNamePattern: true,
        monitorDescriptionPattern: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

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
      });
    }
  }

  private assertValidRegex(pattern: string | undefined, field: string): void {
    if (!pattern) {
      return;
    }

    try {
      new RegExp(pattern, "i");
    } catch {
      throw new BadDataException(
        `The monitor ${field} pattern is not a valid regular expression: ${pattern}`,
      );
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
