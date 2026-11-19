import WhoIsToldApi, {
  WhoIsToldDraftInput,
} from "../../Monitor/Overview/WhoIsToldApi";
import {
  getWhoIsToldCriteriaSentences,
  getWhoIsToldStatusValue,
} from "../../Monitor/Overview/WhoIsToldWords";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "Common/Types/Monitor/MonitorEvaluationSummary";
import {
  WhoIsToldCriteria,
  WhoIsToldResult,
} from "Common/Types/Monitor/WhoIsTold";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT A TEST MONITOR RESULT WOULD SET OFF (#7074): which criteria the
 * answer matched, and what follows from it - the status, the incident or
 * alert and its severity, and who is told - in the words the monitor's
 * "When this goes down" card says them in (WhoIsToldWords), worked out by
 * the same resolver, for the criteria as the test ran them.
 *
 * The server judges the answer by the criteria as it records it
 * (MonitorTestEvaluation); what the reader may not read of who is told -
 * a policy, a rule, a private incident that is not theirs - the resolver
 * has already left out for them. A result kept before answers were judged
 * says nothing here: the check's details below stand alone, as they did.
 */

export const MONITOR_TEST_VERDICT_WORDS: Readonly<{
  matches: string;
  matchesUnnamed: string;
  matchesNone: string;
  defaultStatus: string;
  defaultStatusUnnamed: string;
  changesNothing: string;
  whoIsToldFailed: string;
}> = {
  matches: translationKey("This result matches {{criteria}}."),
  matchesUnnamed: translationKey("This result matches a criteria."),
  matchesNone: translationKey("This result matches no criteria."),
  defaultStatus: translationKey(
    "The monitor shows its default status, {{status}}, and nothing opens.",
  ),
  defaultStatusUnnamed: translationKey(
    "The monitor shows its default status, and nothing opens.",
  ),
  changesNothing: translationKey("It changes no status and opens nothing."),
  // The card's own sentence, so a failure reads the same everywhere.
  whoIsToldFailed: translationKey("Couldn't work out who is told. {{error}}"),
};

/*
 * How a test's criteria judged it: the criteria that matched - the first
 * met, in the order they are checked, as the monitor acts on it - null when
 * none did, and undefined when no step of the result was judged (a result
 * from before answers were, or one that could not be).
 */
export interface MonitorTestJudgement {
  matched: MonitorEvaluationCriteriaResult | null;
}

export function getMonitorTestJudgement(
  responses: ReadonlyArray<ProbeMonitorResponse | null | undefined>,
): MonitorTestJudgement | undefined {
  const summaries: Array<MonitorEvaluationSummary> = responses
    .map(
      (
        response: ProbeMonitorResponse | null | undefined,
      ): MonitorEvaluationSummary | undefined => {
        return response?.evaluationSummary;
      },
    )
    .filter(
      (
        summary: MonitorEvaluationSummary | undefined,
      ): summary is MonitorEvaluationSummary => {
        return Boolean(summary && Array.isArray(summary.criteriaResults));
      },
    );

  if (summaries.length === 0) {
    return undefined;
  }

  for (const summary of summaries) {
    const matched: MonitorEvaluationCriteriaResult | undefined =
      summary.criteriaResults.find(
        (result: MonitorEvaluationCriteriaResult): boolean => {
          return result.met === true && !result.skipped;
        },
      );

    if (matched) {
      return { matched: matched };
    }
  }

  return { matched: null };
}

export interface ComponentProps {
  probeMonitorResponses: Array<ProbeMonitorResponse>;
  // The monitor the test ran, as who is told reads it: its steps as tested.
  draft: WhoIsToldDraftInput;
}

type FollowState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; sentences: Array<string> };

