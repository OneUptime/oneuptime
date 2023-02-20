import BaseModel from 'Common/Models/BaseModel';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import DatabaseService from '../../../Services/DatabaseService';
import ComponentCode, {
    RunOptions,
    RunReturnType,
} from '../ComponentCode';
import BaseModelComponents from "Common/Types/Workflow/Components/BaseModel";
import Text from 'Common/Types/Text';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';

export default class CreateOneBaseModel<TBaseModel extends BaseModel> extends ComponentCode {

    private modelService: DatabaseService<TBaseModel> | null = null;

    public constructor(modelService: DatabaseService<TBaseModel>) {
        super();

        const BaseModelComponent: ComponentMetadata | undefined = BaseModelComponents.getComponents(modelService.getModel()).find((i: ComponentMetadata) => {
            return i.id === `${Text.pascalCaseToDashes(modelService.getModel().tableName!)}-create-one`;
        });

        if (!BaseModelComponent) {
            throw new BadDataException('Create one component for ' + modelService.getModel().tableName + " not found.");
        }
        this.setMetadata(BaseModelComponent);
        this.modelService = modelService;
    }

    public override async run(args: JSONObject, options: RunOptions): Promise<RunReturnType> {

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
                throw new BadDataException("modelService is undefined.")
            }

            if (!args["json"]) {
                throw new BadDataException("JSON is undefined.")
            }

            if (typeof args["json"] !== "object") {
                throw new BadDataException("JSON is should be of type object.")
            }

            if(this.modelService.getModel().getTenantColumn()){
                (args['json'] as JSONObject)[this.modelService.getModel().getTenantColumn() as string] = options.projectId; 
            }

            const model: TBaseModel = await this.modelService.create({
                data: JSONFunctions.fromJSON<TBaseModel>(args['json'] as JSONObject || {}, this.modelService.entityType) as TBaseModel,
                props: {
                    isRoot: true
                }
            }) as TBaseModel;

            return {
                returnValues: {
                    model: JSONFunctions.toJSON(model, this.modelService.entityType),
                },
                executePort: successPort,
            };


        } catch (err: any) {
            options.log('Error runnning component');
            options.log(err.message ? err.message : JSON.stringify(err, null, 2));
            return {
                returnValues: {},
                executePort: errorPort,
            };
        }
    }
}
