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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE VERIFY DIALOG SAYS WHAT IS TRUE.
 *
 * A customer on a self-hosted server with no Twilio account added their
 * phone number. The dialog said "We have sent a SMS with your verification
 * code. Please don't forget to check your spam." - nothing had been sent -
 * and they asked whether they had to press Resend Code before Verify, or
 * whether Verify sent a code too.
 *
 * VerificationCodeModal, shared by the SMS, call, WhatsApp and incoming call
 * number lists, asks the server where the code stands and says that. These
 * render it with only the network stubbed and pin every state a person can
 * meet: a code waiting (and until when), the cooldown before another, an
 * expired or missing code, no code possible at all and why, a send or a
 * code that fails, and a number verified for calls too.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          (error as { message?: string } | undefined)?.message ||
          "Something went wrong"
        );
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

import VerificationCodeModal, {
  VERIFICATION_CODE_INPUT_TEST_ID,
  VERIFICATION_CODE_RESEND_TEST_ID,
  VERIFICATION_CODE_STATUS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeModal";
import {
  getVerificationCodeChannel,
  VerificationCodeChannel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeChannels";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";

const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const ITEM_ID: string = "11111111-7777-4777-8777-777777777777";
const DESTINATION: string = "+6590665484";

const NO_TWILIO: string =
  "No Twilio account is set up to send SMS. The OneUptime server's administrator can add one in Admin Dashboard > Settings > Call and SMS, or a project owner, a project admin or someone with Create Call and SMS can add this project's own in Project Settings > Notification Settings.";

interface StatusInput {
  codeState?: "active" | "expired" | "none";
  sentSecondsAgo?: number;
  expiresInSeconds?: number;
  resendAvailableInSeconds?: number;
  cannotSendReason?: string | null;
  isVerified?: boolean;
}

const statusJSON: (input: StatusInput) => JSONObject = (
  input: StatusInput,
): JSONObject => {
  const now: number = Date.now();
  const codeState: string = input.codeState || "active";
  const hasCode: boolean = codeState !== "none";

  return {
    isVerified: input.isVerified === true,
    codeState: codeState,
    codeSentAt: hasCode
      ? new Date(now - (input.sentSecondsAgo ?? 20) * 1000).toISOString()
      : null,
    codeExpiresAt: hasCode
      ? new Date(now + (input.expiresInSeconds ?? 880) * 1000).toISOString()
      : null,
    resendAvailableInSeconds: input.resendAvailableInSeconds ?? 0,
    cannotSendReason: input.cannotSendReason ?? null,
  };
};

const ok: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

const refused: (message: string) => HTTPErrorResponse = (
  message: string,
): HTTPErrorResponse => {
  return new HTTPErrorResponse(400, { message: message }, {});
};

interface Server {
  status: Array<JSONObject | Error>;
  verify: Array<HTTPResponse<JSONObject> | HTTPErrorResponse>;
  resend: Array<HTTPResponse<JSONObject> | HTTPErrorResponse>;
}

let server: Server;

// The answers the routes give, in order; the last one repeats.
const answer: <T>(queue: Array<T>) => T = <T,>(queue: Array<T>): T => {
  return queue.length > 1 ? queue.shift()! : queue[0]!;
};

const postsTo: (route: string) => Array<{ url: string; data: JSONObject }> = (
  route: string,
): Array<{ url: string; data: JSONObject }> => {
  return postMock.mock.calls
    .map((call: Array<any>) => {
      return {
        url: call[0].url.toString() as string,
        data: call[0].data as JSONObject,
      };
    })
    .filter((call: { url: string }) => {
      return call.url.endsWith(route);
    });
};

const formatTime: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
};

let onClose: MockFunction;
let onVerified: MockFunction;

const open: (channel?: VerificationCodeChannel) => Promise<void> = async (
  channel: VerificationCodeChannel = VerificationCodeChannel.SMS,
): Promise<void> => {
  render(
    <VerificationCodeModal
      channel={channel}
      itemId={ITEM_ID}
      destination={DESTINATION}
      onClose={() => {
        onClose();
      }}
      onVerified={(result: JSONObject) => {
        onVerified(result);
      }}
    />,
  );

  // The status has been read and drawn.
  await waitFor(() => {
    expect(postsTo("/verification-status").length).toBeGreaterThan(0);
  });

  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
};

const statusText: () => string = (): string => {
  return screen.getByTestId(VERIFICATION_CODE_STATUS_TEST_ID).textContent || "";
};

const submitButton: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("modal-footer-submit-button");
};

