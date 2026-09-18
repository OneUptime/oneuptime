import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LogPipelineProcessor";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import { validateLogPipelineProcessor } from "../Utils/LogPipelineProcessorValidation";

/*
 * `PartialEntity` values may be `() => string` raw SQL expressions rather
 * than literals. One cannot be evaluated here, so an update that sets a
 * validated field to an expression is skipped - validating a stringified
 * function would be worse than not validating at all. Nothing in the
 * product writes processor fields this way.
 */
function isSqlExpressionValue(value: unknown): boolean {
  return typeof value === "function";
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    validateLogPipelineProcessor({
      processorType: createBy.data.processorType,
      configuration: createBy.data.configuration as JSONObject | undefined,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * An edit can break a row without naming both fields: switching
     * `processorType` to GrokParser while the stored configuration is
     * still a severity-remapper blob, or replacing the pattern on a row
     * that is already a GrokParser. So validate the MERGED row.
     *
     * Only pay for the SELECT when the update touches one of them.
     * Processor edits are rare, human-driven config changes - this is
     * not a hot path.
     */
    const incomingProcessorType: unknown = updateBy.data.processorType;
    const incomingConfiguration: unknown = updateBy.data.configuration;

    if (
      incomingProcessorType === undefined &&
      incomingConfiguration === undefined
    ) {
      return { updateBy, carryForward: null };
    }

    if (
      isSqlExpressionValue(incomingProcessorType) ||
      isSqlExpressionValue(incomingConfiguration)
    ) {
      return { updateBy, carryForward: null };
    }

    const existingRows: Array<Model> = await this.findBy({
      query: updateBy.query,
      skip: 0,
      limit: LIMIT_MAX,
      select: {
        _id: true,
        processorType: true,
        configuration: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const existing of existingRows) {
      validateLogPipelineProcessor({
        processorType:
          incomingProcessorType !== undefined
            ? (incomingProcessorType as string | null)
            : existing.processorType,
        configuration:
          incomingConfiguration !== undefined
            ? (incomingConfiguration as JSONObject | string | null)
            : (existing.configuration as JSONObject | undefined),
      });
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
