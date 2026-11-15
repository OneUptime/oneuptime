import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Webhook,
    title: translationKey("Webhook"),
    category: translationKey("Webhook"),
    description: translationKey(
      "Hook any of your external apps and services with this workflow.",
    ),
    iconProp: IconProp.AltGlobe,
    componentType: ComponentType.Trigger,
    arguments: [],
    runWorkflowManuallyArguments: [
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey("Request Headers for this request"),
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"header1": "value1", "header2": "value2", ....}',
      },
      {
        id: "request-params",
        name: translationKey("Request Query Params"),
        description: translationKey("Request Query Params for this request"),
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"query1": "value1", "query2": "value2", ....}',
      },
      {
        id: "request-body",
        name: translationKey("Request Body"),
        description: translationKey("Request Body"),
        type: ComponentInputType.JSON,
        required: false,
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    returnValues: [
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey(
          "The headers the caller sent, by header name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"header1": "value1", "header2": "value2", ....}',
      },
      {
        id: "request-params",
        name: translationKey("Request Query Params"),
        description: translationKey(
          "The query string parameters in the URL, by name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
        placeholder: '{"query1": "value1", "query2": "value2", ....}',
      },
      {
        id: "request-body",
        name: translationKey("Request Body"),
        description: translationKey(
          "The body the caller sent. A JSON body can be read field by field.",
        ),
        type: ComponentInputType.JSON,
        required: false,
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    inPorts: [],
    outPorts: [
      {
        title: translationKey("Out"),
        description: translationKey(
          "Connect the steps to run each time the URL is called.",
        ),
        id: "out",
      },
    ],
  },
];

export default components;
