import Model from "../../Models/DatabaseModels/CloudCostView";
import {
  CloudCostViewGrouping,
  isCloudCostViewGrouping,
} from "../../Types/Cloud/CloudCostAllocation";
import { CLOUD_COST_TAG_KEY_MAX_LENGTH } from "../../Types/Cloud/CloudCost";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * Cost views (CloudCostView). This guards how a view's groups are made as
 * it is written - by hand, per value of a tag (which needs the tag's key),
 * or per owner team - and, for a view whose groups OneUptime makes, makes
 * them right after the save, so the view sorts the spend at once
 * (CloudCostViewSync). The hourly job keeps them in step afterwards.
 */

export const CLOUD_COST_VIEW_GROUPING_ERROR: string =
  "Choose how the view's groups are made: Rules, TagValue or OwnerTeam.";
export const CLOUD_COST_VIEW_TAG_KEY_ERROR: string =
  "A view with one group per tag value needs the tag's key, such as team or cost-center.";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public normalizeGrouping(value: unknown): CloudCostViewGrouping {
    if (value === null || value === undefined || value === "") {
      return CloudCostViewGrouping.Rules;
    }

    if (!isCloudCostViewGrouping(value)) {
      throw new BadDataException(CLOUD_COST_VIEW_GROUPING_ERROR);
    }

    return value;
  }

  // A tag's key as a view keeps it: trimmed, as the clouds write it.
  public normalizeTagKey(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    const key: string = String(value).trim();

    if (key.length > CLOUD_COST_TAG_KEY_MAX_LENGTH) {
      throw new BadDataException(
        `A tag's key is at most ${CLOUD_COST_TAG_KEY_MAX_LENGTH} characters.`,
      );
    }

    return key || undefined;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    createBy.data.grouping = this.normalizeGrouping(createBy.data.grouping);
    (createBy.data as { tagKey?: string | undefined }).tagKey =
      this.normalizeTagKey(createBy.data.tagKey);

    if (
      createBy.data.grouping === CloudCostViewGrouping.TagValue &&
      !createBy.data.tagKey
    ) {
      throw new BadDataException(CLOUD_COST_VIEW_TAG_KEY_ERROR);
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.grouping !== undefined) {
      updateBy.data.grouping = this.normalizeGrouping(updateBy.data.grouping);
    }

    if (updateBy.data.tagKey !== undefined) {
      (updateBy.data as { tagKey?: string | null }).tagKey =
        this.normalizeTagKey(updateBy.data.tagKey) || null;
    }

    /*
     * A view made per tag value keeps a key: one asked to be made so, or
     * whose key is taken away, is read with what it holds now.
     */
    if (
      updateBy.data.grouping === CloudCostViewGrouping.TagValue ||
      (updateBy.data.tagKey !== undefined && !updateBy.data.tagKey)
    ) {
      const views: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: { _id: true, grouping: true, tagKey: true },
        props: { isRoot: true },
        limit: 100,
        skip: 0,
      });

      for (const view of views) {
        const grouping: CloudCostViewGrouping | undefined =
          (updateBy.data.grouping as CloudCostViewGrouping | undefined) ||
          view.grouping;
        const tagKey: string | undefined =
          updateBy.data.tagKey !== undefined
            ? (updateBy.data.tagKey as string | null) || undefined
            : view.tagKey;

        if (grouping === CloudCostViewGrouping.TagValue && !tagKey) {
          throw new BadDataException(CLOUD_COST_VIEW_TAG_KEY_ERROR);
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (
      createdItem.id &&
      createdItem.grouping &&
      createdItem.grouping !== CloudCostViewGrouping.Rules
    ) {
      this.makeGroupsSoon(createdItem.id);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.grouping !== undefined ||
      onUpdate.updateBy.data.tagKey !== undefined
    ) {
      for (const id of updatedItemIds) {
        this.makeGroupsSoon(id);
      }
    }

    return onUpdate;
  }

  /*
   * The groups a view made per tag value or owner team holds, made right
   * after the write without making it wait: a failure is logged, and the
   * hourly job catches up. Loaded when needed: the sync reads this service.
   */
  private makeGroupsSoon(viewId: ObjectID): void {
    const make: () => Promise<void> = async (): Promise<void> => {
      const sync: typeof import("../Utils/CloudCost/CloudCostViewSync") =
        await import("../Utils/CloudCost/CloudCostViewSync");
      await sync.default.makeGroupsForView(viewId);
    };

    make().catch((error: unknown) => {
      logger.error(
        `Cost view ${viewId.toString()}'s groups could not be made after it was saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}

export default new Service();
