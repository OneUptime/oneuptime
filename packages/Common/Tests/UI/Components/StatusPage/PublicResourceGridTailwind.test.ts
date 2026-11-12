import {
  getPublicResourceGridClassNames,
  getPublicResourceGridMatrixWidthInRem,
  PUBLIC_RESOURCE_GRID_COLUMN_AXIS_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME,
  PublicResourceGridClassNames,
} from "../../../../UI/Components/StatusPage/PublicResourceGridLayout";
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
 * THE PUBLIC GRID'S CLASSES, AS THE STATUS PAGE'S OWN TAILWIND WRITES THEM
 * (#7238).
 *
 * The public status page is its own app, styled by the Play CDN build of
 * Tailwind its index.ejs loads (Common/Server/Static/Vendor/tailwind),
 * followed by the reading-direction config, with the page's own
 * `tailwind.config`. A class Tailwind does not know draws nothing, and an
 * arbitrary variant it reads differently draws something else: so the
 * runtime itself runs here, in jsdom, as the page runs it, and these read
 * the CSS it writes for the grid's classes - the container the query
 * measures, the stack's and the matrix's rules under their container
 * queries, and the rows' values held at the start of the line.
 */

// The status page's config, as its index.ejs writes it.
const STATUS_PAGE_CONFIG: Record<string, unknown> = {
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
      keyframes: {
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-0.5rem)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "slide-down": "slide-down 200ms ease-out",
      },
    },
  },
};

const COLUMN_COUNTS: Array<number> = [1, 3, 5];

let rules: Array<EmittedRule> = [];

const layoutOf: (columnCount: number) => PublicResourceGridClassNames = (
  columnCount: number,
): PublicResourceGridClassNames => {
  return getPublicResourceGridClassNames(columnCount);
};

// Every class string a grid of this many columns draws.
const classNamesOf: (columnCount: number) => Array<string> = (
  columnCount: number,
): Array<string> => {
  const layout: PublicResourceGridClassNames = layoutOf(columnCount);

  return [
    layout.grid,
    layout.table,
    layout.head,
    layout.body,
    layout.row,
    layout.getRowHeading({ isLastRow: false }),
    layout.getRowHeading({ isLastRow: true }),
    layout.getCell({ isLastRow: false, isLastColumn: false, isEmpty: true }),
    layout.getCell({ isLastRow: true, isLastColumn: true, isEmpty: false }),
    layout.getColumnHeading({ isLastColumn: false }),
    layout.cellLabel,
    layout.cellStatus,
    layout.cellEmpty,
    PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME,
    PUBLIC_RESOURCE_GRID_COLUMN_AXIS_CLASS_NAME,
    PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME,
  ];
};

const BACKSLASH: string = String.fromCharCode(92);

const HEX_DIGITS: string = "0123456789abcdefABCDEF";

/*
 * A selector as written, with Tailwind's escapes taken out: "\(" is "(",
 * and a character written by its code ("\2c " for the comma in the tiles'
 * repeat(auto-fill,...)) is that character, its one space after it too.
 */
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

// The rules written for one class, with any pseudo-class after it.
const rulesFor: (data: {
  className: string;
  pseudo?: string | undefined;
}) => Array<EmittedRule> = (data: {
  className: string;
  pseudo?: string | undefined;
}): Array<EmittedRule> => {
  const wanted: string = `.${data.className}${data.pseudo || ""}`;

  return rules.filter((rule: EmittedRule): boolean => {
    return unescaped(rule.selector) === wanted;
  });
};

// The one rule written for a class, and what it declares.
const onlyRuleFor: (data: {
  className: string;
  pseudo?: string | undefined;
}) => { rule: EmittedRule; declarations: Record<string, string> } = (data: {
  className: string;
  pseudo?: string | undefined;
}): { rule: EmittedRule; declarations: Record<string, string> } => {
  const found: Array<EmittedRule> = rulesFor(data);

  expect(`${data.className}: ${found.length} rule(s)`).toBe(
    `${data.className}: 1 rule(s)`,
  );

  return { rule: found[0]!, declarations: declarationsOf(found[0]!) };
};

// The container query a stack's or a matrix's rule is written under.
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

const isContainerQueryParseError: (args: Array<unknown>) => boolean = (
  args: Array<unknown>,
): boolean => {
  const first: unknown = args[0];

  return (
    first instanceof Error &&
    first.message === "Could not parse CSS stylesheet" &&
    String((first as Error & { detail?: unknown }).detail || "").includes(
      "@container",
    )
  );
};

