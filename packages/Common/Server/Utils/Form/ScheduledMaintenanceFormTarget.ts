import CreateBy from "../../Types/Database/CreateBy";
import DatabaseService from "../../Services/DatabaseService";
import LabelService from "../../Services/LabelService";
import MonitorService from "../../Services/MonitorService";
import ScheduledMaintenanceCustomFieldService from "../../Services/ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceInternalNoteService from "../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import StatusPageService from "../../Services/StatusPageService";
import TeamService from "../../Services/TeamService";
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
  readFormTargetSettings,
  ScheduledMaintenanceFormTargetSettings,
} from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";

/*
 * A form whose submissions schedule maintenance events - a change request, a
 * planned outage somebody outside the team needs.
 *
 * The event is created as root in the form's project, in its Scheduled
 * state (ScheduledMaintenanceService picks the project's scheduled state),
 * from the submitter's answers - every form of this target asks when the
 * maintenance starts and ends (FormTargetCatalog) - and the form's On Submit
 * settings.
 *
 * A submission is somebody's request, and a request is reviewed before it is
 * published: unless the form's settings say otherwise, the event is not
 * shown on its status pages, and their subscribers are told nothing - not
 * when it is created, nor when it starts or ends.
 */

/*
 * The window and the records the event is created with, worked out - and
 * every refusal made - before the form's ceiling is spent. The text
 * (title, description, custom field values) is read from the neutralized
 * answers at create.
 */
export interface PreparedScheduledMaintenance {
  startsAt: Date;
  endsAt: Date;
  monitorIds: Array<ObjectID>;
  statusPageIds: Array<ObjectID>;
  labelIds: Array<ObjectID>;
  ownerUserIds: Array<ObjectID>;
  ownerTeamIds: Array<ObjectID>;
  isVisibleOnStatusPage: boolean;
  notifySubscribers: boolean;
}

/*
 * Built per call rather than at module load: these services sit in an
 * import graph that loops back to this one.
 */
const getReferenceService: FormReferenceServiceFunction = (
  model: FormTargetSettingReferenceModel,
): DatabaseService<DatabaseBaseModel> | null => {
  switch (model) {
    case FormTargetSettingReferenceModel.Monitor:
      return MonitorService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.StatusPage:
      return StatusPageService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.Label:
      return LabelService as unknown as DatabaseService<DatabaseBaseModel>;
    case FormTargetSettingReferenceModel.Team:
      return TeamService as unknown as DatabaseService<DatabaseBaseModel>;
    default:
      return null;
  }
};

