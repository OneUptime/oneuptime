import ActionButtonSchema, {
  RowActionConfirmation,
  RowActionContext,
} from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import { APP_API_URL } from "../../Config";
import API from "../../Utils/API/API";
import Toast from "../../Utils/Toast";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ResentInvitation,
  getResendInvitationRoute,
  readResentInvitation,
} from "../../../Types/Team/ResendInvitation";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import RetryAfter from "../../../Utils/RetryAfter";

/*
 * RESEND INVITATION, ON A PENDING PERSON'S ROW (#9519).
 *
 * A pending person whose invitation email never reached them - Email Not
 * Sent (#9511), a spam folder, a link that ran out - is sent it again from
 * their row: the Users list, a person's Teams, a team's Members, and the
 * Admin Dashboard's lists of a project's people. Before, it took removing
 * them and inviting them again, since inviting the same address to the
 * same team is refused while the invitation waits.
 *
 * One row action, with a short question that names the address, so a
 * press in the ⋯ menu never emails anybody by mistake. The question stays
 * open, its button busy, until the server has handed the email to the mail
 * service (POST /team-member/:id/resend-invitation, Types/Team/
 * ResendInvitation), so a second press sends nothing more; then a toast
 * says where it went, and the list reads its rows again - the row says
 * Invitation Sent once the email went. A refusal says why in the question,
 * for another try: a per-address limit reached says when it can go again.
 *
 * `isAvailable` says whether this reader may invite people at all, on a
 * server not known to be unable to send email; the server holds them to
 * inviting to that row's team, whatever a page shows.
 */

export const RESEND_INVITATION_COPY: {
  action: string;
  question: string;
  questionWithoutAddress: string;
  sent: string;
  sentWithoutAddress: string;
  tooMany: string;
} = {
  // The row action, the question's title and its button.
  action: translationKey("Resend Invitation"),
  question: translationKey("Send their invitation email to {{email}} again?"),
  // A row that does not name the person's address.
  questionWithoutAddress: translationKey(
    "Send their invitation email again?",
  ),
  // Where it went, once the mail service has taken it.
  sent: translationKey("Invitation sent to {{email}}"),
  // An answer that names no address: the pending pill's words.
  sentWithoutAddress: translationKey("Invitation Sent"),
  // The address's limit of invitations an hour, and when it may go again.
  tooMany: translationKey(
    "Too many invitations were sent to this address in the last hour. You can send it again after {{time}}.",
  ),
};

export const RESEND_INVITATION_TOAST_TEST_ID: string = "invitation-resent";

// The address a row names: its person's, when the row carries it.
export const getInvitationRowEmail: (row: TeamMember) => string = (
  row: TeamMember,
): string => {
  return row.user?.email?.toString().trim() || "";
};

/*
 * When a refused resend may go again, from its Retry-After: rounded up to
 * the minute, so the time it says is never a moment early.
 */
export const getResendAgainAt: (
  error: unknown,
  nowInMs?: number | undefined,
) => Date | null = (
  error: unknown,
  nowInMs?: number | undefined,
): Date | null => {
  if (!(error instanceof HTTPErrorResponse) || error.statusCode !== 429) {
    return null;
  }

  const seconds: number | undefined = RetryAfter.secondsFromHeaders(
    error.headers,
    {
      acceptHttpDate: false,
      minMs: 0,
    },
  );

  if (seconds === undefined) {
    return null;
  }

  const now: number = nowInMs ?? Date.now();
  const minute: number = 60 * 1000;

  return new Date(Math.ceil((now + seconds * 1000) / minute) * minute);
};

// What a refused resend says, in the reader's words where OneUptime wrote them.
export const getResendInvitationErrorMessage: (data: {
  error: unknown;
  translator: Translator;
  nowInMs?: number | undefined;
}) => string = (data: {
  error: unknown;
  translator: Translator;
  nowInMs?: number | undefined;
}): string => {
  const againAt: Date | null = getResendAgainAt(data.error, data.nowInMs);

  if (againAt) {
    return data.translator.translateTemplate(RESEND_INVITATION_COPY.tooMany, {
      time: OneUptimeDate.getLocalTimeString(againAt, {
        use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
      }),
    });
  }

  // The server's own sentence: what happened, and what to do.
  return API.getFriendlyMessage(data.error);
};

