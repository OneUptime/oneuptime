import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { isFirstRunOfThisInstall, resetFirstRunDecision } from "./firstRun";
import {
  GET_READY_SEEN_KEY,
  GET_READY_TEST_PAGE_KEY_PREFIX,
  hasAcknowledgedTestPageFromApp,
  hasSeenGetReady,
  markGetReadySeen,
  rememberTestPageAcknowledged,
} from "../storage/getReady";
import { PUSH_TOKEN_KEY } from "../hooks/pushTokenUtils";

/*
 * WHETHER THIS LAUNCH IS A NEW INSTALL'S FIRST (#7041), and what the phone
 * keeps of its first steps: the one launch the app opens them by itself,
 * never on an update for somebody already set up, and never twice.
 */

const store: Map<string, string> = (
  AsyncStorage as unknown as { __store: Map<string, string> }
).__store;

const setPlatform: (os: string) => void = (os: string): void => {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
};

const originalOs: string = Platform.OS;

beforeEach(() => {
  store.clear();
  resetFirstRunDecision();
});

afterEach(() => {
  setPlatform(originalOs);
  jest.restoreAllMocks();
});

describe("a new install's first launch", () => {
  test("nothing kept: it is the first, and the first steps are not yet marked opened", async () => {
    await expect(isFirstRunOfThisInstall()).resolves.toBe(true);
    await expect(hasSeenGetReady()).resolves.toBe(false);
  });

  test("is decided once: a push token kept after the decision changes nothing", async () => {
    await expect(isFirstRunOfThisInstall()).resolves.toBe(true);

    store.set(PUSH_TOKEN_KEY, "ExponentPushToken[later]");

    await expect(isFirstRunOfThisInstall()).resolves.toBe(true);
  });
});

describe("not a first launch", () => {
  test("the first steps opened already", async () => {
    await markGetReadySeen();

    await expect(isFirstRunOfThisInstall()).resolves.toBe(false);
  });

  test("a phone already registered for pages, by a version from before: never, and never after", async () => {
    store.set(PUSH_TOKEN_KEY, "ExponentPushToken[before]");

    await expect(isFirstRunOfThisInstall()).resolves.toBe(false);
    await expect(hasSeenGetReady()).resolves.toBe(true);

    // Signed out since: the token is gone, the mark is not.
    store.delete(PUSH_TOKEN_KEY);
    resetFirstRunDecision();

    await expect(isFirstRunOfThisInstall()).resolves.toBe(false);
  });

  test("the browser preview: it has no notifications to allow", async () => {
    setPlatform("web");

    await expect(isFirstRunOfThisInstall()).resolves.toBe(false);
  });

  test("storage that cannot be read: nothing opens by surprise", async () => {
    const unavailable: Error = new Error("storage unavailable");

    // The shared mock (src/__tests__/setup.ts): each read fails once.
    (AsyncStorage.getItem as unknown as jest.Mock)
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable);

    await expect(isFirstRunOfThisInstall()).resolves.toBe(false);
  });
});

describe("what the phone keeps", () => {
  test("the first steps opened, as a mark of its own", async () => {
    await expect(hasSeenGetReady()).resolves.toBe(false);

    await markGetReadySeen();

    expect(store.get(GET_READY_SEEN_KEY)).toBe("true");
    await expect(hasSeenGetReady()).resolves.toBe(true);
  });

  test("a test page acknowledged, per person and project", async () => {
    await expect(
      hasAcknowledgedTestPageFromApp("project-1", "user-1"),
    ).resolves.toBe(false);

    await rememberTestPageAcknowledged("project-1", "user-1");

    expect(store.get(`${GET_READY_TEST_PAGE_KEY_PREFIX}project-1:user-1`)).toBe(
      "true",
    );
    await expect(
      hasAcknowledgedTestPageFromApp("project-1", "user-1"),
    ).resolves.toBe(true);
    // Another project, or another person on this phone, has not.
    await expect(
      hasAcknowledgedTestPageFromApp("project-2", "user-1"),
    ).resolves.toBe(false);
    await expect(
      hasAcknowledgedTestPageFromApp("project-1", "user-2"),
    ).resolves.toBe(false);
  });

  test("storage that fails reads as nothing kept, and never throws", async () => {
    const unavailable: Error = new Error("storage unavailable");
    const full: Error = new Error("storage full");

    (AsyncStorage.getItem as unknown as jest.Mock)
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable);
    (AsyncStorage.setItem as unknown as jest.Mock)
      .mockRejectedValueOnce(full)
      .mockRejectedValueOnce(full);

    await expect(hasSeenGetReady()).resolves.toBe(false);
    await expect(markGetReadySeen()).resolves.toBeUndefined();
    await expect(
      hasAcknowledgedTestPageFromApp("project-1", "user-1"),
    ).resolves.toBe(false);
    await expect(
      rememberTestPageAcknowledged("project-1", "user-1"),
    ).resolves.toBeUndefined();
  });
});
