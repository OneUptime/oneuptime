import CreateBy from "../../Types/Database/CreateBy";
import AlertCustomFieldService from "../../Services/AlertCustomFieldService";
import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import DatabaseService from "../../Services/DatabaseService";
import LabelService from "../../Services/LabelService";
import MonitorService from "../../Services/MonitorService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import TeamService from "../../Services/TeamService";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import {
  FormReferenceServiceFunction,
  FormSubmissionContext,
  FormSubmissionCreated,
  FormTargetHandler,
  FormTargetHelpers,
  SortedFormAnswers,
} from "./FormTargetHandler";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServerException from "../../../Types/Exception/ServerException";
import { FormCustomFieldDefinition } from "../../../Types/Form/FormPublic";
import {
  AlertFormTargetSettings,
  FormTargetSettingReferenceModel,
  getFormTargetSettingReferences,
  readFormTargetSettings,
} from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { CustomFieldFile } from "../../../Types/CustomField/CustomFieldFile";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";

/*
 * A form whose submissions create alerts (#10760): a report that deserves a
 * look, and the attention of the people who own it, without declaring an
 * incident - a warning, something odd somebody outside the team noticed.
 *
 * The alert is created as root in the form's project, through AlertService,
 * so it is made exactly as an alert made by hand is: its hooks, its first
 * state and timeline, its owner, label, privacy, on-call and grouping rules,
 * its "Alert Created" notification to its owners, its workspace channels.
 * It is filled in from - in order of precedence - the submitter's answers
 * and the form's On Submit settings:
 *
 *   - its title and description, from the answers (the title from the
 *     form's default title, or its name, when it asks none);
 *   - its severity: the submitter's choice, else the form's - every alert
 *     needs one, and a form left with neither refuses the submission with a
 *     message the submitter can pass on;
 *   - its monitor: the one the submitter chose, else the form's;
 *   - its labels: the submitter's, with the form's always added;
 *   - the state it starts in: the form's, else the project's created state
 *     where every new alert starts. An alert that starts acknowledged pages
 *     nobody - a form for reports that only need a look can say so;
 *   - its on-call policies and owners: the form's.
 *
 * The owners go with the create, as the dashboard's own Create Alert sends
 * them: AlertService adds them once the alert exists, quietly, before its
 * "Alert Created" notification is let go, so they hear of it once, by that
 * notification, as every owner an alert starts with does. It is not
 * private, and has no creating user - nobody signed in to send it. Who sent
 * it, and their answers to the form's own questions, are on its private
 * note.
 *
 * Everything that can refuse a submission is checked in prepare, before the
 * form's hourly ceiling is spent (FormService.submitPublicForm): the
 * public form's protections - its rate limits, the captcha, the IP
 * allowlist, a sign-in, the answers' checks and their neutralizing - are
 * FormService's, and hold for every target alike.
 */

/*
 * The form's severity was deleted, its settings name no other, and the
 * submitter chose none. The submitter cannot fix that, so the message asks
 * them to tell the people who can.
 */
export const FORM_NO_ALERT_SEVERITY_MESSAGE: string =
  "This form cannot create an alert because it has no severity. Please let the team that shared it know.";

/*
 * The records the alert is created with, worked out - and every refusal
 * made - before the form's ceiling is spent. The text (title, description,
 * custom field values) is read from the neutralized answers at create.
 */
export interface PreparedAlert {
  alertSeverityId: ObjectID;
  // Undefined: the project's created state.
  alertStateId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  impactStartedAt?: Date | undefined;
  labelIds: Array<ObjectID>;
  onCallDutyPolicyIds: Array<ObjectID>;
  ownerUserIds: Array<ObjectID>;
  ownerTeamIds: Array<ObjectID>;
}

/*
 * Built per call rather than at module load: these services sit in an
 * import graph that loops back to this one.
 */
const getReferenceService: FormReferenceServiceFunction = (
  model: FormTargetSettingReferenceModel,
): DatabaseService<DatabaseBaseModel> | null => {
  switch (model) {
    case FormTargetSettingReferenceModel.AlertSeverity:
      return AlertSeverityService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.AlertState:
      return AlertStateService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.Monitor:
      return MonitorService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.Label:
      return LabelService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.OnCallDutyPolicy:
      return OnCallDutyPolicyService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.Team:
      return TeamService as unknown as DatabaseService<DatabaseBaseModel>;
    default:
      return null;
  }
};

