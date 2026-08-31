import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { MockedFunction } from "jest-mock";
import ServerUrlScreen from "./ServerUrlScreen";
import {
  clearServerUrl,
  getServerUrl,
  hasServerUrl,
} from "../../storage/serverUrl";

/*
 * The first screen a self-hoster ever sees, and the only one that decides
 * which machine every later screen will talk to. The sign-in, the SSO routers
 * and the push registration are all built on top of the one string this screen
 * writes, so the failure modes worth pinning are about what ends up in
 * storage:
 *
 *   - a server that could not be reached must NOT be stored. Storing it moves
 *     the user on to a sign-in that can only fail, with the single control
 *     that would have fixed the typo now several screens behind them and no
 *     way back to it short of reinstalling.
 *   - a server that could be reached must be stored NORMALISED. `https://host/`
 *     and `https://host` are the same instance to a person, and produce
 *     `https://host//identity/...` and `https://host/identity/...` to a reverse
 *     proxy - only one of which is routed.
 *   - what was typed is otherwise stored VERBATIM. The screen adds no scheme
 *     and upgrades no scheme, which matters because a plain-HTTP instance on an
 *     internal network is an ordinary thing to self-host, and silently
 *     rewriting it to https would strand that user with a connection failure
 *     they cannot explain.
 *
 * The storage module is deliberately NOT mocked. "Was it stored" is the whole
 * question this screen answers, and reading it back through the real module -
 * over the in-memory AsyncStorage fake in setup.ts - is the only way to answer
 * it without asserting a mock against itself. Only the reachability probe, the
 * auth context and navigation are stood in for, because none of the three can
 * run off a device.
 */

type ValidateServerUrl = (url: string) => Promise<boolean>;
type SetNeedsServerUrl = (value: boolean) => void;
type Navigate = (route: string) => void;

const mockValidateServerUrl: MockedFunction<ValidateServerUrl> =
  jest.fn<ValidateServerUrl>();
const mockSetNeedsServerUrl: MockedFunction<SetNeedsServerUrl> =
  jest.fn<SetNeedsServerUrl>();
const mockNavigate: MockedFunction<Navigate> = jest.fn<Navigate>();

jest.mock("../../api/auth", () => {
  return {
    validateServerUrl: (url: string) => {
      return mockValidateServerUrl(url);
    },
  };
});

jest.mock("../../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return { setNeedsServerUrl: mockSetNeedsServerUrl };
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});

/* A self-hosted instance: nothing about it can be guessed from a constant. */
const SELF_HOSTED_URL: string = "https://status.internal.example";

/* What the field is pre-filled with, and the app's fallback when nothing is stored. */
const HOSTED_URL: string = "https://oneuptime.com";

/**
 * The only button on the screen, found without its label.
 *
 * The label is not a stable handle here: `GradientButton` swaps "Connect" for
 * a spinner while the probe is running, so a query by name would stop finding
 * the very control the busy-state tests are about.
 */
function connectButton(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole("button");
}

function isConnectDisabled(): boolean {
  const button: { props: { accessibilityState?: { disabled?: boolean } } } =
    connectButton() as unknown as {
      props: { accessibilityState?: { disabled?: boolean } };
    };

  return button.props.accessibilityState?.disabled === true;
}

function urlField(): ReturnType<typeof screen.getByPlaceholderText> {
  return screen.getByPlaceholderText(HOSTED_URL);
}

async function typeUrl(url: string): Promise<void> {
  await fireEvent.changeText(urlField(), url);
}

/*
 * `fireEvent` hands back whatever the pressed handler returned, and this
 * handler is an async function - so awaiting the press runs the whole connect
 * flow to completion. Every test in this file whose probe answers uses that;
 * the busy-window tests further down must NOT, because a probe that has not
 * answered yet would never let the await return.
 */
async function pressConnect(): Promise<void> {
  await fireEvent.press(connectButton());
}

/*
 * A macrotask boundary for anything React queued on the way out of the handler
 * - the loading flag being cleared, most of all.
 */
