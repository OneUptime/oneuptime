import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "Common/Types/StatusPage/PickedStatusPagesReach";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import createPickedStatusPagesReachAsker, {
  PickedStatusPagesReachAsker,
  PickedStatusPagesReachState,
  getPickedStatusPagesKey,
} from "../StatusPage/PickedStatusPagesReachAsker";
import {
  MaintenanceReachQuestion,
  MaintenanceReachRecord,
} from "./ScheduledMaintenanceReach";

/*
 * Whether a maintenance event - or an event made from a maintenance
 * template - on the status pages picked on its form shows on one of them,
 * and whether it notifies anyone (Common/Types/StatusPage
 * /PickedStatusPagesReach), from POST /scheduled-maintenance/reach or
 * /scheduled-maintenance-template/reach: what the Subscriber Notifications
 * line says, and the notes under its boxes (#9920). What the event's own
 * settings do to each moment the form works out itself
 * (ScheduledMaintenanceReach).
 *
 * Asked as every form that picks status pages asks
 * (StatusPage/PickedStatusPagesReachAsker): once for every place that asks
 * the same question, kept 30 seconds so the review reads it without
 * flashing, handed out only for the pages it is for. Not known, the form
 * promises nothing; the answer is advisory, and never stops the form from
 * being saved.
 */

export type ScheduledMaintenanceReachState =
  PickedStatusPagesReachState<PickedStatusPagesReachResult>;

const readAnswer: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => PickedStatusPagesReachResult = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): PickedStatusPagesReachResult => {
  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const reach: PickedStatusPagesReachResult | null =
    PickedStatusPagesReach.fromJSON(response.data);

  if (!reach) {
    throw new Error(
      "The answer about where this maintenance event shows could not be read.",
    );
  }

  return reach;
};

/*
 * Each route is written out rather than built from PickedStatusPagesReach
 * .routePath so the tenant-header sweep (App/Tests/Dashboard/
 * ProjectScopedApiTenantHeader.test.ts) can see which route each call
 * reaches; a test pins them together. The tenant header is what tells the
 * server which project the pages are of.
 */
export const fetchScheduledMaintenanceReach: (
  question: MaintenanceReachQuestion,
) => Promise<PickedStatusPagesReachResult> = async (
  question: MaintenanceReachQuestion,
): Promise<PickedStatusPagesReachResult> => {
  if (question.record === MaintenanceReachRecord.Template) {
    return readAnswer(
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/scheduled-maintenance-template/reach",
        ),
        data: {
          statusPageIds: question.statusPageIds,
          ...(question.recordId
            ? { scheduledMaintenanceTemplateId: question.recordId }
            : {}),
        },
        headers: ModelAPI.getCommonHeaders(),
      }),
    );
  }

  return readAnswer(
    await API.post({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/scheduled-maintenance/reach",
      ),
      data: {
        statusPageIds: question.statusPageIds,
        ...(question.recordId
          ? { scheduledMaintenanceId: question.recordId }
          : {}),
      },
      headers: ModelAPI.getCommonHeaders(),
    }),
  );
};

/*
 * The question's key: the event or the template, the pages picked, in any
 * order, and the record an Edit edits. Empty for no page picked.
 */
export const getScheduledMaintenanceReachKey: (
  question: MaintenanceReachQuestion | null | undefined,
) => string = (
  question: MaintenanceReachQuestion | null | undefined,
): string => {
  if (!question) {
    return "";
  }

  const key: string = getPickedStatusPagesKey({
    statusPageIds: question.statusPageIds,
    recordId: question.recordId,
  });

  return key ? `${question.record} ${key}` : "";
};

const scheduledMaintenanceReachAsker: PickedStatusPagesReachAsker<
  MaintenanceReachQuestion,
  PickedStatusPagesReachResult
> = createPickedStatusPagesReachAsker<
  MaintenanceReachQuestion,
  PickedStatusPagesReachResult
>({
  fetch: fetchScheduledMaintenanceReach,
  getKey: getScheduledMaintenanceReachKey,
});

// Forgets every answer: for the tests, which each start from nothing.
export const forgetScheduledMaintenanceReachAnswers: () => void =
  scheduledMaintenanceReachAsker.forget;

// The answer kept for `question`, for a folded section's sentences.
export const getKeptScheduledMaintenanceReach: (
  question: MaintenanceReachQuestion | null | undefined,
) => PickedStatusPagesReachResult | null =
  scheduledMaintenanceReachAsker.getKept;

// The answer for `question`; null asks nothing (no page picked).
export default function useScheduledMaintenanceReach(
  question: MaintenanceReachQuestion | null | undefined,
): ScheduledMaintenanceReachState {
  return scheduledMaintenanceReachAsker.useReach(question);
}
