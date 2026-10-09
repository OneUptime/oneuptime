import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { act } from "react";
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes as RouterRoutes,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Users > View > Notification Methods — an administrator managing the devices
 * and addresses somebody else's pages are delivered to.
 *
 * This page reverses a decision the previous phase made deliberately, so the
 * assertions worth writing down are the ones that keep the REASON for that
 * decision satisfied by the new answer.
 *
 * The old surface showed a masked, read-only list and a prefilled "please add
 * one yourself" email, because the nine notification method models are scoped
 * to the person who owns the device: the columns behind them are the raw
 * address, the phone number, the webhook bearer url, the push device token and
 * the verification code, and an attempt to widen that scope so an admin could
 * read them leaked every one of those in turn. What it cost was the commonest
 * broken responder of all — a new joiner with no method at all — being fixable
 * by nobody but themselves.
 *
 * So the models are STILL owner-scoped, and this page talks to a narrow
 * server-side capability instead. What that buys, and what it must not:
 *
 *   - NO METHOD MODEL IS READ. Not by ModelAPI over UserEmail and its eight
 *     siblings, and not through a nested relation select on a rule, which
 *     reaches the same columns through a table an administrator IS allowed to
 *     read. The assertion is about the REQUEST, because a component that asks
 *     is already wrong even when the server refuses it.
 *
 *   - NO RAW IDENTIFIER REACHES THE DOM. Every fixture plants the raw value
 *     beside the masked one under three plausible field names, so a parse that
 *     starts copying unknown keys through fails here.
 *
 *   - AN ADMIN CANNOT MAKE A METHOD LIVE. This is the property the whole design
 *     rests on: the row is written unverified, the code goes to the device, and
 *     the verify endpoints refuse anybody but the owner. The page must never
 *     offer a "verify" control, must say why, and must show an admin-added
 *     method as waiting for its owner.
 *
 *   - REMOVAL SAYS WHAT IT COSTS. Every method foreign key on
 *     UserNotificationRule is onDelete: "CASCADE", so removing one number takes
 *     every rule that pointed at it. An administrator has even less reason to
 *     expect that than the owner does.
 *
 *   - A FAILED READ IS NEVER AN EMPTY LIST. "This person has no notification
 *     methods" is the most alarming thing this page can say, and saying it
 *     because a request failed sends somebody off to reconfigure an account
 *     that is perfectly well set up.
 */

const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000001";
const SIGNED_IN_USER_ID_STRING: string = "20000000-0000-4000-8000-000000000002";
const TARGET_USER_ID_STRING: string = "30000000-0000-4000-8000-000000000003";

const EMAIL_METHOD_ID: string = "60000000-0000-4000-8000-000000000001";
const SMS_METHOD_ID: string = "60000000-0000-4000-8000-000000000002";
const WEBHOOK_METHOD_ID: string = "60000000-0000-4000-8000-000000000003";

const TARGET_USER_NAME: string = "Jane Ops";
const TARGET_USER_FIRST_NAME: string = "Jane";
const TARGET_LOGIN_EMAIL: string = "jane.ops@example.com";

// Exactly the shapes OnCallReadinessService.maskIdentifier emits.
const MASKED_EMAIL: string = "j•••@example.com";
const MASKED_PHONE: string = "+1 ••• ••• 4821";
const MASKED_WEBHOOK: string = "pa•••";

/* The values that must never survive the trip to the DOM. */
const RAW_EMAIL: string = "jane.ops.personal@example.com";
const RAW_PHONE: string = "+15551234821";
const RAW_WEBHOOK_URL: string = "https://hooks.example.com/T0P-53CR3T-T0K3N";

const ALL_RAW_IDENTIFIERS: Array<string> = [
  RAW_EMAIL,
  RAW_PHONE,
  RAW_WEBHOOK_URL,
];

const UNMASKED_EMAIL_PATTERN: RegExp =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const UNMASKED_PHONE_PATTERN: RegExp = /\+?\d[\d\s().-]{6,}\d/;

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const apiDeleteMock: MockFunction = getJestMockFunction();

let pendingRequestCount: number = 0;

type TrackRequestFunction = (result: unknown) => unknown;

const trackRequest: TrackRequestFunction = (result: unknown): unknown => {
  if (!(result instanceof Promise)) {
    return result;
  }

  pendingRequestCount++;

  return result.finally((): void => {
    pendingRequestCount--;
  });
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return trackRequest(getListMock(...args));
      },
      getItem: (...args: Array<any>) => {
        return trackRequest(getItemMock(...args));
      },
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return trackRequest(apiGetMock(...args));
      },
      post: (...args: Array<any>) => {
        return trackRequest(apiPostMock(...args));
      },
      delete: (...args: Array<any>) => {
        return trackRequest(apiDeleteMock(...args));
      },
      getFriendlyMessage: (error: unknown) => {
        const message: unknown = (error as { message?: unknown } | null)
          ?.message;

        return typeof message === "string" && message
          ? message
          : "Could not load";
      },
      getFriendlyErrorMessage: (error: unknown) => {
        const message: unknown = (error as { message?: unknown } | null)
          ?.message;

        return typeof message === "string" && message
          ? message
          : "Could not load";
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

/*
 * A stand-in ModelTable that records the model it was mounted over.
 *
 * It renders nothing on purpose. What this file needs from it is the single
 * fact that a table over UserEmail (or any of its eight siblings) would be
 * visible here at all — the self-serve method components mount exactly those,
 * so "did the admin branch accidentally render the self-serve one?" is answered
 * by this list.
 */
let mountedTableModels: Array<unknown> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { modelType: unknown }) => {
      mountedTableModels.push(props.modelType);
      return null;
    },
  };
});

import UserViewNotificationMethods, {
  CHANNELS_OFF_DESCRIPTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/NotificationMethods";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import UserViewOnCallLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/Layout";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import ProjectNotificationChannelsStore from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannels";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const SIGNED_IN_USER_ID: ObjectID = new ObjectID(SIGNED_IN_USER_ID_STRING);

/*
 * The nine models only their owner may read. Asserted as a SET because which
 * one an admin surface reaches for hardly matters — every one carries a raw
 * identifier and most carry a credential.
 */
const NOTIFICATION_METHOD_MODELS: Array<unknown> = [
  UserEmail,
  UserSMS,
  UserCall,
  UserPush,
  UserWhatsApp,
  UserTelegram,
  UserSlack,
  UserMicrosoftTeams,
  UserWebhook,
];

const pageProps: PageComponentProps = {
  pageRoute: new Route("/users/notification-methods"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface MethodSpec {
  methodId: string;
  methodType: string;
  maskedIdentifier: string;
  isVerified: boolean;
  isAdminAddable: boolean;
  // The value a leaky server — or a leaky future refactor — would hand over.
  leakedRawValue: string;
}

type MethodJsonFunction = (spec: MethodSpec) => JSONObject;

/*
 * Three plausible spellings of the same mistake, planted at once. None is part
 * of the contract the page parses, so all three are dropped and nothing
 * downstream has an unmasked value available to render by accident.
 */
const methodJson: MethodJsonFunction = (spec: MethodSpec): JSONObject => {
  return {
    methodId: spec.methodId,
    methodType: spec.methodType,
    maskedIdentifier: spec.maskedIdentifier,
    isVerified: spec.isVerified,
    isAdminAddable: spec.isAdminAddable,
    identifier: spec.leakedRawValue,
    rawIdentifier: spec.leakedRawValue,
    webhookUrl: RAW_WEBHOOK_URL,
  };
};

const VERIFIED_EMAIL: JSONObject = methodJson({
  methodId: EMAIL_METHOD_ID,
  methodType: "Email",
  maskedIdentifier: MASKED_EMAIL,
  isVerified: true,
  isAdminAddable: true,
  leakedRawValue: RAW_EMAIL,
});

const UNVERIFIED_SMS: JSONObject = methodJson({
  methodId: SMS_METHOD_ID,
  methodType: "SMS",
  maskedIdentifier: MASKED_PHONE,
  isVerified: false,
  isAdminAddable: true,
  leakedRawValue: RAW_PHONE,
});

/*
 * A webhook: listed and removable, never addable by an administrator, and with
 * no verification concept at all. It is the channel whose presence proves the
 * "add" list and the "list" list are not the same list.
 */
const WEBHOOK: JSONObject = methodJson({
  methodId: WEBHOOK_METHOD_ID,
  methodType: "Webhook",
  maskedIdentifier: MASKED_WEBHOOK,
  isVerified: true,
  isAdminAddable: false,
  leakedRawValue: RAW_WEBHOOK_URL,
});

const READINESS_PAYLOAD: JSONObject = {
  userId: TARGET_USER_ID_STRING,
  userName: TARGET_USER_NAME,
  userEmail: TARGET_LOGIN_EMAIL,
  status: "PartiallyReady",
  methods: [],
  coverage: [],
  reasons: [],
  reachedVia: ["Team"],
};

type RespondWithMethodsFunction = (methods: Array<JSONObject>) => void;

/*
 * The two GETs this page's section makes are told apart by their url: readiness
 * for the section layout, the admin method list for the page. Keying on the
 * url rather than on call order is what keeps these fixtures stable when the
 * layout's own reads change.
 */
const respondWithMethods: RespondWithMethodsFunction = (
  methods: Array<JSONObject>,
): void => {
  apiGetMock.mockImplementation((data: any) => {
    const url: string = String(data.url);

    if (url.includes("/user-notification-method-admin/")) {
      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, { methods: methods }, {}),
      );
    }

    return Promise.resolve(
      new HTTPResponse<JSONObject>(200, READINESS_PAYLOAD, {}),
    );
  });
};

type RespondWithDeletionImpactFunction = (impact: JSONObject) => void;

/*
 * The impact endpoint hangs off the same base route as the list, so its url
 * CONTAINS the list's url. It is matched first for that reason: the other way
 * round, every impact read is answered with the method list and the
 * confirmation draws a preview out of a payload that has no counts in it.
 */
const respondWithDeletionImpact: RespondWithDeletionImpactFunction = (
  impact: JSONObject,
): void => {
  apiGetMock.mockImplementation((data: any) => {
    const url: string = String(data.url);

    if (url.includes("/deletion-impact")) {
      return Promise.resolve(new HTTPResponse<JSONObject>(200, impact, {}));
    }

    if (url.includes("/user-notification-method-admin/")) {
      return Promise.resolve(
        new HTTPResponse<JSONObject>(
          200,
          { methods: [VERIFIED_EMAIL, UNVERIFIED_SMS, WEBHOOK] },
          {},
        ),
      );
    }

    return Promise.resolve(
      new HTTPResponse<JSONObject>(200, READINESS_PAYLOAD, {}),
    );
  });
};

type BuildTeamMemberFunction = () => TeamMember;

const buildTeamMember: BuildTeamMemberFunction = (): TeamMember => {
  const user: User = new User();
  user._id = TARGET_USER_ID_STRING;
  user.name = new Name(TARGET_USER_NAME);
  user.email = new Email(TARGET_LOGIN_EMAIL);

  const member: TeamMember = new TeamMember();
  member.user = user;

  return member;
};

type FlushEffectsFunction = () => Promise<void>;

/*
 * One turn of the macrotask queue, inside `act`.
 *
 * That is what it takes for an effect scheduled by the commit that just
 * happened to run, and for the render THAT effect schedules to commit in turn.
 * Awaiting a promise is not enough: React 18 schedules its work through the
 * scheduler rather than through the microtask queue, so a state update made
 * from an effect is still uncommitted when the next microtask runs.
 */
const flushEffects: FlushEffectsFunction = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
};

