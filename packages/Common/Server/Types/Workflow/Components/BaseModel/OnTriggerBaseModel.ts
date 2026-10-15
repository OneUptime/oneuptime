import ClusterKeyAuthorization from "../../../../Middleware/ClusterKeyAuthorization";
import DatabaseService from "../../../../Services/DatabaseService";
import WorkflowService from "../../../../Services/WorkflowService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../../Utils/Express";
import logger, { LogAttributes } from "../../../../Utils/Logger";
import Response from "../../../../Utils/Response";
import QueryHelper from "../../../Database/QueryHelper";
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
import {
  WHAT_HAPPENED_ID,
  WhatHappened,
  getCreateOrUpdateTriggerId,
  hasCreateOrUpdateTrigger,
} from "../../../../../Types/Workflow/CreateOrUpdateTrigger";
import { DatabaseOperation } from "../../../../../Types/Workflow/DatabaseOperation";
import { getWatchedColumns } from "../../../../../Types/Workflow/WatchedFields";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import { normalizeModelKeys } from "./ModelArguments";
import { describeRefusal } from "./LogComponentError";

export default class OnTriggerBaseModel<
  TBaseModel extends BaseModel,
> extends TriggerCode {
  public modelId: string = "";
  public type: string = "";

  /*
   * The model's On Create or Update trigger, on its On Create and On Update
   * triggers: a create or an update starts that trigger's workflows too
   * (initTrigger). Null on every other trigger, and on a model without one.
   */
  public createOrUpdateTriggerId: string | null = null;

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

    if (
      (type === DatabaseOperation.OnCreate ||
        type === DatabaseOperation.OnUpdate) &&
      hasCreateOrUpdateTrigger(modelService.getModel().enableWorkflowOn)
    ) {
      this.createOrUpdateTriggerId = getCreateOrUpdateTriggerId(
        modelService.getModel().tableName!,
      );
    }
  }

  @CaptureSpan()
  public override async init(props: InitProps): Promise<void> {
    props.router.get(
      `/model/:projectId/${this.modelId}/${this.type}`,
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.initTrigger(req, res, props);
        } catch (err) {
          return next(err);
        }
      },
    );

    props.router.post(
      `/model/:projectId/${this.modelId}/${this.type}`,
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.initTrigger(req, res, props);
        } catch (err) {
          return next(err);
        }
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

    const runLogAttributes: LogAttributes = {
      projectId: options.projectId.toString(),
      workflowId: options.workflowId.toString(),
    };

    logger.debug("Select: ", runLogAttributes);
    logger.debug(select, runLogAttributes);

    if (select && typeof select === "string") {
      select = JSONFunctions.parse(select) as Select<TBaseModel>;
    }

    /*
     * Convert string "true"/"false" values to booleans in select.
     * Workflow arguments may pass select values as strings (e.g. "true")
     * which causes TypeORM to iterate string characters as property indices.
     */
    if (select && typeof select === "object") {
      for (const key in select) {
        if ((select as any)[key] === "true") {
          (select as any)[key] = true;
        } else if ((select as any)[key] === "false") {
          (select as any)[key] = false;
        }
      }

      /*
       * "id" is only a TypeScript accessor on the model - the column is "_id".
       * Selecting "id" reached TypeORM verbatim and threw, and this trigger
       * has no error port, so it took the whole workflow run down with it.
       */
      select = normalizeModelKeys(
        select as JSONObject,
        this.service!.getModel(),
      ) as Select<TBaseModel>;
    }

    /*
     * Read as the workflow's own project, by a Project Admin of it (see
     * getStepProps): the record must be one of that project's, and the
     * columns the trigger reads ones a Project Admin may read. Its files come
     * back only when they are the project's to see (RelatedFileAccess, which
     * DatabaseService applies to every read made for someone).
     */
    let model: TBaseModel | null = null;

    try {
      model = await this.service!.findOneById({
        id: new ObjectID(data["_id"].toString()),
        props: await this.getStepProps(options),
        select: {
          _id: true,
          ...select,
        },
      });
    } catch (err) {
      const refusal: string | null = describeRefusal({
        error: err,
        message: (err as Error)?.message || String(err),
        stepTitle: this.getMetadata().title,
      });

      // The run logs what the trigger throws, so the refusal is said once.
      if (refusal) {
        throw new BadDataException(refusal);
      }

      throw err;
    }

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

    /*
     * A create or an update also starts the workflows of the model's On
     * Create or Update trigger, which has no route of its own: one event,
     * one lookup, and each workflow started once
     * (Types/Workflow/CreateOrUpdateTrigger).
     */
    const triggerIds: Array<string> = [this.getMetadata().id];

    if (this.createOrUpdateTriggerId) {
      triggerIds.push(this.createOrUpdateTriggerId);
    }

    const workflows: Array<Workflow> = await WorkflowService.findBy({
      query: {
        triggerId:
          triggerIds.length === 1
            ? triggerIds[0]!
            : QueryHelper.any(triggerIds),
        projectId: new ObjectID(req.params["projectId"] as string),
        isEnabled: true,
        // An archived workflow never runs, whatever its toggle says.
        isArchived: false,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        triggerId: true,
        triggerArguments: true,
      },
    });

    const promises: Array<Promise<void>> = [];

    const requestData: JSONObject = req.body.data;

    /*
     * An update the record's own create made, before OneUptime announced
     * the record (DatabaseService, RecordsBeingCreated): part of that create,
     * whose On Create event follows.
     */
    const isPartOfCreate: boolean = req.body?.["isPartOfCreate"] === true;

    for (const workflow of workflows) {
      /// Run Graph.

      const isCreateOrUpdate: boolean =
        Boolean(this.createOrUpdateTriggerId) &&
        workflow.triggerId === this.createOrUpdateTriggerId;

      /*
       * On Create or Update runs once for a new record: for its On Create
       * event, never also for the updates its create made. On Update hears
       * those as it always has.
       */
      if (
        isCreateOrUpdate &&
        this.type === DatabaseOperation.OnUpdate &&
        isPartOfCreate
      ) {
        continue;
      }

      /*
       * Fields to watch narrow the updates, on On Update and on On Create
       * or Update alike. A create always runs On Create or Update.
       */
      if (
        this.type === DatabaseOperation.OnUpdate &&
        !this.isUpdateWatched({
          workflow: workflow,
          requestData: requestData,
          projectId: req.params["projectId"] as string,
        })
      ) {
        continue;
      }

      const executeWorkflow: ExecuteWorkflowType = {
        workflowId: workflow.id!,
        returnValues: isCreateOrUpdate
          ? {
              data: requestData,
              // What started the run, for its What Happened.
              [WHAT_HAPPENED_ID]:
                this.type === DatabaseOperation.OnCreate
                  ? WhatHappened.Created
                  : WhatHappened.Updated,
            }
          : {
              data: requestData,
            },
      };

      promises.push(props.executeWorkflow(executeWorkflow));
    }

    await Promise.all(promises);
  }

  /*
   * Whether an update reaches a workflow through its Fields to watch
   * (stored as "listen-on"): yes with nothing watched, and yes when the
   * update says it changed one of the watched fields. An update that says
   * nothing of what it changed skips the check, as it always has.
   */
  private isUpdateWatched(data: {
    workflow: Workflow;
    requestData: JSONObject;
    projectId: string;
  }): boolean {
    const workflow: Workflow = data.workflow;

    if (!workflow.triggerArguments?.["listen-on"]) {
      return true;
    }

    let listenOn: JSONObject = workflow.triggerArguments?.[
      "listen-on"
    ] as JSONObject;
    const miscData: JSONObject =
      (data.requestData?.["miscData"] as JSONObject) || {};

    if (
      !listenOn ||
      Object.keys(listenOn).length === 0 ||
      !miscData ||
      Object.keys(miscData).length === 0
    ) {
      return true;
    }

    try {
      if (typeof listenOn === "string") {
        listenOn = JSON.parse(listenOn);
      }
    } catch (err) {
      logger.error(err, {
        projectId: data.projectId,
        workflowId: workflow.id?.toString(),
      });
      return false;
    }

    const updatedFields: JSONObject = miscData["updatedFields"] as JSONObject;

    if (!updatedFields || Object.keys(updatedFields).length === 0) {
      return true;
    }

    /*
     * updatedFields holds the fields the update changed
     * (DatabaseService.getChangedColumns), with their new values.
     * A field is listened on when it is among them, whatever it
     * changed to: a switch turned off (false), a count set to 0 or
     * a text cleared is a change too. Reading the value instead of
     * the key skipped every one of those.
     *
     * A relation to one record is reported by the column holding
     * its ID, so watching "Current Incident State" hears a change
     * of currentIncidentStateId (Types/Workflow/WatchedFields).
     */
    for (const key of getWatchedColumns({
      listenOn: listenOn,
      model: this.service!.getModel(),
    })) {
      if (Object.prototype.hasOwnProperty.call(updatedFields, key)) {
        return true;
      }
    }

    return false;
  }
}
