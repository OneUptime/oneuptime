import { FIRST_ACCOUNT_API_URL } from "./ApiPaths";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";

/*
 * Client half of POST /identity/first-account: whether this self-hosted
 * server is waiting for its first account, which becomes its admin.
 *
 * Only a self-hosted server asks (OneUptime Cloud is never waiting). The
 * answer only adds a sentence to the register page, so anything but a clear
 * yes - an error, an older server without the route, a body of another
 * shape - is no.
 */
export const fetchIsAwaitingFirstAccount: () => Promise<boolean> =
  async (): Promise<boolean> => {
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

export default fetchIsAwaitingFirstAccount;
