import DatabaseService from "../../../../Services/DatabaseService";
import Query from "../../../Database/Query";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import Text from "../../../../../Types/Text";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import { normalizeModelKeys } from "./ModelArguments";
import logComponentError from "./LogComponentError";
import { assertIdsAreResolved } from "./UnresolvedIdReference";
import logRowsKeptByDelete from "./LogRowsKeptByDelete";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default class DeleteManyBaseModel<
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
            )}-delete-many`
          );
        },
      );

    if (!BaseModelComponent) {
      throw new BadDataException(
        "Delete many component for " +
          modelService.getModel().tableName +
          " not found.",
      );
    }
    this.setMetadata(BaseModelComponent);
    this.modelService = modelService;
  }

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

      // An ID still written as a {{...}} reference stops the step. See the helper.
      assertIdsAreResolved({
        json: args["query"] as JSONObject,
        model: this.modelService.getModel(),
        metadata: this.getMetadata(),
        argumentId: "query",
      });

      if (args["skip"] && typeof args["skip"] === "string") {
        args["skip"] = parseInt(args["skip"]);
      }

      if (args["limit"] && typeof args["limit"] === "string") {
        args["limit"] = parseInt(args["limit"]);
      }

      if (typeof args["skip"] !== "number") {
        args["skip"] = 0;
      }

      if (typeof args["limit"] !== "number") {
        args["limit"] = 10;
      }

      if (
        typeof args["limit"] === "number" &&
        args["limit"] > LIMIT_PER_PROJECT
      ) {
        options.log("Limit cannot be " + args["limit"]);
        options.log("Setting the limit to " + LIMIT_PER_PROJECT);
        args["limit"] = LIMIT_PER_PROJECT;
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

      // A Project Admin of the project, never root. See getStepProps.
      const props: DatabaseCommonInteractionProps =
        await this.getStepProps(options);

      const itemsDeleted: number = await this.modelService.deleteBy({
        query: query,
        limit: new PositiveNumber(args["limit"] as number),
        skip: new PositiveNumber(args["skip"] as number),
        props: props,
      });

      options.log(
        `Deleted ${itemsDeleted} ${
          this.modelService.getModel().singularName || "record"
        }(s).`,
      );

      // What the table kept of the rows the query names, and why.
      await logRowsKeptByDelete({
        service: this.modelService,
        query: query,
        props: props,
        log: options.log,
      });

      return {
        returnValues: {
          "items-deleted": itemsDeleted,
        },
        executePort: successPort,
      };
    } catch (err: any) {
      // Said in the run log, and again under the step's Error output.
      const reason: string = logComponentError({
        error: err,
        model: this.modelService?.getModel() || null,
        log: options.log,
        stepTitle: this.getMetadata().title,
      });

      return {
        returnValues: {},
        executePort: errorPort,
        executePortReason: reason,
      };
    }
  }
}
