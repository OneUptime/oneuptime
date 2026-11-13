import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Icon from "../Icon/Icon";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONValue } from "../../../Types/JSON";
import { LLMProviderExchange } from "../../../Types/LLM/LLMProviderExchange";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * REQUEST AND RESPONSE, under Test LLM Provider's verdict (issue #7080).
 *
 * The verdict says in OneUptime's words what went wrong and what to check.
 * This is the evidence under it, folded until asked for: each request the
 * test sent the provider - its address, headers and body - and what came
 * back - the status, headers and body - or why nothing did. Secrets arrive
 * masked from the server (LLMProviderExchangeRecorder), and the whole lot
 * can be copied, for a support ticket or the provider's own help desk.
 */

export interface ComponentProps {
  exchanges: Array<LLMProviderExchange>;
}

export type ExchangeTone = "success" | "warning" | "danger" | "neutral";

// How a status reads at a glance: 2xx fine, 4xx the request, 5xx theirs.
export const getExchangeTone: (
  exchange: LLMProviderExchange,
) => ExchangeTone = (exchange: LLMProviderExchange): ExchangeTone => {
  const status: number | undefined = exchange.statusCode;

  if (status === undefined) {
    return exchange.error ? "danger" : "neutral";
  }

  if (status >= 200 && status < 300) {
    return "success";
  }

  if (status === 429 || status === 408) {
    return "warning";
  }

  return "danger";
};

const TONE_CLASSES: Record<ExchangeTone, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  danger: "bg-red-50 text-red-700 ring-red-600/20",
  neutral: "bg-gray-50 text-gray-600 ring-gray-500/20",
};

// A body as people read it: JSON indented, text as it came.
export const formatExchangeBody: (body: JSONValue | undefined) => string = (
  body: JSONValue | undefined,
): string => {
  if (body === undefined || body === null) {
    return "";
  }

  if (typeof body === "string") {
    return body;
  }

  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
};

// Headers as an HTTP message writes them, one "name: value" a line.
export const formatExchangeHeaders: (
  headers: Dictionary<string> | undefined,
) => string = (headers: Dictionary<string> | undefined): string => {
  return Object.entries(headers || {})
    .map(([name, value]: [string, string]) => {
      return `${name}: ${value}`;
    })
    .join("\n");
};

// Everything, as one block of text to paste into a ticket.
export const formatExchangesForCopy: (
  exchanges: Array<LLMProviderExchange>,
) => string = (exchanges: Array<LLMProviderExchange>): string => {
  return exchanges
    .map((exchange: LLMProviderExchange, index: number) => {
      const parts: Array<string> = [
        `### Request ${index + 1}`,
        `${exchange.method} ${exchange.url}`,
      ];

      const requestHeaders: string = formatExchangeHeaders(
        exchange.requestHeaders,
      );

      if (requestHeaders) {
        parts.push(requestHeaders);
      }

      const requestBody: string = formatExchangeBody(exchange.requestBody);

      if (requestBody) {
        parts.push("", requestBody);
      }

      parts.push("", `### Response ${index + 1} (${exchange.durationMs} ms)`);

      if (exchange.statusCode !== undefined) {
        parts.push(`HTTP ${exchange.statusCode}`);

        const responseHeaders: string = formatExchangeHeaders(
          exchange.responseHeaders,
        );

        if (responseHeaders) {
          parts.push(responseHeaders);
        }

        const responseBody: string = formatExchangeBody(exchange.responseBody);

        if (responseBody) {
          parts.push("", responseBody);
        }
      } else {
        parts.push("No response");
      }

      if (exchange.error) {
        parts.push(`Error: ${exchange.error}`);
      }

      return parts.join("\n");
    })
    .join("\n\n");
};

const CodeBlock: FunctionComponent<{
  label: string;
  text: string;
  testId: string;
}> = (props: { label: string; text: string; testId: string }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-gray-500">
        {translator.translateText(props.label)}
      </div>
      <pre
        className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-800 ring-1 ring-inset ring-gray-200"
        data-testid={props.testId}
        dir="ltr"
      >
        {props.text}
      </pre>
    </div>
  );
};

