import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import { API_GET_BY_ID_PLACEHOLDER } from "./ApiGetById";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";
import { API_CERTIFICATE_ARGUMENTS } from "./ApiCertificates";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.ApiGet,
    title: translationKey("API Get (JSON)"),
    category: translationKey("API"),
    description: translationKey("Send Get API Request and get JSON Response"),
    iconProp: IconProp.Globe,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "url",
        name: translationKey("URL"),
        description: translationKey("URL to send request to."),
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://api.yourcompany.com",
      },
      {
        id: "request-body",
        name: translationKey("Request Body"),
        description: translationKey("Request Body in JSON"),
        type: ComponentInputType.JSON,
        required: false,
        placeholder: 'Example: {"key1": "value1", "key2": "value2", ....}',
      },
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey("Request headers to send."),
        type: ComponentInputType.StringDictionary,
        required: false,
        isAdvanced: true,
        /*
         * Headers are where an Authorization bearer token gets typed, and
         * without this the resolved value is written verbatim into the
         * WorkflowLog for anyone with read access to the project. Only values
         * that came from a variable marked secret were ever scrubbed.
         */
        isSensitive: true,
        placeholder:
          'Example: {"header1": "value1", "header2": "value2", ....}',
      },
      ...API_CERTIFICATE_ARGUMENTS,
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey("Error, if there is any."),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: "response-status",
        name: translationKey("Response Status"),
        description: translationKey(
          "The HTTP status code the server answered with, 200 for example.",
        ),
        type: ComponentInputType.Number,
        required: false,
      },
      {
        id: "response-headers",
        name: translationKey("Response Headers"),
        description: translationKey(
          "The headers the server answered with, by header name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
      },
      {
        id: "response-body",
        name: translationKey("Response Body"),
        description: translationKey(
          "The body the server answered with. A JSON body can be read field by field.",
        ),
        type: ComponentInputType.JSON,
        required: false,
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
          "Runs when the server answers with a success status (2xx).",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Runs when the request fails or the server answers with an error status.",
        ),
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.ApiPost,
    title: translationKey("API Post (JSON)"),
    category: translationKey("API"),
    description: translationKey("Send a POST Request and get JSON Response"),
    iconProp: IconProp.Globe,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "url",
        name: translationKey("URL"),
        description: translationKey("URL to send request to."),
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://api.yourcompany.com",
      },
      {
        id: "request-body",
        name: translationKey("Request Body"),
        description: translationKey("Request Body in JSON"),
        type: ComponentInputType.JSON,
        required: false,
        placeholder: 'Example: {"key1": "value1", "key2": "value2", ....}',
      },
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey("Request headers to send."),
        type: ComponentInputType.StringDictionary,
        required: false,
        isAdvanced: true,
        /*
         * Headers are where an Authorization bearer token gets typed, and
         * without this the resolved value is written verbatim into the
         * WorkflowLog for anyone with read access to the project. Only values
         * that came from a variable marked secret were ever scrubbed.
         */
        isSensitive: true,
        placeholder:
          'Example: {"header1": "value1", "header2": "value2", ....}',
      },
      ...API_CERTIFICATE_ARGUMENTS,
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey("Error, if there is any."),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: "response-status",
        name: translationKey("Response Status"),
        description: translationKey(
          "The HTTP status code the server answered with, 200 for example.",
        ),
        type: ComponentInputType.Number,
        required: false,
      },
      {
        id: "response-headers",
        name: translationKey("Response Headers"),
        description: translationKey(
          "The headers the server answered with, by header name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
      },
      {
        id: "response-body",
        name: translationKey("Response Body"),
        description: translationKey(
          "The body the server answered with. A JSON body can be read field by field.",
        ),
        type: ComponentInputType.JSON,
        required: false,
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
          "Runs when the server answers with a success status (2xx).",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Runs when the request fails or the server answers with an error status.",
        ),
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.ApiPut,
    title: translationKey("API Put (JSON)"),
    category: translationKey("API"),
    description: translationKey("Send a PUT Request and get JSON Response"),
    iconProp: IconProp.Globe,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "url",
        name: translationKey("URL"),
        description: translationKey("URL to send request to."),
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://api.yourcompany.com",
      },
      {
        id: "request-body",
        name: translationKey("Request Body"),
        description: translationKey("Request Body in JSON"),
        type: ComponentInputType.JSON,
        required: false,
        placeholder: 'Example: {"key1": "value1", "key2": "value2", ....}',
      },
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey("Request headers to send."),
        type: ComponentInputType.StringDictionary,
        required: false,
        isAdvanced: true,
        /*
         * Headers are where an Authorization bearer token gets typed, and
         * without this the resolved value is written verbatim into the
         * WorkflowLog for anyone with read access to the project. Only values
         * that came from a variable marked secret were ever scrubbed.
         */
        isSensitive: true,
        placeholder:
          'Example: {"header1": "value1", "header2": "value2", ....}',
      },
      ...API_CERTIFICATE_ARGUMENTS,
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey("Error, if there is any."),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: "response-status",
        name: translationKey("Response Status"),
        description: translationKey(
          "The HTTP status code the server answered with, 200 for example.",
        ),
        type: ComponentInputType.Number,
        required: false,
      },
      {
        id: "response-headers",
        name: translationKey("Response Headers"),
        description: translationKey(
          "The headers the server answered with, by header name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
      },
      {
        id: "response-body",
        name: translationKey("Response Body"),
        description: translationKey(
          "The body the server answered with. A JSON body can be read field by field.",
        ),
        type: ComponentInputType.JSON,
        required: false,
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
          "Runs when the server answers with a success status (2xx).",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Runs when the request fails or the server answers with an error status.",
        ),
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.ApiPatch,
    title: translationKey("API Patch (JSON)"),
    category: translationKey("API"),
    description: translationKey("Send a PATCH Request and get JSON Response"),
    iconProp: IconProp.Globe,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "url",
        name: translationKey("URL"),
        description: translationKey("URL to send request to."),
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://api.yourcompany.com",
      },
      {
        id: "request-body",
        name: translationKey("Request Body"),
        description: translationKey("Request Body in JSON"),
        type: ComponentInputType.JSON,
        required: false,
        placeholder: 'Example: {"key1": "value1", "key2": "value2", ....}',
      },
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey("Request headers to send."),
        type: ComponentInputType.StringDictionary,
        required: false,
        isAdvanced: true,
        /*
         * Headers are where an Authorization bearer token gets typed, and
         * without this the resolved value is written verbatim into the
         * WorkflowLog for anyone with read access to the project. Only values
         * that came from a variable marked secret were ever scrubbed.
         */
        isSensitive: true,
        placeholder:
          'Example: {"header1": "value1", "header2": "value2", ....}',
      },
      ...API_CERTIFICATE_ARGUMENTS,
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey("Error, if there is any."),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: "response-status",
        name: translationKey("Response Status"),
        description: translationKey(
          "The HTTP status code the server answered with, 200 for example.",
        ),
        type: ComponentInputType.Number,
        required: false,
      },
      {
        id: "response-headers",
        name: translationKey("Response Headers"),
        description: translationKey(
          "The headers the server answered with, by header name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
      },
      {
        id: "response-body",
        name: translationKey("Response Body"),
        description: translationKey(
          "The body the server answered with. A JSON body can be read field by field.",
        ),
        type: ComponentInputType.JSON,
        required: false,
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
          "Runs when the server answers with a success status (2xx).",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Runs when the request fails or the server answers with an error status.",
        ),
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.ApiDelete,
    title: translationKey("API Delete (JSON)"),
    category: translationKey("API"),
    description: translationKey("Send a DELETE Request and get JSON Response"),
    iconProp: IconProp.Globe,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "url",
        name: translationKey("URL"),
        description: translationKey("URL to send request to."),
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://api.yourcompany.com",
      },
      {
        id: "request-body",
        name: translationKey("Request Body"),
        description: translationKey("Request Body in JSON"),
        type: ComponentInputType.JSON,
        required: false,
        placeholder: 'Example: {"key1": "value1", "key2": "value2", ....}',
      },
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey("Request headers to send."),
        type: ComponentInputType.StringDictionary,
        required: false,
        isAdvanced: true,
        /*
         * Headers are where an Authorization bearer token gets typed, and
         * without this the resolved value is written verbatim into the
         * WorkflowLog for anyone with read access to the project. Only values
         * that came from a variable marked secret were ever scrubbed.
         */
        isSensitive: true,
        placeholder:
          'Example: {"header1": "value1", "header2": "value2", ....}',
      },
      ...API_CERTIFICATE_ARGUMENTS,
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey("Error, if there is any."),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: "response-status",
        name: translationKey("Response Status"),
        description: translationKey(
          "The HTTP status code the server answered with, 200 for example.",
        ),
        type: ComponentInputType.Number,
        required: false,
      },
      {
        id: "response-headers",
        name: translationKey("Response Headers"),
        description: translationKey(
          "The headers the server answered with, by header name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
      },
      {
        id: "response-body",
        name: translationKey("Response Body"),
        description: translationKey(
          "The body the server answered with. A JSON body can be read field by field.",
        ),
        type: ComponentInputType.JSON,
        required: false,
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
          "Runs when the server answers with a success status (2xx).",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Runs when the request fails or the server answers with an error status.",
        ),
        id: "error",
      },
    ],
  },
  /*
   * One item by an ID from somewhere else, such as a webhook: the ID goes
   * into the address only when it is a plain ID (Components/ApiGetById).
   */
  {
    id: ComponentID.ApiGetById,
    title: translationKey("API Get By ID (JSON)"),
    category: translationKey("API"),
    description: translationKey(
      "Get one item from an API by an ID from an earlier step, placed in the address safely.",
    ),
    iconProp: IconProp.Globe,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "url",
        name: translationKey("URL"),
        /*
         * Written out, so the Dashboard's locales can word it; a test holds
         * the mark to the constant it names (WorkflowStepWords).
         */
        description: translationKey(
          "The item's address, with {id} where its ID goes.",
        ),
        type: ComponentInputType.URL,
        required: true,
        placeholder: `https://api.yourcompany.com/items/${API_GET_BY_ID_PLACEHOLDER}`,
      },
      {
        id: "id",
        name: translationKey("ID"),
        description: translationKey(
          "The item's ID, usually from an earlier step. Only letters, digits, dashes and underscores are sent.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "OPS-12",
      },
      {
        id: "request-headers",
        name: translationKey("Request Headers"),
        description: translationKey("Request headers to send."),
        type: ComponentInputType.StringDictionary,
        required: false,
        isAdvanced: true,
        // As API Get's: an Authorization header is kept out of the run's log.
        isSensitive: true,
        placeholder:
          'Example: {"header1": "value1", "header2": "value2", ....}',
      },
      ...API_CERTIFICATE_ARGUMENTS,
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey(
          "Why nothing was read, when it continues on Error.",
        ),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: "response-status",
        name: translationKey("Response Status"),
        description: translationKey(
          "The HTTP status code the server answered with, 200 for example.",
        ),
        type: ComponentInputType.Number,
        required: false,
      },
      {
        id: "response-headers",
        name: translationKey("Response Headers"),
        description: translationKey(
          "The headers the server answered with, by header name.",
        ),
        type: ComponentInputType.StringDictionary,
        required: false,
      },
      {
        id: "response-body",
        name: translationKey("Response Body"),
        description: translationKey(
          "The body the server answered with. A JSON body can be read field by field.",
        ),
        type: ComponentInputType.JSON,
        required: false,
      },
    ],
    inPorts: [
      {
        title: translationKey("In"),
        description: translationKey(
          "Connect the step that runs before this one.",
        ),
        id: "in",
      },
    ],
    outPorts: [
      {
        title: translationKey("Success"),
        description: translationKey(
          "Runs when the server answers with a success status (2xx).",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Runs when the ID is not an ID, the request fails or the server answers with an error status.",
        ),
        id: "error",
      },
    ],
  },
];

export default components;
