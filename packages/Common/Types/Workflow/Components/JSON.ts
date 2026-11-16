import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.JsonToText,
    title: translationKey("JSON to Text"),
    category: translationKey("JSON"),
    description: translationKey("Converts JSON Object to Text"),
    iconProp: IconProp.JSON,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.JSON,
        name: translationKey("JSON"),
        description: translationKey("JSON Object as Input"),
        required: true,
        id: "json",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.Text,
        name: translationKey("Text"),
        description: translationKey("Text as Output"),
        required: true,
        id: "text",
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
          "This is executed when the JSON is successfully converted",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "This is executed when there is an error in conversion",
        ),
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.TextToJson,
    title: translationKey("Text to JSON"),
    category: translationKey("JSON"),
    description: translationKey("Converts Text to JSON Object"),
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
        name: translationKey("Text"),
        description: translationKey(
          "JSON written as text, such as a response body from an earlier step.",
        ),
        required: true,
        id: "text",
        placeholder: '{"key1": "value1", "key2": "value2"}',
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.JSON,
        name: translationKey("JSON"),
        description: translationKey("JSON Object as Output"),
        required: true,
        id: "json",
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
          "This is executed when the JSON is successfully converted",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "This is executed when there is an error in conversion",
        ),
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.MergeJson,
    title: translationKey("Merge JSON"),
    category: translationKey("JSON"),
    description: translationKey("Merge two JSON Objects into one"),
    iconProp: IconProp.JSON,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.JSON,
        name: translationKey("JSON 1"),
        description: translationKey("JSON Object 1 as Input"),
        required: true,
        id: "json1",
      },
      {
        type: ComponentInputType.JSON,
        name: translationKey("JSON 2"),
        description: translationKey("JSON Object 2 as Input"),
        required: true,
        id: "json2",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.JSON,
        name: translationKey("JSON"),
        description: translationKey("JSON Object as Output"),
        required: true,
        id: "json",
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
          "This is executed when the JSON is successfully merged",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "This is executed when the JSON is not successfully merged",
        ),
        id: "error",
      },
    ],
  },
];

export default components;
