import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/AlertGroupingRule";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import GroupingRuleCountCheck from "../Utils/Rules/GroupingRuleCountCheck";

/*
 * The rule's Episode Owners become owners of every episode it opens, and its
 * on-call policies, labels, roles and the rest act on those episodes too -
 * all as root, in the engine. Every list it saves, and the old default
 * assignee pair, must therefore name this project's records and members:
 * ProjectReferencesService checks that where the rule is written, and the
 * engine adds only the project's own teams and members
 * (GroupingRuleEpisodeOwners).
 *
 * How many matching alerts it waits for before it opens an episode
 * (minimumAlertCount) must be a count the engine can act on: refused
 * otherwise, on every write, before anything is looked up
 * (GroupingRuleCountCheck).
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    GroupingRuleCountCheck.check({
      count: createBy.data.minimumAlertCount,
      columnTitle: "Minimum Alert Count",
    });
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    GroupingRuleCountCheck.check({
      count: (updateBy.data as unknown as Record<string, unknown>)[
        "minimumAlertCount"
      ],
      columnTitle: "Minimum Alert Count",
    });
  }
}

export default new Service();
