import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TabMemory from "../../../../UI/Utils/NewVersion/TabMemory";

/*
 * What a tab remembers across its own reloads - above all, that it just
 * reloaded for a part of the app that would not download. A tab that forgets
 * that reloads again, and again: the loop this memory exists to stop. So it
 * must hold even where sessionStorage throws (site data blocked), and never
 * at the cost of a window name some other script gave the window.
 */

/*
 * Storage's string index signature makes @jest/globals type a spy on
 * Storage.prototype as never; spy through its three methods instead.
 */
interface StorageMethods {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const STORAGE_METHODS: StorageMethods =
  Storage.prototype as unknown as StorageMethods;

const blockStorage: () => void = (): void => {
  jest.spyOn(STORAGE_METHODS, "getItem").mockImplementation(() => {
    throw new Error("SecurityError: storage is blocked");
  });
  jest.spyOn(STORAGE_METHODS, "setItem").mockImplementation(() => {
    throw new Error("SecurityError: storage is blocked");
  });
  jest.spyOn(STORAGE_METHODS, "removeItem").mockImplementation(() => {
    throw new Error("SecurityError: storage is blocked");
  });
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.name = "";
});

afterEach(() => {
  jest.restoreAllMocks();
  window.sessionStorage.clear();
  window.name = "";
});

describe("TabMemory", () => {
  test("remembers in sessionStorage when it can", () => {
    TabMemory.set("key", "value");

    expect(TabMemory.get("key")).toBe("value");
    expect(window.sessionStorage.getItem("key")).toBe("value");
    expect(window.name).toBe("");
  });

  test("forgets what it is told to", () => {
    TabMemory.set("key", "value");
    TabMemory.remove("key");

    expect(TabMemory.get("key")).toBeNull();
  });

  test("an unknown key is null", () => {
    expect(TabMemory.get("never-set")).toBeNull();
  });

  describe("when sessionStorage throws", () => {
    test("remembers in window.name instead, which also outlives a reload", () => {
      blockStorage();

      TabMemory.set("oneuptime-chunk-load-reload-at", "1000");
      TabMemory.set("other", "2");

      expect(TabMemory.get("oneuptime-chunk-load-reload-at")).toBe("1000");
      expect(TabMemory.get("other")).toBe("2");
      expect(window.name.startsWith("oneuptime-tab-memory:")).toBe(true);
    });

    test("forgets from window.name, and leaves it empty once nothing is left", () => {
      blockStorage();

      TabMemory.set("key", "value");
      TabMemory.remove("key");

      expect(TabMemory.get("key")).toBeNull();
      expect(window.name).toBe("");
    });

    test("never overwrites a window name some other script set", () => {
      window.name = "a-window-someone-named";
      blockStorage();

      TabMemory.set("key", "value");

      expect(window.name).toBe("a-window-someone-named");
      expect(TabMemory.get("key")).toBeNull();
    });

    test("a window name that is ours but broken is read as empty, then rewritten", () => {
      window.name = "oneuptime-tab-memory:{not json";
      blockStorage();

      expect(TabMemory.get("key")).toBeNull();

      TabMemory.set("key", "value");

      expect(TabMemory.get("key")).toBe("value");
    });

    test("only strings are read back", () => {
      window.name = `oneuptime-tab-memory:${JSON.stringify({
        a: "1",
        b: 2,
        c: null,
      })}`;
      blockStorage();

      expect(TabMemory.get("a")).toBe("1");
      expect(TabMemory.get("b")).toBeNull();
      expect(TabMemory.get("c")).toBeNull();
    });
  });

  test("a copy left in window.name is cleared once storage works again", () => {
    window.name = `oneuptime-tab-memory:${JSON.stringify({ key: "old" })}`;

    TabMemory.remove("key");

    expect(window.name).toBe("");
  });
});