const codeInput: () => HTMLInputElement | null =
  (): HTMLInputElement | null => {
    return screen.queryByTestId(
      VERIFICATION_CODE_INPUT_TEST_ID,
    ) as HTMLInputElement | null;
  };

const typeCode: (code: string) => void = (code: string): void => {
  fireEvent.change(codeInput()!, { target: { value: code } });
};

beforeEach(() => {
  sessionStorage.setItem("current_project_id", PROJECT_ID);

  server = { status: [statusJSON({})], verify: [ok({})], resend: [] };
  onClose = getJestMockFunction();
  onVerified = getJestMockFunction();

  postMock.mockReset();
  postMock.mockImplementation(
    (request: any): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = request.url.toString();

      if (url.endsWith("/verification-status")) {
        const next: JSONObject | Error = answer(server.status);

        return next instanceof Error
          ? Promise.reject(next)
          : Promise.resolve(ok(next));
      }

      if (url.endsWith("/resend-verification-code")) {
        return Promise.resolve(answer(server.resend));
      }

      if (url.endsWith("/verify")) {
        return Promise.resolve(answer(server.verify));
      }

      return Promise.resolve(ok({}));
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  sessionStorage.clear();
});

describe("a code that is waiting", () => {
  test("says when it went out, to where, and until when it works - not 'We have sent a SMS'", async () => {
    server.status = [statusJSON({ sentSecondsAgo: 20, expiresInSeconds: 880 })];

    await open();

    const status: JSONObject = server.status[0] as JSONObject;

    expect(statusText()).toBe(
      `We sent a 6-digit code by SMS to ${DESTINATION} at ${formatTime(
        new Date(status["codeSentAt"] as string),
      )}. It works until ${formatTime(
        new Date(status["codeExpiresAt"] as string),
      )}.`,
    );
    expect(document.body.textContent).not.toContain("We have sent a SMS");
  });

  test("asks for the code, with Verify as the dialog's action", async () => {
    await open();

    expect(codeInput()).toBeInTheDocument();
    expect(codeInput()).toHaveAttribute("autocomplete", "one-time-code");
    expect(codeInput()).toHaveAttribute("inputmode", "numeric");
    expect(submitButton()).toHaveTextContent("Verify");
  });

  test("offers a new code right there, under the field, once the cooldown is over", async () => {
    server.status = [statusJSON({ resendAvailableInSeconds: 0 })];

    await open();

    const resend: HTMLElement = screen.getByTestId(
      VERIFICATION_CODE_RESEND_TEST_ID,
    );

    expect(resend).toHaveTextContent("Didn't get it?");
    expect(resend).toHaveTextContent("Send a new code");
  });

  test("counts the cooldown down a second at a time, then offers the new code", async () => {
    jest.useFakeTimers();
    server.status = [statusJSON({ resendAvailableInSeconds: 2 })];

    render(
      <VerificationCodeModal
        channel={VerificationCodeChannel.SMS}
        itemId={ITEM_ID}
        destination={DESTINATION}
        onClose={() => {}}
        onVerified={() => {}}
      />,
    );

    // The status is read: a few turns of the microtask queue, no time.
    await act(async (): Promise<void> => {
      for (let turn: number = 0; turn < 10; turn++) {
        await Promise.resolve();
      }
    });

    expect(
      screen.getByTestId(VERIFICATION_CODE_RESEND_TEST_ID),
    ).toHaveTextContent("You can ask for a new code in 2 seconds.");

    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(1000);
    });

    expect(
      screen.getByTestId(VERIFICATION_CODE_RESEND_TEST_ID),
    ).toHaveTextContent("You can ask for a new code in 1 second.");

    await act(async (): Promise<void> => {
      jest.advanceTimersByTime(1000);
    });

    expect(
      screen.getByTestId("verification-code-send-button"),
    ).toHaveTextContent("Send a new code");
  });

  test("tells the person what to do if it does not come", async () => {
    await open();

    expect(document.body.textContent).toContain(
      "Texts can take a minute to arrive. If it does not come, Project Settings > Notification Logs shows what happened to it.",
    );
  });
});

