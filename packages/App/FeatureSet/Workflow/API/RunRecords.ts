import { RunRecordTrigger, readRunRecordTrigger } from "../Utils/RunRecordTrigger";
import WorkflowRunAccess from "../Utils/WorkflowRunAccess";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  RUN_RECORD_SEARCH_MAX_LENGTH,
  RunRecordMessages,
  RunRecordOption,
  RunRecordSearchResponse,
} from "Common/Types/Workflow/RunRecord";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import RunRecordSearch from "Common/Server/Utils/Workflow/RunRecordSearch";

/**
 * The records Run Workflow can run a workflow with:
 * POST /workflow/run-records/:workflowId with `{ "search": "INC-8" }`.
 *
 * A workflow whose trigger acts on a record - On Create Incident, On Update
 * Alert - is run as if that record had just been created, changed or
 * deleted. The panel used to ask for the record's ID. It now asks for what
 * people know the record by: its number with or without its prefix (INC-8,
 * 8), part of its title or name, or still its ID; with nothing typed it
 * lists the newest records. See Types/Workflow/RunRecord.
 *
 * The panel is for people who may run the workflow, so the route asks for
 * that (WorkflowRunAccess, as Run Workflow itself does). The records are
 * read with the caller's own permissions - someone who may not read
 * incidents finds none by number - and only in the workflow's project, so
 * another project's INC-8 is never found.
 */
export default class RunRecordsAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      `/run-records/:workflowId`,
      UserMiddleware.getUserMiddleware,
      this.searchRunRecords,
    );
  }

  public async searchRunRecords(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const workflowIdParam: string | undefined = req.params["workflowId"];

      if (!workflowIdParam) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("workflowId not found in URL"),
        );
      }

      ObjectID.validateUUID(workflowIdParam);

      const workflowId: ObjectID = new ObjectID(workflowIdParam);
      const search: string = RunRecordsAPI.parseSearch(req.body?.search);

      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      /*
       * getUserMiddleware loads who is calling and lets an anonymous request
       * through as Public. Only a signed-in member of the project named in
       * the tenant header gets further.
       */
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      /*
       * The same gate as Run Workflow: the caller may run this workflow, and
       * it is in the project they named. A workflow elsewhere, or none, is
       * refused before anything is read.
       */
      await WorkflowRunAccess.assertMayRunWorkflow({
        databaseProps: databaseProps,
        projectId: projectId,
        workflowId: workflowId,
      });

      const trigger: RunRecordTrigger | null =
        await readRunRecordTrigger(workflowId);

      if (!trigger) {
        throw new BadDataException(RunRecordMessages.notARecordTrigger);
      }

      const records: Array<RunRecordOption> =
        await RunRecordsAPI.searchAsCaller({
          trigger: trigger,
          projectId: projectId,
          props: databaseProps,
          search: search,
        });

      const body: RunRecordSearchResponse = { records: records };

      return Response.sendJsonObjectResponse(
        req,
        res,
        body as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  }

  /*
   * What was typed. Left out, it is empty: the newest records. Anything but
   * a short text is refused.
   */
  public static parseSearch(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new BadDataException("search must be text.");
    }

    if (value.length > RUN_RECORD_SEARCH_MAX_LENGTH) {
      throw new BadDataException(RunRecordMessages.searchTooLong);
    }

    return value;
  }

  /*
   * The search, read as the caller. A caller who may not read the model is
   * told so in words about the records, rather than with the column the
   * read was refused on.
   */
  public static async searchAsCaller(data: {
    trigger: RunRecordTrigger;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    search: string;
  }): Promise<Array<RunRecordOption>> {
    try {
      return await RunRecordSearch.search({
        service: data.trigger.service,
        projectId: data.projectId,
        props: data.props,
        search: data.search,
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          RunRecordMessages.cannotRead(
            data.trigger.service.getModel().pluralName || "these records",
          ),
        );
      }

      throw error;
    }
  }
}
