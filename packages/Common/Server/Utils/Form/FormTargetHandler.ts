import DatabaseService from "../../Services/DatabaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import { FormFieldSource, FormSubmitterField } from "../../../Types/Form/FormField";
import {
  FormCustomFieldDefinition,
  FormFieldBinding,
  PublicFormField,
  PublicFormFieldType,
  ValidatedFormAnswers,
} from "../../../Types/Form/FormPublic";
import { getFormAnswerDisplayValue } from "../../../Types/Form/FormSubmissionAnswer";
import {
  FormTargetSettingReference,
  FormTargetSettingReferenceModel,
} from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import { FormNoteAnswer, FormNoteAnswerFormat } from "./FormSubmissionNote";

/*
 * What creates a submission's record: one handler per target (an incident,
 * a scheduled maintenance event), so FormService itself is written for no
 * target in particular. A new target is a handler here, its fields in
 * FormTargetCatalog and its settings in FormTargetSettings.
 *
 * A handler is asked, in order:
 *
 *   1. getCustomFieldDefinitions - the target's custom fields in the
 *      project, for the questions linked to one;
 *   2. prepare - everything about a checked submission that can still
 *      refuse it (a form left with no severity, a maintenance window that
 *      ends before it starts), before the form's hourly ceiling is spent;
 *   3. create - the record itself, as root, in the form's project;
 *   4. addNote - the private note that names the submitter and lists the
 *      answers, once the record exists.
 *
 * and, when a form is written, validateReferences: every record its
 * settings and questions name must belong to the form's own project.
 */

// A checked, neutralized submission, ready for a handler.
export interface FormSubmissionContext {
  form: Form;
  fields: Array<PublicFormField>;
  bindings: Record<string, FormFieldBinding>;
  answers: ValidatedFormAnswers;
}

export interface FormSubmissionCreated {
  id: ObjectID;
  // The record's number as the project shows it: "INC-42", "#7".
  reference?: string | undefined;
}

/*
 * The answers sorted by where they go: a built-in field's value by its key,
 * a custom field's by its name (records store custom field values by name),
 * the submitter's details, and the answers to the form's own questions,
 * which only the note carries.
 */
export interface SortedFormAnswers {
  targetFields: Record<string, JSONValue>;
  // The label each built-in field was asked with, for messages.
  targetFieldLabels: Record<string, string>;
  customFields: JSONObject;
  submitterName?: string | undefined;
  submitterEmail?: string | undefined;
  questions: Array<FormNoteAnswer>;
}

// The service that owns a kind of record a target's settings can name.
export type FormReferenceServiceFunction = (
  model: FormTargetSettingReferenceModel,
) => DatabaseService<DatabaseBaseModel> | null;

export interface FormTargetHandler<TPrepared> {
  targetType: FormTargetType;

  getCustomFieldDefinitions(
    projectId: ObjectID,
  ): Promise<Array<FormCustomFieldDefinition>>;

  // The option a choice question starts on, by target field key.
  getDefaultOptionValues(settings: JSONObject): Partial<Record<string, string>>;

  validateReferences(data: {
    projectId: ObjectID;
    settings: JSONObject;
  }): Promise<void>;

  prepare(context: FormSubmissionContext): Promise<TPrepared>;

  create(data: {
    context: FormSubmissionContext;
    prepared: TPrepared;
  }): Promise<FormSubmissionCreated>;

  addNote(data: {
    form: Form;
    createdId: ObjectID;
    note: string;
  }): Promise<void>;
}

type NoteFormatFunction = (type: PublicFormFieldType) => FormNoteAnswerFormat;

const getNoteFormat: NoteFormatFunction = (
  type: PublicFormFieldType,
): FormNoteAnswerFormat => {
  if (type === PublicFormFieldType.Markdown) {
    return FormNoteAnswerFormat.Markdown;
  }

  if (type === PublicFormFieldType.LongText) {
    return FormNoteAnswerFormat.MultiLine;
  }

  return FormNoteAnswerFormat.SingleLine;
};