type IsSettledFunction = () => boolean;

/*
 * Three things, and none of them is sufficient alone.
 *
 * `pendingRequestCount` dips to zero between the SECTION layout's reads
 * finishing and the page's own read being issued — the page does not exist
 * until the layout has an identity to render it with, so waiting on the counter
 * alone hands the test a loading skeleton. Worse, the counter goes back to zero
 * one turn BEFORE the awaiting component sets any state: the tracking `finally`
 * is registered on the response promise ahead of the component's own
 * continuation, so a poll landing in that turn sees "nothing in flight" while
 * the section is still drawing its PageLoader.
 *
 * The page's own skeleton is no better on its own: it is absent before the
 * first render, and the SELF branch never renders one at all.
 *
 * So the loaders are named explicitly — `bar-loader` is PageLoader's, and it is
 * the section still deciding who this page is about.
 */
const isSettled: IsSettledFunction = (): boolean => {
  return (
    pendingRequestCount === 0 &&
    screen.queryByTestId("methods-loading") === null &&
    screen.queryByTestId("bar-loader") === null
  );
};

type AssertSettledFunction = () => void;

/*
 * The same three conditions as assertions, so a wait that runs out says WHICH
 * of them never came true rather than "timed out".
 */
const assertSettled: AssertSettledFunction = (): void => {
  expect(pendingRequestCount).toBe(0);
  expect(screen.queryByTestId("methods-loading")).not.toBeInTheDocument();
  expect(screen.queryByTestId("bar-loader")).not.toBeInTheDocument();
};

type WaitForSettledFunction = () => Promise<void>;

/*
 * Settled, and STILL settled once everything that commit scheduled has run.
 *
 * The recheck is the part that matters, and the self view is why. It issues no
 * request of its own, so the moment the layout's reads finish, every condition
 * above holds — while the tab strip it just rendered has an empty panel, because
 * Tabs picks its opening tab in an effect. A single `waitFor` returns on that
 * frame and the test reads a page that has not finished appearing. Flushing and
 * asking again is what turns "no longer busy" into "done".
 *
 * Looping rather than flushing once, because a flush can also START work — the
 * commit it releases is the one that mounts the page that issues the read.
 */
const waitForSettled: WaitForSettledFunction = async (): Promise<void> => {
  for (let attempt: number = 0; attempt < 25; attempt++) {
    await waitFor(assertSettled, { timeout: 4000 });

    await flushEffects();

    if (isSettled()) {
      return;
    }
  }

  throw new Error(
    "the page never stopped loading: it kept scheduling more work after every flush",
  );
};

type RenderPageFunction = () => Promise<HTMLElement>;

const renderPage: RenderPageFunction = async (): Promise<HTMLElement> => {
  const { container } = render(
    <MemoryRouter
      initialEntries={[
        `/dashboard/${PROJECT_ID_STRING}/users/${TARGET_USER_ID_STRING}/notification-methods`,
      ]}
    >
      <RouterRoutes>
        <RouterRoute
          path="/dashboard/:projectId/users/:id"
          element={<Outlet />}
        >
          <RouterRoute element={<UserViewOnCallLayout />}>
            <RouterRoute
              path="notification-methods"
              element={<UserViewNotificationMethods {...pageProps} />}
            />
          </RouterRoute>
        </RouterRoute>
      </RouterRoutes>
    </MemoryRouter>,
  );

  await waitForSettled();

  return container;
};

type RenderSelfPageFunction = () => Promise<HTMLElement>;

/*
 * The same route, read by the person it is about. Everything else — the
 * permissions, the fixtures, the project — stays exactly as the admin case
 * leaves it, so what these assertions read is the isSelf branch and not some
 * other difference smuggled in beside it.
 */
const renderSelfPage: RenderSelfPageFunction =
  async (): Promise<HTMLElement> => {
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID(TARGET_USER_ID_STRING));

    return renderPage();
  };

type OpenTabFunction = (name: string) => Promise<void>;

const openTab: OpenTabFunction = async (name: string): Promise<void> => {
  fireEvent.click(screen.getByTestId(`tab-${name}`));

  await waitForSettled();
};

type ChannelOptionsFunction = () => Array<string>;

/*
 * The channel dropdown is a react-select, not a <select>.
 *
 * It renders no <option> elements at all until its menu is opened, so a
 * querySelectorAll("option") over the closed one answers "no options" for a
 * dropdown with four — and every "that channel is not offered" assertion
 * written against that answer passes without having looked at anything.
 */
const channelOptions: ChannelOptionsFunction = (): Array<string> => {
  const combobox: HTMLElement | null =
    document.querySelector<HTMLElement>("[role=combobox]");

  if (!combobox) {
    throw new Error("the add form has no channel dropdown");
  }

  fireEvent.keyDown(combobox, { key: "ArrowDown", code: 40, keyCode: 40 });

  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
};

type ChooseChannelFunction = (label: string) => void;

const chooseChannel: ChooseChannelFunction = (label: string): void => {
  const offered: Array<string> = channelOptions();

  if (!offered.includes(label)) {
    throw new Error(
      `the add form does not offer ${label}; it offers ${offered.join(", ")}`,
    );
  }

  fireEvent.click(screen.getByRole("option", { name: label }));
};

type MethodRowsFunction = () => Array<HTMLElement>;

const methodRows: MethodRowsFunction = (): Array<HTMLElement> => {
  return Array.from(
    screen.getByTestId("admin-notification-method-list").querySelectorAll("li"),
  );
};

type RowForFunction = (maskedIdentifier: string) => HTMLElement;

const rowFor: RowForFunction = (maskedIdentifier: string): HTMLElement => {
  const row: HTMLElement | undefined = methodRows().find(
    (candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(maskedIdentifier);
    },
  );

  if (!row) {
    throw new Error(`no method row for ${maskedIdentifier}`);
  }

  return row;
};

type ClickButtonFunction = (root: HTMLElement, label: string) => void;

const clickButton: ClickButtonFunction = (
  root: HTMLElement,
  label: string,
): void => {
  fireEvent.click(within(root).getByText(label));
};

/*
 * Each row's actions are ONE button and a ⋯ menu holding the rest (RowActions).
 * "Resend code" is the button when a row offers it, and "Remove" then sits in
 * the menu; a row with nothing to resend keeps "Remove" as its lone button.
 * These helpers drive the menu the way a person does, and say plainly when a
 * row does not have one - a test reaching for a menu that is not there should
 * fail on that fact, not on a missing "Remove" somewhere further down.
 */
const MORE_BUTTON_TEST_ID: string = "row-actions-more-button";

type MoreButtonForFunction = (row: HTMLElement) => HTMLElement | null;

const moreButtonFor: MoreButtonForFunction = (
  row: HTMLElement,
): HTMLElement | null => {
  return within(row).queryByTestId(MORE_BUTTON_TEST_ID);
};

type RowButtonLabelsFunction = (row: HTMLElement) => Array<string>;

// The buttons drawn on the row itself, the ⋯ trigger aside.
const rowButtonLabels: RowButtonLabelsFunction = (
  row: HTMLElement,
): Array<string> => {
  return within(row)
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return button.getAttribute("data-testid") !== MORE_BUTTON_TEST_ID;
    })
    .map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    });
};

type OpenRowMenuFunction = (row: HTMLElement) => HTMLElement;

/*
 * The menu is portalled to document.body so the card around the list cannot
 * clip it, which is why it is found through `screen` rather than inside the
 * row it belongs to.
 */
const openRowMenu: OpenRowMenuFunction = (row: HTMLElement): HTMLElement => {
  const trigger: HTMLElement | null = moreButtonFor(row);

  if (!trigger) {
    throw new Error(
      `this row has no ⋯ menu; its buttons are: ${rowButtonLabels(row).join(", ")}`,
    );
  }

  fireEvent.click(trigger);

  return screen.getByRole("menu");
};

type CloseRowMenuFunction = (menu: HTMLElement) => void;

const closeRowMenu: CloseRowMenuFunction = (menu: HTMLElement): void => {
  fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0]!, {
    key: "Escape",
  });
};

type MenuItemLabelsFunction = (menu: HTMLElement) => Array<string>;

const menuItemLabels: MenuItemLabelsFunction = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

type ChooseFromRowMenuFunction = (row: HTMLElement, label: string) => void;

const chooseFromRowMenu: ChooseFromRowMenuFunction = (
  row: HTMLElement,
  label: string,
): void => {
  const menu: HTMLElement = openRowMenu(row);

  fireEvent.click(within(menu).getByRole("menuitem", { name: label }));
};

type EveryRowActionLabelFunction = () => Array<string>;

/*
 * Every action the list offers: the button on each row AND everything inside
 * each row's ⋯ menu. A scan of the buttons on screen no longer sees the whole
 * surface - a closed menu's items are not in the DOM at all - so a control
 * slipped into a menu would pass any check that only looked at the page.
 */
const everyRowActionLabel: EveryRowActionLabelFunction = (): Array<string> => {
  const labels: Array<string> = [];

  for (const row of methodRows()) {
    labels.push(...rowButtonLabels(row));

    if (moreButtonFor(row)) {
      const menu: HTMLElement = openRowMenu(row);

      labels.push(...menuItemLabels(menu));

      closeRowMenu(menu);
    }
  }

  return labels;
};

