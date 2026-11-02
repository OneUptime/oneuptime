import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import { parseCustomFieldDropdownOptions } from "../../../Types/CustomField/CustomFieldDropdownOption";
import { isCustomFieldInheritedByRecord } from "../../../Types/CustomField/CustomFieldMappingCatalog";
import { sortCustomFieldDefinitions } from "../../../Types/CustomField/CustomFieldOrder";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { isCustomFieldFileType } from "../../../Types/CustomField/CustomFieldFile";
import {
  customFieldValueToDate,
  customFieldValueToText,
  formatCustomFieldCalendarDate,
} from "../../../Types/CustomField/CustomFieldValueFormat";
import { isCustomFieldValueEmpty } from "../../../Types/CustomField/CustomFieldValueMapping";
import {
  CustomFieldValueValidationError,
  validateCustomFieldValues,
} from "../../../Types/CustomField/CustomFieldValueValidator";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentCustomFieldService from "../../Services/IncidentCustomFieldService";
import IncidentService from "../../Services/IncidentService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import crypto from "crypto";
import WorkspaceIncidentActions from "./WorkspaceIncidentActions";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "./WorkspaceMemberActions";

/*
 * AN INCIDENT'S CUSTOM FIELDS, FILLED IN FROM SLACK OR MICROSOFT TEAMS.
 *
 * Edit Custom Fields on an incident's message opens one form - a Slack
 * modal, a Microsoft Teams card - with every custom field the project gives
 * its incidents, in the order the Custom Fields card shows them, each as
 * the input its type asks for and filled in with what the incident holds:
 *
 *   Text                       one line of text
 *   Long text, Markdown        several lines
 *   Number                     a number
 *   Boolean                    Yes or No
 *   Dropdown, Multi-select     its options (and a value the incident holds
 *                              that the field no longer offers, marked)
 *   Date                       a day
 *   Date and time              a day and a time
 *
 * Every field is optional, as on the Custom Fields card: "Required on
 * create" applies when an incident is declared. A field whose value is
 * copied from the incident's monitor is not asked for - it would only be
 * copied over again - as the card shows it without editing it. Nor is a
 * File or Multiple files field: a chat form cannot upload a file, so its
 * files are added, and downloaded, in OneUptime.
 *
 * What comes back is compared with what the incident holds: only the fields
 * whose value changed are written, a field emptied is cleared, and each new
 * value is held to its field's type as the API holds it
 * (CustomFieldValueValidator) - answered under the field, in a Slack modal,
 * before anything is written. The write is the incident's update, as the
 * member, so it is refused where the Custom Fields card's save would be.
 */

// Chat inputs, from their definitions: the kinds of input a field asks for.
export enum WorkspaceCustomFieldInputKind {
  Text = "Text",
  LongText = "LongText",
  Number = "Number",
  YesNo = "YesNo",
  Dropdown = "Dropdown",
  MultiSelect = "MultiSelect",
  Date = "Date",
  DateTime = "DateTime",
}

// One option of a field's input, as a chat lists it.
export interface WorkspaceCustomFieldOption {
  // What the chat submits: a token, never the option's own text (see toToken).
  value: string;
  label: string;
}

// One field of the form.
export interface WorkspaceCustomFieldInput {
  /*
   * The input's id in both chats - a Slack block and action id, a Teams
   * input id - from the field's definition: "customField_<id>".
   */
  inputId: string;
  definitionId: ObjectID;
  // The field's name: the key its value is stored under.
  name: string;
  description: string | null;
  customFieldType: CustomFieldType;
  kind: WorkspaceCustomFieldInputKind;
  // For YesNo, Dropdown and MultiSelect.
  options: Array<WorkspaceCustomFieldOption>;
  /*
   * What the input opens with - the incident's value, as the input takes
   * it: text, an option's token (YesNo, Dropdown), options' tokens
   * (MultiSelect), "2026-10-15" (Date), an instant (DateTime).
   */
  initialText: string | null;
  initialOption: string | null;
  initialOptions: Array<string>;
  initialDate: string | null;
  initialDateTime: Date | null;
}

