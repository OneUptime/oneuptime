import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import IngestionKeySelector from "../../Telemetry/IngestionKeySelector";
import { llmConnectionDocsUrl } from "./LlmConnectApi";
import {
  LLM_APPS_SNIPPETS,
  LlmAppsSnippet,
  LlmAppsSnippetBlock,
  LlmAppsSnippetKey,
  OTLP_URL_PLACEHOLDER,
  TOKEN_PLACEHOLDER,
  fillLlmAppsSnippet,
} from "./LlmAppsSnippets";

/*
 * The first way AI comes in: your apps send their AI calls. Pick a key,
 * pick how your app is built, paste. Each call arrives as it happens, with
 * its prompt and answer, its tokens and its cost; the conversation and the
 * person come from two attributes the snippets show.
 *
 * What the old Setup page said in five steps is folded under "What to
 * send", and the guide has the rest.
 */

export const LLM_DOCS_PATH: string = "/docs/telemetry/ai-llm-observability";
export const LLM_GATEWAYS_DOCS_PATH: string = "/docs/telemetry/ai-gateways";

interface Hint {
  key: string;
  title: string;
  body: string;
}

const HINTS: Array<Hint> = [
  {
    key: "conversations",
    title: translationKey("Group calls into conversations"),
    body: translationKey(
      "Set gen_ai.conversation.id (or session.id) to your chat's id on every AI call, and each chat shows as one conversation you can replay.",
    ),
  },
  {
    key: "person",
    title: translationKey("Say who asked"),
    body: translationKey(
      "Set user.email or user.id on every AI call to see who each conversation was with, and who spends what on Usage.",
    ),
  },
  {
    key: "record",
    title: translationKey("Record what was said"),
    body: translationKey(
      "OpenLLMetry records prompts and answers by default. The OpenTelemetry instrumentations record them with OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true.",
    ),
  },
  {
    key: "flag",
    title: translationKey("Flag bad answers"),
    body: translationKey(
      "Failed, refused, cut-off and empty answers are found for you. Flag the rest with a gen_ai.evaluation.result event whose gen_ai.evaluation.score.label is fail.",
    ),
  },
];

const LlmAppsPath: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [selectedKey, setSelectedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );
  const [snippetKey, setSnippetKey] = useState<LlmAppsSnippetKey>("python");

  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const otlpUrl: string = HOST
    ? `${httpProtocol}://${HOST}/otlp`
    : OTLP_URL_PLACEHOLDER;
  const token: string = selectedKey?.secretKey?.toString() || TOKEN_PLACEHOLDER;

  const snippet: LlmAppsSnippet =
    LLM_APPS_SNIPPETS.find((item: LlmAppsSnippet): boolean => {
      return item.key === snippetKey;
    }) || LLM_APPS_SNIPPETS[0]!;

  const scrubRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TRACES_SETTINGS_SCRUB_RULES] as Route,
  );

  return (
    <div className="space-y-5" data-testid="llm-connect-apps">
      <IngestionKeySelector
        endpointLabel="OTLP endpoint"
        endpointValue={otlpUrl}
        endpointHint="Send the key in the x-oneuptime-token header."
        keyTypeFilter={TelemetryIngestionKeyType.Server}
        newKeyName={translationKey("AI calls key")}
        onSelectedKeyChange={setSelectedKey}
      />

      <div>
        <div
          role="tablist"
          aria-label={translator.translateText("How your app is built")}
          className="flex flex-wrap gap-2"
        >
          {LLM_APPS_SNIPPETS.map((item: LlmAppsSnippet): ReactElement => {
            const isActive: boolean = item.key === snippet.key;

            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid={`llm-apps-snippet-tab-${item.key}`}
                onClick={() => {
                  setSnippetKey(item.key);
                }}
                className={
                  isActive
                    ? "rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                }
              >
                {translator.translateText(item.title)}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          className="mt-3 space-y-3"
          data-testid={`llm-apps-snippet-${snippet.key}`}
        >
          <div className="text-sm text-gray-600">
            {translator.translateText(snippet.note)}
          </div>
          {snippet.blocks.map(
            (block: LlmAppsSnippetBlock, index: number): ReactElement => {
              return (
                <CodeBlock
                  key={`${snippet.key}-${index}`}
                  language={block.language}
                  code={fillLlmAppsSnippet(block.code, { otlpUrl, token })}
                />
              );
            },
          )}
          {snippet.key === "gateway" ? (
            <a
              href={llmConnectionDocsUrl(LLM_GATEWAYS_DOCS_PATH).toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              <Icon icon={IconProp.Book} className="h-4 w-4" />
              <span>{translator.translateText("Gateways guide")}</span>
            </a>
          ) : (
            <></>
          )}
        </div>
      </div>

      <details
        className="group rounded-lg border border-gray-200 bg-white"
        data-testid="llm-apps-what-to-send"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-gray-900">
          <Icon
            icon={IconProp.ChevronRight}
            className="h-4 w-4 text-gray-500 transition-transform group-open:rotate-90"
          />
          {translator.translateText("What to send to get the most out of it")}
        </summary>
        <ol className="space-y-3 px-4 pb-4">
          {HINTS.map((hint: Hint, index: number): ReactElement => {
            return (
              <li key={hint.key} className="flex items-start gap-3">
                <div
                  aria-hidden="true"
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700"
                >
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">
                    {translator.translateText(hint.title)}
                  </div>
                  <div className="mt-0.5 break-words text-sm text-gray-600">
                    {translator.translateText(hint.body)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
          <TranslatedSentence
            template="Prompts can carry personal data. Mask it before it is stored with {{scrubRules}}, and read the {{guide}} for everything else."
            slots={{
              scrubRules: (
                <Link
                  to={scrubRulesRoute}
                  className="font-medium text-indigo-600 hover:text-indigo-700"
                >
                  {translator.translateText("scrub rules")}
                </Link>
              ),
              guide: (
                <a
                  href={llmConnectionDocsUrl(LLM_DOCS_PATH).toString()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-indigo-600 hover:text-indigo-700"
                >
                  {translator.translateText("AI observability guide")}
                </a>
              ),
            }}
          />
        </div>
      </details>
    </div>
  );
};

export default LlmAppsPath;
