import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import Queue, { QueueName } from 'CommonServer/Infrastructure/Queue';
import WorkflowLogService from 'CommonServer/Services/WorkflowLogService';
import WorkflowService from 'CommonServer/Services/WorkflowService';
import { ExecuteWorkflowType } from 'CommonServer/Types/Workflow/ComponentCode';
import Workflow from 'Model/Models/Workflow';
import WorkflowLog from 'Model/Models/WorkflowLog';
import ObjectID from 'Common/Types/ObjectID';

export default class QueueWorkflow {
    public static async addWorkflowToQueue(
        executeWorkflow: ExecuteWorkflowType,
        scheduleAt?: string
    ): Promise<void> {
        const workflowId: ObjectID = executeWorkflow.workflowId;

        // get workflow to see if its enabled.
        const workflow: Workflow | null = await WorkflowService.findOneById({
            id: workflowId,
            select: {
                isEnabled: true,
                projectId: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!workflow) {
            throw new BadDataException('Workflow not found');
        }

        if (!workflow.isEnabled) {
            throw new BadDataException('This workflow is not enabled');
        }

        if (!workflow.projectId) {
            throw new BadDataException(
                'This workflow does not belong to a project and cannot be run'
            );
        }

        // Add Workflow Run Log.

        const runLog: WorkflowLog = new WorkflowLog();
        runLog.workflowId = workflowId;
        runLog.projectId = workflow.projectId;
        runLog.workflowStatus = WorkflowStatus.Scheduled;
        runLog.logs =
            OneUptimeDate.getCurrentDateAsFormattedString() +
            ': Workflow Scheduled.';

        const created: WorkflowLog = await WorkflowLogService.create({
            data: runLog,
            props: {
                isRoot: true,
            },
        });

        await Queue.addJob(
            QueueName.Workflow,
            ObjectID.generate(),
            workflow._id?.toString() || '',
            {
                data: executeWorkflow.returnValues,
                workflowLogId: created._id,
                workflowId: workflow._id,
            },
            scheduleAt ? { scheduleAt: scheduleAt } : undefined
        );
    }
}
