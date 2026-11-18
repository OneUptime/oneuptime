import { SIGN_UP_INVITATION_API_URL } from "./ApiPaths";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  SignUpInvitation,
  readSignUpInvitationAnswer,
} from "Common/Types/Accounts/SignUpInvitation";
import API from "Common/UI/Utils/API/API";

/*
 * Client half of POST /identity/sign-up-invitation (#7471,
 * Common/Types/Accounts/SignUpInvitation): what the invitation a sign-up
 * link is for already knows - which project, who invited them, the name the
 * inviter typed - asked with the link's address and token.
 *
 * The answer only adds to the page, so anything but a clear invitation in
 * time - an error, an older server without the route, a body of another
 * shape, no answer within the timeout - is none, and the page is the plain
 * sign-up page it always was. Never throws.
 */

// How long the register page waits before it draws without the invitation.
export const SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS: number = 3000;

export const fetchSignUpInvitation: (
  data: { email: string; token: string },
  timeoutInMs?: number,
) => Promise<SignUpInvitation | null> = async (
  data: { email: string; token: string },
  timeoutInMs: number = SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS,
): Promise<SignUpInvitation | null> => {
  const ask: () => Promise<SignUpInvitation | null> =
    async (): Promise<SignUpInvitation | null> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: SIGN_UP_INVITATION_API_URL,
            data: {
              email: data.email,
              token: data.token,
            },
          });

        if (response instanceof HTTPErrorResponse) {
          return null;
        }

        return readSignUpInvitationAnswer(response.data);
      } catch {
        return null;
      }
    };

  const timer: { id?: ReturnType<typeof setTimeout> | undefined } = {};

  const timeout: Promise<null> = new Promise<null>(
    (resolve: (value: null) => void) => {
      timer.id = setTimeout(() => {
        resolve(null);
      }, timeoutInMs);
    },
  );

  try {
    return await Promise.race([ask(), timeout]);
  } finally {
    if (timer.id !== undefined) {
      clearTimeout(timer.id);
    }
  }
};

export default fetchSignUpInvitation;
