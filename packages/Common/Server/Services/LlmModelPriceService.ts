import Model from "../../Models/DatabaseModels/LlmModelPrice";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";

const MODEL_PREFIX_ERROR_MESSAGE: string =
  "Model prefix is required and cannot be empty.";
const PRICE_ERROR_MESSAGE: string =
  "must be a number greater than or equal to 0.";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Numeric columns can arrive as strings: the dashboard's number fields
     * hand Formik `e.target.value`, ModelForm copies it verbatim and
     * BaseModel.fromJSON does not coerce Number/Decimal columns. Coerce,
     * validate, then write the number back onto the payload so Postgres never
     * sees a string either. Same convention as LlmCostBudgetService.
     */
    createBy.data.modelPrefix = this.validateModelPrefix(
      createBy.data.modelPrefix,
    );

    createBy.data.inputPricePerMillionTokensInUSD = this.validatePrice(
      createBy.data.inputPricePerMillionTokensInUSD,
      "Input price",
    );

    createBy.data.outputPricePerMillionTokensInUSD = this.validatePrice(
      createBy.data.outputPricePerMillionTokensInUSD,
      "Output price",
    );

    if (createBy.data.projectId) {
      await this.throwIfDuplicatePrefix({
        projectId: createBy.data.projectId,
        modelPrefix: createBy.data.modelPrefix,
      });
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // Same string-arrival path as onBeforeCreate: coerce, validate, write back.
    const newPrefix: unknown = updateBy.data.modelPrefix as unknown;

    /*
     * The validated prefix is held in a string-typed local because the
     * model's update-data field type is `string | (() => string)` (it
     * allows the deferred function form), so reading it back below would
     * otherwise not narrow to the plain string throwIfDuplicatePrefix wants.
     */
    let validatedPrefix: string | undefined = undefined;

    if (newPrefix !== undefined && newPrefix !== null) {
      validatedPrefix = this.validateModelPrefix(newPrefix);
      updateBy.data.modelPrefix = validatedPrefix;
    }

    const newInputPrice: unknown = updateBy.data
      .inputPricePerMillionTokensInUSD as unknown;

    if (newInputPrice !== undefined && newInputPrice !== null) {
      updateBy.data.inputPricePerMillionTokensInUSD = this.validatePrice(
        newInputPrice,
        "Input price",
      );
    }

    const newOutputPrice: unknown = updateBy.data
      .outputPricePerMillionTokensInUSD as unknown;

    if (newOutputPrice !== undefined && newOutputPrice !== null) {
      updateBy.data.outputPricePerMillionTokensInUSD = this.validatePrice(
        newOutputPrice,
        "Output price",
      );
    }

    // Renaming a prefix must not collide with another entry of the project.
    if (validatedPrefix) {
      const itemsToUpdate: Array<Model> = await this.findBy({
        query: updateBy.query,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      for (const item of itemsToUpdate) {
        if (!item.projectId) {
          continue;
        }

        await this.throwIfDuplicatePrefix({
          projectId: item.projectId,
          modelPrefix: validatedPrefix,
          excludeId: item.id || undefined,
        });
      }
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  /*
   * Two entries with the same prefix would make the ingest-time price lookup
   * ambiguous (first-loaded wins), so reject the duplicate at write time
   * instead of silently pricing with one of them.
   */
  private async throwIfDuplicatePrefix(data: {
    projectId: ObjectID;
    modelPrefix: string;
    excludeId?: ObjectID | undefined;
  }): Promise<void> {
    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        modelPrefix: data.modelPrefix,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!existing) {
      return;
    }

    if (
      data.excludeId &&
      existing.id?.toString() === data.excludeId.toString()
    ) {
      return;
    }

    throw new BadDataException(
      `A price for the model prefix "${data.modelPrefix}" already exists in this project.`,
    );
  }

  /*
   * Prefixes are matched lowercase against normalized model names
   * (LlmCostCatalogUtil), so store them lowercase — otherwise an entry saved
   * as "GPT-4o" would never match anything.
   */
  private validateModelPrefix(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadDataException(MODEL_PREFIX_ERROR_MESSAGE);
    }

    return value.trim().toLowerCase();
  }

  private validatePrice(value: unknown, label: string): number {
    let price: number | null = null;

    if (typeof value === "number") {
      price = value;
    } else if (typeof value === "string" && value.trim() !== "") {
      price = Number(value);
    }

    if (price === null || !isFinite(price) || price < 0) {
      throw new BadDataException(`${label} ${PRICE_ERROR_MESSAGE}`);
    }

    return price;
  }
}

export default new Service();
