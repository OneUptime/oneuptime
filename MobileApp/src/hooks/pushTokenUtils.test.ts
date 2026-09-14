import AsyncStorage from "@react-native-async-storage/async-storage";
import { unregisterPushDevice } from "../api/pushDevice";
import { PUSH_TOKEN_KEY, unregisterPushToken } from "./pushTokenUtils";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * This runs during logout, and that is the whole design constraint.
 *
 * Logging out has to finish. If this throws - the device is offline, the server
 * is down, the token was never stored - the responder is left signed in with a
 * screen that says otherwise, and the next person to pick up the handset can
 * read every page in the account. So every path here has to settle, and the
 * only thing that varies is how much of the work got done.
 *
 * The other half is the token itself. Leaving the row registered server-side
 * means the pages keep arriving on a phone that is no longer signed in, so the
 * call to the server has to happen whenever there is anything to unregister.
 */

jest.mock("../api/pushDevice", () => {
  return {
    unregisterPushDevice: jest.fn(async () => {
      return undefined;
    }),
  };
});

const DEVICE_TOKEN: string = "ExponentPushToken[handset]";

function unregisterSpy(): jest.Mock {
  return unregisterPushDevice as unknown as jest.Mock;
}

function removeItemSpy(): jest.Mock {
  return AsyncStorage.removeItem as unknown as jest.Mock;
}

describe("unregisterPushToken with a token on the device", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
    unregisterSpy().mockResolvedValue(undefined as never);
  });

  test("tells the server to stop paging this handset", async () => {
    await unregisterPushToken();

    expect(unregisterSpy()).toHaveBeenCalledWith(DEVICE_TOKEN);
  });

  test("tells it exactly once, not once per registered project", async () => {
    /*
     * The token is the device identity; the server resolves it to every row it
     * holds. A second call would be a second round trip holding up a logout.
     */
    await unregisterPushToken();

    expect(unregisterSpy()).toHaveBeenCalledTimes(1);
  });

  test("clears the stored token so the next sign-in starts clean", async () => {
    await unregisterPushToken();

    expect(await AsyncStorage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  test("unregisters with the server before dropping the stored token", async () => {
    /*
     * Order matters. The stored token is the only copy of the device identity
     * the app holds, so discarding it first would leave nothing to unregister
     * WITH if the request then failed - the server would keep paging a handset
     * nobody could ever detach.
     */
    await unregisterPushToken();

    expect(unregisterSpy().mock.invocationCallOrder[0]).toBeLessThan(
      removeItemSpy().mock.invocationCallOrder[0],
    );
  });

  test("running twice is harmless, because the second pass finds nothing", async () => {
    /*
     * Logout can be pressed twice, and the auth flow calls this on more than
     * one path.
     */
    await unregisterPushToken();
    await unregisterPushToken();

    expect(unregisterSpy()).toHaveBeenCalledTimes(1);
  });
});

describe("unregisterPushToken with nothing to unregister", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    unregisterSpy().mockResolvedValue(undefined as never);
  });

  test("does not call the server when no token was ever stored", async () => {
    /*
     * A responder who never granted notification permission has no token. A
     * request carrying null would be a pointless round trip on a logout, and
     * the server would have to guess what it was being asked to detach.
     */
    await unregisterPushToken();

    expect(unregisterSpy()).not.toHaveBeenCalled();
  });

  test("does not touch storage when no token was ever stored", async () => {
    await unregisterPushToken();

    expect(removeItemSpy()).not.toHaveBeenCalled();
  });

  test("treats an empty stored token as nothing to unregister", async () => {
    /*
     * An interrupted registration can leave the key present but empty.
     * Unregistering the empty string would ask the server to detach a device
     * that does not exist.
     */
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, "");

    await unregisterPushToken();

    expect(unregisterSpy()).not.toHaveBeenCalled();
  });

  test("still resolves, so logout is never held up", async () => {
    await expect(unregisterPushToken()).resolves.toBeUndefined();
  });
});

describe("unregisterPushToken when something goes wrong", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
  });

  test("a failing server call does not reject", async () => {
    /*
     * The single most important behaviour in this file. Logout awaits this; a
     * rejection here aborts the sign-out and strands the responder inside an
     * account they asked to leave.
     */
    unregisterSpy().mockRejectedValue(
      new Error("Request failed with status code 500") as never,
    );

    await expect(unregisterPushToken()).resolves.toBeUndefined();
  });

  test("a network failure does not reject either", async () => {
    unregisterSpy().mockRejectedValue(new Error("Network Error") as never);

    await expect(unregisterPushToken()).resolves.toBeUndefined();
  });

  test("a failing storage read does not reject", async () => {
    /*
     * AsyncStorage is a native module; a corrupted store or a locked database
     * throws on read. Logout still has to complete.
     */
    (AsyncStorage.getItem as unknown as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable") as never,
    );

    await expect(unregisterPushToken()).resolves.toBeUndefined();
  });

  test("a failing storage write does not reject", async () => {
    unregisterSpy().mockResolvedValue(undefined as never);
    removeItemSpy().mockRejectedValueOnce(
      new Error("storage unavailable") as never,
    );

    await expect(unregisterPushToken()).resolves.toBeUndefined();
  });

  test("a failing storage read means the server is never asked either", async () => {
    (AsyncStorage.getItem as unknown as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable") as never,
    );

    await unregisterPushToken();

    expect(unregisterSpy()).not.toHaveBeenCalled();
  });
});

describe("PUSH_TOKEN_KEY", () => {
  test("keeps the storage key that installs in the wild already use", () => {
    /*
     * This is a persisted key, not an internal name. Every phone that has ever
     * registered has its token filed under this exact string, so changing it
     * orphans that value on upgrade: the app would stop finding the token it
     * has to unregister, and those handsets would keep receiving pages for an
     * account that had signed out.
     */
    expect(PUSH_TOKEN_KEY).toBe("oneuptime_expo_push_token");
  });
});
