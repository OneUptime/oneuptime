import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { FunctionComponent } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { MemoryRouter } from "react-router-dom";

/*
 * GET INVITATION LINK, ON A PENDING PERSON'S ROW (#7168).
 *
 * On a server that cannot send email, nobody is emailed an invitation. A
 * master admin is shown the link once, right after their own Invite; a
 * person somebody else invited - a project owner, who is told to ask the
 * server's admin - had no link anybody could read, nor did one whose link
 * ran out. Now every Dashboard list that shows a pending person as Invited
 * offers Get Invitation Link on their row:
 *
 *   - to a master admin only, on a server known not to send email only, on
 *     a pending row only - nothing changes for anybody else, while the
 *     answer is being read, or once email works;
 *   - it opens the invitation link's dialog for that row's invitation, which
 *     reads a fresh link (POST /team-member/invitation-link), and Done
 *     leaves the person on the list.
 *
 * The pages are the real ones (Settings > Users, a person's Teams, a team's
 * Members), with their tables stood in for by one that records its props:
 * what is held is the row action each page hands its table, and the dialog
 * the page draws when it is taken.
 */

let mockIsMasterAdmin: boolean = true;
let mockCanSendEmail: boolean | null = false;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockIsMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
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

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

type CapturedAction = {
  title: string;
  icon?: unknown;
  buttonStyleType?: unknown;
  isVisible?: ((item: TeamMember) => boolean | undefined) | undefined;
  onClick: (
    item: TeamMember,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
};

type CapturedTableProps = {
  actionButtons?: Array<CapturedAction> | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTableProps = props;
      return null;
    },
  };
});

import Users from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/Index";
import UserViewTeams from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/Teams";
import TeamViewMembers from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Members";
import { SERVER_EMAIL_COPY } from "../../../../App/FeatureSet/Dashboard/src/Utils/ServerEmail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import {
  INVITATION_LINK_COPY,
  INVITATION_LINK_ROUTE,
  getInvitationLinkRowAction,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "71680000-0000-4000-8000-000000000001",
);
const PENDING_ID: string = "71680000-0000-4000-8000-0000000000c1";
const MEMBER_ID: string = "71680000-0000-4000-8000-0000000000c2";
const LINK: string =
  "https://oneuptime.example.com/accounts/register?email=grace%40example.com&token=71680000-0000-4000-8000-0000000000ff";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

function membership(id: string, hasAcceptedInvitation: boolean): TeamMember {
  const value: TeamMember = new TeamMember();
  value._id = id;
  value.hasAcceptedInvitation = hasAcceptedInvitation;
  return value;
}

const PAGES: Array<[string, FunctionComponent<PageComponentProps>]> = [
  ["Settings > Users", Users],
  ["a person's Teams", UserViewTeams],
  ["a team's Members", TeamViewMembers],
];

let fetchSpy: SpyInstance<typeof API.fetch>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

beforeEach(() => {
  mockIsMasterAdmin = true;
  mockCanSendEmail = false;
  capturedTableProps = null;

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID("71680000-0000-4000-8000-0000000000d1"),
  );
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  // No SCIM Push Groups: people are invited and removed here.
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);

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
  jest.restoreAllMocks();
});

async function renderPage(
  Page: FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(
    <MemoryRouter>
      <Page
        pageRoute={new Route("/dashboard/settings/users")}
        currentProject={currentProject}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedTableProps).not.toBeNull();
  });
}

function getLinkAction(): CapturedAction {
  const action: CapturedAction | undefined =
    capturedTableProps?.actionButtons?.find(
      (candidate: CapturedAction): boolean => {
        return candidate.title === INVITATION_LINK_COPY.getLink;
      },
    );

  expect(action).toBeDefined();

  return action!;
}

