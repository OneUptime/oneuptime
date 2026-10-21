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
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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
 * The panel is the connection form's Test step, for settings not saved
 * yet. A saved connection's Test (a row of the list) is a dialog of its own
 * (CloudConnectionTestDialog) that draws the same answer: both run the test
 * through useCloudConnectionTest and draw it with CloudConnectionTestAnswer.
 */

export type CloudConnectionTestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: CloudConnectionTestResult }
  | { kind: "error"; message: string };

export interface CloudConnectionTestRun {
  state: CloudConnectionTestState;
  run: () => Promise<void>;
}

/*
 * A test and its answer. With startImmediately it runs once as it mounts:
 * a saved connection's Test opens on its answer.
 */
export function useCloudConnectionTest(data: {
  runTest: () => Promise<CloudConnectionTestResult>;
  startImmediately?: boolean | undefined;
}): CloudConnectionTestRun {
  const [state, setState] = useState<CloudConnectionTestState>(
    data.startImmediately ? { kind: "running" } : { kind: "idle" },
  );

  const run: () => Promise<void> = async (): Promise<void> => {
    setState({ kind: "running" });

    try {
      const result: CloudConnectionTestResult = await data.runTest();
      setState({ kind: "done", result });
    } catch (err) {
      setState({
        kind: "error",
        message: API.getFriendlyErrorMessage(err as Error),
      });
    }
  };

  useEffect(() => {
    if (data.startImmediately) {
      void run();
    }
    // Once, as it mounts; the caller remounts it to start again.
  }, []);

  return { state, run };
}

// The test button's words for where the test is (the button translates them).
export function getCloudTestButtonTitle(
  state: CloudConnectionTestState,
): string {
  if (state.kind === "running") {
    return translationKey("Testing…");
  }

  return state.kind === "idle"
    ? translationKey("Test connection")
    : translationKey("Test again");
}

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

export interface CloudConnectionTestAnswerProps {
  definition: CloudConnectionDefinition;
  state: CloudConnectionTestState;
  // How often the connection would be read: the cost is per read.
  readIntervalInMinutes: number;
}

/*
 * What a test said: what it found by service and region, the accounts it
 * read and what reading them costs - or what to fix, with the cloud's own
 * answer kept apart. Nothing before a test has run; while one runs, the
 * caller says so (a dialog does, a form's button does).
 */
export const CloudConnectionTestAnswer: FunctionComponent<
  CloudConnectionTestAnswerProps
> = (props: CloudConnectionTestAnswerProps): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.state.kind === "error") {
    return (
      <div
        role="alert"
        data-testid="cloud-connection-test-error"
        className="rounded-md bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200"
      >
        {props.state.message}
      </div>
    );
  }

  if (props.state.kind !== "done") {
    return <></>;
  }

  const result: CloudConnectionTestResult = props.state.result;
  const words: CloudWords = getCloudTestWords(result);
  const tone: { box: string; text: string; icon: IconProp } =
    TONES[result.status];
  const found: boolean =
    result.status !== "fail" && (result.resourceCount || 0) > 0;
  const count: CloudTemplate = getResourceCountWords(result.resourceCount || 0);
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
      className={`rounded-lg p-4 ring-1 ring-inset ${tone.box}`}
    >
      <div className={`flex items-start gap-2 text-sm font-medium ${tone.text}`}>
        <Icon icon={tone.icon} className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="min-w-0">{translator.translateText(words.headline)}</div>
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

export interface ComponentProps {
  definition: CloudConnectionDefinition;
  runTest: () => Promise<CloudConnectionTestResult>;
  // How often the connection would be read: the cost is per read.
  readIntervalInMinutes: number;
  // Why the test cannot run yet: a required setting is still empty.
  disabledReason?: string | undefined;
  /*
   * The Test step is open: the test runs by itself, once, unless a
   * setting is missing - nobody opens the step to look at its button.
   * Test again runs it again.
   */
  autoStart?: boolean | undefined;
  // Editing a saved connection: Save changes, not Connect, keeps what it tests.
  isEditing?: boolean | undefined;
}

// The connection form's Test step: what the test does, its button, its answer.
const CloudConnectionTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const test: CloudConnectionTestRun = useCloudConnectionTest({
    runTest: props.runTest,
  });

  /*
   * Once the step is open, not on mount: a form draws every step's fields
   * before it opens its first one, and its steps are told apart only then.
   */
  useEffect(() => {
    if (props.autoStart && !props.disabledReason && test.state.kind === "idle") {
      void test.run();
    }
  }, [props.autoStart, props.disabledReason]);

  return (
    <div data-testid="cloud-connection-test-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText("Test the connection")}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {props.isEditing
              ? translator.translateText(
                  "Signs in and counts what there is to monitor. Nothing changes until you save.",
                )
              : translator.translateText(
                  "Signs in and counts what there is to monitor. Nothing is kept until you connect.",
                )}
          </div>
        </div>
        <div className="flex-shrink-0">
          <Button
            title={getCloudTestButtonTitle(test.state)}
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Normal}
            isLoading={test.state.kind === "running"}
            disabled={
              Boolean(props.disabledReason) || test.state.kind === "running"
            }
            tooltip={props.disabledReason}
            dataTestId="cloud-connection-test-button"
            onClick={() => {
              void test.run();
            }}
          />
        </div>
      </div>

      {/* Said in words too: a greyed button's tooltip never shows on a phone. */}
      {props.disabledReason ? (
        <div
          className="mt-3 text-sm text-amber-700"
          data-testid="cloud-connection-test-missing"
        >
          {props.disabledReason}
        </div>
      ) : (
        <></>
      )}

      {test.state.kind === "done" || test.state.kind === "error" ? (
        <div className="mt-4">
          <CloudConnectionTestAnswer
            definition={props.definition}
            state={test.state}
            readIntervalInMinutes={props.readIntervalInMinutes}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CloudConnectionTestPanel;
