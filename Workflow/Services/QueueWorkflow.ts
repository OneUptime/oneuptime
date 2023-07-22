import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import Queue, { QueueName } from 'CommonServer/Infrastructure/Queue';
import WorkflowLogService from 'CommonServer/Services/WorkflowLogService';
import WorkflowService from 'CommonServer/Services/WorkflowService';
import { ExecuteWorkflowType } from 'CommonServer/Types/Workflow/TriggerCode';
import Workflow from 'Model/Models/Workflow';
import WorkflowLog from 'Model/Models/WorkflowLog';
import ObjectID from 'Common/Types/ObjectID';
import ProjectService from 'CommonServer/Services/ProjectService';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import WorkflowPlan from 'Common/Types/Workflow/WorkflowPlan';
import PositiveNumber from 'Common/Types/PositiveNumber';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';

export default class QueueWorkflow {
    public static async removeWorkflow(workflowId: ObjectID): Promise<void> {
        // get workflow to see if its enabled.
        const workflow: Workflow | null = await WorkflowService.findOneById({
            id: workflowId,
            select: {
                projectId: true,
                repeatableJobKey: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!workflow) {
            throw new BadDataException('Workflow not found');
        }

        if (!workflow.projectId) {
            throw new BadDataException(
                'This workflow does not belong to a project and cannot be run'
            );
        }

        await Queue.removeJob(QueueName.Workflow, workflow.repeatableJobKey!);

        // update workflow.
        await WorkflowService.updateOneById({
            id: workflow.id!,
            data: {
                repeatableJobKey: null!,
            },
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });
    }

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
                repeatableJobKey: true,
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

        //check project and plan
        const projectPlan: {
            plan: PlanSelect | null;
            isSubscriptionUnpaid: boolean;
        } = await ProjectService.getCurrentPlan(workflow.projectId);

        if (projectPlan.isSubscriptionUnpaid) {
            // Add Workflow Run Log.

            const runLog: WorkflowLog = new WorkflowLog();
            runLog.workflowId = workflowId;
            runLog.projectId = workflow.projectId;
            runLog.workflowStatus = WorkflowStatus.WorkflowCountExceeded;
            runLog.logs =
                OneUptimeDate.getCurrentDateAsFormattedString() +
                ': Workflow cannot run because subscription is unpaid.';

            await WorkflowLogService.create({
                data: runLog,
                props: {
                    isRoot: true,
                },
            });

            return;
        }

        if (projectPlan.plan) {
            const startDate: Date = OneUptimeDate.getSomeDaysAgo(30);
            const endDate: Date = OneUptimeDate.getCurrentDate();

            const workflowCount: PositiveNumber =
                await WorkflowLogService.countBy({
                    query: {
                        projectId: workflow.projectId,
                        createdAt: QueryHelper.inBetween(startDate, endDate),
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (workflowCount.toNumber() > WorkflowPlan[projectPlan.plan]) {
                // Add Workflow Run Log.

                const runLog: WorkflowLog = new WorkflowLog();
                runLog.workflowId = workflowId;
                runLog.projectId = workflow.projectId;
                runLog.workflowStatus = WorkflowStatus.WorkflowCountExceeded;
                runLog.logs =
                    OneUptimeDate.getCurrentDateAsFormattedString() +
                    `: Workflow cannot run because it already ran ${workflowCount.toNumber()} in the last 30 days. Your current plan limit is ${
                        WorkflowPlan[projectPlan.plan]
                    }`;

                await WorkflowLogService.create({
                    data: runLog,
                    props: {
                        isRoot: true,
                    },
                });

                return;
            }
        }

        // Add Workflow Run Log.
        let workflowLog: WorkflowLog | null = null;
        if (!scheduleAt) {
            // if the workflow is to be run immeidately.
            const runLog: WorkflowLog = new WorkflowLog();
            runLog.workflowId = workflowId;
            runLog.projectId = workflow.projectId;
            runLog.workflowStatus = WorkflowStatus.Scheduled;
            runLog.logs =
                OneUptimeDate.getCurrentDateAsFormattedString() +
                `: Workflow ${workflowId.toString()} Scheduled.`;

            workflowLog = await WorkflowLogService.create({
                data: runLog,
                props: {
                    isRoot: true,
                },
            });
        }

        const job: any = await Queue.addJob(
            QueueName.Workflow,
            workflowLog
                ? workflowLog._id?.toString()!
                : workflow._id?.toString()!,
            workflowLog
                ? workflowLog._id?.toString()!
                : workflow._id?.toString()!,
            {
                data: executeWorkflow.returnValues,
                workflowLogId: workflowLog?._id || null,
                workflowId: workflow._id,
            },
            {
                scheduleAt: scheduleAt,
                repeatableKey: workflow.repeatableJobKey || undefined,
            }
        );

        // update workflow with repeatable key.

        if (job.repeatJobKey) {
            // update workflow.
            await WorkflowService.updateOneById({
                id: workflow.id!,
                data: {
                    repeatableJobKey: job.repeatJobKey,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });
        }
    }
}
