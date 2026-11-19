import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * THE ADMIN DASHBOARD: EMAIL NOT SENT, AND RESEND INVITATION (#9518, #9519).
 *
 * The Admin Dashboard's lists of a project's people - a project's Users,
 * one of its teams, one of its people - and a person's projects and team
 * memberships said Invitation Sent for every pending invitation, even one
 * whose email the mail service refused, on a server that sends email. Now
 * each asks the server about its pending rows, once a page, each person in
 * the row's own project (POST /team-member/invitation-emails-not-sent-in-
 * projects - master admins only, as everybody here is):
 *
 *   - a pending row whose latest invitation email failed says Email Not
 *     Sent, and why, as the project's Email Log words it, and that they can
 *     still join with their link;
 *   - that row offers Get Invitation Link, in a dialog that says the email
 *     was not sent;
 *   - every pending row offers Resend Invitation, asked in no project;
 *   - on a server that cannot send email, nothing is asked: every pending
 *     person says Invited, and Resend Invitation is not offered.
 *
 * The real pages, with the tables, the page chrome and the network stood
 * in for.
 */

jest.setTimeout(60000);

let mockCanSendEmail: boolean | null = true;

jest.mock("react-i18next", () => {
  return {
    __esModule: true,
    useTranslation: () => {
      return {
        t: (key: string, options?: Record<string, unknown>): string => {
          if (options && typeof options["defaultValue"] === "string") {
            return options["defaultValue"] as string;
          }

          return key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ServerSending", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/ServerSending",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    useServerCanSendEmail: (): boolean | null => {
      return mockCanSendEmail;
    },
  };
});

type CapturedAction = {
  title: string;
  isVisible?: ((item: TeamMember) => boolean | undefined) | undefined;
  onClick: (
    item: TeamMember,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
};

type CapturedColumn = {
  field?: Record<string, unknown> | undefined;
  getElement?: ((item: TeamMember) => ReactElement) | undefined;
};

type MockProps = Record<string, unknown>;

const mockTables: Array<MockProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockTables.push(props);
      return <div data-testid={`model-table-${String(props["id"])}`} />;
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="card-model-detail" />;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="model-delete" />;
    },
  };
});

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div data-testid="model-page">{props.children}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getList: jest.fn(),
        createOrUpdate: jest.fn(),
        getCommonHeaders: (): Record<string, string> => {
          return {};
        },
      },
    };
  },
);

import ProjectUsers from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Users";
import ProjectUserView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/UserView";
import ProjectTeamView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/TeamView";
import UserProjects from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/Projects";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import { EMAIL_NOT_SENT_PILL_TEST_ID } from "../../../UI/Components/InvitationLink/InvitationEmailNotSentPill";
import {
  INVITATION_LINK_COPY,
  INVITATION_LINK_ROUTE,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
import { RESEND_INVITATION_COPY } from "../../../UI/Components/InvitationLink/ResendInvitation";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE } from "../../../Types/Team/InvitationEmailsNotSent";
import { RESEND_INVITATION_ROUTE_END } from "../../../Types/Team/ResendInvitation";

const mockGetList: jest.MockedFunction<any> =
  AdminModelAPI.getList as unknown as jest.MockedFunction<any>;

const PAGE_ID: string = "95260000-0000-4000-8000-0000000000d2";
const ACME: string = "95260000-0000-4000-8000-000000000001";
const GLOBEX: string = "95260000-0000-4000-8000-000000000002";
// Pending in Acme: the mail service refused her latest invitation email.
const GRACE: string = "95260000-0000-4000-8000-000000000003";
// Pending in Acme: his went.
const ALAN: string = "95260000-0000-4000-8000-000000000004";
const ADA: string = "95260000-0000-4000-8000-000000000005";

const REFUSAL: string = "550 5.1.1 Mailbox unavailable";
const LINK: string =
  "https://oneuptime.example.com/accounts/register?email=grace%40example.com&token=95260000-0000-4000-8000-0000000000fe";

