import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ObjectID from "../../../Types/ObjectID";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Logger";

/*
 * The on-call rule engines merge the policies of every matching rule into an
 * incident's, alert's or episode's own list, and the on-call fan-out then
 * pages each of them - as root, past the checks the record's own service
 * makes when a person picks policies. A rule's policies are checked when the
 * rule is saved (ProjectReferencesService), but a rule saved before that
 * check existed can still name another project's policy, whose responders
 * must not be paged about this project's incident. So the engines keep only
 * the project's own policies: one read, pinned to the project.
 */
export default class OnCallRulePolicyScope {
  /*
   * Removes from `matchedPolicies` (policy id -> policy) every policy that
   * is not one of the project's, and logs their ids.
   */
  public static async keepPoliciesInProject(data: {
    projectId: ObjectID;
    matchedPolicies: Map<string, OnCallDutyPolicy>;
    // For the log: "Incident on-call".
    ruleKind: string;
    logAttributes: LogAttributes;
  }): Promise<void> {
    const policyIds: Array<string> = Array.from(data.matchedPolicies.keys());

    if (policyIds.length === 0) {
      return;
    }

    const kept: Set<string> = new Set<string>(
      await ProjectScopedReferenceValidator.keepIdsInProject({
        modelType: OnCallDutyPolicy,
        projectId: data.projectId,
        ids: policyIds,
      }),
    );

    const dropped: Array<string> = policyIds.filter((id: string): boolean => {
      return !kept.has(id);
    });

    for (const id of dropped) {
      data.matchedPolicies.delete(id);
    }

    if (dropped.length > 0) {
      logger.warn(
        `${data.ruleKind} rules name on-call policies that are not in this project; they were not paged: ${dropped
          .map((id: string): string => {
            return `"${id}"`;
          })
          .join(", ")}`,
        data.logAttributes,
      );
    }
  }
}
