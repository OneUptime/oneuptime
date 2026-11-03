import { describe, expect, test } from "@jest/globals";
import {
  EXPLORER_SAVED_VIEW_SCOPE,
  SavedViewScopeKind,
  buildSavedViewScope,
  getSavedViewScopeColumnValue,
} from "Common/Utils/Telemetry/SavedViewScope";
import {
  InitialSavedViewResolution,
  doesHostOwnLogsView,
  mayApplyInitialSavedView,
  resolveInitialSavedView,
} from "../../FeatureSet/Dashboard/src/Utils/InitialSavedView";

/*
 * SAVED LOG VIEWS BELONG TO THE PAGE THEY WERE SAVED ON (issue #5549).
 *
 * "We created saved views within the Logs product. When navigating to Logs
 * under another product, such as Kubernetes, the same saved views are also
 * displayed." Every Logs viewer read every saved log view of the project, so
 * a view made on the Logs page was offered on each cluster's, host's and
 * service's Logs tab, and one made for a cluster everywhere else.
 *
 * Now a viewer is given its page (savedViewScope) and lists the views saved
 * on it alone: the server is asked for that page's views
 * (LogsSavedViewScopeWiring.test.ts reads the request), and this file pins
 * what the viewer then does with them on each kind of page - which views a
 * page can see, which page opens on its default, and which panels offer no
 * views at all.
 */

interface StoredView {
  id: string;
  name: string;
  // As the column holds it: null for the Logs page.
  scope: string | null;
  isDefault: boolean;
}

const CLUSTER_A: string = buildSavedViewScope(
  SavedViewScopeKind.KubernetesCluster,
  "7b3a4c2e-9f1d-4e8a-b5c6-1d2e3f4a5b6c",
);
const CLUSTER_B: string = buildSavedViewScope(
  SavedViewScopeKind.KubernetesCluster,
  "8c4b5d3f-0a2e-4f9b-a6d7-2e3f4a5b6c7d",
);
const HOST: string = buildSavedViewScope(
  SavedViewScopeKind.Host,
  "9d5c6e40-1b3f-4a0c-b7e8-3f4a5b6c7d8e",
);

// A project's views, as the issue's reporter had them, with a default on each page.
const PROJECT_VIEWS: Array<StoredView> = [
  { id: "logs-errors", name: "Errors", scope: null, isDefault: true },
  { id: "logs-checkout", name: "Checkout", scope: null, isDefault: false },
  { id: "a-payments", name: "Payments ns", scope: CLUSTER_A, isDefault: true },
  { id: "a-ingress", name: "Ingress", scope: CLUSTER_A, isDefault: false },
  {
    id: "b-kube-system",
    name: "kube-system",
    scope: CLUSTER_B,
    isDefault: false,
  },
  { id: "host-sshd", name: "sshd", scope: HOST, isDefault: true },
];

/*
 * The views the server answers a viewer's request with: the views whose
 * column holds what the viewer's page stores (IS NULL for the Logs page).
 */
function viewsOfPage(savedViewScope: string): Array<StoredView> {
  const columnValue: string | null =
    getSavedViewScopeColumnValue(savedViewScope);

  return PROJECT_VIEWS.filter((view: StoredView): boolean => {
    return view.scope === columnValue;
  });
}

function namesOf(views: Array<StoredView>): Array<string> {
  return views.map((view: StoredView): string => {
    return view.name;
  });
}

// What a viewer with no URL of its own opens on (a resource's tab reads none).
function openingView(input: {
  savedViewScope?: string | undefined;
  hasPinnedTimeRange?: boolean | undefined;
  hasTimeRangeOverride?: boolean | undefined;
}): InitialSavedViewResolution<StoredView> {
  const hostOwnsView: boolean = doesHostOwnLogsView({
    hasPinnedTimeRange: Boolean(input.hasPinnedTimeRange),
    hasTimeRangeOverride: Boolean(input.hasTimeRangeOverride),
    savedViewScope: input.savedViewScope,
  });

  return resolveInitialSavedView<StoredView>({
    savedViews: input.savedViewScope ? viewsOfPage(input.savedViewScope) : [],
    getId: (view: StoredView): string => {
      return view.id;
    },
    isDefault: (view: StoredView): boolean => {
      return view.isDefault;
    },
    urlSavedViewId: undefined,
    hasUrlScope: false,
    hostOwnsView,
  });
}