const MonitorTestVerdict: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const judgement: MonitorTestJudgement | undefined = getMonitorTestJudgement(
    props.probeMonitorResponses,
  );
  const matchedId: string = judgement?.matched?.criteriaId || "";
  const isJudged: boolean = Boolean(judgement);
  const isMatched: boolean = Boolean(judgement?.matched);

  const [follow, setFollow] = useState<FollowState>({ status: "loading" });

  useEffect(() => {
    if (!isJudged) {
      return;
    }

    let isActive: boolean = true;

    setFollow({ status: "loading" });

    const work: Promise<Array<string>> = isMatched
      ? WhoIsToldApi.getForDraft({ draft: props.draft }).then(
          (result: WhoIsToldResult): Array<string> => {
            const criteria: WhoIsToldCriteria | undefined =
              result.criteria.find((item: WhoIsToldCriteria): boolean => {
                return Boolean(matchedId) && item.id === matchedId;
              });

            const sentences: Array<string> = criteria
              ? getWhoIsToldCriteriaSentences(criteria, translator)
              : [];

            /*
             * The resolver leaves out a criteria that sets no status and
             * opens nothing: it sets nothing off.
             */
            return sentences.length > 0
              ? sentences
              : [
                  translator.translateText(
                    MONITOR_TEST_VERDICT_WORDS.changesNothing,
                  ) || "",
                ];
          },
        )
      : getDefaultStatusSentence({
          monitorStatusId:
            props.draft.monitorSteps.data?.defaultMonitorStatusId,
          translator: translator,
        }).then((sentence: string): Array<string> => {
          return [sentence];
        });

    work
      .then((sentences: Array<string>) => {
        if (isActive) {
          setFollow({ status: "loaded", sentences: sentences });
        }
      })
      .catch((err: unknown) => {
        if (isActive) {
          setFollow({
            status: "error",
            message:
              err instanceof Error
                ? err.message
                : API.getFriendlyMessage(err as Error),
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [isJudged, isMatched, matchedId, translator.language]);

  if (!judgement) {
    return <></>;
  }

  const getFollow: () => ReactElement = (): ReactElement => {
    if (follow.status === "loading") {
      return (
        <div
          role="status"
          aria-label={translator.translateText("Loading who is told")}
          className="mt-2 space-y-2 animate-pulse"
          data-testid="monitor-test-verdict-loading"
        >
          <div className="h-3 w-5/6 rounded bg-gray-100"></div>
          <div className="h-3 w-2/3 rounded bg-gray-100"></div>
        </div>
      );
    }

    if (follow.status === "error") {
      return (
        <p
          className="mt-1 text-sm text-gray-600"
          data-testid="monitor-test-verdict-error"
        >
          <ErrorSentence
            template={MONITOR_TEST_VERDICT_WORDS.whoIsToldFailed}
            error={follow.message}
          />
        </p>
      );
    }

    return (
      <p
        className="mt-1 text-sm text-gray-700"
        data-testid="monitor-test-verdict-follows"
      >
        {joinSentences(follow.sentences)}
      </p>
    );
  };

  return (
    <section
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid="monitor-test-verdict"
      data-matched={judgement.matched ? "true" : "false"}
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={IconProp.Criteria}
          className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600"
        />
        <div className="min-w-0 flex-1">
          <h3
            className="text-sm font-semibold text-gray-900 break-words"
            data-testid="monitor-test-verdict-criteria"
          >
            {judgement.matched?.criteriaName ? (
              <TranslatedSentence
                template={MONITOR_TEST_VERDICT_WORDS.matches}
                slots={{
                  criteria: (
                    // A criteria's name is its owner's, drawn as written.
                    <span dir="auto">{judgement.matched.criteriaName}</span>
                  ),
                }}
              />
            ) : (
              translator.translateText(
                judgement.matched
                  ? MONITOR_TEST_VERDICT_WORDS.matchesUnnamed
                  : MONITOR_TEST_VERDICT_WORDS.matchesNone,
              )
            )}
          </h3>
          {getFollow()}
        </div>
      </div>
    </section>
  );
};

/*
 * What follows an answer no criteria matches: the monitor shows its default
 * status - by name, read by its list (a new project's "Operational" in the
 * reader's words) - and nothing opens. A status that cannot be read is not
 * named.
 */
async function getDefaultStatusSentence(data: {
  monitorStatusId: ObjectID | undefined;
  translator: Translator;
}): Promise<string> {
  let name: string = "";

  if (data.monitorStatusId) {
    try {
      const status: MonitorStatus | null = await ModelAPI.getItem({
        modelType: MonitorStatus,
        id: new ObjectID(data.monitorStatusId.toString()),
        select: { name: true },
      });

      name = status?.name?.toString() || "";
    } catch {
      name = "";
    }
  }

  if (!name) {
    return (
      data.translator.translateText(
        MONITOR_TEST_VERDICT_WORDS.defaultStatusUnnamed,
      ) || ""
    );
  }

  return data.translator.translateTemplate(
    MONITOR_TEST_VERDICT_WORDS.defaultStatus,
    { status: getWhoIsToldStatusValue(name) },
    // A Latin name stays in order on a right-to-left page.
    { setsValuesApart: true },
  );
}

export default MonitorTestVerdict;
