import {
  getResourceGridClassNames,
  getResourceGridMatrixWidthInRem,
  RESOURCE_GRID_TILES_CLASS_NAME,
  ResourceGridClassNames,
} from "../../../../UI/Components/StatusPage/ResourceGridLayout";
import {
  addClassNames,
  EmittedRule,
  declarationsOf,
  loadPlayCdn,
  unloadPlayCdn,
} from "../../../Helpers/TailwindPlayCdn";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE RESOURCES GRID'S TILES, AS THE DASHBOARD'S OWN TAILWIND WRITES THEM
 * (#7430).
 *
 * The Dashboard is styled by the Play CDN build of Tailwind its index.ejs
 * loads, followed by the reading-direction config, with the Dashboard's own
 * `tailwind.config` (class-based dark mode). The editor's stack draws each
 * row as a grid of its cells' tiles under a container query: an arbitrary
 * grid-cols-[repeat(auto-fill,...)] class and a negative logical margin
 * under an arbitrary variant, either of which this Tailwind could read as
 * nothing. So the runtime runs here, in jsdom, as the Dashboard runs it,
 * and these read the CSS it writes. Laid out and measured in Chromium:
 * packages/E2E/StatusPageTelemetryGuidedSetups/StatusPageResourcesGrid.spec.ts.
 */

// The Dashboard's config, as its index.ejs writes it.
const DASHBOARD_CONFIG: Record<string, unknown> = {
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
};

const COLUMN_COUNTS: Array<number> = [1, 3, 4];

let rules: Array<EmittedRule> = [];

// Every class string a grid of this many columns draws.
const classNamesOf: (columnCount: number) => Array<string> = (
  columnCount: number,
): Array<string> => {
  const layout: ResourceGridClassNames = getResourceGridClassNames(columnCount);

  return [
    layout.grid,
    layout.table,
    layout.head,
    layout.body,
    layout.row,
    layout.rowHeading,
    layout.cell,
    layout.cellLabel,
  ];
};

const BACKSLASH: string = String.fromCharCode(92);

const HEX_DIGITS: string = "0123456789abcdefABCDEF";

// A selector as written, with Tailwind's escapes taken out.
const unescaped: (selector: string) => string = (selector: string): string => {
  let result: string = "";
  let index: number = 0;

  while (index < selector.length) {
    const character: string = selector[index]!;

    if (character !== BACKSLASH) {
      result += character;
      index += 1;
      continue;
    }

    let hex: string = "";

    while (
      hex.length < 6 &&
      index + 1 + hex.length < selector.length &&
      HEX_DIGITS.includes(selector[index + 1 + hex.length]!)
    ) {
      hex += selector[index + 1 + hex.length]!;
    }

    if (hex.length === 0) {
      result += selector[index + 1] || "";
      index += 2;
      continue;
    }

    result += String.fromCodePoint(parseInt(hex, 16));
    index += 1 + hex.length;

    if (selector[index] === " ") {
      index += 1;
    }
  }

  return result;
};

// The one rule written for a class, and what it declares.
const onlyRuleFor: (className: string) => {
  rule: EmittedRule;
  declarations: Record<string, string>;
} = (
  className: string,
): { rule: EmittedRule; declarations: Record<string, string> } => {
  const found: Array<EmittedRule> = rules.filter(
    (rule: EmittedRule): boolean => {
      return unescaped(rule.selector) === `.${className}`;
    },
  );

  expect(`${className}: ${found.length} rule(s)`).toBe(
    `${className}: 1 rule(s)`,
  );

  return { rule: found[0]!, declarations: declarationsOf(found[0]!) };
};

// The container query a rule is written under.
const queryOf: (rule: EmittedRule) => string = (rule: EmittedRule): string => {
  return rule.atRules
    .filter((atRule: string): boolean => {
      return atRule.startsWith("@container");
    })
    .join(" ")
    .split(" ")
    .join("");
};

/*
 * jsdom's own stylesheet reader does not know @container, and says so on
 * console.error each time the runtime writes its sheet; the sheet's text,
 * which these read, is whole. Only that one complaint is kept quiet.
 */
let consoleError: ReturnType<typeof jest.spyOn> | null = null;

beforeAll(async () => {
  // eslint-disable-next-line no-console
  const originalError: typeof console.error = console.error;

  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((...args: Array<unknown>): void => {
      const first: unknown = args[0];
      const isContainerQueryParseError: boolean =
        first instanceof Error &&
        first.message === "Could not parse CSS stylesheet" &&
        String((first as Error & { detail?: unknown }).detail || "").includes(
          "@container",
        );

      if (!isContainerQueryParseError) {
        originalError(...args);
      }
    });

  await loadPlayCdn({
    withReadingDirection: true,
    config: DASHBOARD_CONFIG,
  });

  rules = await addClassNames(
    COLUMN_COUNTS.flatMap((columnCount: number): Array<string> => {
      return classNamesOf(columnCount);
    }),
  );
}, 60000);

afterAll(() => {
  unloadPlayCdn();
  consoleError?.mockRestore();
});

describe("the Resources grid's stack of tiles in the Dashboard's own Tailwind (#7430)", () => {
  test.each(COLUMN_COUNTS)(
    "a %s-column grid: each row a grid of 17rem tiles under its value, ruled off at their start, under the grid's own query",
    (columnCount: number) => {
      const width: number = getResourceGridMatrixWidthInRem(columnCount);
      const stack: string = `[@container(max-width:${width}rem)]:`;
      const stackQuery: string = `@container(max-width:${width}rem)`;

      const expectations: Array<{
        className: string;
        declarations: Record<string, string>;
      }> = [
        // Each row, a grid of its cells' tiles, as many to a line as fit.
        { className: `${stack}grid`, declarations: { display: "grid" } },
        {
          className: `${stack}${RESOURCE_GRID_TILES_CLASS_NAME}`,
          declarations: {
            "grid-template-columns":
              "repeat(auto-fill,minmax(min(100%,17rem),1fr))",
          },
        },
        // Its box clips the first tile's start rule to its rounded corners.
        {
          className: `${stack}overflow-hidden`,
          declarations: { overflow: "hidden" },
        },
        // Its value across every column of tiles.
        {
          className: `${stack}col-span-full`,
          declarations: { "grid-column": "1 / -1" },
        },
        // Each tile ruled off at its start, a pixel before its place.
        {
          className: `${stack}-ms-px`,
          declarations: { "margin-inline-start": "-1px" },
        },
        {
          className: `${stack}border-s`,
          declarations: { "border-inline-start-width": "1px" },
        },
        // And above, from the row's value or the line of tiles before.
        {
          className: `${stack}border-t`,
          declarations: { "border-top-width": "1px" },
        },
        {
          className: `${stack}border-b-0`,
          declarations: { "border-bottom-width": "0px" },
        },
      ];

      for (const expected of expectations) {
        const written: {
          rule: EmittedRule;
          declarations: Record<string, string>;
        } = onlyRuleFor(expected.className);

        expect(`${expected.className}: ${queryOf(written.rule)}`).toBe(
          `${expected.className}: ${stackQuery}`,
        );
        expect(written.declarations).toEqual(
          expect.objectContaining(expected.declarations),
        );
      }
    },
  );

  test("every class of a three-column grid draws something: none is a class this Tailwind does not know", () => {
    const unknown: Array<string> = [];

    for (const className of classNamesOf(3)) {
      for (const token of className.split(" ").filter(Boolean)) {
        const found: number = rules.filter((rule: EmittedRule): boolean => {
          return unescaped(rule.selector).startsWith(`.${token}`);
        }).length;

        if (found === 0) {
          unknown.push(token);
        }
      }
    }

    expect(unknown).toEqual([]);
  });
});
