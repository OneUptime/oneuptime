import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

/*
 * GET FILES FROM MARKDOWN: the pictures a record's Markdown shows, with
 * their names, types and bytes, for a workflow to attach to an email
 * (#11256).
 *
 * The step names a record - its type and its ID - and reads it as the
 * workflow (a Project Admin of its project, or what it runs as), so what a
 * Find One step of that record may not read, this step may not read either.
 * It hands out only the pictures the record's Markdown shows: its Markdown
 * fields and its Markdown custom fields. Server/Types/Workflow/Components/
 * MarkdownFiles/GetFilesFromMarkdown runs it, through
 * Server/Utils/File/MarkdownFiles.
 *
 * Files holds every picture's bytes, so it is left out of the run's log.
 */

export const GET_FILES_FROM_MARKDOWN_ARGUMENT_IDS: {
  readonly recordType: "recordType";
  readonly recordId: "recordId";
} = {
  recordType: "recordType",
  recordId: "recordId",
};

export const GET_FILES_FROM_MARKDOWN_RETURN_VALUE_IDS: {
  readonly files: "files";
  readonly count: "count";
  readonly leftOut: "leftOut";
  readonly error: "error";
} = {
  files: "files",
  count: "count",
  leftOut: "leftOut",
  error: "error",
};

export const GET_FILES_FROM_MARKDOWN_PORT_IDS: {
  readonly in: "in";
  readonly success: "success";
  readonly error: "error";
} = {
  in: "in",
  success: "success",
  error: "error",
};

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.GetFilesFromMarkdown,
    title: translationKey("Get Files From Markdown"),
    category: translationKey("Utils"),
    description: translationKey(
      "Read the images a record's Markdown shows, such as the screenshots in an incident's description, with their names, types and data, ready to attach to an email.",
    ),
    iconProp: IconProp.Image,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.MarkdownRecordType,
        name: translationKey("Record Type"),
        description: translationKey(
          "The kind of record whose Markdown shows the images: an incident, a note, an alert, and more.",
        ),
        required: true,
        id: GET_FILES_FROM_MARKDOWN_ARGUMENT_IDS.recordType,
        placeholder: translationKey("Pick a record type"),
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Record ID"),
        description: translationKey(
          "The record to read. Usually the ID of the record that started this workflow, or one an earlier step found.",
        ),
        required: true,
        id: GET_FILES_FROM_MARKDOWN_ARGUMENT_IDS.recordId,
        placeholder: translationKey("Pick a value with { } or paste an ID"),
      },
    ],
    returnValues: [
      {
        id: GET_FILES_FROM_MARKDOWN_RETURN_VALUE_IDS.files,
        name: translationKey("Files"),
        description: translationKey(
          "Each image, in the order the record shows it: its name, MIME type, size, data in base64, content ID, the addresses the Markdown shows it by, and the fields it is in. Hidden in the run's log.",
        ),
        type: ComponentInputType.JSONArray,
        required: true,
        isSensitive: true,
      },
      {
        id: GET_FILES_FROM_MARKDOWN_RETURN_VALUE_IDS.count,
        name: translationKey("Count"),
        description: translationKey("How many images Files holds."),
        type: ComponentInputType.Number,
        required: true,
      },
      {
        id: GET_FILES_FROM_MARKDOWN_RETURN_VALUE_IDS.leftOut,
        name: translationKey("Left Out"),
        description: translationKey(
          "The files the Markdown shows that are not in Files, each with the reason: not an image, too large, or not found in this project.",
        ),
        type: ComponentInputType.JSONArray,
        required: true,
      },
      {
        id: GET_FILES_FROM_MARKDOWN_RETURN_VALUE_IDS.error,
        name: translationKey("Error"),
        description: translationKey("Why the record could not be read."),
        type: ComponentInputType.Text,
        required: false,
      },
    ],
    inPorts: [
      {
        title: translationKey("In"),
        description: translationKey(
          "Please connect components to this port for this component to work.",
        ),
        id: GET_FILES_FROM_MARKDOWN_PORT_IDS.in,
      },
    ],
    outPorts: [
      {
        title: translationKey("Success"),
        description: translationKey(
          "Taken when the record was read, whether or not it shows any images.",
        ),
        id: GET_FILES_FROM_MARKDOWN_PORT_IDS.success,
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Taken when the record could not be read: it does not exist, or the workflow may not read it.",
        ),
        id: GET_FILES_FROM_MARKDOWN_PORT_IDS.error,
      },
    ],
  },
];

export default components;
