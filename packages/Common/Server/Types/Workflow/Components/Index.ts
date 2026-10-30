import DatabaseService from "../../../Services/DatabaseService";
import Services from "../../../Services/Index";
import ComponentCode from "../ComponentCode";
import ApiDelete from "./API/Delete";
import ApiGet from "./API/Get";
import ApiGetById from "./API/GetById";
import ApiPost from "./API/Post";
import ApiPut from "./API/Put";
import GenerateText from "./AI/GenerateText";
import CreateManyBaseModel from "./BaseModel/CreateManyBaseModel";
import CreateOneBaseModel from "./BaseModel/CreateOneBaseModel";
import DeleteManyBaseModel from "./BaseModel/DeleteManyBaseModel";
import DeleteOneBaseModel from "./BaseModel/DeleteOneBaseModel";
import FindManyBaseModel from "./BaseModel/FindManyBaseModel";
import FindOneBaseModel from "./BaseModel/FindOneBaseModel";
import OnCreateBaseModel from "./BaseModel/OnCreateBaseModel";
import OnCreateOrUpdateBaseModel from "./BaseModel/OnCreateOrUpdateBaseModel";
import OnDeleteBaseModel from "./BaseModel/OnDeleteBaseModel";
import OnUpdateBaseModel from "./BaseModel/OnUpdateBaseModel";
import UpdateManyBaseModel from "./BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "./BaseModel/UpdateOneBaseModel";
import IfElse from "./Conditions/IfElse";
import Switch from "./Conditions/Switch";
import DiscordSendMessageToChannel from "./Discord/SendMessageToChannel";
import Email from "./Email";
import RecordFromAnotherTool, {
  ALERT_RECORD_MODEL,
  INCIDENT_RECORD_MODEL,
} from "./FromAnotherTool/RecordFromAnotherTool";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../../Services/IncidentStateTimelineService";
import IncidentInternalNoteService from "../../../Services/IncidentInternalNoteService";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import AlertStateTimelineService from "../../../Services/AlertStateTimelineService";
import AlertInternalNoteService from "../../../Services/AlertInternalNoteService";
import HuntressWorkflowTrigger from "./Huntress";
import IncomingEmailWorkflowTrigger from "./IncomingEmail";
import IRCSendMessageToChannel from "./IRC/SendMessageToChannel";
import JsonToText from "./JSON/JsonToText";
import MergeJSON from "./JSON/MergeJson";
import TextToJSON from "./JSON/TextToJson";
import JavaScriptCode from "./JavaScript";
import JavaScriptCheck from "./JavaScriptCheck";
import Log from "./Log";
import MattermostSendMessageToChannel from "./Mattermost/SendMessageToChannel";
import ManualTrigger from "./Manual";
import MicrosoftTeamsSendMessageToChannel from "./MicrosoftTeams/SendMessageToChannel";
import Page from "./OnCall/Page";
import Schedule from "./Schedule";
import SlackSendMessageToChannel from "./Slack/SendMessageToChannel";
import Sleep from "./Sleep";
import TelegramSendMessageToChat from "./Telegram/SendMessageToChat";
import WebhookTrigger from "./Webhook";
import ExecuteWorkflow from "./Workflow";
import ZabbixUpdateProblem from "./Zabbix/UpdateProblem";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../../Types/Dictionary";
import Text from "../../../../Types/Text";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import {
  ALERT_FROM_ANOTHER_TOOL,
  INCIDENT_FROM_ANOTHER_TOOL,
} from "../../../../Types/Workflow/Components/FromAnotherTool";
import {
  getCreateOrUpdateTriggerId,
  hasCreateOrUpdateTrigger,
} from "../../../../Types/Workflow/CreateOrUpdateTrigger";
import ApiPatch from "./API/Patch";