describe("a code that expired, or none at all", () => {
  test("an expired code: sending a new one is the dialog's action, and nobody is asked to type a code", async () => {
    server.status = [statusJSON({ codeState: "expired" })];

    await open();

    expect(statusText()).toBe(
      `The code we sent to ${DESTINATION} has expired. Send a new code to verify this number.`,
    );
    expect(codeInput()).toBeNull();
    expect(submitButton()).toHaveTextContent("Send a new code");
    expect(submitButton()).not.toBeDisabled();
  });

  test("no code waiting, inside the cooldown: the send waits, and says for how long", async () => {
    server.status = [
      statusJSON({ codeState: "none", resendAvailableInSeconds: 25 }),
    ];

    await open();

    expect(statusText()).toBe(
      `There is no code waiting for ${DESTINATION}. Send a new code to verify this number.`,
    );
    expect(submitButton()).toBeDisabled();
    expect(
      screen.getByTestId(VERIFICATION_CODE_RESEND_TEST_ID),
    ).toHaveTextContent("You can ask for a new code in 25 seconds.");
  });

  test("sending one turns the dialog into asking for it, with its times and the next cooldown", async () => {
    server.status = [statusJSON({ codeState: "expired" })];
    server.resend = [ok(statusJSON({ resendAvailableInSeconds: 60 }))];

    await open();

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(codeInput()).toBeInTheDocument();
    });

    expect(postsTo("/user-sms/resend-verification-code")).toHaveLength(1);
    expect(postsTo("/user-sms/resend-verification-code")[0]!.data).toEqual({
      projectId: expect.anything(),
      itemId: ITEM_ID,
    });
    expect(statusText()).toContain(
      `We sent a 6-digit code by SMS to ${DESTINATION} at`,
    );
    expect(submitButton()).toHaveTextContent("Verify");
    expect(
      screen.getByTestId(VERIFICATION_CODE_RESEND_TEST_ID),
    ).toHaveTextContent("You can ask for a new code in 60 seconds.");
  });

  test("a send that fails says why, in the server's words, and reads where things stand again", async () => {
    const reason: string =
      "The verification code was not sent to +6590665484. Twilio could not send this SMS: Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +6590665484 (Twilio error 21408).";

    server.status = [statusJSON({ codeState: "expired" })];
    server.resend = [refused(reason)];

    await open();

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain(reason);
    });

    expect(postsTo("/verification-status")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("A new code is on its way");
  });
});

describe("no code can be sent", () => {
  /*
   * The customer's case: no Twilio account. The dialog says that, and who
   * can fix it - and nothing about a code it never sent.
   */
  test("says why, and who can fix it - and nothing else", async () => {
    server.status = [
      statusJSON({ codeState: "expired", cannotSendReason: NO_TWILIO }),
    ];

    await open();

    const cannotSend: HTMLElement = screen.getByTestId(
      "verification-code-cannot-send",
    );

    expect(cannotSend).toHaveTextContent("A code can't be sent right now");
    expect(cannotSend).toHaveTextContent(NO_TWILIO);
    expect(screen.queryByTestId(VERIFICATION_CODE_STATUS_TEST_ID)).toBeNull();
    expect(document.body.textContent).not.toContain("We sent");
  });

  test("offers no send and no field, only a way out", async () => {
    server.status = [
      statusJSON({ codeState: "none", cannotSendReason: NO_TWILIO }),
    ];

    await open();

    expect(submitButton()).toBeNull();
    expect(codeInput()).toBeNull();
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Close",
    );
  });

  test("a code already waiting can still be entered, but no new one is offered", async () => {
    server.status = [
      statusJSON({ codeState: "active", cannotSendReason: NO_TWILIO }),
    ];

    await open();

    expect(codeInput()).toBeInTheDocument();
    expect(submitButton()).toHaveTextContent("Verify");
    expect(screen.queryByTestId(VERIFICATION_CODE_RESEND_TEST_ID)).toBeNull();
    expect(
      screen.getByTestId("verification-code-cannot-send"),
    ).toHaveTextContent(NO_TWILIO);
  });
});

