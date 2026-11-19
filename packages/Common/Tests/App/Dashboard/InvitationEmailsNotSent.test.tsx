import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
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
 * AN INVITATION WHOSE EMAIL WAS NOT SENT NO LONGER SAYS INVITATION SENT
 * (#9511).
 *
 * On a server that can send email, Settings > Users, a person's Teams and
 * a team's Members showed every pending invitation as Invitation Sent -
 * even one whose email the mail service refused, so nothing reached the
 * person, and the person who invited them waited. Now each list asks the
 * server about the pending people it shows (POST /team-member/invitation-
 * emails-not-sent), once a page, and:
 *
 *   - a person whose latest invitation email failed says Email Not Sent,
 *     and, pressed or pointed at, why - in OneUptime's words, then the mail
 *     service's as the Email Log words it - and what to do;
 *   - a master admin is offered Get Invitation Link on that row, and the
 *     dialog says that email was not sent;
 *   - anybody else is told to invite them again once email works, or to
 *     ask the server's admin for the link;
 *   - a reader who may not read the project's Email Logs is never asked
 *     about, nor told: the row says what it always said.
 *
 * The real pages, their tables stood in for by one that records its props.
 */

let mockIsMasterAdmin: boolean = false;
let mockCanSendEmail: boolean | null = true;
let projectPermissionsForTest: unknown = null;

/*
 * A self-hosted server, which the pages are drawn on here: what a reader
 * who is not a master admin is told to do depends on it (OneUptime Cloud
 * has no server's admin to ask: getInvitationEmailNotSentAdvice), and the
 * Common Test job runs with billing on, as Cloud does. Cloud's words are
 * held below, on getInvitationEmailNotSentAdvice itself.
 */
jest.mock("../../../UI/Config", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    BILLING_ENABLED: false,
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return (
          (
            projectPermissionsForTest as {
              permissions?: Array<{ permission: string }>;
            } | null
          )?.permissions || []
        ).map((row: { permission: string }): string => {
          return row.permission;
        });
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
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

jest.mock("../../../UI/Utils/UserEmailRegistrationStatus", () => {
  return {
    __esModule: true,
    useUserEmailRegistrationStatus: () => {
      return {
        isEmailRegistered: true,
        checkEmail: (): void => {},
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

type CapturedTableProps = {
  actionButtons?: Array<CapturedAction> | undefined;
  columns?: Array<CapturedColumn> | undefined;
  onFetchSuccess?:
    | ((data: Array<TeamMember>, totalCount: number) => void)
    | undefined;
  modelAPI?: unknown;
  selectMoreFields?: Record<string, unknown> | undefined;
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PendingInvitationPill, {
  EMAIL_NOT_SENT_PILL_TEST_ID,
  EMAIL_NOT_SENT_REASON_TEST_ID,
  getInvitationEmailNotSentAdvice,
  getInvitationEmailNotSentExplanation,
  InvitationEmailNotSentExplanation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/User/PendingInvitationPill";
import { getEmailLogReason } from "../../../../App/FeatureSet/Dashboard/src/Utils/EmailLogReason";
import {
  SERVER_EMAIL_COPY,
  ServerEmail,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ServerEmail";
import {
  INVITATION_LINK_COPY,
  INVITATION_LINK_ROUTE,
} from "../../../UI/Components/InvitationLink/InvitationLinkModal";
import {
  InvitationEmailsNotSent,
  fetchInvitationEmailsNotSent,
  getInvitationRowUserId,
  getPendingPeopleToAskAbout,
  useInvitationEmailsNotSent,
} from "../../../UI/Components/InvitationLink/InvitationEmailsNotSent";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import { RESEND_INVITATION_COPY } from "../../../UI/Components/InvitationLink/ResendInvitation";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUsersModelAPI from "../../../UI/Utils/ModelAPI/ProjectUsersModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { SERVER_EMAIL_NOT_SET_UP_MESSAGE } from "../../../Types/ServerSending/ServerSendingWords";
import {
  INVITATION_EMAILS_NOT_SENT_ROUTE,
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
} from "../../../Types/Team/InvitationEmailsNotSent";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "95160000-0000-4000-8000-000000000001",
);
// Pending: the mail service refused their latest invitation email.
const GRACE: string = "95170000-0000-4000-8000-000000000001";
// Pending: their invitation email went.
const ALAN: string = "95170000-0000-4000-8000-000000000002";
// Has joined.
const ADA: string = "95170000-0000-4000-8000-000000000003";

const REFUSAL: string = "535 5.7.8 Authentication failed";
const LINK: string =
  "https://oneuptime.example.com/accounts/register?email=grace%40example.com&token=95170000-0000-4000-8000-0000000000ff";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

function row(
  userId: string,
  name: string,
  hasAcceptedInvitation: boolean,
): TeamMember {
  const membership: TeamMember = new TeamMember();
  membership._id = ObjectID.generate().toString();
  membership.userId = new ObjectID(userId);
  membership.projectId = PROJECT_ID;
  membership.hasAcceptedInvitation = hasAcceptedInvitation;

  const user: User = new User();
  user._id = userId;
  user.email = new Email(`${name}@example.com`);
  membership.user = user;

  return membership;
}

const GRACE_ROW: TeamMember = row(GRACE, "grace", false);
const ALAN_ROW: TeamMember = row(ALAN, "alan", false);
const ADA_ROW: TeamMember = row(ADA, "ada", true);
const ROWS: Array<TeamMember> = [GRACE_ROW, ALAN_ROW, ADA_ROW];

const PAGES: Array<[string, FunctionComponent<PageComponentProps>]> = [
  ["Settings > Users", Users],
  ["a person's Teams", UserViewTeams],
  ["a team's Members", TeamViewMembers],
];

function holding(permissions: Array<Permission>): void {
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        scope: PermissionScope.All,
        labelIds: [],
        isBlockPermission: false,
        _type: "UserPermission",
      } as UserPermission;
    }),
    _type: "UserTenantAccessPermission",
  };
}

type Request = { url: URL; data: JSONObject; headers?: unknown };

let postSpy: SpyInstance<typeof API.post>;
let fetchSpy: SpyInstance<typeof API.fetch>;
let notSentAnswer: () => Promise<unknown>;

function asks(): Array<Request> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): Request => {
      return call[0] as Request;
    })
    .filter((request: Request): boolean => {
      return request.url.toString().endsWith(INVITATION_EMAILS_NOT_SENT_ROUTE);
    });
}

beforeEach(() => {
  mockIsMasterAdmin = false;
  mockCanSendEmail = true;
  capturedTableProps = null;
  // A Project Member reads the project's Email Logs, as Notification Logs > Email does.
  holding([Permission.ProjectMember]);

  notSentAnswer = async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(
      200,
      { people: [{ userId: GRACE, statusMessage: REFUSAL }] },
      {},
    );
  };

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID("95160000-0000-4000-8000-0000000000d1"),
  );
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID.toString(),
  });
  // No SCIM Push Groups: people are invited and removed here.
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);

  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: Request,
  ) => {
    if (request.url.toString().endsWith(INVITATION_EMAILS_NOT_SENT_ROUTE)) {
      return await notSentAnswer();
    }

    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never) as unknown as SpyInstance<typeof API.post>;

  // The invitation link's dialog reads the link.
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
  jest.restoreAllMocks();
});