describe("the row action", () => {
  test("is called Get Invitation Link, on both dashboards", () => {
    expect(INVITATION_LINK_COPY.getLink).toBe("Get Invitation Link");
    expect(SERVER_EMAIL_COPY.getInvitationLink).toBe(
      INVITATION_LINK_COPY.getLink,
    );
  });

  test("is a quiet link action, never a destructive one", () => {
    const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
      isAvailable: true,
      onOpen: (): void => {},
    }) as unknown as CapturedAction;

    expect(action.icon).toBe(IconProp.Link);
    expect(action.buttonStyleType).toBe(ButtonStyleType.OUTLINE);
  });

  test.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])(
    "available %p, accepted %p: shown %p",
    (isAvailable: boolean, hasAccepted: boolean, isShown: boolean) => {
      const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
        isAvailable: isAvailable,
        onOpen: (): void => {},
      }) as unknown as CapturedAction;

      expect(
        Boolean(action.isVisible!(membership(PENDING_ID, hasAccepted))),
      ).toBe(isShown);
    },
  );

  /*
   * On a server that sends email, a pending row whose latest invitation
   * email was not sent offers it too (#9511) - never a member's row.
   */
  test.each([
    // [available, email not sent, accepted, shown]
    [false, true, false, true],
    [false, false, false, false],
    [false, true, true, false],
    [true, false, false, true],
    [true, true, true, false],
  ])(
    "available %p, email not sent %p, accepted %p: shown %p",
    (
      isAvailable: boolean,
      isEmailNotSent: boolean,
      hasAccepted: boolean,
      isShown: boolean,
    ) => {
      const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
        isAvailable: isAvailable,
        isEmailNotSent: (): boolean => {
          return isEmailNotSent;
        },
        onOpen: (): void => {},
      }) as unknown as CapturedAction;

      expect(
        Boolean(action.isVisible!(membership(PENDING_ID, hasAccepted))),
      ).toBe(isShown);
    },
  );

  test("hands its page the row it was opened from, so the dialog can say why", () => {
    const opened: Array<TeamMember> = [];
    const row: TeamMember = membership(PENDING_ID, false);
    const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
      isAvailable: true,
      onOpen: (_teamMemberId: ObjectID, item: TeamMember): void => {
        opened.push(item);
      },
    }) as unknown as CapturedAction;

    action.onClick(
      row,
      () => {},
      () => {},
    );

    expect(opened).toEqual([row]);
  });

  test("a row with no id offers nothing to open", () => {
    const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
      isAvailable: true,
      onOpen: (): void => {},
    }) as unknown as CapturedAction;

    expect(Boolean(action.isVisible!(new TeamMember()))).toBe(false);
  });

  test("opens the row's own invitation, and says it is done", () => {
    const opened: Array<string> = [];
    const onCompleteAction: Mock<() => void> = jest.fn<() => void>();
    const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
      isAvailable: true,
      onOpen: (teamMemberId: ObjectID): void => {
        opened.push(teamMemberId.toString());
      },
    }) as unknown as CapturedAction;

    action.onClick(membership(PENDING_ID, false), onCompleteAction, () => {});

    expect(opened).toEqual([PENDING_ID]);
    expect(onCompleteAction).toHaveBeenCalledTimes(1);
  });
});

describe.each(PAGES)(
  "%s",
  (_page: string, Page: FunctionComponent<PageComponentProps>) => {
    test.each([
      // [server can send email, master admin, shown on a pending row]
      [false, true, true],
      [false, false, false],
      [true, true, false],
      [true, false, false],
      // While the answer is on its way, nothing changes.
      [null, true, false],
    ])(
      "can send %p, master admin %p: a pending row offers it: %p",
      async (
        canSendEmail: boolean | null,
        isMasterAdmin: boolean,
        isShown: boolean,
      ) => {
        mockCanSendEmail = canSendEmail;
        mockIsMasterAdmin = isMasterAdmin;

        await renderPage(Page);

        const action: CapturedAction = getLinkAction();

        expect(Boolean(action.isVisible!(membership(PENDING_ID, false)))).toBe(
          isShown,
        );
        // Somebody who has joined has no invitation to send.
        expect(Boolean(action.isVisible!(membership(MEMBER_ID, true)))).toBe(
          false,
        );
      },
    );

    test("opens the dialog with a fresh link for that row's invitation, and Done stays on the list", async () => {
      await renderPage(Page);

      const onCompleteAction: Mock<() => void> = jest.fn<() => void>();

      await act(async (): Promise<void> => {
        getLinkAction().onClick(
          membership(PENDING_ID, false),
          onCompleteAction,
          () => {},
        );
      });

      expect(onCompleteAction).toHaveBeenCalledTimes(1);

      const value: HTMLElement = await screen.findByTestId(
        "invitation-link-value",
      );

      expect(value).toHaveTextContent(LINK);

      const linkRequests: Array<{ url: URL; data: JSONObject }> =
        fetchSpy.mock.calls
          .map((call: Array<unknown>) => {
            return call[0] as { url: URL; data: JSONObject };
          })
          .filter((request: { url: URL }): boolean => {
            return request.url.toString().endsWith(INVITATION_LINK_ROUTE);
          });

      expect(linkRequests).toHaveLength(1);
      expect(linkRequests[0]!.data).toEqual({ teamMemberId: PENDING_ID });

      await act(async (): Promise<void> => {
        screen.getByRole("button", { name: SERVER_EMAIL_COPY.done }).click();
      });

      expect(screen.queryByTestId("invitation-link-value")).toBeNull();
      expect(navigateSpy).not.toHaveBeenCalled();
    });
  },
);
