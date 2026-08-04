import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The recommendations feature is eight copies of the same wiring — a page
 * component, a side-menu entry — plus three shared components underneath them.
 * None of it is reachable from a unit test: the App suite runs in a plain Node
 * environment with no renderer, so a prop that is never passed, an import that
 * was dropped, or a catch that starts re-throwing produces no failure anywhere.
 * The symptom reaches the user instead, and it is always silent: a page that
 * says "No telemetry yet" for a cluster that has been reporting for months, a
 * side menu that renders nothing because one entry threw, a badge that reads
 * "0" forever.
 *
 * So these read the sources and assert the exact expressions, the same way
 * NetworkSitePageInvariants.test.ts pins the Network pages. Sources are
 * whitespace-squashed first so prettier re-wrapping a line cannot turn a real
 * regression check into a red herring, and the negative assertions read a
 * comment-stripped copy so that a comment explaining why something was removed
 * cannot fail the very test that checks it is gone.
 *
 * The per-resource loops are driven from Object.values() of the enum, not from
 * a hand-kept list, so a ninth resource type added to the catalog fails here
 * until its page and its menu entry exist.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSourceAt(absolutePath: string): string {
  return squash(fs.readFileSync(absolutePath, "utf8"));
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

function readSource(...relativeParts: Array<string>): string {
  return readSourceAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

function readCode(...relativeParts: Array<string>): string {
  return readCodeAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

function findSideMenuFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  const entries: Array<fs.Dirent> = fs.readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...findSideMenuFiles(fullPath));
    } else if (entry.name === "SideMenu.tsx") {
      found.push(fullPath);
    }
  }

  return found;
}

const SIDE_MENU_FILES: Array<string> = findSideMenuFiles(DASHBOARD_SRC);

const ALL_RESOURCE_TYPES: Array<MonitorRecommendationResourceType> =
  Object.values(MonitorRecommendationResourceType);

/*
 * Resource type -> the folder its pages live in. This is the one thing that
 * cannot be derived: seven folders are named for the enum member and the
 * eighth is not (IoTDevice lives in Pages/IoT). Typing it as a Record over the
 * enum means a new member fails to compile here until it is added.
 */
const PAGE_FOLDER_BY_RESOURCE_TYPE: Record<
  MonitorRecommendationResourceType,
  string
> = {
  [MonitorRecommendationResourceType.Kubernetes]: "Kubernetes",
  [MonitorRecommendationResourceType.Host]: "Host",
  [MonitorRecommendationResourceType.Docker]: "Docker",
  [MonitorRecommendationResourceType.DockerSwarm]: "DockerSwarm",
  [MonitorRecommendationResourceType.Podman]: "Podman",
  [MonitorRecommendationResourceType.Proxmox]: "Proxmox",
  [MonitorRecommendationResourceType.Ceph]: "Ceph",
  [MonitorRecommendationResourceType.IoTDevice]: "IoT",
  [MonitorRecommendationResourceType.RumApplication]: "Rum",
};

/*
 * The sources name the enum MEMBER (`MonitorRecommendationResourceType.Ceph`)
 * while the loop carries the enum VALUE ("Ceph"). They happen to be spelled
 * the same for all eight today, so the member name is looked up rather than
 * assumed — otherwise the day someone gives a member a value that differs from
 * its name, every assertion below would start searching the source for a
 * symbol that does not exist and fail for the wrong reason.
 */
function memberNameOf(resourceType: MonitorRecommendationResourceType): string {
  const entry: [string, MonitorRecommendationResourceType] | undefined = (
    Object.entries(MonitorRecommendationResourceType) as Array<
      [string, MonitorRecommendationResourceType]
    >
  ).find((candidate: [string, MonitorRecommendationResourceType]) => {
    return candidate[1] === resourceType;
  });

  return entry![0];
}

type ResourceCase = [MonitorRecommendationResourceType, string, string];

const RESOURCE_CASES: Array<ResourceCase> = ALL_RESOURCE_TYPES.map(
  (resourceType: MonitorRecommendationResourceType): ResourceCase => {
    return [
      resourceType,
      memberNameOf(resourceType),
      PAGE_FOLDER_BY_RESOURCE_TYPE[resourceType],
    ];
  },
);

describe("the resource-type table this file loops over", () => {
  /*
   * Everything below is a `test.each` over RESOURCE_CASES. If the table were
   * ever empty or short, every one of those tests would pass by never running.
   */
  test("covers every member of the enum", () => {
    expect(ALL_RESOURCE_TYPES.length).toBe(9);
    expect(RESOURCE_CASES.length).toBe(ALL_RESOURCE_TYPES.length);

    for (const resourceCase of RESOURCE_CASES) {
      expect(
        fs.existsSync(path.join(DASHBOARD_SRC, "Pages", resourceCase[2])),
      ).toBe(true);
    }
  });
});