type ModalFunction = () => HTMLElement;

/*
 * The open modal, scoped.
 *
 * Its confirm button carries the same word as the row control that opened it —
 * "Remove" opens a confirmation whose submit button also says "Remove", which
 * is right for the reader and ambiguous for a global query. Scoping to the
 * dialog is also what makes "nothing was deleted by merely opening this" a
 * meaningful assertion: an unscoped click could be hitting either one.
 */
const modal: ModalFunction = (): HTMLElement => {
  return screen.getByTestId("modal");
};

beforeEach((): void => {
  mountedTableModels = [];
  pendingRequestCount = 0;

  /*
   * The self view offers Slack and Microsoft Teams only for the workspaces
   * the project has connected. Both are, unless a test says otherwise.
   */
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  ConnectedWorkspaces.setConnected(PROJECT_ID_STRING, [
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
  ]);

  getListMock.mockReset();
  getItemMock.mockReset();
  getCommonHeadersMock.mockReset();
  apiGetMock.mockReset();
  apiPostMock.mockReset();
  apiDeleteMock.mockReset();

  getListMock.mockImplementation((data: any) => {
    if (data.modelType === TeamMember) {
      return Promise.resolve({
        data: [buildTeamMember()],
        count: 1,
        skip: 0,
        limit: 1,
      });
    }

    /*
     * Anything else, INCLUDING the nine method models this page must never ask
     * for. A non-empty answer would make a leak look like a feature working, so
     * the fallback stays empty and the assertion that matters is about the
     * request rather than the response.
     */
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });

  /*
   * A project with SMS, calls, WhatsApp and Telegram on, so every channel an
   * admin may add is offered. A new project has all four off; the tests
   * under "a project with channels switched off" start from that.
   */
  const project: Project = new Project();
  project.disableOnCallNotificationFallback = false;
  project.enableSmsNotifications = true;
  project.enableCallNotifications = true;
  project.enableWhatsAppNotifications = true;
  project.enableTelegramNotifications = true;
  getItemMock.mockResolvedValue(project as never);

  // Which channels are on is shared by the page and its lists: start clean.
  ProjectNotificationChannelsStore.reset();

  getCommonHeadersMock.mockReturnValue({} as never);

  respondWithMethods([VERIFIED_EMAIL, UNVERIFIED_SMS, WEBHOOK]);

  apiPostMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, {}, {}) as never,
  );
  apiDeleteMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, {}, {}) as never,
  );

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(SIGNED_IN_USER_ID);
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
});

afterEach(async (): Promise<void> => {
  cleanup();
  ConnectedWorkspaces.reset();

  for (
    let attempt: number = 0;
    pendingRequestCount > 0 && attempt < 100;
    attempt++
  ) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  jest.restoreAllMocks();
});

describe("the list", () => {
  test("shows every channel, masked, with its verification state", async () => {
    await renderPage();

    expect(methodRows()).toHaveLength(3);

    const emailRow: HTMLElement = rowFor(MASKED_EMAIL);
    expect(emailRow.textContent).toContain("Email");
    expect(emailRow.textContent).toContain("Verified");

    /*
     * Not "Unverified". An admin who has just typed a number in needs to know
     * whose move it is next, and the answer is never theirs.
     */
    const smsRow: HTMLElement = rowFor(MASKED_PHONE);
    expect(smsRow.textContent).toContain(
      `Waiting for ${TARGET_USER_FIRST_NAME} to verify`,
    );

    /*
     * The webhook is LISTED even though an admin cannot create one. A page that
     * hid the channels it cannot add would show a responder with a working
     * webhook as having nothing, and send somebody off to add a duplicate.
     */
    expect(rowFor(MASKED_WEBHOOK).textContent).toContain("Webhook");
  });

  test("never reads a notification method model", async () => {
    await renderPage();

    const requestedModels: Array<unknown> = getListMock.mock.calls.map(
      (call: Array<any>) => {
        return call[0].modelType;
      },
    );

    /*
     * The assertion is about the REQUEST, not the render. The nine models are
     * scoped to their owner, so a read here would be refused — but a component
     * that asks is already wrong, and the refusal is not something this page
     * may rely on.
     */
    for (const model of NOTIFICATION_METHOD_MODELS) {
      expect(requestedModels).not.toContain(model);
      expect(mountedTableModels).not.toContain(model);
    }
  });

  test("asks the admin endpoint for the user in the URL", async () => {
    await renderPage();

    const methodCall: any = apiGetMock.mock.calls.find(
      (call: Array<any>): boolean => {
        return String(call[0].url).includes(
          "/user-notification-method-admin/user/",
        );
      },
    );

    expect(methodCall).toBeDefined();
    expect(String(methodCall[0].url)).toContain(TARGET_USER_ID_STRING);
    expect(String(methodCall[0].url)).not.toContain(SIGNED_IN_USER_ID_STRING);
  });

  test("a failed read says so rather than reporting an empty account", async () => {
    apiGetMock.mockImplementation((data: any) => {
      if (String(data.url).includes("/user-notification-method-admin/")) {
        return Promise.resolve(
          new HTTPErrorResponse(500, { message: "methods are down" }, {}),
        );
      }

      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, READINESS_PAYLOAD, {}),
      );
    });

    const container: HTMLElement = await renderPage();

    expect(container.textContent).toContain("methods are down");

    /*
     * "This person has no notification methods" is the most alarming thing this
     * page can print about somebody, and printing it because a request failed
     * sends an admin chasing an account that is perfectly well configured.
     */
    expect(container.textContent).not.toContain(
      "has no notification methods at all",
    );
    expect(
      screen.queryByTestId("no-methods-empty-state"),
    ).not.toBeInTheDocument();
  });

  test("the empty state says what it costs and what to do", async () => {
    respondWithMethods([]);

    const container: HTMLElement = await renderPage();

    expect(screen.getByTestId("no-methods-empty-state")).toBeInTheDocument();
    expect(container.textContent).toContain(
      "has no notification methods at all",
    );
    expect(container.textContent).toContain("dropped");

    /*
     * And it points at the control rather than at the person: this is the case
     * the whole capability exists for, so the empty state that used to say
     * "only they can add one" now says an admin can.
     */
    expect(container.textContent).toContain(
      `Add one for ${TARGET_USER_FIRST_NAME}`,
    );
  });
});

describe("adding a method on somebody's behalf", () => {
  test("offers only the four channels a code can be sent to", async () => {
    await renderPage();

    clickButton(document.body, "Add notification method");

    /*
     * Push is a device token minted at registration — there is nothing to type.
     * Telegram needs the account holder to message the bot first. Slack and
     * Microsoft Teams are born from the account holder's own OAuth workspace
     * link, which nobody can establish for them. Webhook has no verification
     * at all, so an admin-created one would be live the instant it was
     * written, which is exactly the silent redirect this design rules out.
     */
    /*
     * Read out of the OPEN menu. The page copy under the list mentions WhatsApp
     * and the rows above it mention SMS, so a scan of document.body says
     * "offered" about a channel this form has never heard of.
     */
    const optionLabels: Array<string> = channelOptions();

    expect(optionLabels).toEqual(["Email", "SMS", "Phone call", "WhatsApp"]);

    for (const forbidden of [
      "Push",
      "Telegram",
      "Slack",
      "Microsoft Teams",
      "Webhook",
    ]) {
      expect(optionLabels).not.toContain(forbidden);
    }
  });

  test("says out loud that the admin cannot finish the job", async () => {
    await renderPage();

    clickButton(document.body, "Add notification method");

    const modalText: string = document.body.textContent || "";

    /*
     * The property the whole design rests on, stated at the moment somebody is
     * about to rely on it. A method added here is inert until its owner enters
     * a code that was sent to the device — the verify endpoints compare the
     * row's owner against the signed-in caller and refuse anybody else.
     */
    expect(modalText).toContain("verification code is sent");
    expect(modalText).toContain(
      `${TARGET_USER_FIRST_NAME} has to enter that code`,
    );
    expect(modalText).toContain("you cannot verify it for them");
  });

  test("offers no way to verify a method for somebody else", async () => {
    await renderPage();

    /*
     * Structural rather than copy-deep, because the next person to be tempted
     * will add a button, not a sentence. A "verify" control here would be the
     * one thing that turns an admin typing in their own number from an inert
     * row into a redirect of somebody else's pages.
     */
    const buttonLabels: Array<string> = Array.from(
      document.querySelectorAll("button"),
    ).map((button: Element): string => {
      return (button.textContent || "").toLowerCase();
    });

    for (const label of buttonLabels) {
      expect(label).not.toContain("verify");
    }

    /*
     * And inside every row's ⋯ menu, which the scan above cannot see: a closed
     * menu's items are not in the DOM, and the menu is exactly where a new row
     * action would land.
     */
    const rowActionLabels: Array<string> = everyRowActionLabel().map(
      (label: string): string => {
        return label.toLowerCase();
      },
    );

    for (const label of rowActionLabels) {
      expect(label).not.toContain("verify");
    }

    // Not vacuous: the controls this page DOES offer are present.
    expect(buttonLabels.join(" ")).toContain("remove");
    expect(buttonLabels.join(" ")).toContain("resend code");
    expect(rowActionLabels).toContain("remove");
    expect(rowActionLabels).toContain("resend code");
  });

  test("posts the channel and the value to the admin endpoint", async () => {
    await renderPage();

    clickButton(document.body, "Add notification method");

    const valueInput: HTMLElement = screen.getByPlaceholderText(
      "you@company.com or +15551234567",
    );

    fireEvent.change(valueInput, { target: { value: RAW_PHONE } });

    chooseChannel("SMS");

    fireEvent.click(within(modal()).getByText("Add"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalled();
    });

    const call: any = apiPostMock.mock.calls[0]![0];

    /*
     * The user id travels in the URL, not in the body. The server re-derives
     * everything else — the actor, the project — from the session, so a body
     * that carried an actor would be a body a caller could sign with somebody
     * else's name.
     */
    expect(String(call.url)).toContain(
      `/user-notification-method-admin/user/${TARGET_USER_ID_STRING}`,
    );
    expect(call.data.value).toBe(RAW_PHONE);

    /*
     * And the channel the admin picked, not the one the form opened on. The
     * previous spelling of this reached for a <select> that a react-select
     * dropdown never renders, found nothing, and asserted the value of a form
     * still sitting on its default.
     */
    expect(call.data.methodType).toBe("SMS");
  });

  test("re-reads the list and the readiness summary after a successful add", async () => {
    await renderPage();

    apiGetMock.mockClear();

    clickButton(document.body, "Add notification method");

    fireEvent.change(
      screen.getByPlaceholderText("you@company.com or +15551234567"),
      { target: { value: RAW_PHONE } },
    );

    fireEvent.click(within(modal()).getByText("Add"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalled();
    });

    await waitFor((): void => {
      const urls: Array<string> = apiGetMock.mock.calls.map(
        (call: Array<any>): string => {
          return String(call[0].url);
        },
      );

      expect(
        urls.some((url: string): boolean => {
          return url.includes("/user-notification-method-admin/");
        }),
      ).toBe(true);

      /*
       * And readiness with `refresh`, because the service answers from a 60s
       * cache and the admin has just changed the answer. A cached summary
       * redrawn after the change reads as "the add did not work".
       */
      expect(
        urls.some((url: string): boolean => {
          return url.includes("/on-call-readiness/") && url.includes("refresh");
        }),
      ).toBe(true);
    });
  });

  test("surfaces the server's refusal instead of claiming success", async () => {
    await renderPage();

    apiPostMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "This user already has a SMS notification method" },
        {},
      ) as never,
    );

    clickButton(document.body, "Add notification method");

    fireEvent.change(
      screen.getByPlaceholderText("you@company.com or +15551234567"),
      { target: { value: RAW_PHONE } },
    );

    fireEvent.click(within(modal()).getByText("Add"));

    /*
     * The duplicate check, the channel check and the "not a member of this
     * project" check all live on the server, and all of them come back as a
     * message. A page that swallowed them would close the modal on a write that
     * never happened.
     */
    /*
     * findAllBy, not findBy: BasicFormModal renders `error` itself AND spreads
     * its whole props object into Modal, which renders it again. That is a
     * quirk of the shared component rather than of this page, and asserting
     * "exactly one" here would pin this test to it.
     */
    const messages: Array<HTMLElement> = await screen.findAllByText(
      /already has a SMS notification method/,
    );

    expect(messages.length).toBeGreaterThan(0);

    // The modal stays open on a refusal, so the admin can correct and retry.
    expect(
      within(modal()).getAllByText(/already has a SMS/).length,
    ).toBeGreaterThan(0);
  });
});

