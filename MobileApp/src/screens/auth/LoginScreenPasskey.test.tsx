import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import LoginScreen from "./LoginScreen";
import { LoginResponse } from "../../api/auth";
import { PasskeySignInOptions } from "../../passkeys/signIn";

const mockLogin: jest.Mock = jest.fn();
const mockLoginWithPasskey: jest.Mock = jest.fn();
const mockNavigate: jest.Mock = jest.fn();
const mockSetNeedsServerUrl: jest.Mock = jest.fn();
let mockBlur: (() => void) | undefined;
let mockFocus: (() => void) | undefined;
const mockGetServerUrl: jest.Mock = jest.fn();
jest.mock("../../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return {
        login: mockLogin,
        loginWithPasskey: mockLoginWithPasskey,
        setNeedsServerUrl: mockSetNeedsServerUrl,
      };
    },
  };
});
jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return {
        navigate: mockNavigate,
        addListener: (type: string, listener: () => void) => {
          if (type === "blur") {
            mockBlur = listener;
          } else if (type === "focus") {
            mockFocus = listener;
          }
          return jest.fn();
        },
      };
    },
  };
});
jest.mock("../../storage/serverUrl", () => {
  return {
    getServerUrl: () => {
      return mockGetServerUrl();
    },
  };
});

const session: LoginResponse = {
  accessToken: "access",
  refreshToken: "refresh",
  refreshTokenExpiresAt: "2027-01-01",
  user: {
    _id: "user",
    email: "user@example.com",
    name: "Responder",
    isMasterAdmin: false,
  },
};
let finish: ((response: LoginResponse | null) => void) | undefined;
let options: PasskeySignInOptions | undefined;
beforeEach(() => {
  mockGetServerUrl.mockReset();
  mockGetServerUrl.mockResolvedValue("https://selfhosted.example.com");
  mockFocus = undefined;
  mockBlur = undefined;
  finish = undefined;
  options = undefined;
  mockLogin.mockResolvedValue(session);
  mockLoginWithPasskey.mockImplementation(
    (value: PasskeySignInOptions): Promise<LoginResponse | null> => {
      options = value;
      return new Promise(
        (resolve: (response: LoginResponse | null) => void): void => {
          finish = resolve;
        },
      );
    },
  );
});

async function show(): Promise<void> {
  await render(<LoginScreen />);
  await screen.findByText("https://selfhosted.example.com");
}

test("returning from Change Server shows the workspace sign-in will use", async () => {
  await show();
  mockGetServerUrl.mockResolvedValue("https://second-workspace.example");

  await act(() => {
    mockFocus?.();
  });

  expect(screen.getByText("https://second-workspace.example")).toBeTruthy();
  expect(screen.queryByText("https://selfhosted.example.com")).toBeNull();
});

test("a saved address read failure keeps sign-in usable and retries on focus", async () => {
  mockGetServerUrl.mockRejectedValueOnce(new Error("Storage unavailable"));
  await render(<LoginScreen />);
  expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();

  await act(() => {
    mockFocus?.();
  });

  expect(screen.getByText("https://selfhosted.example.com")).toBeTruthy();
});

