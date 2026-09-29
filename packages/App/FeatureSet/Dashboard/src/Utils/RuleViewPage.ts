import RuleSettingsPageProps from "../Pages/RuleSettingsPageProps";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Routing for rule view pages. A rule's view page is the page that lists it,
 * rendered for one rule (see RuleSettingsPageProps), so these are the three
 * routes such a page needs: where its rules are viewed, where it lists them,
 * and which rule the current URL names.
 */
export default class RuleViewPageUtil {
  /*
   * The rule the current view page shows, when this page was routed as the
   * view page for rules of `modelType`. The rule id is always the last
   * segment of a rule view URL.
   */
  public static getViewRuleId(
    props: RuleSettingsPageProps,
    modelType: DatabaseBaseModelType,
  ): ObjectID | undefined {
    if (props.ruleViewModelType !== modelType) {
      return undefined;
    }

    return Navigation.getLastParamAsObjectID();
  }

  public static getListRoute(
    listPage: PageMap,
    parentModelId?: ObjectID | undefined,
  ): Route {
    return RouteUtil.populateRouteParams(RouteMap[listPage] as Route, {
      modelId: parentModelId,
    });
  }

  /*
   * A rule's view page. Rules listed under another resource (a status page's
   * monitor rules) carry that resource's id as the route's model id and the
   * rule's as its sub-model id.
   */
  public static getRuleViewRoute(
    viewPage: PageMap,
    rule: BaseModel,
    parentModelId?: ObjectID | undefined,
  ): Route {
    const ruleId: string = rule.id?.toString() || rule._id?.toString() || "";

    return RouteUtil.populateRouteParams(
      RouteMap[viewPage] as Route,
      parentModelId
        ? { modelId: parentModelId, subModelId: ruleId }
        : { modelId: ruleId },
    );
  }
}