/*
 * Each of the eight `View/Recommendations.tsx` files used to fetch its own
 * model and read its own identifier column before handing three props down.
 * Eight copies meant eight chances to forget the column in the `select`, and a
 * forgotten select does not error — the identifier comes back undefined and the
 * page renders its "No telemetry yet" empty state on a resource that has been
 * reporting for months. The fetch and the select now live once, in
 * RecommendationsPage, so these assert both halves: the page delegates, and the
 * fetch it used to do is really gone rather than left behind as a second
 * source of truth.
 */
describe("every resource type routes its Recommendations page through the shared shell", () => {
  test.each(RESOURCE_CASES)(
    "%s renders RecommendationsPage for its own resource type",
    (
      _resourceType: MonitorRecommendationResourceType,
      memberName: string,
      folder: string,
    ) => {
      const source: string = readSource(
        "Pages",
        folder,
        "View",
        "Recommendations.tsx",
      );

      expect(source).toContain(
        'from "../../../Components/Recommendations/RecommendationsPage"',
      );
      expect(source).toContain("<RecommendationsPage");

      /*
       * The resource type is the ONLY thing that distinguishes these eight
       * files. Passing the wrong member compiles, renders, and silently offers
       * a Podman host the Ceph recommendations.
       */
      expect(source).toContain(
        squash(
          `resourceType={MonitorRecommendationResourceType.${memberName}}`,
        ),
      );
    },
  );

  test.each(RESOURCE_CASES)(
    "%s no longer fetches its own resource",
    (
      _resourceType: MonitorRecommendationResourceType,
      _memberName: string,
      folder: string,
    ) => {
      const code: string = readCode(
        "Pages",
        folder,
        "View",
        "Recommendations.tsx",
      );

      /*
       * A page that keeps its own getItem keeps its own `select` with it, and
       * the whole point of the refactor was that the identifier column is
       * chosen in one place. A second fetch would not conflict loudly — it
       * would just be the one that is missing a column.
       */
      expect(code).not.toContain("ModelAPI.getItem");
      expect(code).not.toContain("ModelAPI");
      expect(code).not.toContain("resourceIdentifier");
    },
  );

  /*
   * ...and the one place the fetch moved to still does all of it. Without
   * this, the eight assertions above would keep passing against a shell that
   * had quietly stopped selecting anything.
   */
  test("the shell does the fetch, with the registry's select, and hands the row id down", () => {
    const shell: string = readSource(
      "Components",
      "Recommendations",
      "RecommendationsPage.tsx",
    );

    expect(shell).toContain(
      squash(
        "await ModelAPI.getItem({ modelType: definition.modelType, id: modelId, select: RecommendationResourceRegistry.getSelect(props.resourceType), })",
      ),
    );
    expect(shell).toContain(
      squash(
        "RecommendationResourceRegistry.readResourceFields({ resourceType: props.resourceType, model: resource, })",
      ),
    );

    /*
     * The row id, not the identifier string: dismissals are scoped to it, so a
     * shell that stopped passing it would make every dismissal land on the
     * wrong resource — or fail validation, depending on the day.
     */
    expect(shell).toContain("resourceId={modelId}");
    expect(shell).toContain("resourceIdentifier={resourceIdentifier}");
    expect(shell).toContain("resourceDisplayName={resourceDisplayName}");
  });
});

/*
 * The side-menu entry is what tells a user there is anything to look at. It
 * has to be the badged component (a plain SideMenuItem renders a link with no
 * count, which is the pre-feature behaviour and looks like nothing changed),
 * and it has to be told which resource it is describing and which row to count
 * dismissals for.
 */
