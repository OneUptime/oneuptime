import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

/*
 * GET ATTACHMENTS FROM RECORD: the files a record holds - the files of its
 * File and Multiple files custom fields, and its own lists of files (a
 * note's attachments, an incident's postmortem attachments) - with their
 * names, types and bytes, for a workflow to attach to an email (#11477).
 *
 * The sibling of Get Files From Markdown (Components/MarkdownFiles), which
 * hands out the pictures a record's Markdown shows, and held to its rules:
 * the record is read as the workflow (a Project Admin of its project, or
 * what it runs as), only the files the record holds now and of its own
 * project are handed out, within the same limits, each checked by what it
 * holds. Documents as well as pictures, never an SVG. Server/Types/Workflow/
 * Components/RecordAttachments/GetAttachmentsFromRecord runs it, through
 * Server/Utils/File/RecordAttachments.
 *
 * Files holds every file's bytes, so it is left out of the run's log, and
 * of every step after it that is handed it (#11476).
 */

export const GET_ATTACHMENTS_FROM_RECORD_ARGUMENT_IDS: {
  readonly recordType: "recordType";
  readonly recordId: "recordId";
} = {
  recordType: "recordType",
  recordId: "recordId",
};

export const GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS: {
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

export const GET_ATTACHMENTS_FROM_RECORD_PORT_IDS: {
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
    id: ComponentID.GetAttachmentsFromRecord,
    title: translationKey("Get Attachments From Record"),
    category: translationKey("Utils"),
    description: translationKey(
      "Read the files a record holds, such as a note's attachments or the files in its File custom fields, with their names, types and data, ready to attach to an email.",
    ),
    iconProp: IconProp.File,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.AttachmentRecordType,
        name: translationKey("Record Type"),
        description: translationKey(
          "The kind of record that holds the files: an incident, a note, an alert, and more.",
        ),
        required: true,
        id: GET_ATTACHMENTS_FROM_RECORD_ARGUMENT_IDS.recordType,
        placeholder: translationKey("Pick a record type"),
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Record ID"),
        description: translationKey(
          "The record to read. Usually the ID of the record that started this workflow, or one an earlier step found.",
        ),
        required: true,
        id: GET_ATTACHMENTS_FROM_RECORD_ARGUMENT_IDS.recordId,
        placeholder: translationKey("Pick a value with { } or paste an ID"),
      },
    ],
    returnValues: [
      {
        id: GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.files,
        name: translationKey("Files"),
        description: translationKey(
          "Each file the record holds, in order: its name, MIME type, size, data in base64, content ID, and where the record holds it. Hidden in the run's log.",
        ),
        type: ComponentInputType.JSONArray,
        required: true,
        isSensitive: true,
      },
      {
        id: GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.count,
        name: translationKey("Count"),
        description: translationKey("How many files Files holds."),
        type: ComponentInputType.Number,
        required: true,
      },
      {
        id: GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.leftOut,
        name: translationKey("Left Out"),
        description: translationKey(
          "The files the record holds that are not in Files, each with the reason: a kind of file that is not handed out, too large, or not found in this project.",
        ),
        type: ComponentInputType.JSONArray,
        required: true,
      },
      {
        id: GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.error,
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
        id: GET_ATTACHMENTS_FROM_RECORD_PORT_IDS.in,
      },
    ],
    outPorts: [
      {
        title: translationKey("Success"),
        description: translationKey(
          "Taken when the record was read, whether or not it holds any files.",
        ),
        id: GET_ATTACHMENTS_FROM_RECORD_PORT_IDS.success,
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Taken when the record could not be read: it does not exist, or the workflow may not read it.",
        ),
        id: GET_ATTACHMENTS_FROM_RECORD_PORT_IDS.error,
      },
    ],
  },
];

export default components;
