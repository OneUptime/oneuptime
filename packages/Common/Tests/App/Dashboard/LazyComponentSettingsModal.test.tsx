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
 * A widget's settings are a file of their own, loaded the first time the
 * board opens them (LazyComponentSettingsModal): in edit mode, when a widget
 * is picked. A board draws without them - in view mode, and on a public
 * dashboard, which has no edit mode - and statically imported, they and the
 * arguments forms, the metric query editor and the models their pickers
 * search were some 390 KB (before gzip) of what a public dashboard's visitor
 * downloaded before the board drew (packages/Common/Scripts/
 * first-load-budgets.js).
 *
 * These hold its file back until the test lets it arrive, so the modal is
 * seen before and after, and pin the imports that keep it out of the first
 * load of every page with a board.
 */

const modalRenderMock: MockFunction = getJestMockFunction();

// What the modal draws is not the point here: whether, and with what, it opens.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }): React.ReactElement => {
        modalRenderMock(props);
        return <div data-testid="component-settings-modal">{props.title}</div>;
      },
    };
  },
);

import LazyComponentSettingsModal from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/LazyComponentSettingsModal";
import type { ComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { LazyLibrary } from "../../../UI/Utils/LazyLibrary";

const CANVAS: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas",
);

const read: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(CANVAS, file), "utf8");
};

const COMPONENT_ID: ObjectID = new ObjectID(
  "550e8400-e29b-41d4-a716-446655440001",
);

const CONFIG: DashboardViewConfig = {
  components: [],
  heightInDashboardUnits: 10,
} as DashboardViewConfig;

const RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
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

// Stands for the part of the page a widget's settings open from.
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

const renderModal: (onClose?: () => void) => void = (
  onClose?: () => void,
): void => {
  const props: ComponentProps = {
    title: "Component Settings",
    onClose: onClose || ((): void => {}),
    onComponentUpdate: (): void => {},
    onComponentDelete: (): void => {},
    onComponentDuplicate: (): void => {},
    componentId: COMPONENT_ID,
    dashboardViewConfig: CONFIG,
    dashboardStartAndEndDate: RANGE,
    totalCurrentDashboardWidthInPx: 1200,
    metrics: { metricTypes: [], telemetryAttributes: [] },
  };

  render(
    <CrashBoundary>
      <LazyComponentSettingsModal {...props} />
    </CrashBoundary>,
  );
};

beforeEach(() => {
  held = [];
  modalRenderMock.mockReset();

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

describe("a widget's settings, as the board opens them", () => {
  test("their file is asked for as they open, and they draw once the file arrives, with what the board gave them", async () => {
    const onClose: MockFunction = getJestMockFunction();

    renderModal(onClose);

    // On its way: nothing drawn yet, and its file asked for once.
    expect(screen.queryByTestId("component-settings-modal")).toBeNull();
    expect(held).toHaveLength(1);

    await arrive();

    expect(screen.getByTestId("component-settings-modal")).toHaveTextContent(
      "Component Settings",
    );

    const props: Record<string, unknown> = modalRenderMock.mock.calls[
      modalRenderMock.mock.calls.length - 1
    ]?.[0] as Record<string, unknown>;

    expect(props["componentId"]).toBe(COMPONENT_ID);
    expect(props["dashboardViewConfig"]).toBe(CONFIG);
    expect(props["onClose"]).toBe(onClose);
  });

  test("once their file is there, settings opened after draw from their first frame, asking for nothing", async () => {
    const loaded: { default: unknown } = jest.requireMock(
      "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal",
    ) as { default: unknown };

    jest
      .spyOn(LazyLibrary.prototype, "getLoaded")
      .mockReturnValue(loaded.default);

    renderModal();

    expect(screen.getByTestId("component-settings-modal")).toHaveTextContent(
      "Component Settings",
    );
    expect(held).toHaveLength(0);
  });

  test("if their file does not arrive, the part of the page they open from says so", async () => {
    // React reports the error the boundary catches; that is the point here.
    jest.spyOn(console, "error").mockImplementation((): void => {});

    renderModal();

    await act(async () => {
      (held.shift() as HeldLoad).reject(
        new Error("Loading chunk ComponentSettingsModal failed."),
      );

      await tick();
    });

    expect(screen.getByTestId("crashed")).toHaveTextContent(
      "Loading chunk ComponentSettingsModal failed.",
    );
    expect(screen.queryByTestId("component-settings-modal")).toBeNull();
  });
});

describe("the imports that keep a widget's settings out of a board's first load", () => {
  test("the board opens them through LazyComponentSettingsModal", () => {
    const source: string = read("Index.tsx");

    expect(source).toContain(
      'import ComponentSettingsModal from "./LazyComponentSettingsModal";',
    );
    expect(source).not.toMatch(/from "\.\/ComponentSettingsModal"/);
  });

  test("LazyComponentSettingsModal reads the modal's types, and loads the modal only with import()", () => {
    const source: string = read("LazyComponentSettingsModal.tsx");

    const staticImports: Array<string> = Array.from(
      source.matchAll(/^import[^;]*from "\.\/ComponentSettingsModal";$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });

    expect(staticImports).toEqual([
      'import type ComponentSettingsModal from "./ComponentSettingsModal";',
      'import type { ComponentProps } from "./ComponentSettingsModal";',
    ]);
    expect(source).toContain('await import("./ComponentSettingsModal")');
  });
});
