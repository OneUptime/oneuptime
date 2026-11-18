import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  TEST_LOG_DESCRIPTION,
  TEST_LOG_HOW,
  TEST_LOG_SERVICE_NAME,
  TEST_LOG_TITLE,
  getTestLogCommand,
} from "./TelemetryTestLog";

/*
 * "Send a test log" (#7760), under the endpoint and the key in the logs
 * guide's first step: folded to one line, since the guide's own steps are
 * the way most people go; opened, the one command that sends a log with
 * them (TelemetryTestLog.ts).
 */

export const TELEMETRY_TEST_LOG_TEST_ID: string = "telemetry-test-log";

export interface ComponentProps {
  // The OTLP endpoint the step shows.
  otlpUrl: string;
  // The picked key's token, shown in the step already.
  token: string;
}

const TelemetryTestLogFold: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bodyId: string = `telemetry-test-log-${useId()}`;
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <div
      className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white"
      data-testid={TELEMETRY_TEST_LOG_TEST_ID}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        data-testid={`${TELEMETRY_TEST_LOG_TEST_ID}-toggle`}
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50">
          <Icon
            icon={IconProp.PaperAirplane}
            className="h-4 w-4 text-indigo-600"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-gray-900">
            {translator.translateText(TEST_LOG_TITLE)}
          </span>
          <span className="block text-xs text-gray-500">
            {translator.translateText(TEST_LOG_DESCRIPTION)}
          </span>
        </span>
        <Icon
          icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="h-4 w-4 flex-shrink-0 text-gray-400"
        />
      </button>
      {isOpen ? (
        <div
          id={bodyId}
          className="border-t border-gray-200 px-4 py-3"
          data-testid={`${TELEMETRY_TEST_LOG_TEST_ID}-body`}
        >
          <p className="mb-3 text-sm leading-relaxed text-gray-600">
            <TranslatedSentence
              template={TEST_LOG_HOW}
              slots={{
                service: (
                  <code className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">
                    {TEST_LOG_SERVICE_NAME}
                  </code>
                ),
              }}
            />
          </p>
          <CodeBlock
            code={getTestLogCommand({
              otlpUrl: props.otlpUrl,
              token: props.token,
            })}
            language="bash"
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryTestLogFold;