async function renderPage(
  Page: FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(
    <MemoryRouter>
      <Page
        pageRoute={new Route(`/dashboard/${PROJECT_ID.toString()}/users`)}
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

// The table has drawn these rows: as ModelTable hands them over.
async function rowsFetched(rows: Array<TeamMember> = ROWS): Promise<void> {
  expect(table().onFetchSuccess).toBeDefined();

  await act(async (): Promise<void> => {
    table().onFetchSuccess!(rows, rows.length);
  });

  // The answer comes back, and the page draws it.
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 5; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

function statusElement(item: TeamMember): ReactElement {
  const column: CapturedColumn | undefined = table().columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Status";
    },
  );

  expect(column?.getElement).toBeDefined();

  return column!.getElement!(item);
}

// The words of the pills the row's Status draws, as a reader sees them.
function statusText(item: TeamMember): string {
  const { container, unmount } = render(<>{statusElement(item)}</>);
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

/*
 * Waits for the page to draw the server's answer, reading what the row's
 * Status is handed - never drawing it, which would change the page that
 * waitFor watches.
 */
async function answerDrawn(item: TeamMember = GRACE_ROW): Promise<void> {
  await waitFor(() => {
    expect(
      (statusElement(item).props as { notSent?: unknown }).notSent,
    ).toBeDefined();
  });
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

function isOffered(item: TeamMember): boolean {
  return Boolean(linkAction().isVisible!(item));
}

// Resend Invitation, on the row, once email works (#9519).
const ADVICE_FOR_OTHERS: string =
  "Once email works, use Resend Invitation, or ask your server's admin for their invitation link.";
const ADVICE_FOR_MASTER_ADMIN: string =
  "They can still join: send them their invitation link yourself.";

describe("the words", () => {
  test("the pill, and what it says in OneUptime's words", () => {
    expect(SERVER_EMAIL_COPY.emailNotSentPill).toBe("Email Not Sent");
    expect(SERVER_EMAIL_COPY.emailNotSent).toBe(
      "Their invitation email was not sent.",
    );
  });

  test("a master admin is told they can hand over the link, as the Email Log tells them", () => {
    expect(
      getInvitationEmailNotSentAdvice({ isMasterAdmin: true, isCloud: false }),
    ).toBe(ADVICE_FOR_MASTER_ADMIN);
    expect(
      getInvitationEmailNotSentAdvice({ isMasterAdmin: true, isCloud: true }),
    ).toBe(ADVICE_FOR_MASTER_ADMIN);
  });

  test("anybody else on a self-hosted server: resend it once email works, or ask the server's admin", () => {
    expect(
      getInvitationEmailNotSentAdvice({ isMasterAdmin: false, isCloud: false }),
    ).toBe(ADVICE_FOR_OTHERS);
  });

  test("on OneUptime Cloud, which has no server's admin to ask: check the address and resend it", () => {
    expect(
      getInvitationEmailNotSentAdvice({ isMasterAdmin: false, isCloud: true }),
    ).toBe("Check their email address, then use Resend Invitation.");
  });

  test("the advice names the row's own action, as the row draws it - never removing and inviting again", () => {
    for (const advice of [
      getInvitationEmailNotSentAdvice({ isMasterAdmin: false, isCloud: false }),
      getInvitationEmailNotSentAdvice({ isMasterAdmin: false, isCloud: true }),
    ]) {
      expect(advice).toContain(RESEND_INVITATION_COPY.action);
      expect(advice).not.toContain("remove them");
    }
  });

  test("the reason is the mail service's answer, as it said it", () => {
    const explanation: InvitationEmailNotSentExplanation =
      getInvitationEmailNotSentExplanation({
        notSent: { userId: GRACE, statusMessage: REFUSAL },
        isMasterAdmin: false,
        isCloud: false,
        translator: getGlobalTranslator(),
      });

    expect(explanation).toEqual({
      notSent: "Their invitation email was not sent.",
      reason: { text: REFUSAL, isAsSaid: true },
      advice: ADVICE_FOR_OTHERS,
    });
  });

  test("a server with no email set up reads as OneUptime says it, as the Email Logs table says it", () => {
    const legacy: string =
      "Email is configured to use SMTP, but SMTP settings are not configured.";
    const explanation: InvitationEmailNotSentExplanation =
      getInvitationEmailNotSentExplanation({
        notSent: { userId: GRACE, statusMessage: legacy },
        isMasterAdmin: false,
        isCloud: false,
        translator: getGlobalTranslator(),
      });

    expect(explanation.reason).toEqual({
      text: SERVER_EMAIL_NOT_SET_UP_MESSAGE,
      isAsSaid: false,
    });
    expect(explanation.reason).toEqual(
      getEmailLogReason(legacy, getGlobalTranslator()),
    );
  });

  test("a row that says nothing gives no reason, only what to do", () => {
    expect(
      getInvitationEmailNotSentExplanation({
        notSent: { userId: GRACE, statusMessage: "  " },
        isMasterAdmin: false,
        isCloud: false,
        translator: getGlobalTranslator(),
      }).reason,
    ).toBeNull();
  });
});

describe("the pill", () => {
  const SERVER_SENDS: ServerEmail = {
    canSendEmail: true,
    isMasterAdmin: false,
  };

  test("Invitation Sent, when the latest invitation email went", () => {
    render(<PendingInvitationPill serverEmail={SERVER_SENDS} />);

    expect(screen.getByText("Invitation Sent")).toBeInTheDocument();
    expect(screen.queryByTestId(EMAIL_NOT_SENT_PILL_TEST_ID)).toBeNull();
  });

  test("Invited, on a server that cannot send email, whatever the Email Log says", () => {
    render(
      <PendingInvitationPill
        serverEmail={{ canSendEmail: false, isMasterAdmin: false }}
        notSent={{ userId: GRACE, statusMessage: REFUSAL }}
      />,
    );

    expect(screen.getByText(SERVER_EMAIL_COPY.invitedPill)).toBeInTheDocument();
    expect(screen.queryByText("Email Not Sent")).toBeNull();
  });

  test("Email Not Sent, a button whose description says why and what to do", () => {
    render(
      <PendingInvitationPill
        serverEmail={SERVER_SENDS}
        notSent={{ userId: GRACE, statusMessage: REFUSAL }}
      />,
    );

    const pill: HTMLElement = screen.getByTestId(EMAIL_NOT_SENT_PILL_TEST_ID);

    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveTextContent("Email Not Sent");
    expect(pill).not.toHaveTextContent("Invitation Sent");
    expect(pill).toHaveAccessibleDescription(
      `Their invitation email was not sent. ${REFUSAL} ${ADVICE_FOR_OTHERS}`,
    );
    // It broke: the danger tone.
    expect(
      pill.querySelector('[data-testid="pill"]')?.getAttribute("data-tone"),
    ).toBe(PillTone.Danger);
  });

  test("pressed, it shows the mail service's answer in its own direction, apart from OneUptime's words", async () => {
    render(
      <PendingInvitationPill
        serverEmail={SERVER_SENDS}
        notSent={{ userId: GRACE, statusMessage: REFUSAL }}
      />,
    );

    const pill: HTMLElement = screen.getByTestId(EMAIL_NOT_SENT_PILL_TEST_ID);

    fireEvent.mouseEnter(pill);
    fireEvent.click(pill);

    const reason: HTMLElement = await screen.findByTestId(
      EMAIL_NOT_SENT_REASON_TEST_ID,
    );

    expect(reason).toHaveTextContent(REFUSAL);
    expect(reason).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("tooltip")).toHaveTextContent(ADVICE_FOR_OTHERS);
  });

  test("a master admin is told they can send the link themselves", () => {
    render(
      <PendingInvitationPill
        serverEmail={{ canSendEmail: true, isMasterAdmin: true }}
        notSent={{ userId: GRACE, statusMessage: REFUSAL }}
      />,
    );

    expect(
      screen.getByTestId(EMAIL_NOT_SENT_PILL_TEST_ID),
    ).toHaveAccessibleDescription(
      `Their invitation email was not sent. ${REFUSAL} ${ADVICE_FOR_MASTER_ADMIN}`,
    );
  });
});

describe("asking whose invitation email was not sent", () => {
  test("a row's person is read from its user id, or its user", () => {
    expect(getInvitationRowUserId(GRACE_ROW)).toBe(GRACE);

    const byUser: TeamMember = new TeamMember();
    const user: User = new User();
    user._id = ALAN.toUpperCase();
    byUser.user = user;

    expect(getInvitationRowUserId(byUser)).toBe(ALAN);
    expect(getInvitationRowUserId(new TeamMember())).toBe("");
  });

  test("only pending rows are asked about, each person once", () => {
    expect(
      getPendingPeopleToAskAbout([
        GRACE_ROW,
        ALAN_ROW,
        ADA_ROW,
        row(GRACE, "grace", false),
        new TeamMember(),
      ]),
    ).toEqual([GRACE, ALAN]);
  });

  test(`at most a page of them (${MAX_PEOPLE_PER_INVITATION_EMAILS_READ})`, () => {
    const rows: Array<TeamMember> = Array.from(
      { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 10 },
      (): TeamMember => {
        return row(ObjectID.generate().toString(), "someone", false);
      },
    );

    expect(getPendingPeopleToAskAbout(rows)).toHaveLength(
      MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
    );
  });

  test("asks the server in the current project, with the people's ids", async () => {
    await expect(fetchInvitationEmailsNotSent([GRACE, ALAN])).resolves.toEqual([
      { userId: GRACE, statusMessage: REFUSAL },
    ]);

    expect(asks()).toHaveLength(1);
    expect(asks()[0]!.data).toEqual({ userIds: [GRACE, ALAN] });
    // The project's headers: the server reads the request's project.
    expect(asks()[0]!.headers).toEqual({ tenantid: PROJECT_ID.toString() });
  });

  test("nobody to ask about sends nothing", async () => {
    await expect(fetchInvitationEmailsNotSent([])).resolves.toEqual([]);
    expect(asks()).toHaveLength(0);
  });

  test("an answer naming someone it was not asked about is not believed", async () => {
    notSentAnswer = async (): Promise<unknown> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          people: [
            { userId: GRACE, statusMessage: REFUSAL },
            { userId: ADA, statusMessage: REFUSAL },
          ],
        },
        {},
      );
    };

    await expect(fetchInvitationEmailsNotSent([GRACE])).resolves.toEqual([
      { userId: GRACE, statusMessage: REFUSAL },
    ]);
  });

  test.each([
    [
      "a refusal",
      async (): Promise<unknown> => {
        return new HTTPErrorResponse(500, { message: "Not now." }, {});
      },
    ],
    [
      "a failed request",
      async (): Promise<unknown> => {
        throw new Error("Network down");
      },
    ],
  ] as Array<[string, () => Promise<unknown>]>)(
    "%s reads as unknown",
    async (_what: string, answer: () => Promise<unknown>) => {
      notSentAnswer = answer;

      await expect(fetchInvitationEmailsNotSent([GRACE])).resolves.toBeNull();
    },
  );
});

