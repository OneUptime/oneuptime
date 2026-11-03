import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SavedViewScopeKind } from "Common/Utils/Telemetry/SavedViewScope";

/*
 * EVERY LOGS VIEWER SAYS WHOSE SAVED VIEWS IT SHOWS (issue #5549).
 *
 * Saved log views used to be read for the whole project wherever a Logs
 * viewer was shown, so a view made on the Logs page turned up on every
 * Kubernetes cluster's, host's and service's Logs tab, and one made for a
 * cluster turned up everywhere else. A view now belongs to the page it was
 * saved on, and the viewer is told its page (savedViewScope). Leaving it out
 * means "no saved views here", which is right for a panel about one moment
 * and wrong for a resource's Logs tab - so the choice is checked here, for
 * every viewer in the Dashboard, by reading the sources (the App suite has
 * no renderer; Common/Tests/UI/Components/LogsViewerSavedViewsOffered.test.tsx
 * draws what the viewer shows for each).
 *
 * A new page that embeds the viewer fails this file until it says which
 * page its views belong to, or joins MOMENT_PANELS with the reason it has
 * none.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const VIEWER_FILE: string = path.join("Components", "Logs", "LogsViewer.tsx");

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function readCode(relativePath: string): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8"),
    ),
  );
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

// An opening JSX tag from `<Name` to its closing `>`, braces balanced.
function readOpeningTag(code: string, start: number): string {
  let depth: number = 0;

  for (let index: number = start; index < code.length; index++) {
    const character: string = code[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
    } else if (character === ">" && depth === 0) {
      return code.slice(start, index + 1);
    }
  }

  throw new Error(`An opening tag at ${start} never closes.`);
}

interface ViewerUse {
  file: string;
  tag: string;
}

// Every <DashboardLogsViewer ...> in the Dashboard, by the name it is imported under.
function findViewerUses(): Array<ViewerUse> {
  const uses: Array<ViewerUse> = [];

  for (const fullPath of listSourceFiles(DASHBOARD_SRC)) {
    const file: string = path.relative(DASHBOARD_SRC, fullPath);

    if (file === VIEWER_FILE) {
      continue;
    }

    const code: string = squash(
      stripComments(fs.readFileSync(fullPath, "utf8")),
    );
    const importPattern: RegExp =
      /import (\w+) from "((?:\.\.?\/)+(?:[\w]+\/)*Logs\/LogsViewer)";/g;

    for (const match of code.matchAll(importPattern)) {
      const name: string = match[1]!;
      const tagPattern: RegExp = new RegExp(`<${name}[\\s/>]`, "g");

      for (const tagMatch of code.matchAll(tagPattern)) {
        uses.push({ file, tag: readOpeningTag(code, tagMatch.index!) });
      }
    }
  }

  return uses;
}

/*
 * Panels about one moment - an incident, an alert, a trace, an exception, a
 * monitor's preview, a snapshot - offer no saved views: a view is made for a
 * page someone comes back to, and these come and go with what they are
 * about. Each says why.
 */
const MOMENT_PANELS: Record<string, string> = {
  [path.join("Pages", "Incidents", "View", "Index.tsx")]:
    "an incident's logs, pinned to the window the monitor evaluated",
  [path.join("Pages", "Alerts", "View", "Index.tsx")]:
    "an alert's logs, pinned to the window the monitor evaluated",
  [path.join("Components", "Traces", "TraceDetail", "TraceSignals.tsx")]:
    "the logs of one trace, and of its pod",
  [path.join("Components", "Exceptions", "ExceptionLogs.tsx")]:
    "the logs around one exception",
  [path.join("Components", "Monitor", "LogMonitor", "LogMonitorPreview.tsx")]:
    "the preview of a monitor being set up",
  [path.join("Components", "Telemetry", "TelemetrySnapshotPanel.tsx")]:
    "an incident's or alert's telemetry snapshot",
  [path.join("Components", "Telemetry", "TelemetryCompanionSignalTabs.tsx")]:
    "the logs beside another signal's snapshot",
  [path.join("Pages", "DockerSwarm", "View", "TaskDetail.tsx")]:
    "one Swarm task's container, which a new task with a new id replaces each time it fails or its service updates",
};

const LOGS_PAGE: string = path.join("Pages", "Logs", "Index.tsx");
const KUBERNETES_TAB: string = path.join(
  "Components",
  "Kubernetes",
  "KubernetesLogsTab.tsx",
);