describe("entering the code", () => {
  test("keeps only the digits of what is typed or pasted, six at most", async () => {
    await open();

    typeCode("Your code is 123 456");
    expect(codeInput()!.value).toBe("123456");

    typeCode("12a3");
    expect(codeInput()!.value).toBe("123");

    typeCode("1234567890");
    expect(codeInput()!.value).toBe("123456");
  });

  test("asks for all six digits before sending anything", async () => {
    await open();

    typeCode("123");

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton()!);
    });

    expect(document.body.textContent).toContain("Enter the 6-digit code.");
    expect(postsTo("/verify")).toHaveLength(0);
  });

  test("Enter verifies", async () => {
    await open();

    typeCode("424242");

    await act(async (): Promise<void> => {
      fireEvent.keyDown(codeInput()!, { key: "Enter" });
    });

    expect(postsTo("/user-sms/verify")).toHaveLength(1);
    expect(postsTo("/user-sms/verify")[0]!.data).toEqual({
      code: "424242",
      projectId: expect.anything(),
      itemId: ITEM_ID,
    });
  });

  test("the right code: the list refreshes and the dialog closes", async () => {
    await open();

    typeCode("424242");

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(onVerified).toHaveBeenCalledWith({});
  });

  test("a wrong code is refused in the server's words, and where things stand is read again", async () => {
    server.verify = [refused("Invalid code")];

    await open();

    typeCode("111111");

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("Invalid code");
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onVerified).not.toHaveBeenCalled();
    expect(postsTo("/verification-status")).toHaveLength(2);
  });

  test("a code used up by wrong guesses turns the dialog into sending a new one", async () => {
    server.status = [statusJSON({}), statusJSON({ codeState: "none" })];
    server.verify = [
      refused(
        "Too many incorrect attempts. This verification code is no longer valid. Please request a new code.",
      ),
    ];

    await open();

    typeCode("111111");

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(submitButton()).toHaveTextContent("Send a new code");
    });

    expect(codeInput()).toBeNull();
    expect(document.body.textContent).toContain("Too many incorrect attempts");
  });
});

describe("a number verified for calls too", () => {
  test("says so before closing, so nobody waits for a second code", async () => {
    server.verify = [ok({ alsoVerifiedForCalls: 1 })];

    await open();

    typeCode("424242");

    await act(async (): Promise<void> => {
      fireEvent.click(submitButton()!);
    });

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Phone Number Verified",
      );
    });

    expect(statusText()).toBe(
      `${DESTINATION} is verified. It is verified for calls too, so you will not need another code there.`,
    );
    expect(onVerified).toHaveBeenCalledWith({ alsoVerifiedForCalls: 1 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a number found verified already (by SMS, for a call number) says so, and the list catches up", async () => {
    server.status = [statusJSON({ isVerified: true })];

    await open(VerificationCodeChannel.Call);

    expect(statusText()).toBe(`${DESTINATION} is verified.`);
    expect(onVerified).toHaveBeenCalledWith({});
  });
});

describe("when the status cannot be read", () => {
  test("a person holding a code can still enter it, and ask for another", async () => {
    server.status = [new Error("network down")];

    await open();

    expect(statusText()).toBe(
      "We could not check whether a code is waiting for this number. If you have one, you can still enter it.",
    );
    expect(codeInput()).toBeInTheDocument();
    expect(submitButton()).toHaveTextContent("Verify");
    expect(
      screen.getByTestId(VERIFICATION_CODE_RESEND_TEST_ID),
    ).toHaveTextContent("Send a new code");
  });
});

describe("each channel", () => {
  test.each([
    [VerificationCodeChannel.SMS, "/user-sms"],
    [VerificationCodeChannel.Call, "/user-call"],
    [VerificationCodeChannel.WhatsApp, "/user-whatsapp"],
    [VerificationCodeChannel.IncomingCallNumber, "/user-incoming-call-number"],
  ])(
    "%s asks its own route, with the project and the number",
    async (channel: VerificationCodeChannel, route: string) => {
      await open(channel);

      expect(getVerificationCodeChannel(channel).apiRoute).toBe(route);
      expect(postsTo(`${route}/verification-status`)).toHaveLength(1);
      expect(postsTo(`${route}/verification-status`)[0]!.data).toEqual({
        projectId: expect.anything(),
        itemId: ITEM_ID,
      });
    },
  );

  test("a call number's dialog speaks of the call, and of verifying by SMS instead", async () => {
    server.status = [statusJSON({ resendAvailableInSeconds: 0 })];

    await open(VerificationCodeChannel.Call);

    expect(statusText()).toContain(`We called ${DESTINATION} at`);
    expect(statusText()).toContain("and read out a 6-digit code.");
    expect(
      screen.getByTestId("verification-code-send-button"),
    ).toHaveTextContent("Call me with a new code");
    expect(document.body.textContent).toContain(
      "A number you have verified for SMS is verified for calls without a code, so you can verify it there instead.",
    );
  });

  test("a WhatsApp number's dialog speaks of WhatsApp", async () => {
    await open(VerificationCodeChannel.WhatsApp);

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Verify WhatsApp Number",
    );
    expect(statusText()).toContain(
      `We sent a 6-digit code on WhatsApp to ${DESTINATION} at`,
    );
  });
});