beforeAll(async () => {
  // Every other complaint still reaches the test's output.
  // eslint-disable-next-line no-console
  const originalError: typeof console.error = console.error;

  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((...args: Array<unknown>): void => {
      if (!isContainerQueryParseError(args)) {
        originalError(...args);
      }
    });

  await loadPlayCdn({
    withReadingDirection: true,
    config: STATUS_PAGE_CONFIG,
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

describe("the public grid in the status page's own Tailwind (#7238)", () => {
  test("the grid's box is a container its inline size is measured by", () => {
    expect(
      onlyRuleFor({ className: "[container-type:inline-size]" }).declarations,
    ).toEqual({ "container-type": "inline-size" });
  });

  test.each(COLUMN_COUNTS)(
    "a %s-column grid: the stack's rules are under a container query at the grid's own width, the matrix's under the same query negated",
    (columnCount: number) => {
      const width: number = getPublicResourceGridMatrixWidthInRem(columnCount);
      const stack: string = `[@container(max-width:${width}rem)]:`;
      const matrix: string = `[@container_not_(max-width:${width}rem)]:`;
      const stackQuery: string = `@container(max-width:${width}rem)`;
      const matrixQuery: string = `@containernot(max-width:${width}rem)`;

      const expectations: Array<{
        className: string;
        pseudo?: string;
        query: string;
        declarations: Record<string, string>;
      }> = [
        // The table, its head and body, each row: a stack of blocks.
        {
          className: `${stack}block`,
          query: stackQuery,
          declarations: { display: "block" },
        },
        {
          className: `${stack}hidden`,
          query: stackQuery,
          declarations: { display: "none" },
        },
        // The row's value lets go of the start of the line.
        {
          className: `${stack}static`,
          query: stackQuery,
          declarations: { position: "static" },
        },
        /*
         * Each row, a grid of its cells' tiles - as many to a line as fit,
         * 16rem each, and one on a box narrower than that - under its
         * value, which spans them all.
         */
        {
          className: `${stack}grid`,
          query: stackQuery,
          declarations: { display: "grid" },
        },
        {
          className: `${stack}${PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME}`,
          query: stackQuery,
          declarations: {
            "grid-template-columns":
              "repeat(auto-fill,minmax(min(100%,16rem),1fr))",
          },
        },
        {
          className: `${stack}col-span-full`,
          query: stackQuery,
          declarations: { "grid-column": "1 / -1" },
        },
        /*
         * Each tile ruled off at its start, from the tile before it; the
         * row starts a pixel before the box, so the first tile's rule is
         * clipped at the box's start, whichever side that is.
         */
        {
          className: `${stack}-ms-px`,
          query: stackQuery,
          declarations: { "margin-inline-start": "-1px" },
        },
        {
          className: `${stack}border-s`,
          query: stackQuery,
          declarations: { "border-inline-start-width": "1px" },
        },
        // Ruled off above, from the heading or the line of tiles before, never below.
        {
          className: `${stack}border-t`,
          query: stackQuery,
          declarations: { "border-top-width": "1px" },
        },
        {
          className: `${stack}border-b-0`,
          query: stackQuery,
          declarations: { "border-bottom-width": "0px" },
        },
        // Each cell, a tile: its column's name, then its status.
        {
          className: `${stack}flex`,
          query: stackQuery,
          declarations: { display: "flex" },
        },
        {
          className: `${stack}justify-between`,
          query: stackQuery,
          declarations: { "justify-content": "space-between" },
        },
        {
          className: `${stack}items-end`,
          query: stackQuery,
          declarations: { "align-items": "flex-end" },
        },
        {
          className: `${stack}text-start`,
          query: stackQuery,
          declarations: { "text-align": "start" },
        },
        // Ruled off at the end of the line no more, in either direction.
        {
          className: `${stack}border-e-0`,
          query: stackQuery,
          declarations: { "border-inline-end-width": "0px" },
        },
        // The last row is not ruled off from the card's edge.
        {
          className: `${stack}last:border-b-0`,
          pseudo: ":last-child",
          query: stackQuery,
          declarations: { "border-bottom-width": "0px" },
        },
        // The cell's column name, not drawn in the matrix.
        {
          className: `${matrix}hidden`,
          query: matrixQuery,
          declarations: { display: "none" },
        },
      ];

      for (const expected of expectations) {
        const written: {
          rule: EmittedRule;
          declarations: Record<string, string>;
        } = onlyRuleFor({
          className: expected.className,
          pseudo: expected.pseudo,
        });

        expect(`${expected.className}: ${queryOf(written.rule)}`).toBe(
          `${expected.className}: ${expected.query}`,
        );
        expect(written.declarations).toEqual(
          expect.objectContaining(expected.declarations),
        );
      }
    },
  );

  test("each grid's query is its own: a one-column grid's never answers for a five-column one's", () => {
    const queries: Set<string> = new Set(
      rules
        .filter((rule: EmittedRule): boolean => {
          return unescaped(rule.selector).includes("@container");
        })
        .map(queryOf),
    );

    expect(Array.from(queries).sort()).toEqual(
      [
        "@container(max-width:18.75rem)",
        "@container(max-width:36.25rem)",
        "@container(max-width:53.75rem)",
        "@containernot(max-width:18.75rem)",
        "@containernot(max-width:36.25rem)",
        "@containernot(max-width:53.75rem)",
      ].sort(),
    );
  });

  test("every class of the grid draws something: none is a class this Tailwind does not know", () => {
    const unknown: Array<string> = [];

    for (const className of classNamesOf(3)) {
      for (const token of className.split(" ").filter(Boolean)) {
        const pseudo: string | undefined = token.includes("last:")
          ? ":last-child"
          : undefined;

        if (token.includes("group-hover:")) {
          // Written as .group:hover .group-hover\:x, not as the class alone.
          if (
            !rules.some((rule: EmittedRule): boolean => {
              return unescaped(rule.selector).endsWith(`.${token}`);
            })
          ) {
            unknown.push(token);
          }

          continue;
        }

        if (rulesFor({ className: token, pseudo: pseudo }).length === 0) {
          unknown.push(token);
        }
      }
    }

    // The row's hover group names no rule of its own.
    expect(unknown).toEqual(["group"]);
  });

  test("the rows' values, the row axis's name and the corner are held at the line's start and ruled off at its end, whichever side that is", () => {
    expect(onlyRuleFor({ className: "sticky" }).declarations).toEqual({
      position: "sticky",
    });
    expect(onlyRuleFor({ className: "start-0" }).declarations).toEqual({
      "inset-inline-start": "0px",
    });
    expect(onlyRuleFor({ className: "border-e" }).declarations).toEqual(
      expect.objectContaining({ "border-inline-end-width": "1px" }),
    );
    expect(onlyRuleFor({ className: "text-start" }).declarations).toEqual({
      "text-align": "start",
    });
  });
});
