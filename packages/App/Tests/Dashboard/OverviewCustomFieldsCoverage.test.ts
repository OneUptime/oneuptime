import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * Custom fields let a project record things OneUptime does not model -
 * the customer a ticket belongs to, the cost centre a monitor bills to. They
 * are only worth filling in if someone sees them, and for a long time nobody
 * did: every resource kept them on a dedicated "Custom Fields" page behind a
 * side menu item, three clicks from the page people actually open.
 *
 * The fix is one card on each resource's overview. The failure mode is that
 * it silently stops being "each": a new resource gets custom fields (a model,
 * a settings page, a View/CustomFields.tsx) and nobody remembers the overview,
 * so its fields go back to being invisible. Nothing throws, no other test
 * fails, and the gap is only found by the customer who defined the field.
 *
 * So this derives the resource list from the filesystem rather than hardcoding
 * it: every folder that has BOTH a CustomFields.tsx sub-page and the
 * Index.tsx overview beside it is a resource with custom fields, and every one
 * of them has to mount the overview card. Add a resource and this test starts
 * demanding the card on its overview without anyone editing this file.
 *
 * There is no renderer in the App suite (testEnvironment is plain node) and
 * these pages are JSX with no extractable logic, so it reads the sources - the
 * same fs/path approach NetworkFormStepsInvariants.test.ts uses. The rendering
 * behaviour itself is covered where it can actually be rendered:
 * Common/Tests/App/Dashboard/OverviewCustomFields.test.tsx,
 * Common/Tests/App/Dashboard/UserCustomFields.test.tsx and
 * Common/Tests/UI/Components/CustomFields/CustomFieldsDetail.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const PAGES_DIR: string = path.join(DASHBOARD_SRC, "Pages");

const OVERVIEW_COMPONENT: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "CustomFields",
  "OverviewCustomFields.tsx",
);

/*
 * Two different pages are called CustomFields.tsx.
 *
 * The one this test is about renders a per-RECORD card - the values this
 * incident/monitor/team carries. The other defines the field SCHEMA for the
 * whole project (Settings > Incidents > Custom Fields, and the same thing for
 * Teams and Users, which sit outside a Settings folder). A schema page has no
 * record and therefore no overview to put a card on, so it is filtered out by
 * what it renders rather than by where it happens to live.
 */
const PER_RECORD_CARDS: Array<string> = [
  "CustomFieldsDetail",
  "UserCustomFields",
];

interface ResourceWithCustomFields {
  /* Repo-relative-ish label used in test names and failure messages. */
  label: string;
  subPagePath: string;
  overviewPath: string;
}

type ListDirectoriesFunction = (dir: string) => Array<string>;

const listDirectoriesRecursively: ListDirectoriesFunction = (
  dir: string,
): Array<string> => {
  const found: Array<string> = [dir];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...listDirectoriesRecursively(path.join(dir, entry.name)));
    }
  }

  return found;
};

type FindResourcesFunction = () => Array<ResourceWithCustomFields>;

const findResourcesWithCustomFields: FindResourcesFunction =
  (): Array<ResourceWithCustomFields> => {
    return listDirectoriesRecursively(PAGES_DIR)
      .filter((dir: string) => {
        const subPagePath: string = path.join(dir, "CustomFields.tsx");

        if (
          !fs.existsSync(subPagePath) ||
          !fs.existsSync(path.join(dir, "Index.tsx"))
        ) {
          return false;
        }

        const subPage: string = fs.readFileSync(subPagePath, "utf8");

        return PER_RECORD_CARDS.some((cardName: string) => {
          return subPage.includes(cardName);
        });
      })
      .map((dir: string) => {
        return {
          label: path.relative(PAGES_DIR, dir).split(path.sep).join("/"),
          subPagePath: path.join(dir, "CustomFields.tsx"),
          overviewPath: path.join(dir, "Index.tsx"),
        };
      })
      .sort((a: ResourceWithCustomFields, b: ResourceWithCustomFields) => {
        return a.label.localeCompare(b.label);
      });
  };

const RESOURCES: Array<ResourceWithCustomFields> =
  findResourcesWithCustomFields();

type ReadFunction = (filePath: string) => string;

const read: ReadFunction = (filePath: string): string => {
  return fs.readFileSync(filePath, "utf8");
};

type ExtractPropFunction = (
  source: string,
  propName: string,
) => string | undefined;

