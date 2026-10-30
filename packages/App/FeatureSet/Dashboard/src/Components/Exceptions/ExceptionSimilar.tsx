import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DuplicateVerdict,
  DuplicateVerdictKind,
  readDuplicateVerdicts,
  readSimilarExceptions,
  SimilarException,
  SimilarExceptionReason,
} from "Common/Types/Telemetry/SimilarExceptions";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import AppLink from "../AppLink/AppLink";
import { mergeExceptionInto } from "../../Utils/ExceptionMerge";

/*
 * OTHER EXCEPTIONS THAT LOOK LIKE THIS ONE, ON ITS OVERVIEW.
 *
 * One root cause can land in several exception groups. This card lists the
 * few that look most like this one - the same message once the values are
 * out, the same function of your code, or most of the same words
 * (SimilarExceptionsReader) - each a link, with its status, and shows only
 * when there are some. Check with OneUptime AI asks which of them are the
 * same bug (ExceptionDuplicateChecker); not offered while AI is off. The
 * model's words are plain text. One it calls "Likely the same bug", in the
 * same service, can be merged into this exception (TelemetryExceptionMerge)
 * by someone who may edit exceptions, after a confirmation.
 */

export const SIMILAR_ROUTE_PREFIX: string = "/telemetry-exception/similar";
export const SIMILAR_AI_CHECK_ROUTE_PREFIX: string =
  "/telemetry-exception/similar-ai-check";

const REASON_LABELS: Record<SimilarExceptionReason, string> = {
  [SimilarExceptionReason.SameMessage]: translationKey("Same message"),
  [SimilarExceptionReason.SameCodeLocation]:
    translationKey("Same code location"),
  [SimilarExceptionReason.SimilarMessage]: translationKey("Similar message"),
};

const VERDICT_LABELS: Record<DuplicateVerdictKind, string> = {
  [DuplicateVerdictKind.Duplicate]: translationKey("Likely the same bug"),
  [DuplicateVerdictKind.Related]: translationKey("A related bug"),
  [DuplicateVerdictKind.Different]: translationKey("A different bug"),
};

const VERDICT_CLASSES: Record<DuplicateVerdictKind, string> = {
  [DuplicateVerdictKind.Duplicate]: "bg-rose-50 text-rose-700 ring-rose-600/20",
  [DuplicateVerdictKind.Related]:
    "bg-amber-50 text-amber-800 ring-amber-600/20",
  [DuplicateVerdictKind.Different]: "bg-gray-50 text-gray-600 ring-gray-500/20",
};

export interface ComponentProps {
  telemetryExceptionId: ObjectID;
  /*
   * Whether a duplicate may be merged into this exception: the reader may
   * edit exceptions, and this one was not merged into another itself.
   */
  canMerge?: boolean | undefined;
  // Called once one was merged in, so the page reads itself again.
  onMerged?: (() => void) | undefined;
}

function exceptionRoute(telemetryExceptionId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
    { modelId: telemetryExceptionId },
  );
}

