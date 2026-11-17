// UX rule: Docs/ux/README.md#loading
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";

/*
 * NOTHING JUMPS WHEN CONTENT ARRIVES (#9135).
 *
 * A page that loaded drew a thin bar 208px down an empty area (PageLoader's
 * mt-52), and the page's first card then arrived at the top, at its own
 * height. A card that loaded drew one of three bars: PageLoader's, again
 * 208px down; ComponentLoader's, a paler grey between 4rem margins; or
 * CompactLoader's, the pale one between 1.25rem margins. The same wait
 * looked different from card to card, and the page moved under the reader
 * as each card filled in.
 *
 * The shared components now keep the content's shape while they load:
 *
 *   - a page's content area (Page, and every ModelPage through it) draws
 *     PageSkeleton, a card in the card's own frame;
 *   - a table draws TableSkeletonRows, a list ListSkeleton, a detail card
 *     DetailSkeleton;
 *   - a bar that is still drawn is the shared one: LOADER_COLOR, centred in
 *     LOADER_BOX_CLASS_NAME, a box as tall as an empty card, so a card that
 *     loads into "No X yet" keeps its height.
 *
 * This guard fails when one of those components goes back to a bar, when
 * any screen sets a 13rem (-52) margin or padding again, or when a loading
 * bar is drawn in a colour of its own. A bar for an action in progress (a
 * test being sent, a template being created) is not content loading: it is
 * drawn in the action's colour and listed below with its reason.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const COMPONENTS: string = "packages/Common/UI/Components";

function read(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

// The shared components that load content, and the skeleton each draws.
export const SKELETON_OF: Array<{ file: string; skeleton: string }> = [
  { file: `${COMPONENTS}/Page/Page.tsx`, skeleton: "<PageSkeleton" },
  { file: `${COMPONENTS}/Table/Table.tsx`, skeleton: "<TableSkeletonRows" },
  { file: `${COMPONENTS}/List/List.tsx`, skeleton: "<ListSkeleton" },
  {
    file: `${COMPONENTS}/ModelDetail/ModelDetail.tsx`,
    skeleton: "<DetailSkeleton",
  },
];

/*
 * Bars that show an action in progress rather than content loading, each
 * drawn in the action's colour, with the reason.
 */
export const ACTION_PROGRESS_BARS: Record<string, string> = {
  "packages/Common/UI/Components/AI/TestLlmProviderModal.tsx":
    "A test message being sent to the provider, in the dialog's action colour.",
  "packages/App/FeatureSet/Dashboard/src/Components/ExternalMcpServer/TestExternalMcpServerModal.tsx":
    "A test call being made to the server, in the dialog's action colour.",
  "packages/App/FeatureSet/Dashboard/src/Components/TemplatePicker/TemplatePicker.tsx":
    "The template the person picked being created, under its own button.",
};

// A 13rem margin or padding, at any breakpoint: mt-52, md:pb-52, py-52.
const THIRTEEN_REM_SPACING: RegExp =
  /(?:^|[\s"'`:])-?(?:m|p)[trblxy]?-52(?![\w-])/;

export function hasThirteenRemSpacing(source: string): boolean {
  return THIRTEEN_REM_SPACING.test(source);
}

// The colour each <Loader ...> in a source is drawn in ("" for the default).
export function listLoaderColors(source: string): Array<string> {
  const colors: Array<string> = [];
  const pattern: RegExp = /<Loader\b([^>]*)>/g;
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    const color: RegExpMatchArray | null = (match[1] as string).match(
      /\bcolor=\{([^}]*)\}/,
    );
    colors.push(color ? (color[1] as string).trim() : "");
    match = pattern.exec(source);
  }

  return colors;
}

describe("LoadingStatesGuard: the scans", () => {
  test("finds a 13rem margin or padding at any breakpoint", () => {
    expect(hasThirteenRemSpacing(`className="m-auto mt-52 flex"`)).toBe(true);
    expect(hasThirteenRemSpacing(`className="py-20 md:pt-52"`)).toBe(true);
    expect(hasThirteenRemSpacing('`flex ${x || "pt-52 pb-52"}`')).toBe(true);
    expect(hasThirteenRemSpacing(`className="h-52 w-52 mt-5"`)).toBe(false);
    expect(hasThirteenRemSpacing(`className="mt-520"`)).toBe(false);
  });

  test("reads each loader's colour", () => {
    expect(
      listLoaderColors(
        `<Loader loaderType={LoaderType.Bar} color={LOADER_COLOR} size={200} />
         <Loader loaderType={LoaderType.Bar} size={180} />
         <Loader color={Slate500} />`,
      ),
    ).toEqual(["LOADER_COLOR", "", "Slate500"]);
  });
});

describe("LoadingStatesGuard: the shared components", () => {
  test.each(SKELETON_OF)(
    "$file draws $skeleton while it loads",
    ({ file, skeleton }: { file: string; skeleton: string }) => {
      expect(read(file)).toContain(skeleton);
    },
  );

  test("a page's content area never draws the bar", () => {
    expect(read(`${COMPONENTS}/Page/Page.tsx`)).not.toContain("PageLoader");
  });

  test("every shared loader draws the shared colour in the shared box", () => {
    for (const file of [
      `${COMPONENTS}/Loader/PageLoader.tsx`,
      `${COMPONENTS}/ComponentLoader/ComponentLoader.tsx`,
    ]) {
      const source: string = read(file);
      expect(source).toContain("LOADER_BOX_CLASS_NAME");
      expect(source).toContain("color={LOADER_COLOR}");
    }

    expect(read(`${COMPONENTS}/ComponentLoader/CompactLoader.tsx`)).toContain(
      "color={LOADER_COLOR}",
    );
    expect(read(`${COMPONENTS}/Loader/Loader.tsx`)).toContain(
      "color = LOADER_COLOR",
    );
  });
});

describe("LoadingStatesGuard: every screen", () => {
  const sources: Array<{ file: string; source: string }> = listScanRoots(
    REPOSITORY_ROOT,
  )
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .map((file: string): { file: string; source: string } => {
      return { file: relative(file), source: fs.readFileSync(file, "utf8") };
    });

  test("reads the screens", () => {
    expect(sources.length).toBeGreaterThan(1000);
  });

  test("no screen pushes its content 13rem down (the old loader's and empty state's -52)", () => {
    const offenders: Array<string> = sources
      .filter((entry: { file: string; source: string }): boolean => {
        return hasThirteenRemSpacing(entry.source);
      })
      .map((entry: { file: string; source: string }): string => {
        return entry.file;
      });

    expect(offenders).toEqual([]);
  });

  test("a loading bar is drawn in the shared colour", () => {
    const offenders: Array<string> = [];

    for (const entry of sources) {
      if (ACTION_PROGRESS_BARS[entry.file]) {
        continue;
      }

      for (const color of listLoaderColors(entry.source)) {
        if (color !== "" && color !== "LOADER_COLOR") {
          offenders.push(`${entry.file}: color={${color}}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("every bar listed as an action's progress is still drawn in a colour of its own", () => {
    for (const file of Object.keys(ACTION_PROGRESS_BARS)) {
      const colors: Array<string> = listLoaderColors(read(file));
      expect(
        colors.some((color: string): boolean => {
          return color !== "" && color !== "LOADER_COLOR";
        }),
      ).toBe(true);
    }
  });
});
