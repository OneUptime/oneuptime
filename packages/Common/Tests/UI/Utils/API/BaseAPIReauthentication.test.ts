// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, {
  FakeReply,
  FakeTransport,
  createGate,
  Gate,
  settle,
} from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import Navigation from "../../../../UI/Utils/Navigation";
import Reauthentication from "../../../../UI/Utils/Reauthentication";
import User from "../../../../UI/Utils/User";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import {
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  REAUTHENTICATION_ROUTE,
} from "../../../../Types/Accounts/Reauthentication";
import { REFUSAL_CODE_FIELD } from "../../../../Types/Exception/NameTakenException";
import { JSONObject } from "../../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * ONE PROMPT FOR EVERY CHANGE TO HOW YOU SIGN IN (#10155).
 *
 * The server refuses such a change - before it writes anything - until the
 * session has confirmed it's its person's, with a 400 whose code says so
 * (ReauthenticationRequiredException). The Dashboard's client hands that
 * refusal to the prompt the app mounted (Common/UI/Utils/Reauthentication)
 * and sends the same request again once the person has confirmed: so a
 * page needs nothing of its own, and what the person typed is not lost.
 *
 * Pinned against a scripted server where axios's transport would be:
 *   - a refusal asks once, and is sent again once, on a confirmation;
 *   - cancelled, or with no prompt mounted, the refusal is the answer;
 *   - any other 400, and the prompt's own requests, ask nothing;
 *   - a second refusal of the request sent again is its answer: never a
 *     loop of prompts;
 *   - requests refused at the same moment share one prompt;
 *   - ensureConfirmed asks only a session that has not confirmed.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const PROFILE_URL: string = `${DASHBOARD_ORIGIN}/api/user/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa`;
const KEY_OPTIONS_URL: string = `${DASHBOARD_ORIGIN}/api/user-webauthn/generate-registration-options`;
const STATUS_URL: string = `${DASHBOARD_ORIGIN}/api${REAUTHENTICATION_ROUTE}`;

