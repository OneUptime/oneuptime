import IconProp from "Common/Types/Icon/IconProp";
import {
  LlmConnectionDefinition,
  LlmConnectionKind,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import { LlmConnectionTestResult } from "Common/Types/LlmObservability/LlmConnectionTest";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  LlmConnectionTestFigure,
  LlmConnectionTestWords,
  getLlmConnectionTestFigures,
  getLlmConnectionTestWords,
} from "./LlmConnectionTestWords";

/*
 * "Test connection": a small real read with the settings as they are -
 * a few days of a provider account's usage, or a count of a company AI
 * tool's newest chats. Nothing is imported or stored, and nothing anyone
 * wrote is shown. The answer says whether it works, what it would bring
 * in, and - when it does not work - what to fix.
 *
 * Used in the connection form, for settings not saved yet, and from a
 * connection's row in the list.
 */

export interface ComponentProps {
  definition: LlmConnectionDefinition;
  runTest: () => Promise<LlmConnectionTestResult>;
  // Why the test cannot run yet: a required setting is still empty.
  disabledReason?: string | undefined;
  // Runs the test as soon as the panel opens (the list's Test action).
  startImmediately?: boolean | undefined;
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: LlmConnectionTestResult }
  | { kind: "error"; message: string };

const TONES: Record<
  LlmConnectionTestResult["status"],
  { box: string; text: string; icon: IconProp }
> = {
  pass: {
    box: "bg-emerald-50 ring-emerald-200",
    text: "text-emerald-800",
    icon: IconProp.CheckCircle,
  },
  warn: {
    box: "bg-amber-50 ring-amber-200",
    text: "text-amber-800",
    icon: IconProp.Alert,
  },
  fail: {
    box: "bg-red-50 ring-red-200",
    text: "text-red-800",
    icon: IconProp.Alert,
  },
};

const LlmConnectionTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<TestState>({ kind: "idle" });

  const run: () => Promise<void> = async (): Promise<void> => {
    setState({ kind: "running" });

    try {
      const result: LlmConnectionTestResult = await props.runTest();
      setState({ kind: "done", result });
    } catch (err) {
      setState({
        kind: "error",
        message: API.getFriendlyErrorMessage(err as Error),
      });
    }
  };

  useEffect(() => {
    if (props.startImmediately) {
      void run();
    }
    // Once, when the panel opens; the caller remounts it to test again.
  }, []);

  const isTool: boolean =
    props.definition.kind === LlmConnectionKind.CompanyTool;

  const renderResult: (result: LlmConnectionTestResult) => ReactElement = (
    result: LlmConnectionTestResult,
  ): ReactElement => {
    const words: LlmConnectionTestWords = getLlmConnectionTestWords({
      result,
      definition: props.definition,
    });
    const figures: Array<LlmConnectionTestFigure> = getLlmConnectionTestFigures(
      result,
      props.definition.provider,
    );
    const tone: { box: string; text: string; icon: IconProp } =
      TONES[result.status];

    return (
      <div
        role="status"
        data-testid={`llm-connection-test-${result.status}`}
        className={`mt-4 rounded-md p-3 ring-1 ring-inset ${tone.box}`}
      >
        <div
          className={`flex items-start gap-2 text-sm font-medium ${tone.text}`}
        >
          <Icon icon={tone.icon} className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            {translator.translateText(words.headline)}
          </div>
        </div>

        {figures.length > 0 ? (
          <dl
            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
            data-testid="llm-connection-test-figures"
          >
            {figures.map((figure: LlmConnectionTestFigure): ReactElement => {
              return (
                <div
                  key={figure.key}
                  className="rounded-md bg-white px-3 py-2 ring-1 ring-inset ring-gray-200"
                >
                  <dt className="text-xs text-gray-500">
                    {translator.translateText(figure.label)}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-gray-900">
                    {figure.value}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <></>
        )}

        {words.advice ? (
          <div className="mt-2 text-sm text-gray-700">
            {translator.translateText(words.advice)}
          </div>
        ) : (
          <></>
        )}

        {words.details ? (
          <div
            className="mt-2 break-words rounded bg-white px-3 py-2 font-mono text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
            data-testid="llm-connection-test-details"
          >
            {words.details}
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div
      data-testid="llm-connection-test-panel"
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText("Test the connection")}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {isTool
              ? translator.translateText(
                  "Counts the chats of the last 7 days. Nothing anyone wrote is read, shown or kept.",
                )
              : translator.translateText(
                  "Reads the last 7 days of usage. Nothing is kept until you connect.",
                )}
          </div>
        </div>
        <div className="flex-shrink-0">
          <Button
            title={
              state.kind === "running"
                ? "Testing…"
                : state.kind === "idle"
                  ? "Test connection"
                  : "Test again"
            }
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Normal}
            isLoading={state.kind === "running"}
            disabled={Boolean(props.disabledReason) || state.kind === "running"}
            tooltip={props.disabledReason}
            dataTestId="llm-connection-test-button"
            onClick={() => {
              void run();
            }}
          />
        </div>
      </div>

      {state.kind === "done" ? renderResult(state.result) : <></>}

      {state.kind === "error" ? (
        <div
          role="alert"
          data-testid="llm-connection-test-error"
          className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200"
        >
          {state.message}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default LlmConnectionTestPanel;