export default class AlertFormTarget
  implements FormTargetHandler<PreparedAlert>
{
  public readonly targetType: FormTargetType = FormTargetType.Alert;

  public async getCustomFieldDefinitions(
    projectId: ObjectID,
  ): Promise<Array<FormCustomFieldDefinition>> {
    const fields: Array<AlertCustomField> =
      await AlertCustomFieldService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          name: true,
          description: true,
          customFieldType: true,
          dropdownOptions: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    return fields
      .filter((field: AlertCustomField): boolean => {
        return Boolean(field.id && field.name);
      })
      .map((field: AlertCustomField): FormCustomFieldDefinition => {
        return {
          id: field.id!.toString(),
          name: field.name!,
          description: field.description,
          customFieldType: field.customFieldType,
          dropdownOptions: field.dropdownOptions,
        };
      });
  }

  // A severity question starts on the form's severity, as an incident's does.
  public getDefaultOptionValues(
    settings: JSONObject,
  ): Partial<Record<string, string>> {
    const read: AlertFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Alert,
      value: settings,
    }) as AlertFormTargetSettings;

    return read.alertSeverityId
      ? { alertSeverityId: read.alertSeverityId }
      : {};
  }

  /*
   * Every record the settings name belongs to the form's project: each
   * alert created through the form is created in that project with them,
   * and an owner is a member of it.
   */
  public async validateReferences(data: {
    projectId: ObjectID;
    settings: JSONObject;
    storedSettings?: JSONObject | undefined;
  }): Promise<void> {
    const read: AlertFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Alert,
      value: data.settings,
    }) as AlertFormTargetSettings;

    await FormTargetHelpers.validateSettingReferences({
      projectId: data.projectId,
      references: getFormTargetSettingReferences({
        targetType: FormTargetType.Alert,
        settings: read,
      }),
      heldReferences: getFormTargetSettingReferences({
        targetType: FormTargetType.Alert,
        settings: readFormTargetSettings({
          targetType: FormTargetType.Alert,
          value: data.storedSettings,
        }),
      }),
      getService: getReferenceService,
    });
  }

  public async prepare(context: FormSubmissionContext): Promise<PreparedAlert> {
    const form: Form = context.form;
    const projectId: ObjectID = form.projectId!;
    const settings: AlertFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Alert,
      value: form.targetSettings,
    }) as AlertFormTargetSettings;

    const answers: SortedFormAnswers = FormTargetHelpers.sortAnswers(context);

    const [
      stateIds,
      settingsMonitorIds,
      settingsLabelIds,
      onCallDutyPolicyIds,
      ownerUserIds,
      ownerTeamIds,
    ]: [
      Array<ObjectID>,
      Array<ObjectID>,
      Array<ObjectID>,
      Array<ObjectID>,
      Array<ObjectID>,
      Array<ObjectID>,
    ] = await Promise.all([
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.alertStateId ? [settings.alertStateId] : [],
        service:
          AlertStateService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.monitorId ? [settings.monitorId] : [],
        service:
          MonitorService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.labelIds,
        service: LabelService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.onCallDutyPolicyIds,
        service:
          OnCallDutyPolicyService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
      FormTargetHelpers.getUsableOwnerUserIds({
        projectId,
        ids: settings.ownerUserIds,
        form,
      }),
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.ownerTeamIds,
        service: TeamService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
    ]);

    const alertSeverityId: ObjectID = await this.getSeverityId({
      projectId,
      answered: FormTargetHelpers.readIds(
        answers.targetFields["alertSeverityId"],
      )[0],
      fromSettings: settings.alertSeverityId,
    });

    /*
     * The submitter's monitor - the submission check has made sure it is
     * one the form offers - else the form's while it still exists.
     */
    const answeredMonitorId: string | undefined = FormTargetHelpers.readIds(
      answers.targetFields["monitor"],
    )[0];

    const monitorId: ObjectID | undefined = answeredMonitorId
      ? new ObjectID(answeredMonitorId)
      : settingsMonitorIds[0];

    const prepared: PreparedAlert = {
      alertSeverityId: alertSeverityId,
      labelIds: FormTargetHelpers.mergeIds(
        FormTargetHelpers.readIds(answers.targetFields["labels"]),
        settingsLabelIds,
      ),
      onCallDutyPolicyIds: onCallDutyPolicyIds,
      ownerUserIds: ownerUserIds,
      ownerTeamIds: ownerTeamIds,
    };

    if (stateIds[0]) {
      prepared.alertStateId = stateIds[0];
    }

    if (monitorId) {
      prepared.monitorId = monitorId;
    }

    const impactStartedAt: Date | undefined = FormTargetHelpers.readDate(
      answers.targetFields["impactStartedAt"],
    );

    if (impactStartedAt) {
      prepared.impactStartedAt = impactStartedAt;
    }

    return prepared;
  }

  /*
   * Creates the alert, as root, in the form's project. An unanswered
   * description, an empty list of labels or policies and an unset state or
   * monitor are left out rather than sent empty: AlertService then does
   * what it does for any alert made without them.
   */
  public async create(data: {
    context: FormSubmissionContext;
    prepared: PreparedAlert;
  }): Promise<FormSubmissionCreated> {
    const form: Form = data.context.form;
    const prepared: PreparedAlert = data.prepared;
    const answers: SortedFormAnswers = FormTargetHelpers.sortAnswers(
      data.context,
    );
    const settings: AlertFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Alert,
      value: form.targetSettings,
    }) as AlertFormTargetSettings;

    const alert: Alert = new Alert();
    alert.projectId = form.projectId!;
    alert.title = FormTargetHelpers.getTitle({
      answered: answers.targetFields["title"],
      defaultTitle: settings.defaultTitle,
      form: form,
    });

    const description: unknown = answers.targetFields["description"];

    if (typeof description === "string" && description) {
      alert.description = description;
    }

    alert.alertSeverityId = prepared.alertSeverityId;

    if (prepared.alertStateId) {
      alert.currentAlertStateId = prepared.alertStateId;
    }

    if (prepared.monitorId) {
      alert.monitorId = prepared.monitorId;
    }

    if (prepared.impactStartedAt) {
      alert.impactStartedAt = prepared.impactStartedAt;
    }

    if (prepared.labelIds.length > 0) {
      alert.labels = FormTargetHelpers.toStubs(Label, prepared.labelIds);
    }

    if (prepared.onCallDutyPolicyIds.length > 0) {
      alert.onCallDutyPolicies = FormTargetHelpers.toStubs(
        OnCallDutyPolicy,
        prepared.onCallDutyPolicyIds,
      );
    }

    alert.customFields = answers.customFields;

    const createBy: CreateBy<Alert> = {
      data: alert,
      props: {
        isRoot: true,
      },
    };

    /*
     * The owners go with the create, as the dashboard's own Create Alert
     * sends them: AlertService adds them once the alert exists - after its
     * Slack and Microsoft Teams channels, so their own hooks invite them
     * there - and before its "Alert Created" notification goes out.
     */
    const miscDataProps: JSONObject = {};

    if (prepared.ownerUserIds.length > 0) {
      miscDataProps["ownerUsers"] = prepared.ownerUserIds;
    }

    if (prepared.ownerTeamIds.length > 0) {
      miscDataProps["ownerTeams"] = prepared.ownerTeamIds;
    }

    if (Object.keys(miscDataProps).length > 0) {
      createBy.miscDataProps = miscDataProps;
    }

    const created: Alert = await AlertService.create(createBy);

    if (!created.id) {
      throw new ServerException(
        "The alert was created without an id, so its submission could not be linked to it.",
      );
    }

    const result: FormSubmissionCreated = { id: created.id };

    // What the people following the request read it as (FormSubmission.title).
    if (created.title) {
      result.title = created.title;
    }

    const reference: string | undefined =
      created.alertNumberWithPrefix ||
      (typeof created.alertNumber === "number"
        ? `#${created.alertNumber}`
        : undefined);

    if (reference) {
      result.reference = reference;
    }

    return result;
  }

  public async addNote(data: {
    form: Form;
    createdId: ObjectID;
    note: string;
    attachments?: Array<CustomFieldFile> | undefined;
  }): Promise<void> {
    const note: AlertInternalNote = new AlertInternalNote();
    note.projectId = data.form.projectId!;
    note.alertId = data.createdId;
    note.note = data.note;

    // The files the submitter chose for the form's own file questions.
    if (data.attachments && data.attachments.length > 0) {
      note.attachments = FormTargetHelpers.toAttachmentStubs(data.attachments);
    }

    await AlertInternalNoteService.create({
      data: note,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The severity to create the alert with: the submitter's choice (the
   * submission check has made sure it is one the form offers), else the
   * form's own while it still exists. With neither, the submission is
   * refused here, with a message the submitter can pass on, rather than
   * failing inside the create as a missing required column.
   */
  private async getSeverityId(data: {
    projectId: ObjectID;
    answered: string | undefined;
    fromSettings: string | undefined;
  }): Promise<ObjectID> {
    if (data.answered) {
      return new ObjectID(data.answered);
    }

    if (
      data.fromSettings &&
      (await ProjectScopedReferenceValidator.isUsableInProject({
        projectId: data.projectId,
        id: data.fromSettings,
        service:
          AlertSeverityService as unknown as DatabaseService<DatabaseBaseModel>,
      }))
    ) {
      return new ObjectID(data.fromSettings);
    }

    throw new BadDataException(FORM_NO_ALERT_SEVERITY_MESSAGE);
  }
}
