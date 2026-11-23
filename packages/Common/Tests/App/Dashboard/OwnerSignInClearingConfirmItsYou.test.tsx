// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeReply,
  FakeTransport,
} from "../../UI/Utils/API/FakeAxiosServer";
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
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";
import React from "react";
import ReauthenticationPrompt from "../../../UI/Components/Reauthentication/ReauthenticationPrompt";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import Route from "../../../Types/API/Route";
import {
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  REAUTHENTICATION_ROUTE,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import Email from "../../../Types/Email";
import { REFUSAL_CODE_FIELD } from "../../../Types/Exception/NameTakenException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  getProjectClearPersonSavedSignInSettingsRoute,
  getProjectClearSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsRoute,
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
} from "../../../Types/SSO/LocalSignInClearing";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Reauthentication from "../../../UI/Utils/Reauthentication";
import Toast from "../../../UI/Utils/Toast";
import UserUtil from "../../../UI/Utils/User";
import { getJestSpyOn } from "../../Spy";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import ProjectSavedSignInSettings from "../../../../App/FeatureSet/Dashboard/src/Components/Project/ProjectSavedSignInSettings";
import {
  getClearMemberSavedSignInSettingsRowAction,
  MemberSavedSignInSettings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/User/MemberSavedSignInSettings";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * A PROJECT OWNER'S CLEARS OF THEIR PEOPLE'S SAVED SIGN-IN SETTINGS WAIT
 * UNTIL THEIR SESSION CONFIRMS IT'S THEM (#10775), rendered.
 *
 * Both actions send their clear as they always did: the Require SSO card's
 * clear of everyone the owner may clear, and the Users list's row action
 * for one member. The server refuses it until the owner's session has
 * confirmed it's theirs, saying what for (AdminChange, a change to how
 * someone else signs in); the Dashboard's API client hands the refusal to
 * the one prompt, which asks for the owner's password "to make this
 * change", and once the server took it sends the very same clear again -
 * and the action says what it cleared, as before. Cancelled, nothing is
 * cleared, and the action says why. Through the real API client
 * (Common/UI/Utils/API) against a stand-in for the server's answers: the
 * server's side of the same clears is pinned over HTTP by
 * Server/API/ProjectSignInClearingConfirmItsYouOverHttp.test.ts.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const PROJECT_ID: ObjectID = new ObjectID(
  "10775000-0000-4000-8000-0000000000c1",
);
const OWNER_ID: ObjectID = new ObjectID("10775000-0000-4000-8000-0000000000a1");
const ALICE_ID: string = "10775000-0000-4000-8000-0000000000b1";

const COUNT_URL: string = `${DASHBOARD_ORIGIN}/api${getProjectSavedSignInSettingsRoute(PROJECT_ID.toString())}`;
const CLEAR_URL: string = `${DASHBOARD_ORIGIN}/api${getProjectClearSavedSignInSettingsRoute(PROJECT_ID.toString())}`;
const CLEAR_ALICE_URL: string = `${DASHBOARD_ORIGIN}/api${getProjectClearPersonSavedSignInSettingsRoute(PROJECT_ID.toString(), ALICE_ID)}`;
const STATUS_URL: string = `${DASHBOARD_ORIGIN}/api${REAUTHENTICATION_ROUTE}`;

const ALICE_SETTINGS: LocalSignInSettings = {
  ...NO_LOCAL_SIGN_IN_SETTINGS,
  hasPassword: true,
  backupCodeCount: 10,
};

// The server's refusal of a clear until the owner's session confirms (#10775).
const REFUSAL: FakeReply = {
  status: 400,
  data: {
    error:
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
    [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
    [REAUTHENTICATION_PURPOSE_FIELD]: ReauthenticationPurpose.AdminChange,
  },
};

const NOT_CONFIRMED: FakeReply = {
  status: 200,
  data: {
    isConfirmed: false,
    confirmedUntil: null,
    windowInMinutes: 10,
    methods: {
      password: true,
      secondStep: null,
      passkey: false,
      signInAgain: false,
    },
    signInAgain: null,
  },
};

const CONFIRMED: FakeReply = {
  status: 200,
  data: { confirmedUntil: "2026-11-23T10:10:00.000Z" },
};

let server: FakeAxiosServer;
let toasts: Array<string>;

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function prompt(): HTMLElement {
  return screen
    .getByTestId("reauthentication-prompt")
    .closest("[role='dialog']") as HTMLElement;
}

// What the prompt says: what it asks for, and what for.
async function expectAskedToConfirm(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("reauthentication-prompt")).toBeInTheDocument();
  });

  expect(readText(within(prompt()).getByTestId("modal-title"))).toBe(
    "Confirm It's You",
  );
  expect(readText(within(prompt()).getByTestId("modal-description"))).toBe(
    "Enter your password to make this change.",
  );
}

