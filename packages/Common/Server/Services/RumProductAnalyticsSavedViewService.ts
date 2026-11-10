import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX,
  PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS,
  ProductAnalyticsDefinitionRead,
  ProductAnalyticsSavedViewType,
  getProductAnalyticsSavedViewNameProblem,
  isProductAnalyticsSavedViewType,
  readProductAnalyticsSavedViewDefinition,
  toProductAnalyticsSavedViewName,
} from "../../Types/Rum/ProductAnalyticsSavedViews";

/*
 * Saved funnels and retention tables (issue #6630,
 * Models/DatabaseModels/RumProductAnalyticsSavedView).
 *
 * A definition is kept only as the read routes would take it
 * (Types/Rum/ProductAnalyticsSavedViews): a widget that reads it later
 * never meets a step, a window or a segment the read refuses, and nothing
 * a caller sent besides the definition's own fields is stored. A name is
 * kept trimmed, and is never blank. What a saved view is - a funnel or a
 * retention table - and whose it is are kept as they were saved (their
 * columns cannot be updated). An application keeps at most
 * PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX of each kind: the
 * pages read the whole list.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /* The definition as it is kept, or the first thing wrong with it, as a 400. */
  public static readDefinition(
    viewType: unknown,
    definition: unknown,
  ): JSONObject {
    if (!isProductAnalyticsSavedViewType(viewType)) {
      throw new BadDataException(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.viewType);
    }

    if (definition === undefined || definition === null) {
      throw new BadDataException(
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.definition,
      );
    }

    const read: ProductAnalyticsDefinitionRead<unknown> =
      readProductAnalyticsSavedViewDefinition(viewType, definition);

    if (read.problem !== null) {
      throw new BadDataException(read.problem);
    }

    return read.definition as JSONObject;
  }

  /* A name as it is kept: trimmed, and there. */
  public static readName(name: unknown): string {
    const problem: string | null =
      getProductAnalyticsSavedViewNameProblem(name);

    if (problem) {
      throw new BadDataException(problem);
    }

    return toProductAnalyticsSavedViewName(name);
  }

  private async assertApplicationHasRoom(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    viewType: ProductAnalyticsSavedViewType;
  }): Promise<void> {
    const count: PositiveNumber = await this.countBy({
      query: {
        projectId: data.projectId,
        rumApplicationId: data.rumApplicationId,
        viewType: data.viewType,
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() >= PRODUCT_ANALYTICS_SAVED_VIEWS_PER_APPLICATION_MAX) {
      throw new BadDataException(PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.tooMany);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const viewType: unknown = createBy.data.viewType;

    createBy.data.name = Service.readName(createBy.data.name);
    createBy.data.definition = Service.readDefinition(
      viewType,
      createBy.data.definition,
    );

    const projectId: ObjectID | undefined =
      createBy.data.projectId ||
      (createBy.props.tenantId as ObjectID | undefined);

    if (projectId && createBy.data.rumApplicationId) {
      await this.assertApplicationHasRoom({
        projectId: projectId,
        rumApplicationId: createBy.data.rumApplicationId,
        viewType: viewType as ProductAnalyticsSavedViewType,
      });
    }

    return { createBy, carryForward: null };
  }

  /*
   * A rename is checked as a name; a new definition as one of the kind the
   * saved view is, read from the rows the update writes. An update that
   * names a kind names the one each row already is, or is refused.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["name"] !== undefined) {
      data["name"] = Service.readName(data["name"]);
    }

    if (data["definition"] === undefined && data["viewType"] === undefined) {
      return { updateBy, carryForward: null };
    }

    if (data["definition"] === null) {
      throw new BadDataException(
        PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.definition,
      );
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        viewType: true,
      },
    );

    const kinds: Set<string> = new Set<string>();

    for (const row of rows) {
      if (
        data["viewType"] !== undefined &&
        data["viewType"] !== row.viewType
      ) {
        throw new BadDataException(
          PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.viewTypeFixed,
        );
      }

      kinds.add(String(row.viewType));
    }

    if (data["definition"] !== undefined) {
      if (kinds.size > 1) {
        throw new BadDataException(
          PRODUCT_ANALYTICS_SAVED_VIEW_PROBLEMS.oneKindAtATime,
        );
      }

      const kind: string | undefined = Array.from(kinds)[0];

      if (kind !== undefined) {
        data["definition"] = Service.readDefinition(kind, data["definition"]);
      }
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
