import Alert, { AlertType } from "../Alerts/Alert";
import Button, { ButtonStyleType } from "../Button/Button";
import Loader, { LoaderType } from "../Loader/Loader";
import Modal from "../Modal/Modal";
import { Indigo500 } from "../../../Types/BrandColors";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import TestLLMProvider, {
  LLMProviderTestResult,
} from "../../Utils/TestLLMProvider";
import {
  LLM_PROVIDER_TEST_CHECKS,
  LLM_PROVIDER_TEST_SENDING,
} from "../../Utils/LlmProviderTestCopy";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * TEST LLM PROVIDER, the dialog.
 *
 * Opened by a provider's Test button (Project Settings > AI > LLM Providers,
 * a provider's page, and a global provider's row in the Admin Dashboard). It
 * sends the provider a short prompt at once and says how it went:
 *
 *  - testing: what is happening and what it checks, while it happens - and
 *    the dialog can be closed meanwhile (Close, its X, Escape: a provider
 *    that never answers can take minutes), its late verdict then dropped;
 *  - passed: the provider answered and called the tool it was offered;
 *  - passed, with a warning: it answered but did not call the tool, or ran
 *    out of room before it could - Ask AI and investigations read data
 *    through tools, so the server's words say what that means;
 *  - failed: the server's words. For a provider that failed, what went wrong
 *    and what to check, then - on a line of its own - what the provider
 *    answered (LlmProviderTestFailure); for a test that was refused (who may
 *    test, the plan), why.
 *
 * Each outcome is one alert with a headline in the reader's language and the
 * server's verdict under it, which already ends with what to do next: check
 * a setting, wait and test again. "Test again" runs it again - the verdict
 * for a reply cut short, or a provider that was busy, asks for that - and
 * Close closes.
 */

export enum LlmProviderTestOutcome {
  Testing = "testing",
  Passed = "passed",
  Warning = "warning",
  Failed = "failed",
}

export interface ComponentProps {
  llmProviderId: string;
  /*
   * The request's headers: the Dashboard's (its project), or none from the
   * Admin Dashboard, which tests the global providers.
   */
  headers?: Dictionary<string> | undefined;
  onClose: () => void;
}

// The outcome of a verdict the server sent.
export const getLlmProviderTestOutcome: (
  result: LLMProviderTestResult,
) => LlmProviderTestOutcome = (
  result: LLMProviderTestResult,
): LlmProviderTestOutcome => {
  if (!result.success) {
    return LlmProviderTestOutcome.Failed;
  }

  /*
   * false: connected, but tool calling was not seen. undefined: an older
   * server, which does not say - its verdict is a pass.
   */
  return result.supportsToolCalling === false
    ? LlmProviderTestOutcome.Warning
    : LlmProviderTestOutcome.Passed;
};

// Each outcome's headline: an English key, looked up where it is shown.
const HEADLINES: Record<
  Exclude<LlmProviderTestOutcome, LlmProviderTestOutcome.Testing>,
  string
> = {
  [LlmProviderTestOutcome.Passed]: translationKey("Test passed"),
  [LlmProviderTestOutcome.Warning]: translationKey(
    "Test passed, with a warning",
  ),
  [LlmProviderTestOutcome.Failed]: translationKey("Test failed"),
};

const ALERT_TYPES: Record<
  Exclude<LlmProviderTestOutcome, LlmProviderTestOutcome.Testing>,
  AlertType
> = {
  [LlmProviderTestOutcome.Passed]: AlertType.SUCCESS,
  [LlmProviderTestOutcome.Warning]: AlertType.WARNING,
  [LlmProviderTestOutcome.Failed]: AlertType.DANGER,
};

const TestLlmProviderModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [outcome, setOutcome] = useState<LlmProviderTestOutcome>(
    LlmProviderTestOutcome.Testing,
  );
  const [verdict, setVerdict] = useState<string>("");

  /*
   * Which run's verdict may still be shown: a run started again, or a
   * dialog closed, drops the verdict of the one before.
   */
  const currentRun: React.MutableRefObject<number> = useRef<number>(0);

  const runTest: () => Promise<void> = useCallback(async (): Promise<void> => {
    currentRun.current = currentRun.current + 1;
    const run: number = currentRun.current;

    setOutcome(LlmProviderTestOutcome.Testing);
    setVerdict("");

    const result: LLMProviderTestResult = await TestLLMProvider.test({
      llmProviderId: props.llmProviderId,
      headers: props.headers,
    });

    if (run !== currentRun.current) {
      return;
    }

    setVerdict(result.message);
    setOutcome(getLlmProviderTestOutcome(result));
  }, [props.llmProviderId, props.headers]);

  useEffect(() => {
    runTest().catch(() => {
      // TestLLMProvider.test answers every failure itself.
    });

    return () => {
      // Closed: whatever the run still in flight says is not shown.
      currentRun.current = currentRun.current + 1;
    };
  }, []);

  return (
    <Modal
      title="Test LLM Provider"
      /*
       * A dialog that reports, laid out as the product's other connection
       * tests are (ConnectionTestModal): nothing to confirm or lose, so
       * every way out closes it - Close, the X, Escape and the backdrop -
       * while the test runs too. Close is the footer's one button on the
       * right, where the focus starts, and it never moves.
       */
      onClose={props.onClose}
      closeButtonText="Close"
      /*
       * Test again, on the footer's other side, once there is a verdict:
       * while a test runs there is nothing to run again, and a disabled
       * button looks like one to press. Arriving there, it takes nobody's
       * place - beside Close it would have pushed Close aside just as the
       * verdict came in.
       */
      leftFooterElement={
        outcome === LlmProviderTestOutcome.Testing ? undefined : (
          <Button
            title="Test again"
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Refresh}
            dataTestId="llm-provider-test-again"
            onClick={() => {
              runTest().catch(() => {
                // TestLLMProvider.test answers every failure itself.
              });
            }}
          />
        )
      }
    >
      <div data-testid="llm-provider-test" data-outcome={outcome}>
        {outcome === LlmProviderTestOutcome.Testing ? (
          <div
            className="flex flex-col items-center gap-3 py-4 text-center"
            data-testid="llm-provider-test-running"
          >
            <Loader loaderType={LoaderType.Bar} color={Indigo500} size={160} />
            <p className="text-balance text-sm font-medium leading-6 text-gray-900">
              {translator.translateText(LLM_PROVIDER_TEST_SENDING)}
            </p>
            <p className="max-w-sm text-pretty text-sm leading-6 text-gray-500">
              {translator.translateText(LLM_PROVIDER_TEST_CHECKS)}
            </p>
          </div>
        ) : (
          /*
           * The verdict keeps its line breaks: a failure puts what the
           * provider answered on a line of its own, under what to check.
           */
          <Alert
            type={ALERT_TYPES[outcome]}
            strongTitle={HEADLINES[outcome]}
            title={verdict}
            dataTestId="llm-provider-test-result"
            textClassName="whitespace-pre-wrap"
          />
        )}
      </div>
    </Modal>
  );
};

export default TestLlmProviderModal;