// The form, as the incident and the project's fields read now.
export interface WorkspaceCustomFieldsForm {
  inputs: Array<WorkspaceCustomFieldInput>;
  // Fields past what one form holds: edited in OneUptime.
  notShownCount: number;
  // Fields copied from the incident's monitor: shown in OneUptime, not asked.
  copiedFieldNames: Array<string>;
  // File and Multiple files fields: their files are added in OneUptime.
  fileFieldNames?: Array<string> | undefined;
}

// What a submitted form changes, and what is wrong with it.
export interface WorkspaceCustomFieldsSubmission {
  /*
   * The fields whose value changed, by name, in the form's order: the new
   * value, or null for a field emptied.
   */
  changes: Array<{ name: string; value: unknown }>;
  // What is wrong with a field, by its input id.
  problems: Record<string, string>;
}

/*
 * A value a chat submitted for one input, read as the input gives it: text,
 * a token, a list of tokens, a day, a Date. Empty is null, "" or [].
 */
export type WorkspaceCustomFieldSubmittedValue =
  | string
  | number
  | boolean
  | Date
  | Array<string | number>
  | null
  | undefined;

// What a form holds at most: Slack's modal holds 100 blocks; a card less.
export const WORKSPACE_CUSTOM_FIELDS_MAX_INPUTS: number = 40;

// An option's text in a Slack list holds 75 characters.
const MAX_OPTION_LABEL_LENGTH: number = 75;

const INPUT_ID_PREFIX: string = "customField_";

// What a held value the field no longer offers reads as, after it.
const NO_LONGER_AN_OPTION: string = "(no longer an option)";

const YES_TOKEN: string = "true";
const NO_TOKEN: string = "false";

// The Incident custom field table: what decides whether a field is copied.
const DEFINITION_TABLE_NAME: string = "IncidentCustomField";

// "2026-10-15": a Date field's day, as both chats' pickers give it.
const DAY_PATTERN: RegExp = /^\d{4}-\d{2}-\d{2}$/;

// A line ending as typed on any system: "\r\n", "\r" or "\n".
const LINE_ENDING: RegExp = /\r\n?/g;

// A definition as the form reads it.
export interface WorkspaceCustomFieldDefinition extends CustomFieldDefinition {
  id: ObjectID;
  sortOrder?: number | null | undefined;
  mapFromResourceType?: string | undefined;
  mapFromCustomFieldName?: string | undefined;
}

export default class WorkspaceIncidentCustomFields {
  // The input id of a field: "customField_<definition id>".
  public static getInputId(definitionId: ObjectID): string {
    return `${INPUT_ID_PREFIX}${definitionId.toString()}`;
  }

  /*
   * An option's token: its place in the list and a fingerprint of its
   * value. A chat submits it instead of the option's own text, which can
   * hold a comma (a Teams multi-select joins its picks with commas), run
   * past Slack's 150 characters of value, or have changed since the form
   * was opened - the fingerprint no longer matches, and the field is asked
   * again instead of being written with another option.
   */
  public static toToken(index: number, value: string): string {
    const fingerprint: string = crypto
      .createHash("sha256")
      .update(value)
      .digest("hex")
      .substring(0, 8);

    return `o${index}_${fingerprint}`;
  }

  /*
   * The form, from the project's field definitions and the values the
   * incident holds (`stored`). `monitorCount` says whether the incident has
   * a monitor its copied fields come from.
   */
  public static buildForm(data: {
    definitions: Array<WorkspaceCustomFieldDefinition>;
    stored: JSONObject;
    monitorCount: number;
  }): WorkspaceCustomFieldsForm {
    const inputs: Array<WorkspaceCustomFieldInput> = [];
    const copiedFieldNames: Array<string> = [];
    const fileFieldNames: Array<string> = [];
    let notShownCount: number = 0;

    for (const definition of sortCustomFieldDefinitions(data.definitions)) {
      // A chat form cannot upload a file: its files are added in OneUptime.
      if (isCustomFieldFileType(definition.customFieldType)) {
        fileFieldNames.push(definition.name);
        continue;
      }

      if (
        isCustomFieldInheritedByRecord({
          definitionTableName: DEFINITION_TABLE_NAME,
          definition: definition,
          record: {
            monitors: new Array(data.monitorCount).fill({}),
          },
        })
      ) {
        copiedFieldNames.push(definition.name);
        continue;
      }

      if (inputs.length >= WORKSPACE_CUSTOM_FIELDS_MAX_INPUTS) {
        notShownCount++;
        continue;
      }

      inputs.push(
        WorkspaceIncidentCustomFields.toInput({
          definition: definition,
          value: data.stored[definition.name],
        }),
      );
    }

    return {
      inputs: inputs,
      notShownCount: notShownCount,
      copiedFieldNames: copiedFieldNames,
      fileFieldNames: fileFieldNames,
    };
  }