describe("every resource type badges its Recommendations side-menu entry", () => {
  test.each(RESOURCE_CASES)(
    "%s uses RecommendationsSideMenuItem, scoped to the resource in view",
    (
      _resourceType: MonitorRecommendationResourceType,
      memberName: string,
      folder: string,
    ) => {
      const source: string = readSource(
        "Pages",
        folder,
        "View",
        "SideMenu.tsx",
      );

      expect(source).toContain(
        'from "../../../Components/Recommendations/RecommendationsSideMenuItem"',
      );
      expect(source).toContain("<RecommendationsSideMenuItem");

      const element: string = source
        .split("<RecommendationsSideMenuItem")[1]!
        .split("/>")[0]!;

      expect(element).toContain(squash('title: "Recommendations",'));
      expect(element).toContain(
        `resourceType={MonitorRecommendationResourceType.${memberName}}`,
      );

      /*
       * props.modelId is the id of the resource whose page the menu is
       * decorating. Anything else — a project id, a hardcoded value — produces
       * a badge that counts a different resource's dismissals and therefore
       * disagrees with the page it links to.
       */
      expect(element).toContain("resourceId={props.modelId}");
    },
  );

  /*
   * The badge is easy to skip: the entry works without it, so a ninth page —
   * or a merge that resolves in favour of the old file — reintroduces a plain
   * item and nothing complains. This sweeps every side menu in the dashboard
   * rather than only the eight, because the failure is exactly "one of them
   * was missed".
   */
  test("no side menu anywhere still renders a plain Recommendations item", () => {
    const offenders: Array<string> = [];
    let elementsExamined: number = 0;

    for (const file of SIDE_MENU_FILES) {
      const chunks: Array<string> = readCodeAt(file).split("<SideMenuItem");

      for (const chunk of chunks.slice(1)) {
        elementsExamined = elementsExamined + 1;

        if (chunk.split("/>")[0]!.includes('title: "Recommendations"')) {
          offenders.push(path.relative(DASHBOARD_SRC, file));
        }
      }
    }

    /*
     * A guard on the sweep itself: if the split ever stopped matching, the
     * loop above would pass by examining nothing at all.
     */
    expect(SIDE_MENU_FILES.length).toBeGreaterThan(20);
    expect(elementsExamined).toBeGreaterThan(50);

    expect(offenders).toEqual([]);
  });

  /*
   * The component's resourceType prop is typed, so a menu that imports the
   * component without the enum cannot compile — but the App suite never
   * type-checks these .tsx files, so that error would first appear in a
   * production build. Checking the two imports travel together catches it
   * here.
   */
  test("every side menu that badges recommendations also imports the resource type enum", () => {
    const badgedMenus: Array<string> = SIDE_MENU_FILES.filter(
      (file: string) => {
        return readCodeAt(file).includes("RecommendationsSideMenuItem");
      },
    );

    // One per resource type: no more (a stray wiring), no fewer (a missed one).
    expect(badgedMenus.length).toBe(ALL_RESOURCE_TYPES.length);

    for (const file of badgedMenus) {
      expect(readCodeAt(file)).toContain(
        'import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";',
      );
    }
  });
});

/*
 * The badge issues five network calls to compute a number nobody asked for.
 * Every one of them can fail — a permissions gap, a project with no severities
 * configured, an offline tab — and the entry is rendered inside SideMenu next
 * to Overview, Metrics, Logs and the rest. An unhandled throw from here does
 * not degrade the badge, it unmounts the whole navigation and strands the user
 * on a page with no way out. Losing the count is the only acceptable failure.
 */
describe("the Recommendations side-menu badge cannot break the menu", () => {
  const BADGE_CODE: string = readCode(
    "Components",
    "Recommendations",
    "RecommendationsSideMenuItem.tsx",
  );

  test("every network call that computes the count is inside the try", () => {
    const tryBody: string = BADGE_CODE.split("try {")[1]!.split("} catch")[0]!;

    expect(tryBody).toContain("await ModelAPI.getItem({");
    expect(tryBody).toContain("await Promise.all([");
    expect(tryBody).toContain("RecommendationDismissalUtil.getDismissals({");
    // Including the write: a throw from the state setter is still a throw.
    expect(tryBody).toContain("setCount(");
  });

  test("the catch swallows rather than re-raising or surfacing an error", () => {
    /*
     * The handler runs no statements at all — matched with an optional binding
     * so naming the error is still allowed. Asserted positively because the
     * three negatives below would all pass against an extraction that had
     * silently stopped finding the handler.
     */
    expect(BADGE_CODE).toMatch(/\} catch (\(\w+\) )?\{ \}/);

    const catchBody: string = BADGE_CODE.split("} catch")[1]!.split("}, [")[0]!;

    expect(catchBody).not.toContain("throw");
    expect(catchBody).not.toContain("setError");
    /*
     * Not even a fallback count. Writing a number here would badge whatever
     * the failed computation happened to leave behind.
     */
    expect(catchBody).not.toContain("setCount");
  });

  test("the component has no error state to render at all", () => {
    /*
     * A red error where a number should be is barely better than a crash —
     * the page behind the entry works either way, so there is nothing to
     * report and nowhere sensible to report it.
     */
    expect(BADGE_CODE).not.toContain("setError");
    expect(BADGE_CODE).not.toContain("ErrorMessage");
    expect(BADGE_CODE).not.toContain("throw ");
  });

  /*
   * The whole value of this badge is that it can reach zero — a number that
   * only ever counts up is ignored within a week. "0" sitting in a warning
   * pill next to a menu entry reads as an unread count, not as "done", so a
   * cleared list has to render as no pill at all.
   */
  test("a zero count renders no badge", () => {
    expect(BADGE_CODE).toContain("useState<number | undefined>(undefined)");
    expect(BADGE_CODE).toContain(squash("badge={count ? count : undefined}"));
    // Passing the count straight through is the defect: 0 is a rendered badge.
    expect(BADGE_CODE).not.toContain("badge={count}");
  });
});

