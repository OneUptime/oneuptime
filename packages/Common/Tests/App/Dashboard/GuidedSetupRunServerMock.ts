import {
  GuidedSetupKey,
  GuidedSetupRunAnswer,
  GuidedSetupRunChange,
  GuidedSetupRunResources,
  GuidedSetupRunState,
  GuidedSetupRunValues,
  applyGuidedSetupRunChange,
} from "../../../Types/GuidedSetup/GuidedSetupRun";

/*
 * THE SERVER'S GUIDED SETUP RUNS, IN MEMORY, for the setups' component tests
 * (#7253): what GuidedSetupRunApi would read and write, merged by the real
 * rules (applyGuidedSetupRunChange), one run per setup - a suite's person in
 * its project. A suite mocks the API with it:
 *
 *   jest.mock(".../GuidedSetup/GuidedSetupRunApi", () => {
 *     return require("./GuidedSetupRunServerMock").guidedSetupRunApiModule;
 *   });
 *
 * and resets it before each test. `seed` puts a run on the server alone, as
 * another device left it; `isDown` makes every call fail, as when OneUptime
 * cannot be reached; `valuesOf` reads what the server keeps.
 */

export interface GuidedSetupRunServerCall {
  kind: "fetch" | "save" | "forget";
  setup: string;
  change?: GuidedSetupRunChange | undefined;
}

export class FakeGuidedSetupRunServer {
  public runs: Map<string, GuidedSetupRunState> = new Map();
  public calls: Array<GuidedSetupRunServerCall> = [];
  public isDown: boolean = false;

  public reset(): void {
    this.runs = new Map();
    this.calls = [];
    this.isDown = false;
  }

  public seed(
    setup: string,
    values: GuidedSetupRunValues,
    resources: GuidedSetupRunResources = {},
  ): void {
    this.runs.set(setup, {
      values: { ...values },
      resources: JSON.parse(
        JSON.stringify(resources),
      ) as GuidedSetupRunResources,
      revision: 1,
      updatedAt: "2026-11-20T10:00:00.000Z",
    });
  }

  public valuesOf(setup: string): GuidedSetupRunValues | undefined {
    const run: GuidedSetupRunState | undefined = this.runs.get(setup);

    return run ? { ...run.values } : undefined;
  }

  public resourcesOf(setup: string): GuidedSetupRunResources | undefined {
    const run: GuidedSetupRunState | undefined = this.runs.get(setup);

    return run
      ? (JSON.parse(JSON.stringify(run.resources)) as GuidedSetupRunResources)
      : undefined;
  }

  public fetch: (setup: GuidedSetupKey) => Promise<GuidedSetupRunAnswer> =
    async (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
      this.calls.push({ kind: "fetch", setup: setup });
      this.answerOrFail();

      return { setup: setup, run: this.copyOf(setup) };
    };

  public save: (
    setup: GuidedSetupKey,
    change: GuidedSetupRunChange,
  ) => Promise<GuidedSetupRunAnswer> = async (
    setup: GuidedSetupKey,
    change: GuidedSetupRunChange,
  ): Promise<GuidedSetupRunAnswer> => {
    this.calls.push({
      kind: "save",
      setup: setup,
      change: JSON.parse(JSON.stringify(change)) as GuidedSetupRunChange,
    });
    this.answerOrFail();

    const current: GuidedSetupRunState | undefined = this.runs.get(setup);
    const merged: {
      values: GuidedSetupRunValues;
      resources: GuidedSetupRunResources;
    } = applyGuidedSetupRunChange({
      values: current?.values || {},
      resources: current?.resources || {},
      change: change,
      now: new Date("2026-11-20T10:00:00.000Z"),
    });

    if (
      Object.keys(merged.values).length === 0 &&
      Object.keys(merged.resources).length === 0
    ) {
      this.runs.delete(setup);
    } else {
      this.runs.set(setup, {
        ...merged,
        revision: (current?.revision || 0) + 1,
        updatedAt: "2026-11-20T10:00:00.000Z",
      });
    }

    return { setup: setup, run: this.copyOf(setup) };
  };

  public forget: (setup: GuidedSetupKey) => Promise<GuidedSetupRunAnswer> =
    async (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
      this.calls.push({ kind: "forget", setup: setup });
      this.answerOrFail();
      this.runs.delete(setup);

      return { setup: setup, run: null };
    };

  private answerOrFail(): void {
    if (this.isDown) {
      throw new Error("OneUptime could not be reached.");
    }
  }

  private copyOf(setup: string): GuidedSetupRunState | null {
    const run: GuidedSetupRunState | undefined = this.runs.get(setup);

    return run
      ? (JSON.parse(JSON.stringify(run)) as GuidedSetupRunState)
      : null;
  }
}

export const guidedSetupRunServer: FakeGuidedSetupRunServer =
  new FakeGuidedSetupRunServer();

// What jest.mock hands the setups in place of GuidedSetupRunApi.
export const guidedSetupRunApiModule: {
  __esModule: boolean;
  default: {
    fetch: FakeGuidedSetupRunServer["fetch"];
    save: FakeGuidedSetupRunServer["save"];
    forget: FakeGuidedSetupRunServer["forget"];
  };
} = {
  __esModule: true,
  default: {
    fetch: (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
      return guidedSetupRunServer.fetch(setup);
    },
    save: (
      setup: GuidedSetupKey,
      change: GuidedSetupRunChange,
    ): Promise<GuidedSetupRunAnswer> => {
      return guidedSetupRunServer.save(setup, change);
    },
    forget: (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
      return guidedSetupRunServer.forget(setup);
    },
  },
};

/*
 * The run as this browser keeps it (GuidedSetupProgress): its values, read
 * from the cache's format, or from an older Dashboard's plain run.
 */
export const readKeptRunValues: (
  text: string | null,
) => Record<string, unknown> = (
  text: string | null,
): Record<string, unknown> => {
  const kept: Record<string, unknown> = JSON.parse(text || "{}") as Record<
    string,
    unknown
  >;

  if (kept["format"] === 2) {
    return (kept["values"] as Record<string, unknown>) || {};
  }

  return kept;
};
