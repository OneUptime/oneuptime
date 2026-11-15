import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { describe, expect, test } from "@jest/globals";
import {
  getSessionEndReason,
  getSessionEndReasonOfRefusal,
  SESSION_END_REASONS,
  SESSION_ENDED_MESSAGES,
  SESSION_ENDED_NOTICES,
  type SessionEndReason,
} from "./sessionEnded";
import SessionEndedException, {
  SESSION_ENDED_MESSAGES as SERVER_SESSION_ENDED_MESSAGES,
} from "../../../Common/Types/Exception/SessionEndedException";
import { SessionEndReason as ServerSessionEndReason } from "../../../Common/Types/UserSession/SessionLength";

/*
 * WHY THE SERVER ENDED THE SESSION, AS THE APP READS IT (issue #8381).
 *
 * The app keeps its own copy of the server's reasons and of the refusal's
 * message for each (Common/Types/Exception/SessionEndedException), because
 * it imports nothing from Common at run time. A copy drifts: these hold it
 * to Common's word for word, and its reading of a message to Common's own
 * (SessionEndedException.getReason), so a change on either side fails here.
 */

function refusal(status: number, data: unknown): AxiosError {
  const config: InternalAxiosRequestConfig = {
    headers: {},
  } as InternalAxiosRequestConfig;

  return new AxiosError(
    `Request failed with status code ${status}`,
    String(status),
    config,
    undefined,
    {
      data,
      status,
      statusText: String(status),
      headers: {},
      config,
    } as AxiosResponse,
  );
}

describe("the app's copy of the server's reasons", () => {
  test("names every reason the server has, and no other", () => {
    expect([...SESSION_END_REASONS].sort()).toEqual(
      Object.values(ServerSessionEndReason).sort(),
    );
  });

  test("says the server's message for each, word for word", () => {
    expect(SESSION_ENDED_MESSAGES).toEqual(SERVER_SESSION_ENDED_MESSAGES);
  });

  test.each(Object.values(ServerSessionEndReason))(
    "reads %s from the message the server's exception carries",
    (reason: ServerSessionEndReason) => {
      const message: string = new SessionEndedException(reason).message;

      expect(getSessionEndReason(message)).toBe(reason);
      expect(getSessionEndReason(message)).toBe(
        SessionEndedException.getReason(message),
      );
    },
  );

  test.each<[string, unknown]>([
    ["a refresh token that ran out", "Session expired. Please login again."],
    ["a missing refresh token", "Refresh token missing. Please login again."],
    ["a blocked user", "Your account has been blocked."],
    [
      "the message cut short",
      "You were signed out after a period without activity.",
    ],
    [
      "the message in other case",
      SERVER_SESSION_ENDED_MESSAGES.inactive.toUpperCase(),
    ],
    ["the reason's own name", "inactive"],
    ["nothing", undefined],
    ["null", null],
    ["a number", 401],
    ["an object", { message: SERVER_SESSION_ENDED_MESSAGES.inactive }],
  ])(
    "reads no reason from %s, as the server's reader does",
    (_label: string, message: unknown) => {
      expect(getSessionEndReason(message)).toBeNull();
      expect(SessionEndedException.getReason(message)).toBeNull();
    },
  );
});

describe("the reason of a refused renewal", () => {
  test.each<[ServerSessionEndReason, SessionEndReason]>([
    [ServerSessionEndReason.Inactive, "inactive"],
    [ServerSessionEndReason.LengthReached, "length-reached"],
  ])(
    "a 401 whose body says the session lengths ended it: %s",
    (serverReason: ServerSessionEndReason, reason: SessionEndReason) => {
      expect(
        getSessionEndReasonOfRefusal(
          refusal(401, {
            message: SERVER_SESSION_ENDED_MESSAGES[serverReason],
          }),
        ),
      ).toBe(reason);
    },
  );

  test("a 401 that says anything else: none", () => {
    expect(
      getSessionEndReasonOfRefusal(
        refusal(401, { message: "Session expired. Please login again." }),
      ),
    ).toBeNull();
    expect(getSessionEndReasonOfRefusal(refusal(401, ""))).toBeNull();
    expect(getSessionEndReasonOfRefusal(refusal(401, null))).toBeNull();
    expect(
      getSessionEndReasonOfRefusal(
        refusal(401, SERVER_SESSION_ENDED_MESSAGES.inactive),
      ),
    ).toBeNull();
  });

  test("the session lengths' words on anything but a 401: none", () => {
    for (const status of [400, 403, 500, 502]) {
      expect(
        getSessionEndReasonOfRefusal(
          refusal(status, { message: SERVER_SESSION_ENDED_MESSAGES.inactive }),
        ),
      ).toBeNull();
    }
  });

  test("no answer at all, or no request: none", () => {
    expect(
      getSessionEndReasonOfRefusal(
        new AxiosError("Network Error", "ERR_NETWORK", {
          headers: {},
        } as InternalAxiosRequestConfig),
      ),
    ).toBeNull();
    expect(
      getSessionEndReasonOfRefusal(new Error("No refresh token available")),
    ).toBeNull();
    expect(getSessionEndReasonOfRefusal(null)).toBeNull();
    expect(getSessionEndReasonOfRefusal(undefined)).toBeNull();
  });
});

describe("what the sign-in screen says", () => {
  test("one sentence for each reason, each a sentence of its own", () => {
    expect(Object.keys(SESSION_ENDED_NOTICES).sort()).toEqual(
      [...SESSION_END_REASONS].sort(),
    );

    for (const reason of SESSION_END_REASONS) {
      const notice: string = SESSION_ENDED_NOTICES[reason];

      expect(notice).toMatch(/^You were signed out .+\.$/);
      // It is the sign-in screen: nothing about signing in again.
      expect(notice).not.toMatch(/sign in again/i);
    }
  });

  test("word for word", () => {
    expect(SESSION_ENDED_NOTICES).toEqual({
      inactive: "You were signed out after a while without use.",
      "length-reached":
        "You were signed out because your sign-in lasted as long as this server allows.",
    });
  });
});
