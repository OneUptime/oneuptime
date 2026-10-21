import ProjectReferencesService from "./ProjectReferencesService";
import Model, {
  EpisodeMemberRoleAssignment,
} from "../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import User from "../../Models/DatabaseModels/User";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { JsonReferenceColumn } from "../Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
  resolveReferenceId,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import DatabaseService from "./DatabaseService";

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
 * incidentRoleId } pairs, which no column metadata describes, so the rule
 * names them as a JSON reference column: each user must be a member of the
 * project and each role one of its incident roles, checked with everything
 * else in one answer. An update checks only the ids every matched rule does
 * not already hold.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  protected override getJsonReferenceColumns(): Array<JsonReferenceColumn> {
    return [
      {
        column: "episodeMemberRoleAssignments",
        getReferences: Service.getRoleAssignmentReferences,
      },
    ];
  }

  // One reference per user and per role the assignments name.
  public static getRoleAssignmentReferences(
    value: unknown,
  ): Array<ProjectScopedReference> {
    const assignments: Array<unknown> = Array.isArray(value) ? value : [];
    const references: Array<ProjectScopedReference> = [];

    for (const entry of assignments) {
      const assignment: Partial<EpisodeMemberRoleAssignment> = (entry ||
        {}) as Partial<EpisodeMemberRoleAssignment>;

      const userId: string =
        resolveReferenceId(assignment.userId)?.toString().trim() || "";
      const roleId: string =
        resolveReferenceId(assignment.incidentRoleId)?.toString().trim() || "";

      if (userId) {
        references.push({
          modelName: "Episode Member Role Assignments (user)",
          id: userId,
          service: ProjectScopedReferenceValidator.getLookupService(
            User,
          ) as unknown as DatabaseService<DatabaseBaseModel>,
        });
      }

      if (roleId) {
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
}

export default new Service();
