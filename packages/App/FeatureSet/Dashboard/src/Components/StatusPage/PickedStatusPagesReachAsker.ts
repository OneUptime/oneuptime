import OneUptimeDate from "Common/Types/Date";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";

/*
 * ASKING THE SERVER WHAT THE STATUS PAGES PICKED ON A FORM DO.
 *
 * A form that picks the status pages its record shows on - an
 * announcement's (#9775), a maintenance event's and a maintenance
 * template's (#9920) - says what those pages will do, once the server has
 * said it (Common/Types/StatusPage/PickedStatusPagesReach). It asks from
 * more than one place at once - the folded line and the notes under its
 * boxes, then the review step's line - and asks again each time the pages
 * picked change. So one answer serves them all: an answer is kept for a
 * short while by the question it is for (the pages picked, and the record
 * an Edit edits), and a question already on its way is not asked twice.
 * The review step then reads the answer the step before it was given,
 * rather than flashing the line it says while it does not know.
 *
 * Not known - while it is asked, or when it could not be answered - the
 * form promises nothing; the answer is advisory, and never stops the form
 * from being saved.
 *
 * Each kind of form has an asker of its own (createPickedStatusPagesReachAsker),
 * with its own route and its own answers kept: useAnnouncementReach,
 * useScheduledMaintenanceReach.
 */

export interface PickedStatusPagesReachState<TResult> {
  // Null while it is not known.
  reach: TResult | null;
  isLoading: boolean;
  error: string;
}

/*
 * How long an answer is kept: long enough to carry the line from the step
 * that picks the pages to the review, short enough that a page's settings
 * changed meanwhile are read again by the next form.
 */
export const PICKED_STATUS_PAGES_REACH_KEPT_FOR_MS: number = 30 * 1000;

interface KeptAnswer<TResult> {
  reach: TResult | null;
  error: string;
  keptAt: number;
}

export interface PickedStatusPagesReachAsker<TQuestion, TResult> {
  /*
   * The answer for `question`; null asks nothing (no page picked yet), and
   * says nothing. An answer for pages the form has since unpicked is
   * dropped, and an answer is handed out only for the question it is for,
   * so a change of pages reads as "not known yet" from its very first
   * render.
   */
  useReach: (
    question: TQuestion | null | undefined,
  ) => PickedStatusPagesReachState<TResult>;
  /*
   * The answer kept for `question`, or null when there is none: for what a
   * form works out without drawing (a folded section's sentences), which
   * reads what the line beside it was answered.
   */
  getKept: (question: TQuestion | null | undefined) => TResult | null;
  // The question's key; empty for none.
  getKey: (question: TQuestion | null | undefined) => string;
  // Forgets every answer: for the tests, which each start from nothing.
  forget: () => void;
}

export const NOT_ASKED: PickedStatusPagesReachState<never> = {
  reach: null,
  isLoading: false,
  error: "",
};

/*
 * The key of a question about the pages picked: the pages, in any order,
 * each once, and the record an Edit edits ("new" on Create). Empty for no
 * page picked.
 */
export const getPickedStatusPagesKey: (data: {
  statusPageIds: Array<string>;
  recordId: string | null | undefined;
}) => string = (data: {
  statusPageIds: Array<string>;
  recordId: string | null | undefined;
}): string => {
  const statusPageIds: Array<string> = data.statusPageIds
    .map((id: string): string => {
      return id.toString().trim().toLowerCase();
    })
    .filter((id: string, index: number, all: Array<string>): boolean => {
      return Boolean(id) && all.indexOf(id) === index;
    })
    .sort();

  if (statusPageIds.length === 0) {
    return "";
  }

  return `${(data.recordId || "new").toString().toLowerCase()} ${statusPageIds.join(",")}`;
};

export default function createPickedStatusPagesReachAsker<
  TQuestion,
  TResult,
