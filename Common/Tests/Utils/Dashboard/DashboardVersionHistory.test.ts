import DashboardVersionHistory, {
  DashboardSnapshot,
} from "../../../Utils/Dashboard/DashboardVersionHistory";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";

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

const buildConfig: (height: number) => DashboardViewConfig = (
  height: number,
): DashboardViewConfig => {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: [],
    heightInDashboardUnits: height,
  };
};

describe("DashboardVersionHistory", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  test("list returns empty when nothing has been recorded", () => {
    expect(DashboardVersionHistory.list("dash-1")).toEqual([]);
  });

  test("record prepends snapshots, newest first", () => {
    DashboardVersionHistory.record("dash-1", buildConfig(10));
    DashboardVersionHistory.record("dash-1", buildConfig(20));
    const snaps: Array<DashboardSnapshot> =
      DashboardVersionHistory.list("dash-1");
    expect(snaps.length).toEqual(2);
    expect(snaps[0]?.config.heightInDashboardUnits).toEqual(20);
    expect(snaps[1]?.config.heightInDashboardUnits).toEqual(10);
  });

  test("record caps history at 20 snapshots", () => {
    for (let i: number = 0; i < 25; i++) {
      DashboardVersionHistory.record("dash-1", buildConfig(i));
    }
    const snaps: Array<DashboardSnapshot> =
      DashboardVersionHistory.list("dash-1");
    expect(snaps.length).toEqual(20);
    // Most recent first
    expect(snaps[0]?.config.heightInDashboardUnits).toEqual(24);
  });

  test("snapshots are isolated per dashboard id", () => {
    DashboardVersionHistory.record("dash-A", buildConfig(10));
    DashboardVersionHistory.record("dash-B", buildConfig(20));
    expect(
      DashboardVersionHistory.list("dash-A")[0]?.config.heightInDashboardUnits,
    ).toEqual(10);
    expect(
      DashboardVersionHistory.list("dash-B")[0]?.config.heightInDashboardUnits,
    ).toEqual(20);
  });

  test("record ignores empty dashboardId", () => {
    DashboardVersionHistory.record("", buildConfig(10));
    expect(DashboardVersionHistory.list("")).toEqual([]);
  });

  test("clear empties the snapshot list for a dashboard", () => {
    DashboardVersionHistory.record("dash-1", buildConfig(10));
    DashboardVersionHistory.clear("dash-1");
    expect(DashboardVersionHistory.list("dash-1")).toEqual([]);
  });

  test("returns empty when window is unavailable", () => {
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(DashboardVersionHistory.list("dash-1")).toEqual([]);
    // Mutations are silently dropped — no throw.
    expect(() => {
      DashboardVersionHistory.record("dash-1", buildConfig(10));
    }).not.toThrow();
  });
});