const Components: Dictionary<ComponentCode> = {
  [ComponentID.AIGenerateText]: new GenerateText(),
  [ComponentID.Webhook]: new WebhookTrigger(),
  [ComponentID.IncomingEmail]: new IncomingEmailWorkflowTrigger(),
  [ComponentID.HuntressIncidentReport]: new HuntressWorkflowTrigger(),
  [ComponentID.SlackSendMessageToChannel]: new SlackSendMessageToChannel(),
  [ComponentID.DiscordSendMessageToChannel]: new DiscordSendMessageToChannel(),
  [ComponentID.MicrosoftTeamsSendMessageToChannel]:
    new MicrosoftTeamsSendMessageToChannel(),
  [ComponentID.TelegramSendMessageToChat]: new TelegramSendMessageToChat(),
  [ComponentID.IRCSendMessageToChannel]: new IRCSendMessageToChannel(),
  [ComponentID.MattermostSendMessageToChannel]:
    new MattermostSendMessageToChannel(),
  [ComponentID.Log]: new Log(),
  [ComponentID.Schedule]: new Schedule(),
  [ComponentID.JavaScriptCode]: new JavaScriptCode(),
  [ComponentID.JavaScriptCheck]: new JavaScriptCheck(),
  [ComponentID.Manual]: new ManualTrigger(),
  [ComponentID.JsonToText]: new JsonToText(),
  [ComponentID.MergeJson]: new MergeJSON(),
  [ComponentID.TextToJson]: new TextToJSON(),
  [ComponentID.ApiGet]: new ApiGet(),
  [ComponentID.ApiGetById]: new ApiGetById(),
  [ComponentID.ApiPost]: new ApiPost(),
  [ComponentID.ApiDelete]: new ApiDelete(),
  [ComponentID.ApiPatch]: new ApiPatch(),
  [ComponentID.ApiPut]: new ApiPut(),
  [ComponentID.SendEmail]: new Email(),
  [ComponentID.IfElse]: new IfElse(),
  [ComponentID.Switch]: new Switch(),
  [ComponentID.WorkflowRun]: new ExecuteWorkflow(),
  [ComponentID.ZabbixUpdateProblem]: new ZabbixUpdateProblem(),
  [ComponentID.Sleep]: new Sleep(),
  // One runtime for both, told which records it works with.
  [ComponentID.IncidentFromAnotherTool]: new RecordFromAnotherTool({
    kind: INCIDENT_FROM_ANOTHER_TOOL,
    services: {
      record: IncidentService,
      state: IncidentStateService,
      severity: IncidentSeverityService,
      timeline: IncidentStateTimelineService,
      note: IncidentInternalNoteService,
    },
    model: INCIDENT_RECORD_MODEL,
  }),
  [ComponentID.AlertFromAnotherTool]: new RecordFromAnotherTool({
    kind: ALERT_FROM_ANOTHER_TOOL,
    services: {
      record: AlertService,
      state: AlertStateService,
      severity: AlertSeverityService,
      timeline: AlertStateTimelineService,
      note: AlertInternalNoteService,
    },
    model: ALERT_RECORD_MODEL,
  }),
  // The Page steps: one runtime, told which of the four it is.
  [ComponentID.PageUsers]: new Page(ComponentID.PageUsers),
  [ComponentID.PageTeam]: new Page(ComponentID.PageTeam),
  [ComponentID.PageOnCall]: new Page(ComponentID.PageOnCall),
  [ComponentID.PageOnCallPolicy]: new Page(ComponentID.PageOnCallPolicy),
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

  // Mirrors BaseModelComponent.getComponents: see EnableWorkflowOn.writeSteps.
  const offersWriteSteps: boolean = model.enableWorkflowOn.writeSteps !== false;

  if (model.enableWorkflowOn.create) {
    Components[`${modelId}-on-create`] = new OnCreateBaseModel(
      baseModelService as any,
    );

    if (offersWriteSteps) {
      Components[`${modelId}-create-one`] = new CreateOneBaseModel(
        baseModelService as any,
      );
      Components[`${modelId}-create-many`] = new CreateManyBaseModel(
        baseModelService as any,
      );
    }
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

    if (offersWriteSteps) {
      Components[`${modelId}-update-one`] = new UpdateOneBaseModel(
        baseModelService as any,
      );
      Components[`${modelId}-update-many`] = new UpdateManyBaseModel(
        baseModelService as any,
      );
    }
  }

  // Mirrors BaseModelComponent.getComponents: both triggers it stands for.
  if (hasCreateOrUpdateTrigger(model.enableWorkflowOn)) {
    Components[getCreateOrUpdateTriggerId(model.tableName!)] =
      new OnCreateOrUpdateBaseModel(baseModelService as any);
  }

  if (model.enableWorkflowOn.delete) {
    Components[`${modelId}-on-delete`] = new OnDeleteBaseModel(
      baseModelService as any,
    );

    if (offersWriteSteps) {
      Components[`${modelId}-delete-one`] = new DeleteOneBaseModel(
        baseModelService as any,
      );
      Components[`${modelId}-delete-many`] = new DeleteManyBaseModel(
        baseModelService as any,
      );
    }
  }
}

export default Components;