describe("which views a page lists", () => {
  test("the Logs page lists its own views, and no cluster's or host's", () => {
    expect(namesOf(viewsOfPage(EXPLORER_SAVED_VIEW_SCOPE))).toEqual([
      "Errors",
      "Checkout",
    ]);
  });

  test("a cluster's Logs tab lists the views saved on it, and none of the Logs page's", () => {
    expect(namesOf(viewsOfPage(CLUSTER_A))).toEqual(["Payments ns", "Ingress"]);
  });

  test("another cluster's Logs tab does not list the first cluster's views", () => {
    expect(namesOf(viewsOfPage(CLUSTER_B))).toEqual(["kube-system"]);
  });

  test("a host's Logs tab lists its own views only", () => {
    expect(namesOf(viewsOfPage(HOST))).toEqual(["sshd"]);
  });

  test("a page nobody saved a view on lists none", () => {
    expect(
      viewsOfPage(
        buildSavedViewScope(
          SavedViewScopeKind.Service,
          "0195d6c1-0000-7000-8000-00000000000a",
        ),
      ),
    ).toEqual([]);
  });

  test("every view is listed on exactly one page", () => {
    const pages: Array<string> = [
      EXPLORER_SAVED_VIEW_SCOPE,
      CLUSTER_A,
      CLUSTER_B,
      HOST,
    ];
    const listings: Array<string> = pages.flatMap(
      (page: string): Array<string> => {
        return viewsOfPage(page).map((view: StoredView): string => {
          return view.id;
        });
      },
    );

    expect([...listings].sort()).toEqual(
      PROJECT_VIEWS.map((view: StoredView): string => {
        return view.id;
      }).sort(),
    );
  });
});

describe("doesHostOwnLogsView", () => {
  test("the Logs page does not own its view: it opens on its default", () => {
    expect(
      doesHostOwnLogsView({
        hasPinnedTimeRange: false,
        hasTimeRangeOverride: false,
        savedViewScope: EXPLORER_SAVED_VIEW_SCOPE,
      }),
    ).toBe(false);
  });

  test("a resource's Logs tab does not own its view either: its default was saved on it", () => {
    expect(
      doesHostOwnLogsView({
        hasPinnedTimeRange: false,
        hasTimeRangeOverride: false,
        savedViewScope: CLUSTER_A,
      }),
    ).toBe(false);
  });

  test.each([
    ["no saved views (an incident's or a trace's panel)", undefined],
    ["a blank scope", ""],
    ["null", null],
  ])(
    "a panel with %s owns what it shows",
    (_label: string, savedViewScope: string | null | undefined) => {
      expect(
        doesHostOwnLogsView({
          hasPinnedTimeRange: false,
          hasTimeRangeOverride: false,
          savedViewScope,
        }),
      ).toBe(true);
    },
  );

  test("a pinned moment owns what it shows, whatever page it is on", () => {
    for (const savedViewScope of [EXPLORER_SAVED_VIEW_SCOPE, CLUSTER_A]) {
      expect(
        doesHostOwnLogsView({
          hasPinnedTimeRange: true,
          hasTimeRangeOverride: false,
          savedViewScope,
        }),
      ).toBe(true);
    }
  });

  test("a controlled window owns what it shows, whatever page it is on", () => {
    for (const savedViewScope of [EXPLORER_SAVED_VIEW_SCOPE, HOST]) {
      expect(
        doesHostOwnLogsView({
          hasPinnedTimeRange: false,
          hasTimeRangeOverride: true,
          savedViewScope,
        }),
      ).toBe(true);
    }
  });
});

