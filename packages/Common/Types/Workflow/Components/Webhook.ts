import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Webhook,
    title: "Webhook",
    category: "Webhook",
    description:
      "Hook any of your external apps and services with this workflow.",
    iconProp: IconProp.AltGlobe,
    componentType: ComponentType.Trigger,
    arguments: [],
    runWorkflowManuallyArguments: [
      {
        id: "request-headers",
        name: "Request Headers",
        description: "Request Headers for this request",
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"header1": "value1", "header2": "value2", ....}',
      },
      {
        id: "request-params",
        name: "Request Query Params",
        description: "Request Query Params for this request",
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"query1": "value1", "query2": "value2", ....}',
      },
      {
        id: "request-body",
        name: "Request Body",
        description: "Request Body",
        type: ComponentInputType.JSON,
        required: false,
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    returnValues: [
      {
        id: "request-headers",
        name: "Request Headers",
        description: "The headers the caller sent, by header name.",
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"header1": "value1", "header2": "value2", ....}',
      },
      {
        id: "request-params",
        name: "Request Query Params",
        description: "The query string parameters in the URL, by name.",
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"query1": "value1", "query2": "value2", ....}',
      },
      {
        id: "request-body",
        name: "Request Body",
        description:
          "The body the caller sent. A JSON body can be read field by field.",
        type: ComponentInputType.JSON,
        required: false,
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    inPorts: [],
    outPorts: [
      {
        title: "Out",
        description: "Connect the steps to run each time the URL is called.",
        id: "out",
      },
    ],
  },
];

export default components;