/* Reads `propName={SomeIdentifier}` and hands back the identifier. */
const extractProp: ExtractPropFunction = (
  source: string,
  propName: string,
): string | undefined => {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${propName}=\\{([A-Za-z0-9_]+)\\}`),
  );

  return match?.[1];
};

describe("custom fields are shown on every resource overview", () => {
  /*
   * A glob that matches nothing would let every per-resource assertion below
   * pass vacuously, which is the exact silence this file exists to break.
   */
  test("finds the resources that have custom fields", () => {
    expect(
      RESOURCES.map((r: ResourceWithCustomFields) => {
        return r.label;
      }),
    ).toEqual([
      "Alerts/View",
      "Incidents/View",
      "Inventory/View",
      "Monitor/View",
      "OnCallDuty/OnCallDutyPolicy",
      "ScheduledMaintenanceEvents/View",
      "StatusPages/View",
      "Teams/View",
      "Users/View",
    ]);
  });

  test.each(
    RESOURCES.map((resource: ResourceWithCustomFields) => {
      return [resource.label, resource] as const;
    }),
  )(
    "%s mounts the custom fields card on its overview",
    (_label: string, resource: ResourceWithCustomFields) => {
      const overview: string = read(resource.overviewPath);

      const mountsCard: boolean =
        overview.includes("<OverviewCustomFields") ||
        overview.includes("<UserCustomFields");

      expect(mountsCard).toBe(true);
    },
  );

  test.each(
    RESOURCES.map((resource: ResourceWithCustomFields) => {
      return [resource.label, resource] as const;
    }),
  )(
    "%s imports the card it renders",
    (_label: string, resource: ResourceWithCustomFields) => {
      const overview: string = read(resource.overviewPath);
      const componentName: string = overview.includes("<UserCustomFields")
        ? "UserCustomFields"
        : "OverviewCustomFields";

      expect(overview).toContain(
        `import ${componentName} from "../../../Components/CustomFields/${componentName}"`,
      );
    },
  );

  /*
   * The overview and the sub-page have to be looking at the same fields. It
   * is easy to paste the wrong model in - IncidentCustomField onto the alert
   * page - and the card would still render, just populated with another
   * resource's field definitions and every value blank.
   */
  test.each(
    RESOURCES.filter((resource: ResourceWithCustomFields) => {
      return !read(resource.overviewPath).includes("<UserCustomFields");
    }).map((resource: ResourceWithCustomFields) => {
      return [resource.label, resource] as const;
    }),
  )(
    "%s shows the same models on the overview as on its sub-page",
    (_label: string, resource: ResourceWithCustomFields) => {
      const subPage: string = read(resource.subPagePath);
      const overview: string = read(resource.overviewPath);

      const expectedCustomFieldType: string | undefined = extractProp(
        subPage,
        "customFieldType",
      );
      const expectedModelType: string | undefined = extractProp(
        subPage,
        "modelType",
      );

      expect(expectedCustomFieldType).toBeTruthy();
      expect(expectedModelType).toBeTruthy();

      expect(extractProp(overview, "customFieldType")).toBe(
        expectedCustomFieldType,
      );
      expect(extractProp(overview, "modelType")).toBe(expectedModelType);
    },
  );

  /*
   * The sub-page sits one route segment deeper, so it reads the record id with
   * getLastParamAsObjectID(1). Copying that call onto the overview would read
   * the segment BEFORE the id - a different id, or none - and the card would
   * quietly show the wrong record's values.
   */
  test.each(
    RESOURCES.map((resource: ResourceWithCustomFields) => {
      return [resource.label, resource] as const;
    }),
  )(
    "%s reads the record id as the last route param",
    (_label: string, resource: ResourceWithCustomFields) => {
      const overview: string = read(resource.overviewPath);

      expect(overview).toContain("Navigation.getLastParamAsObjectID()");
      expect(overview).not.toContain("Navigation.getLastParamAsObjectID(1)");
    },
  );
});

describe("the overview card hides itself when there is nothing to show", () => {
  /*
   * Most projects never define a custom field. If the card did not opt out of
   * rendering, all seven overviews would carry a permanently empty box
   * explaining that - and, worse, an error box on any project whose plan does
   * not include custom fields at all.
   */
  test("OverviewCustomFields always asks to be hidden when empty", () => {
    expect(read(OVERVIEW_COMPONENT)).toContain("hideIfEmpty={true}");
  });

  test("the user overview asks for the same", () => {
    const usersOverview: string = read(
      path.join(PAGES_DIR, "Users", "View", "Index.tsx"),
    );

    expect(usersOverview).toContain("hideIfEmpty={true}");
  });

  /*
   * The dedicated sub-page must NOT hide: it is the page that explains why
   * there is nothing, and the only place a failed read is reported.
   */
  test.each(
    RESOURCES.map((resource: ResourceWithCustomFields) => {
      return [resource.label, resource] as const;
    }),
  )(
    "%s keeps its sub-page explaining the empty case",
    (_label: string, resource: ResourceWithCustomFields) => {
      expect(read(resource.subPagePath)).not.toContain("hideIfEmpty");
    },
  );
});
