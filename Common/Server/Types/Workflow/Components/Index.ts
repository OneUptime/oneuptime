import DatabaseService from "../../../Services/DatabaseService";
import Services from "../../../Services/Index";
import ComponentCode from "../ComponentCode";
import ApiDelete from "./API/Delete";
import ApiGet from "./API/Get";
import ApiPost from "./API/Post";
import ApiPut from "./API/Put";
import CreateManyBaseModel from "./BaseModel/CreateManyBaseModel";
import CreateOneBaseModel from "./BaseModel/CreateOneBaseModel";
import DeleteManyBaseModel from "./BaseModel/DeleteManyBaseModel";
import DeleteOneBaseModel from "./BaseModel/DeleteOneBaseModel";
import FindManyBaseModel from "./BaseModel/FindManyBaseModel";
import FindOneBaseModel from "./BaseModel/FindOneBaseModel";
import OnCreateBaseModel from "./BaseModel/OnCreateBaseModel";
import OnDeleteBaseModel from "./BaseModel/OnDeleteBaseModel";
import OnUpdateBaseModel from "./BaseModel/OnUpdateBaseModel";
import UpdateManyBaseModel from "./BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "./BaseModel/UpdateOneBaseModel";
import IfElse from "./Conditions/IfElse";
import DiscordSendMessageToChannel from "./Discord/SendMessageToChannel";
import Email from "./Email";
import JsonToText from "./JSON/JsonToText";
import MergeJSON from "./JSON/MergeJson";
import TextToJSON from "./JSON/TextToJson";
import JavaScriptCode from "./JavaScript";
import Log from "./Log";
import ManualTrigger from "./Manual";
import MicrosoftTeamsSendMessageToChannel from "./MicrosoftTeams/SendMessageToChannel";
import Schedule from "./Schedule";
import SlackSendMessageToChannel from "./Slack/SendMessageToChannel";
import TelegramSendMessageToChat from "./Telegram/SendMessageToChat";
import WebhookTrigger from "./Webhook";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../../Types/Dictionary";
import Text from "../../../../Types/Text";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ApiPatch from "./API/Patch";

const Components: Dictionary<ComponentCode> = {
  [ComponentID.Webhook]: new WebhookTrigger(),
  [ComponentID.SlackSendMessageToChannel]: new SlackSendMessageToChannel(),
  [ComponentID.DiscordSendMessageToChannel]: new DiscordSendMessageToChannel(),
  [ComponentID.MicrosoftTeamsSendMessageToChannel]:
    new MicrosoftTeamsSendMessageToChannel(),
  [ComponentID.TelegramSendMessageToChat]: new TelegramSendMessageToChat(),
  [ComponentID.Log]: new Log(),
  [ComponentID.Schedule]: new Schedule(),
  [ComponentID.JavaScriptCode]: new JavaScriptCode(),
  [ComponentID.Manual]: new ManualTrigger(),
  [ComponentID.JsonToText]: new JsonToText(),
  [ComponentID.MergeJson]: new MergeJSON(),
  [ComponentID.TextToJson]: new TextToJSON(),
  [ComponentID.ApiGet]: new ApiGet(),
  [ComponentID.ApiPost]: new ApiPost(),
  [ComponentID.ApiDelete]: new ApiDelete(),
  [ComponentID.ApiPatch]: new ApiPatch(),
  [ComponentID.ApiPut]: new ApiPut(),
  [ComponentID.SendEmail]: new Email(),
  [ComponentID.IfElse]: new IfElse(),
};

for (const baseModelService of Services) {
  if (!(baseModelService instanceof DatabaseService)) {
    continue;
  }

  const model: BaseModel = baseModelService.getModel();

  if (!model.enableWorkflowOn) {
    continue;
  }

  const modelId: string = `${Text.pascalCaseToDashes(model.tableName!)}`;

  if (model.enableWorkflowOn.create) {
    Components[`${modelId}-on-create`] = new OnCreateBaseModel(
      baseModelService as any,
    );
    Components[`${modelId}-create-one`] = new CreateOneBaseModel(
      baseModelService as any,
    );
    Components[`${modelId}-create-many`] = new CreateManyBaseModel(
      baseModelService as any,
    );
  }

  if (model.enableWorkflowOn.read) {
    Components[`${modelId}-find-one`] = new FindOneBaseModel(
      baseModelService as any,
    );
    Components[`${modelId}-find-many`] = new FindManyBaseModel(
      baseModelService as any,
    );
  }

  if (model.enableWorkflowOn.update) {
    Components[`${modelId}-on-update`] = new OnUpdateBaseModel(
      baseModelService as any,
    );
    Components[`${modelId}-update-one`] = new UpdateOneBaseModel(
      baseModelService as any,
    );
    Components[`${modelId}-update-many`] = new UpdateManyBaseModel(
      baseModelService as any,
    );
  }

  if (model.enableWorkflowOn.delete) {
    Components[`${modelId}-on-delete`] = new OnDeleteBaseModel(
      baseModelService as any,
    );
    Components[`${modelId}-delete-one`] = new DeleteOneBaseModel(
      baseModelService as any,
    );
    Components[`${modelId}-delete-many`] = new DeleteManyBaseModel(
      baseModelService as any,
    );
  }
}

export default Components;
