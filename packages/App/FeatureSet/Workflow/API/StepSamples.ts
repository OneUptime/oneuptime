import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  STEP_SAMPLES_MAX_COMPONENT_IDS,
  STEP_SAMPLES_MAX_RUNS,
  STEP_SAMPLES_PAGE_SIZE,
  StepSample,
  StepSampleRun,
  StepSamplesResponse,
  collectStepSamples,
  sampledComponentIds,
} from "Common/Types/Workflow/StepSamples";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";

// A step's id is a short name a builder types, e.g. "webhook-1".
const MAX_COMPONENT_ID_LENGTH: number = 200;

/**
 * What each step of a workflow held the last times it ran, for the builder's
 * value picker: POST /workflow/step-samples/:workflowId with the ids of the
 * steps whose values it lists, `{ "componentIds": ["webhook-1"] }`.
 *
 * A step's settings offer the values of the steps before it. Once those have
 * run, the picker can say what is inside them - the fields of the request a
 * webhook received, of an API's response, of a record - with what each held,
 * rather than leaving a builder to guess a path into "Request Body".
 *
 * The answer is read from the runs' step traces, which anyone who can read the
 * workflow's runs can already read whole through /workflow-log. So the route
 * asks for exactly that: a member of the workflow's own project, allowed to
 * read its runs, and the rows are read with the caller's own permissions. It
 * returns less than the trace holds - one sample per value, a short preview of
 * each field, and no preview at all for a field that looks like a secret.
 */
export default class StepSamplesAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      `/step-samples/:workflowId`,
      UserMiddleware.getUserMiddleware,
      this.getStepSamples,
    );
  }

  public async getStepSamples(
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
      const componentIds: Array<string> = StepSamplesAPI.parseComponentIds(
        req.body?.componentIds,
      );

      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      /*
       * getUserMiddleware loads who is calling; it lets an anonymous request
       * through as Public. The builder's picker is the only caller, so this
       * needs a logged-in member of the project named in the tenant header.
       */
      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      // The same permission the runs list needs.
      CommonAPI.assertCanReadTable({
        modelType: WorkflowLog,
        props: databaseProps,
        errorMessage:
          "You do not have permission to read this workflow's runs.",
      });

      /*
       * The header only names the project the caller claims. The workflow
       * must be one they can read, in that project; a workflow elsewhere, or
       * none at all, is refused the same way.
       */
      const workflow: Workflow | null = await WorkflowService.findOneById({
        id: workflowId,
        select: {
          _id: true,
          projectId: true,
        },
        props: databaseProps,
      });

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: workflow?.projectId,
        projectId: projectId,
      });

      const runs: Array<StepSampleRun> = await StepSamplesAPI.readRuns({
        workflowId: workflowId,
        projectId: projectId,
        componentIds: componentIds,
        props: databaseProps,
      });

      const samples: Array<StepSample> = collectStepSamples(runs, {
        componentIds: componentIds,
      });

      const body: StepSamplesResponse = { samples: samples };

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
   * The step ids asked about. Left out, the newest runs are read for every
   * step; anything but a list of short names is refused.
   */
  public static parseComponentIds(value: unknown): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException("componentIds must be a list of step IDs.");
    }

    if (value.length > STEP_SAMPLES_MAX_COMPONENT_IDS) {
      throw new BadDataException(
        `componentIds can name at most ${STEP_SAMPLES_MAX_COMPONENT_IDS} steps.`,
      );
    }

    const ids: Array<string> = [];

    for (const id of value) {
      if (
        typeof id !== "string" ||
        id.trim() === "" ||
        id.length > MAX_COMPONENT_ID_LENGTH
      ) {
        throw new BadDataException("componentIds must be a list of step IDs.");
      }

      if (!ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  /*
   * The workflow's runs, newest first, a page at a time: reading stops once
   * every step asked about has a sample, or at STEP_SAMPLES_MAX_RUNS. A trace
   * can be large, and most of the time the first page has them all.
   */
  public static async readRuns(data: {
    workflowId: ObjectID;
    projectId: ObjectID;
    componentIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<StepSampleRun>> {
    const runs: Array<StepSampleRun> = [];

    for (
      let skip: number = 0;
      skip < STEP_SAMPLES_MAX_RUNS;
      skip += STEP_SAMPLES_PAGE_SIZE
    ) {
      const page: Array<WorkflowLog> = await WorkflowLogService.findBy({
        query: {
          workflowId: data.workflowId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          createdAt: true,
          stepTrace: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        skip: skip,
        limit: Math.min(STEP_SAMPLES_PAGE_SIZE, STEP_SAMPLES_MAX_RUNS - skip),
        props: data.props,
      });

      for (const log of page) {
        runs.push({
          createdAt: log.createdAt,
          stepTrace: log.stepTrace,
        });
      }

      if (page.length < STEP_SAMPLES_PAGE_SIZE) {
        break;
      }

      // Asked about no step in particular: the newest page is enough.
      if (data.componentIds.length === 0) {
        break;
      }

      const sampled: Set<string> = sampledComponentIds(runs);

      if (
        data.componentIds.every((componentId: string) => {
          return sampled.has(componentId);
        })
      ) {
        break;
      }
    }

    return runs;
  }
}
