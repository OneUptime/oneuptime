import BaseModel from 'Common/Models/BaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import ComponentMetadata from 'Common/Types/Workflow/Component';
import DatabaseService from '../../../Services/DatabaseService';
import { ExpressRequest, ExpressResponse } from '../../../Utils/Express';
import Response from '../../../Utils/Response';
import ComponentCode, {
    ExecuteWorkflowType,
    InitProps,
} from '../ComponentCode';
import BaseModelComponents from 'Common/Types/Workflow/Components/BaseModel';
import Text from 'Common/Types/Text';
import WorkflowService from '../../../Services/WorkflowService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Workflow from 'Model/Models/Workflow';
import ClusterKeyAuthorization from '../../../Middleware/ClusterKeyAuthorization';

export default class OnTriggerBaseModel<
    TBaseModel extends BaseModel
> extends ComponentCode {
    public modelId: string = '';
    public type: string = '';

    public constructor(
        modelService: DatabaseService<TBaseModel>,
        type: string
    ) {
        super();

        this.modelId = `${Text.pascalCaseToDashes(
            modelService.getModel().tableName!
        )}`;

        this.type = type;

        const BaseModelComponent: ComponentMetadata | undefined =
            BaseModelComponents.getComponents(modelService.getModel()).find(
                (i: ComponentMetadata) => {
                    return i.id === `${this.modelId}-${this.type}`;
                }
            );

        if (!BaseModelComponent) {
            throw new BadDataException(
                'On Create trigger component for ' +
                    modelService.getModel().tableName +
                    ' not found.'
            );
        }
        this.setMetadata(BaseModelComponent);
    }

    public override async init(props: InitProps): Promise<void> {
        props.router.get(
            `/model/:projectId/${this.modelId}/${this.type}`,
            ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
            async (req: ExpressRequest, res: ExpressResponse) => {
                await this.initTrigger(req, res, props);
            }
        );

        props.router.post(
            `/model/:projectId/${this.modelId}/${this.type}`,
            ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
            async (req: ExpressRequest, res: ExpressResponse) => {
                await this.initTrigger(req, res, props);
            }
        );
    }

    public async initTrigger(
        req: ExpressRequest,
        res: ExpressResponse,
        props: InitProps
    ): Promise<void> {
        // get all the enabled workflows with this trigger.
        Response.sendJsonObjectResponse(req, res, { status: 'Triggered' });

        const workflows: Array<Workflow> = await WorkflowService.findBy({
            query: {
                triggerId: this.getMetadata().id,
                projectId: new ObjectID(req.params['projectId'] as string),
                isEnabled: true,
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            select: {
                _id: true,
            },
        });

        const promises: Array<Promise<void>> = [];

        for (const workflow of workflows) {
            /// Run Graph.

            const executeWorkflow: ExecuteWorkflowType = {
                workflowId: workflow.id!,
                returnValues: req.body,
            };

            promises.push(props.executeWorkflow(executeWorkflow));
        }

        await Promise.all(promises);
    }
}
