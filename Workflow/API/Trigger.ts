
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ObjectID from "Common/Types/ObjectID";
import BadDataException from 'Common/Types/Exception/BadDataException';
import WorkflowService from "CommonServer/Services/WorkflowService";
import WorkflowLogService from "CommonServer/Services/WorkflowLogService";
import Workflow from "Model/Models/Workflow";
import WorkflowLog from 'Model/Models/WorkflowLog';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import OneUptimeDate from 'Common/Types/Date';
import Queue, { QueueName } from 'CommonServer/Infrastructure/Queue';

export default class RunAPI {
    public router!: ExpressRouter;

    public constructor() {
        this.router = Express.getRouter();

        this.router.get(
            `/manual/:workflowId`,
            this.manuallyRunWorkflow
        );

        this.router.post(
            `/manual/:workflowId`,
            this.manuallyRunWorkflow
        );

    }


    public async manuallyRunWorkflow(
        req: ExpressRequest,
        res: ExpressResponse,
    ) {
        // add this workflow to the run queue and return the 200 response.

        if (!req.params["workflowId"]) {
            return Response.sendErrorResponse(req, res, new BadDataException("workflowId not found in URL"))
        }

        const workflowId = new ObjectID(req.params["workflowId"]);

        // get workflow to see if its enabled. 
        const workflow: Workflow | null = await WorkflowService.findOneById({
            id: workflowId,
            select: {
                isEnabled: true,
                projectId: true
            },
            props: {
                isRoot: true,
            }
        });

        if (!workflow) {
            return Response.sendErrorResponse(req, res, new BadDataException("Workflow not found"))
        }

        if (!workflow.isEnabled) {
            return Response.sendErrorResponse(req, res, new BadDataException("This workflow is not enabled"))
        }

        if (!workflow.projectId) {
            return Response.sendErrorResponse(req, res, new BadDataException("This workflow does not belong to a project and cannot be run"))
        }

        // Add Workflow Run Log. 

        const runLog = new WorkflowLog();
        runLog.workflowId = workflowId;
        runLog.projectId = workflow.projectId;
        runLog.workflowStatus = WorkflowStatus.Scheduled;
        runLog.logs = OneUptimeDate.getCurrentDateAsFormattedString() + ": Workflow Scheduled.";

        const created = await WorkflowLogService.create({
            data: runLog,
            props: {
                isRoot: true
            }
        });

        await Queue.addJob(QueueName.Workflow, ObjectID.generate(), workflow._id?.toString() || '', {
            data: req.body,
            workflowLogId: created._id,
            workflowId: workflow._id
        });


        return Response.sendJsonObjectResponse(req, res, { status: "Scheduled" });
    }
}