async function settleConnect(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

/** Types a url and connects with it, waiting for the handler to finish. */
async function connectWith(url: string): Promise<void> {
  await typeUrl(url);
  await pressConnect();
  await settleConnect();
}

beforeEach(async (): Promise<void> => {
  /*
   * `clearMocks` in jest.config.js clears CALLS but not IMPLEMENTATIONS, so a
   * probe left resolving false - or left hanging - by an earlier test would
   * otherwise decide this one.
   */
  mockValidateServerUrl.mockReset();
  mockSetNeedsServerUrl.mockReset();
  mockNavigate.mockReset();

  mockValidateServerUrl.mockResolvedValue(true);

  /*
   * The AsyncStorage fake is one Map for the whole file, so a url stored by
   * the previous test would still be there for the "nothing was stored"
   * assertions below.
   */
  await clearServerUrl();
});

describe("What the self-hoster is handed on first launch", () => {
  test("the field starts on the hosted instance, so the common case is one tap", async () => {
    await render(<ServerUrlScreen />);

    expect(screen.getByDisplayValue(HOSTED_URL)).toBeTruthy();
  });

  test("the connect button is present and ready to press", async () => {
    await render(<ServerUrlScreen />);

    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(isConnectDisabled()).toBe(false);
  });

  test("the screen says the field is for self-hosted instances", async () => {
    /*
     * Without this sentence the pre-filled oneuptime.com reads as a fixed
     * destination rather than an editable one, and a self-hoster taps Connect
     * on somebody else's server.
     */
    await render(<ServerUrlScreen />);

    expect(screen.getByText(/Self-hosting\?/i)).toBeTruthy();
  });

  test("no error is shown before anything has been tried", async () => {
    await render(<ServerUrlScreen />);

    expect(screen.queryByText(/Could not connect/i)).toBeNull();
    expect(screen.queryByText(/Please enter a server URL/i)).toBeNull();
  });
});

describe("A server that answers", () => {
  test("the url is stored and the app is let through to sign-in", async () => {
    await render(<ServerUrlScreen />);

    await connectWith(SELF_HOSTED_URL);

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
    });

    expect(mockSetNeedsServerUrl).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });

  test("the trailing slash a person types is not part of what is stored", async () => {
    /*
     * `https://host/` + `/identity/login` is `https://host//identity/login`,
     * and a double slash is not normalised by every reverse proxy in front of
     * a self-hosted instance. The user would have typed a URL that works in
     * their browser and got an app that 404s on sign-in.
     */
    await render(<ServerUrlScreen />);

    await connectWith(`${SELF_HOSTED_URL}/`);

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
    });
  });

  test("a run of trailing slashes is stripped, not just the last one", async () => {
    await render(<ServerUrlScreen />);

    await connectWith(`${SELF_HOSTED_URL}///`);

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
    });
  });

  test("surrounding whitespace never reaches the probe or storage", async () => {
    /*
     * A pasted URL arrives with whitespace far more often than a typed one,
     * and this screen is the one people paste into.
     */
    await render(<ServerUrlScreen />);

    await connectWith(`  ${SELF_HOSTED_URL}  `);

    expect(mockValidateServerUrl).toHaveBeenCalledWith(SELF_HOSTED_URL);

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
    });
  });

  test("the url that is probed is the url that is stored", async () => {
    /*
     * If the two ever diverged the screen would be certifying one server and
     * committing the app to another, which is the one failure here that no
     * error message would ever be shown for.
     */
    await render(<ServerUrlScreen />);

    await connectWith(`${SELF_HOSTED_URL}/`);

    const probed: string = mockValidateServerUrl.mock.calls[0]![0];

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe(probed);
    });
  });
});

