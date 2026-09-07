import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  AutoImportRuleRunResult,
  RuleRunResultUtil,
} from "Common/Types/NetworkAutomation/RuleRunResult";
import AutoImportRunChain, {
  AutoImportRunChainOutcome,
} from "Common/Utils/NetworkAutomation/AutoImportRunChain";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
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
  /*
   * What the chained passes have created so far, for the "still working"
   * body. Purely cosmetic — the report below is built from the passes
   * themselves — but a Run Now over a large estate is now several requests
   * long, and a spinner that never says anything for two minutes reads as a
   * hang.
   */
  const [progress, setProgress] = useState<string>("");

  /*
   * Set when the modal unmounts, so a chain in flight stops at its next pass
   * boundary instead of firing more imports (and calling setState) after the
   * operator closed the dialog. Closing stays available throughout: the modal
   * footer only spins its submit button while loading, it does not take the
   * close button away.
   */
  const isCancelledRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    /*
     * Cleared on mount as well as set on unmount. StrictMode mounts, tears
     * down and remounts in development, so a flag that is only ever set would
     * come back latched and every run would cancel before its first pass.
     */
    isCancelledRef.current = false;

    return () => {
      isCancelledRef.current = true;
    };
  }, []);

  const runRule: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsRunning(true);
    setError("");
    setProgress("");

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

    /*
     * One press, as many capped server passes as the estate needs.
     *
     * Each request stays exactly as small as it always was; the chain is
     * what turns "imported 500 of 909 and stopped" (OneUptime issue #3642)
     * into a button that finishes the job. The loop itself lives in
     * AutoImportRunChain so its exits are unit-tested without a renderer.
     */
    let outcome: AutoImportRunChainOutcome | null = null;

    try {
      outcome = await AutoImportRunChain.run({
        isDryRun: props.isDryRun,
        isCancelled: (): boolean => {
          return isCancelledRef.current;
        },
        onProgress: (progressSoFar: AutoImportRuleRunResult): void => {
          setProgress(
            RuleRunResultUtil.describeAutoImportProgress(progressSoFar),
          );
        },
        runPass: async (): Promise<AutoImportRuleRunResult | null> => {
          /*
           * The tenantid header the common headers carry is what scopes the
           * run to the current project — the endpoint refuses a request
           * without it rather than guessing.
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
            /*
             * Reported here, where the response is — and answered as null so
             * the chain keeps what earlier passes already imported instead
             * of throwing a summary of real work away.
             */
            setError(API.getFriendlyMessage(response));
            return null;
          }

          return RuleRunResultUtil.parseAutoImportRuleRunResult(
            (response.data || {}) as JSONObject,
          );
        },
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    if (isCancelledRef.current) {
      return;
    }

    if (outcome?.result) {
      setResult(outcome.result);
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
            <div>{RuleRunResultUtil.describeAutoImportRun(result)}</div>
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
        /*
         * A chain that failed part-way still has a report worth reading, so
         * the error rides along with it instead of replacing it.
         */
        error={error || undefined}
        submitButtonText="Close"
        onSubmit={props.onClose}
      />
    );
  }

  const description: string = props.isDryRun
    ? 'Evaluate this rule against every completed discovery scan in the project and report what it would import. Nothing is written — no devices or active monitors are created — so this is the safe way to answer "what would this rule import" before trusting it against live scans.\n\nIf the rule has a Monitor Template selected, the preview also reports how many eligible devices would receive an active Network Device monitor. Existing monitors are never duplicated, and exclusion rules still veto.'
    : "Evaluate this rule against every completed discovery scan in the project and import every host it matches as a network device. This creates devices from ALL completed scans in the project, not just the most recent one — a broad rule can import a lot at once, so consider a Dry Run first.\n\nIf the rule has a Monitor Template selected, eligible devices also receive an active Network Device monitor. Existing monitors are never duplicated and exclusion rules still veto. Site assignment, owner, and label rules apply automatically.\n\nLarge estates are imported in several paced batches; keep this dialog open until it reports, and it will tell you if anything is still left over.";

  return (
    <ConfirmModal
      title={title}
      description={isRunning && progress ? progress : description}
      error={error || undefined}
      isLoading={isRunning}
      submitButtonText={props.isDryRun ? "Start Dry Run" : "Run Rule"}
      onSubmit={runRule}
      onClose={props.onClose}
    />
  );
};

export default RunAutoImportRuleModal;
