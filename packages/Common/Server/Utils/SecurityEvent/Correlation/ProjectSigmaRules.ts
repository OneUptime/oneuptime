import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import { SigmaRuleReferenceResolver } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import {
  SigmaRuleSource,
  indexSigmaRules,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleIndex";
import DetectionRuleService from "../../../Services/DetectionRuleService";

/*
 * The project's detection rules a correlation reads by name, read from the
 * database and indexed (SigmaRuleIndex): what the engine resolves a
 * correlation's references against when its file does not hold them.
 */
export default class ProjectSigmaRules {
  public static async load(
    projectId: ObjectID,
    options: { excludeRuleId?: ObjectID | undefined } = {},
  ): Promise<SigmaRuleReferenceResolver> {
    const rules: Array<DetectionRule> = await DetectionRuleService.findAllBy({
      query: {
        projectId,
      },
      select: {
        _id: true,
        sigmaRuleYaml: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    return indexSigmaRules(
      rules.map((rule: DetectionRule): SigmaRuleSource => {
        return {
          id: rule._id?.toString(),
          sigmaRuleYaml: rule.sigmaRuleYaml,
        };
      }),
      { excludeRuleId: options.excludeRuleId?.toString() },
    );
  }
}
