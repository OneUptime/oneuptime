import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnnouncementReach, {
  AnnouncementReachResult,
} from "Common/Types/StatusPage/AnnouncementReach";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";
import { AnnouncementReachQuestion } from "./AnnouncementForm";

/*
 * Whether an announcement on the status pages picked on its form shows on
 * one of them, and whether it notifies anyone (Common/Types/StatusPage
 * /AnnouncementReach), from POST /status-page-announcement/reach: what the
 * Schedule & Notifications line says, and the notify boxes under them
 * (#9775).
 *
 * The form asks from more than one place at once - the folded line and the
 * notify box under it, then the review step's line - and asks again each
 * time the pages picked change. So one answer serves them all: an answer is
 * kept for a short while by the pages it is for (and the announcement an
 * Edit edits), and a question already on its way is not asked twice. The
 * review step then reads the answer the step before it was given, rather
 * than flashing the line it says while it does not know.
 *
 * Not known - while it is asked, or when it could not be answered - the
 * form promises nothing; the answer is advisory, and never stops the form
 * from being saved.
 */

export interface AnnouncementReachState {
  // Null while it is not known.
  reach: AnnouncementReachResult | null;
  isLoading: boolean;
  error: string;
}

export const NO_ANNOUNCEMENT_REACH: AnnouncementReachState = {
  reach: null,
  isLoading: false,
  error: "",
};

interface KeptAnswer {
  reach: AnnouncementReachResult | null;
  error: string;
  keptAt: number;
}

/*
 * How long an answer is kept: long enough to carry the line from the
 * Status Pages step to the review, short enough that a page's settings
 * changed meanwhile are read again by the next form.
 */
export const ANNOUNCEMENT_REACH_KEPT_FOR_MS: number = 30 * 1000;

const keptAnswers: Map<string, KeptAnswer> = new Map<string, KeptAnswer>();

const questionsOnTheirWay: Map<string, Promise<KeptAnswer>> = new Map<
  string,
  Promise<KeptAnswer>
>();

// Forgets every answer: for the tests, which each start from nothing.
export const forgetAnnouncementReachAnswers: () => void = (): void => {
  keptAnswers.clear();
  questionsOnTheirWay.clear();
};

/*
 * The route is written out rather than read from AnnouncementReach
 * .routePath so the tenant-header sweep (App/Tests/Dashboard/
 * ProjectScopedApiTenantHeader.test.ts) can see which route this call
 * reaches; a test pins the two together. The tenant header is what tells
 * the server which project the pages are of.
 */
export const fetchAnnouncementReach: (
  question: AnnouncementReachQuestion,
) => Promise<AnnouncementReachResult> = async (
  question: AnnouncementReachQuestion,
): Promise<AnnouncementReachResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/status-page-announcement/reach",
      ),
      data: {
        statusPageIds: question.statusPageIds,
        ...(question.announcementId
          ? { announcementId: question.announcementId }
          : {}),
      },
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const reach: AnnouncementReachResult | null = AnnouncementReach.fromJSON(
    response.data,
  );

  if (!reach) {
    throw new Error(
      "The answer about where this announcement shows could not be read.",
    );
  }

  return reach;
};

/*
 * The question's key: the pages picked, in any order, and the
 * announcement an Edit edits. Empty for none.
 */
export const getAnnouncementReachKey: (
  question: AnnouncementReachQuestion | null | undefined,
) => string = (
  question: AnnouncementReachQuestion | null | undefined,
): string => {
  if (!question || question.statusPageIds.length === 0) {
    return "";
  }

  const statusPageIds: Array<string> = question.statusPageIds
    .map((id: string): string => {
      return id.toString().trim().toLowerCase();
    })
    .filter((id: string, index: number, all: Array<string>): boolean => {
      return Boolean(id) && all.indexOf(id) === index;
    })
    .sort();

  return `${(question.announcementId || "new").toString().toLowerCase()} ${statusPageIds.join(",")}`;
};

const readKeptAnswer: (key: string) => KeptAnswer | null = (
  key: string,
): KeptAnswer | null => {
  const kept: KeptAnswer | undefined = keptAnswers.get(key);

  if (!kept) {
    return null;
  }

  if (
    OneUptimeDate.getCurrentDate().getTime() - kept.keptAt >
    ANNOUNCEMENT_REACH_KEPT_FOR_MS
  ) {
    keptAnswers.delete(key);
    return null;
  }

  return kept;
};

/*
 * The answer kept for `question`, or null when there is none: for what a
 * form works out without drawing (a folded section's sentences), which
 * reads what the line beside it was answered.
 */
export const getKeptAnnouncementReach: (
  question: AnnouncementReachQuestion | null | undefined,
) => AnnouncementReachResult | null = (
  question: AnnouncementReachQuestion | null | undefined,
): AnnouncementReachResult | null => {
  const key: string = getAnnouncementReachKey(question);

  return key ? readKeptAnswer(key)?.reach || null : null;
};

// Asks once for every place that asks the same question at the same time.
const askAnnouncementReach: (
  key: string,
  question: AnnouncementReachQuestion,
) => Promise<KeptAnswer> = (
  key: string,
  question: AnnouncementReachQuestion,
): Promise<KeptAnswer> => {
  const onItsWay: Promise<KeptAnswer> | undefined =
    questionsOnTheirWay.get(key);

  if (onItsWay) {
    return onItsWay;
  }

  const asked: Promise<KeptAnswer> = fetchAnnouncementReach(question)
    .then((reach: AnnouncementReachResult): KeptAnswer => {
      return {
        reach: reach,
        error: "",
        keptAt: OneUptimeDate.getCurrentDate().getTime(),
      };
    })
    .catch((err: unknown): KeptAnswer => {
      return {
        reach: null,
        error: API.getFriendlyMessage(err),
        keptAt: OneUptimeDate.getCurrentDate().getTime(),
      };
    })
    .then((answer: KeptAnswer): KeptAnswer => {
      keptAnswers.set(key, answer);
      questionsOnTheirWay.delete(key);
      return answer;
    });

  questionsOnTheirWay.set(key, asked);

  return asked;
};

/*
 * The answer for `question`; null asks nothing (no page picked yet), and
 * says nothing. An answer for pages the form has since unpicked is dropped,
 * and an answer is handed out only for the question it is for, so a change
 * of pages reads as "not known yet" from its very first render.
 */
export default function useAnnouncementReach(
  question: AnnouncementReachQuestion | null | undefined,
): AnnouncementReachState {
  const key: string = getAnnouncementReachKey(question);

  const [answer, setAnswer] = useState<{
    key: string;
    kept: KeptAnswer;
  } | null>(null);

  useEffect(() => {
    if (!key || !question) {
      return;
    }

    /*
     * An answer kept from another place the form asked from: this one
     * holds on to it for as long as it shows the same pages.
     */
    const keptAlready: KeptAnswer | null = readKeptAnswer(key);

    if (keptAlready) {
      setAnswer({ key: key, kept: keptAlready });
      return;
    }

    let isStale: boolean = false;

    askAnnouncementReach(key, question)
      .then((kept: KeptAnswer) => {
        if (!isStale) {
          setAnswer({ key: key, kept: kept });
        }
      })
      .catch(() => {
        // askAnnouncementReach answers every failure itself.
      });

    return () => {
      isStale = true;
    };
  }, [key]);

  if (!key) {
    return NO_ANNOUNCEMENT_REACH;
  }

  const kept: KeptAnswer | null =
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
}
