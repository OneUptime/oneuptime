import SignOutRequest, {
  SIGN_OUT_ANSWER_WAIT_IN_MS,
  SignOutAnswer,
} from "../../../UI/Utils/SignOutRequest";
import URL from "../../../Types/API/URL";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE SIGN-OUT REQUEST (issue #9508).
 *
 * Every sign-out - the Sign Out pages, a session the server ended, a deleted
 * account, a status page's reader - is sent through SignOutRequest, and the
 * page changes only once it has settled. In Firefox a page change cancels a
 * request still on its way, so a sign-out the page did not wait for never
 * reached the server, and the session's HttpOnly cookies stayed behind.
 *
 * These hold it to what that takes: a POST to the sign-out address with the
 * page's own cookies, sent keepalive so no page change cancels it; awaited
 * until the server answers, but never longer than the wait, so nobody is
 * left on a spinner; and never a rejection, so the sign-in page always
 * follows. The browser's fetch is the only stand-in.
 */

const SIGN_OUT_ADDRESS: string =
  "https://oneuptime.example.com/identity/logout";

const OTHER_SIGN_OUT_ADDRESS: string =
  "https://status.example.com/status-page-identity-api/logout/11111111-1111-4111-8111-111111111111";

interface FetchCall {
  address: string;
  init: RequestInit;
  answer: (status: number) => void;
  fail: () => void;
}

let calls: Array<FetchCall> = [];

// A fetch whose every request waits for the test to answer it.
function installFetch(): void {
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: (address: string, init: RequestInit): Promise<Response> => {
      return new Promise<Response>(
        (
          resolve: (response: Response) => void,
          reject: (error: Error) => void,
        ): void => {
          calls.push({
            address: address,
            init: init,
            answer: (status: number): void => {
              resolve({
                ok: status >= 200 && status < 300,
                status: status,
              } as Response);
            },
            fail: (): void => {
              reject(
                new TypeError(
                  "NetworkError when attempting to fetch resource.",
                ),
              );
            },
          });
        },
      );
    },
  });
}

function removeFetch(): void {
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

// Lets every promise chain that can run, run: the clock is not touched.
async function flush(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await Promise.resolve();
  }
}

// What a sign-out came to, read without waiting for it.
function watch(signOut: Promise<SignOutAnswer>): {
  answer: () => SignOutAnswer | "pending";
} {
  let answer: SignOutAnswer | "pending" = "pending";

  void signOut.then((value: SignOutAnswer): void => {
    answer = value;
  });

  return {
    answer: (): SignOutAnswer | "pending" => {
      return answer;
    },
  };
}

beforeEach(() => {
  calls = [];
  SignOutRequest.forgetSignOutsOnTheirWayForTests();
  installFetch();
});

afterEach(() => {
  jest.useRealTimers();
  SignOutRequest.forgetSignOutsOnTheirWayForTests();
  removeFetch();
});

