import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
  getCodeRepositoryAllowance,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../Types/ObjectID";
import AutoRemediationRuleService from "../../../Services/AutoRemediationRuleService";
import logger from "../../Logger";

/*
 * THE CODE REPOSITORIES A FIX RUN MAY READ: the ones its auto remediation
 * rule names (AutoRemediationRule.codeRepositories), or every connected
 * repository when the rule names none - "The remediation should also take
 * into the context of code repos if any", the maintainer. A run no rule
 * started - a cluster's or host's own round, the project's own pick with no
 * rule set up - reads every connected repository, as a run did before rules
 * named repositories.
 *
 * Fails closed: a rule that cannot be read - deleted since, or a failed
 * read - leaves the run reading no repository, while every other tool still
 * works.
 */
export default class RemediationCodeRepositories {
  public static async forRule(data: {
    projectId: ObjectID;
    autoRemediationRuleId?: ObjectID | null | undefined;
  }): Promise<CodeRepositoryAllowance> {
    if (!data.autoRemediationRuleId) {
      return EVERY_CODE_REPOSITORY;
    }

    try {
      const rule: AutoRemediationRule | null =
        await AutoRemediationRuleService.findOneBy({
          query: {
            _id: data.autoRemediationRuleId,
            projectId: data.projectId,
          },
          select: {
            _id: true,
            codeRepositories: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!rule) {
        return NO_CODE_REPOSITORY;
      }

      return getCodeRepositoryAllowance({
        rulesSetUp: true,
        matchingRules: [rule],
      });
    } catch (error) {
      logger.error(
        `AI: could not read which code repositories AI rule ${data.autoRemediationRuleId.toString()} allows; fixing without code: ${error}`,
      );
      return NO_CODE_REPOSITORY;
    }
  }
}