  // One field's input, filled in with the value the incident holds.
  public static toInput(data: {
    definition: WorkspaceCustomFieldDefinition;
    value: unknown;
  }): WorkspaceCustomFieldInput {
    const { definition, value } = data;
    const type: CustomFieldType =
      definition.customFieldType || CustomFieldType.Text;
    let kind: WorkspaceCustomFieldInputKind =
      WorkspaceIncidentCustomFields.getKind(type);

    /*
     * A value a number or a date picker cannot show - text a Number field
     * was given before values were checked, say - is asked for as text: a
     * picker that opened empty would clear it the moment the form was saved
     * for another field.
     */
    if (
      !WorkspaceIncidentCustomFields.canShowValue({
        kind: kind,
        value: value,
      })
    ) {
      kind = WorkspaceCustomFieldInputKind.Text;
    }

    const input: WorkspaceCustomFieldInput = {
      inputId: WorkspaceIncidentCustomFields.getInputId(definition.id),
      definitionId: definition.id,
      name: definition.name,
      description: definition.description?.trim() || null,
      customFieldType: type,
      kind: kind,
      options: [],
      initialText: null,
      initialOption: null,
      initialOptions: [],
      initialDate: null,
      initialDateTime: null,
    };

    const isEmpty: boolean = isCustomFieldValueEmpty(value);

    switch (kind) {
      case WorkspaceCustomFieldInputKind.Text:
      case WorkspaceCustomFieldInputKind.LongText:
      case WorkspaceCustomFieldInputKind.Number:
        input.initialText = isEmpty ? null : customFieldValueToText(value);
        break;
      case WorkspaceCustomFieldInputKind.YesNo:
        input.options = [
          { value: YES_TOKEN, label: "Yes" },
          { value: NO_TOKEN, label: "No" },
        ];

        if (value === true || value === "true") {
          input.initialOption = YES_TOKEN;
        } else if (value === false || value === "false") {
          input.initialOption = NO_TOKEN;
        }
        break;
      case WorkspaceCustomFieldInputKind.Dropdown:
      case WorkspaceCustomFieldInputKind.MultiSelect: {
        const offered: Array<string> =
          WorkspaceIncidentCustomFields.getOptionValues({
            definition: definition,
            held: value,
          });
        const declared: Set<string> = new Set<string>(
          WorkspaceIncidentCustomFields.getDeclaredOptionValues(definition),
        );

        input.options = offered.map(
          (optionValue: string, index: number): WorkspaceCustomFieldOption => {
            return {
              value: WorkspaceIncidentCustomFields.toToken(index, optionValue),
              label: WorkspaceIncidentCustomFields.toOptionLabel(
                declared.has(optionValue)
                  ? optionValue
                  : `${optionValue} ${NO_LONGER_AN_OPTION}`,
              ),
            };
          },
        );

        const held: Array<string> =
          WorkspaceIncidentCustomFields.toStrings(value);

        const tokens: Array<string> = held
          .map((heldValue: string): string | null => {
            const index: number = offered.indexOf(heldValue);
            return index === -1
              ? null
              : WorkspaceIncidentCustomFields.toToken(index, heldValue);
          })
          .filter((token: string | null): token is string => {
            return token !== null;
          });

        if (kind === WorkspaceCustomFieldInputKind.Dropdown) {
          input.initialOption = tokens[0] || null;
        } else {
          input.initialOptions = tokens;
        }
        break;
      }
      case WorkspaceCustomFieldInputKind.Date: {
        const day: string = isEmpty
          ? ""
          : formatCustomFieldCalendarDate(value).trim();

        input.initialDate = DAY_PATTERN.test(day) ? day : null;
        break;
      }
      case WorkspaceCustomFieldInputKind.DateTime:
        input.initialDateTime = isEmpty ? null : customFieldValueToDate(value);
        break;
    }

    return input;
  }