describe("removing a method", () => {
  test("asks for the impact before it asks for confirmation", async () => {
    await renderPage();

    apiGetMock.mockImplementation((data: any) => {
      const url: string = String(data.url);

      if (url.includes("/deletion-impact")) {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(
            200,
            {
              rulesDeletedCount: 3,
              coverageLostCount: 2,
              verifiedMethodCountAfterDeletion: 0,
              reachability: "NotReachable",
              isFallbackEnabled: true,
              isTruncated: false,
            },
            {},
          ),
        );
      }

      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, { methods: [] }, {}),
      );
    });

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    const preview: HTMLElement = await screen.findByTestId("deletion-preview");

    /*
     * Every method foreign key on UserNotificationRule is onDelete: "CASCADE",
     * so removing one address takes every rule that pointed at it. Somebody
     * tidying up a dead device has no reason to expect that, and an
     * administrator has even less than the owner does.
     */
    expect(preview.textContent).toContain(
      "3 notification rules will be deleted",
    );
    expect(preview.textContent).toContain("2 severities");

    /*
     * The one sentence worth interrupting for: every other number describes a
     * degradation, this one says nothing will be able to page them afterwards.
     */
    expect(preview.textContent).toContain(
      `${TARGET_USER_FIRST_NAME} will have no verified notification method left`,
    );
  });

  test("removes only after the confirmation, and names the method", async () => {
    await renderPage();

    /*
     * The SMS row is unverified, so "Resend code" is its button and "Remove"
     * is in its ⋯ menu.
     */
    chooseFromRowMenu(rowFor(MASKED_PHONE), "Remove");

    // Nothing is deleted by opening the confirmation.
    expect(apiDeleteMock).not.toHaveBeenCalled();

    const dialogText: string = document.body.textContent || "";

    expect(dialogText).toContain(MASKED_PHONE);
    // Said before the click, because the mail goes out whatever happens next.
    expect(dialogText).toContain("is emailed about this removal");

    fireEvent.click(within(modal()).getByText("Remove"));

    await waitFor((): void => {
      expect(apiDeleteMock).toHaveBeenCalled();
    });

    const url: string = String(apiDeleteMock.mock.calls[0]![0].url);

    /*
     * The channel and the row's own id, both in the path. The server re-checks
     * that the row belongs to this user in this project, and answers "not
     * found" identically for a row that does not exist and one that belongs to
     * somebody else — so a caller cannot probe method ids through it.
     */
    expect(url).toContain(TARGET_USER_ID_STRING);
    expect(url).toContain("SMS");
    expect(url).toContain(SMS_METHOD_ID);
  });

  test("a failed impact read does not block the removal", async () => {
    await renderPage();

    apiGetMock.mockImplementation((data: any) => {
      if (String(data.url).includes("/deletion-impact")) {
        return Promise.resolve(
          new HTTPErrorResponse(500, { message: "impact is down" }, {}),
        );
      }

      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, { methods: [] }, {}),
      );
    });

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    await waitForSettled();

    /*
     * A preview is an improvement on the confirmation, not a precondition for
     * it. Refusing to let an admin clear a dead device because a count failed
     * to load would be the worse failure — and the general warning above the
     * numbers is true with or without them.
     */
    expect(screen.queryByTestId("deletion-preview")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain(
      "every notification rule that points at it goes with it",
    );

    fireEvent.click(within(modal()).getByText("Remove"));

    await waitFor((): void => {
      expect(apiDeleteMock).toHaveBeenCalled();
    });
  });

  test("an admin may remove a channel they could never add", async () => {
    await renderPage();

    /*
     * The asymmetry, asserted on the row it is about. A webhook cannot be added
     * by an administrator — it has no verification, so it would be live
     * immediately — but a webhook pointing at a decommissioned endpoint on
     * somebody's leaving day is exactly the thing an admin has to be able to
     * clear up.
     */
    const webhookRow: HTMLElement = rowFor(MASKED_WEBHOOK);

    expect(within(webhookRow).getByText("Remove")).toBeInTheDocument();
    expect(within(webhookRow).queryByText("Resend code")).toBeNull();

    // Its only action, so a button of its own rather than a menu of one.
    expect(rowButtonLabels(webhookRow)).toEqual(["Remove"]);
    expect(moreButtonFor(webhookRow)).toBeNull();
  });
});

describe("resending a verification code", () => {
  test("is offered on an unverified method and not on a verified one", async () => {
    await renderPage();

    expect(
      within(rowFor(MASKED_PHONE)).getByText("Resend code"),
    ).toBeInTheDocument();

    expect(within(rowFor(MASKED_EMAIL)).queryByText("Resend code")).toBeNull();
  });

  test("sends to the device and says who has to read it", async () => {
    await renderPage();

    clickButton(rowFor(MASKED_PHONE), "Resend code");

    expect(document.body.textContent).toContain(MASKED_PHONE);
    expect(document.body.textContent).toContain(
      `Only ${TARGET_USER_FIRST_NAME} can read it`,
    );

    fireEvent.click(within(modal()).getByText("Resend code"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalled();
    });

    expect(String(apiPostMock.mock.calls[0]![0].url)).toContain(
      "resend-verification-code",
    );
  });
});

describe("permissions", () => {
  test("a reader without the manage permission gets the list and no controls", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ReadProjectUserNotificationRule]);

    await renderPage();

    // Still the diagnosis: they can see whether this person can be reached.
    expect(methodRows()).toHaveLength(3);

    /*
     * A convenience over the server's own check, never a substitute — the API
     * refuses these writes for the same caller anyway. Drawing buttons that
     * exist only to be rejected is its own kind of broken.
     */
    const buttonLabels: Array<string> = Array.from(
      document.querySelectorAll("button"),
    ).map((button: Element): string => {
      return (button.textContent || "").toLowerCase();
    });

    expect(buttonLabels.join(" ")).not.toContain("remove");
    expect(buttonLabels.join(" ")).not.toContain("resend code");
    expect(buttonLabels.join(" ")).not.toContain("add notification method");

    /*
     * Nor a ⋯ menu on any row. The scan above cannot see inside a closed menu,
     * so a Remove that had moved into one would sail past it; a row with no
     * action it may take draws no actions area at all.
     */
    expect(screen.queryAllByTestId(MORE_BUTTON_TEST_ID)).toHaveLength(0);
    expect(screen.queryAllByTestId("row-actions")).toHaveLength(0);
  });

  test("a project owner keeps the controls without the granular permission", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectOwner]);

    await renderPage();

    /*
     * Existing teams are seeded with ROLES, never with individual granular
     * permissions, so a permission introduced in this release is held by nobody
     * until an administrator grants it. A page checking only the granular one
     * would be dead on arrival for every project that already exists.
     */
    expect(screen.getByText("Add notification method")).toBeInTheDocument();
  });

  test("a member reading their own row gets the self-serve page instead", async () => {
    jest
      .spyOn(UserUtil, "getUserId")
      .mockReturnValue(new ObjectID(TARGET_USER_ID_STRING));

    await renderPage();

    /*
     * Their own rows, unmasked, with the verification flows — the masked admin
     * view would be a strictly worse version of the settings page they already
     * have. The self-serve components mount tables over the method models,
     * which is exactly the read that IS allowed for their owner.
     */
    expect(
      screen.queryByTestId("admin-notification-method-list"),
    ).not.toBeInTheDocument();

    expect(mountedTableModels).toContain(UserEmail);
    expect(mountedTableModels).toContain(UserSMS);

    // And it does not ask the admin endpoint about a page it is not rendering.
    const adminReads: Array<unknown> = apiGetMock.mock.calls.filter(
      (call: Array<any>): boolean => {
        return String(call[0].url).includes("/user-notification-method-admin/");
      },
    );

    expect(adminReads).toHaveLength(0);
  });
});