/*
 * Sends a pending person's invitation again: the address it went to - ""
 * when the answer names none - or a throw: the error response itself, for
 * its status and when to come back.
 */
export const resendInvitation: (data: {
  teamMemberId: ObjectID;
  headers?: Dictionary<string> | undefined;
}) => Promise<ResentInvitation> = async (data: {
  teamMemberId: ObjectID;
  headers?: Dictionary<string> | undefined;
}): Promise<ResentInvitation> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getResendInvitationRoute(data.teamMemberId),
      ),
      data: {},
      headers: data.headers || {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readResentInvitation(response.data) || { email: "" };
};

/*
 * The toast once it went: where to, by the server's answer or else the
 * row's - or, naming no address, the pending pill's own words.
 */
export const getInvitationResentToastTitle: (data: {
  resent: ResentInvitation;
  rowEmail: string;
  translator: Translator;
}) => string = (data: {
  resent: ResentInvitation;
  rowEmail: string;
  translator: Translator;
}): string => {
  const email: string = data.resent.email || data.rowEmail;

  if (!email) {
    return (
      data.translator.translateText(RESEND_INVITATION_COPY.sentWithoutAddress) ||
      RESEND_INVITATION_COPY.sentWithoutAddress
    );
  }

  return data.translator.translateTemplate(RESEND_INVITATION_COPY.sent, {
    email: email,
  });
};

/*
 * Resend Invitation, as a row action of a list of a project's people.
 * `getRequestHeaders` names the project for a page that works in one (the
 * Dashboard's tenant header); the Admin Dashboard works in none.
 */
export const getResendInvitationRowAction: <T extends TeamMember>(data: {
  isAvailable: boolean;
  getRequestHeaders?: (() => Dictionary<string>) | undefined;
  onSent?: ((item: T, resent: ResentInvitation) => void) | undefined;
}) => ActionButtonSchema<T> = <T extends TeamMember>(data: {
  isAvailable: boolean;
  getRequestHeaders?: (() => Dictionary<string>) | undefined;
  onSent?: ((item: T, resent: ResentInvitation) => void) | undefined;
}): ActionButtonSchema<T> => {
  return {
    title: RESEND_INVITATION_COPY.action,
    buttonStyleType: ButtonStyleType.OUTLINE,
    icon: IconProp.Email,
    // Only a pending row: someone who has joined has no invitation waiting.
    isVisible: (item: T): boolean => {
      return data.isAvailable && Boolean(item.id) && !item.hasAcceptedInvitation;
    },
    getConfirmation: (item: T): RowActionConfirmation => {
      const translator: Translator = getGlobalTranslator();
      const email: string = getInvitationRowEmail(item);

      return {
        title: RESEND_INVITATION_COPY.action,
        description: email
          ? translator.translateTemplate(RESEND_INVITATION_COPY.question, {
              email: email,
            })
          : translator.translateText(
              RESEND_INVITATION_COPY.questionWithoutAddress,
            ) || RESEND_INVITATION_COPY.questionWithoutAddress,
        submitButtonText: RESEND_INVITATION_COPY.action,
      };
    },
    onClick: (
      item: T,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): void => {
      if (!item.id) {
        onCompleteAction();
        return;
      }

      resendInvitation({
        teamMemberId: item.id,
        headers: data.getRequestHeaders?.(),
      })
        .then((resent: ResentInvitation): void => {
          Toast.success(
            getInvitationResentToastTitle({
              resent: resent,
              rowEmail: getInvitationRowEmail(item),
              translator: getGlobalTranslator(),
            }),
            {
              dataTestId: RESEND_INVITATION_TOAST_TEST_ID,
            },
          );

          // The row says Invitation Sent again, read from the Email Logs.
          context?.refresh();
          data.onSent?.(item, resent);
          onCompleteAction();
        })
        .catch((err: unknown): void => {
          onError(
            new Error(
              getResendInvitationErrorMessage({
                error: err,
                translator: getGlobalTranslator(),
              }),
            ),
          );
        });
    },
  };
};