describe("what a page opens on", () => {
  test("the Logs page opens on its own default", () => {
    const resolution: InitialSavedViewResolution<StoredView> = openingView({
      savedViewScope: EXPLORER_SAVED_VIEW_SCOPE,
    });

    expect(resolution.source).toBe("default");
    expect(resolution.savedView?.name).toBe("Errors");
  });

  test("a cluster's Logs tab opens on the default saved on it, never the Logs page's", () => {
    const resolution: InitialSavedViewResolution<StoredView> = openingView({
      savedViewScope: CLUSTER_A,
    });

    expect(resolution.source).toBe("default");
    expect(resolution.savedView?.name).toBe("Payments ns");
  });

  test("a cluster's Logs tab with no default of its own opens as it always did, though the Logs page has one", () => {
    const resolution: InitialSavedViewResolution<StoredView> = openingView({
      savedViewScope: CLUSTER_B,
    });

    expect(resolution).toEqual({
      savedView: null,
      source: "none",
      isUrlSavedViewMissing: false,
    });
  });

  test("a page nobody saved a view on opens as it always did", () => {
    expect(
      openingView({
        savedViewScope: buildSavedViewScope(
          SavedViewScopeKind.DockerHost,
          "0195d6c1-0000-7000-8000-00000000000b",
        ),
      }).savedView,
    ).toBeNull();
  });

  test("an incident's panel opens on no view, whatever defaults the project has", () => {
    expect(openingView({ hasPinnedTimeRange: true }).savedView).toBeNull();
    expect(openingView({}).savedView).toBeNull();
  });

  test("a resource's tab under a pinned moment keeps the moment, not its default", () => {
    expect(
      openingView({ savedViewScope: CLUSTER_A, hasPinnedTimeRange: true })
        .savedView,
    ).toBeNull();
  });
});

describe("which viewers wait for their saved views before their first read", () => {
  test("the Logs page and a resource's tab wait: a default of theirs may apply", () => {
    for (const savedViewScope of [EXPLORER_SAVED_VIEW_SCOPE, CLUSTER_A, HOST]) {
      expect(
        mayApplyInitialSavedView({
          urlSavedViewId: undefined,
          hasUrlScope: false,
          hostOwnsView: doesHostOwnLogsView({
            hasPinnedTimeRange: false,
            hasTimeRangeOverride: false,
            savedViewScope,
          }),
        }),
      ).toBe(true);
    }
  });

  test("a panel with no saved views never waits: nothing can apply there", () => {
    expect(
      mayApplyInitialSavedView({
        urlSavedViewId: undefined,
        hasUrlScope: false,
        hostOwnsView: doesHostOwnLogsView({
          hasPinnedTimeRange: false,
          hasTimeRangeOverride: false,
          savedViewScope: undefined,
        }),
      }),
    ).toBe(false);
  });

  test("a tab under a pinned moment never waits", () => {
    expect(
      mayApplyInitialSavedView({
        urlSavedViewId: undefined,
        hasUrlScope: false,
        hostOwnsView: doesHostOwnLogsView({
          hasPinnedTimeRange: true,
          hasTimeRangeOverride: false,
          savedViewScope: CLUSTER_A,
        }),
      }),
    ).toBe(false);
  });
});

describe("a link to the Logs page naming another page's view", () => {
  test("opens no view, and says the view is missing so the link stops naming it", () => {
    const resolution: InitialSavedViewResolution<StoredView> =
      resolveInitialSavedView<StoredView>({
        savedViews: viewsOfPage(EXPLORER_SAVED_VIEW_SCOPE),
        getId: (view: StoredView): string => {
          return view.id;
        },
        isDefault: (view: StoredView): boolean => {
          return view.isDefault;
        },
        // A cluster tab's view, named in a link to the Logs page.
        urlSavedViewId: "a-payments",
        hasUrlScope: false,
        hostOwnsView: false,
      });

    expect(resolution).toEqual({
      savedView: null,
      source: "none",
      isUrlSavedViewMissing: true,
    });
  });
});
