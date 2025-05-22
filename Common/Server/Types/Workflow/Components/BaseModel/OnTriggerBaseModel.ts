import ClusterKeyAuthorization from "../../../../Middleware/ClusterKeyAuthorization";
import DatabaseService from "../../../../Services/DatabaseService";
import WorkflowService from "../../../../Services/WorkflowService";
import { ExpressRequest, ExpressResponse } from "../../../../Utils/Express";
import logger from "../../../../Utils/Logger";
import Response from "../../../../Utils/Response";
import Select from "../../../Database/Select";
import { RunOptions, RunReturnType } from "../../ComponentCode";
import TriggerCode, { ExecuteWorkflowType, InitProps } from "../../TriggerCode";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import JSONFunctions from "../../../../../Types/JSONFunctions";
import ObjectID from "../../../../../Types/ObjectID";
import Text from "../../../../../Types/Text";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import BaseModelComponents from "../../../../../Types/Workflow/Components/BaseModel";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";

export default class OnTriggerBaseModel<
  TBaseModel extends BaseModel,
> extends TriggerCode {
  public modelId: string = "";
  public type: string = "";

  public service: DatabaseService<TBaseModel> | null = null;

  public constructor(modelService: DatabaseService<TBaseModel>, type: string) {
    super();
    this.service = modelService;
    this.modelId = `${Text.pascalCaseToDashes(
      modelService.getModel().tableName!,
    )}`;

    this.type = type;

    const BaseModelComponent: ComponentMetadata | undefined =
      BaseModelComponents.getComponents(modelService.getModel()).find(
        (i: ComponentMetadata) => {
          return i.id === `${this.modelId}-${this.type}`;
        },
      );

    if (!BaseModelComponent) {
      throw new BadDataException(
        "On Create trigger component for " +
          modelService.getModel().tableName +
          " not found.",
      );
    }
    this.setMetadata(BaseModelComponent);
  }

  @CaptureSpan()
  public override async init(props: InitProps): Promise<void> {
    props.router.get(
      `/model/:projectId/${this.modelId}/${this.type}`,
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.initTrigger(req, res, props);
      },
    );

    props.router.post(
      `/model/:projectId/${this.modelId}/${this.type}`,
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        await this.initTrigger(req, res, props);
      },
    );
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    let data: JSONObject = args["data"] as JSONObject;

    if (!data) {
      data = {};
    }

    if (args["_id"]) {
      data["_id"] = args["_id"];
    }

    const miscData: JSONObject = (data?.["miscData"] as JSONObject) || {};

    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "success";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    if (
      !data["_id"] ||
      !args["select"] ||
      Object.keys(args["select"]).length === 0
    ) {
      return {
        returnValues: {
          model: data
            ? BaseModel.toJSON(data as any, this.service!.modelType)
            : null,
          ...(miscData || {}),
        },
        executePort: successPort,
      };
    }

    let select: Select<TBaseModel> = args["select"] as Select<TBaseModel>;

    logger.debug("Select: ");
    logger.debug(select);

    if (select && typeof select === "string") {
      select = JSONFunctions.parse(select) as Select<TBaseModel>;
    }

    const model: TBaseModel | null = await this.service!.findOneById({
      id: new ObjectID(data["_id"].toString()),
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        ...select,
      },
    });

    if (!model) {
      options.log("Model not found with id " + data["_id"].toString());

      throw new BadDataException(
        ("Model not found with id " + data["_id"].toString()) as string,
      );
    }

    return {
      returnValues: {
        model: data
          ? BaseModel.toJSON(model as any, this.service!.modelType)
          : null,
      },
      executePort: successPort,
    };
  }

  @CaptureSpan()
  public async initTrigger(
    req: ExpressRequest,
    res: ExpressResponse,
    props: InitProps,
  ): Promise<void> {
    // get all the enabled workflows with this trigger.
    Response.sendJsonObjectResponse(req, res, { status: "Triggered" });

    const workflows: Array<Workflow> = await WorkflowService.findBy({
      query: {
        triggerId: this.getMetadata().id,
        projectId: new ObjectID(req.params["projectId"] as string),
        isEnabled: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        triggerArguments: true,
      },
    });

    const promises: Array<Promise<void>> = [];

    const requestData: JSONObject = req.body.data;

    for (const workflow of workflows) {
      /// Run Graph.

      if (
        this.type === "on-update" &&
        workflow.triggerArguments?.["listen-on"]
      ) {
        let listenOn: JSONObject = workflow.triggerArguments?.[
          "listen-on"
        ] as JSONObject;
        const miscData: JSONObject =
          (requestData?.["miscData"] as JSONObject) || {};

        if (
          listenOn &&
          Object.keys(listenOn).length > 0 &&
          miscData &&
          Object.keys(miscData).length > 0
        ) {
          try {
            if (typeof listenOn === "string") {
              listenOn = JSON.parse(listenOn);
            }
          } catch (err) {
            logger.error(err);
            continue;
          }

          const updatedFields: JSONObject = miscData[
            "updatedFields"
          ] as JSONObject;

          if (updatedFields && Object.keys(updatedFields).length > 0) {
            let isUpdated: boolean = false;

            for (const key in listenOn) {
              if (updatedFields[key]) {
                isUpdated = true;
                break;
              }
            }

            if (!isUpdated) {
              continue;
            }
          }
        }
      }

      const executeWorkflow: ExecuteWorkflowType = {
        workflowId: workflow.id!,
        returnValues: {
          data: requestData,
        },
      };

      promises.push(props.executeWorkflow(executeWorkflow));
    }

    await Promise.all(promises);
  }
}