const REFUSAL: FakeReply = {
  status: 400,
  data: {
    message: REAUTHENTICATION_MESSAGES.required,
    [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  },
};

const SAVED: FakeReply = { status: 200, data: { saved: true } };

let server: FakeAxiosServer;
let asked: number;

function askerAnswering(answer: boolean | Promise<boolean>): void {
  Reauthentication.setAsker(async (): Promise<boolean> => {
    asked++;
    return await answer;
  });
}

async function saveProfile(
  options?: JSONObject,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await BaseAPI.put<JSONObject>({
    url: URL.fromString(PROFILE_URL),
    data: { data: { password: "a new password, 2026" } },
    ...(options ? { options: options } : {}),
  });
}

beforeEach(() => {
  localStorage.clear();
  server = new FakeAxiosServer(mockedAxios);
  asked = 0;

  jest.spyOn(User, "logout").mockResolvedValue(null);
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard/user-profile/password"));
});

afterEach(() => {
  Reauthentication.setAsker(null);
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("a change refused until the session confirms it's its person's", () => {
  test("asks once, and is sent again once confirmed: the page gets the saved answer", async () => {
    askerAnswering(true);
    server.on(HTTPMethod.PUT, PROFILE_URL, [REFUSAL, SAVED]);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await saveProfile();

    expect(answer).not.toBeInstanceOf(HTTPErrorResponse);
    expect(answer.data).toEqual({ saved: true });
    expect(asked).toBe(1);

    const sent: Array<unknown> = server
      .requestsTo(HTTPMethod.PUT, PROFILE_URL)
      .map((request: { data: unknown }): unknown => {
        return request.data;
      });

    // The same request, twice: nothing the person typed is lost.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  test("cancelled: the refusal is the answer, and nothing is sent again", async () => {
    askerAnswering(false);
    server.on(HTTPMethod.PUT, PROFILE_URL, [REFUSAL]);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await saveProfile();

    expect(answer).toBeInstanceOf(HTTPErrorResponse);
    expect((answer as HTTPErrorResponse).statusCode).toBe(400);
    expect((answer as HTTPErrorResponse).message).toBe(
      REAUTHENTICATION_MESSAGES.required,
    );
    expect(server.requestsTo(HTTPMethod.PUT, PROFILE_URL)).toHaveLength(1);
  });

  test("with no prompt mounted (the Admin Dashboard): the refusal is the answer, which says what to do", async () => {
    server.on(HTTPMethod.PUT, PROFILE_URL, [REFUSAL]);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await saveProfile();

    expect((answer as HTTPErrorResponse).message).toBe(
      REAUTHENTICATION_MESSAGES.required,
    );
    expect(server.requestsTo(HTTPMethod.PUT, PROFILE_URL)).toHaveLength(1);
  });

  test("refused again after the confirmation: that is the answer - never a loop of prompts", async () => {
    askerAnswering(true);
    server.on(HTTPMethod.PUT, PROFILE_URL, [REFUSAL, REFUSAL]);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await saveProfile();

    expect(answer).toBeInstanceOf(HTTPErrorResponse);
    expect(asked).toBe(1);
    expect(server.requestsTo(HTTPMethod.PUT, PROFILE_URL)).toHaveLength(2);
  });

  test("any other refusal asks nothing", async () => {
    askerAnswering(true);
    server.on(HTTPMethod.PUT, PROFILE_URL, [
      {
        status: 400,
        data: { message: "Password must be at least 8 characters long." },
      },
    ]);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await saveProfile();

    expect((answer as HTTPErrorResponse).message).toBe(
      "Password must be at least 8 characters long.",
    );
    expect(asked).toBe(0);
  });

  test("a request that skips it - the prompt's own - asks nothing", async () => {
    askerAnswering(true);
    server.on(HTTPMethod.PUT, PROFILE_URL, [REFUSAL]);

    await saveProfile({ skipReauthentication: true });

    expect(asked).toBe(0);
  });

  test("requests refused at the same moment share one prompt, and each is sent again", async () => {
    const gate: Gate = createGate();
    let answerConfirmation: (value: boolean) => void = (): void => {};

    askerAnswering(
      new Promise<boolean>((resolve: (value: boolean) => void) => {
        answerConfirmation = resolve;
      }),
    );

    server.on(HTTPMethod.PUT, PROFILE_URL, [REFUSAL, SAVED]);
    server.on(HTTPMethod.POST, KEY_OPTIONS_URL, [
      REFUSAL,
      {
        status: 200,
        data: { options: { challenge: "c" } },
        gate: gate.promise,
      },
    ]);

    const both: Promise<Array<HTTPResponse<JSONObject> | HTTPErrorResponse>> =
      Promise.all([
        saveProfile(),
        BaseAPI.post<JSONObject>({
          url: URL.fromString(KEY_OPTIONS_URL),
          data: { isPasskey: true },
        }),
      ]);

    await settle();
    answerConfirmation(true);
    gate.open();

    const [saved, options] = await both;

    expect(asked).toBe(1);
    expect(saved.data).toEqual({ saved: true });
    expect(options.data).toEqual({ options: { challenge: "c" } });
  });
});

describe("before a step that cannot be sent again (a new key's browser prompt)", () => {
  test("a session that has confirmed is not asked", async () => {
    askerAnswering(true);
    server.on(HTTPMethod.GET, STATUS_URL, [
      {
        status: 200,
        data: {
          isConfirmed: true,
          confirmedUntil: "2026-11-20T10:10:00.000Z",
          windowInMinutes: 10,
          methods: {
            password: true,
            secondStep: null,
            passkey: false,
            signInAgain: false,
          },
        },
      },
    ]);

    expect(await Reauthentication.ensureConfirmed()).toBe(true);
    expect(asked).toBe(0);
  });

  test("a session that has not is asked, and its answer is the answer", async () => {
    askerAnswering(false);
    server.on(HTTPMethod.GET, STATUS_URL, [
      {
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
        },
      },
    ]);

    expect(await Reauthentication.ensureConfirmed()).toBe(false);
    expect(asked).toBe(1);
  });
});