async function confirmWithPassword(): Promise<void> {
  fireEvent.change(screen.getByTestId("reauthentication-password"), {
    target: { value: "the right password" },
  });

  await act(async (): Promise<void> => {
    fireEvent.click(within(prompt()).getByTestId("modal-footer-submit-button"));
  });
}

async function cancelThePrompt(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(prompt()).getByTestId("modal-footer-close-button"));
  });
}

// What the owner sent to confirm it's them.
function confirmations(): Array<unknown> {
  return server
    .requestsTo(HTTPMethod.POST, STATUS_URL)
    .map((request: { data: unknown }): unknown => {
      return typeof request.data === "string"
        ? JSON.parse(request.data)
        : request.data;
    });
}

beforeEach(() => {
  localStorage.clear();
  server = new FakeAxiosServer(mockedAxios);
  toasts = [];

  getJestSpyOn(UserUtil, "getUserId").mockReturnValue(OWNER_ID);
  getJestSpyOn(UserUtil, "getEmail").mockReturnValue(
    new Email("olive@example.com"),
  );
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    PROJECT_ID,
  );
  getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID.toString(),
  });
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/settings/sso"));
  jest.spyOn(Toast, "success").mockImplementation((title: string): string => {
    toasts.push(title);
    return "toast";
  });
});

afterEach(() => {
  cleanup();
  Reauthentication.setAsker(null);
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("the Require SSO card's clear of everyone the owner may clear", () => {
  // Opens the card, and goes ahead in its dialog.
  async function clearThem(): Promise<void> {
    render(
      <>
        <ReauthenticationPrompt />
        <ProjectSavedSignInSettings projectId={PROJECT_ID} />
      </>,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("project-saved-sign-in-settings-clear"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("project-saved-sign-in-settings-clear"));

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(screen.getAllByRole("dialog")[0]!).getByTestId(
          "modal-footer-submit-button",
        ),
      );
    });
  }

  test("asks the owner to confirm it's them, to make this change; confirmed, the same clear is sent again and says what it cleared", async () => {
    server
      .on(HTTPMethod.GET, COUNT_URL, [
        { status: 200, data: { peopleCount: 3 } },
        { status: 200, data: { peopleCount: 0 } },
      ])
      .on(HTTPMethod.POST, CLEAR_URL, [
        REFUSAL,
        { status: 200, data: { peopleCleared: 3 } },
      ])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED])
      .on(HTTPMethod.POST, STATUS_URL, [CONFIRMED]);

    await clearThem();
    await expectAskedToConfirm();

    // Nothing is said as cleared while the prompt asks.
    expect(toasts).toEqual([]);
    expect(server.requestsTo(HTTPMethod.POST, CLEAR_URL)).toHaveLength(1);

    await confirmWithPassword();

    await waitFor(() => {
      expect(toasts).toEqual(["Cleared the sign-in settings of 3 people."]);
    });

    expect(confirmations()).toEqual([
      { [REAUTHENTICATION_FIELDS.password]: "the right password" },
    ]);
    // The very same clear, sent again: nobody was cleared by the refused one.
    expect(server.requestsTo(HTTPMethod.POST, CLEAR_URL)).toHaveLength(2);

    // The count is read again, and nobody is left.
    await waitFor(() => {
      expect(
        screen.queryByTestId("project-saved-sign-in-settings"),
      ).not.toBeInTheDocument();
    });
  });

  test("cancelled, nothing is cleared, and the dialog says why", async () => {
    server
      .on(HTTPMethod.GET, COUNT_URL, [{ status: 200, data: { peopleCount: 3 } }])
      .on(HTTPMethod.POST, CLEAR_URL, [REFUSAL])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED]);

    await clearThem();
    await expectAskedToConfirm();
    await cancelThePrompt();

    await waitFor(() => {
      expect(
        screen.getByText(
          REAUTHENTICATION_REQUIRED_MESSAGES[
            ReauthenticationPurpose.AdminChange
          ],
        ),
      ).toBeInTheDocument();
    });

    expect(server.requestsTo(HTTPMethod.POST, CLEAR_URL)).toHaveLength(1);
    expect(confirmations()).toEqual([]);
    expect(toasts).toEqual([]);
    expect(
      screen.getByTestId("project-saved-sign-in-settings-count"),
    ).toBeInTheDocument();
  });
});