describe("no unmasked identifier reaches the DOM", () => {
  type AssertNoRawIdentifiersFunction = (container: HTMLElement) => void;

  const assertNoRawIdentifiers: AssertNoRawIdentifiersFunction = (
    container: HTMLElement,
  ): void => {
    /*
     * innerHTML rather than textContent, because a leak is just as real in an
     * href, a title or a data attribute as it is in visible copy.
     */
    for (const raw of ALL_RAW_IDENTIFIERS) {
      expect(container.innerHTML).not.toContain(raw);
    }

    /*
     * The scan above catches the planted values by name; these two catch the
     * SHAPE, so an identifier this file never thought of is caught too.
     */
    expect(container.textContent || "").not.toMatch(UNMASKED_EMAIL_PATTERN);
    expect(container.textContent || "").not.toMatch(UNMASKED_PHONE_PATTERN);
  };

  test("the list renders masked identifiers only", async () => {
    const container: HTMLElement = await renderPage();

    // Not vacuous: the masked forms are all present.
    expect(container.textContent).toContain(MASKED_EMAIL);
    expect(container.textContent).toContain(MASKED_PHONE);
    expect(container.textContent).toContain(MASKED_WEBHOOK);

    assertNoRawIdentifiers(container);
  });

  test("the removal confirmation names the mask, not the value", async () => {
    const container: HTMLElement = await renderPage();

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    await waitForSettled();

    expect(document.body.textContent).toContain(MASKED_EMAIL);

    assertNoRawIdentifiers(container);

    for (const raw of ALL_RAW_IDENTIFIERS) {
      expect(document.body.innerHTML).not.toContain(raw);
    }
  });
});

/*
 * The self view, in the depth the one test above it does not go to.
 *
 * This branch is the reason the masked admin list is allowed to be as narrow as
 * it is: everything an administrator cannot do here — read an identifier, enter
 * a verification code, set up a push device — the owner can do on the very same
 * route, because for them the method models are their own rows. A self view
 * that quietly rendered nothing would look exactly like a self view that
 * worked, right up until somebody needed to add a phone number.
 */
describe("the self-serve view", () => {
  test("reaches every one of the nine method models across its tabs", async () => {
    await renderSelfPage();

    /*
     * Direct Contact is the opening tab, and the five channels a person is
     * paged on directly live in it.
     */
    expect(mountedTableModels).toContain(UserEmail);
    expect(mountedTableModels).toContain(UserSMS);
    expect(mountedTableModels).toContain(UserCall);
    expect(mountedTableModels).toContain(UserWhatsApp);
    expect(mountedTableModels).toContain(UserTelegram);

    await openTab("Workspace Apps");

    expect(mountedTableModels).toContain(UserSlack);
    expect(mountedTableModels).toContain(UserMicrosoftTeams);

    await openTab("Push Notifications");

    expect(mountedTableModels).toContain(UserPush);

    await openTab("Webhooks");

    expect(mountedTableModels).toContain(UserWebhook);

    /*
     * Asserted as a set at the end as well, because the four channels an
     * administrator cannot add are exactly the ones parked on the later tabs —
     * a tab that stopped rendering would take the only surface those channels
     * have with it.
     */
    for (const model of NOTIFICATION_METHOD_MODELS) {
      expect(mountedTableModels).toContain(model);
    }
  });

  test("draws none of the administrative surface", async () => {
    const container: HTMLElement = await renderSelfPage();

    expect(
      screen.queryByTestId("admin-notification-method-list"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("no-methods-empty-state"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Add notification method")).toBeNull();

    /*
     * And none of its copy. Masked identifiers and "waiting for them to verify"
     * are both written for somebody who is not the owner; addressed to the
     * owner they describe a restriction that is not real, on a page where they
     * can do the verifying themselves.
     */
    expect(container.textContent).not.toContain(MASKED_EMAIL);
    expect(container.textContent).not.toContain(
      `Waiting for ${TARGET_USER_FIRST_NAME} to verify`,
    );
  });

  test("asks the admin capability for nothing at all", async () => {
    await renderSelfPage();

    /*
     * Not only the list read. The endpoint also carries the add, the removal,
     * the impact preview and the resend, and none of them is this page's to
     * call for its own owner — the ordinary settings components do all of it
     * against the models directly.
     */
    const adminCalls: Array<unknown> = [
      ...apiGetMock.mock.calls,
      ...apiPostMock.mock.calls,
      ...apiDeleteMock.mock.calls,
    ].filter((call: any): boolean => {
      return String(call[0].url).includes("/user-notification-method-admin/");
    });

    expect(adminCalls).toHaveLength(0);
  });

  /*
   * The Workspace Apps tab offers a table only for the workspaces the
   * project has connected, and is not there when it has none: adding Slack
   * or Microsoft Teams points at your own account in a workspace the project
   * is connected to.
   */
  test("offers only the connected workspace's table", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID_STRING, [WorkspaceType.Slack]);

    await renderSelfPage();
    await openTab("Workspace Apps");

    expect(mountedTableModels).toContain(UserSlack);
    expect(mountedTableModels).not.toContain(UserMicrosoftTeams);
  });

  test("has no Workspace Apps tab in a project with no workspace connected", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID_STRING, []);

    await renderSelfPage();

    expect(screen.queryByTestId("tab-Workspace Apps")).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-Direct Contact")).toBeInTheDocument();
    expect(screen.getByTestId("tab-Push Notifications")).toBeInTheDocument();
    expect(screen.getByTestId("tab-Webhooks")).toBeInTheDocument();
    expect(mountedTableModels).not.toContain(UserSlack);
    expect(mountedTableModels).not.toContain(UserMicrosoftTeams);
  });

  test("the admin's view of somebody else asks nothing about workspaces", async () => {
    ConnectedWorkspaces.reset();

    await renderPage();

    const requestedModels: Array<unknown> = getListMock.mock.calls.map(
      (call: Array<any>) => {
        return call[0].modelType;
      },
    );

    expect(requestedModels).not.toContain(WorkspaceProjectAuthToken);
  });

  test("says these are the same settings they already have", async () => {
    const container: HTMLElement = await renderSelfPage();

    /*
     * The banner the section renders for an owner. Somebody who arrives here
     * from a colleague's row has to be able to tell at a glance that the page
     * has changed hands — and the answer to "why does this look different from
     * User Settings" is that it is not different.
     */
    expect(container.textContent).toContain(
      "This is your own on-call configuration",
    );
  });
});

/*
 * What the page does with a row it cannot make sense of.
 *
 * Every one of these is a shape the server does not send today. They are here
 * because parseMethod exists — a page that parses field by field has decided
 * that a surprising payload is a thing that happens, and the value of that
 * decision is entirely in what it does next.
 */
describe("a row the server sends malformed", () => {
  test("a row with no id or no channel is dropped, not drawn blank", async () => {
    respondWithMethods([
      VERIFIED_EMAIL,
      // No id: there is nothing to remove or resend against.
      { methodType: "SMS", maskedIdentifier: MASKED_PHONE } as JSONObject,
      // No channel: every url this page builds puts the channel in the path.
      { methodId: SMS_METHOD_ID, maskedIdentifier: MASKED_PHONE } as JSONObject,
      // Neither.
      { maskedIdentifier: MASKED_WEBHOOK } as JSONObject,
    ]);

    await renderPage();

    expect(methodRows()).toHaveLength(1);
    expect(rowFor(MASKED_EMAIL).textContent).toContain("Email");
  });

  test("a channel with no masked identifier is blank, never the word undefined", async () => {
    respondWithMethods([
      {
        methodId: EMAIL_METHOD_ID,
        methodType: "Email",
        isVerified: true,
        isAdminAddable: true,
      } as JSONObject,
    ]);

    const container: HTMLElement = await renderPage();

    const rows: Array<HTMLElement> = methodRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Email");

    /*
     * The row is still worth drawing — the channel and the controls are the
     * useful part — but "undefined" beside a channel name reads as an
     * identifier, and it is the one word on this page nobody can act on.
     */
    expect(container.textContent).not.toContain("undefined");
  });

  test("an absent verification flag reads as unverified", async () => {
    respondWithMethods([
      {
        methodId: SMS_METHOD_ID,
        methodType: "SMS",
        maskedIdentifier: MASKED_PHONE,
      } as JSONObject,
    ]);

    await renderPage();

    /*
     * The safe direction, and not an arbitrary one: an unverified row is drawn
     * as still waiting on its owner, which is a true statement about a method
     * whose state is unknown. The other default would print "Verified" over a
     * channel nothing has confirmed.
     */
    expect(rowFor(MASKED_PHONE).textContent).toContain(
      `Waiting for ${TARGET_USER_FIRST_NAME} to verify`,
    );
  });

  /*
   * A push device is verified the moment it is registered. One that is not
   * was registered and then stopped receiving notifications: its push service
   * or Expo said it was gone. There is no code to wait for - its owner has to
   * register it again from the app or browser it belongs to - so "waiting
   * for them to verify" sent the admin after something that does not exist.
   */
  test("a push device that stopped receiving notifications waits for its owner to register it again, not to verify it", async () => {
    respondWithMethods([
      methodJson({
        methodId: WEBHOOK_METHOD_ID,
        methodType: "Push",
        maskedIdentifier: "iPh•••",
        isVerified: false,
        isAdminAddable: false,
        leakedRawValue: RAW_PHONE,
      }),
    ]);

    await renderPage();

    const row: HTMLElement = rowFor("iPh•••");

    expect(row.textContent).toContain(
      `Waiting for ${TARGET_USER_FIRST_NAME} to register it again`,
    );
    expect(row.textContent).not.toContain(
      `Waiting for ${TARGET_USER_FIRST_NAME} to verify`,
    );
    // No code exists to send: removing it is the only action an admin has.
    expect(within(row).queryByText("Resend code")).toBeNull();
    expect(rowButtonLabels(row)).toEqual(["Remove"]);
  });

  test("a push device that still receives notifications is Verified like any method", async () => {
    respondWithMethods([
      methodJson({
        methodId: WEBHOOK_METHOD_ID,
        methodType: "Push",
        maskedIdentifier: "iPh•••",
        isVerified: true,
        isAdminAddable: false,
        leakedRawValue: RAW_PHONE,
      }),
    ]);

    await renderPage();

    const row: HTMLElement = rowFor("iPh•••");

    expect(row.textContent).toContain("Verified");
    expect(row.textContent).not.toContain("register it again");
  });

  test("an unverified channel an admin could not have added offers no resend", async () => {
    const UNVERIFIED_TELEGRAM: JSONObject = methodJson({
      methodId: WEBHOOK_METHOD_ID,
      methodType: "Telegram",
      maskedIdentifier: "@ja•••",
      isVerified: false,
      isAdminAddable: false,
      leakedRawValue: RAW_PHONE,
    });

    respondWithMethods([UNVERIFIED_TELEGRAM]);

    await renderPage();

    const row: HTMLElement = rowFor("@ja•••");

    /*
     * Two separate conditions, and this row is the one that tells them apart:
     * unverified is not sufficient. Telegram's code is not something this page
     * can cause to be sent — the account holder has to message the bot — so a
     * "Resend code" button here is a button that can only fail.
     */
    expect(within(row).queryByText("Resend code")).toBeNull();
    expect(within(row).getByText("Remove")).toBeInTheDocument();

    /*
     * Not in the ⋯ menu either - there is no menu. With Remove as the row's
     * only action, it is the row's button.
     */
    expect(moreButtonFor(row)).toBeNull();
    expect(rowButtonLabels(row)).toEqual(["Remove"]);
  });
});