export default class ScheduledMaintenanceFormTarget
  implements FormTargetHandler<PreparedScheduledMaintenance>
{
  public readonly targetType: FormTargetType =
    FormTargetType.ScheduledMaintenance;

  public async getCustomFieldDefinitions(
    projectId: ObjectID,
  ): Promise<Array<FormCustomFieldDefinition>> {
    const fields: Array<ScheduledMaintenanceCustomField> =
      await ScheduledMaintenanceCustomFieldService.findBy({
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
      .filter((field: ScheduledMaintenanceCustomField): boolean => {
        return Boolean(field.id && field.name);
      })
      .map(
        (field: ScheduledMaintenanceCustomField): FormCustomFieldDefinition => {
          return {
            id: field.id!.toString(),
            name: field.name!,
            description: field.description,
            customFieldType: field.customFieldType,
            dropdownOptions: field.dropdownOptions,
          };
        },
      );
  }

  public getDefaultOptionValues(): Partial<Record<string, string>> {
    return {};
  }

  public async validateReferences(data: {
    projectId: ObjectID;
    settings: JSONObject;
  }): Promise<void> {
    const read: ScheduledMaintenanceFormTargetSettings =
      readFormTargetSettings({
        targetType: FormTargetType.ScheduledMaintenance,
        value: data.settings,
      }) as ScheduledMaintenanceFormTargetSettings;

    await FormTargetHelpers.validateSettingReferences({
      projectId: data.projectId,
      references: getFormTargetSettingReferences({
        targetType: FormTargetType.ScheduledMaintenance,
        settings: read,
      }),
      getService: getReferenceService,
    });
  }

  public async prepare(
    context: FormSubmissionContext,
  ): Promise<PreparedScheduledMaintenance> {
    const form: Form = context.form;
    const projectId: ObjectID = form.projectId!;
    const settings: ScheduledMaintenanceFormTargetSettings =
      readFormTargetSettings({
        targetType: FormTargetType.ScheduledMaintenance,
        value: form.targetSettings,
      }) as ScheduledMaintenanceFormTargetSettings;

    const answers: SortedFormAnswers = FormTargetHelpers.sortAnswers(context);

    const startsAt: Date | undefined = FormTargetHelpers.readDate(
      answers.targetFields["startsAt"],
    );
    const endsAt: Date | undefined = FormTargetHelpers.readDate(
      answers.targetFields["endsAt"],
    );

    const startsAtLabel: string =
      answers.targetFieldLabels["startsAt"] || "Starts At";
    const endsAtLabel: string = answers.targetFieldLabels["endsAt"] || "Ends At";

    /*
     * Every form of this target asks both, and requires them
     * (validateFormFields), so the submission check has already refused
     * one without them. Checked again here: a form saved before that rule,
     * or edited by hand in the database, must still not create an event
     * with no window.
     */
    if (!startsAt) {
      throw new BadDataException(`${startsAtLabel} is required.`);
    }

    if (!endsAt) {
      throw new BadDataException(`${endsAtLabel} is required.`);
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadDataException(
        `${endsAtLabel} must be after ${startsAtLabel}.`,
      );
    }

    const [
      settingsMonitorIds,
      settingsStatusPageIds,
      settingsLabelIds,
      ownerUserIds,
      ownerTeamIds,
    ]: [
      Array<ObjectID>,
      Array<ObjectID>,
      Array<ObjectID>,
      Array<ObjectID>,
      Array<ObjectID>,
    ] = await Promise.all([
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.monitorIds,
        service:
          MonitorService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.statusPageIds,
        service:
          StatusPageService as unknown as DatabaseService<DatabaseBaseModel>,
        form,
      }),
      FormTargetHelpers.getUsableIds({
        projectId,
        ids: settings.labelIds,
        service: LabelService as unknown as DatabaseService<DatabaseBaseModel>,
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

    const prepared: PreparedScheduledMaintenance = {
      startsAt: startsAt,
      endsAt: endsAt,
      monitorIds: FormTargetHelpers.mergeIds(
        FormTargetHelpers.readIds(answers.targetFields["monitors"]),
        settingsMonitorIds,
      ),
      statusPageIds: FormTargetHelpers.mergeIds(
        FormTargetHelpers.readIds(answers.targetFields["statusPages"]),
        settingsStatusPageIds,
      ),
      labelIds: FormTargetHelpers.mergeIds(
        FormTargetHelpers.readIds(answers.targetFields["labels"]),
        settingsLabelIds,
      ),
      ownerUserIds: ownerUserIds,
      ownerTeamIds: ownerTeamIds,
      isVisibleOnStatusPage: settings.showOnStatusPages === true,
      notifySubscribers: settings.notifySubscribers === true,
    };

    return prepared;
  }

  public async create(data: {
    context: FormSubmissionContext;
    prepared: PreparedScheduledMaintenance;
  }): Promise<FormSubmissionCreated> {
    const form: Form = data.context.form;
    const prepared: PreparedScheduledMaintenance = data.prepared;
    const answers: SortedFormAnswers = FormTargetHelpers.sortAnswers(
      data.context,
    );
    const settings: ScheduledMaintenanceFormTargetSettings =
      readFormTargetSettings({
        targetType: FormTargetType.ScheduledMaintenance,
        value: form.targetSettings,
      }) as ScheduledMaintenanceFormTargetSettings;

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.projectId = form.projectId!;
    event.title = FormTargetHelpers.getTitle({
      answered: answers.targetFields["title"],
      defaultTitle: settings.defaultTitle,
      form: form,
    });
    event.startsAt = prepared.startsAt;
    event.endsAt = prepared.endsAt;

    const description: unknown = answers.targetFields["description"];

    if (typeof description === "string" && description) {
      event.description = description;
    }

    if (prepared.monitorIds.length > 0) {
      event.monitors = FormTargetHelpers.toStubs(Monitor, prepared.monitorIds);
    }

    if (prepared.statusPageIds.length > 0) {
      event.statusPages = FormTargetHelpers.toStubs(
        StatusPage,
        prepared.statusPageIds,
      );
    }

    if (prepared.labelIds.length > 0) {
      event.labels = FormTargetHelpers.toStubs(Label, prepared.labelIds);
    }

    event.customFields = answers.customFields;
    event.isVisibleOnStatusPage = prepared.isVisibleOnStatusPage;
    event.shouldStatusPageSubscribersBeNotifiedOnEventCreated =
      prepared.notifySubscribers;
    event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
      prepared.notifySubscribers;
    event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
      prepared.notifySubscribers;

    const createBy: CreateBy<ScheduledMaintenance> = {
      data: event,
      props: {
        isRoot: true,
      },
    };

    /*
     * The owners go with the create, as the dashboard's own Create sends
     * them: ScheduledMaintenanceService adds them once the event exists.
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

    const created: ScheduledMaintenance =
      await ScheduledMaintenanceService.create(createBy);

    if (!created.id) {
      throw new ServerException(
        "The scheduled maintenance event was created without an id, so its submission could not be linked to it.",
      );
    }

    const result: FormSubmissionCreated = { id: created.id };

    const reference: string | undefined =
      created.scheduledMaintenanceNumberWithPrefix ||
      (typeof created.scheduledMaintenanceNumber === "number"
        ? `#${created.scheduledMaintenanceNumber}`
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
    const note: ScheduledMaintenanceInternalNote =
      new ScheduledMaintenanceInternalNote();
    note.projectId = data.form.projectId!;
    note.scheduledMaintenanceId = data.createdId;
    note.note = data.note;

    await ScheduledMaintenanceInternalNoteService.create({
      data: note,
      props: {
        isRoot: true,
      },
    });
  }
}