describe("useInvitationEmailsNotSent", () => {
  test("not available: asks nothing, and nobody's email is said not sent", async () => {
    const { result } = renderHook(() => {
      return useInvitationEmailsNotSent(false);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });

    expect(asks()).toHaveLength(0);
    expect(result.current.getNotSent(GRACE_ROW)).toBeUndefined();
  });

  test("available: the pending people are asked about, once, and the answer is drawn", async () => {
    const { result } = renderHook(() => {
      return useInvitationEmailsNotSent(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });

    await waitFor(() => {
      expect(result.current.getNotSent(GRACE_ROW)).toEqual({
        userId: GRACE,
        statusMessage: REFUSAL,
      });
    });
    expect(result.current.getNotSent(ALAN_ROW)).toBeUndefined();
    expect(asks()).toHaveLength(1);
    expect(asks()[0]!.data).toEqual({ userIds: [GRACE, ALAN] });
  });

  test("a row of someone who has joined is never said not sent, whatever the answer", async () => {
    const { result } = renderHook(() => {
      return useInvitationEmailsNotSent(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });
    await waitFor(() => {
      expect(result.current.getNotSent(GRACE_ROW)).toBeDefined();
    });

    // Grace has joined since, through another team.
    expect(
      result.current.getNotSent(row(GRACE, "grace", true)),
    ).toBeUndefined();
  });

  test("rows drawn before it became available are asked about once it is", async () => {
    let isAvailable: boolean = false;
    const { result, rerender } = renderHook(() => {
      return useInvitationEmailsNotSent(isAvailable);
    });

    // The table drew its rows while the server's answer was still read.
    const earlyOnFetchSuccess: InvitationEmailsNotSent["onFetchSuccess"] =
      result.current.onFetchSuccess;

    await act(async (): Promise<void> => {
      earlyOnFetchSuccess(ROWS);
    });

    expect(asks()).toHaveLength(0);

    isAvailable = true;

    await act(async (): Promise<void> => {
      rerender();
    });

    await waitFor(() => {
      expect(result.current.getNotSent(GRACE_ROW)).toBeDefined();
    });
  });

  test("once no longer available, nobody's email is said not sent", async () => {
    let isAvailable: boolean = true;
    const { result, rerender } = renderHook(() => {
      return useInvitationEmailsNotSent(isAvailable);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });
    await waitFor(() => {
      expect(result.current.getNotSent(GRACE_ROW)).toBeDefined();
    });

    isAvailable = false;

    await act(async (): Promise<void> => {
      rerender();
    });

    expect(result.current.getNotSent(GRACE_ROW)).toBeUndefined();
  });

  test("only the latest page's answer is drawn", async () => {
    let releaseFirst: (() => void) | null = null;
    let calls: number = 0;

    notSentAnswer = async (): Promise<unknown> => {
      calls++;

      if (calls === 1) {
        // The first page's answer comes back last.
        await new Promise<void>((resolve: () => void) => {
          releaseFirst = resolve;
        });

        return new HTTPResponse<JSONObject>(
          200,
          { people: [{ userId: GRACE, statusMessage: REFUSAL }] },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { people: [] }, {});
    };

    const { result } = renderHook(() => {
      return useInvitationEmailsNotSent(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });
    await act(async (): Promise<void> => {
      // Read again: Grace was invited again since, and the email went.
      result.current.onFetchSuccess([GRACE_ROW]);
    });
    await act(async (): Promise<void> => {
      releaseFirst!();
    });

    expect(result.current.getNotSent(GRACE_ROW)).toBeUndefined();
  });

  test("an answer that cannot be read says what the rows always said", async () => {
    const { result } = renderHook(() => {
      return useInvitationEmailsNotSent(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });
    await waitFor(() => {
      expect(result.current.getNotSent(GRACE_ROW)).toBeDefined();
    });

    notSentAnswer = async (): Promise<unknown> => {
      return new HTTPErrorResponse(500, { message: "Not now." }, {});
    };

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess(ROWS);
    });

    await waitFor(() => {
      expect(result.current.getNotSent(GRACE_ROW)).toBeUndefined();
    });
  });

  test("a page with nobody pending asks nothing", async () => {
    const { result } = renderHook(() => {
      return useInvitationEmailsNotSent(true);
    });

    await act(async (): Promise<void> => {
      result.current.onFetchSuccess([ADA_ROW]);
    });

    expect(asks()).toHaveLength(0);
  });
});

describe.each(PAGES)(
  "%s",
  (_page: string, Page: FunctionComponent<PageComponentProps>) => {
    test("asks once, about the pending people it shows, by user id", async () => {
      await renderPage(Page);
      await rowsFetched();

      expect(asks()).toHaveLength(1);
      expect(asks()[0]!.data).toEqual({ userIds: [GRACE, ALAN] });
    });

    test("its rows carry the person's id that the ask names", async () => {
      await renderPage(Page);

      // The Users list's rows are built with it (ProjectUsersModelAPI); a table of memberships asks for it.
      if (Page !== Users) {
        expect(table().selectMoreFields).toEqual(
          expect.objectContaining({ userId: true }),
        );
      } else {
        expect(table().modelAPI).toBe(ProjectUsersModelAPI);
      }
    });

    // The regression: #9511.
    test("a pending person whose latest invitation email failed says Email Not Sent, never Invitation Sent", async () => {
      await renderPage(Page);
      await rowsFetched();

      await answerDrawn();
      expect(statusText(GRACE_ROW)).toBe("Email Not Sent");
      expect(statusText(GRACE_ROW)).not.toContain("Invitation Sent");
    });

    test("a pending person whose invitation email went still says Invitation Sent", async () => {
      await renderPage(Page);
      await rowsFetched();

      await answerDrawn();
      expect(statusText(GRACE_ROW)).toBe("Email Not Sent");
      expect(statusText(ALAN_ROW)).toBe("Invitation Sent");
      expect(statusText(ADA_ROW)).toContain("Member");
    });

    test("someone who is not a master admin is told what to do instead, and offered no link", async () => {
      await renderPage(Page);
      await rowsFetched();

      await answerDrawn();
      expect(statusText(GRACE_ROW)).toBe("Email Not Sent");

      render(<>{statusElement(GRACE_ROW)}</>);

      expect(
        screen.getByTestId(EMAIL_NOT_SENT_PILL_TEST_ID),
      ).toHaveAccessibleDescription(
        `Their invitation email was not sent. ${REFUSAL} ${ADVICE_FOR_OTHERS}`,
      );
      // The server hands the link to master admins only.
      expect(isOffered(GRACE_ROW)).toBe(false);
    });

    test("a master admin is offered the invitation link on that row only, and told they can send it", async () => {
      mockIsMasterAdmin = true;

      await renderPage(Page);
      await rowsFetched();

      await waitFor(() => {
        expect(isOffered(GRACE_ROW)).toBe(true);
      });
      // Not on a row whose email went, nor on a member's: email works.
      expect(isOffered(ALAN_ROW)).toBe(false);
      expect(isOffered(ADA_ROW)).toBe(false);

      render(<>{statusElement(GRACE_ROW)}</>);

      expect(
        screen.getByTestId(EMAIL_NOT_SENT_PILL_TEST_ID),
      ).toHaveAccessibleDescription(
        `Their invitation email was not sent. ${REFUSAL} ${ADVICE_FOR_MASTER_ADMIN}`,
      );
    });

    test("the link a master admin gets is that row's, in a dialog that says its email was not sent", async () => {
      mockIsMasterAdmin = true;

      await renderPage(Page);
      await rowsFetched();
      await waitFor(() => {
        expect(isOffered(GRACE_ROW)).toBe(true);
      });

      await act(async (): Promise<void> => {
        linkAction().onClick(
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
      // Read for the row's own invitation.
      const linkRequests: Array<Request> = fetchSpy.mock.calls
        .map((call: Array<unknown>): Request => {
          return call[0] as Request;
        })
        .filter((request: Request): boolean => {
          return request.url.toString().endsWith(INVITATION_LINK_ROUTE);
        });

      expect(linkRequests).toHaveLength(1);
      expect(linkRequests[0]!.data).toEqual({
        teamMemberId: GRACE_ROW.id!.toString(),
      });
    });

    test("a reader who may not read the project's Email Logs is never asked about, and sees what they always saw", async () => {
      // Reads the project's teams, not its Email Logs.
      holding([Permission.ReadProjectTeam]);

      await renderPage(Page);
      await rowsFetched();

      expect(asks()).toHaveLength(0);
      expect(statusText(GRACE_ROW)).toBe("Invitation Sent");
    });

    test("one who may read the project's Email Logs and nothing else is told", async () => {
      holding([Permission.ReadEmailLog, Permission.ReadProjectTeam]);

      await renderPage(Page);
      await rowsFetched();

      expect(asks()).toHaveLength(1);
      await answerDrawn();
      expect(statusText(GRACE_ROW)).toBe("Email Not Sent");
    });

    test("on a server that cannot send email, nothing is asked: every pending person says Invited", async () => {
      mockCanSendEmail = false;

      await renderPage(Page);
      await rowsFetched();

      expect(asks()).toHaveLength(0);
      expect(statusText(GRACE_ROW)).toBe(SERVER_EMAIL_COPY.invitedPill);
      expect(statusText(ALAN_ROW)).toBe(SERVER_EMAIL_COPY.invitedPill);
    });

    test("while whether the server can send email is read, the Email Log is still read", async () => {
      mockCanSendEmail = null;

      await renderPage(Page);
      await rowsFetched();

      await answerDrawn();
      expect(statusText(GRACE_ROW)).toBe("Email Not Sent");
    });

    test("an answer that cannot be read leaves every row as it was", async () => {
      notSentAnswer = async (): Promise<unknown> => {
        return new HTTPErrorResponse(500, { message: "Not now." }, {});
      };

      await renderPage(Page);
      await rowsFetched();

      expect(asks()).toHaveLength(1);
      expect(statusText(GRACE_ROW)).toBe("Invitation Sent");
      expect(isOffered(GRACE_ROW)).toBe(false);
    });
  },
);