  /*
   * What a submitted form changes: for each of its inputs the chat sent a
   * value for, the field's new value when it differs from what the incident
   * holds (`stored`), as its type stores it - and, by input id, what is
   * wrong with a value that does not fit its field. `submitted` is read by
   * input id; an input the chat did not send is left as it is.
   */
  public static readSubmission(data: {
    inputs: Array<WorkspaceCustomFieldInput>;
    definitions: Array<WorkspaceCustomFieldDefinition>;
    stored: JSONObject;
    submitted: Record<string, WorkspaceCustomFieldSubmittedValue>;
  }): WorkspaceCustomFieldsSubmission {
    const changes: Array<{ name: string; value: unknown }> = [];
    const problems: Record<string, string> = {};

    for (const input of data.inputs) {
      if (
        !Object.prototype.hasOwnProperty.call(data.submitted, input.inputId)
      ) {
        continue;
      }

      const read: { value: unknown; problem?: string | undefined } =
        WorkspaceIncidentCustomFields.readValue({
          input: input,
          submitted: data.submitted[input.inputId],
          definition: data.definitions.find(
            (definition: WorkspaceCustomFieldDefinition): boolean => {
              return definition.id.toString() === input.definitionId.toString();
            },
          ),
          held: data.stored[input.name],
        });

      if (read.problem) {
        problems[input.inputId] = read.problem;
        continue;
      }

      if (
        WorkspaceIncidentCustomFields.isSameValue({
          kind: input.kind,
          a: read.value,
          b: data.stored[input.name],
        })
      ) {
        continue;
      }

      changes.push({ name: input.name, value: read.value });
    }

    /*
     * Each new value held to its field's type, as the API holds it, by the
     * same rules - answered under its field, not as one sentence after the
     * whole form.
     */
    const written: JSONObject = {};

    for (const change of changes) {
      if (change.value !== null) {
        written[change.name] = change.value as JSONObject[string];
      }
    }

    const errors: Array<CustomFieldValueValidationError> =
      validateCustomFieldValues({
        definitions: data.definitions,
        customFields: written,
        storedCustomFields: data.stored,
      });

    for (const error of errors) {
      const input: WorkspaceCustomFieldInput | undefined = data.inputs.find(
        (candidate: WorkspaceCustomFieldInput): boolean => {
          return candidate.name === error.fieldName;
        },
      );

      if (input) {
        problems[input.inputId] = error.message;
      }
    }

    return {
      changes: changes.filter(
        (change: { name: string; value: unknown }): boolean => {
          return !data.inputs.some(
            (input: WorkspaceCustomFieldInput): boolean => {
              return (
                input.name === change.name && Boolean(problems[input.inputId])
              );
            },
          );
        },
      ),
      problems: problems,
    };
  }

  /*
   * The bag to write: what the incident holds, with each change made - a
   * field emptied taken out.
   */
  public static applyChanges(data: {
    stored: JSONObject;
    changes: Array<{ name: string; value: unknown }>;
  }): JSONObject {
    const bag: JSONObject = { ...data.stored };

    for (const change of data.changes) {
      if (change.value === null) {
        delete bag[change.name];
      } else {
        bag[change.name] = change.value as JSONObject[string];
      }
    }

    return bag;
  }

  /*
   * The project's incident custom fields the member may read, with what the
   * form needs of each. A plan that does not include custom fields, or a
   * role that may not read them, is thrown, worded for the chat.
   */
  @CaptureSpan()
  public static async readDefinitions(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WorkspaceCustomFieldDefinition>> {
    let rows: Array<IncidentCustomField>;

    try {
      rows = await IncidentCustomFieldService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          description: true,
          customFieldType: true,
          dropdownOptions: true,
          mapFromResourceType: true,
          mapFromCustomFieldName: true,
          sortOrder: true,
        },
        sort: {
          sortOrder: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          `You do not have permission to see this project's incident custom fields. ${err.message}`,
        );
      }

      throw err;
    }

    const definitions: Array<WorkspaceCustomFieldDefinition> = [];

