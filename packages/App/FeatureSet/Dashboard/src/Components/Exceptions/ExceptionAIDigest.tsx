import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  EXCEPTION_DIGEST_WINDOW_HOURS,
  ExceptionAIDigest as ExceptionAIDigestValue,
  ExceptionDigestItem,
  ExceptionDigestKind,
  ExceptionDigestPriority,
  readExceptionAIDigest,
} from "Common/Types/Telemetry/ExceptionAIDigest";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import AppLink from "../AppLink/AppLink";

/*
 * WHAT IS NEW, ON EXCEPTIONS' INSIGHTS.
 *
 * One click asks OneUptime AI to sum up the exceptions first seen in the
 * last day and the ones that came back after they were resolved: a
 * headline, then each of them in one line, the most urgent first, each a
 * link to the exception (ExceptionDigester). Written on request and not
 * kept. With nothing new, it says so and no credit is spent.
 *
 * Not offered while the project's AI is off (useAiOffered). The model's
 * words are shown as plain text: nothing in them can link or load.
 */

export const DIGEST_ROUTE: string = "/telemetry-exception/ai-digest";

const KIND_LABELS: Record<ExceptionDigestKind, string> = {
  [ExceptionDigestKind.New]: translationKey("New"),
  [ExceptionDigestKind.Regressed]: translationKey("Regressed"),
};

const KIND_CLASSES: Record<ExceptionDigestKind, string> = {
  [ExceptionDigestKind.New]: "bg-sky-50 text-sky-700 ring-sky-600/20",
  [ExceptionDigestKind.Regressed]:
    "bg-amber-50 text-amber-800 ring-amber-600/20",
};

const PRIORITY_LABELS: Record<ExceptionDigestPriority, string> = {
  [ExceptionDigestPriority.High]: translationKey("High priority"),
  [ExceptionDigestPriority.Medium]: translationKey("Medium priority"),
  [ExceptionDigestPriority.Low]: translationKey("Low priority"),
};

const PRIORITY_DOTS: Record<ExceptionDigestPriority, string> = {
  [ExceptionDigestPriority.High]: "bg-rose-500",
  [ExceptionDigestPriority.Medium]: "bg-amber-400",
  [ExceptionDigestPriority.Low]: "bg-gray-300",
};

interface DigestState {
  digest: ExceptionAIDigestValue | null;
  generatedAt: Date;
}

export function getExceptionRoute(telemetryExceptionId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
    { modelId: telemetryExceptionId },
  );
}

const ExceptionAIDigest: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const [state, setState] = useState<DigestState | undefined>(undefined);
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (!isAiOffered) {
    return <></>;
  }

  const summarize: () => Promise<void> = async (): Promise<void> => {
    setIsSummarizing(true);
    setError(undefined);

    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(DIGEST_ROUTE),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const digest: ExceptionAIDigestValue | null = readExceptionAIDigest(
        data["digest"],
      );

      if (!digest && Number(data["exceptionCount"] || 0) > 0) {
        throw new Error(
          translator.translateText(
            "OneUptime AI did not return a summary. Please try again.",
          ) as string,
        );
      }

      setState({
        digest,
        generatedAt: data["generatedAt"]
          ? new Date(data["generatedAt"] as string)
          : OneUptimeDate.getCurrentDate(),
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSummarizing(false);
  };

  const summarizeButton: ReactElement = (
    <Button
      title={
        isSummarizing
          ? "Summarizing…"
          : state
            ? "Summarize again"
            : "Summarize with OneUptime AI"
      }
      icon={IconProp.Sparkles}
      buttonStyle={state ? ButtonStyleType.NORMAL : ButtonStyleType.PRIMARY}
      buttonSize={ButtonSize.Small}
      isLoading={isSummarizing}
      disabled={isSummarizing}
      dataTestId="exception-ai-digest-summarize"
      onClick={() => {
        void summarize();
      }}
    />
  );

  const renderItem: (item: ExceptionDigestItem) => ReactElement = (
    item: ExceptionDigestItem,
  ): ReactElement => {
    return (
      <li key={item.telemetryExceptionId}>
        <AppLink
          className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-gray-50"
          to={getExceptionRoute(item.telemetryExceptionId)}
          dataTestId="exception-ai-digest-item"
        >
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOTS[item.priority]}`}
            title={translator.translateText(PRIORITY_LABELS[item.priority])}
            aria-label={translator.translateText(
              PRIORITY_LABELS[item.priority],
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${KIND_CLASSES[item.kind]}`}
              >
                {translator.translateText(KIND_LABELS[item.kind])}
              </span>
              {item.exceptionType ? (
                <span className="truncate font-mono text-xs text-gray-600">
                  {item.exceptionType}
                </span>
              ) : (
                <></>
              )}
            </span>
            <span className="mt-0.5 block text-sm text-gray-800 group-hover:text-gray-900">
              {item.summary}
            </span>
          </span>
        </AppLink>
      </li>
    );
  };

  return (
    <div className="mb-6" data-testid="exception-ai-digest">
      <Card
        title="What's new"
        description={
          state
            ? translator.translateTemplate(
                "Written by OneUptime AI {{time}}, from the exceptions first seen or back in the last {{hours}} hours.",
                {
                  time: OneUptimeDate.fromNow(new Date(state.generatedAt)),
                  hours: EXCEPTION_DIGEST_WINDOW_HOURS,
                },
              )
            : translator.translateTemplate(
                "OneUptime AI sums up the exceptions first seen in the last {{hours}} hours, and the ones that came back after they were resolved, and says which to look at first.",
                { hours: EXCEPTION_DIGEST_WINDOW_HOURS },
              )
        }
        rightElement={summarizeButton}
      >
        {isSummarizing ? (
          <p className="text-xs text-gray-500">
            {translator.translateText("This can take up to a minute.")}
          </p>
        ) : (
          <></>
        )}
        {error ? (
          <p
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
            data-testid="exception-ai-digest-error"
          >
            {error}
          </p>
        ) : (
          <></>
        )}
        {state && !state.digest ? (
          <p
            className="text-sm text-gray-600"
            data-testid="exception-ai-digest-nothing-new"
          >
            {translator.translateTemplate(
              "No exceptions were first seen or came back in the last {{hours}} hours.",
              { hours: EXCEPTION_DIGEST_WINDOW_HOURS },
            )}
          </p>
        ) : (
          <></>
        )}
        {state && state.digest ? (
          <div className="space-y-3">
            <p
              className="text-sm leading-6 text-gray-800"
              data-testid="exception-ai-digest-headline"
            >
              {state.digest.headline}
            </p>
            <ul className="-mx-2 divide-y divide-gray-100">
              {state.digest.items.map(renderItem)}
            </ul>
          </div>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default ExceptionAIDigest;