test("keeps password sign-in first and offers passkeys as a credential-free alternative", async () => {
  await show();
  expect(screen.queryByText("Use a saved passkey")).toBeNull();
  const buttons: string[] = screen
    .getAllByRole("button")
    .map((button: ReturnType<typeof screen.getByRole>): string => {
      return button.props.accessibilityLabel as string;
    });
  expect(buttons.indexOf("Sign In")).toBeGreaterThanOrEqual(0);
  expect(buttons.indexOf("Sign In")).toBeLessThan(
    buttons.indexOf("Sign in with a passkey"),
  );
  expect(screen.getByText("Other ways to sign in")).toBeTruthy();
  const disclosure: () => ReturnType<typeof screen.getByRole> = () => {
    return screen.getByRole("button", { name: "New to passkeys?" });
  };
  expect(disclosure().props.accessibilityState.expanded).toBe(false);
  await fireEvent.press(screen.getByText("New to passkeys?"));
  expect(disclosure().props.accessibilityState.expanded).toBe(true);
  expect(screen.getByText(/In your profile, open Passkeys/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  expect(mockLoginWithPasskey).toHaveBeenCalledTimes(1);
  expect(mockLogin).not.toHaveBeenCalled();
  expect(screen.queryByText("Email and password are required.")).toBeNull();
});

test("announces preparation, browser prompt and verification without ambiguous spinners", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  expect(screen.getByText("Preparing a secure sign-in…")).toBeTruthy();
  await act(() => {
    options?.onProgress("browser");
  });
  expect(
    screen.getByText(
      "Choose your passkey in the browser, then return to OneUptime.",
    ),
  ).toBeTruthy();
  await act(() => {
    options?.onProgress("verifying");
  });
  expect(
    screen.getByText("Passkey confirmed. Completing your sign-in…"),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Cancel passkey sign-in")).toBeNull();
});

test("cancel restores usable password and retry controls without losing typed credentials", async () => {
  await show();
  await fireEvent.changeText(
    screen.getByPlaceholderText("you@example.com"),
    "responder@example.com",
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText("Your password"),
    "password",
  );
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  expect(screen.getByPlaceholderText("Your password").props.editable).toBe(
    false,
  );
  await fireEvent.press(screen.getByLabelText("Cancel passkey sign-in"));
  expect(options?.signal.aborted).toBe(true);
  expect(screen.getByText("Try passkey again")).toBeTruthy();
  expect(screen.getByText(/Passkey sign-in canceled/)).toBeTruthy();
  expect(screen.getByPlaceholderText("Your password").props.editable).toBe(
    true,
  );
  await fireEvent.press(screen.getByText("Sign In"));
  expect(mockLogin).toHaveBeenCalledWith("responder@example.com", "password");
});

test("a canceled attempt finishing late cannot change a newer attempt's progress", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  const oldFinish: typeof finish = finish;
  const oldOptions: typeof options = options;
  await fireEvent.press(screen.getByLabelText("Cancel passkey sign-in"));
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await act(() => {
    options?.onProgress("browser");
    oldOptions?.onProgress("verifying");
    oldFinish?.(session);
  });
  expect(
    screen.getByText(
      "Choose your passkey in the browser, then return to OneUptime.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByText("Passkey confirmed. Completing your sign-in…"),
  ).toBeNull();
  expect(mockLoginWithPasskey).toHaveBeenCalledTimes(2);
});

test("a browser cancellation is neutral and can be retried", async () => {
  mockLoginWithPasskey.mockResolvedValue(null);
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await screen.findByText(/Passkey sign-in canceled/);
  expect(screen.getByText("Try passkey again")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("shows a useful failure and keeps other sign-in routes available", async () => {
  mockLoginWithPasskey.mockRejectedValue(
    new Error("Sign-in expired. Please try again."),
  );
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await screen.findByText("Sign-in expired. Please try again.");
  await fireEvent.press(screen.getByText("Sign in with SSO"));
  expect(mockNavigate).toHaveBeenCalledWith("SSOLogin");
});

test("prevents duplicate browser attempts and competing password/SSO submissions", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await fireEvent.press(screen.getByText("Sign In"));
  await fireEvent.press(screen.getByText("Sign in with SSO"));
  expect(mockLoginWithPasskey).toHaveBeenCalledTimes(1);
  expect(mockLogin).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test("changing server cancels the in-flight browser attempt first", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await fireEvent.press(screen.getByText("Change Server"));
  expect(options?.signal.aborted).toBe(true);
  expect(mockSetNeedsServerUrl).toHaveBeenCalledWith(true);
  expect(mockNavigate).toHaveBeenCalledWith("ServerUrl");
});

test("blocks server switching while the verified code is being exchanged", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await act(() => {
    options?.onProgress("verifying");
  });
  await fireEvent.press(screen.getByText("Change Server"));
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(options?.signal.aborted).toBe(false);
});

test("leaving the login screen cancels its attempt and ignores later UI updates", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await act(() => {
    mockBlur?.();
  });
  expect(options?.signal.aborted).toBe(true);
  await act(() => {
    finish?.(session);
  });
  await waitFor(() => {
    expect(screen.getByPlaceholderText("Your password").props.editable).toBe(
      true,
    );
  });
});

test("unmounting also aborts browser work", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("passkey-sign-in"));
  await screen.unmount();
  expect(options?.signal.aborted).toBe(true);
});

test("password visibility is explicit, starts private, and preserves the entered password", async () => {
  await show();
  const password: ReturnType<typeof screen.getByLabelText> =
    screen.getByLabelText("Password");
  await fireEvent.changeText(password, "A private password");
  expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(false);
  expect(screen.getByLabelText("Password").props.autoCapitalize).toBe("none");
  expect(screen.getByLabelText("Password").props.autoCorrect).toBe(false);
  expect(screen.getByLabelText("Password").props.spellCheck).toBe(false);
  expect(screen.getByLabelText("Password").props.value).toBe(
    "A private password",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Hide password" }));
  expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);
});

test("the keyboard advances from email without submitting and signs in from password", async () => {
  await show();
  await fireEvent.changeText(
    screen.getByLabelText("Email"),
    "responder@example.com",
  );
  await fireEvent(screen.getByLabelText("Email"), "submitEditing");
  expect(mockLogin).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Email").props.submitBehavior).toBe("submit");
  await fireEvent.changeText(
    screen.getByLabelText("Password"),
    "secret password",
  );
  await fireEvent(screen.getByLabelText("Password"), "submitEditing");
  expect(mockLogin).toHaveBeenCalledWith(
    "responder@example.com",
    "secret password",
  );
});

test("a validation error is announced and clears when the email is corrected", async () => {
  await show();
  await fireEvent.press(screen.getByRole("button", { name: "Sign In" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText("Email"),
    "responder@example.com",
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

test("compact login fields can shrink beside icons and the full-size password visibility control", async () => {
  await show();
  expect(screen.queryByText("ONEUPTIME")).toBeNull();
  for (const label of ["Email", "Password"]) {
    const field: ReturnType<typeof screen.getByLabelText> =
      screen.getByLabelText(label);
    expect(field.props.style.minWidth).toBe(0);
    expect(field.props.style.fontSize).toBeGreaterThanOrEqual(16);
  }
  const reveal: ReturnType<typeof screen.getByRole> = screen.getByRole(
    "button",
    { name: "Show password" },
  );
  expect(reveal.props.style.minWidth).toBeGreaterThanOrEqual(48);
  expect(reveal.props.style.minHeight).toBeGreaterThanOrEqual(48);
});
