/**
 * RememberedChoice (Common/UI/Utils/RememberedChoice.ts): the one helper a
 * choice a person makes is kept in their browser by - a public dashboard
 * visitor's theme, a viewer's time range and auto-refresh on a dashboard -
 * with forgetting it as the way back to the page's own default.
 *
 * What it promises, and what each test below takes away to see it fail:
 *
 *   - what the browser keeps is read back, a pick made in another tab
 *     included;
 *   - storage that refuses - a private window, blocked site data, a full
 *     quota, a getter that throws - never throws out of it, and a choice the
 *     browser would not keep holds for as long as the page is open;
 *   - forgetting takes the choice away from both;
 *   - another tab's change, or the browser clearing everything, is told.
 */

import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

const KEY: string = "oneuptime-remembered-choice-test";

const realStorage: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(window, "localStorage");

// Puts a storage of the test's own in the window's place.
function installStorage(storage: Partial<Storage>): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: (): Storage => {
      return storage as Storage;
    },
  });
}

function blockStorageEntirely(): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: (): never => {
      throw new Error("Storage is blocked");
    },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
});

afterEach(() => {
  if (realStorage) {
    Object.defineProperty(window, "localStorage", realStorage);
  }

  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  jest.restoreAllMocks();
});

describe("a choice the browser keeps", () => {
  test("is kept, and read back", () => {
    expect(RememberedChoice.read(KEY)).toBeNull();
    expect(RememberedChoice.remember(KEY, "dark")).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("dark");
    expect(RememberedChoice.read(KEY)).toBe("dark");
  });

  test("is read from the browser every time, so a pick made in another tab counts", () => {
    RememberedChoice.remember(KEY, "dark");

    // Another tab of the same address.
    window.localStorage.setItem(KEY, "light");

    expect(RememberedChoice.read(KEY)).toBe("light");
  });

  test("is forgotten: the way back to the page's own default", () => {
    RememberedChoice.remember(KEY, "dark");
    RememberedChoice.forget(KEY);

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(RememberedChoice.read(KEY)).toBeNull();
  });

  test("keys do not reach each other", () => {
    RememberedChoice.remember(`${KEY}:a`, "1d");
    RememberedChoice.remember(`${KEY}:b`, "7d");
    RememberedChoice.forget(`${KEY}:a`);

    expect(RememberedChoice.read(`${KEY}:a`)).toBeNull();
    expect(RememberedChoice.read(`${KEY}:b`)).toBe("7d");
  });
});

describe("a browser that will not keep it", () => {
  test("a full quota: the choice holds while the page is open, and nothing throws", () => {
    installStorage({
      getItem: (): string | null => {
        return null;
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (): void => {},
    });

    expect(RememberedChoice.remember(KEY, "7d")).toBe(false);
    expect(RememberedChoice.read(KEY)).toBe("7d");

    RememberedChoice.forget(KEY);

    expect(RememberedChoice.read(KEY)).toBeNull();
  });

  test("site data blocked, so even reading localStorage throws: nothing throws out of here", () => {
    blockStorageEntirely();

    expect(RememberedChoice.read(KEY)).toBeNull();
    expect(RememberedChoice.remember(KEY, "1m")).toBe(false);
    expect(RememberedChoice.read(KEY)).toBe("1m");
    expect(() => {
      RememberedChoice.forget(KEY);
    }).not.toThrow();
    expect(RememberedChoice.read(KEY)).toBeNull();
  });

  test("a read that throws is no choice", () => {
    installStorage({
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
    });

    expect(RememberedChoice.read(KEY)).toBeNull();
  });

  test("once the browser keeps choices again, a new one goes to it and the held one is let go", () => {
    installStorage({
      getItem: (): string | null => {
        return null;
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
      removeItem: (): void => {},
    });

    RememberedChoice.remember(KEY, "7d");

    if (realStorage) {
      Object.defineProperty(window, "localStorage", realStorage);
    }

    expect(RememberedChoice.remember(KEY, "1d")).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("1d");
    expect(RememberedChoice.read(KEY)).toBe("1d");
  });
});

describe("another tab's change", () => {
  const storageEvent: (key: string | null) => StorageEvent = (
    key: string | null,
  ): StorageEvent => {
    return new StorageEvent("storage", { key });
  };

  test("is told for the key, and when the browser clears everything", () => {
    const onChange: Mock<() => void> = jest.fn<() => void>();
    const unsubscribe: () => void = RememberedChoice.subscribe(KEY, onChange);

    window.dispatchEvent(storageEvent(KEY));
    window.dispatchEvent(storageEvent(null));

    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  test("is not told for another key", () => {
    const onChange: Mock<() => void> = jest.fn<() => void>();
    const unsubscribe: () => void = RememberedChoice.subscribe(KEY, onChange);

    window.dispatchEvent(storageEvent(`${KEY}-other`));

    expect(onChange).not.toHaveBeenCalled();

    unsubscribe();
  });

  test("is no longer told once unsubscribed", () => {
    const onChange: Mock<() => void> = jest.fn<() => void>();
    const unsubscribe: () => void = RememberedChoice.subscribe(KEY, onChange);

    unsubscribe();
    window.dispatchEvent(storageEvent(KEY));

    expect(onChange).not.toHaveBeenCalled();
  });
});
