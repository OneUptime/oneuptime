import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  AutoImportRuleRunResult,
  RuleRunResultUtil,
} from "Common/Types/NetworkAutomation/RuleRunResult";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";

export interface ComponentProps {
  ruleId: string;
  // Shown in the modal title when the rule has a name.
  ruleName?: string | undefined;
  /*
   * A dry run evaluates everything and writes nothing — it answers "what
   * would this rule import" before the rule is trusted against live scans.
   */
  isDryRun: boolean;
  onClose: () => void;
}

function hosts(count: number): string {
  return `${count} ${count === 1 ? "host" : "hosts"}`;
}

/*
 * The sentences the report shows, in the style of RuleRunSummary: a run
 * that imported nothing is the common case once a rule has been run, and
 * "0 imported" with no reason reads as a broken button. Every bucket the
 * server counted is reported only when it happened.
 */
function describeAutoImportRun(result: AutoImportRuleRunResult): string {
  const lines: Array<string> = [];

  if (result.isDryRun) {
    /*
     * A dry run creates nothing, so devicesCreated is always zero. What a
     * real run would attempt is matched minus already-registered — the
     * server reports it exactly this way (see the engine's dry-run branch).
     */
    const wouldImport: number = Math.max(
      result.hostsMatched - result.hostsSkippedAlreadyRegistered,
      0,
    );

    if (wouldImport > 0) {
      lines.push(
        `This rule would import ${hosts(
          wouldImport,
        )} as network devices. Nothing was written — this was a dry run.`,
      );
    } else {
      lines.push(
        `This rule would import nothing. It matched ${hosts(
          result.hostsMatched,
        )} out of the ${hosts(
          result.hostsEvaluated,
        )} discovered hosts it looked at.`,
      );
    }
  } else if (result.devicesCreated > 0) {
    lines.push(`Imported ${hosts(result.devicesCreated)} as network devices.`);
  } else {
    lines.push(
      `No devices were imported. This rule matched ${hosts(
        result.hostsMatched,
      )} out of the ${hosts(
        result.hostsEvaluated,
      )} discovered hosts it looked at.`,
    );
  }

  if (result.hostsExcluded > 0) {
    lines.push(`An exclusion rule vetoed ${hosts(result.hostsExcluded)}.`);
  }

  if (result.hostsSkippedAlreadyRegistered > 0) {
    lines.push(
      `${hosts(
        result.hostsSkippedAlreadyRegistered,
      )} skipped because a device with that address already exists.`,
    );
  }

  if (result.devicesFailed > 0) {
    lines.push(
      `${hosts(
        result.devicesFailed,
      )} could not be imported. Check the server logs for the reason.`,
    );
  }

  if (result.isTruncated) {
    lines.push(
      "Stopped at the run cap — run again to continue; already-imported hosts are skipped.",
    );
  }

  return lines.join(" ");
}

/*
 * "Run now" / "Dry run" for a Network Device Auto Import Rule — the same
 * confirm-then-report shape as RunRuleNowModal, but a sibling rather than a
 * new kind on it: the auto-import endpoint answers with counters and a host
 * sample instead of a one-sentence summary, and it takes a dryRun flag the
 * shared client has no slot for.
 */
const RunAutoImportRuleModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<AutoImportRuleRunResult | null>(null);

  const runRule: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsRunning(true);
    setError("");

    /*
     * Without this the request would go to `/…//run`, which matches no
     * route and comes back as an unhelpful 404 rather than as the real
     * problem.
     */
    if (!props.ruleId) {
      setError("This rule has no id, so it cannot be run.");
      setIsRunning(false);
      return;
    }

    try {
      /*
       * The tenantid header the common headers carry is what scopes the run
       * to the current project — the endpoint refuses a request without it
       * rather than guessing.
       */
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/network-device-auto-import-rule/${props.ruleId}/run`,
          ),
          data: { dryRun: props.isDryRun },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response.isFailure()) {
        setError(API.getFriendlyMessage(response));
      } else {
        setResult(
          RuleRunResultUtil.parseAutoImportRuleRunResult(
            (response.data || {}) as JSONObject,
          ),
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsRunning(false);
  }, [props.ruleId, props.isDryRun]);

  const title: string = props.isDryRun
    ? props.ruleName
      ? `Dry Run "${props.ruleName}"`
      : "Dry Run This Rule"
    : props.ruleName
      ? `Run "${props.ruleName}" Now`
      : "Run This Rule Now";

  /*
   * Once the run has answered, the modal stops being a confirmation and
   * becomes the report: one button, and it closes.
   */
  if (result) {
    return (
      <ConfirmModal
        title={title}
        description={
          <div>
            <div>{describeAutoImportRun(result)}</div>
            {result.matchedIpAddressSample.length > 0 ? (
              <div className="mt-4">
                <div className="font-medium text-gray-900">
                  Sample of matching hosts
                </div>
                <div className="mt-1 max-h-32 overflow-y-auto rounded-md bg-gray-50 p-2 font-mono text-xs text-gray-700">
                  {result.matchedIpAddressSample.join(", ")}
                </div>
              </div>
            ) : (
              <></>
            )}
          </div>
        }
        submitButtonText="Close"
        onSubmit={props.onClose}
      />
    );
  }

  const description: string = props.isDryRun
    ? 'Evaluate this rule against every completed discovery scan in the project and report what it would import. Nothing is written — no devices are created — so this is the safe way to answer "what would this rule import" before trusting it against live scans.\n\nHosts that already have a registered device are skipped, and exclusion rules still veto.'
    : "Evaluate this rule against every completed discovery scan in the project and import every host it matches as a network device. This creates devices from ALL completed scans in the project, not just the most recent one — a broad rule can import a lot at once, so consider a Dry Run first.\n\nHosts that already have a registered device are skipped and exclusion rules still veto, so running this more than once is safe. Site assignment, owner, and label rules apply to the imported devices automatically.";

  return (
    <ConfirmModal
      title={title}
      description={description}
      error={error || undefined}
      isLoading={isRunning}
      submitButtonText={props.isDryRun ? "Start Dry Run" : "Run Rule"}
      onSubmit={runRule}
      onClose={props.onClose}
    />
  );
};

export default RunAutoImportRuleModal;