const USES: Array<ViewerUse> = findViewerUses();

function scopeAttributeOf(tag: string): string | null {
  const start: number = tag.indexOf("savedViewScope={");

  if (start < 0) {
    return null;
  }

  let depth: number = 0;

  for (
    let index: number = start + "savedViewScope=".length;
    index < tag.length;
    index++
  ) {
    if (tag[index] === "{") {
      depth++;
    } else if (tag[index] === "}") {
      depth--;

      if (depth === 0) {
        return tag.slice(start + "savedViewScope={".length, index).trim();
      }
    }
  }

  return null;
}

// An id argument is a name in the code (modelId), not a quoted constant.
const NAMES_SOMETHING: RegExp = /[A-Za-z_]/;
const QUOTED: RegExp = /^["'`]/;

describe("every Logs viewer in the Dashboard", () => {
  test("is found, so nothing below passes for want of viewers", () => {
    // The Logs page, the resource tabs and the moment panels.
    expect(USES.length).toBeGreaterThanOrEqual(30);
    expect(
      USES.some((use: ViewerUse): boolean => {
        return use.file === LOGS_PAGE;
      }),
    ).toBe(true);
  });

  test("either names its page's saved views or is a panel about one moment", () => {
    const undecided: Array<string> = USES.filter((use: ViewerUse): boolean => {
      return scopeAttributeOf(use.tag) === null && !(use.file in MOMENT_PANELS);
    }).map((use: ViewerUse): string => {
      return use.file;
    });

    expect(undecided).toEqual([]);
  });

  test("a panel about one moment offers no saved views", () => {
    const offering: Array<string> = USES.filter((use: ViewerUse): boolean => {
      return use.file in MOMENT_PANELS && scopeAttributeOf(use.tag) !== null;
    }).map((use: ViewerUse): string => {
      return use.file;
    });

    expect(offering).toEqual([]);
  });

  test("every moment panel listed still embeds the viewer", () => {
    for (const file of Object.keys(MOMENT_PANELS)) {
      expect({
        file,
        embeds: USES.some((use: ViewerUse): boolean => {
          return use.file === file;
        }),
      }).toEqual({ file, embeds: true });
    }
  });

  test("the Logs page lists its own views, and it alone", () => {
    const explorerUses: Array<string> = USES.filter(
      (use: ViewerUse): boolean => {
        return scopeAttributeOf(use.tag) === "EXPLORER_SAVED_VIEW_SCOPE";
      },
    ).map((use: ViewerUse): string => {
      return use.file;
    });

    expect(explorerUses).toEqual([LOGS_PAGE]);
    expect(readCode(LOGS_PAGE)).toContain(
      'import { EXPLORER_SAVED_VIEW_SCOPE } from "Common/Utils/Telemetry/SavedViewScope";',
    );
  });

  test("every resource tab names its page by its kind and its own resource", () => {
    const resourceUses: Array<ViewerUse> = USES.filter(
      (use: ViewerUse): boolean => {
        const scope: string | null = scopeAttributeOf(use.tag);

        return (
          scope !== null &&
          scope !== "EXPLORER_SAVED_VIEW_SCOPE" &&
          use.file !== KUBERNETES_TAB
        );
      },
    );

    expect(resourceUses.length).toBeGreaterThanOrEqual(20);

    for (const use of resourceUses) {
      const scope: string = scopeAttributeOf(use.tag)!;
      const match: RegExpMatchArray | null = scope.match(
        /^buildSavedViewScope\( SavedViewScopeKind\.(\w+), (.+?),? \)$|^buildSavedViewScope\(SavedViewScopeKind\.(\w+), (.+)\)$/,
      );

      expect({ file: use.file, scope, builtFromKind: Boolean(match) }).toEqual({
        file: use.file,
        scope,
        builtFromKind: true,
      });

      /*
       * Named by the resource on screen (its id), never by a constant: two
       * clusters' tabs are two pages.
       */
      const ids: string = (match![2] || match![4] || "").trim();

      expect({
        file: use.file,
        ids,
        namesItsResource: NAMES_SOMETHING.test(ids) && !QUOTED.test(ids),
      }).toEqual({
        file: use.file,
        ids,
        namesItsResource: true,
      });
    }
  });

  test("no two kinds of page share a kind, and every kind names a page", () => {
    const kindsByFile: Map<string, Set<string>> = new Map();

    const record: (kind: string, file: string) => void = (
      kind: string,
      file: string,
    ): void => {
      const files: Set<string> = kindsByFile.get(kind) || new Set();
      files.add(file);
      kindsByFile.set(kind, files);
    };

    for (const use of USES) {
      const scope: string | null = scopeAttributeOf(use.tag);

      for (const match of (scope || "").matchAll(
        /SavedViewScopeKind\.(\w+)/g,
      )) {
        record(match[1]!, use.file);
      }
    }

    // The Kubernetes tabs build theirs in KubernetesLogsScope.
    const kubernetesScope: string = readCode(
      path.join("Components", "Kubernetes", "KubernetesLogsScope.ts"),
    );
    const kubernetesKinds: Array<string> = [
      ...kubernetesScope.matchAll(/SavedViewScopeKind\.(\w+)/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect([...new Set(kubernetesKinds)].sort()).toEqual([
      "KubernetesContainer",
      "KubernetesPod",
      "KubernetesWorkload",
    ]);

    for (const kind of kubernetesKinds) {
      record(kind, KUBERNETES_TAB);
    }

    const enumKeys: Array<string> = Object.keys(SavedViewScopeKind);

    for (const [kind, files] of kindsByFile) {
      expect({ kind, isAKind: enumKeys.includes(kind) }).toEqual({
        kind,
        isAKind: true,
      });
      expect({ kind, files: [...files] }).toEqual({
        kind,
        files: [[...files][0]],
      });
    }

    expect([...kindsByFile.keys()].sort()).toEqual([...enumKeys].sort());
  });

  test("the Kubernetes tabs pass the scope of the pod, container or workload they show", () => {
    const tab: string = readCode(KUBERNETES_TAB);

    expect(tab).toContain("savedViewScope={savedViewScope}");
    expect(tab).toContain(
      "return buildKubernetesLogsSavedViewScope({ clusterIdentifier: props.clusterIdentifier, podName: props.podName, containerName: props.containerName, namespace: props.namespace, workloadKind: props.workloadKind, workloadName: props.workloadName, });",
    );
  });
});

describe("the Dashboard Logs viewer", () => {
  const viewer: string = readCode(VIEWER_FILE);

  test("asks the server for its page's views only", () => {
    expect(viewer).toContain(
      "query: { projectId: projectId, scope: getSavedViewScopeQueryValue(props.savedViewScope), },",
    );
  });

  test("asks for none on a panel with no page, and asks again when its page changes", () => {
    expect(viewer).toContain(
      "if (!projectId || !props.savedViewScope) { setSavedViews([]); return; }",
    );
    expect(viewer).toContain(
      "setHasFetchedSavedViews(true); } }, [props.savedViewScope]);",
    );
  });

  test("saves a new view on its page", () => {
    expect(viewer).toContain(
      "const scope: string | null = getSavedViewScopeColumnValue( props.savedViewScope, ); if (scope) { savedView.scope = scope; }",
    );
  });

  test("hands the saved-view controls a list only where its page has views", () => {
    expect(viewer).toContain(
      "const offersSavedViews: boolean = Boolean(props.savedViewScope);",
    );
    expect(viewer).toContain(
      "savedViews={offersSavedViews ? savedViewOptions : undefined}",
    );
    expect(viewer).not.toContain("savedViews={savedViewOptions}");
  });

  test("opens on its page's default unless a pinned moment or a controlled window owns the view", () => {
    expect(viewer).toContain(
      "const hostOwnsView: boolean = doesHostOwnLogsView({ hasPinnedTimeRange: Boolean(pinnedTimeRange), hasTimeRangeOverride: Boolean(props.timeRangeOverride), savedViewScope: props.savedViewScope, });",
    );
    // A tab reads no URL: its first reads still wait for its default.
    expect(viewer).toContain(
      "return mayApplyInitialSavedView({ urlSavedViewId: initialUrlState?.savedViewId, hasUrlScope: Boolean(initialUrlState?.hasScope), hostOwnsView: hostOwnsView, });",
    );
    expect(viewer).not.toContain("!props.syncUrlState,");
  });

  test("applies a view under its page's scope without dropping the view's own attribute chips", () => {
    expect(viewer).toContain(
      ": buildSavedViewQueryOverBase({ savedQuery: savedQuery as unknown as JSONObject, baseQuery: baseQuery as unknown as JSONObject, });",
    );
    expect(viewer).not.toContain(
      "...(savedQuery as unknown as JSONObject), ...(baseQuery as unknown as JSONObject),",
    );
  });
});
