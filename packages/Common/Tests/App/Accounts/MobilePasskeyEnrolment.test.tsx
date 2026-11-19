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
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import API from "../../../UI/Utils/API/API";
import LoginUtil from "../../../UI/Utils/Login";
import WebAuthnTestUtil, {
  registrationOptions,
} from "../../Utils/WebAuthnTestUtil";
import MobilePasskeyEnrolment, {
  MobilePasskeyEnrolmentRequest,
} from "../../../../App/FeatureSet/Accounts/src/Utils/MobilePasskeyEnrolment";
import MobilePasskeyEnrolmentPage from "../../../../App/FeatureSet/Accounts/src/Pages/MobilePasskeyEnrolment";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import { ACCOUNTS_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE PAGE THE MOBILE APP OPENS TO SET UP A PASSKEY (#9817).
 *
 * When sign-in in the mobile app requires a second step and the person
 * picks a passkey, the app opens /accounts/mobile-passkey-enrolment in the
 * phone's own browser, with a one-time hand-off id and its own `state` in
 * the address's fragment. The page reads the passkey's options once with
 * the id, runs the phone's prompt, and hands the new passkey's public
 * answer back on oneuptime://passkey-enrolment. No password reaches it,
 * nothing it does signs anybody in, and it never runs a prompt for a
 * request that is not well formed. Where the browser cannot make a passkey
 * it hands the app "unsupported" at once, and the app goes on with an
 * authenticator app.
 */

const HAND_OFF_ID: string = "H".repeat(43);
const STATE: string = "a".repeat(64);
const ORIGIN: string = "https://dev.oneuptime.com";
const FRAGMENT: string = `handOff=${HAND_OFF_ID}&state=${STATE}`;
const REQUEST: MobilePasskeyEnrolmentRequest = {
  handOffId: HAND_OFF_ID,
  state: STATE,
};
const originalLocation: Location = window.location;

// The credential WebAuthn.register makes of WebAuthnTestUtil's registration.
const MADE_CREDENTIAL: JSONObject = {
  id: "-_8A",
  rawId: "-_8A",
  type: "public-key",
  authenticatorAttachment: "platform",
  clientExtensionResults: { credProps: { rk: true } },
  response: {
    attestationObject: "BAUG",
    clientDataJSON: "AQID",
    transports: ["internal", "hybrid"],
  },
};

const configureLocation: (fragment?: string, server?: string) => void = (
  fragment: string = FRAGMENT,
  server: string = ORIGIN,
): void => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new globalThis.URL(
      `${server}/accounts/mobile-passkey-enrolment#${fragment}`,
    ),
  });
};

function decodeCredential(callback: string): JSONObject {
  const encoded: string = new URL(callback).searchParams.get("credential")!;
  return JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as JSONObject;
}

let optionsAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;

