import { APP_API_URL, BILLING_ENABLED, DOCS_URL } from "../Config";
import API from "./API/API";
import UserUtil from "./User";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import UpdateStatusUtil, {
  UpdateStatus,
} from "../../Types/UpdateCheck/UpdateStatus";
import { useEffect, useState } from "react";

/*
 * Whether this installation should be upgraded, as the server worked it out
 * from its daily update check (GET /global-config/update-status): what the
 * footers' "Update available" / "Security update" pill and the Admin
 * Dashboard's security notice draw.
 *
 * Only a master admin asks, and only on a self-hosted installation: the
 * route answers master admins alone, and nobody else could act on it. One
 * request per page load serves every component that draws it; one that fails
 * draws nothing and is asked again by the next component that mounts.
 */

// This installation's own upgrade guide (Docs: installation/upgrading).
export const getUpgradeGuideUrl: () => string = (): string => {
  return `${DOCS_URL.toString()}/installation/upgrading`;
};

// The docs page that says what the check sends and how to turn it off.
export const getUpdateCheckDocsUrl: () => string = (): string => {
  return `${DOCS_URL.toString()}/self-hosted/update-checks`;
};

export default class UpdateStatusLoader {
  private static pending: Promise<UpdateStatus | null> | null = null;

  // Whether this reader may be told: a master admin of a self-hosted installation.
  public static isShownToReader(): boolean {
    return !BILLING_ENABLED && Boolean(UserUtil.isMasterAdmin());
  }

  public static load(): Promise<UpdateStatus | null> {
    if (!this.isShownToReader()) {
      return Promise.resolve(null);
    }

    if (!this.pending) {
      const pending: Promise<UpdateStatus | null> = this.fetch();
      this.pending = pending;

      pending
        .then((status: UpdateStatus | null): void => {
          // Ask again next time rather than keep a failure for the page's life.
          if (!status && this.pending === pending) {
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

  private static async fetch(): Promise<UpdateStatus | null> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.GET,
          url: URL.fromURL(APP_API_URL).addRoute(
            new Route("/global-config/update-status"),
          ),
        });

      if (!response.isSuccess()) {
        return null;
      }

      return UpdateStatusUtil.fromJSON(response.data);
    } catch {
      // Nothing to say: the footer and the notice only ever help.
      return null;
    }
  }
}

// The update status, once loaded; null before, for anyone else, or on a failure.
export const useUpdateStatus: () => UpdateStatus | null =
  (): UpdateStatus | null => {
    const [status, setStatus] = useState<UpdateStatus | null>(null);

    useEffect(() => {
      let isCurrent: boolean = true;

      UpdateStatusLoader.load()
        .then((loaded: UpdateStatus | null): void => {
          if (isCurrent) {
            setStatus(loaded);
          }
        })
        .catch((): void => {
          // load() never rejects; nothing to draw if it did.
        });

      return () => {
        isCurrent = false;
      };
    }, []);

    return status;
  };
