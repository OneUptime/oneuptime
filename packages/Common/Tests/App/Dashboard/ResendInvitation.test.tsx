import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, { FunctionComponent } from "react";
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
 * RESEND INVITATION, ON A PENDING ROW (#9519).
 *
 * A pending person whose invitation email never reached them could only
 * be sent it again by removing them and inviting them back. Now their row
 * - on Settings > Users, a person's Teams and a team's Members - offers
 * Resend Invitation, for whoever may invite people, on a server not known
 * to be unable to send email:
 *
 *   - one row action, in the row's menu, never on a member's row;
 *   - a short question that names the address, so nobody is emailed by a
 *     stray press;
 *   - the question stays busy until the server has handed the email to
 *     the mail service, so a double press sends once;
 *   - then a toast says where it went, and the list reads its rows again:
 *     the row says Invitation Sent once the email went;
 *   - a refusal says why in the question, for another try - the per-address
 *     limit with the time it can go again.
 *
 * The real pages, their tables stood in for by one that records its props,
 * and the real row actions for the question.
 */

let mockIsMasterAdmin: boolean = false;
let mockCanSendEmail: boolean | null = true;
let projectPermissionsForTest: unknown = null;

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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

type CapturedAction = ActionButtonSchema<TeamMember>;

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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
  RowActionContext,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import {
  RESEND_INVITATION_COPY,
  RESEND_INVITATION_TOAST_TEST_ID,
  getInvitationResentToastTitle,
  getResendAgainAt,
  getResendInvitationErrorMessage,
  getResendInvitationRowAction,
} from "../../../UI/Components/InvitationLink/ResendInvitation";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast, { ToastItem } from "../../../UI/Utils/Toast";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  RESEND_INVITATION_REFUSALS,
  RESEND_INVITATION_ROUTE_END,
} from "../../../Types/Team/ResendInvitation";
import { getJestSpyOn } from "../../Spy";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "95250000-0000-4000-8000-000000000001",
);
const PENDING_ID: string = "95250000-0000-4000-8000-0000000000e1";
const MEMBER_ID: string = "95250000-0000-4000-8000-0000000000e2";
const GRACE_EMAIL: string = "grace@example.com";
const TOO_MANY_FROM_SERVER: string =
  "Too many invitations were sent to this email address in the last hour. Please try again later.";

const currentProject: Project = new Project();
currentProject._id = PROJECT_ID.toString();

function row(
  id: string,
  hasAcceptedInvitation: boolean,
  email: string | null = GRACE_EMAIL,
): TeamMember {
  const membership: TeamMember = new TeamMember();
  membership._id = id;
  membership.projectId = PROJECT_ID;
  membership.hasAcceptedInvitation = hasAcceptedInvitation;

  if (email) {
    const user: User = new User();
    user._id = ObjectID.generate().toString();
    user.email = new Email(email);
    membership.user = user;
  }

  return membership;
}

const PENDING_ROW: TeamMember = row(PENDING_ID, false);
const MEMBER_ROW: TeamMember = row(MEMBER_ID, true);

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
let resendAnswer: () => Promise<unknown>;

function resends(): Array<Request> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): Request => {
      return call[0] as Request;
    })
    .filter((request: Request): boolean => {
      return request.url.toString().endsWith(RESEND_INVITATION_ROUTE_END);
    });
}

function toastTitles(): Array<string> {
  return Toast.getToasts().map((toast: ToastItem): string => {
    return toast.title;
  });
}

beforeEach(() => {
  mockIsMasterAdmin = false;
  mockCanSendEmail = true;
  capturedTableProps = null;
  // A Project Admin, who may invite people.
  holding([Permission.ProjectAdmin]);
  Toast.dismissAll();

  resendAnswer = async (): Promise<unknown> => {
    return new HTTPResponse<JSONObject>(200, { email: GRACE_EMAIL }, {});
  };

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID("95250000-0000-4000-8000-0000000000d1"),
  );
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID.toString(),
  });
  // No SCIM Push Groups.
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(0);

  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: Request,
  ) => {
    if (request.url.toString().endsWith(RESEND_INVITATION_ROUTE_END)) {
      return await resendAnswer();
    }

    // Whose invitation email was not sent: nobody, here.
    return new HTTPResponse<JSONObject>(200, { people: [] }, {});
  }) as never) as unknown as SpyInstance<typeof API.post>;
});