export class FormTargetHelpers {
  /** The answers, sorted by where they go (see SortedFormAnswers). */
  public static sortAnswers(context: FormSubmissionContext): SortedFormAnswers {
    const sorted: SortedFormAnswers = {
      targetFields: {},
      targetFieldLabels: {},
      customFields: {},
      questions: [],
    };

    for (const field of context.fields) {
      const binding: FormFieldBinding | undefined = context.bindings[field.id];

      if (
        !binding ||
        !Object.prototype.hasOwnProperty.call(context.answers, field.id)
      ) {
        continue;
      }

      const value: JSONValue = context.answers[field.id] as JSONValue;

      switch (binding.source) {
        case FormFieldSource.TargetField:
          sorted.targetFields[binding.definition.key] = value;
          sorted.targetFieldLabels[binding.definition.key] = field.label;
          break;

        case FormFieldSource.TargetCustomField:
          /*
           * Defined, not assigned: records key custom fields by name, and a
           * field may be named "__proto__".
           */
          Object.defineProperty(sorted.customFields, binding.customFieldName, {
            value: value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          break;

        case FormFieldSource.Submitter:
          if (typeof value === "string" && value) {
            if (binding.submitterField === FormSubmitterField.Email) {
              sorted.submitterEmail = value;
            } else {
              sorted.submitterName = value;
            }
          }
          break;

        case FormFieldSource.Question:
          sorted.questions.push({
            label: field.label,
            displayValue: getFormAnswerDisplayValue(field, value),
            format: getNoteFormat(field.type),
          });
          break;
      }
    }

    return sorted;
  }

  /*
   * The ids that still name records of the project - a setting names
   * records chosen when the form was saved, and some may be gone since - each
   * once, in order. Never throws: a record that cannot be checked is left
   * out, and the submission goes ahead without it.
   */
  public static async getUsableIds(data: {
    projectId: ObjectID;
    ids: Array<string> | undefined;
    service: DatabaseService<DatabaseBaseModel>;
    form: Form;
  }): Promise<Array<ObjectID>> {
    if (!data.ids || data.ids.length === 0) {
      return [];
    }

    try {
      const result: {
        usableIds: Array<ObjectID | string>;
        droppedIds: Array<ObjectID | string>;
      } = await ProjectScopedReferenceValidator.filterUsableInProject({
        projectId: data.projectId,
        ids: data.ids,
        service: data.service,
      });

      return result.usableIds.map((id: ObjectID | string): ObjectID => {
        return new ObjectID(id.toString());
      });
    } catch (err) {
      logger.error(
        `Forms: could not check the records form ${data.form.id?.toString()} names; they are left out of this submission.`,
        FormTargetHelpers.getLogAttributes(data.form),
      );
      logger.error(err, FormTargetHelpers.getLogAttributes(data.form));
      return [];
    }
  }

  /*
   * The users among the ids who are members of the project now: an owner
   * who left is not added (and so not notified).
   */
  public static async getUsableOwnerUserIds(data: {
    projectId: ObjectID;
    ids: Array<string> | undefined;
    form: Form;
  }): Promise<Array<ObjectID>> {
    if (!data.ids || data.ids.length === 0) {
      return [];
    }

    try {
      return await TeamMemberService.getProjectMemberUserIds({
        projectId: data.projectId,
        userIds: data.ids,
      });
    } catch (err) {
      logger.error(
        `Forms: could not check the owners form ${data.form.id?.toString()} names; they are left out of this submission.`,
        FormTargetHelpers.getLogAttributes(data.form),
      );
      logger.error(err, FormTargetHelpers.getLogAttributes(data.form));
      return [];
    }
  }

  /*
   * The record's title: the submitter's answer, else the form's default
   * title, else the form's name - so a form that does not ask for a title
   * still creates something the responders can tell apart.
   */
  public static getTitle(data: {
    answered: JSONValue | undefined;
    defaultTitle: string | undefined;
    form: Form;
  }): string {
    if (typeof data.answered === "string" && data.answered) {
      return data.answered;
    }

    return data.defaultTitle || data.form.name || "Form submission";
  }

  // Ids from a choice answer (one id, or a list of them).
  public static readIds(value: JSONValue | undefined): Array<string> {
    const entries: Array<unknown> = Array.isArray(value)
      ? value
      : value === undefined || value === null
        ? []
        : [value];

    const ids: Array<string> = [];

    for (const entry of entries) {
      const id: string =
        typeof entry === "string" ? entry.trim().toLowerCase() : "";

      if (ObjectID.isValidUUID(id) && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  // Two id lists as one, each id once, in order.
  public static mergeIds(
    ...lists: Array<Array<ObjectID | string>>
  ): Array<ObjectID> {
    const merged: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const list of lists) {
      for (const id of list) {
        const key: string = id.toString().toLowerCase();

        if (ObjectID.isValidUUID(key) && !merged.has(key)) {
          merged.set(key, new ObjectID(key));
        }
      }
    }

    return Array.from(merged.values());
  }

  // A date answer, or undefined for none or one that is not a date.
  public static readDate(value: JSONValue | undefined): Date | undefined {
    if (typeof value !== "string" && typeof value !== "number") {
      return undefined;
    }

    const date: Date = new Date(value);

    return isNaN(date.getTime()) ? undefined : date;
  }

  /*
   * The record ids a list of stubs needs: each id as a model with only its
   * _id set, the shape a many-to-many relation is written with.
   */
  public static toStubs<T extends DatabaseBaseModel>(
    modelType: { new (): T },
    ids: Array<ObjectID>,
  ): Array<T> {
    return ids.map((id: ObjectID): T => {
      const stub: T = new modelType();
      stub._id = id.toString();
      return stub;
    });
  }

  /*
   * Every record a target's settings name belongs to the project, or the
   * write is refused naming the setting. Users are checked as members of
   * the project (they have no project of their own); everything else as a
   * record of the project.
   */
  public static async validateSettingReferences(data: {
    projectId: ObjectID;
    references: Array<FormTargetSettingReference>;
    getService: FormReferenceServiceFunction;
  }): Promise<void> {
    for (const reference of data.references) {
      if (reference.model === FormTargetSettingReferenceModel.User) {
        const members: Array<ObjectID> =
          await TeamMemberService.getProjectMemberUserIds({
            projectId: data.projectId,
            userIds: reference.ids,
          });

        if (members.length !== reference.ids.length) {
          throw new BadDataException(
            `${reference.title}: every owner must be a member of this project.`,
          );
        }

        continue;
      }

      const service: DatabaseService<DatabaseBaseModel> | null =
        data.getService(reference.model);

      if (!service) {
        throw new BadDataException(
          `${reference.title} cannot be checked against this project.`,
        );
      }

      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: data.projectId,
        subject: "form",
        references: reference.ids.map((id: string) => {
          return {
            modelName: reference.title,
            id: id,
            service: service,
          };
        }),
      });
    }
  }

  public static getLogAttributes(form: Form): LogAttributes {
    return {
      projectId: form.projectId?.toString(),
      formId: form.id?.toString(),
    };
  }
}
