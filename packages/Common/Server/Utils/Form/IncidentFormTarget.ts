import CreateBy from "../../Types/Database/CreateBy";
import IncidentCustomFieldService from "../../Services/IncidentCustomFieldService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentTemplateOwnerTeamService from "../../Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../Services/IncidentTemplateService";
import LabelService from "../../Services/LabelService";
import MonitorService from "../../Services/MonitorService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import TeamService from "../../Services/TeamService";
import DatabaseService from "../../Services/DatabaseService";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import logger from "../Logger";
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
  FormTargetSettingReferenceModel,
  getFormTargetSettingReferences,
  IncidentFormTargetSettings,
  readFormTargetSettings,
} from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";

/*
 * A form whose submissions declare incidents.
 *
 * The incident is created as root in the form's project, from - in order of
 * precedence - the submitter's answers, the form's On Submit settings, and
 * the form's incident template, which fills in whatever the first two leave
 * unset (IncidentService's template branch: the initial state, the
 * severity, the description, monitors, labels, on-call policies, status
 * pages, custom field values and a monitor status change).
 *
 * The incident starts off every status page and without notifying their
 * subscribers, whatever the template says: a stranger's report is for the
 * responders to triage before anything about it is published. It is not
 * private, and has no creating user - nobody signed in to send it.
 */

/*
 * The form's severity was deleted, its settings name no other, the
 * submitter chose none and the template sets none. The submitter cannot fix
 * that, so the message asks them to tell the people who can.
 */
export const FORM_NO_SEVERITY_MESSAGE: string =
  "This form cannot create an incident because it has no severity. Please let the team that shared it know.";

/*
 * The records the incident is created with, worked out - and every refusal
 * made - before the form's ceiling is spent. The text (title, description,
 * custom field values) is read from the neutralized answers at create.
 */
export interface PreparedIncident {
  // Undefined when the template's severity applies.
  incidentSeverityId?: ObjectID | undefined;
  incidentTemplateId?: ObjectID | undefined;
  impactStartedAt?: Date | undefined;
  monitorIds: Array<ObjectID>;
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
    case FormTargetSettingReferenceModel.IncidentSeverity:
      return IncidentSeverityService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.IncidentTemplate:
      return IncidentTemplateService as unknown as DatabaseService<DatabaseBaseModel>;
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

export default class IncidentFormTarget
  implements FormTargetHandler<PreparedIncident>
{
  public readonly targetType: FormTargetType = FormTargetType.Incident;

  public async getCustomFieldDefinitions(
    projectId: ObjectID,
  ): Promise<Array<FormCustomFieldDefinition>> {
    const fields: Array<IncidentCustomField> =
      await IncidentCustomFieldService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          name: true,
          description: true,
          customFieldType: true,
          dropdownOptions: true,
        },
        sort: { sortOrder: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    return fields
      .filter((field: IncidentCustomField): boolean => {
        return Boolean(field.id && field.name);
      })
      .map((field: IncidentCustomField): FormCustomFieldDefinition => {
        return {
          id: field.id!.toString(),
          name: field.name!,
          description: field.description,
          customFieldType: field.customFieldType,
          dropdownOptions: field.dropdownOptions,
        };
      });
  }

  public getDefaultOptionValues(
    settings: JSONObject,
  ): Partial<Record<string, string>> {
    const read: IncidentFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Incident,
      value: settings,
    }) as IncidentFormTargetSettings;