beforeEach(() => {
  optionsAnswer = new HTTPResponse<JSONObject>(
    200,
    { options: registrationOptions },
    {},
  );
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18n.changeLanguage("en");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("the request in the page's fragment", () => {
  test("is the hand-off and the app's state, exactly", () => {
    expect(MobilePasskeyEnrolment.getRequest(`#${FRAGMENT}`)).toEqual(REQUEST);
    expect(MobilePasskeyEnrolment.getRequest(FRAGMENT)).toEqual(REQUEST);
  });

  test.each([
    "",
    `handOff=${HAND_OFF_ID}`,
    `state=${STATE}`,
    `${FRAGMENT}&state=${STATE}`,
    `${FRAGMENT}&handOff=${HAND_OFF_ID}`,
    `${FRAGMENT}&password=secret`,
    FRAGMENT.replace(HAND_OFF_ID, "short"),
    FRAGMENT.replace(HAND_OFF_ID, "H".repeat(44)),
    FRAGMENT.replace(STATE, "s".repeat(42)),
    FRAGMENT.replace(STATE, "s".repeat(129)),
    FRAGMENT.replace(STATE, `${STATE}%0A`),
  ])("refuses an ambiguous or malformed request: %s", (fragment: string) => {
    expect(MobilePasskeyEnrolment.getRequest(fragment)).toBeNull();
  });
});

describe("what the page hands back", () => {
  test("a passkey: this app's scheme and host, the state, the server, and the answer in base64url JSON", () => {
    const callback: URL = new URL(
      MobilePasskeyEnrolment.successCallback(REQUEST, ORIGIN, MADE_CREDENTIAL),
    );

    expect(callback.protocol).toBe("oneuptime:");
    expect(callback.host).toBe("passkey-enrolment");
    expect(Array.from(callback.searchParams.keys()).sort()).toEqual(
      ["credential", "serverOrigin", "state"].sort(),
    );
    expect(callback.searchParams.get("state")).toBe(STATE);
    expect(callback.searchParams.get("serverOrigin")).toBe(ORIGIN);
    expect(callback.searchParams.get("credential")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCredential(callback.toString())).toEqual(MADE_CREDENTIAL);
  });

  test.each(["access_denied", "unsupported"] as const)(
    "no passkey (%s): the reason, the state and the server, nothing else",
    (end: "access_denied" | "unsupported") => {
      const callback: URL = new URL(
        MobilePasskeyEnrolment.endCallback(REQUEST, ORIGIN, end),
      );

      expect(callback.host).toBe("passkey-enrolment");
      expect(Object.fromEntries(callback.searchParams)).toEqual({
        error: end,
        state: STATE,
        serverOrigin: ORIGIN,
      });
    },
  );
});

describe("the page", () => {
  let returnToApp: jest.SpiedFunction<
    typeof MobilePasskeyEnrolment.returnToApp
  >;
  let forgetFragment: jest.SpiedFunction<
    typeof MobilePasskeyEnrolment.forgetFragment
  >;

  beforeEach(() => {
    configureLocation();
    WebAuthnTestUtil.install();
    returnToApp = jest
      .spyOn(MobilePasskeyEnrolment, "returnToApp")
      .mockImplementation(() => {});
    forgetFragment = jest
      .spyOn(MobilePasskeyEnrolment, "forgetFragment")
      .mockImplementation(() => {});
    jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
    jest.spyOn(API, "post").mockImplementation(async () => {
      return optionsAnswer;
    });
  });

  test("says what it will do and for which server, and asks for nothing until the person taps", () => {
    const { container } = render(<MobilePasskeyEnrolmentPage />);

    expect(
      screen.getByRole("heading", { name: "Set Up a Passkey" }),
    ).toBeVisible();
    expect(screen.getByText("dev.oneuptime.com")).toBeVisible();
    expect(
      screen.getByTestId("mobile-passkey-enrolment-create"),
    ).toHaveTextContent("Create Passkey");
    expect(screen.getByTestId("mobile-passkey-enrolment-cancel")).toBeVisible();
    // No password here, ever: the app keeps it.
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
    expect(returnToApp).not.toHaveBeenCalled();
  });

  test("reads the options with the hand-off, makes the passkey, and hands its answer back to the app", async () => {
    const create: jest.SpiedFunction<typeof navigator.credentials.create> =
      jest.spyOn(navigator.credentials, "create");

    render(<MobilePasskeyEnrolmentPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-enrolment-create"));

    await waitFor(() => {
      return expect(returnToApp).toHaveBeenCalledTimes(1);
    });

    expect(jest.mocked(API.post).mock.calls[0]![0].data).toEqual({
      handOffId: HAND_OFF_ID,
    });
    expect(String(jest.mocked(API.post).mock.calls[0]![0].url)).toContain(
      "/mobile-passkey-enrolment-options",
    );
    expect(create).toHaveBeenCalledTimes(1);

    const callback: string = returnToApp.mock.calls[0]![0];

    expect(callback.startsWith("oneuptime://passkey-enrolment?")).toBe(true);
    expect(new URL(callback).searchParams.get("state")).toBe(STATE);
    expect(new URL(callback).searchParams.get("serverOrigin")).toBe(ORIGIN);
    expect(decodeCredential(callback)).toEqual(MADE_CREDENTIAL);

    // Its link, for a browser that would not leave without a tap.
    expect(screen.getByRole("link", { name: "Return to app" })).toHaveAttribute(
      "href",
      callback,
    );
    // The id worked once: the address no longer needs it.
    expect(forgetFragment).toHaveBeenCalledTimes(1);
    // Nothing here signs anybody in.
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(API.post).toHaveBeenCalledTimes(1);
  });

  test("a prompt canceled or timed out says so, and trying again reuses the options read once", async () => {
    jest
      .spyOn(navigator.credentials, "create")
      .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));

    render(<MobilePasskeyEnrolmentPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-enrolment-create"));

    expect(
      await screen.findByText(
        "The passkey was not created: the prompt was canceled or timed out. Try again when you’re ready.",
      ),
    ).toBeVisible();
    await waitFor(() => {
      return expect(
        screen.getByTestId("mobile-passkey-enrolment-create"),
      ).toHaveTextContent("Try Again");
    });
    expect(returnToApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("mobile-passkey-enrolment-create"));

    await waitFor(() => {
      return expect(returnToApp).toHaveBeenCalledTimes(1);
    });
    expect(API.post).toHaveBeenCalledTimes(1);
  });

  test("a key already registered says so, as the sign-in page does", async () => {
    jest
      .spyOn(navigator.credentials, "create")
      .mockRejectedValueOnce(
        new DOMException("Already registered", "InvalidStateError"),
      );

    render(<MobilePasskeyEnrolmentPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-enrolment-create"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This key is already registered. Use a different key, or set up an authenticator app instead.",
    );
    expect(returnToApp).not.toHaveBeenCalled();
  });

  test("a hand-off that expired or was already used says to start again in the app, and runs no prompt", async () => {
    const create: jest.SpiedFunction<typeof navigator.credentials.create> =
      jest.spyOn(navigator.credentials, "create");
    optionsAnswer = new HTTPErrorResponse(
      400,
      {
        message:
          "This passkey setup has expired or was already used. Return to the app and start again.",
      },
      {},
    );

    render(<MobilePasskeyEnrolmentPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-enrolment-create"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This setup has expired or was already used. Return to the app and start again.",
    );
    expect(create).not.toHaveBeenCalled();
    expect(returnToApp).not.toHaveBeenCalled();
  });

  test("Cancel hands the app a cancel, with nothing made", async () => {
    render(<MobilePasskeyEnrolmentPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-enrolment-cancel"));

    expect(returnToApp).toHaveBeenCalledWith(
      MobilePasskeyEnrolment.endCallback(REQUEST, ORIGIN, "access_denied"),
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test("a malformed request runs nothing and hands nothing back: start again from the app", () => {
    configureLocation(`${FRAGMENT}&state=${STATE}`);

    render(<MobilePasskeyEnrolmentPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Start setting up a passkey from the OneUptime mobile app. This request is missing or invalid.",
    );
    expect(
      screen.queryByTestId("mobile-passkey-enrolment-create"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mobile-passkey-enrolment-cancel"),
    ).not.toBeInTheDocument();
    expect(API.post).not.toHaveBeenCalled();
    expect(returnToApp).not.toHaveBeenCalled();
  });

  test("on a page not on HTTPS, hands the app 'unsupported' at once: the authenticator app is the way", () => {
    configureLocation(FRAGMENT, "http://localhost");

    render(<MobilePasskeyEnrolmentPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Passkeys require HTTPS. Return to the app to set up an authenticator app instead.",
    );
    expect(returnToApp).toHaveBeenCalledWith(
      MobilePasskeyEnrolment.endCallback(
        REQUEST,
        "http://localhost",
        "unsupported",
      ),
    );
    expect(
      screen.queryByTestId("mobile-passkey-enrolment-create"),
    ).not.toBeInTheDocument();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("in a browser with no passkeys, hands the app 'unsupported' at once, and offers the way back by a tap too", () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: undefined,
    });

    render(<MobilePasskeyEnrolmentPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This browser can’t create a passkey. Return to the app to set up an authenticator app instead.",
    );
    expect(returnToApp).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("mobile-passkey-enrolment-unsupported"));

    expect(returnToApp).toHaveBeenCalledTimes(2);
    expect(returnToApp.mock.calls[1]![0]).toBe(
      MobilePasskeyEnrolment.endCallback(REQUEST, ORIGIN, "unsupported"),
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test.each([...ACCOUNTS_LANGUAGES])(
    "%s words the page, its button and its cancel",
    async (language: string) => {
      await i18n.changeLanguage(language);

      render(<MobilePasskeyEnrolmentPage />);

      expect(screen.getByRole("heading")).not.toHaveTextContent(
        "Set Up a Passkey",
      );
      expect(
        screen.getByTestId("mobile-passkey-enrolment-create"),
      ).not.toHaveTextContent("Create Passkey");
      expect(
        screen.getByTestId("mobile-passkey-enrolment-cancel"),
      ).not.toHaveTextContent("Cancel and return to app");
    },
  );
});
