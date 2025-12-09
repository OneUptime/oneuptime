import IconProp from "../Icon/IconProp";
import ComponentMetadata, { ComponentCategory } from "./Component";
import APIComponents from "./Components/API";
import ConditionComponents from "./Components/Condition";
import DiscordComponents from "./Components/Discord";
import EmailComponents from "./Components/Email";
import JsonComponents from "./Components/JSON";
import JavaScriptComponents from "./Components/JavaScript";
import LogComponents from "./Components/Log";
import ManualComponents from "./Components/Manual";
import MicrosoftTeamsComponents from "./Components/MicrosoftTeams";
import ScheduleComponents from "./Components/Schedule";
import SlackComponents from "./Components/Slack";
import WebhookComponents from "./Components/Webhook";
import WorkflowComponents from "./Components/Workflow";

const components: Array<ComponentMetadata> = [
  ...LogComponents,
  ...APIComponents,
  ...ScheduleComponents,
  ...SlackComponents,
  ...DiscordComponents,
  ...ConditionComponents,
  ...JsonComponents,
  ...JavaScriptComponents,
  ...EmailComponents,
  ...WebhookComponents,
  ...WorkflowComponents,
  ...ManualComponents,
  ...MicrosoftTeamsComponents,
];

export default components;

export const Categories: Array<ComponentCategory> = [
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
  },
  {
    name: "Discord",
    description: "Integrate OneUptime with your Discord server.",
    icon: IconProp.SendMessage,
  },
  {
    name: "Microsoft Teams",
    description: "Integrate OneUptime with your Microsoft Teams.",
    icon: IconProp.SendMessage,
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
    description: "Send email to anyone in your workflows.",
    icon: IconProp.Clock,
  },
  {
    name: "Utils",
    description: "Utils that make workflow design simpler.",
    icon: IconProp.Window,
  },
];
