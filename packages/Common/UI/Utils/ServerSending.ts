import { APP_API_URL } from "../Config";
import API from "./API/API";
import GlobalConfigUtil, { GlobalConfigVars } from "./GlobalConfig";
import UserUtil from "./User";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ServerSendingStatusUtil, {
  ServerSendingStatusAnswer,
} from "../../Types/ServerSending/ServerSendingStatus";
import { useEffect, useState } from "react";

/*
 * WHETHER THIS SERVER CAN SEND, AS A PAGE READS IT.
 *
 *   - useServerCanSendEmail: anybody's page - the sign-in pages, the invite
 *     dialogs, Home, Create Monitor - from GET /global-config/vars'
 *     canSendEmail, read once per page load (GlobalConfigUtil). False only
 *     while the server is known not to be able to send email; null while the
 *     answer is on its way. A read that fails answers true: the page then
 *     says what it always said, and the server still refuses what it must.
 *   - ServerSendingStatusLoader / useServerSendingStatus: a master admin's
 *     page, from GET /global-config/sending-status - every channel, since
 *     when it fails and why, and whether the global probes report. One
 *     request per page load serves every component that draws it; one that
 *     fails draws nothing, and is asked again by the next one that mounts.
 */

export const useServerCanSendEmail: () => boolean | null = ():
  | boolean
  | null => {
  const [canSendEmail, setCanSendEmail] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted: boolean = true;

    GlobalConfigUtil.fetchVars()
      .then((vars: GlobalConfigVars): void => {
        if (isMounted) {
          setCanSendEmail(vars.canSendEmail !== false);
        }
      })
      .catch((): void => {
        if (isMounted) {
          setCanSendEmail(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return canSendEmail;
};

export default class ServerSendingStatusLoader {
  private static pending: Promise<ServerSendingStatusAnswer | null> | null =
    null;

  // Whether this reader may be told: a master admin, the only one who can fix it.
  public static isShownToReader(): boolean {
    return Boolean(UserUtil.isMasterAdmin());
  }

  public static load(): Promise<ServerSendingStatusAnswer | null> {
    if (!this.isShownToReader()) {
      return Promise.resolve(null);
    }

    if (!this.pending) {
      const pending: Promise<ServerSendingStatusAnswer | null> = this.fetch();
      this.pending = pending;

      pending
        .then((answer: ServerSendingStatusAnswer | null): void => {
          // Ask again next time rather than keep a failure for the page's life.
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

  private static async fetch(): Promise<ServerSendingStatusAnswer | null> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.GET,
          url: URL.fromURL(APP_API_URL).addRoute(
            new Route("/global-config/sending-status"),
          ),
        });

      if (!response.isSuccess()) {
        return null;
      }

      return ServerSendingStatusUtil.parseAnswer(response.data);
    } catch {
      // Nothing to say: the banner only ever helps.
      return null;
    }
  }
}

// The sending status, once loaded; null before, for anyone else, or on a failure.
export const useServerSendingStatus: () => ServerSendingStatusAnswer | null =
  (): ServerSendingStatusAnswer | null => {
    const [answer, setAnswer] = useState<ServerSendingStatusAnswer | null>(
      null,
    );

    useEffect(() => {
      let isCurrent: boolean = true;

      ServerSendingStatusLoader.load()
        .then((loaded: ServerSendingStatusAnswer | null): void => {
          if (isCurrent) {
            setAnswer(loaded);
          }
        })
        .catch((): void => {
          // load() never rejects; nothing to draw if it did.
        });

      return () => {
        isCurrent = false;
      };
    }, []);

    return answer;
  };