describe("A server that does not answer", () => {
  beforeEach(() => {
    mockValidateServerUrl.mockResolvedValue(false);
  });

  test("nothing is stored, so the user is not moved past the fix", async () => {
    await render(<ServerUrlScreen />);

    await connectWith("https://typo.internal.example");

    await waitFor(async (): Promise<void> => {
      expect(await hasServerUrl()).toBe(false);
    });
  });

  test("the failure is explained and the user is kept on this screen", async () => {
    await render(<ServerUrlScreen />);

    await connectWith("https://typo.internal.example");

    await waitFor(() => {
      expect(screen.getByText(/Could not connect to the server/i)).toBeTruthy();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockSetNeedsServerUrl).not.toHaveBeenCalled();
  });

  test("the url stays in the field so the typo can be corrected", async () => {
    await render(<ServerUrlScreen />);

    await connectWith("https://typo.internal.example");

    expect(
      screen.getByDisplayValue("https://typo.internal.example"),
    ).toBeTruthy();
  });

  test("editing the url clears the previous failure", async () => {
    /*
     * An error left standing over a url the user has since changed reads as a
     * verdict on the new one, and this is the screen where the next thing the
     * user does is always "try a different url".
     */
    await render(<ServerUrlScreen />);

    await connectWith("https://typo.internal.example");

    await waitFor(() => {
      expect(screen.getByText(/Could not connect to the server/i)).toBeTruthy();
    });

    await typeUrl(SELF_HOSTED_URL);

    expect(screen.queryByText(/Could not connect to the server/i)).toBeNull();
  });

  test("a probe that throws is reported rather than swallowed", async () => {
    mockValidateServerUrl.mockRejectedValue(new Error("boom"));

    await render(<ServerUrlScreen />);

    await connectWith(SELF_HOSTED_URL);

    await waitFor(() => {
      expect(
        screen.getByText("An unexpected error occurred. Please try again."),
      ).toBeTruthy();
    });

    expect(await hasServerUrl()).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("the connect button comes back so the user can try again", async () => {
    await render(<ServerUrlScreen />);

    await connectWith("https://typo.internal.example");

    await waitFor(() => {
      expect(isConnectDisabled()).toBe(false);
    });

    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });
});

describe("An empty submission", () => {
  test("asks for a url instead of probing an empty one", async () => {
    await render(<ServerUrlScreen />);

    await typeUrl("");
    await pressConnect();
    await settleConnect();

    expect(screen.getByText("Please enter a server URL")).toBeTruthy();
    expect(mockValidateServerUrl).not.toHaveBeenCalled();
    expect(await hasServerUrl()).toBe(false);
  });

  test("whitespace alone counts as empty", async () => {
    await render(<ServerUrlScreen />);

    await typeUrl("   ");
    await pressConnect();
    await settleConnect();

    expect(screen.getByText("Please enter a server URL")).toBeTruthy();
    expect(mockValidateServerUrl).not.toHaveBeenCalled();
  });
});

describe("While the probe is in flight", () => {
  /*
   * A probe that never settles, so the busy window can be inspected rather
   * than raced. Each test resolves it before it ends, so no state update is
   * left pending on a torn-down tree.
   */
  let releaseProbe: (isValid: boolean) => void = (): void => {
    return undefined;
  };

  beforeEach(() => {
    mockValidateServerUrl.mockImplementation((): Promise<boolean> => {
      return new Promise<boolean>(
        (resolve: (isValid: boolean) => void): void => {
          releaseProbe = resolve;
        },
      );
    });
  });

  /*
   * The press is NOT awaited here, unlike everywhere else in this file: the
   * handler is sitting on a probe that will not answer until the test says so,
   * and `fireEvent` resolves with the handler's own promise - so awaiting it
   * would hang.
   *
   * The `act` inside fireEvent is still subscribed the moment the press is
   * fired, so the loading flag the handler set before its first await does get
   * applied; it just lands a few microtasks later. Yielding a macrotask here -
   * OUTSIDE any act of our own - is what makes the busy window observable.
   */
  async function pressConnectWithoutWaiting(): Promise<void> {
    fireEvent.press(connectButton());

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  async function startProbe(): Promise<void> {
    await render(<ServerUrlScreen />);
    await typeUrl(SELF_HOSTED_URL);
    await pressConnectWithoutWaiting();
  }

  /**
   * Lets the probe answer and waits for the handler to finish.
   *
   * The button coming back out of its busy state is the handler's last act, so
   * it is a real completion signal rather than a fixed pause - and it leaves
   * nothing in flight against a tree the next test is about to tear down.
   */
  async function finishProbe(isValid: boolean): Promise<void> {
    releaseProbe(isValid);

    await waitFor(() => {
      expect(isConnectDisabled()).toBe(false);
    });
  }

  test("the button reports itself busy instead of showing its label", async () => {
    await startProbe();

    expect(isConnectDisabled()).toBe(true);
    expect(screen.queryByText("Connect")).toBeNull();

    await finishProbe(true);
  });

  test("a second press does not start a second probe", async () => {
    /*
     * Two probes are harmless on their own; two SUCCESSFUL ones each call
     * setServerUrl and navigate, and a double navigate is a stack with two
     * sign-in screens on it. The button is disabled for exactly this reason,
     * and an impatient tap on a slow connection is the normal case here.
     */
    await startProbe();

    await pressConnectWithoutWaiting();
    await pressConnectWithoutWaiting();

    expect(mockValidateServerUrl).toHaveBeenCalledTimes(1);

    await finishProbe(true);
  });

  test("nothing is stored until the probe has answered", async () => {
    await startProbe();

    expect(await hasServerUrl()).toBe(false);

    await finishProbe(true);

    expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
  });
});

describe("What the screen does not do to the url", () => {
  /*
   * These pin behaviour that is easy to "improve" by accident. Neither is a
   * defect - both are what the screen does today - and both are worth a test
   * precisely because a future change to either would be silent on a handset
   * whose owner cannot see the string that was stored.
   */

  test("a url typed without a scheme is stored exactly as typed", async () => {
    /*
     * No scheme is prepended. The probe is asked about the bare host and, if
     * it says yes, the bare host is what every later request is built from.
     */
    await render(<ServerUrlScreen />);

    await connectWith("status.internal.example");

    expect(mockValidateServerUrl).toHaveBeenCalledWith(
      "status.internal.example",
    );

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe("status.internal.example");
    });
  });

  test("http is not silently upgraded to https", async () => {
    /*
     * A self-hosted instance on an internal network very often has no TLS.
     * Upgrading the scheme for them would fail the probe on a URL that is
     * correct, and the message they would read is "check the URL".
     */
    await render(<ServerUrlScreen />);

    await connectWith("http://status.internal.example");

    expect(mockValidateServerUrl).toHaveBeenCalledWith(
      "http://status.internal.example",
    );

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe("http://status.internal.example");
    });
  });
});

describe("The keyboard's go key", () => {
  test("connects, the same as the button does", async () => {
    /*
     * `returnKeyType="go"` promises this. A user who types a url and presses
     * go on the keyboard, with the button hidden behind the keyboard, has no
     * other way to submit without dismissing it first.
     */
    await render(<ServerUrlScreen />);

    await typeUrl(SELF_HOSTED_URL);
    fireEvent(urlField(), "submitEditing");
    await settleConnect();

    await waitFor(async (): Promise<void> => {
      expect(await getServerUrl()).toBe(SELF_HOSTED_URL);
    });

    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });
});
