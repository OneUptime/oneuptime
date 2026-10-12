import { afterEach, describe, expect, test } from "@jest/globals";
import VSphereSessionCache, {
  MAX_CACHED_SESSIONS,
  SESSION_IDLE_TIMEOUT_IN_MS,
  getSessionKey,
} from "../../../Utils/VMware/VSphereSessionCache";

/*
 * The vCenter sessions a probe keeps between collections: one per vCenter
 * and set of credentials, in memory, forgotten when idle as long as
 * vCenter's own timeout - and never one opened with other credentials.
 */

const BASE: {
  vmwareVCenterId: string;
  vcenterUrl: string;
  username: string;
  password: string;
  trustedFingerprint: string | null;
} = {
  vmwareVCenterId: "vcenter-1",
  vcenterUrl: "https://vcsa.example.com",
  username: "oneuptime@vsphere.local",
  password: "secret",
  trustedFingerprint: null,
};

afterEach(() => {
  VSphereSessionCache.clear();
});

describe("getSessionKey", () => {
  test("the same vCenter and credentials give the same key", () => {
    expect(getSessionKey(BASE)).toBe(getSessionKey({ ...BASE }));
    expect(getSessionKey(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ["vmwareVCenterId", "vcenter-2"],
    ["vcenterUrl", "https://vcsa-2.example.com"],
    ["username", "other@vsphere.local"],
    ["password", "changed"],
    ["trustedFingerprint", "AB:CD"],
  ])(
    "a different %s never shares a session",
    (field: string, value: string) => {
      expect(getSessionKey({ ...BASE, [field]: value })).not.toBe(
        getSessionKey(BASE),
      );
    },
  );

  test("holds no credential in the clear", () => {
    expect(getSessionKey(BASE)).not.toContain("secret");
  });
});

describe("VSphereSessionCache", () => {
  test("keeps a session, and forgets it on request", () => {
    VSphereSessionCache.set("key", "cookie", 1_000);
    expect(VSphereSessionCache.get("key", 2_000)).toBe("cookie");

    VSphereSessionCache.forget("key");
    expect(VSphereSessionCache.get("key", 2_000)).toBeNull();
  });

  test("a session unused for longer than vCenter's idle timeout is gone", () => {
    VSphereSessionCache.set("key", "cookie", 0);

    expect(VSphereSessionCache.get("key", SESSION_IDLE_TIMEOUT_IN_MS)).toBe(
      "cookie",
    );
    expect(
      VSphereSessionCache.get("key", SESSION_IDLE_TIMEOUT_IN_MS + 1),
    ).toBeNull();
    expect(VSphereSessionCache.size()).toBe(0);
  });

  test("setting a session again restarts its idle time", () => {
    VSphereSessionCache.set("key", "cookie", 0);
    VSphereSessionCache.set("key", "cookie-2", SESSION_IDLE_TIMEOUT_IN_MS);

    expect(VSphereSessionCache.get("key", SESSION_IDLE_TIMEOUT_IN_MS * 2)).toBe(
      "cookie-2",
    );
  });

  test("holds at most a bounded number, dropping the least recently set first", () => {
    for (let index: number = 0; index <= MAX_CACHED_SESSIONS; index++) {
      VSphereSessionCache.set(`key-${index}`, `cookie-${index}`, 1_000);
    }

    expect(VSphereSessionCache.size()).toBe(MAX_CACHED_SESSIONS);
    expect(VSphereSessionCache.get("key-0", 1_000)).toBeNull();
    expect(VSphereSessionCache.get("key-1", 1_000)).toBe("cookie-1");
    expect(VSphereSessionCache.get(`key-${MAX_CACHED_SESSIONS}`, 1_000)).toBe(
      `cookie-${MAX_CACHED_SESSIONS}`,
    );
  });
});
