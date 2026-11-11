import { APP_API_URL, NOTIFICATION_URL } from "../Config";
import API from "./API/API";
import ServerSendingStatusLoader from "./ServerSending";
import UserUtil from "./User";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import { ServerSendingChannel } from "../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
} from "../../Types/ServerSetup/ServerSetupChecklist";
import {
  parseServerTestSendAnswer,
  SERVER_TEST_SEND_ROUTE,
  ServerTestSendAnswer,
} from "../../Types/ServerSetup/ServerTestSend";
import { useCallback, useEffect, useState } from "react";

/*
 * THE SERVER'S SETUP CHECKLIST, AS A MASTER ADMIN'S PAGE READS IT.
 *
 *   - ServerSetupChecklistLoader.load(): GET /global-config/setup-checklist,
 *     once per page load for every component that draws it (the Admin
 *     Dashboard's Server setup page and where it lands, the Dashboard's
 *     card). Anyone but a master admin is never asked for it, and a read
 *     that fails draws nothing and is asked again next time.
 *   - choose() and hide(): an admin's choice on a check, and hiding the
 *     card; each answers the checklist as it now stands.
 *   - sendServerTest(): "Send test email", "Send test SMS", "Make test
 *     call" through the server's own settings. How it went changes what the
 *     checklist and the banner say, so both are read again after it.
 */

export const SERVER_SETUP_CHECKLIST_ROUTE: string =
  "/global-config/setup-checklist";

export default class ServerSetupChecklistLoader {
  private static pending: Promise<ServerSetupChecklistAnswer | null> | null =
    null;

  // Whether this reader may be told: a master admin, the only one who can act on it.
  public static isShownToReader(): boolean {
    return Boolean(UserUtil.isMasterAdmin());
  }

  public static load(): Promise<ServerSetupChecklistAnswer | null> {
    if (!this.isShownToReader()) {
      return Promise.resolve(null);
    }

    if (!this.pending) {
      const pending: Promise<ServerSetupChecklistAnswer | null> = this.fetch();
      this.pending = pending;

      pending
        .then((answer: ServerSetupChecklistAnswer | null): void => {
          if (!answer && this.pending === pending) {
            this.pending = null;
          }
        })
        .catch((): void => {
          if (this.pending === pending) {
            this.pending = null;
          }
        });
    }

    return this.pending;
  }

  // Forgets the answer, so the next load asks again.
  public static clear(): void {
    this.pending = null;
  }

  // Keeps an answer the server just gave, for every component on the page.
  private static keep(
    answer: ServerSetupChecklistAnswer | null,
  ): ServerSetupChecklistAnswer | null {
    this.pending = answer ? Promise.resolve(answer) : null;
    return answer;
  }

  private static async fetch(): Promise<ServerSetupChecklistAnswer | null> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.GET,
          url: URL.fromURL(APP_API_URL).addRoute(
            new Route(SERVER_SETUP_CHECKLIST_ROUTE),
          ),
        });

      if (!response.isSuccess()) {
        return null;
      }

      return ServerSetupChecklistUtil.parseAnswer(response.data);
    } catch {
      // Nothing to draw: the checklist only ever helps.
      return null;
    }
  }

  private static async post(
    path: string,
    data: JSONObject,
  ): Promise<ServerSetupChecklistAnswer> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromURL(APP_API_URL).addRoute(
          new Route(`${SERVER_SETUP_CHECKLIST_ROUTE}${path}`),
        ),
        data: data,
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      throw response;
    }

    const answer: ServerSetupChecklistAnswer | null =
      ServerSetupChecklistUtil.parseAnswer(response.data);

    if (!answer) {
      throw new Error("The server did not answer with the setup checklist.");
    }

    return this.keep(answer)!;
  }

  // Makes, or undoes with null, the one choice a check allows.
  public static async choose(
    check: ServerSetupCheckId,
    kind: ServerSetupChoiceKind | null,
  ): Promise<ServerSetupChecklistAnswer> {
    return await this.post("/choice", { check: check, choice: kind });
  }

  // Hides the card for this admin, in every browser.
  public static async hide(): Promise<ServerSetupChecklistAnswer> {
    return await this.post("/hide", {});
  }
}

/*
 * One test send through the server's own settings. Throws only when the
 * request itself fails (an address that is not one, a lost connection); a
 * refusal by the provider is an answer.
 */
export const sendServerTest: (data: {
  channel: ServerSendingChannel;
  to: string;
}) => Promise<ServerTestSendAnswer> = async (data: {
  channel: ServerSendingChannel;
  to: string;
}): Promise<ServerTestSendAnswer> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(NOTIFICATION_URL).addRoute(
        new Route(`${SERVER_TEST_SEND_ROUTE}/${data.channel}`),
      ),
      data:
        data.channel === ServerSendingChannel.Email
          ? { toEmail: data.to }
          : { toPhone: data.to },
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  const answer: ServerTestSendAnswer | null = parseServerTestSendAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error("The server did not say how the test went.");
  }

  // What the checklist and the banner say may have changed with it.
  ServerSetupChecklistLoader.clear();
  ServerSendingStatusLoader.clear();

  return answer;
};

export interface UseServerSetupChecklistResult {
  answer: ServerSetupChecklistAnswer | null;
  isLoading: boolean;
  // Reads it again from the server.
  reload: () => Promise<void>;
  // Shows an answer the server just gave (after a choice, a hide or a test).
  setAnswer: (answer: ServerSetupChecklistAnswer | null) => void;
}

// The checklist, once loaded; null before, for anyone else, or on a failure.
export const useServerSetupChecklist: () => UseServerSetupChecklistResult =
  (): UseServerSetupChecklistResult => {
    const [answer, setAnswer] = useState<ServerSetupChecklistAnswer | null>(
      null,
    );
    const [isLoading, setIsLoading] = useState<boolean>(
      ServerSetupChecklistLoader.isShownToReader(),
    );

    const load: () => Promise<void> = useCallback(async (): Promise<void> => {
      const loaded: ServerSetupChecklistAnswer | null =
        await ServerSetupChecklistLoader.load();
      setAnswer(loaded);
      setIsLoading(false);
    }, []);

    useEffect(() => {
      let isCurrent: boolean = true;

      ServerSetupChecklistLoader.load()
        .then((loaded: ServerSetupChecklistAnswer | null): void => {
          if (isCurrent) {
            setAnswer(loaded);
            setIsLoading(false);
          }
        })
        .catch((): void => {
          if (isCurrent) {
            setIsLoading(false);
          }
        });

      return () => {
        isCurrent = false;
      };
    }, []);

    return {
      answer: answer,
      isLoading: isLoading,
      reload: async (): Promise<void> => {
        ServerSetupChecklistLoader.clear();
        await load();
      },
      setAnswer: setAnswer,
    };
  };
