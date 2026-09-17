import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import WorkflowService from "Common/Server/Services/WorkflowService";
import ComponentCode from "Common/Server/Types/Workflow/ComponentCode";
import Components from "Common/Server/Types/Workflow/Components/Index";
import TriggerCode from "Common/Server/Types/Workflow/TriggerCode";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Workflow from "Common/Models/DatabaseModels/Workflow";

export default class WorkflowAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.get(
      `/update/:workflowId`,
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      this.updateWorkflow,
    );

    this.router.post(
      `/update/:workflowId`,
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
      this.updateWorkflow,
    );
  }

  public async updateWorkflow(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    // add this workflow to the run queue and return the 200 response.

    if (!req.params["workflowId"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("workflowId not found in URL"),
      );
    }

    const workflow: Workflow | null = await WorkflowService.findOneById({
      id: new ObjectID(req.params["workflowId"]),
      select: {
        _id: true,
        triggerId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!workflow) {
      return Response.sendJsonObjectResponse(req, res, {
        status: "Workflow not found",
      });
    }

    if (!workflow.triggerId) {
      return Response.sendJsonObjectResponse(req, res, {
        status: "Trigger not found in workflow",
      });
    }

    const componentCode: ComponentCode | undefined =
      Components[workflow.triggerId];

    if (!componentCode) {
      return Response.sendJsonObjectResponse(req, res, {
        status: "Component not found",
      });
    }

    if (componentCode instanceof TriggerCode) {
      await componentCode.update({
        workflowId: workflow.id!,
      });
    }

    return Response.sendJsonObjectResponse(req, res, {
      status: "Updated",
    });
  }
}
