import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every status and state history in the Dashboard is drawn as a timeline.
 *
 * The maintainer asked for the monitor's Status Timeline - a table of
 * events ten to a page - to "actually look like timeline view", and for the
 * same "everywhere in the project where you recommend". A record's history
 * of states is a *Timeline model with a state and a start (and an end), and
 * each Dashboard page that lists one now opens on the shared timeline
 * (Common's ModelStatusTimeline), with its table one click away through the
 * Timeline | Table switch (StatusTimelineView).
 *
 * A page added later that lists such a history only as a table renders,
 * and nothing else fails. So this reads the Dashboard's source: every
 * ModelTable of a history model is in a file that also draws that model's
 * ModelStatusTimeline and the switch, which sits beside the table's title
 * too. The two *Timeline models that are not histories of a state are kept
 * as tables on purpose, each with why; a new *Timeline model has to be put
 * on one side or the other.
 *
 * What each page hands the timeline (the same rows, Create, Delete and its
 * locks, the subscriber notification) is held to what it hands the table in
 * Common/Tests/App/Dashboard/StatusTimelinePages.
 */

const PACKAGES_DIR: string = path.join(__dirname, "..", "..", "..");

const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MODELS_DIR: string = path.join(
  PACKAGES_DIR,
  "Common",
  "Models",
  "DatabaseModels",
);

/*
 * *Timeline models whose rows are not a time spent in a state, and so stay
 * tables: there is nothing to draw to scale.
 */
const KEPT_AS_TABLES: Record<string, string> = {
  OnCallDutyPolicyExecutionLogTimeline:
    "Each row is one notification an on-call policy sent (to whom, how, and whether it was delivered or acknowledged) - an event, not a time in a state.",
  UserOnCallLogTimeline:
    "Each row is one notification a person was sent while on call - an event, not a time in a state.",
};

// Comments hold prose, not code.
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /^\s*\/\/.*$/gm;
const WHITESPACE_RUN: RegExp = /\s+/g;
const TIMELINE_MODEL_FILE: RegExp = /^([A-Za-z]+Timeline)\.ts$/;
const SOURCE_FILE: RegExp = /\.tsx?$/;

const readCode: (file: string) => string = (file: string): string => {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(WHITESPACE_RUN, " ");
};

const listSourceFiles: (dir: string) => Array<string> = (
  dir: string,
): Array<string> => {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listSourceFiles(full);
      }

      return SOURCE_FILE.test(entry.name) ? [full] : [];
    });
};

const TIMELINE_MODELS: Array<string> = fs
  .readdirSync(MODELS_DIR)
  .map((name: string): string | null => {
    return name.match(TIMELINE_MODEL_FILE)?.[1] || null;
  })
  .filter((name: string | null): name is string => {
    return Boolean(name);
  })
  .sort();

const HISTORY_MODELS: Array<string> = TIMELINE_MODELS.filter(
  (model: string): boolean => {
    return !(model in KEPT_AS_TABLES);
  },
);

const DASHBOARD_FILES: Array<{ file: string; code: string }> =
  listSourceFiles(DASHBOARD_SRC).map((file: string) => {
    return { file: path.relative(DASHBOARD_SRC, file), code: readCode(file) };
  });

const filesDrawing: (tag: string, model: string) => Array<string> = (
  tag: string,
  model: string,
): Array<string> => {
  return DASHBOARD_FILES.filter((source: { file: string; code: string }) => {
    return source.code.includes(`<${tag}<${model}>`);
  })
    .map((source: { file: string; code: string }): string => {
      return source.file;
    })
    .sort();
};

describe("every status and state history is drawn as a timeline", () => {
  test("each *Timeline model is a history of states, or a table kept on purpose", () => {
    // Read from the models, so this is not vacuous.
    expect(HISTORY_MODELS).toEqual([
      "AlertEpisodeStateTimeline",
      "AlertStateTimeline",
      "IncidentEpisodeStateTimeline",
      "IncidentStateTimeline",
      "MonitorStatusTimeline",
      "NetworkSiteStatusTimeline",
      "ScheduledMaintenanceStateTimeline",
    ]);

    for (const model of Object.keys(KEPT_AS_TABLES)) {
      expect(TIMELINE_MODELS).toContain(model);
    }
  });

  test.each(HISTORY_MODELS)(
    "%s: every page that lists it as a table also draws it as a timeline, with the switch",
    (model: string) => {
      const tables: Array<string> = filesDrawing("ModelTable", model);
      const timelines: Array<string> = filesDrawing(
        "ModelStatusTimeline",
        model,
      );

      // Each history has a page, and that page opens on the timeline.
      expect(timelines.length).toBeGreaterThan(0);
      expect(tables).toEqual(timelines);

      for (const file of timelines) {
        const code: string = DASHBOARD_FILES.find(
          (source: { file: string; code: string }): boolean => {
            return source.file === file;
          },
        )!.code;

        expect({ file, hasSwitch: code.includes("<StatusTimelineViewSwitch") })
          .toEqual({ file, hasSwitch: true });
        expect({
          file,
          readsChoice: code.includes("useStatusTimelineView()"),
        }).toEqual({ file, readsChoice: true });
        // The switch sits beside the table's title, as it does the timeline's.
        expect({
          file,
          switchInTableHeader: code.includes("rightElement: viewSwitch"),
        }).toEqual({ file, switchInTableHeader: true });
        expect({
          file,
          switchInTimelineHeader: code.includes("headerElement={viewSwitch}"),
        }).toEqual({ file, switchInTimelineHeader: true });
      }
    },
  );

  test.each(Object.keys(KEPT_AS_TABLES))(
    "%s stays a table",
    (model: string) => {
      expect(filesDrawing("ModelTable", model).length).toBeGreaterThan(0);
      expect(filesDrawing("ModelStatusTimeline", model)).toEqual([]);
    },
  );
});
