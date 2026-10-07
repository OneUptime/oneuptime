import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
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
import { VideoCallTestResult } from "./VideoCallApi";
import VideoCallProviderLogo from "./VideoCallProviderLogo";

/*
 * Starts a real test meeting with a connection's settings - the one check
 * that proves the credentials, the permission on the provider's side (a
 * Zoom scope, a Google delegation, a Teams access policy) and the host all
 * work together - and shows its join link, or the provider's reason it
 * could not.
 *
 * Used inside the connection form, for settings that are not saved yet, and
 * on its own for a saved connection.
 */

export interface ComponentProps {
  providerTitle: string;
  runTest: () => Promise<VideoCallTestResult>;
  // Why the test cannot run yet: a required credential is still empty.
  disabledReason?: string | undefined;
  /*
   * Runs the test as soon as the panel opens (the table's Test action).
   * The caller passes a key so a remount starts it again.
   */
  startImmediately?: boolean | undefined;
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "passed"; result: VideoCallTestResult }
  | { kind: "failed"; message: string };

const VideoCallTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<TestState>({ kind: "idle" });

  const run: () => Promise<void> = async (): Promise<void> => {
    setState({ kind: "running" });

    try {
      const result: VideoCallTestResult = await props.runTest();
      setState({ kind: "passed", result });
    } catch (err) {
      setState({
        kind: "failed",
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

  return (
    <div
      data-testid="video-call-test-panel"
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText("Start a test meeting")}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {translator.translateText(
              "Creates a real meeting with these settings - the only check that proves the credentials, the permission and the host work together. Nothing is posted anywhere.",
            )}
          </p>
        </div>
        <div className="flex-shrink-0">
          <Button
            title={
              state.kind === "running"
                ? "Starting test meeting…"
                : state.kind === "idle"
                  ? "Start test meeting"
                  : "Test again"
            }
            icon={IconProp.Play}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Normal}
            isLoading={state.kind === "running"}
            disabled={Boolean(props.disabledReason) || state.kind === "running"}
            tooltip={props.disabledReason}
            dataTestId="video-call-test-button"
            onClick={() => {
              void run();
            }}
          />
        </div>
      </div>

      {state.kind === "passed" && (
        <div
          role="status"
          data-testid="video-call-test-passed"
          className="mt-4 flex flex-col gap-3 rounded-md bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-200 sm:flex-row sm:items-center"
        >
          <VideoCallProviderLogo
            provider={state.result.provider}
            joinUrl={state.result.joinUrl}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-800">
              <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
              {translator.translateText("Test meeting created")}
            </div>
            <a
              href={state.result.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-sm text-emerald-700 underline-offset-2 hover:underline"
            >
              {state.result.joinUrl}
            </a>
          </div>
          <CopyTextButton
            textToBeCopied={state.result.joinUrl}
            label="Copy link"
            size="sm"
            variant="soft"
          />
        </div>
      )}

      {state.kind === "failed" && (
        <div
          role="alert"
          data-testid="video-call-test-failed"
          className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-inset ring-red-200"
        >
          <div className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <Icon icon={IconProp.Error} className="h-4 w-4" />
            {translator.translateTemplate(
              "{{provider}} could not start a meeting with these settings",
              { provider: props.providerTitle },
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-red-700">
            {state.message}
          </p>
        </div>
      )}
    </div>
  );
};

export default VideoCallTestPanel;
