import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BackupCodesScreen from "./BackupCodesScreen";
import type { MockedFunction } from "jest-mock";

/*
 * THE ONLY SCREEN IN THE APP THAT CAN LOSE SOMETHING IRRECOVERABLE.
 *
 * The recovery codes rendered here exist in this process's memory and nowhere
 * else, ever. The server keeps keyed digests, so nobody -- not the user, not
 * an operator, not somebody holding a database dump -- can produce them a
 * second time. Every assertion below is about one of the two ways that goes
 * wrong:
 *
 *   SHOW MODE loses the CODES by moving on. `completePendingLogin` swaps the
 *   whole navigator, so calling it while the codes are on screen destroys
 *   them. The acknowledgement checkbox is the only thing standing between a
 *   reflexive tap and an account whose owner believes they hold eight codes
 *   they have never read. A tidy-up that enables Continue by default, or wires
 *   it to the checkbox's label rather than its state, would be invisible in
 *   review and silent in production: the user is signed in, which is what they
 *   wanted, and finds out months later at the sign-in they cannot complete.
 *
 *   Sharing is the other half of that. A user who cannot get the codes off the
 *   handset has not saved them, whatever they ticked -- nobody retypes eight
 *   codes into a password manager from a phone screen -- so the share has to
 *   be offered AND has to carry every code. A share that drops one is worse
 *   than no share at all, because it looks like it worked.
 *
 *   OFFER MODE loses the SIGN-IN. By the time this screen renders the session
 *   already exists: the tokens are stored and the server considers the user
 *   signed in, and the only thing being withheld is the navigation. That makes
 *   every failure here a lockout of somebody who has already authenticated. A
 *   generate that returns nothing must not strand them on a code screen with
 *   an empty list and a Continue they cannot enable; a generate that throws
 *   must leave the offer usable; and "Skip for now" must sign them in
 *   regardless. This is a nudge, and a nudge that can wedge a completed
 *   sign-in is worse than the missing codes it is nagging about.
 *
 * The auth context, the generate endpoint, the snooze storage and the system
 * share sheet are stand-ins -- each has its own suite -- so this file can hand
 * the screen one exact situation and watch what it does with it. What is NOT
 * mocked is the mode decision: which half of the screen renders is behaviour
 * this screen owns, and getting it wrong is how an offer ends up painted over
 * a set of codes nobody has saved.
 */

interface SharedContent {
  title?: string;
  message: string;
}

type ShareFn = (content: SharedContent) => Promise<{ action: string }>;
type GenerateFn = () => Promise<Array<string>>;
type RememberSkipFn = (data: { userId: string }) => Promise<void>;
type ClearSkipFn = (data: { userId: string }) => Promise<void>;
type ShowCodesFn = (codes: Array<string>) => void;
type NavigateFn = (route: string, params?: unknown) => void;

const mockShare: MockedFunction<ShareFn> = jest.fn<ShareFn>();
const mockGenerateBackupCodes: MockedFunction<GenerateFn> =
  jest.fn<GenerateFn>();
const mockRememberBackupCodeOfferSkipped: MockedFunction<RememberSkipFn> =
  jest.fn<RememberSkipFn>();
const mockClearBackupCodeOfferSkip: MockedFunction<ClearSkipFn> =
  jest.fn<ClearSkipFn>();
const mockShowBackupCodes: MockedFunction<ShowCodesFn> = jest.fn<ShowCodesFn>();
const mockCompletePendingLogin: MockedFunction<() => void> =
  jest.fn<() => void>();
const mockNavigate: MockedFunction<NavigateFn> = jest.fn<NavigateFn>();

/*
 * The pending codes are modelled as a store the screen SUBSCRIBES to, not as
 * a variable the stand-in reassigns.
 *
 * That is not ceremony: in the app they are React state inside AuthProvider,
 * so `showBackupCodes` re-renders every consumer. A stand-in that only mutated
 * a variable would be read at the next render and no sooner -- and across a
 * successful generate this screen's own state goes `isGenerating` true then
 * false again, which React treats as "nothing changed" and bails out of. The
 * screen would then look broken here while working perfectly in the app,
 * which is the worst kind of test.
 */
let mockPendingBackupCodes: Array<string> | null = null;
let mockRouteMode: "show" | "offer" = "show";
let mockPendingLoginUserId: string = "";

