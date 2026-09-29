import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  MAX_RULE_RUN_PASSES,
  RuleRunPassResult,
  RuleRunResult,
  RuleRunResultUtil,
  RuleRunType,
} from "../../../Types/Rules/RuleRun";
import RuleRunSummary from "../../../Utils/Rules/RuleRunSummary";
import { APP_API_URL } from "../../Config";
import API from "../API/API";

/*
 * The dashboard half of "Run now" for label, owner, privacy and status page
 * monitor rules.
 *
 * The server answers one bounded pass per request. This client chains the
 * passes, so one press of "Run Rule" covers a project of any ordinary size
 * while each request stays small - and stops, and says so, after
 * MAX_RULE_RUN_PASSES rather than looping without end.
 */

export interface RuleRunOutcome {
  isSuccess: boolean;
  /*
   * The sentence to show, success or not. A failed run is not an exception
   * here: the modal renders the same message either way, in a different slot.
   */
  message: string;
  // What the run did, including a run that failed part-way. Null when no pass completed.
  result: RuleRunResult | null;
}

export interface RunRuleData {
  ruleType: RuleRunType;
  ruleId: string;
  // Owner rules only. Only ever sent as a real boolean.
  notifyOwners?: boolean | undefined;
  // The tenantid header in here is what scopes the run to a project.
  headers?: Dictionary<string> | undefined;
  // Called after every pass that is not the last, with the totals so far.
  onProgress?: ((result: RuleRunResult) => void) | undefined;
  maxPasses?: number | undefined;
}

export default class RuleRunClient {
  public static getRunRoute(data: {
    ruleType: RuleRunType;
    ruleId: string;
  }): string {
    return `/rule-run/${data.ruleType}/${data.ruleId}/run`;
  }

  public static async run(data: RunRuleData): Promise<RuleRunOutcome> {
    /*
     * Without this the request would go to `/…//run`, which matches no route
     * and comes back as an unhelpful 404 rather than as the real problem.
     */
    if (!data.ruleId) {
      return {
        isSuccess: false,
        message: "This rule has no id, so it cannot be run.",
        result: null,
      };
    }

    const maxPasses: number = Math.max(
      data.maxPasses || MAX_RULE_RUN_PASSES,
      1,
    );
    const passes: Array<RuleRunPassResult> = [];
    let cursor: string | null = null;
    let isTruncated: boolean = false;

    const failure: (message: string) => RuleRunOutcome = (
      message: string,
    ): RuleRunOutcome => {
      if (passes.length === 0) {
        return { isSuccess: false, message: message, result: null };
      }

      /*
       * Earlier passes really did change resources. Saying only "failed" would
       * hide that, and invite a re-run that looks like it did nothing.
       */
      const partial: RuleRunResult = RuleRunResultUtil.mergePasses({
        passes: passes,
        isTruncated: false,
      });

      return {
        isSuccess: false,
        message: `${message} The run stopped part-way. Before it stopped: ${RuleRunSummary.describe(
          { ruleType: data.ruleType, result: partial },
        )}`,
        result: partial,
      };
    };

    try {
      for (;;) {
        const body: JSONObject = {
          notifyOwners: Boolean(data.notifyOwners),
        };

        if (cursor) {
          body["cursor"] = cursor;
        }

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              RuleRunClient.getRunRoute({
                ruleType: data.ruleType,
                ruleId: data.ruleId,
              }),
            ),
            data: body,
            ...(data.headers ? { headers: data.headers } : {}),
          });

        if (response.isFailure()) {
          return failure(API.getFriendlyMessage(response));
        }

        const pass: RuleRunPassResult = RuleRunResultUtil.parsePassResult(
          (response.data || {}) as JSONObject,
        );

        passes.push(pass);

        if (!pass.nextCursor) {
          break;
        }

        /*
         * A cursor that does not move would repeat the same pass forever.
         * Stop and report it as unfinished rather than trust it.
         */
        if (pass.nextCursor === cursor || passes.length >= maxPasses) {
          isTruncated = true;
          break;
        }

        cursor = pass.nextCursor;

        if (data.onProgress) {
          data.onProgress(
            RuleRunResultUtil.mergePasses({
              passes: passes,
              isTruncated: false,
            }),
          );
        }
      }
    } catch (err) {
      return failure(API.getFriendlyMessage(err));
    }

    const result: RuleRunResult = RuleRunResultUtil.mergePasses({
      passes: passes,
      isTruncated: isTruncated,
    });

    return {
      isSuccess: true,
      message: RuleRunSummary.describe({
        ruleType: data.ruleType,
        result: result,
      }),
      result: result,
    };
  }
}
