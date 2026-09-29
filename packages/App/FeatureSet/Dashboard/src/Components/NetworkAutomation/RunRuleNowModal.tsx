import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import RunNetworkRule, {
  NetworkRuleKind,
  NetworkRuleRunOutcome,
} from "Common/UI/Utils/NetworkAutomation/RunNetworkRule";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";

export { NetworkRuleKind };

export interface ComponentProps {
  ruleKind: NetworkRuleKind;
  ruleId: string;
  // Shown in the modal title when the rule has a name; site rules have none.
  ruleName?: string | undefined;
  onClose: () => void;
}

/*
 * "Run now" for a Network Automation rule: a confirmation first (site
 * assignment rules can be asked to overwrite existing placements, so that
 * choice belongs before the run, not after), then the same modal turned into
 * the report of what the run did.
 */
const RunRuleNowModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [reassignDevicesAlreadyInASite, setReassignDevicesAlreadyInASite] =
    useState<boolean>(false);

  const isSiteAssignment: boolean =
    props.ruleKind === NetworkRuleKind.SiteAssignment;

  const runRule: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsRunning(true);
    setError("");

    /*
     * The tenantid header the common headers carry is what scopes the run to
     * the current project — the endpoint refuses a request without it rather
     * than guessing.
     */
    const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
      ruleKind: props.ruleKind,
      ruleId: props.ruleId,
      reassignDevicesAlreadyInASite: reassignDevicesAlreadyInASite,
      headers: ModelAPI.getCommonHeaders(),
    });

    if (outcome.isSuccess) {
      setSummary(outcome.message);
    } else {
      setError(outcome.message);
    }

    setIsRunning(false);
  }, [props.ruleKind, props.ruleId, reassignDevicesAlreadyInASite]);

  const title: string = props.ruleName
    ? `Run "${props.ruleName}" Now`
    : "Run This Rule Now";

  /*
   * Once the run has answered, the modal stops being a confirmation and
   * becomes the report: one button, and it closes.
   */
  if (summary) {
    return (
      <ConfirmModal
        title={title}
        description={summary}
        submitButtonText="Close"
        onSubmit={props.onClose}
      />
    );
  }

  const description: string = isSiteAssignment
    ? "Evaluate this rule against the network devices that already exist and assign the ones it matches to its site. Rules normally only run when a device is discovered or renamed, so this is how a rule reaches devices that were already in your inventory when you wrote it.\n\nDevices that already belong to a site are left alone, and a device that also matches a higher-priority rule is left to that rule."
    : "Evaluate this rule against the network devices that already exist and attach its labels to the ones it matches. Rules normally only run when a device is discovered, so this is how a rule reaches devices that were already in your inventory when you wrote it.\n\nLabels are only added, never removed, so running this more than once is safe.";

  return (
    <ConfirmModal
      title={title}
      description={description}
      error={error || undefined}
      isLoading={isRunning}
      submitButtonText="Run Rule"
      onSubmit={runRule}
      onClose={props.onClose}
    >
      {isSiteAssignment ? (
        <CheckboxElement
          title="Move devices that are already assigned to a site"
          description="Off by default. Nothing records whether a device's site was chosen by a rule or by a person, so this can move devices somebody placed by hand."
          value={reassignDevicesAlreadyInASite}
          dataTestId="run-rule-reassign-devices-checkbox"
          onChange={(value: boolean) => {
            setReassignDevicesAlreadyInASite(value);
          }}
        />
      ) : (
        <></>
      )}
    </ConfirmModal>
  );
};

export default RunRuleNowModal;
