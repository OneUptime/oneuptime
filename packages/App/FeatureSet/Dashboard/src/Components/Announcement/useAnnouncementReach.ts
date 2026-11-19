import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import AnnouncementReach, {
  AnnouncementReachResult,
} from "Common/Types/StatusPage/AnnouncementReach";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import createPickedStatusPagesReachAsker, {
  NOT_ASKED,
  PICKED_STATUS_PAGES_REACH_KEPT_FOR_MS,
  PickedStatusPagesReachAsker,
  PickedStatusPagesReachState,
  getPickedStatusPagesKey,
} from "../StatusPage/PickedStatusPagesReachAsker";
import { AnnouncementReachQuestion } from "./AnnouncementForm";

/*
 * Whether an announcement on the status pages picked on its form shows on
 * one of them, and whether it notifies anyone (Common/Types/StatusPage
 * /AnnouncementReach), from POST /status-page-announcement/reach: what the
 * Schedule & Notifications line says, and the notify boxes under them
 * (#9775). On the Edit the answer also says where the announcement's own
 * notification stands, which the update box reads (#9921).
 *
 * Asked as every form that picks status pages asks
 * (StatusPage/PickedStatusPagesReachAsker): once for every place that asks
 * the same question, kept 30 seconds so the review reads it without
 * flashing, handed out only for the pages it is for. Not known, the form
 * promises nothing; the answer is advisory, and never stops the form from
 * being saved.
 */

export type AnnouncementReachState =
  PickedStatusPagesReachState<AnnouncementReachResult>;

export const NO_ANNOUNCEMENT_REACH: AnnouncementReachState = NOT_ASKED;

export const ANNOUNCEMENT_REACH_KEPT_FOR_MS: number =
  PICKED_STATUS_PAGES_REACH_KEPT_FOR_MS;

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
  if (!question) {
    return "";
  }

  return getPickedStatusPagesKey({
    statusPageIds: question.statusPageIds,
    recordId: question.announcementId,
  });
};

const announcementReachAsker: PickedStatusPagesReachAsker<
  AnnouncementReachQuestion,
  AnnouncementReachResult
> = createPickedStatusPagesReachAsker<
  AnnouncementReachQuestion,
  AnnouncementReachResult
>({
  fetch: fetchAnnouncementReach,
  getKey: getAnnouncementReachKey,
});

// Forgets every answer: for the tests, which each start from nothing.
export const forgetAnnouncementReachAnswers: () => void =
  announcementReachAsker.forget;

/*
 * The answer kept for `question`, or null when there is none: for what a
 * form works out without drawing (a folded section's sentences), which
 * reads what the line beside it was answered.
 */
export const getKeptAnnouncementReach: (
  question: AnnouncementReachQuestion | null | undefined,
) => AnnouncementReachResult | null = announcementReachAsker.getKept;

/*
 * The answer for `question`; null asks nothing (no page picked yet), and
 * says nothing. An answer for pages the form has since unpicked is dropped,
 * and an answer is handed out only for the question it is for, so a change
 * of pages reads as "not known yet" from its very first render.
 */
export default function useAnnouncementReach(
  question: AnnouncementReachQuestion | null | undefined,
): AnnouncementReachState {
  return announcementReachAsker.useReach(question);
}
