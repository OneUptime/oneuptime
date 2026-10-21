import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { CloudConnectionDefinition } from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionTestResult } from "Common/Types/CloudConnection/CloudConnectionTest";
import IconProp from "Common/Types/Icon/IconProp";
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
import CloudResourceGroups from "./CloudResourceGroups";
import {
  CloudTemplate,
  CloudWords,
  drawCloudTemplate,
  getCloudCostWords,
  getCloudTestWords,
  getResourceCountWords,
} from "./CloudConnectionWords";

/*
 * "Test connection": sign in with the settings as they are, and count a
 * little of what a read would find - the resources by type and region,
 * and what reading their metrics would cost in the cloud's own bill.
 * Nothing is stored. When it does not work, it says why and what to do.
 *
 * Used in the connection form, for settings not saved yet, and from a
 * connection's row in the list.
 */

export interface ComponentProps {
  definition: CloudConnectionDefinition;
  runTest: () => Promise<CloudConnectionTestResult>;
  // How often the connection would be read: the cost is per read.
  readIntervalInMinutes: number;
  // Why the test cannot run yet: a required setting is still empty.
  disabledReason?: string | undefined;
  // Runs the test as soon as the panel opens (the list's Test action).
  startImmediately?: boolean | undefined;
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: CloudConnectionTestResult }
  | { kind: "error"; message: string };

const TONES: Record<
  CloudConnectionTestResult["status"],
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

const CloudConnectionTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<TestState>({ kind: "idle" });

  const run: () => Promise<void> = async (): Promise<void> => {
    setState({ kind: "running" });

    try {
      const result: CloudConnectionTestResult = await props.runTest();
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

  // A saved connection's test is a dialog of its own: only the answer shows.
  const isSavedTest: boolean = Boolean(props.startImmediately);

  const renderResult: (result: CloudConnectionTestResult) => ReactElement = (
    result: CloudConnectionTestResult,
  ): ReactElement => {
    const words: CloudWords = getCloudTestWords(result);
    const tone: { box: string; text: string; icon: IconProp } =
      TONES[result.status];
    const found: boolean =
      result.status !== "fail" && (result.resourceCount || 0) > 0;
    const count: CloudTemplate = getResourceCountWords(
      result.resourceCount || 0,
    );
    const cost: CloudTemplate | undefined = found
      ? getCloudCostWords({
          provider: props.definition.provider as CloudProvider,
          resourceTypes: result.resourceTypes || [],
          readIntervalInMinutes: props.readIntervalInMinutes,
          accounts: (result.accounts || []).length,
        })
      : undefined;

    return (
      <div
        role="status"
        data-testid={`cloud-connection-test-${result.status}`}
        className={`${isSavedTest ? "" : "mt-4"} rounded-lg p-4 ring-1 ring-inset ${tone.box}`}
      >
        <div
          className={`flex items-start gap-2 text-sm font-medium ${tone.text}`}
        >
          <Icon icon={tone.icon} className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            {translator.translateText(words.headline)}
          </div>
        </div>

        {found ? (
          <div className="mt-3 space-y-3 pl-6" data-testid="cloud-test-found">
            <div>
              <div className="text-sm font-semibold text-gray-900">
                {drawCloudTemplate(translator, count)}
              </div>
              {result.isSample ? (
                <div className="text-xs text-gray-500">
                  {translator.translateText(
                    "A quick look. The first read finds every resource.",
                  )}
                </div>
              ) : (
                <></>
              )}
            </div>
            <CloudResourceGroups
              provider={props.definition.provider}
              resourceTypes={result.resourceTypes || []}
              regions={result.regions || []}
              accounts={result.accounts || []}
            />
            {cost ? (
              <div
                className="flex items-start gap-1.5 text-xs text-gray-600"
                data-testid="cloud-test-cost"
              >
                <Icon
                  icon={IconProp.CurrencyDollar}
                  className="mt-px h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                />
                <span>{drawCloudTemplate(translator, cost)}</span>
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {words.advice ? (
          <div className="mt-2 pl-6 text-sm text-gray-700">
            {translator.translateText(words.advice)}
          </div>
        ) : (
          <></>
        )}

        {words.details ? (
          <div className="ml-6 mt-3">
            <div className="text-xs font-medium text-gray-500">
              {translator.translateText("Details")}
            </div>
            <div
              className="mt-1 max-h-40 overflow-y-auto break-words rounded-md bg-white px-3 py-2 font-mono text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
              data-testid="cloud-connection-test-details"
            >
              {words.details}
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const button: ReactElement = (
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
      dataTestId="cloud-connection-test-button"
      onClick={() => {
        void run();
      }}
    />
  );

  return (
    <div data-testid="cloud-connection-test-panel">
      {isSavedTest ? (
        <></>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">
              {translator.translateText("Test the connection")}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {translator.translateText(
                "Signs in and counts what there is to monitor. Nothing is kept until you connect.",
              )}
            </div>
          </div>
          <div className="flex-shrink-0">{button}</div>
        </div>
      )}

      {state.kind === "done" ? renderResult(state.result) : <></>}

      {state.kind === "error" ? (
        <div
          role="alert"
          data-testid="cloud-connection-test-error"
          className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200"
        >
          {state.message}
        </div>
      ) : (
        <></>
      )}

      {isSavedTest ? (
        <div
          className={`flex justify-end ${state.kind === "running" ? "" : "mt-4"}`}
        >
          {button}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudConnectionTestPanel;
