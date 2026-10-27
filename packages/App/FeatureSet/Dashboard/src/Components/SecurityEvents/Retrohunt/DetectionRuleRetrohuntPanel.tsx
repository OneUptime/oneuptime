import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import {
  CANDIDATE_LIMIT,
  EVENTS_COLUMN,
  FIRED_FOR_COLUMN,
  LAST_FIRED_COLUMN,
  NOISY,
  ONLY_TOP_LISTED,
  PERIOD_LABEL,
  RETROHUNT_TEST_IDS,
  RULE_CHANGED,
  RUNNING,
  RUN_AGAIN,
  SHOW_ALL,
  TIMES_COLUMN,
} from "./RetrohuntCopy";
import {
  RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  RetrohuntSentence,
  getRetrohuntExceptionLines,
  getRetrohuntFacts,
  getRetrohuntGroupLabel,
  getRetrohuntHeadline,
  getRetrohuntPeriodOptions,
  getRetrohuntVisibleGroups,
  isPluralSentence,
  isSameRetrohuntRule,
} from "./RetrohuntModel";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { getSecurityEntityIcon } from "Common/Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY,
  DetectionRetrohuntGroup,
  DetectionRetrohuntResult,
  isDetectionRetrohuntNoisy,
} from "Common/Types/SecurityEvent/DetectionRetrohunt";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import InlineLoadingLine from "Common/UI/Components/Loader/InlineLoadingLine";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  /*
   * The request for a period (RetrohuntModel.buildRetrohuntRequest): read
   * each time a run starts, so a form's latest values are the ones run.
   */
  getRequest: (periodInHours: number) => JSONObject;
}

// One of the model's sentences, in the reader's language.
export function writeRetrohuntSentence(
  translator: Translator,
  sentence: RetrohuntSentence,
): string {
  const values: Record<string, string | number> = {};

  for (const key of Object.keys(sentence.values || {})) {
    const value: string | number = sentence.values![key]!;
    values[key] =
      typeof value === "number" ? translator.formatNumber(value) : value;
  }

  if (isPluralSentence(sentence)) {
    return translator.translatePlural(
      sentence.template,
      sentence.count || 0,
      values,
    );
  }

  return translator.translateTemplate(sentence.template as string, values);
}

/*
 * RUN ON PAST EVENTS: a detection rule run over the last day, week or
 * month of events, with its exceptions, to see what it would have found -
 * how often it would have fired, for whom, and what its exceptions kept
 * out (POST /detection-rule/retrohunt). Nothing is opened, sent or written.
 *
 * It runs as soon as it is shown, over the last 7 days, and again on
 * another period or on Run again; a form's rule that changes after a run
 * says so beside the answer. One quiet list of what it fired for, the ten
 * that fired most first.
 */
const DetectionRuleRetrohuntPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [periodInHours, setPeriodInHours] = useState<number>(
    RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<DetectionRetrohuntResult | null>(null);
  const [isShowingAll, setIsShowingAll] = useState<boolean>(false);
  const [ranRequest, setRanRequest] = useState<JSONObject | null>(null);

  // Only the latest run's answer is drawn: an older one that ends later is dropped.
  const runNumber: React.MutableRefObject<number> = useRef<number>(0);
  const getRequestRef: React.MutableRefObject<
    (periodInHours: number) => JSONObject
  > = useRef(props.getRequest);
  getRequestRef.current = props.getRequest;

  const run: (hours: number) => Promise<void> = useCallback(
    async (hours: number): Promise<void> => {
      runNumber.current += 1;
      const thisRun: number = runNumber.current;
      const request: JSONObject = getRequestRef.current(hours);

      setIsRunning(true);
      setError("");

      try {
        const answer: DetectionRetrohuntResult =
          await SecurityCaseApi.runDetectionRuleRetrohunt(request);

        if (thisRun !== runNumber.current) {
          return;
        }

        setResult(answer);
        setRanRequest(request);
        setIsShowingAll(false);
      } catch (err) {
        if (thisRun !== runNumber.current) {
          return;
        }

        setResult(null);
        setError(API.getFriendlyMessage(err));
      }

      setIsRunning(false);
    },
    [],
  );

  useEffect(() => {
    void run(periodInHours);
  }, [periodInHours]);

  const isStale: boolean = Boolean(
    result &&
      ranRequest &&
      !isRunning &&
      !isSameRetrohuntRule(ranRequest, props.getRequest(periodInHours)),
  );

  return (
    <div className="space-y-3" data-testid={RETROHUNT_TEST_IDS.panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterButtons
          options={getRetrohuntPeriodOptions()}
          selectedValue={`${periodInHours}`}
          onSelect={(value: string) => {
            setPeriodInHours(Number(value));
          }}
          ariaLabel={PERIOD_LABEL}
          dataTestId={RETROHUNT_TEST_IDS.period}
        />
        <button
          type="button"
          onClick={() => {
            void run(periodInHours);
          }}
          disabled={isRunning}
          data-testid={RETROHUNT_TEST_IDS.runAgain}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon icon={IconProp.Refresh} className="h-4 w-4 text-gray-400" />
          <span>{translator.translateText(RUN_AGAIN)}</span>
        </button>
      </div>

      {isRunning ? (
        <InlineLoadingLine
          text={RUNNING}
          dataTestId={RETROHUNT_TEST_IDS.running}
        />
      ) : (
        <></>
      )}

      {!isRunning && error ? (
        <p
          role="alert"
          className="break-words text-sm text-red-600"
          data-testid={RETROHUNT_TEST_IDS.error}
        >
          {error}
        </p>
      ) : (
        <></>
      )}

      {!isRunning && result ? (
        <RetrohuntAnswer
          result={result}
          isStale={isStale}
          isShowingAll={isShowingAll}
          onShowAll={() => {
            setIsShowingAll(true);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

interface AnswerProps {
  result: DetectionRetrohuntResult;
  isStale: boolean;
  isShowingAll: boolean;
  onShowAll: () => void;
}

const RetrohuntAnswer: FunctionComponent<AnswerProps> = (
  props: AnswerProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const result: DetectionRetrohuntResult = props.result;
  const facts: Array<string> = getRetrohuntFacts(result).map(
    (sentence: RetrohuntSentence): string => {
      return writeRetrohuntSentence(translator, sentence);
    },
  );
  const exceptionLines: Array<string> = getRetrohuntExceptionLines(result).map(
    (sentence: RetrohuntSentence): string => {
      return writeRetrohuntSentence(translator, sentence);
    },
  );
  const groups: Array<DetectionRetrohuntGroup> = getRetrohuntVisibleGroups(
    result.groups,
    props.isShowingAll,
  );
  const hiddenCount: number = result.groups.length - groups.length;

  return (
    <div className="space-y-3">
      <div aria-live="polite">
        <p
          className="text-base font-semibold text-gray-900"
          data-testid={RETROHUNT_TEST_IDS.summary}
        >
          {writeRetrohuntSentence(translator, getRetrohuntHeadline(result))}
        </p>
        <p
          className="mt-0.5 text-sm text-gray-500"
          data-testid={RETROHUNT_TEST_IDS.facts}
        >
          {facts.join(" · ")}
        </p>
      </div>

      {props.isStale ? (
        <p
          className="text-xs text-gray-500"
          data-testid={RETROHUNT_TEST_IDS.changed}
        >
          {translator.translateText(RULE_CHANGED)}
        </p>
      ) : (
        <></>
      )}

      {isDetectionRetrohuntNoisy(result) ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          data-testid={RETROHUNT_TEST_IDS.noisy}
        >
          <Icon
            icon={IconProp.Alert}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700"
          />
          <span>
            {translator.translateTemplate(NOISY, {
              count: translator.formatNumber(
                DETECTION_RETROHUNT_NOISY_FIRINGS_PER_DAY,
              ),
            })}
          </span>
        </div>
      ) : (
        <></>
      )}

      {exceptionLines.length > 0 ? (
        <p
          className="flex items-start gap-1.5 text-sm text-gray-700"
          data-testid={RETROHUNT_TEST_IDS.exceptions}
        >
          <Icon
            icon={IconProp.EyeSlash}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span>{exceptionLines.join(" ")}</span>
        </p>
      ) : (
        <></>
      )}

      {result.candidateLimit !== null ? (
        <p
          className="text-xs text-gray-500"
          data-testid={RETROHUNT_TEST_IDS.notice}
        >
          {translator.translateTemplate(CANDIDATE_LIMIT, {
            count: translator.formatNumber(result.candidateLimit),
          })}
        </p>
      ) : (
        <></>
      )}

      {groups.length > 0 ? (
        <RetrohuntGroups groups={groups} isCorrelation={result.isCorrelation} />
      ) : (
        <></>
      )}

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={props.onShowAll}
          data-testid={RETROHUNT_TEST_IDS.showAll}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {translator.translateTemplate(SHOW_ALL, {
            count: translator.formatNumber(result.groups.length),
          })}
        </button>
      ) : (
        <></>
      )}

      {result.hasMoreGroups && hiddenCount === 0 ? (
        <p className="text-xs text-gray-500">
          {translator.translateTemplate(ONLY_TOP_LISTED, {
            count: translator.formatNumber(result.groups.length),
          })}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

interface GroupsProps {
  groups: Array<DetectionRetrohuntGroup>;
  isCorrelation: boolean;
}

/*
 * What it fired for, the most first: the value (a user, a host, an
 * address) with how many times, behind how many events, and when last. A
 * correlation's row says what happened under its value instead.
 */
const RetrohuntGroups: FunctionComponent<GroupsProps> = (
  props: GroupsProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table
        className="min-w-full divide-y divide-gray-200 text-sm"
        data-testid={RETROHUNT_TEST_IDS.groups}
      >
        <thead className="bg-gray-50">
          <tr>
            <th
              scope="col"
              className="px-3 py-2 text-start text-xs font-medium text-gray-500"
            >
              {translator.translateText(FIRED_FOR_COLUMN)}
            </th>
            {props.isCorrelation ? (
              <></>
            ) : (
              <th
                scope="col"
                className="px-3 py-2 text-end text-xs font-medium text-gray-500"
              >
                {translator.translateText(TIMES_COLUMN)}
              </th>
            )}
            <th
              scope="col"
              className="px-3 py-2 text-end text-xs font-medium text-gray-500"
            >
              {translator.translateText(EVENTS_COLUMN)}
            </th>
            {props.isCorrelation ? (
              <></>
            ) : (
              <th
                scope="col"
                className="px-3 py-2 text-start text-xs font-medium text-gray-500 max-sm:hidden"
              >
                {translator.translateText(LAST_FIRED_COLUMN)}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {props.groups.map(
            (group: DetectionRetrohuntGroup, index: number): ReactElement => {
              const label: { text: string; isKey: boolean } =
                getRetrohuntGroupLabel(group);

              return (
                <tr key={index} data-testid={RETROHUNT_TEST_IDS.group}>
                  <td className="max-w-[18rem] px-3 py-2 align-top">
                    <div className="flex min-w-0 items-start gap-1.5">
                      {group.entityType ? (
                        <Icon
                          icon={getSecurityEntityIcon(group.entityType)}
                          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                        />
                      ) : (
                        <></>
                      )}
                      <div className="min-w-0">
                        {label.isKey ? (
                          <span className="text-gray-700">
                            {translator.translateText(label.text)}
                          </span>
                        ) : (
                          <span className="block break-all font-mono text-gray-900">
                            <IsolatedText text={label.text} />
                          </span>
                        )}
                        {props.isCorrelation && group.summary ? (
                          <span className="block text-xs text-gray-500">
                            {group.summary}
                          </span>
                        ) : (
                          <></>
                        )}
                      </div>
                    </div>
                  </td>
                  {props.isCorrelation ? (
                    <></>
                  ) : (
                    <td className="whitespace-nowrap px-3 py-2 text-end align-top tabular-nums text-gray-900">
                      {translator.formatNumber(group.firedCount)}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-end align-top tabular-nums text-gray-700">
                    {translator.formatNumber(group.eventCount)}
                  </td>
                  {props.isCorrelation ? (
                    <></>
                  ) : (
                    <td
                      className="whitespace-nowrap px-3 py-2 align-top text-gray-500 max-sm:hidden"
                      title={
                        group.lastFiredAt
                          ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                              group.lastFiredAt,
                            )
                          : undefined
                      }
                    >
                      {group.lastFiredAt
                        ? OneUptimeDate.fromNow(group.lastFiredAt)
                        : "-"}
                    </td>
                  )}
                </tr>
              );
            },
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DetectionRuleRetrohuntPanel;
