import type {
  FullConfig,
  FullProject,
  Reporter,
  TestCase,
} from "@playwright/test/reporter";
import fs from "fs";
import path from "path";
import type { ShardWeights } from "./Sharding";

/*
 * Records how long each spec file took per project, in whole seconds, in the
 * shape of ShardWeights.json, at <outputDir>/shard-timings.json. The release
 * workflows upload it from every shard, and ShardWeights.json is refreshed by
 * merging those files (see "Sharding the suite" in README.md).
 *
 * A file's time is the wall-clock time from the start of each of its tests to
 * the start of the next test, so it includes everything a test waits on -
 * beforeAll hooks, fixtures, worker start-up. That is only meaningful with
 * one worker, which is how the suite runs; with more, this reports nothing
 * rather than numbers that would mislead the packing.
 *
 * It never prints (printsToStdio is false, so Playwright still adds its
 * console reporter) and never fails the run: a write that fails is reported
 * on stderr and the run carries on.
 */
export default class ShardTimingReporter implements Reporter {
  private outputFile: string = "";
  private enabled: boolean = true;
  private seconds: ShardWeights = {};
  private running: {
    file: string;
    project: string;
    startedAt: number;
  } | null = null;

  public onBegin(config: FullConfig): void {
    this.enabled = config.workers === 1;
    this.outputFile = path.join(
      config.projects[0]?.outputDir ||
        path.join(config.rootDir, "test-results"),
      "shard-timings.json",
    );
  }

  public onTestBegin(test: TestCase): void {
    const now: number = Date.now();
    const project: FullProject | undefined = test.parent.project();

    this.stopClock(now);

    if (!project) {
      return;
    }

    this.running = {
      file: path
        .relative(project.testDir, test.location.file)
        .split(path.sep)
        .join("/"),
      project: project.name,
      startedAt: now,
    };
  }

  public onEnd(): void {
    this.stopClock(Date.now());

    if (!this.enabled || Object.keys(this.seconds).length === 0) {
      return;
    }

    const rounded: ShardWeights = {};

    for (const file of Object.keys(this.seconds).sort()) {
      const byProject: Record<string, number> = this.seconds[file] || {};
      rounded[file] = {};

      for (const project of Object.keys(byProject).sort()) {
        (rounded[file] as Record<string, number>)[project] = Math.max(
          1,
          Math.round(byProject[project] as number),
        );
      }
    }

    try {
      fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
      fs.writeFileSync(
        this.outputFile,
        `${JSON.stringify(rounded, null, 2)}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `ShardTimingReporter could not write ${this.outputFile}: ${String(error)}\n`,
      );
    }
  }

  public printsToStdio(): boolean {
    return false;
  }

  private stopClock(now: number): void {
    if (!this.running) {
      return;
    }

    const { file, project, startedAt } = this.running;
    const byProject: Record<string, number> = this.seconds[file] || {};

    byProject[project] = (byProject[project] || 0) + (now - startedAt) / 1000;
    this.seconds[file] = byProject;
    this.running = null;
  }
}
