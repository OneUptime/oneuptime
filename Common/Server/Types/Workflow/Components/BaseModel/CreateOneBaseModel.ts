import DatabaseService from "../../../../Services/DatabaseService";
import logger from "../../../../Utils/Logger";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import Text from "../../../../../Types/Text";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class CreateOneBaseModel<
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
            )}-create-one`
          );
        },
      );

    if (!BaseModelComponent) {
      throw new BadDataException(
        "Create one component for " +
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

      if (!args["json"]) {
        throw options.onError(new BadDataException("JSON is undefined."));
      }

      if (typeof args["json"] === "string") {
        args["json"] = JSONFunctions.parse(args["json"] as string);
      }

      if (typeof args["json"] !== "object") {
        throw options.onError(
          new BadDataException("JSON is should be of type object."),
        );
      }

      if (this.modelService.getModel().getTenantColumn()) {
        (args["json"] as JSONObject)[
          this.modelService.getModel().getTenantColumn() as string
        ] = options.projectId;
      }

      const model: TBaseModel = (await this.modelService.create({
        data: BaseModel.fromJSON<TBaseModel>(
          (args["json"] as JSONObject) || {},
          this.modelService.modelType,
        ) as TBaseModel,
        props: {
          isRoot: true,
          tenantId: options.projectId,
        },
      })) as TBaseModel;

      return {
        returnValues: {
          model: BaseModel.toJSON(model, this.modelService.modelType),
        },
        executePort: successPort,
      };
    } catch (err: any) {
      logger.error(err);

      if (err instanceof Exception) {
        options.log(err.getMessage());
      } else {
        options.log(err.message ? err.message : JSON.stringify(err, null, 2));
      }

      return {
        returnValues: {},
        executePort: errorPort,
      };
    }
  }
}