const ExceptionSimilar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const exceptionId: string = props.telemetryExceptionId.toString();
  const [similar, setSimilar] = useState<Array<SimilarException>>([]);
  const [verdicts, setVerdicts] = useState<Array<DuplicateVerdict> | null>(
    null,
  );
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // The duplicate a merge is being confirmed for.
  const [mergeCandidate, setMergeCandidate] = useState<
    SimilarException | undefined
  >(undefined);
  const [isMerging, setIsMerging] = useState<boolean>(false);
  const [mergeError, setMergeError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let isCurrent: boolean = true;

    setSimilar([]);
    setVerdicts(null);
    setError(undefined);

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `${SIMILAR_ROUTE_PREFIX}/${exceptionId}`,
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (isCurrent) {
          setSimilar(
            readSimilarExceptions((response.data as JSONObject)["similar"]),
          );
        }
      } catch {
        // Quiet: without similar exceptions the card is simply not shown.
        if (isCurrent) {
          setSimilar([]);
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [exceptionId]);

  if (similar.length === 0) {
    return <></>;
  }

  const check: () => Promise<void> = async (): Promise<void> => {
    setIsChecking(true);
    setError(undefined);

    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `${SIMILAR_AI_CHECK_ROUTE_PREFIX}/${exceptionId}`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const nextSimilar: Array<SimilarException> = readSimilarExceptions(
        data["similar"],
      );

      if (nextSimilar.length > 0) {
        setSimilar(nextSimilar);
      }

      setVerdicts(readDuplicateVerdicts(data["verdicts"]));
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsChecking(false);
  };

  const merge: (candidate: SimilarException) => Promise<void> = async (
    candidate: SimilarException,
  ): Promise<void> => {
    setIsMerging(true);
    setMergeError(undefined);

    try {
      await mergeExceptionInto({
        survivorId: exceptionId,
        mergedId: candidate.telemetryExceptionId,
      });

      setSimilar(
        similar.filter((entry: SimilarException): boolean => {
          return entry.telemetryExceptionId !== candidate.telemetryExceptionId;
        }),
      );
      setMergeCandidate(undefined);
      props.onMerged?.();
    } catch (err) {
      setMergeError(API.getFriendlyMessage(err));
    }

    setIsMerging(false);
  };

  const verdictFor: (id: string) => DuplicateVerdict | undefined = (
    id: string,
  ): DuplicateVerdict | undefined => {
    return (verdicts || []).find((verdict: DuplicateVerdict): boolean => {
      return verdict.telemetryExceptionId === id;
    });
  };

  const checkButton: ReactElement = isAiOffered ? (
    <Button
      title={
        isChecking
          ? translationKey("Checking…")
          : verdicts
            ? translationKey("Check again")
            : translationKey("Check with OneUptime AI")
      }
      icon={IconProp.Sparkles}
      buttonStyle={ButtonStyleType.NORMAL}
      buttonSize={ButtonSize.Small}
      isLoading={isChecking}
      disabled={isChecking}
      dataTestId="exception-similar-ai-check"
      onClick={() => {
        void check();
      }}
    />
  ) : (
    <></>
  );

  return (
    <Card
      title="Similar exceptions"
      description="Other exceptions that look like this one: the same message once the values are taken out, the same function of your code, or most of the same words."
      rightElement={checkButton}
    >
      <div data-testid="exception-similar">
        {error ? (
          <p
            className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
            data-testid="exception-similar-error"
          >
            {error}
          </p>
        ) : (
          <></>
        )}
        <ul className="-mx-2 divide-y divide-gray-100">
          {similar.map((entry: SimilarException): ReactElement => {
            const verdict: DuplicateVerdict | undefined = verdictFor(
              entry.telemetryExceptionId,
            );
            const isMergeable: boolean =
              Boolean(props.canMerge) &&
              entry.isSameService === true &&
              verdict?.verdict === DuplicateVerdictKind.Duplicate;

            return (
              <li
                key={entry.telemetryExceptionId}
                className="flex items-center gap-2"
              >
                <AppLink
                  className="group block min-w-0 flex-1 rounded-lg px-2 py-2 hover:bg-gray-50"
                  to={exceptionRoute(entry.telemetryExceptionId)}
                  dataTestId="exception-similar-item"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    {entry.exceptionType ? (
                      <span className="truncate font-mono text-xs text-gray-700">
                        {entry.exceptionType}
                      </span>
                    ) : (
                      <></>
                    )}
                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
                      {translator.translateText(REASON_LABELS[entry.reason])}
                    </span>
                    {entry.isArchived || entry.isResolved ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                        {translator.translateText(
                          entry.isArchived ? "Archived" : "Resolved",
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                    {verdict ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${VERDICT_CLASSES[verdict.verdict]}`}
                        data-testid="exception-similar-verdict"
                      >
                        {translator.translateText(
                          VERDICT_LABELS[verdict.verdict],
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                    <span className="ml-auto text-xs tabular-nums text-gray-500">
                      {translator.translatePlural(
                        {
                          one: "{{count}} occurrence",
                          other: "{{count}} occurrences",
                        },
                        entry.occurrenceCount,
                      )}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-gray-800">
                    {entry.message || entry.exceptionType}
                  </span>
                  {verdict && verdict.reason ? (
                    <span
                      className="mt-0.5 block text-xs text-gray-500"
                      data-testid="exception-similar-verdict-reason"
                    >
                      {verdict.reason}
                    </span>
                  ) : (
                    <></>
                  )}
                </AppLink>
                {isMergeable ? (
                  <div className="flex-shrink-0 pr-2">
                    <Button
                      title="Merge"
                      icon={IconProp.Link}
                      buttonStyle={ButtonStyleType.NORMAL}
                      buttonSize={ButtonSize.Small}
                      dataTestId="exception-similar-merge"
                      onClick={() => {
                        setMergeError(undefined);
                        setMergeCandidate(entry);
                      }}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {mergeCandidate ? (
        <ConfirmModal
          title="Merge into this exception?"
          description={translator.translateTemplate(
            "{{name}} becomes part of this exception: its occurrences, those so far and every new one, count here, and it leaves the list. You can unmerge it from its page.",
            {
              name: mergeCandidate.message
                ? `${mergeCandidate.exceptionType}: ${mergeCandidate.message}`
                : mergeCandidate.exceptionType,
            },
          )}
          submitButtonText="Merge"
          isLoading={isMerging}
          error={mergeError}
          onClose={() => {
            setMergeCandidate(undefined);
          }}
          onSubmit={() => {
            void merge(mergeCandidate);
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default ExceptionSimilar;
