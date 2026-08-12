import DatabaseService from "../../../../Services/DatabaseService";
import Query from "../../../Database/Query";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import QueryDeepPartialEntity from "../../../../../Types/Database/PartialEntity";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import Text from "../../../../../Types/Text";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import { applyTenantColumn, normalizeModelKeys } from "./ModelArguments";
import logComponentError from "./LogComponentError";

export default class UpdateOneBaseModel<
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
            )}-update-one`
          );
        },
      );

    if (!BaseModelComponent) {
      throw new BadDataException(
        "Update one component for " +
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

      if (!args["data"]) {
        throw options.onError(new BadDataException("JSON is undefined."));
      }

      if (typeof args["data"] === "string") {
        args["data"] = JSONFunctions.parse(args["data"] as string);
      }

      if (typeof args["data"] !== "object") {
        throw options.onError(
          new BadDataException("JSON is should be of type object."),
        );
      }

      args["data"] = applyTenantColumn(
        normalizeModelKeys(
          args["data"] as JSONObject,
          this.modelService.getModel(),
        ),
        this.modelService.getModel(),
        options.projectId,
      );

      if (!args["query"]) {
        throw options.onError(new BadDataException("Query is undefined."));
      }

      if (typeof args["query"] === "string") {
        args["query"] = JSONFunctions.parse(args["query"] as string);
      }

      if (typeof args["query"] !== "object") {
        throw options.onError(
          new BadDataException("Query is should be of type object."),
        );
      }

      const query: Query<TBaseModel> = JSONFunctions.deserialize(
        normalizeModelKeys(
          args["query"] as JSONObject,
          this.modelService.getModel(),
        ),
      ) as Query<TBaseModel>;

      /*
       * The tenant column goes on the deserialized query, not on args["query"]
       * - JSONFunctions.deserialize returns a new object, so anything written
       * to args after it runs never reaches the database.
       */
      if (this.modelService.getModel().getTenantColumn()) {
        (query as JSONObject)[
          this.modelService.getModel().getTenantColumn() as string
        ] = options.projectId;
      }

      const itemsUpdated: number = await this.modelService.updateOneBy({
        query: query,
        data: args["data"] as QueryDeepPartialEntity<TBaseModel>,
        props: {
          isRoot: true,
          tenantId: options.projectId,
        },
      });

      /*
       * A query that matches nothing is not an error, but reporting it as a
       * bare success left builders with no way to tell "updated" from "found
       * nothing to update".
       */
      options.log(
        `Updated ${itemsUpdated} ${
          this.modelService.getModel().singularName || "record"
        }(s).`,
      );

      return {
        returnValues: {
          "items-updated": itemsUpdated,
        },
        executePort: successPort,
      };
    } catch (err: any) {
      logComponentError({
        error: err,
        model: this.modelService?.getModel() || null,
        log: options.log,
      });

      return {
        returnValues: {},
        executePort: errorPort,
      };
    }
  }
}