>(options: {
  // Asks the server; throws when it could not be answered.
  fetch: (question: TQuestion) => Promise<TResult>;
  getKey: (question: TQuestion | null | undefined) => string;
}): PickedStatusPagesReachAsker<TQuestion, TResult> {
  const keptAnswers: Map<string, KeptAnswer<TResult>> = new Map<
    string,
    KeptAnswer<TResult>
  >();

  const questionsOnTheirWay: Map<
    string,
    Promise<KeptAnswer<TResult>>
  > = new Map<string, Promise<KeptAnswer<TResult>>>();

  const forget: () => void = (): void => {
    keptAnswers.clear();
    questionsOnTheirWay.clear();
  };

  const readKeptAnswer: (key: string) => KeptAnswer<TResult> | null = (
    key: string,
  ): KeptAnswer<TResult> | null => {
    const kept: KeptAnswer<TResult> | undefined = keptAnswers.get(key);

    if (!kept) {
      return null;
    }

    if (
      OneUptimeDate.getCurrentDate().getTime() - kept.keptAt >
      PICKED_STATUS_PAGES_REACH_KEPT_FOR_MS
    ) {
      keptAnswers.delete(key);
      return null;
    }

    return kept;
  };

  const getKept: (question: TQuestion | null | undefined) => TResult | null = (
    question: TQuestion | null | undefined,
  ): TResult | null => {
    const key: string = options.getKey(question);

    return key ? readKeptAnswer(key)?.reach || null : null;
  };

  // Asks once for every place that asks the same question at the same time.
  const ask: (
    key: string,
    question: TQuestion,
  ) => Promise<KeptAnswer<TResult>> = (
    key: string,
    question: TQuestion,
  ): Promise<KeptAnswer<TResult>> => {
    const onItsWay: Promise<KeptAnswer<TResult>> | undefined =
      questionsOnTheirWay.get(key);

    if (onItsWay) {
      return onItsWay;
    }

    const asked: Promise<KeptAnswer<TResult>> = options
      .fetch(question)
      .then((reach: TResult): KeptAnswer<TResult> => {
        return {
          reach: reach,
          error: "",
          keptAt: OneUptimeDate.getCurrentDate().getTime(),
        };
      })
      .catch((err: unknown): KeptAnswer<TResult> => {
        return {
          reach: null,
          error: API.getFriendlyMessage(err),
          keptAt: OneUptimeDate.getCurrentDate().getTime(),
        };
      })
      .then((answer: KeptAnswer<TResult>): KeptAnswer<TResult> => {
        // Answers kept past their while go as a new one is kept.
        for (const keptKey of Array.from(keptAnswers.keys())) {
          readKeptAnswer(keptKey);
        }

        keptAnswers.set(key, answer);
        questionsOnTheirWay.delete(key);
        return answer;
      });

    questionsOnTheirWay.set(key, asked);

    return asked;
  };

  const useReach: (
    question: TQuestion | null | undefined,
  ) => PickedStatusPagesReachState<TResult> = (
    question: TQuestion | null | undefined,
  ): PickedStatusPagesReachState<TResult> => {
    const key: string = options.getKey(question);

    const [answer, setAnswer] = useState<{
      key: string;
      kept: KeptAnswer<TResult>;
    } | null>(null);

    useEffect(() => {
      if (!key || !question) {
        return;
      }

      /*
       * An answer kept from another place the form asked from: this one
       * holds on to it for as long as it shows the same pages.
       */
      const keptAlready: KeptAnswer<TResult> | null = readKeptAnswer(key);

      if (keptAlready) {
        setAnswer({ key: key, kept: keptAlready });
        return;
      }

      let isStale: boolean = false;

      ask(key, question)
        .then((kept: KeptAnswer<TResult>) => {
          if (!isStale) {
            setAnswer({ key: key, kept: kept });
          }
        })
        .catch(() => {
          // ask answers every failure itself.
        });

      return () => {
        isStale = true;
      };
    }, [key]);

    if (!key) {
      return NOT_ASKED;
    }

    const kept: KeptAnswer<TResult> | null =
      answer && answer.key === key ? answer.kept : readKeptAnswer(key);

    // Until this question's answer arrives, the last one is another's.
    if (!kept) {
      return { reach: null, isLoading: true, error: "" };
    }

    return {
      reach: kept.reach,
      isLoading: false,
      error: kept.error,
    };
  };

  return {
    useReach: useReach,
    getKept: getKept,
    getKey: options.getKey,
    forget: forget,
  };
}
