import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import ComponentMetadata from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import WebhookComponents from 'Common/Types/Workflow/Components/Webhook';
import Workflow from 'Model/Models/Workflow';
import WorkflowService from '../../../Services/WorkflowService';
import QueryHelper from '../../Database/QueryHelper';
import ComponentCode, {
    ExecuteWorkflowType,
    InitProps,
} from '../ComponentCode';

export default class WebhookTrigger extends ComponentCode {
    public constructor() {
        const component: ComponentMetadata | undefined = WebhookComponents.find(
            (i: ComponentMetadata) => {
                return i.id === ComponentID.Schedule;
            }
        );

        if (!component) {
            throw new BadDataException('Trigger not found.');
        }
        super();
        this.setMetadata(component);
    }

    public override async init(props: InitProps): Promise<void> {
        const workflows: Array<Workflow> = await WorkflowService.findBy({
            query: {
                triggerId: ComponentID.Schedule,
                triggerArguments: QueryHelper.notNull(),
            },
            select: {
                _id: true,
                triggerArguments: true,
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
                workflow.triggerArguments['schedule']
            ) {
                await props.scheduleWorkflow(
                    executeWorkflow,
                    workflow.triggerArguments['schedule'] as string
                );
            }
        }
    }
}
