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
  // Never rejects - failures land in `error`.
  reload: () => Promise<void>;
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

  const teamIdKey: string = teamId.toString();

  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    latestRequestId.current += 1;
    const requestId: number = latestRequestId.current;

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
        return;
      }

      setStatus(parseComplianceStatus((response.data || {}) as JSONObject));
      setError("");
    } catch (err) {
      if (!isCurrent()) {
        return;
      }

      setError(API.getFriendlyMessage(err as Error));
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  }, [teamIdKey]);

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