function membership(
  projectId: string,
  userId: string,
  hasAcceptedInvitation: boolean,
): TeamMember {
  const value: TeamMember = new TeamMember();
  value._id = ObjectID.generate().toString();
  value.projectId = new ObjectID(projectId);
  value.userId = new ObjectID(userId);
  value.hasAcceptedInvitation = hasAcceptedInvitation;
  return value;
}

const GRACE_ROW: TeamMember = membership(ACME, GRACE, false);
const ALAN_ROW: TeamMember = membership(ACME, ALAN, false);
const ADA_ROW: TeamMember = membership(ACME, ADA, true);
// Grace again, in another project, where her email went.
const GRACE_IN_GLOBEX: TeamMember = membership(GLOBEX, GRACE, false);

// [the page, the id of its table]
const TABLES: Array<[string, FunctionComponent, string]> = [
  ["a project's Users", ProjectUsers, "project-users-table"],
  ["a project's user", ProjectUserView, "project-user-teams-table"],
  ["a project's team", ProjectTeamView, "project-team-members-table"],
  ["a user's Projects", UserProjects, "user-projects-table"],
  ["a user's Team Memberships", UserProjects, "user-team-memberships-table"],
];

type Request = { url: URL; data: JSONObject; headers?: unknown };

let postSpy: SpyInstance<typeof API.post>;
let fetchSpy: SpyInstance<typeof API.fetch>;

function requestsTo(route: string): Array<Request> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): Request => {
      return call[0] as Request;
    })
    .filter((request: Request): boolean => {
      return request.url.toString().endsWith(route);
    });
}

function asks(): Array<Request> {
  return requestsTo(INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE);
}

beforeEach(() => {
  mockCanSendEmail = true;
  mockTables.length = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(PAGE_ID));
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  // A project's user page reads who the user is from one of their memberships.
  mockGetList.mockImplementation(async (): Promise<unknown> => {
    const user: User = new User();
    user._id = GRACE;
    user.email = new Email("grace@example.com");

    const member: TeamMember = new TeamMember();
    member.user = user;

    return { data: [member], count: 1, skip: 0, limit: 1 };
  });

  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: Request,
  ) => {
    if (
      request.url
        .toString()
        .endsWith(INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE)
    ) {
      return new HTTPResponse<JSONObject>(
        200,
        {
          invitees: [
            { projectId: ACME, userId: GRACE, statusMessage: REFUSAL },
          ],
        },
        {},
      );
    }

    if (request.url.toString().endsWith(RESEND_INVITATION_ROUTE_END)) {
      return new HTTPResponse<JSONObject>(
        200,
        { email: "grace@example.com" },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never) as unknown as SpyInstance<typeof API.post>;

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async () => {
    return new HTTPResponse<JSONObject>(
      200,
      {
        link: LINK,
        isRegistered: false,
        isAccepted: false,
        email: "grace@example.com",
      },
      {},
    );
  }) as never) as unknown as SpyInstance<typeof API.fetch>;
});

afterEach(() => {
  cleanup();
  mockGetList.mockReset();
  jest.restoreAllMocks();
});

function tableProps(tableId: string): MockProps {
  return mockTables
    .filter((props: MockProps): boolean => {
      return props["id"] === tableId;
    })
    .pop()!;
}

async function renderPage(
  Page: FunctionComponent,
  tableId: string,
): Promise<void> {
  render(<Page />);

  await waitFor(() => {
    expect(
      mockTables.some((props: MockProps): boolean => {
        return props["id"] === tableId;
      }),
    ).toBe(true);
  });
}