/*
 * Dismissals are scoped to the resource ROW, not to the identifier string, so
 * that a cluster renamed after a dismissal keeps its dismissals. That only
 * holds if every call site actually passes the row id — and the read and the
 * write have to agree, or a dismissal is recorded against one scope and looked
 * up in another, which presents as "Dismiss did nothing" and repeats forever.
 */
describe("MonitorRecommendations scopes dismissals to the resource row", () => {
  const PAGE_CODE: string = readCode(
    "Components",
    "Recommendations",
    "MonitorRecommendations.tsx",
  );

  test("the row id is a declared prop", () => {
    expect(PAGE_CODE).toContain("resourceId: ObjectID;");
  });

  test("the dismissal read is scoped by it", () => {
    const call: string = PAGE_CODE.split(
      "RecommendationDismissalUtil.getDismissals({",
    )[1]!.split("})")[0]!;

    expect(call).toContain("resourceType: props.resourceType,");
    expect(call).toContain("resourceId: props.resourceId,");
    expect(call).toContain("recommendationType: RecommendationType.Monitor,");
  });

  test("the dismissal write is scoped by the same three things", () => {
    const call: string = PAGE_CODE.split(
      "RecommendationDismissalUtil.dismiss({",
    )[1]!.split("})")[0]!;

    expect(call).toContain("resourceType: props.resourceType,");
    expect(call).toContain("resourceId: props.resourceId,");
    expect(call).toContain(
      "recommendationId: dismissTarget.recommendation.recommendationId,",
    );
    /*
     * Read off the recommendation rather than hardcoded, so the kind-agnostic
     * dismissal table keeps working when a second recommendation kind lands.
     */
    expect(call).toContain(
      "recommendationType: dismissTarget.recommendation.recommendationType,",
    );
  });

  /*
   * A card can be ticked for creation and then dismissed. If dismissing left
   * it ticked, the footer would keep counting it, and pressing Create would
   * build a monitor for the exact thing the user just said they did not want —
   * with no card on screen to explain where it came from.
   */
  test("dismissing a card drops it from the pending-create selection", () => {
    const confirmBody: string = PAGE_CODE.split(
      "const confirmDismiss:",
    )[1]!.split("type RestoreFunction")[0]!;

    expect(confirmBody).toContain(
      "const selected: Set<string> = new Set<string>(selectedRecommendationIds);",
    );
    expect(confirmBody).toContain(
      "selected.delete(dismissTarget.recommendation.recommendationId);",
    );
    expect(confirmBody).toContain("setSelectedRecommendationIds(selected);");

    /*
     * And only after the write resolved. Clearing first would deselect the
     * card on a dismissal that then failed, leaving the user with a card still
     * on screen that is no longer in the batch they think they queued.
     */
    const writeIndex: number = confirmBody.indexOf(
      "RecommendationDismissalUtil.dismiss({",
    );
    const deleteIndex: number = confirmBody.indexOf("selected.delete(");
    const setIndex: number = confirmBody.indexOf(
      "setSelectedRecommendationIds(selected);",
    );

    expect(writeIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeLessThan(deleteIndex);
    expect(deleteIndex).toBeLessThan(setIndex);
  });
});

/*
 * Every shipped template sets both createIncidents and createAlerts, so an
 * untouched batch opens two records and two notification fan-outs for one
 * threshold breach. The create form exists to let the user say otherwise, and
 * what it OPENS on is what most batches will be created with — a default of
 * Both would simply preserve the defect for everyone who does not read the
 * radio group.
 */
describe("the create side-over opens on a single record", () => {
  const SIDE_OVER_CODE: string = readCode(
    "Components",
    "Recommendations",
    "MonitorRecommendationCreateSideOver.tsx",
  );

  test("notificationMode starts at Alert", () => {
    expect(SIDE_OVER_CODE).toContain(
      squash(
        "useState<MonitorRecommendationNotificationMode>( MonitorRecommendationNotificationMode.Alert, )",
      ),
    );
  });

  test("and that choice is what the submit hands back", () => {
    /*
     * A default nobody reads is not a default. If the settings object stopped
     * carrying notificationMode, MonitorRecommendationUtil would fall through
     * to "leave the templates alone" — which is both-records again, with the
     * radio group still showing Alert.
     */
    const submitBody: string = SIDE_OVER_CODE.split(
      "const notificationSettings: MonitorRecommendationNotificationSettings =",
    )[1]!.split("};")[0]!;

    expect(submitBody).toContain("notificationMode: notificationMode,");
    expect(SIDE_OVER_CODE).toContain("initialValue={notificationMode}");
  });
});
