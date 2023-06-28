import BaseModel from 'Common/Models/BaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import DatabaseService from '../../../../Services/DatabaseService';
import { ExpressRequest, ExpressResponse } from '../../../../Utils/Express';
import Response from '../../../../Utils/Response';
import TriggerCode, { ExecuteWorkflowType, InitProps } from '../../TriggerCode';
import BaseModelComponents from 'Common/Types/Workflow/Components/BaseModel';
import Text from 'Common/Types/Text';
import WorkflowService from '../../../../Services/WorkflowService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Workflow from 'Model/Models/Workflow';
import ClusterKeyAuthorization from '../../../../Middleware/ClusterKeyAuthorization';
import { JSONObject } from 'Common/Types/JSON';
import { RunOptions, RunReturnType } from '../../ComponentCode';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Select from '../../../Database/Select';

export default class OnTriggerBaseModel<
    TBaseModel extends BaseModel
> extends TriggerCode {
    public modelId: string = '';
    public type: string = '';

    public service: DatabaseService<TBaseModel> | null = null;

    public constructor(
        modelService: DatabaseService<TBaseModel>,
        type: string
    ) {
        super();
        this.service = modelService;
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

    public override async run(
        args: JSONObject,
        options: RunOptions
    ): Promise<RunReturnType> {
        const data: JSONObject = args['data'] as JSONObject;

        const successPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'success';
            }
        );

        if (!successPort) {
            throw options.onError(
                new BadDataException('Success port not found')
            );
        }

        if (
            !data['_id'] ||
            !args['select'] ||
            Object.keys(args['select']).length === 0
        ) {
            return {
                returnValues: {
                    model: data
                        ? JSONFunctions.toJSON(
                              data as any,
                              this.service!.entityType
                          )
                        : null,
                },
                executePort: successPort,
            };
        }

        let select: Select<TBaseModel> = args['select'] as Select<TBaseModel>;

        if (select) {
            select = JSONFunctions.deserialize(
                args['select'] as JSONObject
            ) as Select<TBaseModel>;
        }

        const model: TBaseModel | null = await this.service!.findOneById({
            id: new ObjectID(data['_id'] as string),
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                ...select,
            },
        });

        if (!model) {
            throw new BadDataException(
                ('Model not found with id ' + args['_id']) as string
            );
        }

        return {
            returnValues: {
                model: data
                    ? JSONFunctions.toJSON(
                          model as any,
                          this.service!.entityType
                      )
                    : null,
            },
            executePort: successPort,
        };
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

            /// Find the object and send data.

            const executeWorkflow: ExecuteWorkflowType = {
                workflowId: workflow.id!,
                returnValues: {
                    data: req.body.data,
                },
            };

            promises.push(props.executeWorkflow(executeWorkflow));
        }

        await Promise.all(promises);
    }
}
