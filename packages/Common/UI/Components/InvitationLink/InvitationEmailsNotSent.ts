import { APP_API_URL } from "../../Config";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE,
  INVITATION_EMAILS_NOT_SENT_ROUTE,
  InvitationEmailNotSent,
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
  ProjectInvitationEmailNotSent,
  ProjectInvitee,
  getProjectInviteeKey,
  readInvitationEmailsNotSentAnswer,
  readInvitationEmailsNotSentInProjectsAnswer,
  toInvitationEmailsNotSentInProjectsRequestJSON,
  toInvitationEmailsNotSentRequestJSON,
} from "../../../Types/Team/InvitationEmailsNotSent";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * WHOSE INVITATION EMAIL WAS NOT SENT, ON A PAGE OF PEOPLE (#9511).
 *
 * A pending invitation said Invitation Sent even when the mail service
 * refused its email, and the person who invited them waited for nothing.
 * So a list of people asks the server about the pending ones it shows
 * (POST /team-member/invitation-emails-not-sent, Types/Team/
 * InvitationEmailsNotSent): whose latest invitation email failed, and the
 * mail service's answer, from the project's Email Logs - read with the
 * reader's own permissions, so a reader who may not read them is told
 * about nobody.
 *
 * Hand `onFetchSuccess` to the ModelTable and read `getNotSent(row)` where
 * the row is drawn. Nothing is asked while `isAvailable` is false (a reader
 * who may not read the project's Email Logs, or a server known not to send
 * email, where every pending person says Invited already); once it turns
 * true, the rows already on the page are asked about. One ask per page of
 * rows, never one per row. A failed answer shows nothing new: the rows say
 * what they always said.
 *
 * The Admin Dashboard asks across projects (`isAcrossProjects`, #9518): it
 * works in no project, and a person's projects are many, so each pending
 * row's person is asked about in the row's own project, as a master admin
 * (POST /team-member/invitation-emails-not-sent-in-projects).
 */

// The person a row of a list - a membership, or a person's row - stands for.
export const getInvitationRowUserId: (row: TeamMember) => string = (
  row: TeamMember,
): string => {
  return (
    row.userId?.toString() ||
    row.user?.id?.toString() ||
    row.user?._id?.toString() ||
    ""
  )
    .trim()
    .toLowerCase();
};

// The project a row of a list stands in: its membership's.
export const getInvitationRowProjectId: (row: TeamMember) => string = (
  row: TeamMember,
): string => {
  return (
    row.projectId?.toString() ||
    row.project?.id?.toString() ||
    row.project?._id?.toString() ||
    ""
  )
    .trim()
    .toLowerCase();
};

/*
 * The people worth asking about: those of pending rows, each once, a page
 * at most. Someone who has joined has no invitation left to email.
 */
export const getPendingPeopleToAskAbout: (
  rows: Array<TeamMember>,
) => Array<string> = (rows: Array<TeamMember>): Array<string> => {
  const userIds: Array<string> = [];

  for (const row of rows) {
    const userId: string = getInvitationRowUserId(row);

    if (userId && !row.hasAcceptedInvitation && !userIds.includes(userId)) {
      userIds.push(userId);
    }
  }

  return userIds.slice(0, MAX_PEOPLE_PER_INVITATION_EMAILS_READ);
};

/*
 * The same across projects (#9518): each pending row's person in the
 * row's project, each pair once, a page at most. A row that names no
 * project or no person is passed over.
 */
export const getPendingInviteesToAskAbout: (
  rows: Array<TeamMember>,
) => Array<ProjectInvitee> = (
  rows: Array<TeamMember>,
): Array<ProjectInvitee> => {
  const invitees: Map<string, ProjectInvitee> = new Map<
    string,
    ProjectInvitee
  >();

  for (const row of rows) {
    const invitee: ProjectInvitee = {
      projectId: getInvitationRowProjectId(row),
      userId: getInvitationRowUserId(row),
    };

    if (!invitee.projectId || !invitee.userId || row.hasAcceptedInvitation) {
      continue;
    }

    const key: string = getProjectInviteeKey(invitee);

    if (!invitees.has(key)) {
      invitees.set(key, invitee);
    }
  }

  return Array.from(invitees.values()).slice(
    0,
    MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
  );
};

/*
 * Of these people, those whose latest invitation email to the current
 * project was not sent - or null when it could not be read, and nothing
 * changes on the page.
 */
export const fetchInvitationEmailsNotSent: (
  userIds: Array<string>,
) => Promise<Array<InvitationEmailNotSent> | null> = async (
  userIds: Array<string>,
): Promise<Array<InvitationEmailNotSent> | null> => {
  const request: JSONObject = toInvitationEmailsNotSentRequestJSON(userIds);
  const asked: Array<string> = request["userIds"] as Array<string>;

  if (asked.length === 0) {
    return [];
  }

  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          INVITATION_EMAILS_NOT_SENT_ROUTE,
        ),
        data: request,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      return null;
    }

    // Only people who were asked about: an answer can name nobody else.
    const askedIds: Set<string> = new Set<string>(asked);

    return readInvitationEmailsNotSentAnswer(response.data).filter(
      (person: InvitationEmailNotSent): boolean => {
        return askedIds.has(person.userId);
      },
    );
  } catch {
    return null;
  }
};