describe("the Users list's Clear Sign-In Settings, for one member", () => {
  // Alice's row, which the server said the owner may clear.
  function aliceRow(): TeamMember {
    const member: TeamMember = new TeamMember();
    member._id = ObjectID.generate().toString();
    member.userId = new ObjectID(ALICE_ID);
    member.projectId = PROJECT_ID;
    member.hasAcceptedInvitation = true;

    const user: User = new User();
    user._id = ALICE_ID;
    user.name = new Name("Alice Smith");
    user.email = new Email("alice@example.com");
    member.user = user;

    return member;
  }

  const savedSignInSettings: () => MemberSavedSignInSettings =
    (): MemberSavedSignInSettings => {
      return {
        isAsked: true,
        onFetchSuccess: (): void => {},
        getSettings: (): LocalSignInSettings => {
          return ALICE_SETTINGS;
        },
        forget: (): void => {},
      };
    };

  interface RowOutcome {
    completed: jest.Mock;
    failed: jest.Mock;
    refresh: jest.Mock;
  }

  // Runs the row's action, as the question's button does once asked.
  async function clearAlice(): Promise<RowOutcome> {
    render(<ReauthenticationPrompt />);

    const action: ActionButtonSchema<TeamMember> =
      getClearMemberSavedSignInSettingsRowAction({
        savedSignInSettings: savedSignInSettings(),
      });

    const outcome: RowOutcome = {
      completed: jest.fn(),
      failed: jest.fn(),
      refresh: jest.fn(),
    };

    await act(async (): Promise<void> => {
      action.onClick(
        aliceRow(),
        outcome.completed as unknown as () => void,
        outcome.failed as unknown as (error: Error) => void,
        { refresh: outcome.refresh as unknown as () => void },
      );
    });

    return outcome;
  }

  test("asks the owner to confirm it's them, to make this change; confirmed, the same clear is sent again and says it cleared her", async () => {
    server
      .on(HTTPMethod.POST, CLEAR_ALICE_URL, [
        REFUSAL,
        { status: 200, data: { peopleCleared: 1 } },
      ])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED])
      .on(HTTPMethod.POST, STATUS_URL, [CONFIRMED]);

    const outcome: RowOutcome = await clearAlice();

    await expectAskedToConfirm();

    // The question waits, busy, while the prompt asks.
    expect(outcome.completed).not.toHaveBeenCalled();
    expect(outcome.failed).not.toHaveBeenCalled();

    await confirmWithPassword();

    await waitFor(() => {
      expect(outcome.completed).toHaveBeenCalledTimes(1);
    });

    expect(outcome.failed).not.toHaveBeenCalled();
    expect(outcome.refresh).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual(["Cleared Alice Smith's sign-in settings."]);
    expect(confirmations()).toEqual([
      { [REAUTHENTICATION_FIELDS.password]: "the right password" },
    ]);
    expect(server.requestsTo(HTTPMethod.POST, CLEAR_ALICE_URL)).toHaveLength(2);
  });

  test("cancelled, nothing is cleared, and the question says why", async () => {
    server
      .on(HTTPMethod.POST, CLEAR_ALICE_URL, [REFUSAL])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED]);

    const outcome: RowOutcome = await clearAlice();

    await expectAskedToConfirm();
    await cancelThePrompt();

    await waitFor(() => {
      expect(outcome.failed).toHaveBeenCalledTimes(1);
    });

    expect((outcome.failed.mock.calls[0]![0] as Error).message).toBe(
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
    );
    expect(outcome.completed).not.toHaveBeenCalled();
    expect(outcome.refresh).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
    expect(server.requestsTo(HTTPMethod.POST, CLEAR_ALICE_URL)).toHaveLength(1);
    expect(confirmations()).toEqual([]);
  });
});
