import ArrayUtil from "../../Utils/Array";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import IncidentTemplateOwnerTeamService from "./IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "./IncidentTemplateOwnerUserService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateService from "./IncidentStateService";
import MonitorStatusService from "./MonitorStatusService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import Typeof from "../../Types/Typeof";
import Model from "../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
  resolveReferenceId,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A template is copied onto every incident created from it, so an id
   * belonging to another project here becomes a cross-project reference on
   * each of those incidents — and the referenced project can then no longer be
   * deleted. Reject it where it enters instead.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      subject: "incident template",
      references: this.getProjectScopedReferences(createBy.data),
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const references: Array<ProjectScopedReference> =
      this.getProjectScopedReferences(updateBy.data);

    if (
      references.every((reference: ProjectScopedReference) => {
        return !reference.id;
      })
    ) {
      return { updateBy, carryForward: null };
    }

    /*
     * Root/API updates do not always carry a tenantId, so fall back to the
     * project of each template the query actually matches.
     */
    const projectIds: Array<ObjectID> = updateBy.props.tenantId
      ? [updateBy.props.tenantId]
      : await this.getProjectIdsForUpdateQuery(updateBy);

    for (const projectId of projectIds) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: projectId,
        subject: "incident template",
        references: references,
      });
    }

    return { updateBy, carryForward: null };
  }

  private getProjectScopedReferences(
    data: Model | QueryDeepPartialEntity<Model>,
  ): Array<ProjectScopedReference> {
    return [
      {
        modelName: "Incident State",
        id:
          resolveReferenceId(data.initialIncidentStateId) ||
          resolveReferenceId(data.initialIncidentState),
        service: IncidentStateService,
      },
      {
        modelName: "Incident Severity",
        id:
          resolveReferenceId(data.incidentSeverityId) ||
          resolveReferenceId(data.incidentSeverity),
        service: IncidentSeverityService,
      },
      {
        modelName: "Monitor Status",
        id:
          resolveReferenceId(data.changeMonitorStatusToId) ||
          resolveReferenceId(data.changeMonitorStatusTo),
        service: MonitorStatusService,
      },
    ];
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const templates: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    for (const template of templates) {
      if (template.projectId) {
        projectIds[template.projectId.toString()] = template.projectId;
      }
    }

    return Object.values(projectIds);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add owners.

    if (
      createdItem.projectId &&
      createdItem.id &&
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId,
        createdItem.id,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        false,
        onCreate.createBy.props,
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    incidentTemplateId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    /*
     * The same id can arrive twice in one call: criteria incident templates,
     * owner rule-engine results and workflow inputs are all user-authored
     * lists. An owner row is unique per (resource, owner, project), so the
     * repeat would be rejected on its own insert and abort the rest of the
     * call, silently dropping every owner after it. Collapse them first.
     */
    userIds = ArrayUtil.removeDuplicatesFromObjectIDArray(userIds);
    teamIds = ArrayUtil.removeDuplicatesFromObjectIDArray(teamIds);

    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: IncidentTemplateOwnerTeam =
        new IncidentTemplateOwnerTeam();
      teamOwner.incidentTemplateId = incidentTemplateId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await IncidentTemplateOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: IncidentTemplateOwnerUser =
        new IncidentTemplateOwnerUser();
      teamOwner.incidentTemplateId = incidentTemplateId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      teamOwner.isOwnerNotified = !notifyOwners;
      await IncidentTemplateOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }
}
export default new Service();
