import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

export const OPENSTACK_COMPONENT_CATEGORY: string = translationKey("OpenStack");

/*
 * Asks a person to approve one change to an OpenStack cloud. There is no step that makes one:
 * a workflow can't approve what it proposes (Server/Utils/OpenStack/OpenStackWorkflowFix).
 */
const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.OpenStackProposeFix,
    title: translationKey("Propose an OpenStack fix"),
    category: OPENSTACK_COMPONENT_CATEGORY,
    description: translationKey(
      "Asks a person to approve one change to the OpenStack cloud an alert or incident is about. It goes through the same rules as a fix OneUptime AI proposes, and it never makes the change itself.",
    ),
    iconProp: IconProp.WrenchScrewdriver,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Text,
        name: translationKey("Alert ID"),
        description: translationKey(
          "The alert the fix is for, usually the ID your trigger returned. Fill in this or Incident ID.",
        ),
        required: false,
        id: "alert-id",
        placeholder:
          "{{local.components.alert-on-create-1.returnValues.model._id}}",
        linkedTable: "Alert",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Incident ID"),
        description: translationKey(
          "The incident the fix is for, usually the ID your trigger returned. Fill in this or Alert ID.",
        ),
        required: false,
        id: "incident-id",
        placeholder:
          "{{local.components.incident-on-create-1.returnValues.model._id}}",
        linkedTable: "Incident",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Command"),
        description: translationKey(
          "The change to propose, spelled the one way OneUptime takes it. Anything else is refused and takes the Error output.",
        ),
        required: true,
        id: "command",
        placeholder:
          'openstack compute service set --disable --disable-reason "Reported down" compute-01 nova-compute',
      },
      {
        type: ComponentInputType.LongText,
        name: translationKey("Why"),
        description: translationKey(
          "What the person approving it reads first. Defaults to which workflow asked.",
        ),
        required: false,
        id: "reason",
        placeholder: "This host stopped reporting to Nova.",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("OpenStack Cloud ID"),
        description: translationKey(
          "Only for an alert or incident linked to more than one cloud, or to none.",
        ),
        required: false,
        id: "cloud-id",
        placeholder: translationKey(
          "The ID in the address of the cloud's page",
        ),
        isAdvanced: true,
        linkedTable: "OpenStackCloud",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.Text,
        name: translationKey("Suggestion ID"),
        description: translationKey(
          "The ID of the fix waiting for a person's approval.",
        ),
        required: false,
        id: "suggestion-id",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Tier"),
        description: translationKey(
          "Safe or Riskier, as OneUptime reads the command.",
        ),
        required: false,
        id: "tier",
      },
      {
        type: ComponentInputType.Boolean,
        name: translationKey("Already Waiting"),
        description: translationKey(
          "True when the same change on this cloud was already waiting for approval, so no second one was added.",
        ),
        required: false,
        id: "already-waiting",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Error"),
        description: translationKey(
          "Why nothing was proposed, when the step takes the Error output.",
        ),
        required: false,
        id: "error",
      },
    ],
    inPorts: [
      {
        title: translationKey("In"),
        description: translationKey(
          "Please connect components to this port for this component to work.",
        ),
        id: "in",
      },
    ],
    outPorts: [
      {
        title: translationKey("Success"),
        description: translationKey(
          "A person has been asked. The workflow goes on without waiting for their answer.",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Nothing was proposed: the command is refused, or fixes aren't allowed on this cloud.",
        ),
        id: "error",
      },
    ],
  },
];

export default components;
