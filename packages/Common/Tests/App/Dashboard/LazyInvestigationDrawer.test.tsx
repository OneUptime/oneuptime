import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The investigation drawer is a file of its own, loaded the first time a
 * chart opens it (LazyInvestigationDrawer). A chart draws without it - on a
 * dashboard, a resource page or a public dashboard, which never offers it -
 * and statically imported, it and the telemetry stack it draws with were 233
 * KiB of the 1,742 KiB (gzipped) a public dashboard's visitor downloaded
 * before it could draw (packages/Common/Scripts/first-load-budgets.js).
 *
 * These hold its file back until the test lets it arrive, so the drawer is
 * seen before and after, and pin the imports that keep it out of the first
 * load of every page with a chart.
 */

const drawerRenderMock: MockFunction = getJestMockFunction();

// What the drawer draws is not the point here: whether, and with what, it opens.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }): React.ReactElement => {
        drawerRenderMock(props);
        return <div data-testid="investigation-drawer">{props.title}</div>;
      },
    };
  },
);

import LazyInvestigationDrawer from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/LazyInvestigationDrawer";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import { LazyLibrary } from "../../../UI/Utils/LazyLibrary";

const DASHBOARD_COMPONENTS: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components",
);

const read: (relative: string) => string = (relative: string): string => {
  return fs.readFileSync(path.join(DASHBOARD_COMPONENTS, relative), "utf8");
};

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-10T10:00:00.000Z"),
  new Date("2026-11-10T11:00:00.000Z"),
);

const VIEW: MetricViewData = {
  startAndEndDate: WINDOW,
  queryConfigs: [],
  formulaConfigs: [],
};

interface HeldLoad {
  library: LazyLibrary<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

// What the real load would have done: LazyLibrary.load, not held back.
const realLoad: () => Promise<unknown> = LazyLibrary.prototype.load;

let held: Array<HeldLoad> = [];

const tick: () => Promise<void> = async (): Promise<void> => {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
};

// Lets the file asked for arrive.
const arrive: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      const load: HeldLoad = held.shift() as HeldLoad;

      realLoad.call(load.library).then(load.resolve, load.reject);

      await tick();
    }

    await tick();
  });
};

interface CrashBoundaryProps {
  children: React.ReactNode;
}

interface CrashBoundaryState {
  error: Error | null;
}

// Stands for the part of the page a chart's drawer opens from.
class CrashBoundary extends React.Component<
  CrashBoundaryProps,
  CrashBoundaryState
> {
  public constructor(props: CrashBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { error: error };
  }

  public override render(): React.ReactNode {
    if (this.state.error) {
      return <div data-testid="crashed">{this.state.error.message}</div>;
    }

    return this.props.children;
  }
}

const renderDrawer: (onClose?: () => void) => void = (
  onClose?: () => void,
): void => {
  render(
    <CrashBoundary>
      <LazyInvestigationDrawer
        title="Pod CPU Utilization"
        window={WINDOW}
        metricViewData={VIEW}
        onClose={onClose || ((): void => {})}
      />
    </CrashBoundary>,
  );
};

beforeEach(() => {
  held = [];
  drawerRenderMock.mockReset();

  // Nothing has loaded, whatever an earlier test let arrive.
  jest.spyOn(LazyLibrary.prototype, "getLoaded").mockReturnValue(null);

  jest.spyOn(LazyLibrary.prototype, "load").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): Promise<unknown> {
    return new Promise(
      (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => {
        held.push({ library: this, resolve, reject });
      },
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the investigation drawer, as a chart opens it", () => {
  test("its file is asked for as it opens, and it draws once the file arrives, with what the chart gave it", async () => {
    const onClose: MockFunction = getJestMockFunction();

    renderDrawer(onClose);

    // On its way: nothing drawn yet, and its file asked for once.
    expect(screen.queryByTestId("investigation-drawer")).toBeNull();
    expect(held).toHaveLength(1);

    await arrive();

    expect(screen.getByTestId("investigation-drawer")).toHaveTextContent(
      "Pod CPU Utilization",
    );

    const props: Record<string, unknown> = drawerRenderMock.mock.calls[
      drawerRenderMock.mock.calls.length - 1
    ]?.[0] as Record<string, unknown>;

    expect(props["window"]).toBe(WINDOW);
    expect(props["metricViewData"]).toBe(VIEW);
    expect(props["onClose"]).toBe(onClose);
  });

  test("once its file is there, a drawer opened after draws from its first frame, asking for nothing", async () => {
    const loaded: { default: unknown } = jest.requireMock(
      "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
    ) as { default: unknown };

    jest
      .spyOn(LazyLibrary.prototype, "getLoaded")
      .mockReturnValue(loaded.default);

    renderDrawer();

    expect(screen.getByTestId("investigation-drawer")).toHaveTextContent(
      "Pod CPU Utilization",
    );
    expect(held).toHaveLength(0);
  });

  test("if its file does not arrive, the part of the page it opens from says so", async () => {
    // React reports the error the boundary catches; that is the point here.
    jest.spyOn(console, "error").mockImplementation((): void => {});

    renderDrawer();

    await act(async () => {
      (held.shift() as HeldLoad).reject(
        new Error("Loading chunk InvestigationDrawer failed."),
      );

      await tick();
    });

    expect(screen.getByTestId("crashed")).toHaveTextContent(
      "Loading chunk InvestigationDrawer failed.",
    );
    expect(screen.queryByTestId("investigation-drawer")).toBeNull();
  });
});

describe("the imports that keep the drawer out of a chart's first load", () => {
  test.each([
    [
      "Metrics/MetricCharts.tsx",
      'import InvestigationDrawer from "../Telemetry/LazyInvestigationDrawer";',
    ],
    [
      "Dashboard/Components/DashboardChartComponent.tsx",
      'import InvestigationDrawer from "../../Telemetry/LazyInvestigationDrawer";',
    ],
  ])(
    "%s opens it through LazyInvestigationDrawer",
    (file: string, lazyImport: string) => {
      const source: string = read(file);

      expect(source).toContain(lazyImport);
      expect(source).not.toMatch(
        /from "[./]+\/Telemetry\/InvestigationDrawer"/,
      );
    },
  );

  test("LazyInvestigationDrawer reads the drawer's types, and loads the drawer only with import()", () => {
    const source: string = read("Telemetry/LazyInvestigationDrawer.tsx");

    const staticImports: Array<string> = Array.from(
      source.matchAll(/^import[^;]*from "\.\/InvestigationDrawer";$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });

    expect(staticImports).toEqual([
      'import type InvestigationDrawer from "./InvestigationDrawer";',
      'import type { ComponentProps } from "./InvestigationDrawer";',
    ]);
    expect(source).toContain('await import("./InvestigationDrawer")');
  });
});
