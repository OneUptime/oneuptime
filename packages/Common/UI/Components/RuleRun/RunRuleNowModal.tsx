import {
  RuleRunAction,
  RuleRunResult,
  RuleRunType,
  RuleRunTypeMetadata,
  RuleRunTypeUtil,
} from "../../../Types/Rules/RuleRun";
import RuleRunSummary from "../../../Utils/Rules/RuleRunSummary";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import RuleRunClient, { RuleRunOutcome } from "../../Utils/Rules/RuleRunClient";
import CheckboxElement from "../Checkbox/Checkbox";
import ConfirmModal from "../Modal/ConfirmModal";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";

export interface ComponentProps {
  ruleType: RuleRunType;
  ruleId: string;
  // Shown in the title when the rule has a name.
  ruleName?: string | undefined;
  onClose: () => void;
  // Called once a run has ended, with what it did (null if nothing ran).
  onRunComplete?: ((result: RuleRunResult | null) => void) | undefined;
}

/*
 * "Run now" for one rule: a confirmation first - owner rules ask whether to
 * notify the owners the run adds, and that choice belongs before the run - then
 * a progress line while passes chain, then the same modal turned into the
 * report of what the run did.
 */
const RunRuleNowModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [notifyOwners, setNotifyOwners] = useState<boolean>(false);

  const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(props.ruleType);
  const isOwnerRule: boolean = meta.action === RuleRunAction.AddOwners;

  const runRule: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsRunning(true);
    setError("");
    setProgress("");

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: props.ruleType,
      ruleId: props.ruleId,
      notifyOwners: isOwnerRule && notifyOwners,
      headers: ModelAPI.getCommonHeaders(),
      onProgress: (result: RuleRunResult): void => {
        setProgress(
          RuleRunSummary.describeProgress({
            ruleType: props.ruleType,
            result: result,
          }),
        );
      },
    });

    setProgress("");

    if (outcome.isSuccess) {
      setSummary(outcome.message);
    } else {
      setError(outcome.message);
    }

    setIsRunning(false);

    if (props.onRunComplete) {
      props.onRunComplete(outcome.result);
    }
  }, [
    props.ruleType,
    props.ruleId,
    props.onRunComplete,
    isOwnerRule,
    notifyOwners,
  ]);

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

  return (
    <ConfirmModal
      title={title}
      description={RuleRunSummary.describeConfirmation(props.ruleType)}
      error={error || undefined}
      isLoading={isRunning}
      submitButtonText="Run Rule"
      onSubmit={runRule}
      onClose={isRunning ? undefined : props.onClose}
    >
      <div>
        {isOwnerRule ? (
          <CheckboxElement
            title="Notify the owners this run adds"
            description={`Off by default, and only honoured when the rule itself has Notify Owners turned on. An owner is notified once for every ${meta.resourceSingular} they are added to, which on a large project can be a lot of notifications.`}
            value={notifyOwners}
            dataTestId="run-rule-notify-owners-checkbox"
            onChange={(value: boolean) => {
              setNotifyOwners(value);
            }}
          />
        ) : (
          <></>
        )}
        {progress ? (
          <p
            className="mt-3 text-sm text-gray-600"
            data-testid="run-rule-progress"
          >
            {progress}
          </p>
        ) : (
          <></>
        )}
      </div>
    </ConfirmModal>
  );
};

export default RunRuleNowModal;