    for (const row of rows) {
      if (!row.id || typeof row.name !== "string" || !row.name) {
        continue;
      }

      definitions.push({
        id: row.id,
        name: row.name,
        description: row.description || undefined,
        customFieldType: row.customFieldType || undefined,
        dropdownOptions: row.dropdownOptions || undefined,
        sortOrder:
          typeof row.sortOrder === "number" && Number.isFinite(row.sortOrder)
            ? row.sortOrder
            : null,
        mapFromResourceType: row.mapFromResourceType || undefined,
        mapFromCustomFieldName: row.mapFromCustomFieldName || undefined,
      });
    }

    return definitions;
  }

  /*
   * What the incident holds, read as the member: its custom field values,
   * and how many monitors it has (whose fields copied ones come from).
   * Null for an incident they may not read, as for one that is not there.
   */
  @CaptureSpan()
  public static async readIncidentValues(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ stored: JSONObject; monitorCount: number } | null> {
    let incident: Incident | null = null;

    try {
      incident = await IncidentService.findOneBy({
        query: {
          _id: data.incidentId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          customFields: true,
          monitors: {
            _id: true,
          },
        },
        props: data.props,
      });
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }
    }

    if (!incident) {
      return null;
    }

    const stored: unknown = incident.customFields;

    return {
      stored:
        stored && typeof stored === "object" && !Array.isArray(stored)
          ? (stored as JSONObject)
          : {},
      monitorCount: Array.isArray(incident.monitors)
        ? incident.monitors.length
        : 0,
    };
  }

  /*
   * Writes the changes as the member: the incident's update the Custom
   * Fields card's save makes, so it is held to the same rules - the
   * permission to change the incident's custom fields, its labels and
   * owners, the plan, and each value to its field's type.
   */
  @CaptureSpan()
  public static async save(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    changes: Array<{ name: string; value: unknown }>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    // Read again, now: a value somebody else set since the form opened stays.
    const now: { stored: JSONObject; monitorCount: number } | null =
      await WorkspaceIncidentCustomFields.readIncidentValues({
        incidentId: data.incidentId,
        projectId: data.projectId,
        props: data.props,
      });

    if (!now) {
      throw await WorkspaceMemberActions.getUnreadableRefusal({
        event: { type: WorkspaceEventType.Incident, id: data.incidentId },
        props: data.props,
        action: "edit the custom fields of this incident",
      });
    }

    const customFields: JSONObject = WorkspaceIncidentCustomFields.applyChanges(
      {
        stored: now.stored,
        changes: data.changes,
      },
    );

    /*
     * The bag is a JSON object, which TypeScript cannot hold to a deep
     * partial of the incident ("excessively deep"): it is the column's own
     * type, as the Custom Fields card sends it.
     */
    const updatedCount: number = await IncidentService.updateOneById({
      id: data.incidentId,
      data: {
        customFields: customFields as never,
      },
      props: data.props,
    });

    /*
     * An incident they may read but not change - outside their labels or
     * owners - changes nothing: they are told why, never that it changed.
     */
    if (updatedCount === 0) {
      throw await WorkspaceIncidentActions.getUnwrittenError({
        incidentId: data.incidentId,
        props: data.props,
      });
    }
  }

  // The kind of input a field's type asks for.
  public static getKind(type: CustomFieldType): WorkspaceCustomFieldInputKind {
    switch (type) {
      case CustomFieldType.LongText:
      case CustomFieldType.Markdown:
        return WorkspaceCustomFieldInputKind.LongText;
      case CustomFieldType.Number:
        return WorkspaceCustomFieldInputKind.Number;
      case CustomFieldType.Boolean:
        return WorkspaceCustomFieldInputKind.YesNo;
      case CustomFieldType.Dropdown:
        return WorkspaceCustomFieldInputKind.Dropdown;
      case CustomFieldType.MultiSelectDropdown:
        return WorkspaceCustomFieldInputKind.MultiSelect;
      case CustomFieldType.Date:
        return WorkspaceCustomFieldInputKind.Date;
      case CustomFieldType.DateTime:
        return WorkspaceCustomFieldInputKind.DateTime;
      default:
        return WorkspaceCustomFieldInputKind.Text;
    }
  }

  /*
   * Whether a field's input can open with the value it holds: a number
   * input with a number, a date picker with a day, a date and time picker
   * with a moment. Every other input can, and so can every input of a field
   * that holds nothing.
   */
  public static canShowValue(data: {
    kind: WorkspaceCustomFieldInputKind;
    value: unknown;
  }): boolean {
    if (isCustomFieldValueEmpty(data.value)) {
      return true;
    }

    switch (data.kind) {
      case WorkspaceCustomFieldInputKind.Number:
        return (
          (typeof data.value === "number" || typeof data.value === "string") &&
          Number.isFinite(Number(data.value))
        );
      case WorkspaceCustomFieldInputKind.Date:
        return DAY_PATTERN.test(
          formatCustomFieldCalendarDate(data.value).trim(),
        );
      case WorkspaceCustomFieldInputKind.DateTime:
        return customFieldValueToDate(data.value) !== null;
      default:
        return true;
    }
  }

  // The options a dropdown field offers, and a held value it no longer does.
  private static getOptionValues(data: {
    definition: CustomFieldDefinition;
    held: unknown;
  }): Array<string> {
    const offered: Array<string> =
      WorkspaceIncidentCustomFields.getDeclaredOptionValues(data.definition);

    for (const held of WorkspaceIncidentCustomFields.toStrings(data.held)) {
      if (!offered.includes(held)) {
        offered.push(held);
      }
    }

    return offered;
  }

  private static getDeclaredOptionValues(
    definition: CustomFieldDefinition,
  ): Array<string> {
    const values: Array<string> = [];

    for (const option of parseCustomFieldDropdownOptions(
      definition.dropdownOptions,
    )) {
      if (!values.includes(option.value)) {
        values.push(option.value);
      }
    }

    return values;
  }

  // An option's text, cut to what Slack shows of one.
  private static toOptionLabel(text: string): string {
    const characters: Array<string> = Array.from(text);

    if (characters.length <= MAX_OPTION_LABEL_LENGTH) {
      return text;
    }

    return `${characters
      .slice(0, MAX_OPTION_LABEL_LENGTH - 1)
      .join("")
      .trimEnd()}…`;
  }

  // A value as strings: a list's entries, or the one value.
  private static toStrings(value: unknown): Array<string> {
    if (isCustomFieldValueEmpty(value)) {
      return [];
    }

    if (Array.isArray(value)) {
      return value
        .filter((entry: unknown): boolean => {
          return !isCustomFieldValueEmpty(entry);
        })
        .map((entry: unknown): string => {
          return String(entry);
        });
    }

    return [String(value)];
  }

  /*
   * One input's submitted value, as its field's type stores it - null for
   * an input left empty - or why it cannot be.
   */
  private static readValue(data: {
    input: WorkspaceCustomFieldInput;
    submitted: WorkspaceCustomFieldSubmittedValue;
    definition: WorkspaceCustomFieldDefinition | undefined;
    held: unknown;
  }): { value: unknown; problem?: string | undefined } {
    const { input, submitted } = data;

    if (
      submitted === null ||
      submitted === undefined ||
      (typeof submitted === "string" && submitted.trim() === "") ||
      (Array.isArray(submitted) && submitted.length === 0)
    ) {
      return { value: null };
    }

    switch (input.kind) {
      case WorkspaceCustomFieldInputKind.Text:
        return { value: String(submitted).trim() };
      case WorkspaceCustomFieldInputKind.LongText:
        return { value: String(submitted) };
      case WorkspaceCustomFieldInputKind.Number: {
        const number: number =
          typeof submitted === "number"
            ? submitted
            : Number(String(submitted).trim());

        if (!Number.isFinite(number)) {
          return { value: null, problem: "Enter a number." };
        }

        return { value: number };
      }
      case WorkspaceCustomFieldInputKind.YesNo: {
        const token: string = String(submitted);

        if (token === YES_TOKEN) {
          return { value: true };
        }

        if (token === NO_TOKEN) {
          return { value: false };
        }

        return { value: null, problem: "Pick Yes or No." };
      }
      case WorkspaceCustomFieldInputKind.Dropdown:
      case WorkspaceCustomFieldInputKind.MultiSelect: {
        const offered: Array<string> = data.definition
          ? WorkspaceIncidentCustomFields.getOptionValues({
              definition: data.definition,
              held: data.held,
            })
          : [];

        const tokens: Array<string> = Array.isArray(submitted)
          ? submitted.map((token: string | number): string => {
              return String(token);
            })
          : String(submitted)
              .split(",")
              .map((token: string): string => {
                return token.trim();
              })
              .filter((token: string): boolean => {
                return token.length > 0;
              });

        const values: Array<string> = [];

        for (const token of tokens) {
          const value: string | null = WorkspaceIncidentCustomFields.fromToken(
            token,
            offered,
          );

          if (value === null) {
            return {
              value: null,
              problem:
                "The options of this field changed since the form was opened. Pick again.",
            };
          }

          if (!values.includes(value)) {
            values.push(value);
          }
        }

        if (input.kind === WorkspaceCustomFieldInputKind.Dropdown) {
          return { value: values[0] ?? null };
        }

        return { value: values.length > 0 ? values : null };
      }
      case WorkspaceCustomFieldInputKind.Date: {
        const day: string = String(submitted).trim();

        if (!DAY_PATTERN.test(day) || isNaN(new Date(day).getTime())) {
          return { value: null, problem: "Pick a date." };
        }

        return { value: day };
      }
      case WorkspaceCustomFieldInputKind.DateTime: {
        const moment: Date =
          submitted instanceof Date ? submitted : new Date(String(submitted));

        if (isNaN(moment.getTime())) {
          return { value: null, problem: "Pick a date and a time." };
        }

        return { value: moment.toISOString() };
      }
    }
  }

  // The option a token stands for, among the options the form offered.
  private static fromToken(
    token: string,
    offered: Array<string>,
  ): string | null {
    const separator: number = token.indexOf("_");

    if (!token.startsWith("o") || separator === -1) {
      return null;
    }

    const index: number = Number(token.substring(1, separator));

    if (!Number.isInteger(index) || index < 0 || index >= offered.length) {
      return null;
    }

    const value: string = offered[index]!;

    return WorkspaceIncidentCustomFields.toToken(index, value) === token
      ? value
      : null;
  }

  /*
   * Whether a submitted value is the one the field holds, as its type
   * reads: "42" and 42 are one number, the same options in another order
   * one selection, two instants in the same minute one time - a picker
   * that shows minutes gives back the minute it showed.
   */
  private static isSameValue(data: {
    kind: WorkspaceCustomFieldInputKind;
    a: unknown;
    b: unknown;
  }): boolean {
    const aEmpty: boolean = isCustomFieldValueEmpty(data.a);
    const bEmpty: boolean = isCustomFieldValueEmpty(data.b);

    if (aEmpty || bEmpty) {
      return aEmpty && bEmpty;
    }

    switch (data.kind) {
      case WorkspaceCustomFieldInputKind.Number:
        return Number(data.a) === Number(data.b);
      case WorkspaceCustomFieldInputKind.YesNo:
        return (
          (data.a === true || data.a === "true") ===
          (data.b === true || data.b === "true")
        );
      case WorkspaceCustomFieldInputKind.MultiSelect:
        return (
          JSON.stringify(
            WorkspaceIncidentCustomFields.toStrings(data.a).sort(),
          ) ===
          JSON.stringify(WorkspaceIncidentCustomFields.toStrings(data.b).sort())
        );
      case WorkspaceCustomFieldInputKind.Date:
        return (
          formatCustomFieldCalendarDate(data.a) ===
          formatCustomFieldCalendarDate(data.b)
        );
      case WorkspaceCustomFieldInputKind.DateTime: {
        const a: Date | null = customFieldValueToDate(data.a);
        const b: Date | null = customFieldValueToDate(data.b);

        if (!a || !b) {
          return false;
        }

        return (
          Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000)
        );
      }
      case WorkspaceCustomFieldInputKind.LongText:
        return (
          String(data.a).replace(LINE_ENDING, "\n").trim() ===
          customFieldValueToText(data.b).replace(LINE_ENDING, "\n").trim()
        );
      default:
        return String(data.a).trim() === customFieldValueToText(data.b).trim();
    }
  }
}