/*
 * The numbers in the removal confirmation, which are the last thing an
 * administrator reads before a cascade.
 */
describe("the deletion preview's arithmetic", () => {
  test("counts of one are not pluralised", async () => {
    await renderPage();

    respondWithDeletionImpact({
      rulesDeletedCount: 1,
      coverageLostCount: 1,
      verifiedMethodCountAfterDeletion: 1,
      reachability: "PartiallyReady",
      isFallbackEnabled: true,
      isTruncated: false,
    });

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    const preview: HTMLElement = await screen.findByTestId("deletion-preview");

    expect(preview.textContent).toContain(
      "1 notification rule will be deleted",
    );
    expect(preview.textContent).not.toContain("rules will be deleted");
    expect(preview.textContent).toContain("1 severity");
    expect(preview.textContent).not.toContain("severities");
  });

  test("a removal that costs no coverage does not invent a loss", async () => {
    await renderPage();

    respondWithDeletionImpact({
      rulesDeletedCount: 2,
      coverageLostCount: 0,
      verifiedMethodCountAfterDeletion: 1,
      reachability: "Ready",
      isFallbackEnabled: true,
      isTruncated: false,
    });

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    const preview: HTMLElement = await screen.findByTestId("deletion-preview");

    /*
     * Two rules go, and every severity still has one. Saying "leaving 0
     * severities with no rule at all" would be true and would still read as a
     * warning, which is how a confirmation earns its dismissal.
     */
    expect(preview.textContent).toContain(
      "2 notification rules will be deleted",
    );
    expect(preview.textContent).not.toContain("leaving");
  });

  test("somebody who keeps a verified method is not called unreachable", async () => {
    await renderPage();

    respondWithDeletionImpact({
      rulesDeletedCount: 1,
      coverageLostCount: 0,
      verifiedMethodCountAfterDeletion: 2,
      reachability: "Ready",
      isFallbackEnabled: true,
      isTruncated: false,
    });

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    await screen.findByTestId("deletion-preview");

    /*
     * The one sentence in this modal that is worth interrupting for only works
     * while it is rare. Printed over a removal that leaves two working channels
     * behind, it is the sentence somebody learns to scroll past.
     */
    expect(document.body.textContent).not.toContain(
      "will have no verified notification method left",
    );
  });

  test("a truncated count admits it is a lower bound", async () => {
    await renderPage();

    respondWithDeletionImpact({
      rulesDeletedCount: 500,
      coverageLostCount: 3,
      verifiedMethodCountAfterDeletion: 1,
      reachability: "PartiallyReady",
      isFallbackEnabled: true,
      isTruncated: true,
    });

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    const preview: HTMLElement = await screen.findByTestId("deletion-preview");

    /*
     * "500 rules will be deleted" is a number an administrator will weigh the
     * decision against, and a capped read that does not say it was capped hands
     * them a floor dressed as a total.
     */
    expect(preview.textContent).toContain("lower bound");
  });

  test("a payload that is not an impact is not drawn as one", async () => {
    await renderPage();

    // A 200 whose body has none of the counts in it.
    respondWithDeletionImpact({ methods: [] });

    clickButton(rowFor(MASKED_EMAIL), "Remove");

    await waitForSettled();

    /*
     * Cast rather than parsed, this renders "undefined notification rules will
     * be deleted" — and, worse, silently answers the reachability question,
     * because `undefined === 0` is false and the sentence about being left with
     * no verified method simply does not appear. The confirmation falls back to
     * the general warning instead, which is true without any numbers at all.
     */
    expect(screen.queryByTestId("deletion-preview")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).toContain(
      "every notification rule that points at it goes with it",
    );

    // And it is still a removal the admin can go through with.
    fireEvent.click(within(modal()).getByText("Remove"));

    await waitFor((): void => {
      expect(apiDeleteMock).toHaveBeenCalled();
    });
  });
});

describe("a write the server refuses", () => {
  test("a refused removal keeps the row and says why", async () => {
    await renderPage();

    apiDeleteMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "This method has already been removed" },
        {},
      ) as never,
    );

    chooseFromRowMenu(rowFor(MASKED_PHONE), "Remove");

    fireEvent.click(within(modal()).getByText("Remove"));

    await waitFor((): void => {
      expect(apiDeleteMock).toHaveBeenCalled();
    });

    const messages: Array<HTMLElement> =
      await screen.findAllByText(/already been removed/);

    expect(messages.length).toBeGreaterThan(0);

    /*
     * And the list underneath is untouched. Removing the row optimistically and
     * then failing would leave an administrator looking at a list that says the
     * method is gone, over an account where it is still live.
     */
    expect(methodRows()).toHaveLength(3);
    expect(rowFor(MASKED_PHONE)).toBeInTheDocument();
  });

  test("a successful removal re-reads the list and the readiness summary", async () => {
    await renderPage();

    apiGetMock.mockClear();

    chooseFromRowMenu(rowFor(MASKED_PHONE), "Remove");

    fireEvent.click(within(modal()).getByText("Remove"));

    await waitFor((): void => {
      expect(apiDeleteMock).toHaveBeenCalled();
    });

    await waitFor((): void => {
      const urls: Array<string> = apiGetMock.mock.calls.map(
        (call: Array<any>): string => {
          return String(call[0].url);
        },
      );

      expect(
        urls.some((url: string): boolean => {
          return (
            url.includes("/user-notification-method-admin/user/") &&
            !url.includes("/deletion-impact")
          );
        }),
      ).toBe(true);

      /*
       * And readiness with `refresh`, for the same reason the add does it: a
       * removal is the change most likely to have made somebody unreachable,
       * and a summary answered out of the service's 60s cache would show the
       * state from before it.
       */
      expect(
        urls.some((url: string): boolean => {
          return url.includes("/on-call-readiness/") && url.includes("refresh");
        }),
      ).toBe(true);
    });
  });

  test("a refused resend does not claim the code was sent", async () => {
    await renderPage();

    apiPostMock.mockResolvedValue(
      new HTTPErrorResponse(
        500,
        { message: "the SMS provider is down" },
        {},
      ) as never,
    );

    clickButton(rowFor(MASKED_PHONE), "Resend code");

    fireEvent.click(within(modal()).getByText("Resend code"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalled();
    });

    await waitForSettled();

    /*
     * "Code sent" over a code that was not sent is the worst of the three
     * outcomes here: the admin stops, tells the responder to go and look, and
     * the responder finds nothing.
     */
    expect(document.body.textContent).toContain("the SMS provider is down");
    expect(document.body.textContent).not.toContain("Code sent");
  });

  test("a sent code says whose job the rest of it is", async () => {
    await renderPage();

    clickButton(rowFor(MASKED_PHONE), "Resend code");

    fireEvent.click(within(modal()).getByText("Resend code"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalled();
    });

    await waitForSettled();

    expect(document.body.textContent).toContain("Code sent");
    expect(document.body.textContent).toContain(
      "needs to enter it in their own user settings",
    );
  });

  test("the resend confirmation names the mask, not the number", async () => {
    await renderPage();

    clickButton(rowFor(MASKED_PHONE), "Resend code");

    expect(document.body.textContent).toContain(MASKED_PHONE);

    for (const raw of ALL_RAW_IDENTIFIERS) {
      expect(document.body.innerHTML).not.toContain(raw);
    }
  });

  test("closing the add form writes nothing", async () => {
    await renderPage();

    clickButton(document.body, "Add notification method");

    fireEvent.change(
      screen.getByPlaceholderText("you@company.com or +15551234567"),
      { target: { value: RAW_PHONE } },
    );

    fireEvent.click(within(modal()).getByText("Cancel"));

    await waitForSettled();

    expect(apiPostMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("the form opens on the one channel no project setting can disable", async () => {
    await renderPage();

    clickButton(document.body, "Add notification method");

    fireEvent.change(
      screen.getByPlaceholderText("you@company.com or +15551234567"),
      { target: { value: RAW_EMAIL } },
    );

    fireEvent.click(within(modal()).getByText("Add"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalled();
    });

    /*
     * Submitted without touching the dropdown, which is the whole point of
     * preselecting it: SMS, Call and WhatsApp each have a per-project switch
     * behind them, and a default that lands on a disabled channel turns the
     * commonest action on this page into a refusal.
     */
    expect(apiPostMock.mock.calls[0]![0].data.methodType).toBe("Email");
  });
});

describe("who gets the controls", () => {
  test("a master admin keeps them with no project permission at all", async () => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);

    await renderPage();

    /*
     * A master admin holds no project permissions by construction — they are
     * not a member of the project — so a page checking only the project triple
     * hides this section from the one account that exists to repair things
     * nobody else can.
     */
    expect(screen.getByText("Add notification method")).toBeInTheDocument();
    expect(
      within(rowFor(MASKED_EMAIL)).getByText("Remove"),
    ).toBeInTheDocument();
  });

  test("a reader looking at an empty account is told how to get the permission", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ReadProjectUserNotificationRule]);

    respondWithMethods([]);

    const container: HTMLElement = await renderPage();

    expect(screen.getByTestId("no-methods-empty-state")).toBeInTheDocument();

    /*
     * The same alarming fact, with the action that is actually open to THIS
     * reader. Offering them "Add one for Jane" would point at a button they
     * cannot see, on a call the API would refuse.
     */
    expect(container.textContent).toContain("Manage User Notification Methods");
    expect(container.textContent).not.toContain(
      `Add one for ${TARGET_USER_FIRST_NAME}`,
    );
  });
});

