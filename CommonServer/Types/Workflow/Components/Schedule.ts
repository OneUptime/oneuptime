import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import ComponentMetadata from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import ScheduleComponents from 'Common/Types/Workflow/Components/Schedule';
import Workflow from 'Model/Models/Workflow';
import WorkflowService from '../../../Services/WorkflowService';
import QueryHelper from '../../Database/QueryHelper';
import TriggerCode, {
    ExecuteWorkflowType,
    InitProps,
    UpdateProps,
} from '../TriggerCode';

export default class WebhookTrigger extends TriggerCode {
    public constructor() {
        const component: ComponentMetadata | undefined =
            ScheduleComponents.find((i: ComponentMetadata) => {
                return i.id === ComponentID.Schedule;
            });

        if (!component) {
            throw new BadDataException('Trigger not found.');
        }
        super();
        this.setMetadata(component);
    }

    public override async init(props: InitProps): Promise<void> {
        const workflows: Array<Workflow> = await WorkflowService.findBy({
            query: {
                triggerId: ComponentID.Schedule as string,
                triggerArguments: QueryHelper.notNull(),
            },
            select: {
                _id: true,
                triggerArguments: true,
                isEnabled: true,
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
        });

        // query all workflows.
        for (const workflow of workflows) {
            const executeWorkflow: ExecuteWorkflowType = {
                workflowId: new ObjectID(workflow._id!),
                returnValues: {},
            };

            if (
                workflow.triggerArguments &&
                workflow.triggerArguments['schedule'] &&
                workflow.isEnabled
            ) {
                await props.scheduleWorkflow(
                    executeWorkflow,
                    workflow.triggerArguments['schedule'] as string
                );
            }

            if (!workflow.isEnabled) {
                await props.removeWorkflow(workflow.id!);
            }
        }
    }

    public override async update(props: UpdateProps): Promise<void> {
        const workflow: Workflow | null = await WorkflowService.findOneBy({
            query: {
                triggerId: ComponentID.Schedule,
                _id: props.workflowId.toString(),
                triggerArguments: QueryHelper.notNull(),
            },
            select: {
                _id: true,
                triggerArguments: true,
                isEnabled: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!workflow) {
            return;
        }

        if (!this.scheduleWorkflow) {
            return;
        }

        const executeWorkflow: ExecuteWorkflowType = {
            workflowId: new ObjectID(workflow._id!),
            returnValues: {},
        };

        if (
            workflow.triggerArguments &&
            workflow.triggerArguments['schedule'] &&
            workflow.isEnabled
        ) {
            await this.scheduleWorkflow(
                executeWorkflow,
                workflow.triggerArguments['schedule'] as string
            );
        }

        if (!this.removeWorkflow) {
            return;
        }

        if (!workflow.isEnabled) {
            await this.removeWorkflow(workflow.id!);
        }
    }
}
