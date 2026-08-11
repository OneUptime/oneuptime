import DatabaseService from "../../../../Services/DatabaseService";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import Text from "../../../../../Types/Text";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import { applyTenantColumn } from "./ModelArguments";

export default class CreateManyBaseModel<
  TBaseModel extends BaseModel,
> extends ComponentCode {
  private modelService: DatabaseService<TBaseModel> | null = null;

  public constructor(modelService: DatabaseService<TBaseModel>) {
    super();

    const BaseModelComponent: ComponentMetadata | undefined =
      BaseModelComponents.getComponents(modelService.getModel()).find(
        (i: ComponentMetadata) => {
          return (
            i.id ===
            `${Text.pascalCaseToDashes(
              modelService.getModel().tableName!,
            )}-create-many`
          );
        },
      );

    if (!BaseModelComponent) {
      throw new BadDataException(
        "Create many component for " +
          modelService.getModel().tableName +
          " not found.",
      );
    }

    this.setMetadata(BaseModelComponent);
    this.modelService = modelService;
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "success";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "error";
      },
    );

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    try {
      if (!this.modelService) {
        throw options.onError(
          new BadDataException("modelService is undefined."),
        );
      }

      if (!args["json-array"]) {
        throw options.onError(new BadDataException("json-array is undefined."));
      }

      if (typeof args["json-array"] === "string") {
        args["json-array"] = JSONFunctions.parse(args["json-array"] as string);
      }

      if (!Array.isArray(args["json-array"])) {
        throw options.onError(
          new BadDataException("json-array is should be of type object."),
        );
      }

      const array: Array<TBaseModel> = [];

      /*
       * This loop used to sit inside an `if (getTenantColumn())` check that
       * was only meant to guard the projectId stamping, so a model without a
       * tenant column created nothing at all and still reported success.
       */
      for (const item of args["json-array"]) {
        const json: JSONObject = applyTenantColumn(
          (item as JSONObject) || {},
          this.modelService.getModel(),
          options.projectId,
        );

        array.push(
          (await this.modelService.create({
            data: BaseModel.fromJSON<TBaseModel>(
              json,
              this.modelService.modelType,
            ) as TBaseModel,
            props: {
              isRoot: true,
              tenantId: options.projectId,
            },
          })) as TBaseModel,
        );
      }

      return {
        returnValues: {
          models: BaseModel.toJSONArray(array, this.modelService.modelType),
        },
        executePort: successPort,
      };
    } catch (err: any) {
      options.log("Error running component");
      options.log(err.message ? err.message : JSON.stringify(err, null, 2));
      return {
        returnValues: {},
        executePort: errorPort,
      };
    }
  }
}