/*
 * The same across projects, for a master admin (#9518): of these people,
 * each in their own project, those whose latest invitation email to it
 * was not sent - or null when it could not be read. Asked in no project:
 * the Admin Dashboard works in none.
 */
export const fetchInvitationEmailsNotSentInProjects: (
  invitees: Array<ProjectInvitee>,
) => Promise<Array<ProjectInvitationEmailNotSent> | null> = async (
  invitees: Array<ProjectInvitee>,
): Promise<Array<ProjectInvitationEmailNotSent> | null> => {
  const request: JSONObject =
    toInvitationEmailsNotSentInProjectsRequestJSON(invitees);
  const asked: Array<ProjectInvitee> = request[
    "invitees"
  ] as unknown as Array<ProjectInvitee>;

  if (asked.length === 0) {
    return [];
  }

  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE,
        ),
        data: request,
        headers: {},
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      return null;
    }

    // Only invitees who were asked about: an answer can name nobody else.
    const askedKeys: Set<string> = new Set<string>(
      asked.map(getProjectInviteeKey),
    );

    return readInvitationEmailsNotSentInProjectsAnswer(response.data).filter(
      (invitee: ProjectInvitationEmailNotSent): boolean => {
        return askedKeys.has(getProjectInviteeKey(invitee));
      },
    );
  } catch {
    return null;
  }
};

export interface InvitationEmailsNotSentOptions {
  /*
   * Ask about each row's person in the row's own project, as a master admin
   * - the Admin Dashboard, which works in no project (#9518). The Dashboard
   * asks in its current project.
   */
  isAcrossProjects?: boolean | undefined;
}

export interface InvitationEmailsNotSent {
  // For the ModelTable: the rows it has just drawn.
  onFetchSuccess: (rows: Array<TeamMember>) => void;
  // A pending row whose person's latest invitation email was not sent: why.
  getNotSent: (row: TeamMember) => InvitationEmailNotSent | undefined;
}

// What a row's answer is kept by: its person, or its person in its project.
const getRowKey: (row: TeamMember, isAcrossProjects: boolean) => string = (
  row: TeamMember,
  isAcrossProjects: boolean,
): string => {
  const userId: string = getInvitationRowUserId(row);

  if (!isAcrossProjects) {
    return userId;
  }

  const projectId: string = getInvitationRowProjectId(row);

  return projectId && userId
    ? getProjectInviteeKey({ projectId: projectId, userId: userId })
    : "";
};

