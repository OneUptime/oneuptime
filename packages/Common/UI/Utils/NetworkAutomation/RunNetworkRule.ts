import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { RuleRunResultUtil } from "../../../Types/NetworkAutomation/RuleRunResult";
import RuleRunSummary from "../../../Utils/NetworkAutomation/RuleRunSummary";
import { APP_API_URL } from "../../Config";
import API from "../API/API";

/*
 * Client for the two Network Automation "Run now" endpoints.
 *
 * Both rule kinds fire automatically only when a device is created (and, for
 * site assignment, when its identity changes or on the next poll of a device
 * with no site), so a rule written after an estate was imported never reaches
 * it. These endpoints apply one rule to the devices that already exist —
 * OneUptime/oneuptime#3191.
 *
 * The two differ only in the route they post to and in whether the run can
 * overwrite something a person chose, so they share one client rather than
 * two that drift.
 */

export enum NetworkRuleKind {
  SiteAssignment = "SiteAssignment",
  DeviceLabel = "DeviceLabel",
}

const RULE_RUN_ROUTE: Record<NetworkRuleKind, string> = {
  [NetworkRuleKind.SiteAssignment]: "/network-site-assignment-rule",
  [NetworkRuleKind.DeviceLabel]: "/network-device-label-rule",
};

/*
 * What the caller shows. A failed run is not an exception here: the modal
 * renders the same sentence either way, only in the error slot.
 */
export interface NetworkRuleRunOutcome {
  isSuccess: boolean;
  message: string;
}

export default class RunNetworkRule {
  public static getRunRoute(data: {
    ruleKind: NetworkRuleKind;
    ruleId: string;
  }): string {
    return `${RULE_RUN_ROUTE[data.ruleKind]}/${data.ruleId}/run`;
  }

  public static async run(data: {
    ruleKind: NetworkRuleKind;
    ruleId: string;
    /*
     * Site assignment only, and only ever sent as a real boolean — the
     * endpoint accepts nothing else, so a run cannot move devices somebody
     * placed by hand through a stray truthy value.
     */
    reassignDevicesAlreadyInASite?: boolean | undefined;
    headers?: Dictionary<string> | undefined;
  }): Promise<NetworkRuleRunOutcome> {
    /*
     * Without this the request would go to `/…//run`, which matches no route
     * and comes back as an unhelpful 404 rather than as the real problem.
     */
    if (!data.ruleId) {
      return {
        isSuccess: false,
        message: "This rule has no id, so it cannot be run.",
      };
    }

    const isSiteAssignment: boolean =
      data.ruleKind === NetworkRuleKind.SiteAssignment;

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            RunNetworkRule.getRunRoute({
              ruleKind: data.ruleKind,
              ruleId: data.ruleId,
            }),
          ),
          data: isSiteAssignment
            ? {
                reassignDevicesAlreadyInASite: Boolean(
                  data.reassignDevicesAlreadyInASite,
                ),
              }
            : {},
          ...(data.headers ? { headers: data.headers } : {}),
        });

      if (response.isFailure()) {
        return {
          isSuccess: false,
          message: API.getFriendlyMessage(response),
        };
      }

      const body: JSONObject = (response.data || {}) as JSONObject;

      return {
        isSuccess: true,
        message: isSiteAssignment
          ? RuleRunSummary.describeSiteAssignmentRun(
              RuleRunResultUtil.parseSiteAssignmentRuleRunResult(body),
            )
          : RuleRunSummary.describeLabelRun(
              RuleRunResultUtil.parseLabelRuleRunResult(body),
            ),
      };
    } catch (err) {
      return {
        isSuccess: false,
        message: API.getFriendlyMessage(err),
      };
    }
  }
}
