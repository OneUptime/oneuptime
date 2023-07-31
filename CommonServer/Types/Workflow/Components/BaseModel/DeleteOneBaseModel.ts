import BaseModel from 'Common/Models/BaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import DatabaseService from '../../../../Services/DatabaseService';
import ComponentCode, { RunOptions, RunReturnType } from '../../ComponentCode';
import BaseModelComponents from 'Common/Types/Workflow/Components/BaseModel';
import Text from 'Common/Types/Text';
import { JSONObject } from 'Common/Types/JSON';
import Query from '../../../Database/Query';
import JSONFunctions from 'Common/Types/JSONFunctions';

export default class DeleteOneBaseModel<
    TBaseModel extends BaseModel
> extends ComponentCode {
    private modelService: DatabaseService<TBaseModel> | null = null;

    public constructor(modelService: DatabaseService<TBaseModel>) {
        super();

        const BaseModelComponent: ComponentMetadata | undefined =
            BaseModelComponents.getComponents(modelService.getModel()).find(
                (i: ComponentMetadata) => {
                    return (
                        i.id ===
                        `${Text.pascalCaseToDashes(
                            modelService.getModel().tableName!
                        )}-delete-one`
                    );
                }
            );

        if (!BaseModelComponent) {
            throw new BadDataException(
                'Delete one component for ' +
                    modelService.getModel().tableName +
                    ' not found.'
            );
        }
        this.setMetadata(BaseModelComponent);
        this.modelService = modelService;
    }

    public override async run(
        args: JSONObject,
        options: RunOptions
    ): Promise<RunReturnType> {
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

        const errorPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'error';
            }
        );

        if (!errorPort) {
            throw options.onError(new BadDataException('Error port not found'));
        }

        try {
            if (!this.modelService) {
                throw options.onError(
                    new BadDataException('modelService is undefined.')
                );
            }

            if (!args['query']) {
                throw options.onError(
                    new BadDataException('Query is undefined.')
                );
            }

            if (typeof args['query'] === 'string') {
                args['query'] = JSONFunctions.parse(args['query'] as string);
            }

            if (typeof args['query'] !== 'object') {
                throw options.onError(
                    new BadDataException('Query is should be of type object.')
                );
            }

            let query: Query<TBaseModel> = args['query'] as Query<TBaseModel>;

            if (query) {
                query = JSONFunctions.deserialize(
                    args['query'] as JSONObject
                ) as Query<TBaseModel>;
            }

            if (this.modelService.getModel().getTenantColumn()) {
                (args['query'] as JSONObject)[
                    this.modelService.getModel().getTenantColumn() as string
                ] = options.projectId;
            }

            await this.modelService.deleteOneBy({
                query: (query as Query<TBaseModel>) || {},
                props: {
                    isRoot: true,
                    tenantId: options.projectId,
                },
            });

            return {
                returnValues: {},
                executePort: successPort,
            };
        } catch (err: any) {
            options.log('Error running component');
            options.log(
                err.message ? err.message : JSON.stringify(err, null, 2)
            );
            return {
                returnValues: {},
                executePort: errorPort,
            };
        }
    }
}