const ExchangeView: FunctionComponent<{
  exchange: LLMProviderExchange;
  index: number;
  total: number;
}> = (props: {
  exchange: LLMProviderExchange;
  index: number;
  total: number;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const exchange: LLMProviderExchange = props.exchange;
  const tone: ExchangeTone = getExchangeTone(exchange);

  const requestHeaders: string = formatExchangeHeaders(exchange.requestHeaders);
  const requestBody: string = formatExchangeBody(exchange.requestBody);
  const responseHeaders: string = formatExchangeHeaders(
    exchange.responseHeaders,
  );
  const responseBody: string = formatExchangeBody(exchange.responseBody);
  const answered: boolean = exchange.statusCode !== undefined;

  return (
    <li
      className="rounded-lg border border-gray-200 bg-white"
      data-testid="llm-provider-exchange"
      data-tone={tone}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 px-3 py-2">
        {props.total > 1 ? (
          <span className="text-xs font-medium text-gray-500">
            {translator.translateTemplate("Request {{number}} of {{total}}", {
              number: translator.formatNumber(props.index + 1),
              total: translator.formatNumber(props.total),
            })}
          </span>
        ) : (
          <></>
        )}
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-inset ${TONE_CLASSES[tone]}`}
          data-testid="llm-provider-exchange-status"
        >
          {answered
            ? translator.translateTemplate("HTTP {{status}}", {
                status: String(exchange.statusCode),
              })
            : translator.translateText("No response")}
        </span>
        <span className="text-xs tabular-nums text-gray-500">
          {translator.translatePlural(
            { one: "{{count}} ms", other: "{{count}} ms" },
            exchange.durationMs,
          )}
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div
          className="flex min-w-0 items-start gap-2 font-mono text-xs text-gray-800"
          dir="ltr"
        >
          <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-700">
            {exchange.method}
          </span>
          <span
            className="min-w-0 break-all py-0.5"
            data-testid="llm-provider-exchange-url"
          >
            {exchange.url}
          </span>
        </div>

        {exchange.error ? (
          <div
            className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-inset ring-red-200"
            data-testid="llm-provider-exchange-error"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
            />
            <span className="min-w-0 break-words">{exchange.error}</span>
          </div>
        ) : (
          <></>
        )}

        {requestHeaders ? (
          <CodeBlock
            label="Request headers"
            text={requestHeaders}
            testId="llm-provider-exchange-request-headers"
          />
        ) : (
          <></>
        )}
        {requestBody ? (
          <CodeBlock
            label="Request body"
            text={requestBody}
            testId="llm-provider-exchange-request-body"
          />
        ) : (
          <></>
        )}
        {answered && responseHeaders ? (
          <CodeBlock
            label="Response headers"
            text={responseHeaders}
            testId="llm-provider-exchange-response-headers"
          />
        ) : (
          <></>
        )}
        {answered && responseBody ? (
          <CodeBlock
            label="Response body"
            text={responseBody}
            testId="llm-provider-exchange-response-body"
          />
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

const LlmProviderExchanges: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (props.exchanges.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-4" data-testid="llm-provider-exchanges">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-expanded={isOpen}
          aria-controls="llm-provider-exchange-list"
          data-testid="llm-provider-exchanges-toggle"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          <Icon
            icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
            className="h-4 w-4"
          />
          {isOpen
            ? translator.translateText("Hide request and response")
            : translator.translateText("Show request and response")}
        </button>
        {isOpen ? (
          <CopyTextButton
            textToBeCopied={formatExchangesForCopy(props.exchanges)}
            label="Copy all"
            size="xs"
            variant="soft"
          />
        ) : (
          <></>
        )}
      </div>

      {isOpen ? (
        <div className="mt-3">
          <p className="mb-3 text-xs text-gray-500">
            {translator.translateText(
              "What was sent to your provider and what came back. API keys and cookies are masked.",
            )}
          </p>
          <ol
            id="llm-provider-exchange-list"
            className="space-y-3"
            data-testid="llm-provider-exchange-list"
          >
            {props.exchanges.map(
              (exchange: LLMProviderExchange, index: number): ReactElement => {
                return (
                  <ExchangeView
                    key={index}
                    exchange={exchange}
                    index={index}
                    total={props.exchanges.length}
                  />
                );
              },
            )}
          </ol>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default LlmProviderExchanges;
