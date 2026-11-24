import {
  INVITATION_SSO_SIGN_IN_API_URL,
  SIGN_UP_INVITATION_API_URL,
  SIGN_UP_INVITATION_SSO_API_URL,
} from "./ApiPaths";
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

/*
 * Client half of POST /identity/sign-up-invitation/sso (#9898): said as the
 * person picks one of the project's single sign-on providers, with the
 * link's address and token and the project the page showed. On OneUptime
 * Cloud the server takes the link as the mailbox's confirmation of that
 * project's sign-in, so the provider signs them in the first time, with no
 * second email.
 *
 * The answer is the same whatever the server found, so nothing is read
 * from it, and the page goes on to the provider whatever happens: an
 * error, an older server without the route, or no answer in time leaves
 * the provider's answer to ask the mailbox, as it always did. Never throws.
 */

/*
 * How long the page waits before it goes on to the provider anyway: long
 * enough for the server's few writes, which the provider's answer must
 * find, and short enough that a server that never answers still lets them
 * sign in.
 */
export const SIGN_UP_INVITATION_SSO_TIMEOUT_IN_MS: number = 10000;

export const confirmSignUpInvitationSsoSignIn: (
  data: { email: string; token: string; projectId: string },
  timeoutInMs?: number,
) => Promise<void> = async (
  data: { email: string; token: string; projectId: string },
  timeoutInMs: number = SIGN_UP_INVITATION_SSO_TIMEOUT_IN_MS,
): Promise<void> => {
  const tell: () => Promise<void> = async (): Promise<void> => {
    try {
      await API.post<JSONObject>({
        url: SIGN_UP_INVITATION_SSO_API_URL,
        data: {
          email: data.email,
          token: data.token,
          projectId: data.projectId,
        },
      });
    } catch {
      // The provider's answer asks the mailbox instead.
    }
  };

  const timer: { id?: ReturnType<typeof setTimeout> | undefined } = {};

  const timeout: Promise<void> = new Promise<void>(
    (resolve: () => void): void => {
      timer.id = setTimeout(() => {
        resolve();
      }, timeoutInMs);
    },
  );

  try {
    await Promise.race([tell(), timeout]);
  } finally {
    if (timer.id !== undefined) {
      clearTimeout(timer.id);
    }
  }
};

/*
 * Client half of POST /identity/invitation-sso-sign-in (#10178): said as
 * someone who has signed up already picks one of the project's providers
 * on the project's SSO page their invitation opened, with the invitation's
 * single-use link and the project. Like the sign-up page's (above): the
 * answer is the same whatever the server found, so nothing is read from it,
 * and the page goes on to the provider whatever happens. Never throws.
 */
export const confirmInvitationSsoSignIn: (
  data: { token: string; signature: string; projectId: string },
  timeoutInMs?: number,
) => Promise<void> = async (
  data: { token: string; signature: string; projectId: string },
  timeoutInMs: number = SIGN_UP_INVITATION_SSO_TIMEOUT_IN_MS,
): Promise<void> => {
  const tell: () => Promise<void> = async (): Promise<void> => {
    try {
      await API.post<JSONObject>({
        url: INVITATION_SSO_SIGN_IN_API_URL,
        data: {
          token: data.token,
          signature: data.signature,
          projectId: data.projectId,
        },
      });
    } catch {
      // The provider's answer asks the mailbox instead.
    }
  };

  const timer: { id?: ReturnType<typeof setTimeout> | undefined } = {};

  const timeout: Promise<void> = new Promise<void>(
    (resolve: () => void): void => {
      timer.id = setTimeout(() => {
        resolve();
      }, timeoutInMs);
    },
  );

  try {
    await Promise.race([tell(), timeout]);
  } finally {
    if (timer.id !== undefined) {
      clearTimeout(timer.id);
    }
  }
};

export default fetchSignUpInvitation;