    return read.incidentSeverityId
      ? { incidentSeverityId: read.incidentSeverityId }
      : {};
  }

  /*
   * Every record the settings name belongs to the form's project: each
   * incident declared through the form is created in that project with
   * them, and an owner is a member of it.
   */
  public async validateReferences(data: {
    projectId: ObjectID;
    settings: JSONObject;
  }): Promise<void> {
    const read: IncidentFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Incident,
      value: data.settings,
    }) as IncidentFormTargetSettings;

    await FormTargetHelpers.validateSettingReferences({
      projectId: data.projectId,
      references: getFormTargetSettingReferences({
        targetType: FormTargetType.Incident,
        settings: read,
      }),
      getService: getReferenceService,
    });
  }

  public async prepare(
    context: FormSubmissionContext,
  ): Promise<PreparedIncident> {
    const form: Form = context.form;
    const projectId: ObjectID = form.projectId!;
    const settings: IncidentFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Incident,
      value: form.targetSettings,
    }) as IncidentFormTargetSettings;

    const answers: SortedFormAnswers = FormTargetHelpers.sortAnswers(context);

    const [
      templateIds,
      settingsMonitorIds,
      settingsLabelIds,
      onCallDutyPolicyIds,
      settingsOwnerUserIds,
      settingsOwnerTeamIds,
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
        ids: settings.incidentTemplateId ? [settings.incidentTemplateId] : [],
        service:
          IncidentTemplateService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.monitorIds,
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

    const incidentTemplateId: ObjectID | undefined = templateIds[0];

    const incidentSeverityId: ObjectID | undefined =
      await this.getSeverityId({
        projectId,
        answered: FormTargetHelpers.readIds(
          answers.targetFields["incidentSeverityId"],
        )[0],
        fromSettings: settings.incidentSeverityId,
        incidentTemplateId,
      });

    const templateOwners: { userIds: Array<ObjectID>; teamIds: Array<ObjectID> } =
      await this.getTemplateOwners({ form, incidentTemplateId });

    const prepared: PreparedIncident = {
      monitorIds: FormTargetHelpers.mergeIds(
        FormTargetHelpers.readIds(answers.targetFields["monitors"]),
        settingsMonitorIds,
      ),
      labelIds: FormTargetHelpers.mergeIds(
        FormTargetHelpers.readIds(answers.targetFields["labels"]),
        settingsLabelIds,
      ),
      onCallDutyPolicyIds: onCallDutyPolicyIds,
      ownerUserIds: FormTargetHelpers.mergeIds(
        settingsOwnerUserIds,
        templateOwners.userIds,
      ),
      ownerTeamIds: FormTargetHelpers.mergeIds(
        settingsOwnerTeamIds,
        templateOwners.teamIds,
      ),
    };

    if (incidentSeverityId) {
      prepared.incidentSeverityId = incidentSeverityId;
    }

    if (incidentTemplateId) {
      prepared.incidentTemplateId = incidentTemplateId;
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
   * Creates the incident, as root, in the form's project.
   *
   * With a template, createdIncidentTemplateId hands the rest to
   * IncidentService's template branch. That branch only runs when no state
   * is given, so currentIncidentStateId is never set here; and it only
   * fills in what is undefined, so an unanswered description, and an empty
   * list of monitors or labels, are left out rather than sent empty.
   *
   * The owners - the form's and its template's - are handed over with the
   * create, not added once it returns: IncidentService adds them after the
   * incident's Slack and Microsoft Teams channels exist, so their own hooks
   * invite them to those channels. notifyOwners asks for them to be told -
   * they are the people a submission through this form is meant to reach -
   * and IncidentService holds the incident's "Incident Created"
   * notification until they are its owners.
   */
  public async create(data: {
    context: FormSubmissionContext;
    prepared: PreparedIncident;
  }): Promise<FormSubmissionCreated> {
    const form: Form = data.context.form;
    const prepared: PreparedIncident = data.prepared;
    const answers: SortedFormAnswers = FormTargetHelpers.sortAnswers(
      data.context,
    );
    const settings: IncidentFormTargetSettings = readFormTargetSettings({
      targetType: FormTargetType.Incident,
      value: form.targetSettings,
    }) as IncidentFormTargetSettings;

    const incident: Incident = new Incident();
    incident.projectId = form.projectId!;
    incident.title = FormTargetHelpers.getTitle({
      answered: answers.targetFields["title"],
      defaultTitle: settings.defaultTitle,
      form: form,
    });

    const description: unknown = answers.targetFields["description"];

    if (typeof description === "string" && description) {
      incident.description = description;
    }

    if (prepared.incidentSeverityId) {
      incident.incidentSeverityId = prepared.incidentSeverityId;
    }

    if (prepared.incidentTemplateId) {
      incident.createdIncidentTemplateId =
        prepared.incidentTemplateId.toString();
    }

    if (prepared.impactStartedAt) {
      incident.impactStartedAt = prepared.impactStartedAt;
    }

    if (prepared.monitorIds.length > 0) {
      incident.monitors = FormTargetHelpers.toStubs(
        Monitor,
        prepared.monitorIds,
      );
    }

    if (prepared.labelIds.length > 0) {
      incident.labels = FormTargetHelpers.toStubs(Label, prepared.labelIds);
    }

    if (prepared.onCallDutyPolicyIds.length > 0) {
      incident.onCallDutyPolicies = FormTargetHelpers.toStubs(
        OnCallDutyPolicy,
        prepared.onCallDutyPolicyIds,
      );
    }

    incident.customFields = answers.customFields;
    incident.isVisibleOnStatusPage = false;
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;

    const createBy: CreateBy<Incident> = {
      data: incident,
      props: {
        isRoot: true,
      },
    };

    const miscDataProps: JSONObject = {};

    if (prepared.ownerUserIds.length > 0) {
      miscDataProps["ownerUsers"] = prepared.ownerUserIds;
    }

    if (prepared.ownerTeamIds.length > 0) {
      miscDataProps["ownerTeams"] = prepared.ownerTeamIds;
    }

    if (Object.keys(miscDataProps).length > 0) {
      miscDataProps["notifyOwners"] = true;
      createBy.miscDataProps = miscDataProps;
    }

    const created: Incident = await IncidentService.create(createBy);

    if (!created.id) {
      throw new ServerException(
        "The incident was created without an id, so its submission could not be linked to it.",
      );
    }

    const result: FormSubmissionCreated = { id: created.id };

    const reference: string | undefined =
      created.incidentNumberWithPrefix ||
      (typeof created.incidentNumber === "number"
        ? `#${created.incidentNumber}`
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
  }): Promise<void> {
    const note: IncidentInternalNote = new IncidentInternalNote();
    note.projectId = data.form.projectId!;
    note.incidentId = data.createdId;
    note.note = data.note;

    await IncidentInternalNoteService.create({
      data: note,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The severity to declare the incident with: the submitter's choice (the
   * submission check has made sure it is one the form offers), else the
   * form's own while it still exists. With neither, the template's applies
   * - returned as "none" so IncidentService's template branch fills it in -
   * and with no template severity either the submission is refused here,
   * with a message the submitter can pass on, rather than failing inside
   * the create as a missing required column.
   */
  private async getSeverityId(data: {
    projectId: ObjectID;
    answered: string | undefined;
    fromSettings: string | undefined;
    incidentTemplateId: ObjectID | undefined;
  }): Promise<ObjectID | undefined> {
    if (data.answered) {
      return new ObjectID(data.answered);
    }

    if (
      data.fromSettings &&
      (await ProjectScopedReferenceValidator.isUsableInProject({
        projectId: data.projectId,
        id: data.fromSettings,
        service:
          IncidentSeverityService as unknown as DatabaseService<DatabaseBaseModel>,
      }))
    ) {
      return new ObjectID(data.fromSettings);
    }

    if (data.incidentTemplateId) {
      const template: IncidentTemplate | null =
        await IncidentTemplateService.findOneBy({
          query: {
            _id: data.incidentTemplateId.toString(),
            projectId: data.projectId,
          },
          select: {
            incidentSeverityId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (template?.incidentSeverityId) {
        return undefined;
      }
    }

    throw new BadDataException(FORM_NO_SEVERITY_MESSAGE);
  }

  /*
   * The owners of the form's template, which become the incident's too:
   * none when the form has no template, or its template no owners. A
   * failure to read them is logged, and the incident is declared without
   * them - the submission still reaches on-call through the form's own
   * owners, the template's policies and the project's rules.
   */
  private async getTemplateOwners(data: {
    form: Form;
    incidentTemplateId: ObjectID | undefined;
  }): Promise<{ userIds: Array<ObjectID>; teamIds: Array<ObjectID> }> {
    const owners: { userIds: Array<ObjectID>; teamIds: Array<ObjectID> } = {
      userIds: [],
      teamIds: [],
    };

    if (!data.incidentTemplateId) {
      return owners;
    }

    try {
      const query: { incidentTemplateId: ObjectID; projectId: ObjectID } = {
        incidentTemplateId: data.incidentTemplateId,
        projectId: data.form.projectId!,
      };

      const [ownerUsers, ownerTeams]: [
        Array<IncidentTemplateOwnerUser>,
        Array<IncidentTemplateOwnerTeam>,
      ] = await Promise.all([
        IncidentTemplateOwnerUserService.findBy({
          query: query,
          select: { userId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
        IncidentTemplateOwnerTeamService.findBy({
          query: query,
          select: { teamId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

      for (const owner of ownerUsers) {
        if (owner.userId) {
          owners.userIds.push(owner.userId);
        }
      }

      for (const owner of ownerTeams) {
        if (owner.teamId) {
          owners.teamIds.push(owner.teamId);
        }
      }
    } catch (err) {
      logger.error(
        `Forms: could not read the owners of the incident template of form ${data.form.id?.toString()}; the incident is declared without them.`,
        FormTargetHelpers.getLogAttributes(data.form),
      );
      logger.error(err, FormTargetHelpers.getLogAttributes(data.form));

      return { userIds: [], teamIds: [] };
    }

    return owners;
  }
}
