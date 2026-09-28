import { parseComplianceStatus } from "./ComplianceView";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import type { TeamComplianceStatusJSON } from "Common/Types/Team/TeamComplianceStatus";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The one read behind the whole Compliance page: GET
 * /team/compliance-status/:teamId. The hero, the rules card and the members
 * section all draw from this single answer, so they can never disagree about
 * a count - and a page load, or a refresh after any rule change, costs one
 * request, not one per section.
 *
 * It goes through the refresh-aware Common/UI/Utils/API/API client (never a
 * bare fetch), so an expired session is renewed rather than surfacing as an
 * error.
 */
export const getComplianceStatusUrl: (teamId: ObjectID) => URL = (
  teamId: ObjectID,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `/team/compliance-status/${teamId.toString()}`,
  );
};

export interface TeamComplianceStatusState {
  // The last answer that loaded. Kept on screen through refreshes.
  status: TeamComplianceStatusJSON | null;
  // A read is in flight - the first one, or a refresh.
  isLoading: boolean;
  /*
   * Why the most recent read failed; "" once a later read succeeds. With no
   * status yet it is the whole page's error; with one, it is a refresh that
   * failed over results that are still shown.
   */
  error: string;
  /*
   * Reads again. Resolves once the NEWEST read has settled - its own, or one
   * started after it - to true when that read put a fresh status on the
   * page and false when it failed. So `await reload()` after a write means
   * "the page now shows a status requested after the write", or "it could
   * not be refreshed" - never "a newer read took over and nothing is known
   * yet". Never rejects - failures land in `error`.
   */
  reload: () => Promise<boolean>;
}

const useTeamComplianceStatus: (
  teamId: ObjectID,
) => TeamComplianceStatusState = (
  teamId: ObjectID,
): TeamComplianceStatusState => {
  const [status, setStatus] = useState<TeamComplianceStatusJSON | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Reads can overlap - a rule toggled twice in quick succession refreshes
   * twice - and responses do not have to arrive in order. Only the newest
   * request may write, so a slow older answer can never replace a newer one.
   */
  const latestRequestId: MutableRefObject<number> = useRef<number>(0);
  const isMounted: MutableRefObject<boolean> = useRef<boolean>(true);
  // The newest read, for callers whose own read was overtaken to wait on.
  const latestRead: MutableRefObject<Promise<boolean> | null> =
    useRef<Promise<boolean> | null>(null);

  const teamIdKey: string = teamId.toString();

  // One read. True when it wrote a status; false when it failed or was overtaken.
  const read: (requestId: number) => Promise<boolean> = useCallback(
    async (requestId: number): Promise<boolean> => {
      const isCurrent: () => boolean = (): boolean => {
        return isMounted.current && requestId === latestRequestId.current;
      };

      setIsLoading(true);

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: getComplianceStatusUrl(new ObjectID(teamIdKey)),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (!isCurrent()) {
          return false;
        }

        setStatus(parseComplianceStatus((response.data || {}) as JSONObject));
        setError("");

        return true;
      } catch (err) {
        if (isCurrent()) {
          setError(API.getFriendlyMessage(err as Error));
        }

        return false;
      } finally {
        if (isCurrent()) {
          setIsLoading(false);
        }
      }
    },
    [teamIdKey],
  );

  const reload: () => Promise<boolean> =
    useCallback(async (): Promise<boolean> => {
      latestRequestId.current += 1;

      let awaited: Promise<boolean> = read(latestRequestId.current);
      latestRead.current = awaited;

      let applied: boolean = await awaited;

      /*
       * Overtaken: a newer read started while this one was in flight, and
       * this one's answer was dropped. Wait for the newest instead - looping,
       * as that one can be overtaken in turn - so a caller that saved
       * something and awaits this never resumes on the status from BEFORE
       * its save (a toggle would drop its "saving" state and snap back).
       */
      while (
        isMounted.current &&
        latestRead.current &&
        latestRead.current !== awaited
      ) {
        awaited = latestRead.current;
        applied = await awaited;
      }

      return isMounted.current && applied;
    }, [read]);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    /*
     * A different team is a different answer: drop the old one rather than
     * show team A's members under team B's URL while B loads.
     */
    setStatus(null);
    setError("");
    reload().catch(() => {
      // reload never rejects; failures are in `error`.
    });
  }, [teamIdKey]);

  return {
    status: status,
    isLoading: isLoading,
    error: error,
    reload: reload,
  };
};

export default useTeamComplianceStatus;
