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
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import Reauthentication from "../../../UI/Utils/Reauthentication";
import UserUtil from "../../../UI/Utils/User";
import { getJestSpyOn } from "../../Spy";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import DeleteAccount from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/DeleteAccount";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * DANGER ZONE > DELETE ACCOUNT WAITS UNTIL THE SESSION CONFIRMS IT'S YOU
 * (#10220), rendered.
 *
 * The page sends the delete as it always did. The server refuses it until
 * the session has confirmed it's its person's, saying what for
 * (DeleteAccount); the Dashboard's API client hands the refusal to the one
 * prompt, which says the confirmation is for deleting the account, and,
 * once the server took the password, sends the same delete again - and the
 * page signs out to the sign-in page, as a delete always did. Cancelled,
 * nothing is deleted, and the page says why. Through the real API client
 * (Common/UI/Utils/API) against a stand-in for the server's answers: the
 * server's side of the same delete is pinned by
 * Server/API/ReauthenticationRoutes.test.ts.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const USER_ID: ObjectID = new ObjectID("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
const DELETE_URL: string = `${DASHBOARD_ORIGIN}/api/user/${USER_ID.toString()}`;
const STATUS_URL: string = `${DASHBOARD_ORIGIN}/api${REAUTHENTICATION_ROUTE}`;

// The server's refusal of the delete until the session confirms (#10220).
const REFUSAL: FakeReply = {
  status: 400,
  data: {
    message:
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.DeleteAccount],
    [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
    [REAUTHENTICATION_PURPOSE_FIELD]: ReauthenticationPurpose.DeleteAccount,
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
  data: { confirmedUntil: "2026-11-20T10:10:00.000Z" },
};

const DELETED: FakeReply = { status: 200, data: {} };

let server: FakeAxiosServer;
let logout: jest.SpyInstance;
let navigate: jest.SpyInstance;

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

// Opens Danger Zone > Delete Account, and confirms the delete in its dialog.
async function deleteTheAccount(): Promise<void> {
  render(
    <>
      <ReauthenticationPrompt />
      <DeleteAccount
        pageRoute={new Route("/dashboard/user-profile/delete-account")}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </>,
  );

  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Delete Account" }),
    ).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));

  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
}

function prompt(): HTMLElement {
  return screen
    .getByTestId("reauthentication-prompt")
    .closest("[role='dialog']") as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  server = new FakeAxiosServer(mockedAxios);

  // No projects left, so the account can be deleted.
  getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 100,
  } as never);
  getJestSpyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);
  getJestSpyOn(UserUtil, "getEmail").mockReturnValue(
    new Email("river@example.com"),
  );
  logout = jest.spyOn(UserUtil, "logout").mockResolvedValue(null);
  navigate = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/user-profile/delete-account"));
});

afterEach(() => {
  cleanup();
  Reauthentication.setAsker(null);
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("deleting your own account asks you to confirm it's you", () => {
  test("the prompt says it is for deleting your account; confirmed, the same delete is sent again, and you are signed out", async () => {
    server
      .on(HTTPMethod.DELETE, DELETE_URL, [REFUSAL, DELETED])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED])
      .on(HTTPMethod.POST, STATUS_URL, [CONFIRMED]);

    await deleteTheAccount();

    await waitFor(() => {
      expect(screen.getByTestId("reauthentication-prompt")).toBeInTheDocument();
    });

    expect(readText(within(prompt()).getByTestId("modal-title"))).toBe(
      "Confirm It's You",
    );
    expect(readText(within(prompt()).getByTestId("modal-description"))).toBe(
      "Enter your password to delete your account.",
    );

    // Nothing is deleted, nor anyone signed out, while the prompt asks.
    expect(logout).not.toHaveBeenCalled();
    expect(server.requestsTo(HTTPMethod.DELETE, DELETE_URL)).toHaveLength(1);

    fireEvent.change(screen.getByTestId("reauthentication-password"), {
      target: { value: "the right password" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(prompt()).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });

    const confirmations: Array<unknown> = server
      .requestsTo(HTTPMethod.POST, STATUS_URL)
      .map((request: { data: unknown }): unknown => {
        return typeof request.data === "string"
          ? JSON.parse(request.data)
          : request.data;
      });

    expect(confirmations).toEqual([
      { [REAUTHENTICATION_FIELDS.password]: "the right password" },
    ]);
    expect(server.requestsTo(HTTPMethod.DELETE, DELETE_URL)).toHaveLength(2);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe("/accounts/login");
  });

  test("cancelled, nothing is deleted, nobody is signed out, and the page says why", async () => {
    server
      .on(HTTPMethod.DELETE, DELETE_URL, [REFUSAL])
      .on(HTTPMethod.GET, STATUS_URL, [NOT_CONFIRMED]);

    await deleteTheAccount();

    await waitFor(() => {
      expect(screen.getByTestId("reauthentication-prompt")).toBeInTheDocument();
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(prompt()).getByTestId("modal-footer-close-button"),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          REAUTHENTICATION_REQUIRED_MESSAGES[
            ReauthenticationPurpose.DeleteAccount
          ],
        ),
      ).toBeInTheDocument();
    });

    expect(server.requestsTo(HTTPMethod.DELETE, DELETE_URL)).toHaveLength(1);
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