/*
 * Each row's actions, drawn the way every row of actions in the product now is:
 * one button, and a ⋯ menu holding the rest.
 *
 * On this list that means "Resend code" is the button on a row that offers it
 * - it is the one thing an admin can do to move an unverified method forward -
 * and "Remove" sits in the menu under it, in red. On every other row Remove is
 * the only action, and a menu of one would only add a click, so it stays a
 * button of its own.
 *
 * The part worth pinning hardest is that a menu item acts on ITS row. The menu
 * is portalled out of the list to document.body, so nothing in the DOM ties an
 * item to the row it was opened from; a menu wired to the wrong method would
 * ask to remove one device and remove another.
 */
describe("each row's actions: one button and a ⋯ menu", () => {
  const CALL_METHOD_ID: string = "60000000-0000-4000-8000-000000000004";
  const MASKED_CALL_PHONE: string = "+1 ••• ••• 7730";
  const RAW_CALL_PHONE: string = "+15557737730";

  /*
   * A second unverified, admin-addable row, so the list holds two rows whose
   * actions are drawn identically. Anything that proves an action reached
   * "the right row" has to be able to reach the wrong one.
   */
  const UNVERIFIED_CALL: JSONObject = methodJson({
    methodId: CALL_METHOD_ID,
    methodType: "Call",
    maskedIdentifier: MASKED_CALL_PHONE,
    isVerified: false,
    isAdminAddable: true,
    leakedRawValue: RAW_CALL_PHONE,
  });

  type DeletionImpactUrlsFunction = () => Array<string>;

  const deletionImpactUrls: DeletionImpactUrlsFunction = (): Array<string> => {
    return apiGetMock.mock.calls
      .map((call: Array<any>): string => {
        return String(call[0].url);
      })
      .filter((url: string): boolean => {
        return url.includes("/deletion-impact");
      });
  };

  test("an unverified row shows Resend code as its button and Remove in the ⋯ menu", async () => {
    await renderPage();

    const row: HTMLElement = rowFor(MASKED_PHONE);

    // One button on the row, and it is the one that moves the method forward.
    expect(rowButtonLabels(row)).toEqual(["Resend code"]);
    expect(within(row).queryByText("Remove")).toBeNull();

    const trigger: HTMLElement | null = moreButtonFor(row);

    expect(trigger).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-label", "More actions");

    const menu: HTMLElement = openRowMenu(row);

    // Remove is everything else, and so the whole menu - and its last item.
    expect(menuItemLabels(menu)).toEqual(["Remove"]);

    const removeItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Remove",
    });

    /*
     * Red, because in a menu there is no bordered button left to say that this
     * one takes something away.
     */
    expect(removeItem).toHaveClass("text-red-600");

    /*
     * Portalled out of the row, so the card around the list cannot clip it.
     */
    expect(row.contains(menu)).toBe(false);
  });

  test("a verified row keeps Remove as its one button, in red, with no ⋯ menu", async () => {
    await renderPage();

    for (const masked of [MASKED_EMAIL, MASKED_WEBHOOK]) {
      const row: HTMLElement = rowFor(masked);

      expect(rowButtonLabels(row)).toEqual(["Remove"]);
      expect(moreButtonFor(row)).toBeNull();

      const removeButton: HTMLElement = within(row).getByRole("button", {
        name: "Remove",
      });

      /*
       * Still reads as destructive on its own: a red outline, as the row's
       * raw button had before.
       */
      expect(removeButton).toHaveClass("text-red-700");
      expect(removeButton).toHaveClass("border-red-700");
    }
  });

  test("opening the ⋯ menu, or closing it unused, removes nothing", async () => {
    await renderPage();

    apiGetMock.mockClear();

    const menu: HTMLElement = openRowMenu(rowFor(MASKED_PHONE));

    closeRowMenu(menu);

    await waitForSettled();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    /*
     * Not even the impact read. That request is the first step of a removal,
     * and a menu opened and dismissed has not started one.
     */
    expect(deletionImpactUrls()).toHaveLength(0);
    expect(apiDeleteMock).not.toHaveBeenCalled();
  });

  test("Remove chosen from a row's menu removes that row's method and no other", async () => {
    respondWithMethods([VERIFIED_EMAIL, UNVERIFIED_SMS, UNVERIFIED_CALL]);

    await renderPage();

    // Both unverified rows are drawn alike: Resend code, and a ⋯ menu.
    expect(rowButtonLabels(rowFor(MASKED_PHONE))).toEqual(["Resend code"]);
    expect(rowButtonLabels(rowFor(MASKED_CALL_PHONE))).toEqual(["Resend code"]);

    apiGetMock.mockClear();

    chooseFromRowMenu(rowFor(MASKED_CALL_PHONE), "Remove");

    // The menu closes on the choice rather than hanging over the dialog.
    expect(screen.queryByRole("menu")).toBeNull();

    // The confirmation is about the Call row, by channel and by mask.
    expect(
      within(modal()).getByText("Remove this Call method?"),
    ).toBeInTheDocument();
    expect(modal().textContent).toContain(MASKED_CALL_PHONE);
    expect(modal().textContent).not.toContain(MASKED_PHONE);

    // So is the impact it asked for.
    await waitFor((): void => {
      expect(deletionImpactUrls()).toHaveLength(1);
    });

    expect(deletionImpactUrls()[0]).toContain(`/Call/${CALL_METHOD_ID}/`);

    // Choosing from the menu only asks; nothing is removed until confirmed.
    expect(apiDeleteMock).not.toHaveBeenCalled();

    fireEvent.click(within(modal()).getByText("Remove"));

    await waitFor((): void => {
      expect(apiDeleteMock).toHaveBeenCalledTimes(1);
    });

    const url: string = String(apiDeleteMock.mock.calls[0]![0].url);

    expect(url).toContain(`/Call/${CALL_METHOD_ID}`);
    expect(url).not.toContain(SMS_METHOD_ID);
    expect(url).not.toContain(EMAIL_METHOD_ID);
  });

  test("Resend code on a row resends for that row's method and no other", async () => {
    respondWithMethods([VERIFIED_EMAIL, UNVERIFIED_SMS, UNVERIFIED_CALL]);

    await renderPage();

    clickButton(rowFor(MASKED_CALL_PHONE), "Resend code");

    expect(modal().textContent).toContain(MASKED_CALL_PHONE);
    expect(modal().textContent).not.toContain(MASKED_PHONE);

    fireEvent.click(within(modal()).getByText("Resend code"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalledTimes(1);
    });

    const url: string = String(apiPostMock.mock.calls[0]![0].url);

    expect(url).toContain(`/Call/${CALL_METHOD_ID}/resend-verification-code`);
    expect(url).not.toContain(SMS_METHOD_ID);
  });

  test("a row's button is handed back as soon as its confirmation opens", async () => {
    await renderPage();

    const smsRow: HTMLElement = rowFor(MASKED_PHONE);

    clickButton(smsRow, "Resend code");

    expect(within(modal()).getByText("Resend verification code")).toBeTruthy();

    /*
     * The confirmation carries the spinner for the request. A row button left
     * spinning - and so disabled - behind it would be a second spinner for the
     * same request, and one that never stops if the dialog is cancelled.
     */
    const resendButton: HTMLElement = within(smsRow).getByRole("button", {
      name: "Resend code",
    });

    expect(resendButton).toBeEnabled();
    expect(smsRow.querySelector(".animate-spin")).toBeNull();

    fireEvent.click(within(modal()).getByText("Cancel"));

    await waitForSettled();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();

    // And it works again, rather than having been used up by the first click.
    clickButton(smsRow, "Resend code");

    expect(within(modal()).getByText("Resend verification code")).toBeTruthy();

    fireEvent.click(within(modal()).getByText("Cancel"));

    await waitForSettled();

    // The same for a lone Remove button, whose confirmation also fetches.
    const emailRow: HTMLElement = rowFor(MASKED_EMAIL);

    clickButton(emailRow, "Remove");

    await waitForSettled();

    expect(
      within(modal()).getByText("Remove this Email method?"),
    ).toBeInTheDocument();

    const removeButton: HTMLElement = within(emailRow).getByRole("button", {
      name: "Remove",
    });

    expect(removeButton).toBeEnabled();
    expect(emailRow.querySelector(".animate-spin")).toBeNull();

    fireEvent.click(within(modal()).getByText("Cancel"));

    await waitForSettled();

    clickButton(emailRow, "Remove");

    await waitForSettled();

    expect(
      within(modal()).getByText("Remove this Email method?"),
    ).toBeInTheDocument();
    expect(apiDeleteMock).not.toHaveBeenCalled();
  });

  test("a cancelled removal from the menu can be chosen again", async () => {
    await renderPage();

    const smsRow: HTMLElement = rowFor(MASKED_PHONE);

    chooseFromRowMenu(smsRow, "Remove");

    await waitForSettled();

    fireEvent.click(within(modal()).getByText("Cancel"));

    await waitForSettled();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    chooseFromRowMenu(smsRow, "Remove");

    await waitForSettled();

    expect(
      within(modal()).getByText("Remove this SMS method?"),
    ).toBeInTheDocument();
    expect(apiDeleteMock).not.toHaveBeenCalled();
  });

  test("every action on the list, row and menu alike, keeps identifiers masked", async () => {
    respondWithMethods([VERIFIED_EMAIL, UNVERIFIED_SMS, UNVERIFIED_CALL]);

    await renderPage();

    /*
     * The menu is new DOM this page did not draw before, and it lives outside
     * the list - so it is scanned in its own right, open, for the raw values
     * planted in every fixture.
     */
    const menu: HTMLElement = openRowMenu(rowFor(MASKED_CALL_PHONE));

    for (const raw of [...ALL_RAW_IDENTIFIERS, RAW_CALL_PHONE]) {
      expect(menu.innerHTML).not.toContain(raw);
      expect(document.body.innerHTML).not.toContain(raw);
    }

    closeRowMenu(menu);
  });
});

/*
 * A project with SMS, calls or WhatsApp switched off - which is every new
 * project, where all four paid channels start off.
 *
 * The server refuses a method on a channel that is off ("SMS notifications
 * are disabled for this project ..."), and refuses to send an SMS or call
 * code again while it is. So the Add form offers only the channels that are
 * on (email always), says once why the others are missing, asks for an
 * email address alone when nothing else is on, and the copy under the list
 * promises only what can be added. A channel the project read could not
 * answer for is offered as before: the server has the last word.
 */
