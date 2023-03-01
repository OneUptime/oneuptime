import ComponentID from 'Common/Types/Workflow/ComponentID';
import WebhookTrigger from './Webhook';
import Log from './Log';
import Schedule from './Schedule';
import Dictionary from 'Common/Types/Dictionary';
import ComponentCode from '../ComponentCode';
import JavaScirptCode from './JavaScript';
import BaseModelServices from '../../../Services/Index';
import BaseModel from 'Common/Models/BaseModel';
import Text from 'Common/Types/Text';
import OnCreateBaseModel from './OnCreateBaseModel';
import CreateOneBaseModel from './CreateOneBaseModel';
import CreateManyBaseModel from './CreateManyBaseModel';
import FindOneBaseModel from './FindOneBaseModel';
import FindManyBaseModel from './FindManyBaseModel';
import OnUpdateBaseModel from './OnUpdateBaseModel';
import UpdateOneBaseModel from './UpdateOneBaseModel';
import UpdateManyBaseModel from './UpdateManyBaseModel';
import OnDeleteBaseModel from './OnDeleteBaseModel';
import DeleteOneBaseModel from './DeleteOneBaseModel';
import DeleteManyBaseModel from './DeleteManyBaseMoidel';
import ManualTrigger from './Manual';

const Components: Dictionary<ComponentCode> = {
    [ComponentID.Webhook]: new WebhookTrigger(),
    [ComponentID.Log]: new Log(),
    [ComponentID.Schedule]: new Schedule(),
    [ComponentID.JavaScriptCode]: new JavaScirptCode(),
    [ComponentID.Manual]: new ManualTrigger(),
};

for (const baseModelService of BaseModelServices) {
    const model: BaseModel = baseModelService.getModel();

    if (!model.enableWorkflowOn) {
        continue;
    }

    const modelId: string = `${Text.pascalCaseToDashes(model.tableName!)}`;

    if (model.enableWorkflowOn.create) {
        Components[`${modelId}-on-create`] = new OnCreateBaseModel(
            baseModelService as any
        );
        Components[`${modelId}-create-one`] = new CreateOneBaseModel(
            baseModelService as any
        );
        Components[`${modelId}-create-many`] = new CreateManyBaseModel(
            baseModelService as any
        );
    }

    if (model.enableWorkflowOn.read) {
        Components[`${modelId}-find-one`] = new FindOneBaseModel(
            baseModelService as any
        );
        Components[`${modelId}-find-many`] = new FindManyBaseModel(
            baseModelService as any
        );
    }

    if (model.enableWorkflowOn.update) {
        Components[`${modelId}-on-update`] = new OnUpdateBaseModel(
            baseModelService as any
        );
        Components[`${modelId}-update-one`] = new UpdateOneBaseModel(
            baseModelService as any
        );
        Components[`${modelId}-update-many`] = new UpdateManyBaseModel(
            baseModelService as any
        );
    }

    if (model.enableWorkflowOn.delete) {
        Components[`${modelId}-on-delete`] = new OnDeleteBaseModel(
            baseModelService as any
        );
        Components[`${modelId}-delete-one`] = new DeleteOneBaseModel(
            baseModelService as any
        );
        Components[`${modelId}-delete-many`] = new DeleteManyBaseModel(
            baseModelService as any
        );
    }
}

export default Components;