describe("what is sent", () => {
  test("a POST to the sign-out address, sent keepalive, with the page's own cookies and no body", async () => {
    const signOut: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.address).toBe(SIGN_OUT_ADDRESS);
    expect(calls[0]!.init).toEqual({
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    calls[0]!.answer(200);

    await expect(signOut).resolves.toBe(SignOutAnswer.SignedOut);
  });

  test("it is never sent with a signal: nothing the page does cancels it, the wait running out included", async () => {
    jest.useFakeTimers();

    const signOut: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    jest.advanceTimersByTime(SIGN_OUT_ANSWER_WAIT_IN_MS);

    await expect(signOut).resolves.toBe(SignOutAnswer.StillOnItsWay);
    expect(calls[0]!.init.signal).toBeUndefined();
    expect(calls[0]!.init.keepalive).toBe(true);
  });
});

describe("how long the page waits for it", () => {
  test("until the server answers", async () => {
    const signOut: { answer: () => SignOutAnswer | "pending" } = watch(
      SignOutRequest.send(URL.fromString(SIGN_OUT_ADDRESS)),
    );

    await flush();
    expect(signOut.answer()).toBe("pending");

    calls[0]!.answer(200);
    await flush();

    expect(signOut.answer()).toBe(SignOutAnswer.SignedOut);
  });

  test("never longer than SIGN_OUT_ANSWER_WAIT_IN_MS, five seconds, so a slow server leaves nobody on a spinner", async () => {
    expect(SIGN_OUT_ANSWER_WAIT_IN_MS).toBe(5000);

    jest.useFakeTimers();

    const signOut: { answer: () => SignOutAnswer | "pending" } = watch(
      SignOutRequest.send(URL.fromString(SIGN_OUT_ADDRESS)),
    );

    jest.advanceTimersByTime(SIGN_OUT_ANSWER_WAIT_IN_MS - 1);
    await flush();
    expect(signOut.answer()).toBe("pending");

    jest.advanceTimersByTime(1);
    await flush();
    expect(signOut.answer()).toBe(SignOutAnswer.StillOnItsWay);
  });

  test("a caller may wait less", async () => {
    jest.useFakeTimers();

    const signOut: { answer: () => SignOutAnswer | "pending" } = watch(
      SignOutRequest.send(URL.fromString(SIGN_OUT_ADDRESS), { waitInMs: 50 }),
    );

    jest.advanceTimersByTime(50);
    await flush();

    expect(signOut.answer()).toBe(SignOutAnswer.StillOnItsWay);
  });

  test("an answer leaves no timer behind", async () => {
    jest.useFakeTimers();

    const signOut: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    expect(jest.getTimerCount()).toBe(1);

    calls[0]!.answer(200);
    await signOut;

    expect(jest.getTimerCount()).toBe(0);
  });

  test("an answer that comes after the wait still settles the request, which the next sign-out does not join", async () => {
    jest.useFakeTimers();

    const first: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    jest.advanceTimersByTime(SIGN_OUT_ANSWER_WAIT_IN_MS);
    await expect(first).resolves.toBe(SignOutAnswer.StillOnItsWay);

    calls[0]!.answer(200);
    await flush();

    const second: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    expect(calls).toHaveLength(2);

    calls[1]!.answer(200);
    await expect(second).resolves.toBe(SignOutAnswer.SignedOut);
  });
});

describe("what it answers, which is never a rejection", () => {
  test.each([
    { status: 200, answer: SignOutAnswer.SignedOut },
    { status: 204, answer: SignOutAnswer.SignedOut },
    { status: 400, answer: SignOutAnswer.Refused },
    { status: 500, answer: SignOutAnswer.Refused },
    { status: 502, answer: SignOutAnswer.Refused },
  ])(
    "an answer of $status is $answer",
    async (data: { status: number; answer: SignOutAnswer }) => {
      const signOut: Promise<SignOutAnswer> = SignOutRequest.send(
        URL.fromString(SIGN_OUT_ADDRESS),
      );

      calls[0]!.answer(data.status);

      await expect(signOut).resolves.toBe(data.answer);
    },
  );

  test("no answer at all - the network, or the server, out of reach - is Unreachable", async () => {
    const signOut: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    calls[0]!.fail();

    await expect(signOut).resolves.toBe(SignOutAnswer.Unreachable);
  });

  test("a fetch that throws before it sends anything is Unreachable", async () => {
    Object.defineProperty(window, "fetch", {
      configurable: true,
      writable: true,
      value: (): Promise<Response> => {
        throw new TypeError("Failed to construct 'Request'");
      },
    });

    await expect(
      SignOutRequest.send(URL.fromString(SIGN_OUT_ADDRESS)),
    ).resolves.toBe(SignOutAnswer.Unreachable);
  });

  test("a page without fetch sends nothing, and says so at once", async () => {
    removeFetch();

    await expect(
      SignOutRequest.send(URL.fromString(SIGN_OUT_ADDRESS)),
    ).resolves.toBe(SignOutAnswer.NotSent);
  });
});

describe("sign-outs at once", () => {
  test("while one is on its way, another to the same address shares it: one request", async () => {
    const first: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );
    const second: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    expect(calls).toHaveLength(1);

    calls[0]!.answer(200);

    await expect(first).resolves.toBe(SignOutAnswer.SignedOut);
    await expect(second).resolves.toBe(SignOutAnswer.SignedOut);
  });

  test("once it has been answered, the next sign-out is sent anew", async () => {
    const first: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    calls[0]!.answer(500);
    await expect(first).resolves.toBe(SignOutAnswer.Refused);

    const second: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );

    expect(calls).toHaveLength(2);

    calls[1]!.answer(200);
    await expect(second).resolves.toBe(SignOutAnswer.SignedOut);
  });

  test("a sign-out somewhere else - another status page, the dashboards - is its own request", async () => {
    const dashboards: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(SIGN_OUT_ADDRESS),
    );
    const statusPage: Promise<SignOutAnswer> = SignOutRequest.send(
      URL.fromString(OTHER_SIGN_OUT_ADDRESS),
    );

    expect(
      calls.map((call: FetchCall): string => {
        return call.address;
      }),
    ).toEqual([SIGN_OUT_ADDRESS, OTHER_SIGN_OUT_ADDRESS]);

    calls[0]!.answer(200);
    calls[1]!.fail();

    await expect(dashboards).resolves.toBe(SignOutAnswer.SignedOut);
    await expect(statusPage).resolves.toBe(SignOutAnswer.Unreachable);
  });
});
