import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExceptionAIExplanation as ExceptionAIExplanationValue,
  ExceptionExplanationCategory,
  ExceptionExplanationConfidence,
  ExceptionExplanationFrame,
  readExceptionAIExplanation,
} from "Common/Types/Telemetry/ExceptionAIExplanation";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import { openAskAi } from "../AIChat/AskAiEvents";

/*
 * WHAT HAPPENED, ON THE EXCEPTION'S OVERVIEW.
 *
 * OneUptime AI's explanation of the exception - what went wrong, the likely
 * root cause and a suggested fix - at the top of the page a person opens to
 * triage it, written on request from the stack trace, the trace and logs of
 * the latest occurrence and the deploys around it (ExceptionExplainer). It
 * is kept on the exception, so the next person reads it at once. From it,
 * one click opens a fix pull request (the exception's AI Assistance page,
 * whose readiness checks it shares) or asks OneUptime AI a follow-up.
 *
 * Not offered while the project's AI is off (useAiOffered).
 */

export const EXPLAIN_ROUTE_PREFIX: string = "/telemetry-exception/ai-explanation";

const CONFIDENCE_LABELS: Record<ExceptionExplanationConfidence, string> = {
  [ExceptionExplanationConfidence.High]: translationKey("High confidence"),
  [ExceptionExplanationConfidence.Medium]: translationKey("Medium confidence"),
  [ExceptionExplanationConfidence.Low]: translationKey("Low confidence"),
};

const CONFIDENCE_CLASSES: Record<ExceptionExplanationConfidence, string> = {
  [ExceptionExplanationConfidence.High]:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  [ExceptionExplanationConfidence.Medium]:
    "bg-amber-50 text-amber-700 ring-amber-600/20",
  [ExceptionExplanationConfidence.Low]:
    "bg-gray-50 text-gray-600 ring-gray-500/20",
};

const CATEGORY_LABELS: Record<ExceptionExplanationCategory, string> = {
  [ExceptionExplanationCategory.Code]: translationKey("In the code"),
  [ExceptionExplanationCategory.Dependency]: translationKey("In a dependency"),
  [ExceptionExplanationCategory.Infrastructure]:
    translationKey("In the infrastructure"),
  [ExceptionExplanationCategory.UserInput]: translationKey("Bad input"),
  [ExceptionExplanationCategory.Configuration]:
    translationKey("In the configuration"),
  [ExceptionExplanationCategory.Unknown]: translationKey("Cause unclear"),
};

// "src/cart.ts:42 in checkout", as the stack trace names the frame.
export function formatSuspectFrame(frame: ExceptionExplanationFrame): string {
  return `${frame.file}${frame.line ? `:${frame.line}` : ""}${
    frame.function ? ` in ${frame.function}` : ""
  }`;
}

/*
 * The question Ask AI opens with: about this exception (the page it is on
 * tells Ask AI which one), picking up where the explanation left off.
 */
export function getFollowUpPrompt(
  explanation: ExceptionAIExplanationValue,
): string {
  return `About this exception: ${explanation.summary} What else should I check to confirm the root cause, and is the suggested fix safe to ship?`;
}

export interface ComponentProps {
  telemetryExceptionId: ObjectID;
  // What the exception holds already: the explanation and when it was written.
  aiExplanation?: unknown;
  aiExplanationGeneratedAt?: Date | undefined;
}

