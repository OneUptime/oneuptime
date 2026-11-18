import { fetchAskAiRatings, getAskAiSourceTitle } from "./AskAiRatingsData";
import {
  ASK_AI_RATINGS_DAYS,
  AskAiProjectRatings,
  AskAiSourceCount,
} from "Common/Types/AI/AskAiRatings";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import StackedProgressBar from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * ASK AI ANSWERS (#7365): how people in this project rated Ask AI's answers
 * in the last 90 days, for its owners and admins, at the end of Settings >
 * AI > AI Results (AiResultsPage draws it for them alone; the server asks
 * again).
 *
 * The helpful and not helpful counts, one bar, and what the answers rated
 * down read - "Logs 3, Incidents 2, OneUptime docs 1" - so an admin can see
 * which of the project's data Ask AI gets wrong. Never a question or an
 * answer: each conversation is private to the person who had it, and the
 * card says so.
 */

export const ASK_AI_RATINGS_CARD_TEST_ID: string = "ask-ai-ratings";

const AskAiRatingsCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [ratings, setRatings] = useState<AskAiProjectRatings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refresher, setRefresher] = useState<number>(0);
  // The latest read: an answer to an older one is dropped.
  const requestRef: MutableRefObject<number> = useRef<number>(0);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const request: number = ++requestRef.current;
    setIsLoading(true);

    let answer: AskAiProjectRatings | null = null;
    let failure: string = "";

    try {
      answer = await fetchAskAiRatings();
    } catch (err) {
      failure = API.getFriendlyMessage(err);
    }

    if (request !== requestRef.current) {
      return;
    }

    setRatings(answer);
    setError(failure);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refresher]);

  const days: number = ratings?.sinceDays || ASK_AI_RATINGS_DAYS;
  const rated: number = ratings ? ratings.helpful + ratings.notHelpful : 0;

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading && !ratings) {
      return <DetailListSkeleton fields={3} />;
    }

    if (!ratings) {
      return (
        <ErrorMessage
          message={error}
          whatFailed={translator.translateText(
            "How Ask AI's answers were rated could not be loaded.",
          )}
          onRefreshClick={() => {
            setRefresher((count: number): number => {
              return count + 1;
            });
          }}
        />
      );
    }

    if (rated === 0) {
      return (
        <p className="text-sm text-gray-600" data-testid="ask-ai-ratings-none">
          {translator.translateText(
            "No answers rated yet. When people rate Ask AI's answers with a thumb, how they rated them shows up here.",
          )}
        </p>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <p
            className="text-sm leading-relaxed text-gray-600"
            data-testid="ask-ai-ratings-headline"
          >
            {translator.translatePlural(
              {
                one: "{{helpful}} of {{count}} rated answer was helpful.",
                other: "{{helpful}} of {{count}} rated answers were helpful.",
              },
              rated,
              { helpful: translator.formatNumber(ratings.helpful) },
            )}
          </p>
          <StackedProgressBar
            heightClassName="h-2.5"
            totalValue={rated}
            segments={[
              {
                value: ratings.helpful,
                color: "bg-emerald-500",
                label: translator.translateText("Helpful") || "Helpful",
              },
              {
                value: ratings.notHelpful,
                color: "bg-amber-400",
                label: translator.translateText("Not helpful") || "Not helpful",
              },
            ]}
          />
        </div>
        <div className="min-w-0" data-testid="ask-ai-ratings-drew-on">
          <p className="mb-1 text-xs font-medium text-gray-500">
            {translator.translateText("What the answers rated down read")}
          </p>
          {ratings.ratedDownDrewOn.length > 0 ? (
            <dl className="divide-y divide-gray-100">
              {ratings.ratedDownDrewOn.map(
                (source: AskAiSourceCount): ReactElement => {
                  const title: string = getAskAiSourceTitle(source.source);

                  return (
                    <div
                      key={source.source}
                      className="flex items-center justify-between gap-3 py-1.5 text-sm"
                      data-testid="ask-ai-ratings-source"
                    >
                      <dt className="min-w-0 text-gray-600">
                        {translator.translateText(title) || title}
                      </dt>
                      <dd className="font-medium text-gray-900">
                        {translator.formatNumber(source.answers)}
                      </dd>
                    </div>
                  );
                },
              )}
            </dl>
          ) : (
            <p className="text-sm text-gray-600">
              {translator.translateText("No answer was rated down.")}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Ask AI Answers"
      description={translator.translatePlural(
        {
          one: "How people in this project rated Ask AI's answers in the last day. Each conversation is private to its person, so no question or answer is shown.",
          other:
            "How people in this project rated Ask AI's answers in the last {{count}} days. Each conversation is private to its person, so no question or answer is shown.",
        },
        days,
      )}
    >
      <div data-testid={ASK_AI_RATINGS_CARD_TEST_ID}>{getBody()}</div>
    </Card>
  );
};

export default AskAiRatingsCard;
