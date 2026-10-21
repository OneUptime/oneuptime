import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.JsonToText,
    title: "JSON to Text",
    category: "JSON",
    description: "Converts JSON Object to Text",
    iconProp: IconProp.JSON,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.JSON,
        name: "JSON",
        description: "JSON Object as Input",
        required: true,
        id: "json",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.Text,
        name: "Text",
        description: "Text as Output",
        required: true,
        id: "text",
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
        description: "This is executed when the JSON is successfully converted",
        id: "success",
      },
      {
        title: "Error",
        description: "This is executed when there is an error in conversion",
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.TextToJson,
    title: "Text to JSON",
    category: "JSON",
    description: "Converts Text to JSON Object",
    iconProp: IconProp.JSON,
    componentType: ComponentType.Component,
    arguments: [
      /*
       * A whole JSON document written out as text, so it gets the multi-line
       * box. LongText rather than JSON on purpose: RunWorkflow parses JSON
       * arguments before the step runs, and this step exists to do that
       * parsing itself (and to take its Error port when it fails).
       */
      {
        type: ComponentInputType.LongText,
        name: "Text",
        description:
          "JSON written as text, such as a response body from an earlier step.",
        required: true,
        id: "text",
        placeholder: '{"key1": "value1", "key2": "value2"}',
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.JSON,
        name: "JSON",
        description: "JSON Object as Output",
        required: true,
        id: "json",
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
        description: "This is executed when the JSON is successfully converted",
        id: "success",
      },
      {
        title: "Error",
        description: "This is executed when there is an error in conversion",
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.MergeJson,
    title: "Merge JSON",
    category: "JSON",
    description: "Merge two JSON Objects into one",
    iconProp: IconProp.JSON,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.JSON,
        name: "JSON 1",
        description: "JSON Object 1 as Input",
        required: true,
        id: "json1",
      },
      {
        type: ComponentInputType.JSON,
        name: "JSON 2",
        description: "JSON Object 2 as Input",
        required: true,
        id: "json2",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.JSON,
        name: "JSON",
        description: "JSON Object as Output",
        required: true,
        id: "json",
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
        description: "This is executed when the JSON is successfully merged",
        id: "success",
      },
      {
        title: "Error",
        description:
          "This is executed when the JSON is not successfully merged",
        id: "error",
      },
    ],
  },
];

export default components;
