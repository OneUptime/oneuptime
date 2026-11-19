import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, { FunctionComponent, ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { MemoryRouter } from "react-router-dom";

/*
 * SOMEONE WHOSE INVITATION WAS ACCEPTED FOR THEM, BEFORE THEY HAD AN
 * ACCOUNT (#8191), AND A PERSON'S TEAMS > INVITE (#8192), ON THE DASHBOARD.
 *
 * A master admin can accept an invitation for someone with no account
 * (the Admin Dashboard's "Accept the invitation automatically"). The lists
 * showed them as Member, and only a pending row offered Get Invitation
 * Link, so once the dialog after the invite was closed nobody could read
 * their sign-up link. Now, for a master admin on a server known not to
 * send email:
 *
 *   - a list asks the server which of its accepted rows have not signed up
 *     (POST /team-member/not-signed-up), and only those, at most a page;
 *   - such a row says "Not Signed Up Yet" beside Member, and offers Get
 *     Invitation Link;
 *   - nobody else - a project owner, anyone while email works, anyone while
 *     the server's answer is read - asks, or is shown either.
 *
 * And a person's Teams > Invite, which made a pending membership in
 * silence, says no email goes out and hands a master admin the link.
 *
 * The real pages (Settings > Users, a person's Teams, a team's Members),
 * their tables stood in for by one that records its props.
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
  isVisible?: ((item: TeamMember) => boolean | undefined) | undefined;
  onClick: (
    item: TeamMember,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => void;
};

type CapturedColumn = {
  title: string;
  getElement?: ((item: TeamMember) => ReactElement) | undefined;
};

type CapturedField = {
  title: string;
  description?: string | undefined;
};

type CapturedTableProps = {
  actionButtons?: Array<CapturedAction> | undefined;
  columns?: Array<CapturedColumn> | undefined;
  formFields?: Array<CapturedField> | undefined;
  onFetchSuccess?:
    | ((data: Array<TeamMember>, totalCount: number) => void)
    | undefined;
  onCreateSuccess?:
    | ((item: TeamMember, modalType?: ModalType) => Promise<TeamMember>)
    | undefined;
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
import InvitationLinkModal, {
  INVITATION_LINK_COPY,
  INVITATION_LINK_ROUTE,
  InvitationLink,
  getInvitationLinkDescription,
  getInvitationLinkRowAction,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
import {
  MAX_ROWS_PER_SIGN_UP_READ,
  MembersNotSignedUp,
  NOT_SIGNED_UP_ROUTE,
  fetchMembershipsNotSignedUp,
  getRowsToAskAbout,
  useMembersNotSignedUp,
} from "../../../UI/Components/InvitationLink/MembersNotSignedUp";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "81910000-0000-4000-8000-000000000001",
);
// Accepted for them before they had an account.
const NOT_SIGNED_UP_ID: string = "81910000-0000-4000-8000-0000000000c1";
// Accepted, and has signed up.
const SIGNED_UP_ID: string = "81910000-0000-4000-8000-0000000000c2";
// Still pending.
const PENDING_ID: string = "81910000-0000-4000-8000-0000000000c3";
const LINK: string =
  "https://oneuptime.example.com/accounts/register?email=ada%40example.com&token=81910000-0000-4000-8000-0000000000ff";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

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

const PAGES: Array<[string, FunctionComponent<PageComponentProps>]> = [
  ["Settings > Users", Users],
  ["a person's Teams", UserViewTeams],
  ["a team's Members", TeamViewMembers],
];

type Request = { url: URL; data: JSONObject };

let fetchSpy: SpyInstance<typeof API.fetch>;
let notSignedUpAnswer: () => Promise<unknown>;

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
  mockIsMasterAdmin = true;
  mockCanSendEmail = false;
  capturedTableProps = null;

  notSignedUpAnswer = async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(
      200,
      { teamMemberIds: [NOT_SIGNED_UP_ID] },
      {},
    );
  };

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID("81910000-0000-4000-8000-0000000000d1"),
  );
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  // No SCIM Push Groups: people are invited and removed here.
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async (
    request: Request,
  ) => {
    if (request.url.toString().endsWith(NOT_SIGNED_UP_ROUTE)) {
      return await notSignedUpAnswer();
    }

    return new HTTPResponse<JSONObject>(
      200,
      {
        link: LINK,
        isRegistered: false,
        isAccepted: true,
        email: "ada@example.com",
      },
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

function table(): CapturedTableProps {
  expect(capturedTableProps).not.toBeNull();
  return capturedTableProps!;
}

function linkAction(): CapturedAction {
  const action: CapturedAction | undefined = table().actionButtons?.find(
    (candidate: CapturedAction): boolean => {
      return candidate.title === INVITATION_LINK_COPY.getLink;
    },
  );

  expect(action).toBeDefined();

  return action!;
}

// The table has drawn these rows: as ModelTable hands them over.
async function rowsFetched(rows: Array<TeamMember> = ROWS): Promise<void> {
  expect(table().onFetchSuccess).toBeDefined();

  await act(async (): Promise<void> => {
    table().onFetchSuccess!(rows, rows.length);
  });
}

function statusText(row: TeamMember): string {
  const column: CapturedColumn | undefined = table().columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Status";
    },
  );

  expect(column?.getElement).toBeDefined();

  const { container, unmount } = render(<>{column!.getElement!(row)}</>);
  const text: string = container.textContent || "";
  unmount();

  return text;
}

function isOffered(row: TeamMember): boolean {
  return Boolean(linkAction().isVisible!(row));
}

describe("the row action", () => {
  test.each([
    // [available, accepted, not signed up, shown]
    [true, false, false, true],
    [true, true, false, false],
    [true, true, true, true],
    [false, true, true, false],
    [false, false, false, false],
  ])(
    "available %p, accepted %p, not signed up %p: shown %p",
    (
      isAvailable: boolean,
      hasAccepted: boolean,
      isNotSignedUp: boolean,
      isShown: boolean,
    ) => {
      const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
        isAvailable: isAvailable,
        isNotSignedUp: (): boolean => {
          return isNotSignedUp;
        },
        onOpen: (): void => {},
      }) as unknown as CapturedAction;

      expect(
        Boolean(action.isVisible!(membership(NOT_SIGNED_UP_ID, hasAccepted))),
      ).toBe(isShown);
    },
  );

  test("without a way to tell, a member's row offers nothing, as before", () => {
    const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
      isAvailable: true,
      onOpen: (): void => {},
    }) as unknown as CapturedAction;

    expect(Boolean(action.isVisible!(membership(SIGNED_UP_ID, true)))).toBe(
      false,
    );
  });

  test("a row with no id offers nothing, even when not signed up", () => {
    const action: CapturedAction = getInvitationLinkRowAction<TeamMember>({
      isAvailable: true,
      isNotSignedUp: (): boolean => {
        return true;
      },
      onOpen: (): void => {},
    }) as unknown as CapturedAction;
    const row: TeamMember = new TeamMember();
    row.hasAcceptedInvitation = true;

    expect(Boolean(action.isVisible!(row))).toBe(false);
  });
});

describe("the dialog's words", () => {
  const answer: (data: Partial<InvitationLink>) => InvitationLink = (
    data: Partial<InvitationLink>,
  ): InvitationLink => {
    return {
      link: LINK,
      isRegistered: false,
      isAccepted: false,
      email: "ada@example.com",
      ...data,
    };
  };

  test.each([
    // [registered, accepted, what it says]
    [false, false, INVITATION_LINK_COPY.description],
    [false, true, INVITATION_LINK_COPY.description],
    [true, false, INVITATION_LINK_COPY.registeredDescription],
    [true, true, INVITATION_LINK_COPY.memberDescription],
  ])(
    "registered %p, accepted %p: %p",
    (isRegistered: boolean, isAccepted: boolean, words: string) => {
      expect(
        getInvitationLinkDescription(
          answer({ isRegistered: isRegistered, isAccepted: isAccepted }),
        ),
      ).toBe(words);
    },
  );

  test("a member with an account has nothing to accept, and is told only to sign in", () => {
    expect(INVITATION_LINK_COPY.memberDescription).not.toMatch(/accept/i);
    expect(INVITATION_LINK_COPY.memberDescription).toContain(
      "send them this link to sign in.",
    );
    expect(INVITATION_LINK_COPY.registeredDescription).toContain(
      "accept the invitation",
    );
  });

  test("the dialog says so for a member with an account", async () => {
    fetchSpy.mockImplementation((async () => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          link: "https://oneuptime.example.com/accounts",
          isRegistered: true,
          isAccepted: true,
          email: "ada@example.com",
        },
        {},
      );
    }) as never);

    render(
      <InvitationLinkModal
        teamMemberId={new ObjectID(SIGNED_UP_ID)}
        onClose={(): void => {}}
      />,
    );

    expect(
      await screen.findByText(
        "This server cannot send email, so ada@example.com was not emailed. They already have an account and are a member now: send them this link to sign in.",
      ),
    ).toBeInTheDocument();
  });

  test("an answer that leaves out whether it was accepted reads as not accepted", async () => {
    fetchSpy.mockImplementation((async () => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          link: "https://oneuptime.example.com/accounts",
          isRegistered: true,
          email: "ada@example.com",
        },
        {},
      );
    }) as never);

    render(
      <InvitationLinkModal
        teamMemberId={new ObjectID(SIGNED_UP_ID)}
        onClose={(): void => {}}
      />,
    );

    expect(
      await screen.findByText(
        "This server cannot send email, so ada@example.com was not emailed. They already have an account: send them this link to sign in and accept the invitation.",
      ),
    ).toBeInTheDocument();
  });

  test("both dashboards call the pill and the words alike", () => {
    expect(SERVER_EMAIL_COPY.notSignedUpPill).toBe("Not Signed Up Yet");
    expect(SERVER_EMAIL_COPY.notSignedUpPill).toBe(
      INVITATION_LINK_COPY.notSignedUpPill,
    );
    expect(SERVER_EMAIL_COPY.invitationLinkMemberDescription).toBe(
      INVITATION_LINK_COPY.memberDescription,
    );
  });
});

describe("asking which members have not signed up", () => {
  test("only accepted rows are asked about, each once", () => {
    expect(
      getRowsToAskAbout([
        ...ROWS,
        membership(NOT_SIGNED_UP_ID, true),
        new TeamMember(),
      ]),
    ).toEqual([NOT_SIGNED_UP_ID, SIGNED_UP_ID]);
  });

  test(`at most a page of them (${MAX_ROWS_PER_SIGN_UP_READ})`, () => {
    const many: Array<TeamMember> = Array.from(
      { length: MAX_ROWS_PER_SIGN_UP_READ + 20 },
      (): TeamMember => {
        return membership(ObjectID.generate().toString(), true);
      },
    );

    expect(getRowsToAskAbout(many)).toHaveLength(MAX_ROWS_PER_SIGN_UP_READ);
  });

  test("nobody to ask about sends nothing", async () => {
    expect(await fetchMembershipsNotSignedUp([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("asks the server, with the rows' ids", async () => {
    expect(
      await fetchMembershipsNotSignedUp([NOT_SIGNED_UP_ID, SIGNED_UP_ID]),
    ).toEqual([NOT_SIGNED_UP_ID]);
    expect(
      requestsTo(NOT_SIGNED_UP_ROUTE).map((request: Request): JSONObject => {
        return request.data;
      }),
    ).toEqual([{ teamMemberIds: [NOT_SIGNED_UP_ID, SIGNED_UP_ID] }]);
  });

  test("an answer naming rows it was not asked about is not believed", async () => {
    notSignedUpAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(
        200,
        { teamMemberIds: [NOT_SIGNED_UP_ID, PENDING_ID, 7] },
        {},
      );
    };

    expect(await fetchMembershipsNotSignedUp([NOT_SIGNED_UP_ID])).toEqual([
      NOT_SIGNED_UP_ID,
    ]);
  });

  test.each([
    [
      "a refusal",
      async (): Promise<unknown> => {
        return new HTTPErrorResponse(
          422,
          { message: "Not a master admin." },
          {},
        );
      },
    ],
    [
      "an answer with no list",
      async (): Promise<unknown> => {
        return new HTTPResponse<JSONObject>(200, {}, {});
      },
    ],
    [
      "a failed request",
      async (): Promise<unknown> => {
        throw new Error("offline");
      },
    ],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s shows nobody as not signed up",
    async (_what: string, answer: () => Promise<unknown>) => {
      notSignedUpAnswer = answer;

      expect(await fetchMembershipsNotSignedUp([NOT_SIGNED_UP_ID])).toEqual([]);
    },
  );
});

describe("useMembersNotSignedUp", () => {
  test("not available: asks nothing, and nobody is shown as not signed up", async () => {
    const { result } = renderHook(() => {
      return useMembersNotSignedUp(false);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });

    expect(requestsTo(NOT_SIGNED_UP_ROUTE)).toHaveLength(0);
    expect(result.current.isNotSignedUp(ROWS[0]!)).toBe(false);
  });

  test("available: the accepted rows are asked about, and the answer is drawn", async () => {
    const { result } = renderHook(() => {
      return useMembersNotSignedUp(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });

    await waitFor(() => {
      expect(result.current.isNotSignedUp(ROWS[0]!)).toBe(true);
    });
    expect(result.current.isNotSignedUp(ROWS[1]!)).toBe(false);
    expect(result.current.isNotSignedUp(ROWS[2]!)).toBe(false);
    expect(requestsTo(NOT_SIGNED_UP_ROUTE)[0]!.data).toEqual({
      teamMemberIds: [NOT_SIGNED_UP_ID, SIGNED_UP_ID],
    });
  });

  test("rows drawn before it became available are asked about once it is", async () => {
    let isAvailable: boolean = false;
    const { result, rerender } = renderHook(() => {
      return useMembersNotSignedUp(isAvailable);
    });

    // The table drew its rows while the server's answer was still read.
    const earlyOnFetchSuccess: MembersNotSignedUp["onFetchSuccess"] =
      result.current.onFetchSuccess;

    await act(async (): Promise<void> => {
      earlyOnFetchSuccess(ROWS);
    });

    expect(requestsTo(NOT_SIGNED_UP_ROUTE)).toHaveLength(0);

    isAvailable = true;

    await act(async (): Promise<void> => {
      rerender();
    });

    await waitFor(() => {
      expect(result.current.isNotSignedUp(ROWS[0]!)).toBe(true);
    });
  });

  test("once no longer available, nobody is shown as not signed up", async () => {
    let isAvailable: boolean = true;
    const { result, rerender } = renderHook(() => {
      return useMembersNotSignedUp(isAvailable);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });
    await waitFor(() => {
      expect(result.current.isNotSignedUp(ROWS[0]!)).toBe(true);
    });

    isAvailable = false;

    await act(async (): Promise<void> => {
      rerender();
    });

    expect(result.current.isNotSignedUp(ROWS[0]!)).toBe(false);
  });

  test("only the latest page's answer is drawn", async () => {
    let releaseFirst: (() => void) | null = null;
    let calls: number = 0;

    notSignedUpAnswer = async (): Promise<unknown> => {
      calls++;

      if (calls === 1) {
        // The first page's answer comes back last.
        await new Promise<void>((resolve: () => void) => {
          releaseFirst = resolve;
        });

        return new HTTPResponse<JSONObject>(
          200,
          { teamMemberIds: [NOT_SIGNED_UP_ID] },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { teamMemberIds: [] }, {});
    };

    const { result } = renderHook(() => {
      return useMembersNotSignedUp(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });
    await act(async (): Promise<void> => {
      // The next page: the same person has signed up since.
      result.current.onFetchSuccess([membership(NOT_SIGNED_UP_ID, true)]);
    });
    await act(async (): Promise<void> => {
      releaseFirst!();
    });

    expect(result.current.isNotSignedUp(ROWS[0]!)).toBe(false);
  });

  test("a page with no accepted rows asks nothing", async () => {
    const { result } = renderHook(() => {
      return useMembersNotSignedUp(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess([membership(PENDING_ID, false)]);
    });

    expect(requestsTo(NOT_SIGNED_UP_ROUTE)).toHaveLength(0);
  });
});

describe.each(PAGES)(
  "%s",
  (_page: string, Page: FunctionComponent<PageComponentProps>) => {
    test("a member who has not signed up is shown so, and offered their link", async () => {
      await renderPage(Page);
      await rowsFetched();

      await waitFor(() => {
        expect(isOffered(ROWS[0]!)).toBe(true);
      });

      expect(statusText(ROWS[0]!)).toContain("Member");
      expect(statusText(ROWS[0]!)).toContain(SERVER_EMAIL_COPY.notSignedUpPill);
      // Somebody who has signed up has nothing to send.
      expect(isOffered(ROWS[1]!)).toBe(false);
      expect(statusText(ROWS[1]!)).not.toContain(
        SERVER_EMAIL_COPY.notSignedUpPill,
      );
      // A pending row is offered its link, as before, and says Invited.
      expect(isOffered(ROWS[2]!)).toBe(true);
      expect(statusText(ROWS[2]!)).not.toContain(
        SERVER_EMAIL_COPY.notSignedUpPill,
      );
    });

    test("the link it opens is that member's sign-up link", async () => {
      await renderPage(Page);
      await rowsFetched();

      await waitFor(() => {
        expect(isOffered(ROWS[0]!)).toBe(true);
      });

      await act(async (): Promise<void> => {
        linkAction().onClick(
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

    test.each([
      // [server can send email, master admin]
      [true, true],
      [false, false],
      [true, false],
      // While the answer is on its way, nothing changes.
      [null, true],
    ])(
      "can send %p, master admin %p: nobody is asked about, nor shown",
      async (canSendEmail: boolean | null, isMasterAdmin: boolean) => {
        mockCanSendEmail = canSendEmail;
        mockIsMasterAdmin = isMasterAdmin;

        await renderPage(Page);
        await rowsFetched();

        expect(requestsTo(NOT_SIGNED_UP_ROUTE)).toHaveLength(0);
        expect(isOffered(ROWS[0]!)).toBe(false);
        expect(statusText(ROWS[0]!)).not.toContain(
          SERVER_EMAIL_COPY.notSignedUpPill,
        );
      },
    );
  },
);

/*
 * A person's Teams > Invite (#8192): it made a pending membership and said
 * nothing of the server not sending email.
 */
describe("a person's Teams > Invite", () => {
  function teamField(): CapturedField {
    const field: CapturedField | undefined = table().formFields?.find(
      (candidate: CapturedField): boolean => {
        return candidate.title === "Team";
      },
    );

    expect(field).toBeDefined();

    return field!;
  }

  test.each([
    // [server can send email, master admin, what the Team field says]
    [false, true, SERVER_EMAIL_COPY.inviteEmailDescriptionForAdmin],
    [false, false, SERVER_EMAIL_COPY.inviteEmailDescription],
    [true, true, "Select the team you would like to add this user to."],
    [true, false, "Select the team you would like to add this user to."],
    [null, true, "Select the team you would like to add this user to."],
  ])(
    "can send %p, master admin %p: %p",
    async (
      canSendEmail: boolean | null,
      isMasterAdmin: boolean,
      words: string,
    ) => {
      mockCanSendEmail = canSendEmail;
      mockIsMasterAdmin = isMasterAdmin;

      await renderPage(UserViewTeams);

      expect(teamField().description).toBe(words);
    },
  );

  test("a master admin on a server that cannot send email is handed the link of the new membership", async () => {
    await renderPage(UserViewTeams);

    const created: TeamMember = membership(PENDING_ID, false);

    await act(async (): Promise<void> => {
      await table().onCreateSuccess!(created, ModalType.Create);
    });

    expect(
      await screen.findByTestId("invitation-link-value"),
    ).toHaveTextContent(LINK);
    expect(requestsTo(INVITATION_LINK_ROUTE)[0]!.data).toEqual({
      teamMemberId: PENDING_ID,
    });
  });

  test.each([
    // [server can send email, master admin]
    [true, true],
    [false, false],
    [null, true],
  ])(
    "can send %p, master admin %p: no link is read",
    async (canSendEmail: boolean | null, isMasterAdmin: boolean) => {
      mockCanSendEmail = canSendEmail;
      mockIsMasterAdmin = isMasterAdmin;

      await renderPage(UserViewTeams);

      await act(async (): Promise<void> => {
        await table().onCreateSuccess!(
          membership(PENDING_ID, false),
          ModalType.Create,
        );
      });

      expect(requestsTo(INVITATION_LINK_ROUTE)).toHaveLength(0);
      expect(screen.queryByTestId("invitation-link-value")).toBeNull();
    },
  );

  test("an edit opens nothing", async () => {
    await renderPage(UserViewTeams);

    await act(async (): Promise<void> => {
      await table().onCreateSuccess!(
        membership(PENDING_ID, false),
        ModalType.Edit,
      );
    });

    expect(requestsTo(INVITATION_LINK_ROUTE)).toHaveLength(0);
  });

  test("hands the new membership back to the table", async () => {
    await renderPage(UserViewTeams);

    const created: TeamMember = membership(PENDING_ID, false);
    let returned: TeamMember | null = null;

    await act(async (): Promise<void> => {
      returned = await table().onCreateSuccess!(created, ModalType.Create);
    });

    expect(returned).toBe(created);
  });
});
