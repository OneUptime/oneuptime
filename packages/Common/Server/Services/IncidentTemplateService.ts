import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import IncidentTemplateOwnerTeamService from "./IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "./IncidentTemplateOwnerUserService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateService from "./IncidentStateService";
import LabelService from "./LabelService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/IncidentTemplate";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectScopedReferenceValidator, {
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedRelation,
  resolveReferenceId,
  resolveReferenceIds,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import { getAffectedResourceRelations } from "../Utils/Database/AffectedResourceRelations";
import Query from "../Types/Database/Query";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";
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
   *
   * The same goes for the monitors, labels, on-call policies and
   * affected-resource lists. IncidentService checks the lists it copies from
   * the template, so a foreign id saved here made every incident created from
   * this template fail.
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
      references: [
        ...this.getProjectScopedReferences(createBy.data),
        ...ProjectScopedReferenceValidator.getRelationReferences({
          payload: createBy.data,
          relations: this.getProjectScopedRelations(),
        }),
      ],
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const references: Array<ProjectScopedReference> =
      this.getProjectScopedReferences(updateBy.data);

    // An empty list only removes rows and needs no check.
    const relations: Array<ProjectScopedRelation> =
      this.getProjectScopedRelations().filter(
        (relation: ProjectScopedRelation) => {
          return (
            resolveReferenceIds(
              (updateBy.data as Dictionary<unknown>)[relation.column],
            ).length > 0
          );
        },
      );

    if (
      references.every((reference: ProjectScopedReference) => {
        return !reference.id;
      }) &&
      relations.length === 0
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

    // See ProjectScopedReferenceValidator.getRelationReferences.
    const heldIds: HeldRelationIds | undefined =
      relations.length > 0
        ? await ProjectScopedReferenceValidator.getHeldRelationIds({
            service: this as unknown as DatabaseService<DatabaseBaseModel>,
            query: updateBy.query as Query<DatabaseBaseModel>,
            columns: relations.map((relation: ProjectScopedRelation) => {
              return relation.column;
            }),
          })
        : undefined;

    for (const projectId of projectIds) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: projectId,
        subject: "incident template",
        references: [
          ...references,
          ...ProjectScopedReferenceValidator.getRelationReferences({
            payload: updateBy.data,
            relations: relations,
            projectId: projectId,
            heldIds: heldIds,
          }),
        ],
      });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * The many-to-many lists whose ids must belong to the template's project.
   * Built per call rather than at module load: these services sit in an
   * import graph that loops back to this one, and a module-level table would
   * capture whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<ProjectScopedRelation> {
    return [
      {
        column: "monitors",
        modelName: "Monitor",
        service: MonitorService,
      },
      {
        column: "labels",
        modelName: "Label",
        service: LabelService,
      },
      {
        column: "onCallDutyPolicies",
        modelName: "On-Call Policy",
        service: OnCallDutyPolicyService,
      },
      ...getAffectedResourceRelations(this.getModel()),
    ];
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
    // Owners already on the template are skipped, not added a second time.
    await OwnerRuleAssignment.addOwners({
      ownerUserService: IncidentTemplateOwnerUserService,
      ownerTeamService: IncidentTemplateOwnerTeamService,
      resourceIdColumn: "incidentTemplateId",
      resourceId: incidentTemplateId,
      projectId: projectId,
      userIds: userIds,
      teamIds: teamIds,
      isOwnerNotified: !notifyOwners,
      props: props,
    });
  }
}
export default new Service();