describe("a project with channels switched off", () => {
  interface ChannelSwitches {
    sms: boolean;
    call: boolean;
    whatsApp: boolean;
    telegram: boolean;
  }

  const ALL_OFF: ChannelSwitches = {
    sms: false,
    call: false,
    whatsApp: false,
    telegram: false,
  };

  const ALL_ON: ChannelSwitches = {
    sms: true,
    call: true,
    whatsApp: true,
    telegram: true,
  };

  type RespondWithChannelsFunction = (switches: ChannelSwitches) => void;

  const respondWithChannels: RespondWithChannelsFunction = (
    switches: ChannelSwitches,
  ): void => {
    const project: Project = new Project();
    project.disableOnCallNotificationFallback = false;
    project.enableSmsNotifications = switches.sms;
    project.enableCallNotifications = switches.call;
    project.enableWhatsAppNotifications = switches.whatsApp;
    project.enableTelegramNotifications = switches.telegram;
    getItemMock.mockResolvedValue(project as never);
  };

  const WHATSAPP_METHOD_ID: string = "60000000-0000-4000-8000-000000000005";
  const MASKED_WHATSAPP_PHONE: string = "+1 ••• ••• 9911";

  const UNVERIFIED_WHATSAPP: JSONObject = methodJson({
    methodId: WHATSAPP_METHOD_ID,
    methodType: "WhatsApp",
    maskedIdentifier: MASKED_WHATSAPP_PHONE,
    isVerified: false,
    isAdminAddable: true,
    leakedRawValue: "+15557779911",
  });

  /*
   * Said to the page's usual reader, a project admin: they may add methods
   * here, but only a project owner or someone with Manage Billing may turn
   * a channel on.
   */
  const WHY_MISSING: string =
    "Channels that are off in this project are not offered. A project owner, a Billing Admin or someone with Manage Billing can turn them on in Project Settings → Notification Settings.";

  // Said to someone who may turn them on, with the page as a link.
  const WHY_MISSING_WITH_LINK: string =
    "Channels that are off in this project are not offered. Turn them on in Project Settings → Notification Settings.";

  type ChannelsOffNoteFunction = () => HTMLElement;

  const channelsOffNote: ChannelsOffNoteFunction = (): HTMLElement => {
    return within(modal()).getByTestId(CHANNELS_OFF_DESCRIPTION_TEST_ID);
  };

  const OFFERED_CASES: Array<[string, ChannelSwitches, Array<string>]> = [
    ["every channel off", ALL_OFF, ["Email"]],
    ["SMS off", { ...ALL_ON, sms: false }, ["Email", "Phone call", "WhatsApp"]],
    ["calls off", { ...ALL_ON, call: false }, ["Email", "SMS", "WhatsApp"]],
    [
      "WhatsApp off",
      { ...ALL_ON, whatsApp: false },
      ["Email", "SMS", "Phone call"],
    ],
    /*
     * An admin cannot add Telegram for anyone (the account holder has to
     * message the bot), so its switch changes nothing here.
     */
    [
      "only Telegram off",
      { ...ALL_ON, telegram: false },
      ["Email", "SMS", "Phone call", "WhatsApp"],
    ],
  ];

  test.each(OFFERED_CASES)(
    "%s: the Add form offers only what is on, email always",
    async (
      _name: string,
      switches: ChannelSwitches,
      expected: Array<string>,
    ) => {
      respondWithChannels(switches);

      await renderPage();

      clickButton(document.body, "Add notification method");

      expect(channelOptions()).toEqual(expected);
    },
  );

  test("says once why a channel is missing, and nothing while every channel is on", async () => {
    respondWithChannels({ ...ALL_ON, call: false });

    await renderPage();

    clickButton(document.body, "Add notification method");

    expect(within(modal()).getByText(WHY_MISSING)).toBeInTheDocument();

    fireEvent.click(within(modal()).getByText("Cancel"));
    cleanup();

    respondWithChannels(ALL_ON);
    ProjectNotificationChannelsStore.reset();

    await renderPage();

    clickButton(document.body, "Add notification method");

    expect(within(modal()).queryByText(WHY_MISSING)).not.toBeInTheDocument();
  });

  test("a project admin, who may add methods here but not turn a channel on, is told exactly who can - with no link", async () => {
    respondWithChannels({ ...ALL_ON, sms: false });

    await renderPage();

    clickButton(document.body, "Add notification method");

    const note: HTMLElement = channelsOffNote();

    expect(note.textContent).toBe(WHY_MISSING);
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();
    expect(note.textContent?.toLowerCase()).not.toContain("project admin");
  });

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    [
      "a project admin who also has Manage Billing",
      [Permission.ProjectAdmin, Permission.ManageProjectBilling],
    ],
  ] as Array<[string, Array<Permission>]>)(
    "%s is sent straight to the switches",
    async (_who: string, permissions: Array<Permission>) => {
      jest
        .spyOn(PermissionUtil, "getAllPermissions")
        .mockReturnValue(permissions);
      respondWithChannels({ ...ALL_ON, call: false });

      await renderPage();

      clickButton(document.body, "Add notification method");

      const note: HTMLElement = channelsOffNote();

      expect(note.textContent).toBe(WHY_MISSING_WITH_LINK);

      const link: HTMLElement = within(note).getByRole("link", {
        name: "Project Settings → Notification Settings",
      });

      expect(link.getAttribute("href")).toBe(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route,
        ).toString(),
      );
      expect(link.getAttribute("href")).toContain(
        `/dashboard/${PROJECT_ID_STRING}/settings/notification-settings`,
      );
    },
  );

  test("says nothing about who can while every channel it could offer is on", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectOwner]);
    respondWithChannels(ALL_ON);

    await renderPage();

    clickButton(document.body, "Add notification method");

    expect(
      within(modal()).queryByTestId(CHANNELS_OFF_DESCRIPTION_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("with only email on, it asks for an email address alone, and adds it", async () => {
    respondWithChannels(ALL_OFF);

    await renderPage();

    clickButton(document.body, "Add notification method");

    expect(
      screen.queryByPlaceholderText("you@company.com or +15551234567"),
    ).not.toBeInTheDocument();
    expect(within(modal()).getByText("Email address")).toBeInTheDocument();
    expect(
      within(modal()).queryByText(
        "Phone numbers need the country code, for example +15551234567.",
      ),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("you@company.com"), {
      target: { value: RAW_EMAIL },
    });

    fireEvent.click(within(modal()).getByText("Add"));

    await waitFor((): void => {
      expect(apiPostMock).toHaveBeenCalled();
    });

    expect(apiPostMock.mock.calls[0]![0].data).toEqual({
      methodType: "Email",
      value: RAW_EMAIL,
    });
  });

  test.each([
    [
      "every channel on",
      ALL_ON,
      "You can add an email address, phone number or WhatsApp number for Jane, and remove any method they no longer use. Identifiers are always shown masked.",
    ],
    [
      "WhatsApp off",
      { ...ALL_ON, whatsApp: false },
      "You can add an email address or phone number for Jane, and remove any method they no longer use. Identifiers are always shown masked.",
    ],
    [
      "SMS and calls off",
      { ...ALL_ON, sms: false, call: false },
      "You can add an email address or WhatsApp number for Jane, and remove any method they no longer use. Identifiers are always shown masked.",
    ],
    [
      "every channel off",
      ALL_OFF,
      "You can add an email address for Jane, and remove any method they no longer use. Identifiers are always shown masked.",
    ],
  ])(
    "%s: the note under the list promises only what can be added",
    async (_name: string, switches: ChannelSwitches, sentence: string) => {
      respondWithChannels(switches);

      const container: HTMLElement = await renderPage();

      expect(container.textContent).toContain(sentence);
    },
  );

  test("an SMS or call code is not offered again while that channel is off; a WhatsApp one still is", async () => {
    respondWithChannels(ALL_OFF);
    respondWithMethods([VERIFIED_EMAIL, UNVERIFIED_SMS, UNVERIFIED_WHATSAPP]);

    await renderPage();

    /*
     * The server refuses to text an SMS code again while SMS is off, so the
     * row offers Remove alone. WhatsApp sends its code whatever the switch
     * says, so its row keeps Resend code.
     */
    expect(rowButtonLabels(rowFor(MASKED_PHONE))).toEqual(["Remove"]);
    expect(moreButtonFor(rowFor(MASKED_PHONE))).toBeNull();
    expect(rowButtonLabels(rowFor(MASKED_WHATSAPP_PHONE))).toEqual([
      "Resend code",
    ]);
  });

  test("with SMS on, the unverified SMS row offers Resend code again", async () => {
    respondWithChannels({ ...ALL_OFF, sms: true });
    respondWithMethods([VERIFIED_EMAIL, UNVERIFIED_SMS]);

    await renderPage();

    expect(rowButtonLabels(rowFor(MASKED_PHONE))).toEqual(["Resend code"]);
  });

  test("a project the page could not read offers every channel, as before", async () => {
    const project: Project = new Project();
    project.disableOnCallNotificationFallback = false;

    getItemMock.mockImplementation((data: any): Promise<unknown> => {
      if (data.select && data.select.enableSmsNotifications) {
        return Promise.reject(new Error("Could not read the project."));
      }

      return Promise.resolve(project);
    });

    await renderPage();

    clickButton(document.body, "Add notification method");

    /*
     * "We could not check" is not "off": the form offers what it always
     * did, says nothing about channels being off, and the server decides.
     */
    expect(channelOptions()).toEqual([
      "Email",
      "SMS",
      "Phone call",
      "WhatsApp",
    ]);
    expect(within(modal()).queryByText(WHY_MISSING)).not.toBeInTheDocument();
  });

  test("a channel turned on elsewhere on the screen is offered at once", async () => {
    respondWithChannels(ALL_OFF);

    await renderPage();

    await act(async (): Promise<void> => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: PROJECT_ID,
        column: "enableSmsNotifications",
        value: true,
        source: "another-switch",
      });
    });

    clickButton(document.body, "Add notification method");

    expect(channelOptions()).toEqual(["Email", "SMS"]);
  });

  test("the project read asks for the four switches and nothing else", async () => {
    respondWithChannels(ALL_ON);

    await renderPage();

    const channelReads: Array<any> = getItemMock.mock.calls
      .map((call: Array<any>): any => {
        return call[0];
      })
      .filter((data: any): boolean => {
        return Boolean(data.select && data.select.enableSmsNotifications);
      });

    expect(channelReads.length).toBeGreaterThanOrEqual(1);
    expect(channelReads[0].modelType).toBe(Project);
    expect(channelReads[0].id.toString()).toBe(PROJECT_ID_STRING);
    expect(channelReads[0].select).toEqual({
      enableSmsNotifications: true,
      enableCallNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
    });
  });
});
