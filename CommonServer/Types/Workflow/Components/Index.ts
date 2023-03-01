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
import OnCreateBaseModel from './BaseModel/OnCreateBaseModel';
import CreateOneBaseModel from './BaseModel/CreateOneBaseModel';
import CreateManyBaseModel from './BaseModel/CreateManyBaseModel';
import FindOneBaseModel from './BaseModel/FindOneBaseModel';
import FindManyBaseModel from './BaseModel/FindManyBaseModel';
import OnUpdateBaseModel from './BaseModel/OnUpdateBaseModel';
import UpdateOneBaseModel from './BaseModel/UpdateOneBaseModel';
import UpdateManyBaseModel from './BaseModel/UpdateManyBaseModel';
import OnDeleteBaseModel from './BaseModel/OnDeleteBaseModel';
import DeleteOneBaseModel from './BaseModel/DeleteOneBaseModel';
import DeleteManyBaseModel from './BaseModel/DeleteManyBaseMoidel';
import ManualTrigger from './Manual';
import JsonToText from './JSON/JsonToText';
import MergeJSON from './JSON/MergeJson';
import TextToJSON from './JSON/TextToJson';
import ApiGet from './API/Get';
import ApiDelete from './API/Delete';
import ApiPost from './API/Post';
import ApiPut from './API/Put';
import Email from './Email';
import IfElse from './Conditions/IfElse';

const Components: Dictionary<ComponentCode> = {
    [ComponentID.Webhook]: new WebhookTrigger(),
    [ComponentID.Log]: new Log(),
    [ComponentID.Schedule]: new Schedule(),
    [ComponentID.JavaScriptCode]: new JavaScirptCode(),
    [ComponentID.Manual]: new ManualTrigger(),
    [ComponentID.JsonToText]: new JsonToText(),
    [ComponentID.MergeJson]: new MergeJSON(),
    [ComponentID.TextToJson]: new TextToJSON(),
    [ComponentID.ApiGet]: new ApiGet(),
    [ComponentID.ApiPost]: new ApiDelete(),
    [ComponentID.ApiDelete]: new ApiPost(),
    [ComponentID.ApiPut]: new ApiPut(),
    [ComponentID.SendEmail]: new Email(),
    [ComponentID.IfElse]: new IfElse(),
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
