import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/IncidentGroupingRule";
import { IsBillingEnabled } from "../EnvironmentConfig";

/*
 * The rule's Episode Owners become owners of every episode it opens, and its
 * on-call policies, labels, roles and the rest act on those episodes too -
 * all as root, in the engine. Every list it saves, and the old default
 * assignee pair, must therefore name this project's records and members:
 * ProjectReferencesService checks that where the rule is written, and the
 * engine adds only the project's own teams and members
 * (GroupingRuleEpisodeOwners).
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }
}

export default new Service();
