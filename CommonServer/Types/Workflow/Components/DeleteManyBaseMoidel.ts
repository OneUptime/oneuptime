import BaseModel from 'Common/Models/BaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import DatabaseService from '../../../Services/DatabaseService';
import ComponentCode, { RunOptions, RunReturnType } from '../ComponentCode';
import BaseModelComponents from 'Common/Types/Workflow/Components/BaseModel';
import Text from 'Common/Types/Text';
import { JSONObject } from 'Common/Types/JSON';
import Query from '../../Database/Query';

export default class DeleteManyBaseModel<
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
                        )}-delete-many`
                    );
                }
            );

        if (!BaseModelComponent) {
            throw new BadDataException(
                'Delete many component for ' +
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
            throw new BadDataException('Success port not found');
        }

        const errorPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'error';
            }
        );

        if (!errorPort) {
            throw new BadDataException('Error port not found');
        }

        try {
            if (!this.modelService) {
                throw new BadDataException('modelService is undefined.');
            }

            if (!args['query']) {
                throw new BadDataException('Query is undefined.');
            }

            if (typeof args['query'] !== 'object') {
                throw new BadDataException('Query is should be of type object.');
            }

            if (this.modelService.getModel().getTenantColumn()) {
                (args['query'] as JSONObject)[
                    this.modelService.getModel().getTenantColumn() as string
                ] = options.projectId;
            }

            await this.modelService.deleteBy({
                query: (args['query'] as Query<TBaseModel>) || {},
                props: {
                    isRoot: true,
                },
            });

            return {
                returnValues: {
                    
                },
                executePort: successPort,
            };
        } catch (err: any) {
            options.log('Error runnning component');
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
