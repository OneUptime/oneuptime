import ProjectReferencesService from "./ProjectReferencesService";
import Model, {
  EpisodeMemberRoleAssignment,
} from "../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import User from "../../Models/DatabaseModels/User";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
  ProjectScopedReferenceException,
  resolveReferenceId,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

const SUBJECT: string = "incident grouping rule";
const ROLE_ASSIGNMENTS_COLUMN: string = "episodeMemberRoleAssignments";

// Postgres renders a uuid lower-cased, whatever case the payload used.
type NormalizeIdFunction = (id: string) => string;

const normalizeId: NormalizeIdFunction = (id: string): string => {
  return id.trim().toLowerCase();
};

/*
 * The rule's Episode Owners become owners of every episode it opens, and its
 * on-call policies, labels, roles and the rest act on those episodes too -
 * all as root, in the engine. Every list it saves, and the old default
 * assignee pair, must therefore name this project's records and members:
 * ProjectReferencesService checks that where the rule is written, and the
 * engine adds only the project's own teams and members
 * (GroupingRuleEpisodeOwners).
 *
 * Its Episode Member Role Assignments are a JSON list of { userId,
 * incidentRoleId } pairs, which no column metadata describes, so they are
 * checked here the same way: each user must be a member of the project and
 * each role one of its incident roles. An update checks only the pairs'
 * ids that every matched rule does not already hold.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeCreate(createBy);

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      references: Service.getRoleAssignmentReferences(
        createBy.data.episodeMemberRoleAssignments,
      ),
      subject: SUBJECT,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // The project's own records only, before anything here reads one.
    await super.onBeforeUpdate(updateBy);

    await this.validateRoleAssignmentsOnUpdate(updateBy);

    return { updateBy, carryForward: null };
  }

  /*
   * One reference per user and per role the assignments name. `held`
   * (normalized ids) leaves out the ids the rule already holds.
   */
  public static getRoleAssignmentReferences(
    value: unknown,
    held?: Set<string> | undefined,
  ): Array<ProjectScopedReference> {
    const assignments: Array<unknown> = Array.isArray(value) ? value : [];
    const references: Array<ProjectScopedReference> = [];

    for (const entry of assignments) {
      const assignment: Partial<EpisodeMemberRoleAssignment> =
        (entry || {}) as Partial<EpisodeMemberRoleAssignment>;

      const userId: string =
        resolveReferenceId(assignment.userId)?.toString().trim() || "";
      const roleId: string =
        resolveReferenceId(assignment.incidentRoleId)?.toString().trim() || "";

      if (userId && !held?.has(normalizeId(userId))) {
        references.push({
          modelName: "Episode Member Role Assignments (user)",
          id: userId,
          service: ProjectScopedReferenceValidator.getLookupService(
            User,
          ) as unknown as DatabaseService<DatabaseBaseModel>,
        });
      }

      if (roleId && !held?.has(normalizeId(roleId))) {
        references.push({
          modelName: "Episode Member Role Assignments (role)",
          id: roleId,
          service: ProjectScopedReferenceValidator.getLookupService(
            IncidentRole,
          ) as unknown as DatabaseService<DatabaseBaseModel>,
        });
      }
    }

    return references;
  }

  /*
   * The pairs an update writes, checked like every other reference of the
   * rule (see ProjectReferenceCheck.validateUpdate): with a tenant, the ids
   * that are not the project's are looked for among what the matched rules
   * already hold; with none, each matched rule's own project is used.
   */
  private async validateRoleAssignmentsOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const written: unknown = (updateBy.data as Dictionary<unknown>)[
      ROLE_ASSIGNMENTS_COLUMN
    ];

    const references: Array<ProjectScopedReference> =
      Service.getRoleAssignmentReferences(written);

    if (references.length === 0) {
      return;
    }

    const tenantId: ObjectID | undefined = updateBy.props.tenantId;

    if (tenantId) {
      const unavailable: Array<ProjectScopedReference> =
        await ProjectScopedReferenceValidator.getUnavailableReferences({
          projectId: tenantId,
          references: references,
          subject: SUBJECT,
        });

      if (unavailable.length === 0) {
        return;
      }

      const held: Set<string> =
        (await this.getHeldRoleAssignmentIds(updateBy.query, tenantId)).get(
          normalizeId(tenantId.toString()),
        ) || new Set<string>();

      const refused: Array<ProjectScopedReference> = unavailable.filter(
        (reference: ProjectScopedReference): boolean => {
          return !held.has(normalizeId(reference.id?.toString() || ""));
        },
      );

      if (refused.length > 0) {
        throw new ProjectScopedReferenceException(
          ProjectScopedReferenceValidator.getRefusalMessage({
            subject: SUBJECT,
            described:
              ProjectScopedReferenceValidator.describeReferences(refused),
          }),
        );
      }

      return;
    }

    for (const [projectId, held] of await this.getHeldRoleAssignmentIds(
      updateBy.query,
      undefined,
    )) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: new ObjectID(projectId),
        references: Service.getRoleAssignmentReferences(written, held),
        subject: SUBJECT,
      });
    }
  }

  /*
   * Per project (normalized id), the user and role ids every matched rule of
   * that project already holds in its assignments. Read as root - hooks run
   * before the tenant narrows the query - and pinned to the tenant when there
   * is one.
   */
  private async getHeldRoleAssignmentIds(
    query: Query<Model>,
    tenantId: ObjectID | undefined,
  ): Promise<Map<string, Set<string>>> {
    const rules: Array<Model> = await this.findBy({
      query: tenantId ? { ...query, projectId: tenantId } : query,
      select: {
        _id: true,
        projectId: true,
        episodeMemberRoleAssignments: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const heldByProject: Map<string, Set<string>> = new Map();

    for (const rule of rules) {
      const projectId: string = normalizeId(rule.projectId?.toString() || "");

      if (!projectId) {
        continue;
      }

      const heldByRule: Set<string> = new Set<string>(
        Service.getRoleAssignmentReferences(
          rule.episodeMemberRoleAssignments,
        ).map((reference: ProjectScopedReference): string => {
          return normalizeId(reference.id?.toString() || "");
        }),
      );

      const heldSoFar: Set<string> | undefined = heldByProject.get(projectId);

      heldByProject.set(
        projectId,
        heldSoFar
          ? new Set<string>(
              Array.from(heldSoFar).filter((id: string): boolean => {
                return heldByRule.has(id);
              }),
            )
          : heldByRule,
      );
    }

    return heldByProject;
  }
}

export default new Service();
