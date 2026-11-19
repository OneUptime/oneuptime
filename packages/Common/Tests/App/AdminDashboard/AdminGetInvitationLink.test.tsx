import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * THE ADMIN DASHBOARD: GET INVITATION LINK ON EVERY PENDING ROW (#7168).
 *
 * Everybody on the Admin Dashboard is a master admin, who may read any
 * invitation's link. On a server known not to send email, every list there
 * that shows a pending person as Invited offers Get Invitation Link on
 * their row - a project's Users, a project's user, a project's team, and a
 * user's Team Memberships - and it opens the invitation link's dialog for
 * that row, which Done closes where it was. A row of somebody who has
 * joined offers nothing, nor does any row where the server sends email, or
 * while that is still being read.
 *
 * The real pages, with the tables, the page chrome and the network stood
 * in for.
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
import {
  INVITATION_LINK_COPY,
  INVITATION_LINK_ROUTE,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
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

const PENDING_ID: string = "71680000-0000-4000-8000-0000000000e1";
const MEMBER_ID: string = "71680000-0000-4000-8000-0000000000e2";
const LINK: string =
  "https://oneuptime.example.com/accounts/register?email=grace%40example.com&token=71680000-0000-4000-8000-0000000000fe";

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

let fetchSpy: SpyInstance<typeof API.fetch>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

beforeEach(() => {
  mockCanSendEmail = false;
  mockTables.length = 0;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("71680000-0000-4000-8000-0000000000d2"));
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  // A project's user page reads who the user is from one of their memberships.
  mockGetList.mockImplementation(async (): Promise<unknown> => {
    const user: User = new User();
    user._id = "71680000-0000-4000-8000-0000000000d3";
    user.email = new Email("grace@example.com");

    const member: TeamMember = new TeamMember();
    member.user = user;

    return { data: [member], count: 1, skip: 0, limit: 1 };
  });

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async () => {
    return new HTTPResponse<JSONObject>(
      200,
      { link: LINK, isRegistered: false, email: "grace@example.com" },
      {},
    );
  }) as never) as unknown as SpyInstance<typeof API.fetch>;
});

afterEach(() => {
  cleanup();
  mockGetList.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(
  Page: FunctionComponent,
  tableId: string,
): Promise<CapturedAction> {
  render(<Page />);

  await waitFor(() => {
    expect(
      mockTables.some((props: MockProps): boolean => {
        return props["id"] === tableId;
      }),
    ).toBe(true);
  });

  const table: MockProps = mockTables
    .filter((props: MockProps): boolean => {
      return props["id"] === tableId;
    })
    .pop()!;
  const action: CapturedAction | undefined = (
    (table["actionButtons"] as Array<CapturedAction> | undefined) || []
  ).find((candidate: CapturedAction): boolean => {
    return candidate.title === INVITATION_LINK_COPY.getLink;
  });

  expect(action).toBeDefined();

  return action!;
}

describe.each(PAGES)(
  "%s",
  (_page: string, Page: FunctionComponent, tableId: string) => {
    test.each([
      // [server can send email, shown on a pending row]
      [false, true],
      [true, false],
      // While the answer is on its way, nothing changes.
      [null, false],
    ])(
      "can send %p: a pending row offers it: %p",
      async (canSendEmail: boolean | null, isShown: boolean) => {
        mockCanSendEmail = canSendEmail;

        const action: CapturedAction = await renderPage(Page, tableId);

        expect(Boolean(action.isVisible!(membership(PENDING_ID, false)))).toBe(
          isShown,
        );
        expect(Boolean(action.isVisible!(membership(MEMBER_ID, true)))).toBe(
          false,
        );
      },
    );

    test("opens the dialog with that row's link, and Done closes it where it was", async () => {
      const action: CapturedAction = await renderPage(Page, tableId);

      await act(async (): Promise<void> => {
        action.onClick(
          membership(PENDING_ID, false),
          () => {},
          () => {},
        );
      });

      expect(
        await screen.findByTestId("invitation-link-value"),
      ).toHaveTextContent(LINK);

      const linkRequests: Array<{ url: URL; data: JSONObject }> =
        fetchSpy.mock.calls
          .map((call: Array<unknown>) => {
            return call[0] as { url: URL; data: JSONObject };
          })
          .filter((request: { url: URL }): boolean => {
            return request.url.toString().endsWith(INVITATION_LINK_ROUTE);
          });

      expect(
        linkRequests.map((request: { data: JSONObject }) => {
          return request.data;
        }),
      ).toEqual([{ teamMemberId: PENDING_ID }]);

      await act(async (): Promise<void> => {
        screen.getByRole("button", { name: INVITATION_LINK_COPY.done }).click();
      });

      expect(screen.queryByTestId("invitation-link-value")).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  },
);
