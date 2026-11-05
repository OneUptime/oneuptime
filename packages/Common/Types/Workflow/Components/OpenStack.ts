import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

export const OPENSTACK_COMPONENT_CATEGORY: string = "OpenStack";

/*
 * Asks a person to approve one change to an OpenStack cloud. There is no step that makes one:
 * a workflow can't approve what it proposes (Server/Utils/OpenStack/OpenStackWorkflowFix).
 */
const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.OpenStackProposeFix,
    title: "Propose an OpenStack fix",
    category: OPENSTACK_COMPONENT_CATEGORY,
    description:
      "Asks a person to approve one change to the OpenStack cloud an alert or incident is about. It goes through the same rules as a fix OneUptime AI proposes, and it never makes the change itself.",
    iconProp: IconProp.WrenchScrewdriver,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Text,
        name: "Alert ID",
        description:
          "The alert the fix is for, usually the ID your trigger returned. Fill in this or Incident ID.",
        required: false,
        id: "alert-id",
        placeholder:
          "{{local.components.alert-on-create-1.returnValues.model._id}}",
        linkedTable: "Alert",
      },
      {
        type: ComponentInputType.Text,
        name: "Incident ID",
        description:
          "The incident the fix is for, usually the ID your trigger returned. Fill in this or Alert ID.",
        required: false,
        id: "incident-id",
        placeholder:
          "{{local.components.incident-on-create-1.returnValues.model._id}}",
        linkedTable: "Incident",
      },
      {
        type: ComponentInputType.Text,
        name: "Command",
        description:
          "The change to propose, spelled the one way OneUptime takes it. Anything else is refused and takes the Error output.",
        required: true,
        id: "command",
        placeholder:
          'openstack compute service set --disable --disable-reason "Reported down" compute-01 nova-compute',
      },
      {
        type: ComponentInputType.LongText,
        name: "Why",
        description:
          "What the person approving it reads first. Defaults to which workflow asked.",
        required: false,
        id: "reason",
        placeholder: "This host stopped reporting to Nova.",
      },
      {
        type: ComponentInputType.Text,
        name: "OpenStack Cloud ID",
        description:
          "Only for an alert or incident linked to more than one cloud, or to none.",
        required: false,
        id: "cloud-id",
        placeholder: "The ID in the address of the cloud's page",
        isAdvanced: true,
        linkedTable: "OpenStackCloud",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.Text,
        name: "Suggestion ID",
        description: "The ID of the fix waiting for a person's approval.",
        required: false,
        id: "suggestion-id",
      },
      {
        type: ComponentInputType.Text,
        name: "Tier",
        description: "Safe or Riskier, as OneUptime reads the command.",
        required: false,
        id: "tier",
      },
      {
        type: ComponentInputType.Boolean,
        name: "Already Waiting",
        description:
          "True when the same change on this cloud was already waiting for approval, so no second one was added.",
        required: false,
        id: "already-waiting",
      },
      {
        type: ComponentInputType.Text,
        name: "Error",
        description:
          "Why nothing was proposed, when the step takes the Error output.",
        required: false,
        id: "error",
      },
    ],
    inPorts: [
      {
        title: "In",
        description:
          "Please connect components to this port for this component to work.",
        id: "in",
      },
    ],
    outPorts: [
      {
        title: "Success",
        description:
          "A person has been asked. The workflow goes on without waiting for their answer.",
        id: "success",
      },
      {
        title: "Error",
        description:
          "Nothing was proposed: the command is refused, or fixes aren't allowed on this cloud.",
        id: "error",
      },
    ],
  },
];

export default components;
