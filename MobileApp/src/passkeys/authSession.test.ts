import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  openPasskeyAuthSession,
  PasskeyAuthSessionOutcome,
} from "./authSession";
import { PasskeyRequest } from "./request";

jest.mock("expo-web-browser", () => {
  return {
    openAuthSessionAsync: jest.fn(),
    dismissAuthSession: jest.fn(),
    WebBrowserResultType: { DISMISS: "dismiss" },
  };
});
jest.mock("expo-linking", () => {
  return { addEventListener: jest.fn() };
});

const request: PasskeyRequest = {
  state: "a".repeat(64),
  codeVerifier: "b".repeat(64),
  serverOrigin: "https://oneuptime.example.com",
  url: "https://oneuptime.example.com/accounts/mobile-passkey?state=attempt",
};
const callback: string = `oneuptime://passkey?code=${"c".repeat(43)}&state=${request.state}&serverOrigin=${encodeURIComponent(request.serverOrigin)}`;
let onLink: ((event: { url: string }) => void) | undefined;
const remove: jest.Mock = jest.fn();
beforeEach(() => {
  jest
    .mocked(Linking.addEventListener)
    .mockImplementation(
      (
        _type: "url",
        handler: (event: { url: string }) => void,
      ): ReturnType<typeof Linking.addEventListener> => {
        onLink = handler;
        // The native subscription is represented only by its cleanup method here.
        return { remove } as unknown as ReturnType<typeof Linking.addEventListener>;
      },
    );
});

test("returns an iOS auth-session callback and removes its listener", async () => {
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValue({ type: "success", url: callback });
  await expect(
    openPasskeyAuthSession(request, new AbortController().signal, 5),
  ).resolves.toEqual({ status: "callback", url: callback });
  expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
    request.url,
    "oneuptime://passkey",
  );
  expect(remove).toHaveBeenCalledTimes(1);
});

test("captures a successful Android deep link that arrives before dismiss", async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
    onLink?.({ url: callback });
    return { type: WebBrowser.WebBrowserResultType.DISMISS };
  });
  await expect(
    openPasskeyAuthSession(request, new AbortController().signal, 5),
  ).resolves.toEqual({ status: "callback", url: callback });
});

test("waits for the Android foreground-before-link race", async () => {
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockResolvedValue({ type: WebBrowser.WebBrowserResultType.DISMISS });
  const pending: Promise<PasskeyAuthSessionOutcome> = openPasskeyAuthSession(
    request,
    new AbortController().signal,
    100,
  );
  await Promise.resolve();
  onLink?.({ url: callback });
  await expect(pending).resolves.toEqual({ status: "callback", url: callback });
});

test("ignores SSO and stale attempt callbacks during Android dismissal", async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
    onLink?.({ url: "oneuptime://sso-callback?accessToken=other" });
    onLink?.({ url: callback.replace(request.state, "d".repeat(64)) });
    return { type: WebBrowser.WebBrowserResultType.DISMISS };
  });
  await expect(
    openPasskeyAuthSession(request, new AbortController().signal, 1),
  ).resolves.toEqual({ status: "cancelled" });
});

test("cancel returns promptly even if the browser stays open and late success is ignored", async () => {
  let finish:
    | ((value: WebBrowser.WebBrowserAuthSessionResult) => void)
    | undefined;
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(() => {
    return new Promise(
      (
        resolve: (value: WebBrowser.WebBrowserAuthSessionResult) => void,
      ): void => {
        finish = resolve;
      },
    );
  });
  const controller: AbortController = new AbortController();
  const pending: Promise<PasskeyAuthSessionOutcome> = openPasskeyAuthSession(
    request,
    controller.signal,
    5,
  );
  controller.abort();
  await expect(pending).resolves.toEqual({ status: "cancelled" });
  finish?.({ type: "success", url: callback });
  await Promise.resolve();
  expect(WebBrowser.dismissAuthSession).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});

test("an already canceled attempt cannot open a browser", async () => {
  const controller: AbortController = new AbortController();
  controller.abort();
  await expect(
    openPasskeyAuthSession(request, controller.signal),
  ).resolves.toEqual({ status: "cancelled" });
  expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  expect(Linking.addEventListener).not.toHaveBeenCalled();
});

test("reports browser launch failure and cleans up", async () => {
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockRejectedValue(new Error("No browser"));
  await expect(
    openPasskeyAuthSession(request, new AbortController().signal),
  ).rejects.toThrow(/Could not open/);
  expect(remove).toHaveBeenCalledTimes(1);
});

test("rejects a forged native success rather than exchanging it", async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
    type: "success",
    url: callback.replace(request.state, "d".repeat(64)),
  });
  await expect(
    openPasskeyAuthSession(request, new AbortController().signal),
  ).rejects.toThrow(/Could not open/);
});

test("a captured valid callback survives the browser promise throwing", async () => {
  jest.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
    onLink?.({ url: callback });
    throw new Error("Browser already closed");
  });
  await expect(
    openPasskeyAuthSession(request, new AbortController().signal),
  ).resolves.toEqual({ status: "callback", url: callback });
});