const mockAuthListeners: Set<() => void> = new Set<() => void>();

function mockSubscribeToAuth(listener: () => void): () => void {
  mockAuthListeners.add(listener);

  return (): void => {
    mockAuthListeners.delete(listener);
  };
}

function mockReadPendingBackupCodes(): Array<string> | null {
  return mockPendingBackupCodes;
}

function mockSetPendingBackupCodes(codes: Array<string> | null): void {
  mockPendingBackupCodes = codes;

  for (const listener of mockAuthListeners) {
    listener();
  }
}

/*
 * The order the two exit steps actually ran in, recorded by the stand-ins
 * themselves. A call count cannot express "before", and "before" is the whole
 * point of the skip path: `completePendingLogin` unmounts this screen, so
 * anything sequenced after it runs in a tree being torn down.
 */
const exitSteps: Array<string> = [];

jest.mock("../../hooks/useAuth", () => {
  /*
   * `jest.requireActual` rather than a bare require: the factory runs while
   * the screen module is still being resolved, so this file's own React import
   * binding is not reliably initialised yet -- and a plain require() is
   * forbidden by the lint rules here.
   */
  const react: typeof import("react") =
    jest.requireActual<typeof import("react")>("react");

  return {
    useAuth: () => {
      return {
        pendingBackupCodes: react.useSyncExternalStore(
          mockSubscribeToAuth,
          mockReadPendingBackupCodes,
        ),
        showBackupCodes: mockShowBackupCodes,
        completePendingLogin: mockCompletePendingLogin,
        /*
         * `user` is deliberately still null while a login is being HELD, so
         * the held id is the only thing the per-account snooze can be keyed
         * on.
         */
        pendingLoginUserId: mockPendingLoginUserId,
      };
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useRoute: () => {
      return { params: { mode: mockRouteMode } };
    },
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});

jest.mock("../../api/auth", () => {
  return {
    generateBackupCodes: (): Promise<Array<string>> => {
      return mockGenerateBackupCodes();
    },
  };
});

jest.mock("../../storage/backupCodeOffer", () => {
  return {
    rememberBackupCodeOfferSkipped: (data: {
      userId: string;
    }): Promise<void> => {
      return mockRememberBackupCodeOfferSkipped(data);
    },
    clearBackupCodeOfferSkip: (data: { userId: string }): Promise<void> => {
      return mockClearBackupCodeOfferSkip(data);
    },
  };
});

/*
 * The system share sheet, mocked at the module React Native's `Share` export
 * is a getter over.
 *
 * It is deliberately not a clipboard copy: a clipboard survives the app, is
 * readable by whatever the user pastes into next, and on older Android is
 * readable by every app on the device -- which is the one place on a handset a
 * recovery code must not sit. A refactor to `Clipboard.setString` would look
 * identical to the user and would fail here, which is the point of mocking
 * this one rather than asserting on a button label.
 */
jest.mock("react-native/Libraries/Share/Share", () => {
  return {
    __esModule: true,
    default: {
      share: (content: SharedContent): Promise<{ action: string }> => {
        return mockShare(content);
      },
    },
  };
});

const HELD_USER_ID: string = "6653f0a0a0a0a0a0a0a0a0a1";

/* Eight distinct codes, so a renderer that de-duplicates is caught. */
const MINTED_CODES: Array<string> = [
  "a1b2c3d4",
  "e5f6a7b8",
  "c9d0e1f2",
  "a3b4c5d6",
  "e7f8a9b0",
  "c1d2e3f4",
  "a5b6c7d8",
  "e9f0a1b2",
];

/* What the endpoint hands back when the user takes up the offer. */
const GENERATED_CODES: Array<string> = [
  "11aa22bb",
  "33cc44dd",
  "55ee66ff",
  "77aa88bb",
];

async function renderScreen(data: {
  mode: "show" | "offer";
  codes: Array<string> | null;
}): Promise<void> {
  mockRouteMode = data.mode;
  mockSetPendingBackupCodes(data.codes);

  await render(<BackupCodesScreen />);
}

/** The codes actually painted, in render order. */
function renderedCodes(): Array<string> {
  return screen
    .queryAllByTestId("backup-code-value")
    .map((node: ReturnType<typeof screen.getByTestId>): string => {
      return node.props.children as string;
    });
}

/*
 * Read off `accessibilityState`, which is where React Native's Pressable puts
 * its `disabled` prop. It is what a screen reader is told and what a press
 * honours, so it is the honest question to ask about a button.
 */
function isDisabled(testID: string): boolean {
  const button: { props: { accessibilityState?: { disabled?: boolean } } } =
    screen.getByTestId(testID) as unknown as {
      props: { accessibilityState?: { disabled?: boolean } };
    };

  return button.props.accessibilityState?.disabled === true;
}

/** What the share sheet was handed, or a failure if it never opened. */
function sharedMessage(): string {
  const firstCall: [SharedContent] | undefined = mockShare.mock.calls[0];

  if (!firstCall) {
    throw new Error("The share sheet was never opened.");
  }

  return firstCall[0].message;
}

beforeEach(() => {
  exitSteps.length = 0;
  mockAuthListeners.clear();
  mockPendingBackupCodes = null;
  mockRouteMode = "show";
  mockPendingLoginUserId = HELD_USER_ID;

  mockShare.mockResolvedValue({ action: "sharedAction" });
  mockGenerateBackupCodes.mockResolvedValue(GENERATED_CODES);
  mockClearBackupCodeOfferSkip.mockResolvedValue(undefined);

  mockRememberBackupCodeOfferSkipped.mockImplementation(
    async (): Promise<void> => {
      exitSteps.push("remembered-skip");
    },
  );

  /*
   * Stands in for the provider: a set handed to `showBackupCodes` becomes the
   * context's pending set and every consumer re-renders. That is what lets
   * this file assert the screen switches ITSELF from the offer to the codes.
   */
  mockShowBackupCodes.mockImplementation((codes: Array<string>): void => {
    mockSetPendingBackupCodes(codes);
  });

  mockCompletePendingLogin.mockImplementation((): void => {
    exitSteps.push("completed-login");
  });
});

describe("A set of codes that exists only on this screen", () => {
  async function renderCodes(): Promise<void> {
    await renderScreen({ mode: "show", codes: MINTED_CODES });
  }

  test("every code the server minted is painted", async () => {
    /*
     * The exact set, not "some codes are on screen". A list that quietly drops
     * one -- a slice, a de-duplicating key, a paginated render -- hands the
     * user a recovery set the server does not agree with, and they cannot find
     * that out until the day they need it.
     */
    await renderCodes();

    expect(renderedCodes()).toEqual(MINTED_CODES);
  });

  test("and the user is told this is the only time they will see them", async () => {
    await renderCodes();

    expect(
      screen.getByText(/only time these codes will be shown/i),
    ).toBeTruthy();
  });

  test("Continue is disabled until the user says they have saved them", async () => {
    await renderCodes();

    expect(isDisabled("backup-codes-continue")).toBe(true);
  });

  test("and pressing it early does not sign anybody in", async () => {
    /*
     * The failure this whole screen exists to prevent. `completePendingLogin`
     * swaps the navigator, and the codes are in memory only -- so a Continue
     * that fires before the acknowledgement does not show a warning, it
     * destroys them.
     */
    await renderCodes();

    await fireEvent.press(screen.getByTestId("backup-codes-continue"));

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
    expect(renderedCodes()).toEqual(MINTED_CODES);
  });

  test("ticking the acknowledgement enables it", async () => {
    await renderCodes();

    await fireEvent.press(screen.getByTestId("backup-codes-saved-checkbox"));

    expect(isDisabled("backup-codes-continue")).toBe(false);
  });

  test("and then Continue finishes the held login exactly once", async () => {
    /*
     * Exactly once: completing publishes a held user and swaps the navigator,
     * and a second fire is a second swap mid-transition.
     */
    await renderCodes();

    await fireEvent.press(screen.getByTestId("backup-codes-saved-checkbox"));
    await fireEvent.press(screen.getByTestId("backup-codes-continue"));

    expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
  });

  test("the codes can be got off the handset", async () => {
    /*
     * Without an export there is nothing for the checkbox to be honest about.
     * The alternative -- retyping eight codes from a phone screen -- is not
     * something people actually do, so they tick the box and move on.
     */
    await renderCodes();

    await fireEvent.press(screen.getByText("Save or Share Codes"));

    await waitFor((): void => {
      expect(mockShare).toHaveBeenCalledTimes(1);
    });
  });

  test("and what is shared carries every single code", async () => {
    /*
     * A share missing one code is worse than no share: it looks like it
     * worked, so the user acknowledges a set that is short by one.
     */
    await renderCodes();

    await fireEvent.press(screen.getByText("Save or Share Codes"));

    await waitFor((): void => {
      expect(mockShare).toHaveBeenCalled();
    });

    const message: string = sharedMessage();

    for (const code of MINTED_CODES) {
      expect(message).toContain(code);
    }
  });

  test("a share the user backs out of leaves the codes on screen", async () => {
    /*
     * A rejected share is a dismissed sheet or an OS refusal, not a reason to
     * lose anything. If the failure took the list down with it, the user would
     * be left holding an account whose recovery codes nobody has ever read.
     */
    mockShare.mockRejectedValue(new Error("User did not share"));

    await renderCodes();

    await fireEvent.press(screen.getByText("Save or Share Codes"));

    await waitFor((): void => {
      expect(mockShare).toHaveBeenCalled();
    });

    expect(renderedCodes()).toEqual(MINTED_CODES);
  });

  test("and signs nobody in on its own", async () => {
    mockShare.mockRejectedValue(new Error("User did not share"));

    await renderCodes();

    await fireEvent.press(screen.getByText("Save or Share Codes"));

    await waitFor((): void => {
      expect(mockShare).toHaveBeenCalled();
    });

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("but still lets the user out once they acknowledge", async () => {
    /* A failed share must not become a second lock on the only way forward. */
    mockShare.mockRejectedValue(new Error("User did not share"));

    await renderCodes();

    await fireEvent.press(screen.getByText("Save or Share Codes"));

    await waitFor((): void => {
      expect(mockShare).toHaveBeenCalled();
    });

    await fireEvent.press(screen.getByTestId("backup-codes-saved-checkbox"));
    await fireEvent.press(screen.getByTestId("backup-codes-continue"));

    expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
  });
});

describe("An account that signed in with no recovery codes at all", () => {
  async function renderOffer(): Promise<void> {
    await renderScreen({ mode: "offer", codes: null });
  }

  test("is told what it is risking", async () => {
    /*
     * This user is everybody who set two factor auth up before codes existed,
     * and everybody an admin has just reset. Nothing else in the app tells
     * them that one lost handset is now a support ticket.
     */
    await renderOffer();

    expect(
      screen.getByText(/an administrator will have to reset two factor/i),
    ).toBeTruthy();
  });

  test("and offered the fix, with no codes invented to show", async () => {
    /*
     * An empty list under the show-mode heading would read as "here are your
     * codes" with nothing in it -- and the Continue underneath is disabled, so
     * it would be a dead end as well as a lie.
     */
    await renderOffer();

    expect(screen.getByTestId("generate-backup-codes")).toBeTruthy();
    expect(screen.queryByTestId("backup-codes-list")).toBeNull();
    expect(renderedCodes()).toEqual([]);
  });

  test("generating asks the server once", async () => {
    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await waitFor((): void => {
      expect(mockGenerateBackupCodes).toHaveBeenCalledTimes(1);
    });
  });

  test("and hands the plaintext straight to the context", async () => {
    /*
     * That response is the only copy that will ever exist. A caller that reads
     * the count and drops the strings leaves the account holding codes nobody
     * has seen, which reads everywhere else as "you are covered".
     */
    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await waitFor((): void => {
      expect(mockShowBackupCodes).toHaveBeenCalledWith(GENERATED_CODES);
    });
  });

  test("the same screen turns into the code screen", async () => {
    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await screen.findByTestId("backup-codes-list");

    expect(renderedCodes()).toEqual(GENERATED_CODES);
    expect(screen.queryByTestId("generate-backup-codes")).toBeNull();
  });

  test("without navigating a second time", async () => {
    /*
     * The switch is a re-render, not a push. A `navigate("BackupCodes", {
     * mode: "show" })` here would leave the offer sitting underneath a set of
     * codes nobody has saved -- and the back gesture is disabled on this route
     * precisely because arriving back on the offer would mean they are gone.
     */
    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await screen.findByTestId("backup-codes-list");

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("and the stale 'stop asking' stamp for this account is cleared", async () => {
    /*
     * Keyed on the HELD user id, because `user` is still null while the login
     * is withheld. A snooze left behind silences a prompt this account may
     * legitimately need again after a later reset; a snooze written under ""
     * would be one engineer silencing a shared handset for the next person who
     * signs in on it.
     */
    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await waitFor((): void => {
      expect(mockClearBackupCodeOfferSkip).toHaveBeenCalledWith({
        userId: HELD_USER_ID,
      });
    });
  });

  test("a server that returns no codes is reported, not rendered", async () => {
    /*
     * The trap this replaces: an empty array satisfies "the request
     * succeeded", switches the screen to show mode with nothing in the list,
     * and parks the user on a Continue they can only enable by acknowledging
     * codes that are not there.
     */
    mockGenerateBackupCodes.mockResolvedValue([]);

    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    expect(
      await screen.findByText(/No backup codes were returned/),
    ).toBeTruthy();
    expect(mockShowBackupCodes).not.toHaveBeenCalled();
  });

  test("and leaves the user on the offer rather than an empty code screen", async () => {
    mockGenerateBackupCodes.mockResolvedValue([]);

    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await screen.findByText(/No backup codes were returned/);

    expect(screen.queryByTestId("backup-codes-continue")).toBeNull();
    expect(screen.getByTestId("generate-backup-codes")).toBeTruthy();
  });

  test("a generate that fails says why", async () => {
    mockGenerateBackupCodes.mockRejectedValue(
      new Error("Could not reach the server."),
    );

    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    expect(await screen.findByText("Could not reach the server.")).toBeTruthy();
  });

  test("and leaves the offer usable, so a retry can succeed", async () => {
    /*
     * A button stuck in its loading state after a throw is a lockout of a user
     * who has already authenticated: the session exists, and the only thing
     * between them and the app is this screen.
     */
    mockGenerateBackupCodes.mockRejectedValueOnce(
      new Error("Could not reach the server."),
    );

    await renderOffer();

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await screen.findByText("Could not reach the server.");

    expect(isDisabled("generate-backup-codes")).toBe(false);

    await fireEvent.press(screen.getByTestId("generate-backup-codes"));

    await screen.findByTestId("backup-codes-list");

    expect(renderedCodes()).toEqual(GENERATED_CODES);
  });

  test("skipping records the snooze BEFORE the login is completed", async () => {
    /*
     * Order, not merely presence. `completePendingLogin` swaps the navigator
     * and unmounts this screen, so a write sequenced after it runs in a tree
     * being torn down -- and the user is asked again on their very next
     * sign-in, which is the nag the skip was meant to stop.
     */
    await renderOffer();

    await fireEvent.press(screen.getByTestId("skip-backup-codes"));

    await waitFor((): void => {
      expect(mockCompletePendingLogin).toHaveBeenCalled();
    });

    expect(exitSteps).toEqual(["remembered-skip", "completed-login"]);
  });

  test("against the id of the user being held, not a device-wide key", async () => {
    /*
     * A shared on-call handset is normal. One engineer skipping must not
     * silence the prompt for the next person who signs in on that phone --
     * their account has its own recovery posture.
     */
    await renderOffer();

    await fireEvent.press(screen.getByTestId("skip-backup-codes"));

    await waitFor((): void => {
      expect(mockRememberBackupCodeOfferSkipped).toHaveBeenCalledWith({
        userId: HELD_USER_ID,
      });
    });
  });

  test("and skipping does sign the user in", async () => {
    /*
     * The session already exists by the time this screen renders. A nudge that
     * can strand a completed sign-in behind itself is worse than the missing
     * recovery codes it is nagging about.
     */
    await renderOffer();

    await fireEvent.press(screen.getByTestId("skip-backup-codes"));

    await waitFor((): void => {
      expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
    });
  });
});

describe("The route param is a hint; the codes decide", () => {
  test("codes on the context beat a mode of 'offer'", async () => {
    /*
     * This is the state the screen is in the instant Generate returns: the
     * param still says "offer" and a set of unsaved codes is in memory.
     * Believing the param there paints the offer over them, and the next tap
     * loses them.
     */
    await renderScreen({ mode: "offer", codes: MINTED_CODES });

    expect(renderedCodes()).toEqual(MINTED_CODES);
    expect(screen.queryByTestId("generate-backup-codes")).toBeNull();
    expect(screen.queryByTestId("skip-backup-codes")).toBeNull();
  });

  test("and the acknowledgement still guards the way out", async () => {
    await renderScreen({ mode: "offer", codes: MINTED_CODES });

    expect(isDisabled("backup-codes-continue")).toBe(true);
  });
});