// The table has drawn these rows, as ModelTable hands them over.
async function rowsFetched(
  tableId: string,
  rows: Array<TeamMember>,
): Promise<void> {
  const onFetchSuccess: (rows: Array<TeamMember>, count: number) => void =
    tableProps(tableId)["onFetchSuccess"] as (
      rows: Array<TeamMember>,
      count: number,
    ) => void;

  expect(onFetchSuccess).toBeDefined();

  await act(async (): Promise<void> => {
    onFetchSuccess(rows, rows.length);
  });

  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 5; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

function statusElement(tableId: string, item: TeamMember): ReactElement {
  const column: CapturedColumn | undefined = (
    (tableProps(tableId)["columns"] as Array<CapturedColumn> | undefined) || []
  ).find((candidate: CapturedColumn): boolean => {
    return Boolean(
      candidate.field && "hasAcceptedInvitation" in candidate.field,
    );
  });

  expect(column?.getElement).toBeDefined();

  return column!.getElement!(item);
}

function statusText(tableId: string, item: TeamMember): string {
  const { container, unmount } = render(<>{statusElement(tableId, item)}</>);
  const text: string = Array.from(
    container.querySelectorAll('[data-testid="pill-text"]'),
  )
    .map((pill: Element): string => {
      return pill.textContent || "";
    })
    .join(" ");
  unmount();

  return text;
}

async function answerDrawn(tableId: string): Promise<void> {
  await waitFor(() => {
    expect(
      (statusElement(tableId, GRACE_ROW).props as { notSent?: unknown })
        .notSent,
    ).toBeDefined();
  });
}

function actionTitled(tableId: string, title: string): CapturedAction {
  const action: CapturedAction | undefined = (
    (tableProps(tableId)["actionButtons"] as
      | Array<CapturedAction>
      | undefined) || []
  ).find((candidate: CapturedAction): boolean => {
    return candidate.title === title;
  });

  expect(action).toBeDefined();

  return action!;
}

function isOffered(tableId: string, title: string, item: TeamMember): boolean {
  return Boolean(actionTitled(tableId, title).isVisible!(item));
}

describe.each(TABLES)(
  "%s",
  (_page: string, Page: FunctionComponent, tableId: string) => {
    test("asks once, as a master admin, about its pending rows, each person in their row's project", async () => {
      await renderPage(Page, tableId);
      await rowsFetched(tableId, [
        GRACE_ROW,
        ALAN_ROW,
        ADA_ROW,
        GRACE_IN_GLOBEX,
      ]);

      expect(asks()).toHaveLength(1);
      expect(asks()[0]!.data).toEqual({
        invitees: [
          { projectId: ACME, userId: GRACE },
          { projectId: ACME, userId: ALAN },
          { projectId: GLOBEX, userId: GRACE },
        ],
      });
      // In no project: the Admin Dashboard works in none.
      expect(asks()[0]!.headers).toEqual({});
    });

    // The regression: #9518.
    test("a pending row whose latest invitation email failed says Email Not Sent, never Invitation Sent", async () => {
      await renderPage(Page, tableId);
      await rowsFetched(tableId, [
        GRACE_ROW,
        ALAN_ROW,
        ADA_ROW,
        GRACE_IN_GLOBEX,
      ]);
      await answerDrawn(tableId);

      expect(statusText(tableId, GRACE_ROW)).toBe("Email Not Sent");
      expect(statusText(tableId, ALAN_ROW)).toBe("Invitation Sent");
      // The same person in another project, whose email there went.
      expect(statusText(tableId, GRACE_IN_GLOBEX)).toBe("Invitation Sent");
    });

    test("pressed, it says why, as the project's Email Log words it, and that they can still join", async () => {
      await renderPage(Page, tableId);
      await rowsFetched(tableId, [GRACE_ROW, ALAN_ROW]);
      await answerDrawn(tableId);

      render(<>{statusElement(tableId, GRACE_ROW)}</>);

      expect(
        screen.getByTestId(EMAIL_NOT_SENT_PILL_TEST_ID),
      ).toHaveAccessibleDescription(
        `Their invitation email was not sent. ${REFUSAL} They can still join: send them their invitation link yourself.`,
      );
    });

    test("that row offers Get Invitation Link, in a dialog that says the email was not sent", async () => {
      await renderPage(Page, tableId);
      await rowsFetched(tableId, [GRACE_ROW, ALAN_ROW]);

      await waitFor(() => {
        expect(
          isOffered(tableId, INVITATION_LINK_COPY.getLink, GRACE_ROW),
        ).toBe(true);
      });
      // Not on a row whose email went: email works.
      expect(isOffered(tableId, INVITATION_LINK_COPY.getLink, ALAN_ROW)).toBe(
        false,
      );

      await act(async (): Promise<void> => {
        actionTitled(tableId, INVITATION_LINK_COPY.getLink).onClick(
          GRACE_ROW,
          () => {},
          () => {},
        );
      });

      expect(
        await screen.findByTestId("invitation-link-value"),
      ).toHaveTextContent(LINK);
      expect(
        screen.getByText(
          "The invitation email to grace@example.com was not sent. Copy this link and send it yourself. It works once, only for this address, for 7 days.",
        ),
      ).toBeInTheDocument();

      const linkRequests: Array<{ url: URL; data: JSONObject }> =
        fetchSpy.mock.calls
          .map((call: Array<unknown>) => {
            return call[0] as { url: URL; data: JSONObject };
          })
          .filter((request: { url: URL }): boolean => {
            return request.url.toString().endsWith(INVITATION_LINK_ROUTE);
          });

      expect(linkRequests).toHaveLength(1);
      expect(linkRequests[0]!.data).toEqual({
        teamMemberId: GRACE_ROW.id!.toString(),
      });
    });

    test("every pending row offers Resend Invitation, sent in no project; a member's row does not", async () => {
      await renderPage(Page, tableId);

      expect(isOffered(tableId, RESEND_INVITATION_COPY.action, GRACE_ROW)).toBe(
        true,
      );
      expect(isOffered(tableId, RESEND_INVITATION_COPY.action, ALAN_ROW)).toBe(
        true,
      );
      expect(isOffered(tableId, RESEND_INVITATION_COPY.action, ADA_ROW)).toBe(
        false,
      );

      await act(async (): Promise<void> => {
        actionTitled(tableId, RESEND_INVITATION_COPY.action).onClick(
          GRACE_ROW,
          () => {},
          () => {},
        );
      });

      await waitFor(() => {
        expect(requestsTo(RESEND_INVITATION_ROUTE_END)).toHaveLength(1);
      });

      expect(
        requestsTo(RESEND_INVITATION_ROUTE_END)[0]!.url.toString(),
      ).toContain(`/team-member/${GRACE_ROW.id!.toString()}/resend-invitation`);
      expect(requestsTo(RESEND_INVITATION_ROUTE_END)[0]!.headers).toEqual({});
    });

    test("on a server that cannot send email, nothing is asked: every pending person says Invited, with no Resend Invitation", async () => {
      mockCanSendEmail = false;

      await renderPage(Page, tableId);
      await rowsFetched(tableId, [GRACE_ROW, ALAN_ROW]);

      expect(asks()).toHaveLength(0);
      expect(statusText(tableId, GRACE_ROW)).toBe(
        INVITATION_LINK_COPY.invitedPill,
      );
      expect(statusText(tableId, ALAN_ROW)).toBe(
        INVITATION_LINK_COPY.invitedPill,
      );
      expect(isOffered(tableId, RESEND_INVITATION_COPY.action, GRACE_ROW)).toBe(
        false,
      );
    });

    test("an answer that cannot be read leaves every row as it was", async () => {
      postSpy.mockImplementation((async () => {
        throw new Error("Network down");
      }) as never);

      await renderPage(Page, tableId);
      await rowsFetched(tableId, [GRACE_ROW, ALAN_ROW]);

      expect(statusText(tableId, GRACE_ROW)).toBe("Invitation Sent");
      expect(isOffered(tableId, INVITATION_LINK_COPY.getLink, GRACE_ROW)).toBe(
        false,
      );
    });
  },
);

describe.each(
  TABLES.filter((table: [string, FunctionComponent, string]): boolean => {
    // A user's Projects rows come from their own endpoint, with their project.
    return table[2] !== "user-projects-table";
  }),
)(
  "%s reads its rows with",
  (_page: string, Page: FunctionComponent, tableId: string) => {
    test("their person and their project, which the ask names", async () => {
      await renderPage(Page, tableId);

      expect(tableProps(tableId)["selectMoreFields"]).toEqual(
        expect.objectContaining({ userId: true, projectId: true }),
      );
    });
  },
);
