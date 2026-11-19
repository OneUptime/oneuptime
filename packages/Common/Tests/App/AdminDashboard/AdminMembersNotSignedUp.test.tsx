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
 * THE ADMIN DASHBOARD: A MEMBER WHO HAS NOT SIGNED UP (#8191), AND ADD TO
 * TEAM AND ADD TO PROJECT ON A SERVER THAT CANNOT SEND EMAIL (#8192).
 *
 * Everybody here is a master admin, who may accept an invitation for
 * someone with no account yet ("Accept the invitation automatically").
 * That person then read as Member on every list, and no row offered their
 * sign-up link. On a server known not to send email, each list that offers
 * Get Invitation Link - a project's Users, a project's user, a project's
 * team, a user's Team Memberships - now asks which of its members have not
 * signed up, shows them "Not Signed Up Yet" beside Member, and offers their
 * link. Where the server sends email, or while that is read, nothing is
 * asked or shown.
 *
 * And Add to Team (a project's user) and Add to Project (a user's
 * Projects) made a pending membership in silence: they now say no email
 * goes out, and hand over the new membership's link.
 *
 * The real pages, with the tables, the dialogs, the page chrome and the
 * network stood in for.
 */

jest.setTimeout(60000);

let mockCanSendEmail: boolean | null = false;

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

type MockProps = Record<string, unknown>;

const mockTables: Array<MockProps> = [];
const mockFormModals: Array<MockProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockTables.push(props);
      return <div data-testid={`model-table-${String(props["id"])}`} />;
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockFormModals.push(props);
      return <div data-testid="model-form-modal" />;
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
import {
  INVITATION_LINK_COPY,
  INVITATION_LINK_ROUTE,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
import { NOT_SIGNED_UP_ROUTE } from "../../../UI/Components/InvitationLink/MembersNotSignedUp";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const mockGetList: jest.MockedFunction<any> =
  AdminModelAPI.getList as unknown as jest.MockedFunction<any>;

const NOT_SIGNED_UP_ID: string = "81910000-0000-4000-8000-0000000000e1";
const SIGNED_UP_ID: string = "81910000-0000-4000-8000-0000000000e2";
const PENDING_ID: string = "81910000-0000-4000-8000-0000000000e3";
const CREATED_ID: string = "81920000-0000-4000-8000-0000000000e4";
const LINK: string =
  "https://oneuptime.example.com/accounts/register?email=ada%40example.com&token=81910000-0000-4000-8000-0000000000fe";

// [the page, the id of its table of memberships]
const PAGES: Array<[string, FunctionComponent, string]> = [
  ["a project's Users", ProjectUsers, "project-users-table"],
  ["a project's user", ProjectUserView, "project-user-teams-table"],
  ["a project's team", ProjectTeamView, "project-team-members-table"],
  ["a user's Team Memberships", UserProjects, "user-team-memberships-table"],
];

function membership(id: string, hasAcceptedInvitation: boolean): TeamMember {
  const value: TeamMember = new TeamMember();
  value._id = id;
  value.hasAcceptedInvitation = hasAcceptedInvitation;
  return value;
}

const ROWS: Array<TeamMember> = [
  membership(NOT_SIGNED_UP_ID, true),
  membership(SIGNED_UP_ID, true),
  membership(PENDING_ID, false),
];

type Request = { url: URL; data: JSONObject };

let fetchSpy: SpyInstance<typeof API.fetch>;

function requestsTo(route: string): Array<Request> {
  return fetchSpy.mock.calls
    .map((call: Array<unknown>): Request => {
      return call[0] as Request;
    })
    .filter((request: Request): boolean => {
      return request.url.toString().endsWith(route);
    });
}

beforeEach(() => {
  mockCanSendEmail = false;
  mockTables.length = 0;
  mockFormModals.length = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("81910000-0000-4000-8000-0000000000d2"));
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  // A project's user page reads who the user is from one of their memberships.
  mockGetList.mockImplementation(async (): Promise<unknown> => {
    const user: User = new User();
    user._id = "81910000-0000-4000-8000-0000000000d3";
    user.email = new Email("ada@example.com");

    const member: TeamMember = new TeamMember();
    member.user = user;

    return { data: [member], count: 1, skip: 0, limit: 1 };
  });

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async (
    request: Request,
  ) => {
    if (request.url.toString().endsWith(NOT_SIGNED_UP_ROUTE)) {
      return new HTTPResponse<JSONObject>(
        200,
        { teamMemberIds: [NOT_SIGNED_UP_ID] },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      {
        link: LINK,
        isRegistered: false,
        isAccepted: false,
        email: "ada@example.com",
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

function latestTable(tableId: string): MockProps {
  const table: MockProps | undefined = mockTables
    .filter((props: MockProps): boolean => {
      return props["id"] === tableId;
    })
    .pop();

  expect(table).toBeDefined();

  return table!;
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

function linkAction(tableId: string): CapturedAction {
  const action: CapturedAction | undefined = (
    (latestTable(tableId)["actionButtons"] as Array<CapturedAction>) || []
  ).find((candidate: CapturedAction): boolean => {
    return candidate.title === INVITATION_LINK_COPY.getLink;
  });

  expect(action).toBeDefined();

  return action!;
}

async function rowsFetched(tableId: string): Promise<void> {
  const onFetchSuccess: unknown = latestTable(tableId)["onFetchSuccess"];

  expect(typeof onFetchSuccess).toBe("function");

  await act(async (): Promise<void> => {
    (onFetchSuccess as (rows: Array<TeamMember>, count: number) => void)(
      ROWS,
      ROWS.length,
    );
  });
}

function statusText(tableId: string, row: TeamMember): string {
  const columns: Array<{
    title: string;
    getElement?: (item: TeamMember) => ReactElement;
  }> =
    (latestTable(tableId)["columns"] as Array<{
      title: string;
      getElement?: (item: TeamMember) => ReactElement;
    }>) || [];
  // The Status column: the one that draws whether they joined.
  const column:
    | { title: string; getElement?: (item: TeamMember) => ReactElement }
    | undefined = columns.find(
    (candidate: {
      title: string;
      getElement?: (item: TeamMember) => ReactElement;
    }): boolean => {
      return (
        candidate.title === "Status" ||
        candidate.title === "pages.userProjects.columnStatus"
      );
    },
  );

  expect(column?.getElement).toBeDefined();

  const { container, unmount } = render(<>{column!.getElement!(row)}</>);
  const text: string = container.textContent || "";
  unmount();

  return text;
}

describe.each(PAGES)(
  "%s",
  (_page: string, Page: FunctionComponent, tableId: string) => {
    test("a member who has not signed up is shown so, and offered their link", async () => {
      await renderPage(Page, tableId);
      await rowsFetched(tableId);

      await waitFor(() => {
        expect(Boolean(linkAction(tableId).isVisible!(ROWS[0]!))).toBe(true);
      });

      expect(statusText(tableId, ROWS[0]!)).toContain(
        INVITATION_LINK_COPY.notSignedUpPill,
      );
      expect(Boolean(linkAction(tableId).isVisible!(ROWS[1]!))).toBe(false);
      expect(statusText(tableId, ROWS[1]!)).not.toContain(
        INVITATION_LINK_COPY.notSignedUpPill,
      );
      expect(Boolean(linkAction(tableId).isVisible!(ROWS[2]!))).toBe(true);

      // Only the accepted rows were asked about.
      expect(requestsTo(NOT_SIGNED_UP_ROUTE)[0]!.data).toEqual({
        teamMemberIds: [NOT_SIGNED_UP_ID, SIGNED_UP_ID],
      });
    });

    test("the link it opens is that member's", async () => {
      await renderPage(Page, tableId);
      await rowsFetched(tableId);

      await waitFor(() => {
        expect(Boolean(linkAction(tableId).isVisible!(ROWS[0]!))).toBe(true);
      });

      await act(async (): Promise<void> => {
        linkAction(tableId).onClick(
          ROWS[0]!,
          () => {},
          () => {},
        );
      });

      expect(
        await screen.findByTestId("invitation-link-value"),
      ).toHaveTextContent(LINK);
      expect(requestsTo(INVITATION_LINK_ROUTE)[0]!.data).toEqual({
        teamMemberId: NOT_SIGNED_UP_ID,
      });
    });

    test.each([[true], [null]])(
      "can send %p: nobody is asked about, nor shown",
      async (canSendEmail: boolean | null) => {
        mockCanSendEmail = canSendEmail;

        await renderPage(Page, tableId);
        await rowsFetched(tableId);

        expect(requestsTo(NOT_SIGNED_UP_ROUTE)).toHaveLength(0);
        expect(Boolean(linkAction(tableId).isVisible!(ROWS[0]!))).toBe(false);
        expect(statusText(tableId, ROWS[0]!)).not.toContain(
          INVITATION_LINK_COPY.notSignedUpPill,
        );
      },
    );
  },
);

/*
 * A project's user > Teams > Add to Team (#8192).
 */
describe("Add to Team, on a project's user", () => {
  const TABLE: string = "project-user-teams-table";

  function teamDescription(): unknown {
    const fields: Array<{ title: string; description?: unknown }> =
      (latestTable(TABLE)["formFields"] as Array<{
        title: string;
        description?: unknown;
      }>) || [];

    return fields.find((field: { title: string }): boolean => {
      return field.title === "Team";
    })?.description;
  }

  test.each([
    [false, INVITATION_LINK_COPY.inviteDescriptionForAdmin],
    [true, "Select the team you would like to add this user to."],
    [null, "Select the team you would like to add this user to."],
  ])(
    "can send %p: the Team field says %p",
    async (canSendEmail: boolean | null, words: string) => {
      mockCanSendEmail = canSendEmail;

      await renderPage(ProjectUserView, TABLE);

      expect(teamDescription()).toBe(words);
    },
  );

  test("on a server that cannot send email, hands over the new membership's link", async () => {
    await renderPage(ProjectUserView, TABLE);

    const onCreateSuccess: (
      item: TeamMember,
      modalType?: ModalType,
    ) => Promise<TeamMember> = latestTable(TABLE)["onCreateSuccess"] as (
      item: TeamMember,
      modalType?: ModalType,
    ) => Promise<TeamMember>;

    await act(async (): Promise<void> => {
      await onCreateSuccess(membership(CREATED_ID, false), ModalType.Create);
    });

    expect(
      await screen.findByTestId("invitation-link-value"),
    ).toHaveTextContent(LINK);
    expect(requestsTo(INVITATION_LINK_ROUTE)[0]!.data).toEqual({
      teamMemberId: CREATED_ID,
    });
  });

  test.each([[true], [null]])(
    "can send %p: no link is read",
    async (canSendEmail: boolean | null) => {
      mockCanSendEmail = canSendEmail;

      await renderPage(ProjectUserView, TABLE);

      await act(async (): Promise<void> => {
        await (
          latestTable(TABLE)["onCreateSuccess"] as (
            item: TeamMember,
            modalType?: ModalType,
          ) => Promise<TeamMember>
        )(membership(CREATED_ID, false), ModalType.Create);
      });

      expect(requestsTo(INVITATION_LINK_ROUTE)).toHaveLength(0);
    },
  );
});

/*
 * A user's Projects > Add to Project (#8192).
 */
describe("Add to Project, on a user's Projects", () => {
  async function openAddToProject(): Promise<MockProps> {
    await renderPage(UserProjects, "user-projects-table");

    const card: {
      buttons: Array<{ title: string; onClick: () => void }>;
    } = latestTable("user-projects-table")["cardProps"] as {
      buttons: Array<{ title: string; onClick: () => void }>;
    };

    await act(async (): Promise<void> => {
      card.buttons[0]!.onClick();
    });

    await waitFor(() => {
      expect(mockFormModals.length).toBeGreaterThan(0);
    });

    return mockFormModals[mockFormModals.length - 1]!;
  }

  function fieldDescription(modal: MockProps, title: string): unknown {
    const fields: Array<{ title: string; description?: unknown }> = (
      modal["formProps"] as {
        fields: Array<{ title: string; description?: unknown }>;
      }
    ).fields;

    return fields.find((field: { title: string }): boolean => {
      return field.title === title;
    })?.description;
  }

  test.each([
    [false, INVITATION_LINK_COPY.inviteDescriptionForAdmin],
    [true, "pages.userProjects.fieldTeamDescription"],
    [null, "pages.userProjects.fieldTeamDescription"],
  ])(
    "can send %p: the team field says %p",
    async (canSendEmail: boolean | null, words: string) => {
      mockCanSendEmail = canSendEmail;

      const modal: MockProps = await openAddToProject();

      expect(fieldDescription(modal, "pages.userProjects.fieldTeam")).toBe(
        words,
      );
    },
  );

  test("on a server that cannot send email, hands over the new membership's link", async () => {
    const modal: MockProps = await openAddToProject();

    await act(async (): Promise<void> => {
      (modal["onSuccess"] as (item: TeamMember) => void)(
        membership(CREATED_ID, false),
      );
    });

    expect(
      await screen.findByTestId("invitation-link-value"),
    ).toHaveTextContent(LINK);
    expect(requestsTo(INVITATION_LINK_ROUTE)[0]!.data).toEqual({
      teamMemberId: CREATED_ID,
    });
  });

  test("where the server sends email, the dialog just closes", async () => {
    mockCanSendEmail = true;

    const modal: MockProps = await openAddToProject();
    const before: number = mockFormModals.length;

    await act(async (): Promise<void> => {
      (modal["onSuccess"] as (item: TeamMember) => void)(
        membership(CREATED_ID, false),
      );
    });

    expect(requestsTo(INVITATION_LINK_ROUTE)).toHaveLength(0);
    expect(screen.queryByTestId("invitation-link-value")).toBeNull();
    expect(screen.queryByTestId("model-form-modal")).toBeNull();
    expect(mockFormModals.length).toBe(before);
  });

  test("a membership that came back without an id reads no link", async () => {
    const modal: MockProps = await openAddToProject();

    await act(async (): Promise<void> => {
      (modal["onSuccess"] as (item: TeamMember) => void)(new TeamMember());
    });

    expect(requestsTo(INVITATION_LINK_ROUTE)).toHaveLength(0);
  });
});
