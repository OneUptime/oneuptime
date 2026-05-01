import DashboardLocalPreferences from "../../../Utils/Dashboard/DashboardLocalPreferences";

const installLocalStorageMock: () => void = (): void => {
  const store: Map<string, string> = new Map<string, string>();
  const mockStorage: Storage = {
    getItem: (key: string): string | null => {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
    key: (): string | null => {
      return null;
    },
    get length(): number {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: mockStorage },
    writable: true,
    configurable: true,
  });
};

describe("DashboardLocalPreferences", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  test("favorites round-trip", () => {
    expect(DashboardLocalPreferences.getFavorites()).toEqual([]);
    expect(DashboardLocalPreferences.isFavorite("a")).toBe(false);

    expect(DashboardLocalPreferences.toggleFavorite("a")).toBe(true);
    expect(DashboardLocalPreferences.isFavorite("a")).toBe(true);
    expect(DashboardLocalPreferences.getFavorites()).toEqual(["a"]);

    expect(DashboardLocalPreferences.toggleFavorite("b")).toBe(true);
    expect(DashboardLocalPreferences.getFavorites()).toEqual(["a", "b"]);

    expect(DashboardLocalPreferences.toggleFavorite("a")).toBe(false);
    expect(DashboardLocalPreferences.getFavorites()).toEqual(["b"]);
  });

  test("recordVisit prepends and dedups", () => {
    DashboardLocalPreferences.recordVisit("a", "A");
    DashboardLocalPreferences.recordVisit("b", "B");
    DashboardLocalPreferences.recordVisit("a", "A renamed");

    const recent: Array<{ id: string; name: string }> =
      DashboardLocalPreferences.getRecent();
    expect(
      recent.map((r: { id: string }) => {
        return r.id;
      }),
    ).toEqual(["a", "b"]);
    // Most-recent visit's name wins after dedup.
    expect(recent[0]?.name).toBe("A renamed");
  });

  test("recordVisit caps at 10 entries", () => {
    for (let i: number = 0; i < 15; i++) {
      DashboardLocalPreferences.recordVisit(`d${i}`, `D${i}`);
    }
    const recent: Array<{ id: string }> = DashboardLocalPreferences.getRecent();
    expect(recent.length).toEqual(10);
    // Most recent first — d14 leads.
    expect(recent[0]?.id).toBe("d14");
  });

  test("recordVisit ignores empty id", () => {
    DashboardLocalPreferences.recordVisit("", "X");
    expect(DashboardLocalPreferences.getRecent()).toEqual([]);
  });

  test("clearRecent empties the recent list", () => {
    DashboardLocalPreferences.recordVisit("a", "A");
    DashboardLocalPreferences.clearRecent();
    expect(DashboardLocalPreferences.getRecent()).toEqual([]);
  });

  test("returns empty arrays when window is unavailable", () => {
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(DashboardLocalPreferences.getFavorites()).toEqual([]);
    expect(DashboardLocalPreferences.getRecent()).toEqual([]);
    // Mutations are silently dropped — no throw.
    expect(() => {
      DashboardLocalPreferences.toggleFavorite("a");
    }).not.toThrow();
  });

  test("tolerates corrupt JSON in storage", () => {
    installLocalStorageMock();
    (
      globalThis as unknown as { window: { localStorage: Storage } }
    ).window.localStorage.setItem(
      "oneuptime.dashboard.favorites",
      "{not json}",
    );
    (
      globalThis as unknown as { window: { localStorage: Storage } }
    ).window.localStorage.setItem("oneuptime.dashboard.recent", "[1, 2, 3]");
    expect(DashboardLocalPreferences.getFavorites()).toEqual([]);
    expect(DashboardLocalPreferences.getRecent()).toEqual([]);
  });
});