afterEach(() => {
  cleanup();
  Toast.dismissAll();
  jest.restoreAllMocks();
});

// A 429 that says when to come back, as the route answers one.
function tooMany(retryAfterSeconds: number | null): HTTPErrorResponse {
  return new HTTPErrorResponse(
    429,
    { message: TOO_MANY_FROM_SERVER },
    retryAfterSeconds === null
      ? {}
      : { "retry-after": retryAfterSeconds.toString() },
  );
}

describe("the row action", () => {
  function action(
    isAvailable: boolean = true,
    onSent?: (item: TeamMember) => void,
  ): CapturedAction {
    return getResendInvitationRowAction<TeamMember>({
      isAvailable: isAvailable,
      getRequestHeaders: () => {
        return { tenantid: PROJECT_ID.toString() };
      },
      onSent: onSent,
    });
  }

  test("is one action, named for what it does, in the row's menu with its envelope", () => {
    const resend: CapturedAction = action();

    expect(resend.title).toBe("Resend Invitation");
    expect(RESEND_INVITATION_COPY.action).toBe("Resend Invitation");
    expect(resend.icon).toBe(IconProp.Email);
    expect(resend.buttonStyleType).toBe(ButtonStyleType.OUTLINE);
    expect(resend.placement).not.toBe(ActionButtonPlacement.Primary);
  });

  test.each([
    // [available, accepted, has id, shown]
    [true, false, true, true],
    [true, true, true, false],
    [false, false, true, false],
    [true, false, false, false],
  ])(
    "available %p, accepted %p, with an id %p: shown %p",
    (
      isAvailable: boolean,
      hasAccepted: boolean,
      hasId: boolean,
      isShown: boolean,
    ) => {
      const item: TeamMember = row(PENDING_ID, hasAccepted);

      if (!hasId) {
        item._id = undefined;
      }

      expect(Boolean(action(isAvailable).isVisible!(item))).toBe(isShown);
    },
  );

  test("asks first, naming the address it will email", () => {
    const question: RowActionConfirmation | undefined =
      action().getConfirmation!(PENDING_ROW);

    expect(question).toEqual({
      title: "Resend Invitation",
      description: `Send their invitation email to ${GRACE_EMAIL} again?`,
      submitButtonText: "Resend Invitation",
    });
    // Not destructive: the primary button, never the danger one.
    expect(question?.submitButtonType).toBeUndefined();
  });

  test("a row that does not name the address still asks", () => {
    expect(
      action().getConfirmation!(row(PENDING_ID, false, null))?.description,
    ).toBe("Send their invitation email again?");
  });

  test("sends it for the row's invitation, with the page's project, then says where it went and reads the rows again", async () => {
    const onComplete: jest.Mock = jest.fn();
    const onError: jest.Mock = jest.fn();
    const refresh: jest.Mock = jest.fn();
    const onSent: jest.Mock = jest.fn();

    await act(async (): Promise<void> => {
      action(true, onSent as unknown as (item: TeamMember) => void).onClick(
        PENDING_ROW,
        onComplete as unknown as () => void,
        onError as unknown as (error: Error) => void,
        { refresh: refresh as unknown as () => void } as RowActionContext,
      );
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    expect(resends()).toHaveLength(1);
    expect(resends()[0]!.url.toString()).toContain(
      `/team-member/${PENDING_ID}/resend-invitation`,
    );
    expect(resends()[0]!.headers).toEqual({ tenantid: PROJECT_ID.toString() });
    expect(toastTitles()).toEqual([`Invitation sent to ${GRACE_EMAIL}`]);
    expect(Toast.getToasts()[0]!.dataTestId).toBe(
      RESEND_INVITATION_TOAST_TEST_ID,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test("a refusal says why, in the server's words, and says nothing was sent", async () => {
    resendAnswer = async (): Promise<unknown> => {
      return new HTTPErrorResponse(
        404,
        { message: RESEND_INVITATION_REFUSALS.notInvited },
        {},
      );
    };

    const onComplete: jest.Mock = jest.fn();
    const onError: jest.Mock = jest.fn();

    await act(async (): Promise<void> => {
      action().onClick(
        PENDING_ROW,
        onComplete as unknown as () => void,
        onError as unknown as (error: Error) => void,
      );
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });

    expect((onError.mock.calls[0]![0] as Error).message).toBe(
      RESEND_INVITATION_REFUSALS.notInvited,
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(toastTitles()).toEqual([]);
  });

  test("the per-address limit says the time it can go again", async () => {
    const now: number = Date.UTC(2034, 5, 1, 14, 20, 10);
    jest.spyOn(Date, "now").mockReturnValue(now);
    resendAnswer = async (): Promise<unknown> => {
      return tooMany(1500);
    };

    const onError: jest.Mock = jest.fn();

    await act(async (): Promise<void> => {
      action().onClick(
        PENDING_ROW,
        () => {},
        onError as unknown as (error: Error) => void,
      );
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });

    // 25 minutes on, rounded up to the minute: never a moment early.
    const againAt: Date = new Date(Date.UTC(2034, 5, 1, 14, 46, 0));

    expect((onError.mock.calls[0]![0] as Error).message).toBe(
      `Too many invitations were sent to this address in the last hour. You can send it again after ${OneUptimeDate.getLocalTimeString(
        againAt,
        { use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat() },
      )}.`,
    );
  });
});

describe("when it can go again", () => {
  test("is Retry-After from now, rounded up to the minute", () => {
    const now: number = Date.UTC(2034, 5, 1, 14, 20, 0);

    expect(getResendAgainAt(tooMany(60), now)).toEqual(
      new Date(Date.UTC(2034, 5, 1, 14, 21, 0)),
    );
    expect(getResendAgainAt(tooMany(61), now)).toEqual(
      new Date(Date.UTC(2034, 5, 1, 14, 22, 0)),
    );
    expect(getResendAgainAt(tooMany(3600), now)).toEqual(
      new Date(Date.UTC(2034, 5, 1, 15, 20, 0)),
    );
  });

  test("is not known for anything but a 429 that says when", () => {
    expect(getResendAgainAt(tooMany(null))).toBeNull();
    expect(
      getResendAgainAt(new HTTPErrorResponse(400, { message: "No." }, {})),
    ).toBeNull();
    expect(getResendAgainAt(new Error("Network down"))).toBeNull();
  });

  test("a 429 that does not say when keeps the server's own sentence", () => {
    expect(
      getResendInvitationErrorMessage({
        error: tooMany(null),
        translator: getGlobalTranslator(),
      }),
    ).toBe(TOO_MANY_FROM_SERVER);
  });
});

describe("the toast", () => {
  test("names the address the server sent it to", () => {
    expect(
      getInvitationResentToastTitle({
        resent: { email: GRACE_EMAIL },
        rowEmail: "someone-else@example.com",
        translator: getGlobalTranslator(),
      }),
    ).toBe(`Invitation sent to ${GRACE_EMAIL}`);
  });

  test("an answer that names none takes the row's address, or the pending pill's words", () => {
    expect(
      getInvitationResentToastTitle({
        resent: { email: "" },
        rowEmail: GRACE_EMAIL,
        translator: getGlobalTranslator(),
      }),
    ).toBe(`Invitation sent to ${GRACE_EMAIL}`);
    expect(
      getInvitationResentToastTitle({
        resent: { email: "" },
        rowEmail: "",
        translator: getGlobalTranslator(),
      }),
    ).toBe("Invitation Sent");
  });
});

describe("through the row's menu", () => {
  const openResend: () => void = (): void => {
    fireEvent.click(screen.getByTestId("row-actions-more-button"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Resend Invitation",
      }),
    );
  };

  function renderRow(): void {
    render(
      <RowActions<TeamMember>
        item={PENDING_ROW}
        actionButtons={[
          {
            title: "View",
            icon: IconProp.ChevronRight,
            buttonStyleType: ButtonStyleType.OUTLINE,
            placement: ActionButtonPlacement.Primary,
            onClick: (): void => {},
          },
          getResendInvitationRowAction<TeamMember>({
            isAvailable: true,
            getRequestHeaders: () => {
              return { tenantid: PROJECT_ID.toString() };
            },
          }),
        ]}
      />,
    );
  }

  test("asks its short question, and sends nothing until it is answered", () => {
    renderRow();
    openResend();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Resend Invitation",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      `Send their invitation email to ${GRACE_EMAIL} again?`,
    );
    expect(resends()).toHaveLength(0);
  });

  test("a double click sends once, and the toast says where it went", async () => {
    let releaseAnswer: () => void = (): void => {};

    resendAnswer = async (): Promise<unknown> => {
      await new Promise<void>((resolve: () => void) => {
        releaseAnswer = resolve;
      });
      return new HTTPResponse<JSONObject>(200, { email: GRACE_EMAIL }, {});
    };

    renderRow();
    openResend();

    const submit: HTMLElement = screen.getByTestId(
      "modal-footer-submit-button",
    );

    fireEvent.click(submit);
    fireEvent.click(submit);

    await act(async (): Promise<void> => {
      releaseAnswer();
    });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });

    expect(resends()).toHaveLength(1);
    expect(toastTitles()).toEqual([`Invitation sent to ${GRACE_EMAIL}`]);
  });

  test("a refusal stays in the question, for another try", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2034, 5, 1, 9, 0, 0));
    resendAnswer = async (): Promise<unknown> => {
      return tooMany(600);
    };

    renderRow();
    openResend();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(
      await screen.findByText(
        /Too many invitations were sent to this address in the last hour\. You can send it again after/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(toastTitles()).toEqual([]);
  });
});

const PAGES: Array<[string, FunctionComponent<PageComponentProps>]> = [
  ["Settings > Users", Users],
  ["a person's Teams", UserViewTeams],
  ["a team's Members", TeamViewMembers],
];

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

function resendAction(): CapturedAction {
  const found: CapturedAction | undefined =
    capturedTableProps?.actionButtons?.find(
      (candidate: CapturedAction): boolean => {
        return candidate.title === RESEND_INVITATION_COPY.action;
      },
    );

  expect(found).toBeDefined();

  return found!;
}

describe.each(PAGES)(
  "%s",
  (_page: string, Page: FunctionComponent<PageComponentProps>) => {
    test("offers Resend Invitation on a pending row to whoever may invite - never on a member's", async () => {
      await renderPage(Page);

      expect(Boolean(resendAction().isVisible!(PENDING_ROW))).toBe(true);
      expect(Boolean(resendAction().isVisible!(MEMBER_ROW))).toBe(false);
    });

    test("a reader who may invite only through Invite New Members is offered it too", async () => {
      holding([Permission.InviteProjectTeamMembers]);

      await renderPage(Page);

      expect(Boolean(resendAction().isVisible!(PENDING_ROW))).toBe(true);
    });

    test("a reader who may not invite anyone is not offered it", async () => {
      holding([Permission.Viewer]);

      await renderPage(Page);

      expect(Boolean(resendAction().isVisible!(PENDING_ROW))).toBe(false);
    });

    test("on a server that cannot send email, it is not offered: nothing could go out", async () => {
      mockCanSendEmail = false;
      mockIsMasterAdmin = true;

      await renderPage(Page);

      expect(Boolean(resendAction().isVisible!(PENDING_ROW))).toBe(false);
    });

    test("it asks in the page's project", async () => {
      await renderPage(Page);

      await act(async (): Promise<void> => {
        resendAction().onClick(
          PENDING_ROW,
          () => {},
          () => {},
        );
      });

      await waitFor(() => {
        expect(resends()).toHaveLength(1);
      });

      expect(resends()[0]!.headers).toEqual({
        tenantid: PROJECT_ID.toString(),
      });
    });
  },
);
