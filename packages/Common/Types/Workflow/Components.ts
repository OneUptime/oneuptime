import IconProp from "../Icon/IconProp";
import ProviderLogo from "../ProviderLogo/ProviderLogo";
import ComponentMetadata, { ComponentCategory } from "./Component";
import APIComponents from "./Components/API";
import AIComponents from "./Components/AI";
import ConditionComponents from "./Components/Condition";
import DiscordComponents from "./Components/Discord";
import EmailComponents from "./Components/Email";
import FromAnotherToolComponents, {
  FROM_OTHER_TOOLS_COMPONENT_CATEGORY,
} from "./Components/FromAnotherTool";
import HuntressComponents, {
  HUNTRESS_COMPONENT_CATEGORY,
} from "./Components/Huntress";
import IncomingEmailComponents from "./Components/IncomingEmail";
import IRCComponents from "./Components/IRC";
import JsonComponents from "./Components/JSON";
import JavaScriptComponents from "./Components/JavaScript";
import JavaScriptCheckComponents from "./Components/JavaScriptCheck";
import LogComponents from "./Components/Log";
import ManualComponents from "./Components/Manual";
import MattermostComponents from "./Components/Mattermost";
import MicrosoftTeamsComponents from "./Components/MicrosoftTeams";
import OnCallComponents, {
  ON_CALL_COMPONENT_CATEGORY,
} from "./Components/OnCall";
import ScheduleComponents from "./Components/Schedule";
import SlackComponents from "./Components/Slack";
import SleepComponents from "./Components/Sleep";
import SwitchComponents from "./Components/Switch";
import TelegramComponents from "./Components/Telegram";
import WebhookComponents from "./Components/Webhook";
import WorkflowComponents from "./Components/Workflow";
import ZabbixComponents, {
  ZABBIX_COMPONENT_CATEGORY,
} from "./Components/Zabbix";

const components: Array<ComponentMetadata> = [
  ...OnCallComponents,
  ...FromAnotherToolComponents,
  ...AIComponents,
  ...LogComponents,
  ...APIComponents,
  ...ScheduleComponents,
  ...SlackComponents,
  ...DiscordComponents,
  ...TelegramComponents,
  ...IRCComponents,
  ...MattermostComponents,
  ...ConditionComponents,
  ...SwitchComponents,
  ...JavaScriptCheckComponents,
  ...JsonComponents,
  ...JavaScriptComponents,
  ...EmailComponents,
  ...WebhookComponents,
  ...IncomingEmailComponents,
  ...HuntressComponents,
  ...ZabbixComponents,
  ...WorkflowComponents,
  ...ManualComponents,
  ...MicrosoftTeamsComponents,
  ...SleepComponents,
];

export default components;

export const Categories: Array<ComponentCategory> = [
  /*
   * First: paging people is what an on-call product's workflows are most
   * often for, so the Page steps lead the Add Component panel's groups.
   */
  {
    name: ON_CALL_COMPONENT_CATEGORY,
    description:
      "Page people, a team, whoever is on call, or an on-call policy.",
    icon: IconProp.Call,
  },
  /*
   * Second: an alert from another tool becomes an incident or an alert
   * here, and is resolved there when the tool says it is over - what the
   * monitoring templates do.
   */
  {
    name: FROM_OTHER_TOOLS_COMPONENT_CATEGORY,
    description:
      "Open, acknowledge and resolve incidents and alerts for problems in your other tools.",
    icon: IconProp.Integrations,
  },
  {
    name: "AI",
    description:
      "Generate content with the LLM provider configured for this project.",
    icon: IconProp.Sparkles,
  },
  {
    name: "Webhook",
    description: "Integrate any apps into the workflow with webhooks.",
    icon: IconProp.AltGlobe,
  },
  {
    name: "API",
    description: "Integrate with any API out on the web.",
    icon: IconProp.Globe,
  },
  {
    name: "Slack",
    description: "Integrate OneUptime with your Slack team.",
    icon: IconProp.SendMessage,
    logo: ProviderLogo.Slack,
  },
  {
    name: "Discord",
    description: "Integrate OneUptime with your Discord server.",
    icon: IconProp.SendMessage,
    logo: ProviderLogo.Discord,
  },
  {
    name: "Microsoft Teams",
    description: "Integrate OneUptime with your Microsoft Teams.",
    icon: IconProp.SendMessage,
    logo: ProviderLogo.MicrosoftTeams,
  },
  {
    name: "Telegram",
    description: "Integrate OneUptime with your Telegram chats and channels.",
    icon: IconProp.SendMessage,
    logo: ProviderLogo.Telegram,
  },
  {
    name: "IRC",
    description: "Integrate OneUptime with your IRC channels.",
    icon: IconProp.SendMessage,
  },
  {
    name: "Mattermost",
    description: "Integrate OneUptime with your Mattermost channels.",
    icon: IconProp.SendMessage,
    logo: ProviderLogo.Mattermost,
  },
  {
    name: "Conditions",
    description: "Add logic to your workflows.",
    icon: IconProp.Condition,
  },
  {
    name: "Custom Code",
    description: "Add JaavScript to your workflows.",
    icon: IconProp.Code,
  },
  {
    name: "JSON",
    description: "Work with JSON Object in your workflows.",
    icon: IconProp.JSON,
  },
  {
    name: "Schedule",
    description: "Make your workflows run at regular intervals.",
    icon: IconProp.Clock,
  },
  {
    name: "Email",
    description: "Receive email to start a workflow, and send email from one.",
    icon: IconProp.Email,
  },
  {
    name: HUNTRESS_COMPONENT_CATEGORY,
    description:
      "Start a workflow from Huntress incident reports: new ones, comments and closes.",
    icon: IconProp.ShieldCheck,
  },
  {
    name: ZABBIX_COMPONENT_CATEGORY,
    description:
      "Acknowledge, close and add messages to problems in Zabbix, through its API.",
    icon: IconProp.ServerStack,
  },
  {
    name: "Utils",
    description: "Utils that make workflow design simpler.",
    icon: IconProp.Window,
  },
];
