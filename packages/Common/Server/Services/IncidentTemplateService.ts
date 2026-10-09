import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService from "./ProjectReferencesService";
import IncidentTemplateOwnerTeamService from "./IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "./IncidentTemplateOwnerUserService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateService from "./IncidentStateService";
import LabelService from "./LabelService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import StatusPageService from "./StatusPageService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { validateCustomFieldCreateSettings } from "../../Types/CustomField/CustomFieldCreateSettings";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import ProjectScopedReferenceValidator, {
  getWrittenRelationReferences,
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedRelation,
  resolveReferenceIds,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import {
  getAffectedResourceColumns,
  getAffectedResourceRelations,
} from "../Utils/Database/AffectedResourceRelations";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OwnerRuleAssignment from "../Utils/Rules/OwnerRuleAssignment";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import StatusPageReadAccess from "../Utils/StatusPage/StatusPageReadAccess";
import IncidentScopeAddedPagesNotification from "../../Types/StatusPage/IncidentScopeAddedPagesNotification";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The initial state, the severity, the monitor status to switch to and
   * every list a template carries are checked by this service's own hooks
   * below, with ProjectScopedReferenceValidator and its own words.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return [
      "initialIncidentState",
      "incidentSeverity",
      "changeMonitorStatusTo",
    ];
  }

  protected override getListsCheckedByService(): Array<string> {
    return [
      "monitors",
      "labels",
      "onCallDutyPolicies",
      "statusPages",
      ...getAffectedResourceColumns(this.getModel()),
    ];
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
    await super.onBeforeCreate(createBy);

    // The owners picked in the form are asked about now, before anything is saved.
    await OwnerRuleAssignment.checkOwnersPickedOnCreate({
      ownerUserService: IncidentTemplateOwnerUserService,
      ownerTeamService: IncidentTemplateOwnerTeamService,
      resourceIdColumn: "incidentTemplateId",
      resourceModelType: Model,
      resource: createBy.data,
      miscDataProps: createBy.miscDataProps,
      props: createBy.props,
    });

    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    this.assertValidCustomFieldSettings(createBy.data.customFieldSettings);

    // Derived from the list, whatever the caller sent (see the column).
    createBy.data.isScopedToStatusPages =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        createBy.data.statusPages,
      ).length > 0;

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

    /*
     * A template's status pages are picked for everyone who declares from
     * it, so picking them needs the same read access as picking an
     * incident's (see StatusPageReadAccess).
     */
    await StatusPageReadAccess.assertCallerCanPickStatusPages({
      statusPageIds: IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        createBy.data.statusPages,
      ),
      props: createBy.props,
      subject: "incident template",
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * The scope flag follows a write to the list and nothing else: a client
     * value is dropped, and deleting the template's pages (join rows
     * cascading away) never clears it.
     */
    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    delete data["isScopedToStatusPages"];

    if (data["statusPages"] !== undefined) {
      data["isScopedToStatusPages"] =
        IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
          data["statusPages"],
        ).length > 0;
    }

    this.assertValidCustomFieldSettings(data["customFieldSettings"]);

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
      : await this.findProjectsOfRowsAndHoldUpdateToThem(updateBy);

    // See ProjectScopedReferenceValidator.getRelationReferences.
    const heldIds: HeldRelationIds | undefined =
      relations.length > 0
        ? await ProjectScopedReferenceValidator.getHeldRelationIds({
            service: this,
            updateBy: updateBy,
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

    // Once the pages are known to be the project's.
    await this.assertCallerCanReadAddedStatusPages(updateBy);

    return { updateBy, carryForward: null };
  }

  /*
   * customFieldSettings is only read by the dashboard's Declare Incident
   * form, and leniently, so a malformed value would not break anything - it
   * would silently do nothing, which is worse for whoever wrote it. It is
   * refused where it comes in instead, root writes included (a workflow can
   * send it too). A valid value is stored exactly as sent: see
   * validateCustomFieldCreateSettings for why nothing is rewritten.
   */
  private assertValidCustomFieldSettings(value: unknown): void {
    const problem: string | null = validateCustomFieldCreateSettings(value);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * The status pages an update adds to a template must be pages the caller
   * can read (see StatusPageReadAccess). Pages the template already holds are
   * not checked, so saving a template limited to a page the editor cannot
   * see does not fail. The templates are read as root, limited to the
   * caller's project: the update's own tenant filter is only added after
   * this hook.
   */
  private async assertCallerCanReadAddedStatusPages(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const requested: unknown = (updateBy.data as Dictionary<unknown>)[
      "statusPages"
    ];

    if (updateBy.props.isRoot || requested === undefined) {
      return;
    }

    const requestedIds: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(requested);

    if (requestedIds.length === 0) {
      return;
    }

    const templates: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        statusPages: {
          _id: true,
        },
      },
    );

    const addedIds: Array<string> = [];

    for (const template of templates) {
      for (const id of IncidentScopeAddedPagesNotification.getScopeChange({
        before: template.statusPages,
        after: requestedIds,
      }).addedStatusPageIds) {
        if (!addedIds.includes(id)) {
          addedIds.push(id);
        }
      }
    }

    await StatusPageReadAccess.assertCallerCanPickStatusPages({
      statusPageIds: addedIds,
      props: updateBy.props,
      subject: "incident template",
    });
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
      {
        column: "statusPages",
        modelName: "Status Page",
        service: StatusPageService,
      },
      ...getAffectedResourceRelations(this.getModel()),
    ];
  }

  /*
   * Each relation by both of its names: the API takes the ID column and the
   * relation alike, and the template's cards write the relation. A write
   * may carry both; each is checked, and the two must agree.
   */
  private getProjectScopedReferences(
    data: Model | QueryDeepPartialEntity<Model>,
  ): Array<ProjectScopedReference> {
    return [
      ...getWrittenRelationReferences({
        payload: data,
        idColumn: "initialIncidentStateId",
        relation: "initialIncidentState",
        modelName: "Incident State",
        service: IncidentStateService,
      }),
      ...getWrittenRelationReferences({
        payload: data,
        idColumn: "incidentSeverityId",
        relation: "incidentSeverity",
        modelName: "Incident Severity",
        service: IncidentSeverityService,
      }),
      ...getWrittenRelationReferences({
        payload: data,
        idColumn: "changeMonitorStatusToId",
        relation: "changeMonitorStatusTo",
        modelName: "Monitor Status",
        service: MonitorStatusService,
      }),
    ];
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
        true,
      );
    }

    return createdItem;
  }

  /*
   * The owners of a template - its owner users and teams - read as `props`:
   * the people and teams who own the incidents declared from it. An
   * incident form reads them as OneUptime itself (IncidentFormTarget); a
   * workflow's Create One Incident step as the step, so a step reads only
   * what a Project Admin of its project may (IncidentService
   * .createFromTemplate).
   */
  @CaptureSpan()
  public async getOwnerIds(data: {
    incidentTemplateId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ userIds: Array<ObjectID>; teamIds: Array<ObjectID> }> {
    const query: { incidentTemplateId: ObjectID; projectId: ObjectID } = {
      incidentTemplateId: data.incidentTemplateId,
      projectId: data.projectId,
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
        props: data.props,
      }),
      IncidentTemplateOwnerTeamService.findBy({
        query: query,
        select: { teamId: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      }),
    ]);

    return {
      userIds: ownerUsers
        .map((owner: IncidentTemplateOwnerUser): ObjectID | undefined => {
          return owner.userId;
        })
        .filter((userId: ObjectID | undefined): userId is ObjectID => {
          return Boolean(userId);
        }),
      teamIds: ownerTeams
        .map((owner: IncidentTemplateOwnerTeam): ObjectID | undefined => {
          return owner.teamId;
        })
        .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
          return Boolean(teamId);
        }),
    };
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    incidentTemplateId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
    /*
     * True for the owners picked in the form that created the resource:
     * written for its creator when their own permissions do not reach the
     * new resource (OwnerRuleAssignment.createOwner).
     */
    onCreatorsBehalf: boolean = false,
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
      onCreatorsBehalf: onCreatorsBehalf,
    });
  }
}
export default new Service();