const ExceptionAIExplanation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();

  const [explanation, setExplanation] =
    useState<ExceptionAIExplanationValue | null>(
      readExceptionAIExplanation(props.aiExplanation),
    );
  const [generatedAt, setGeneratedAt] = useState<Date | undefined>(
    props.aiExplanationGeneratedAt,
  );
  const [isExplaining, setIsExplaining] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (!isAiOffered) {
    return <></>;
  }

  const explain: () => Promise<void> = async (): Promise<void> => {
    setIsExplaining(true);
    setError(undefined);

    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `${EXPLAIN_ROUTE_PREFIX}/${props.telemetryExceptionId.toString()}`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const next: ExceptionAIExplanationValue | null =
        readExceptionAIExplanation(data["explanation"]);

      if (!next) {
        throw new Error(
          translator.translateText(
            "OneUptime AI did not return an explanation. Please try again.",
          ) as string,
        );
      }

      setExplanation(next);
      setGeneratedAt(
        data["generatedAt"]
          ? new Date(data["generatedAt"] as string)
          : OneUptimeDate.getCurrentDate(),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsExplaining(false);
  };

  const openFixPage: () => void = (): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_VIEW_AI_ASSISTANCE] as Route,
        { modelId: props.telemetryExceptionId },
      ),
    );
  };

  const errorNote: ReactElement = error ? (
    <p
      className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
      role="alert"
      data-testid="exception-ai-explanation-error"
    >
      {error}
    </p>
  ) : (
    <></>
  );

  if (!explanation) {
    return (
      <Card
        title="What happened"
        description="OneUptime AI reads the stack trace, the trace and logs of the latest occurrence, and recent deploys, and explains what went wrong and how to fix it."
      >
        <div data-testid="exception-ai-explanation-empty">
          <Button
            title={
              isExplaining ? "Explaining…" : "Explain with OneUptime AI"
            }
            icon={IconProp.Sparkles}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            isLoading={isExplaining}
            disabled={isExplaining}
            dataTestId="exception-ai-explain"
            onClick={() => {
              void explain();
            }}
          />
          {isExplaining ? (
            <p className="mt-3 text-xs text-gray-500">
              {translator.translateText(
                "This can take up to a minute.",
              )}
            </p>
          ) : (
            <></>
          )}
          {errorNote}
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="What happened"
      description={
        generatedAt
          ? translator.translateTemplate("Written by OneUptime AI {{time}}.", {
              time: OneUptimeDate.fromNow(new Date(generatedAt)),
            })
          : translator.translateText("Written by OneUptime AI.")
      }
    >
      <div className="space-y-4" data-testid="exception-ai-explanation">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${CONFIDENCE_CLASSES[explanation.confidence]}`}
            data-testid="exception-ai-explanation-confidence"
          >
            <Icon icon={IconProp.Sparkles} className="h-3 w-3" />
            {translator.translateText(CONFIDENCE_LABELS[explanation.confidence])}
          </span>
          <span
            className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/15"
            data-testid="exception-ai-explanation-category"
          >
            {translator.translateText(CATEGORY_LABELS[explanation.category])}
          </span>
        </div>

        <p
          className="text-sm font-medium leading-6 text-gray-900"
          data-testid="exception-ai-explanation-summary"
        >
          {explanation.summary}
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {explanation.rootCause ? (
            <section data-testid="exception-ai-explanation-root-cause">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {translator.translateText("Likely root cause")}
              </h3>
              <div className="mt-1 text-sm text-gray-700">
                <LazyMarkdownViewer text={explanation.rootCause} />
              </div>
            </section>
          ) : (
            <></>
          )}
          {explanation.suggestedFix ? (
            <section data-testid="exception-ai-explanation-fix">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {translator.translateText("Suggested fix")}
              </h3>
              <div className="mt-1 text-sm text-gray-700">
                <LazyMarkdownViewer text={explanation.suggestedFix} />
              </div>
            </section>
          ) : (
            <></>
          )}
        </div>

        {explanation.suspectFrames.length > 0 ? (
          <section data-testid="exception-ai-explanation-frames">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translator.translateText("Where to look")}
            </h3>
            <ul className="mt-1 space-y-0.5">
              {explanation.suspectFrames.map(
                (frame: ExceptionExplanationFrame, index: number): ReactElement => {
                  return (
                    <li
                      key={`${frame.file}-${index}`}
                      className="break-all font-mono text-xs text-gray-700"
                    >
                      {formatSuspectFrame(frame)}
                    </li>
                  );
                },
              )}
            </ul>
          </section>
        ) : (
          <></>
        )}

        {explanation.nextSteps.length > 0 ? (
          <section data-testid="exception-ai-explanation-next-steps">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translator.translateText("Next steps")}
            </h3>
            <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-sm text-gray-700">
              {explanation.nextSteps.map(
                (step: string, index: number): ReactElement => {
                  return <li key={index}>{step}</li>;
                },
              )}
            </ol>
          </section>
        ) : (
          <></>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 [&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
          <Button
            title="Open a fix pull request"
            icon={IconProp.Code}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            dataTestId="exception-ai-explanation-fix-pr"
            onClick={openFixPage}
          />
          <Button
            title="Ask a follow-up"
            icon={IconProp.Chat}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="exception-ai-explanation-ask"
            onClick={() => {
              openAskAi({ prompt: getFollowUpPrompt(explanation) });
            }}
          />
          <Button
            title={isExplaining ? "Explaining…" : "Explain again"}
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            isLoading={isExplaining}
            disabled={isExplaining}
            dataTestId="exception-ai-explanation-regenerate"
            onClick={() => {
              void explain();
            }}
          />
        </div>
        {errorNote}
      </div>
    </Card>
  );
};

export default ExceptionAIExplanation;
