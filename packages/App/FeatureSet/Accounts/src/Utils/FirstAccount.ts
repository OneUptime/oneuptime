import { FIRST_ACCOUNT_API_URL } from "./ApiPaths";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";

/*
 * How long the register page waits for the answer before it draws anyway,
 * as a server that has accounts: a server that does not answer never keeps
 * the page from drawing.
 */
export const FIRST_ACCOUNT_ANSWER_TIMEOUT_IN_MS: number = 3000;

/*
 * Client half of POST /identity/first-account: whether this self-hosted
 * server is waiting for its first account, which becomes its admin.
 *
 * Only a self-hosted server asks (OneUptime Cloud is never waiting). The
 * answer only adds a sentence to the register page, so anything but a clear
 * yes in time - an error, an older server without the route, a body of
 * another shape, no answer within the timeout - is no.
 */
export const fetchIsAwaitingFirstAccount: (
  timeoutInMs?: number,
) => Promise<boolean> = async (
  timeoutInMs: number = FIRST_ACCOUNT_ANSWER_TIMEOUT_IN_MS,
): Promise<boolean> => {
  const ask: () => Promise<boolean> = async (): Promise<boolean> => {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: FIRST_ACCOUNT_API_URL,
          data: {},
        });

      if (response instanceof HTTPErrorResponse) {
        return false;
      }

      return response.data?.["isAwaitingFirstAccount"] === true;
    } catch {
      return false;
    }
  };

  const timer: { id?: ReturnType<typeof setTimeout> | undefined } = {};

  const timeout: Promise<boolean> = new Promise<boolean>(
    (resolve: (value: boolean) => void) => {
      timer.id = setTimeout(() => {
        resolve(false);
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

export default fetchIsAwaitingFirstAccount;