export const useInvitationEmailsNotSent: (
  isAvailable: boolean,
  options?: InvitationEmailsNotSentOptions | undefined,
) => InvitationEmailsNotSent = (
  isAvailable: boolean,
  options?: InvitationEmailsNotSentOptions | undefined,
): InvitationEmailsNotSent => {
  const isAcrossProjects: boolean = Boolean(options?.isAcrossProjects);

  const [notSent, setNotSent] = useState<
    ReadonlyMap<string, InvitationEmailNotSent>
  >(new Map<string, InvitationEmailNotSent>());

  /*
   * A table hands its rows to the onFetchSuccess it was given when it
   * fetched, which can be from a render before isAvailable turned true:
   * both are read from refs, so the latest always decides.
   */
  const isAvailableRef: MutableRefObject<boolean> =
    useRef<boolean>(isAvailable);
  const rowsRef: MutableRefObject<Array<TeamMember>> = useRef<
    Array<TeamMember>
  >([]);
  // Only the latest ask's answer is drawn.
  const askRef: MutableRefObject<number> = useRef<number>(0);

  isAvailableRef.current = isAvailable;

  const ask: () => void = useCallback((): void => {
    const askNumber: number = ++askRef.current;
    const rows: Array<TeamMember> = rowsRef.current;

    // Each answer, by the key its row is read with (getRowKey).
    const draw: (
      people: Array<[string, InvitationEmailNotSent]> | null,
    ) => void = (
      people: Array<[string, InvitationEmailNotSent]> | null,
    ): void => {
      if (askNumber !== askRef.current) {
        return;
      }

      // Not read: the rows say what they always said.
      setNotSent(new Map<string, InvitationEmailNotSent>(people || []));
    };

    if (!isAvailableRef.current) {
      setNotSent(new Map<string, InvitationEmailNotSent>());
      return;
    }

    if (isAcrossProjects) {
      const invitees: Array<ProjectInvitee> =
        getPendingInviteesToAskAbout(rows);

      if (invitees.length === 0) {
        setNotSent(new Map<string, InvitationEmailNotSent>());
        return;
      }

      fetchInvitationEmailsNotSentInProjects(invitees)
        .then((people: Array<ProjectInvitationEmailNotSent> | null): void => {
          draw(
            people
              ? people.map(
                  (
                    person: ProjectInvitationEmailNotSent,
                  ): [string, InvitationEmailNotSent] => {
                    return [
                      getProjectInviteeKey(person),
                      {
                        userId: person.userId,
                        statusMessage: person.statusMessage,
                      },
                    ];
                  },
                )
              : null,
          );
        })
        .catch((): void => {
          // fetchInvitationEmailsNotSentInProjects answers null rather than throw.
        });

      return;
    }

    const userIds: Array<string> = getPendingPeopleToAskAbout(rows);

    if (userIds.length === 0) {
      setNotSent(new Map<string, InvitationEmailNotSent>());
      return;
    }

    fetchInvitationEmailsNotSent(userIds)
      .then((people: Array<InvitationEmailNotSent> | null): void => {
        draw(
          people
            ? people.map(
                (
                  person: InvitationEmailNotSent,
                ): [string, InvitationEmailNotSent] => {
                  return [person.userId, person];
                },
              )
            : null,
        );
      })
      .catch((): void => {
        // fetchInvitationEmailsNotSent answers null rather than throw.
      });
  }, [isAcrossProjects]);

  useEffect(() => {
    ask();
  }, [isAvailable]);

  const onFetchSuccess: (rows: Array<TeamMember>) => void = useCallback(
    (rows: Array<TeamMember>): void => {
      rowsRef.current = rows;
      ask();
    },
    [ask],
  );

  const getNotSent: (row: TeamMember) => InvitationEmailNotSent | undefined =
    useCallback(
      (row: TeamMember): InvitationEmailNotSent | undefined => {
        if (!isAvailable || row.hasAcceptedInvitation) {
          return undefined;
        }

        const key: string = getRowKey(row, isAcrossProjects);

        return key ? notSent.get(key) : undefined;
      },
      [isAvailable, isAcrossProjects, notSent],
    );

  return {
    onFetchSuccess: onFetchSuccess,
    getNotSent: getNotSent,
  };
};
