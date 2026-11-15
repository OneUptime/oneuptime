import { APP_API_URL } from "../../Config";
import API from "../../Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * WHO HAS NOT SIGNED UP YET, ON A PAGE OF MEMBERS (#8191).
 *
 * A master admin can accept an invitation for someone (the Admin
 * Dashboard's "Accept the invitation automatically"), who may have no
 * account yet. The lists then show them as Member, and a membership's row
 * cannot tell more: whether an account has a password never reaches the
 * browser. So on a server that cannot send email, where a master admin is
 * the only way that person gets their sign-up link, the list asks the
 * server which of its accepted rows belong to someone who has not signed up
 * (POST /team-member/not-signed-up, master admins only), and shows them
 * "Not Signed Up Yet" beside Member, with Get Invitation Link on the row.
 *
 * Hand `onFetchSuccess` to the ModelTable and read `isNotSignedUp(row)`
 * where the row is drawn. Nothing is asked while `isAvailable` is false (a
 * viewer who is not a master admin, a server that sends email, or one
 * whose answer is still being read); once it turns true, the rows already
 * on the page are asked about. A failed answer shows nothing new: the rows
 * stay as they were.
 */

export const NOT_SIGNED_UP_ROUTE: string = "/team-member/not-signed-up";

// A list's largest page (InvitationLink's MAX_MEMBERSHIPS_PER_SIGN_UP_READ).
export const MAX_ROWS_PER_SIGN_UP_READ: number = 100;

// Of these memberships, the ids of those whose person has not signed up.
export const fetchMembershipsNotSignedUp: (
  teamMemberIds: Array<string>,
) => Promise<Array<string>> = async (
  teamMemberIds: Array<string>,
): Promise<Array<string>> => {
  if (teamMemberIds.length === 0) {
    return [];
  }

  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: URL.fromURL(APP_API_URL).addRoute(new Route(NOT_SIGNED_UP_ROUTE)),
        data: {
          teamMemberIds: teamMemberIds,
        },
      });

    if (!response.isSuccess()) {
      return [];
    }

    const found: unknown = (response.data as JSONObject)?.["teamMemberIds"];

    if (!Array.isArray(found)) {
      return [];
    }

    // Only ids that were asked about: an answer can name nobody else.
    const asked: Set<string> = new Set<string>(teamMemberIds);

    return found.filter((id: unknown): id is string => {
      return typeof id === "string" && asked.has(id);
    });
  } catch {
    return [];
  }
};

/*
 * The rows worth asking about: accepted ones, each once. A pending row is
 * offered its link already, and says Invited.
 */
export const getRowsToAskAbout: (rows: Array<TeamMember>) => Array<string> = (
  rows: Array<TeamMember>,
): Array<string> => {
  const ids: Array<string> = [];

  for (const row of rows) {
    const id: string | undefined = row.id?.toString();

    if (id && row.hasAcceptedInvitation && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids.slice(0, MAX_ROWS_PER_SIGN_UP_READ);
};

export interface MembersNotSignedUp {
  // For the ModelTable: the rows it has just drawn.
  onFetchSuccess: (rows: Array<TeamMember>) => void;
  // Whether this row's person still has to sign up.
  isNotSignedUp: (row: TeamMember) => boolean;
}

export const useMembersNotSignedUp: (
  isAvailable: boolean,
) => MembersNotSignedUp = (isAvailable: boolean): MembersNotSignedUp => {
  const [notSignedUp, setNotSignedUp] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );

  /*
   * A table hands its rows to the onFetchSuccess it was given when it
   * fetched, which can be from a render before isAvailable turned true:
   * both are read from refs, so the latest always decides.
   */
  const isAvailableRef: MutableRefObject<boolean> =
    useRef<boolean>(isAvailable);
  const rowIdsRef: MutableRefObject<Array<string>> = useRef<Array<string>>([]);
  // Only the latest ask's answer is drawn.
  const askRef: MutableRefObject<number> = useRef<number>(0);

  isAvailableRef.current = isAvailable;

  const ask: () => void = useCallback((): void => {
    const askNumber: number = ++askRef.current;
    const rowIds: Array<string> = rowIdsRef.current;

    if (!isAvailableRef.current || rowIds.length === 0) {
      setNotSignedUp(new Set<string>());
      return;
    }

    fetchMembershipsNotSignedUp(rowIds)
      .then((found: Array<string>): void => {
        if (askNumber === askRef.current) {
          setNotSignedUp(new Set<string>(found));
        }
      })
      .catch((): void => {
        // fetchMembershipsNotSignedUp answers [] rather than throw.
      });
  }, []);

  useEffect(() => {
    ask();
  }, [isAvailable]);

  const onFetchSuccess: (rows: Array<TeamMember>) => void = useCallback(
    (rows: Array<TeamMember>): void => {
      rowIdsRef.current = getRowsToAskAbout(rows);
      ask();
    },
    [],
  );

  const isNotSignedUp: (row: TeamMember) => boolean = useCallback(
    (row: TeamMember): boolean => {
      const id: string | undefined = row.id?.toString();

      return Boolean(
        isAvailable && row.hasAcceptedInvitation && id && notSignedUp.has(id),
      );
    },
    [isAvailable, notSignedUp],
  );

  return {
    onFetchSuccess: onFetchSuccess,
    isNotSignedUp: isNotSignedUp,
  };
};
