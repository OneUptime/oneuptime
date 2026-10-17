import { describe, expect, test } from "@jest/globals";
import {
  TABLE_ACTIONS_CONTENT_CLASS_NAME,
  TABLE_BODY_CELL_CLASS_NAME,
  TABLE_CELL_CONTENT_ALIGN_CLASS_NAME,
  TABLE_CELL_EDGE_PADDING_LEFT_CLASS_NAME,
  TABLE_CELL_EDGE_PADDING_RIGHT_CLASS_NAME,
  TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES,
  TABLE_CELL_INNER_PADDING_LEFT_CLASS_NAME,
  TABLE_CELL_INNER_PADDING_RIGHT_CLASS_NAME,
  TABLE_CELL_MAX_WIDTH_CLASS_NAME,
  TABLE_CELL_TEXT_CLASS_NAME,
  TABLE_CELL_TRUNCATE_CLASS_NAMES,
  TABLE_CLASS_NAME,
  TABLE_CLICKABLE_ROW_CLASS_NAME,
  TABLE_DRAG_HANDLE_CELL_CLASS_NAME,
  TABLE_HEADER_CELL_CLASS_NAME,
  TABLE_HEADER_CONTENT_CLASS_NAME,
  TABLE_HEADER_SELECT_CELL_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
  TABLE_MOBILE_FIELD_CLASS_NAME,
  TABLE_MOBILE_FIELD_NAME_CLASS_NAME,
  TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
  TABLE_MOBILE_ROW_CLASS_NAME,
  TABLE_PRIMARY_CELL_TEXT_CLASS_NAME,
  TABLE_ROW_CLASS_NAME,
  TABLE_ROW_RULE_CLASS_NAME,
  TABLE_SELECT_CELL_CLASS_NAME,
  TABLE_SELECTED_ROW_CLASS_NAME,
  TABLE_SORT_ARROW_CLASS_NAME,
  TABLE_SORT_BUTTON_CLASS_NAME,
  TABLE_SORT_HINT_CLASS_NAME,
  TABLE_SORTED_COLUMN_CLASS_NAME,
  TABLE_STICKY_END_BODY_CELL_CLASS_NAME,
  TABLE_STICKY_END_HEADER_CELL_CLASS_NAME,
  TABLE_STICKY_HEADER_CELL_CLASS_NAME,
  TABLE_STICKY_HEADER_TOP_CLASS_NAME,
  TABLE_STUCK_END_CELL_CLASS_NAME,
  TABLE_UNSORTED_COLUMN_CLASS_NAME,
  TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME,
  TableCellPosition,
  getTableCellPaddingClassName,
  hasMaxWidthClassName,
  hasMinWidthClassName,
} from "../../../../UI/Components/Table/TableLayout";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";

/*
 * The table's look, held class by class (Common/UI/Components/Table/
 * TableLayout.ts). Every table in the product draws with these strings, so
 * each rule the redesign set out - a quiet one-line header, rows in the
 * reading size on a 24px line, a hairline between rows, 24px between columns
 * and at the row's ends, a value cut short only with an ellipsis, the
 * Actions column in sight - is pinned here, where a change to one of them
 * fails by name.
 */

type TokensFunction = (className: string) => Array<string>;

const tokens: TokensFunction = (className: string): Array<string> => {
  return className.split(" ").filter((token: string): boolean => {
    return token.length > 0;
  });
};

// The utility a token applies, after its variants.
type UtilityFunction = (token: string) => string;

const utilityOf: UtilityFunction = (token: string): string => {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let index: number = 0; index < token.length; index++) {
    const character: string = token.charAt(index);

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === ":" && depth === 0) {
      lastColon = index;
    }
  }

  return token.slice(lastColon + 1);
};

/*
 * Utilities of one kind written twice on one element: which one wins is the
 * stylesheet's order, not the order they are written in. Plain (unprefixed)
 * tokens only - a hover: colour beside a resting one is the point of it.
 */
type ConflictsFunction = (
  className: string,
  prefixes: Array<string>,
) => Array<string>;

const conflictsOf: ConflictsFunction = (
  className: string,
  prefixes: Array<string>,
): Array<string> => {
  const plain: Array<string> = tokens(className).filter(
    (token: string): boolean => {
      return utilityOf(token) === token;
    },
  );

  return prefixes.filter((prefix: string): boolean => {
    return (
      plain.filter((token: string): boolean => {
        return token.startsWith(prefix);
      }).length > 1
    );
  });
};

const TEXT_COLOUR_PREFIXES: Array<string> = ["text-gray-", "text-indigo-"];

describe("the table and its rules", () => {
  test("separate borders, so a sticky cell's rule moves with it", () => {
    expect(tokens(TABLE_CLASS_NAME)).toEqual([
      "min-w-full",
      "border-separate",
      "border-spacing-0",
    ]);
  });

  test("the hairline between rows is the detail card's: border-gray-100, under the row", () => {
    expect(tokens(TABLE_ROW_RULE_CLASS_NAME)).toEqual([
      "border-b",
      "border-gray-100",
    ]);
  });
});

describe("a cell's padding", () => {
  const CASES: Array<[string, TableCellPosition, string]> = [
    ["first", { isFirst: true, isLast: false }, "pl-6 pr-3"],
    ["middle", { isFirst: false, isLast: false }, "pl-3 pr-3"],
    ["last", { isFirst: false, isLast: true }, "pl-3 pr-6"],
    ["only", { isFirst: true, isLast: true }, "pl-6 pr-6"],
  ];

  test.each(CASES)(
    "the %s cell of a row",
    (_label: string, position: TableCellPosition, expected: string) => {
      expect(getTableCellPaddingClassName(position)).toBe(expected);
    },
  );

  test("the row's ends line up with the card's text (24px), and two columns sit 24px apart (12px + 12px)", () => {
    expect(TABLE_CELL_EDGE_PADDING_LEFT_CLASS_NAME).toBe("pl-6");
    expect(TABLE_CELL_EDGE_PADDING_RIGHT_CLASS_NAME).toBe("pr-6");
    expect(TABLE_CELL_INNER_PADDING_LEFT_CLASS_NAME).toBe("pl-3");
    expect(TABLE_CELL_INNER_PADDING_RIGHT_CLASS_NAME).toBe("pr-3");
  });
});

describe("the header row", () => {
  test("a quiet band: the names small, grey and medium, never shouting", () => {
    const headerTokens: Array<string> = tokens(TABLE_HEADER_CELL_CLASS_NAME);

    expect(headerTokens).toEqual(
      expect.arrayContaining([
        "border-y",
        "border-gray-200",
        "bg-gray-50",
        "text-xs",
        "font-medium",
        "text-gray-500",
        "text-left",
      ]),
    );

    for (const loud of [
      "uppercase",
      "tracking-wide",
      "tracking-wider",
      "font-semibold",
      "font-bold",
      "text-gray-900",
      "text-sm",
    ]) {
      expect([loud, headerTokens.includes(loud)]).toEqual([loud, false]);
    }
  });

  test("a column's name never breaks over two lines ('Incident Number')", () => {
    expect(tokens(TABLE_HEADER_CONTENT_CLASS_NAME)).toEqual(
      expect.arrayContaining(["whitespace-nowrap", "flex", "w-full", "py-2.5"]),
    );
  });

  test("the select-all box sits on the band's 36px line", () => {
    expect(tokens(TABLE_HEADER_SELECT_CELL_CLASS_NAME)).toEqual(
      expect.arrayContaining(["py-1.5", "w-px", "whitespace-nowrap"]),
    );
  });

  test("the header sticks under the page's top bar, read from MasterPage's --app-header-height", () => {
    expect(TABLE_STICKY_HEADER_TOP_CLASS_NAME).toBe(
      "top-[var(--app-header-height,0px)]",
    );
    expect(tokens(TABLE_STICKY_HEADER_CELL_CLASS_NAME)).toEqual([
      "sticky",
      "top-[var(--app-header-height,0px)]",
      "z-[2]",
    ]);
  });

  test("the sort button's colours never fight: sorted is gray-900, unsorted grey until pointed at", () => {
    expect(
      conflictsOf(
        `${TABLE_SORT_BUTTON_CLASS_NAME} ${TABLE_SORTED_COLUMN_CLASS_NAME}`,
        TEXT_COLOUR_PREFIXES,
      ),
    ).toEqual([]);
    expect(
      conflictsOf(
        `${TABLE_SORT_BUTTON_CLASS_NAME} ${TABLE_UNSORTED_COLUMN_CLASS_NAME}`,
        TEXT_COLOUR_PREFIXES,
      ),
    ).toEqual([]);
    expect(tokens(TABLE_SORTED_COLUMN_CLASS_NAME)).toEqual(["text-gray-900"]);
    expect(tokens(TABLE_UNSORTED_COLUMN_CLASS_NAME)).toEqual([
      "text-gray-500",
      "hover:text-gray-900",
    ]);
    // Keyboard focus is ringed inside the cell, so the band never clips it.
    expect(tokens(TABLE_SORT_BUTTON_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-inset",
        "group/sort",
      ]),
    );
  });

  test("the sorted column's arrow is small and in the reading colour; the hint only shows under the pointer or focus", () => {
    expect(tokens(TABLE_SORT_ARROW_CLASS_NAME)).toEqual(
      expect.arrayContaining(["h-3.5", "w-3.5", "flex-none"]),
    );
    expect(tokens(TABLE_SORT_HINT_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover/sort:opacity-100",
        "group-focus-visible/sort:opacity-100",
      ]),
    );
  });
});

describe("a row and its cells", () => {
  test("a row is white (so a sticky cell can take its colour) and lights up under the pointer", () => {
    expect(tokens(TABLE_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining(["bg-white", "hover:bg-gray-50"]),
    );
  });

  test("a ticked row keeps its wash and does not flash grey under the pointer", () => {
    const selected: Array<string> = tokens(TABLE_SELECTED_ROW_CLASS_NAME);

    expect(selected).toContain("bg-indigo-50");
    expect(selected).not.toContain("hover:bg-gray-50");
    expect(selected).not.toContain("bg-white");
  });

  test("a row that opens its record takes the pointer's hand", () => {
    expect(TABLE_CLICKABLE_ROW_CLASS_NAME).toBe("cursor-pointer");
  });

  test("a value is in the reading size on a 24px line, from the row's top", () => {
    expect(tokens(TABLE_BODY_CELL_CLASS_NAME)).toEqual([
      "py-3",
      "align-top",
      "text-sm",
      "leading-6",
    ]);
  });

  test("a value's words are regular gray-700; the row's name is medium gray-900; neither fights the other", () => {
    expect(tokens(TABLE_CELL_TEXT_CLASS_NAME)).toEqual([
      "font-normal",
      "text-gray-700",
    ]);
    expect(tokens(TABLE_PRIMARY_CELL_TEXT_CLASS_NAME)).toEqual([
      "font-medium",
      "text-gray-900",
    ]);
    expect(
      conflictsOf(
        `${TABLE_BODY_CELL_CLASS_NAME} ${TABLE_CELL_TEXT_CLASS_NAME}`,
        [...TEXT_COLOUR_PREFIXES, "font-"],
      ),
    ).toEqual([]);
    expect(
      conflictsOf(
        `${TABLE_BODY_CELL_CLASS_NAME} ${TABLE_PRIMARY_CELL_TEXT_CLASS_NAME}`,
        [...TEXT_COLOUR_PREFIXES, "font-"],
      ),
    ).toEqual([]);
    // The old cells' medium gray-500 is gone.
    expect(TABLE_CELL_TEXT_CLASS_NAME).not.toContain("text-gray-500");
  });

  test("a row of one line is 48px: 12px above and below the 24px line", () => {
    expect(TABLE_BODY_CELL_CLASS_NAME).toContain("py-3");
    expect(TABLE_BODY_CELL_CLASS_NAME).toContain("leading-6");
    // The 28px grip: 10px above and below.
    expect(tokens(TABLE_DRAG_HANDLE_CELL_CLASS_NAME)).toContain("py-2.5");
    // The select box on the row's 24px line.
    expect(tokens(TABLE_SELECT_CELL_CLASS_NAME)).toContain("py-3");
    // The 30px buttons centred on the 24px line.
    expect(tokens(TABLE_ACTIONS_CONTENT_CLASS_NAME)).toEqual([
      "-my-[3px]",
      "leading-none",
    ]);
  });
});

describe("a value too long for its column", () => {
  test("is capped at a fixed length (a percentage holds nothing back in a table)", () => {
    expect(TABLE_CELL_MAX_WIDTH_CLASS_NAME).toBe("max-w-[20rem]");
  });

  test("is cut short only together with the clip and the ellipsis (#3585)", () => {
    const truncate: Array<string> = tokens(TABLE_CELL_TRUNCATE_CLASS_NAMES);

    expect(truncate).toEqual(
      expect.arrayContaining(["overflow-x-clip", "text-ellipsis"]),
    );
    // A clip in one direction: a pill's ring and a focus ring still show.
    expect(truncate).not.toContain("overflow-hidden");
    expect(truncate).not.toContain("truncate");
  });

  test("a record's link is laid out as a line of text, matched on its exact class only", () => {
    expect(tokens(TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES)).toEqual([
      "[&_span[class=flex]]:inline",
      "[&_span[class=flex]>div]:inline-block",
      "[&_span[class=flex]>div]:align-middle",
    ]);
    expect(TABLE_CELL_TRUNCATE_CLASS_NAMES).toContain(
      TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES,
    );
  });

  test("an item of a list in a cell keeps to its line, with the same link layout", () => {
    expect(tokens(TABLE_LIST_ITEM_CLASS_NAME)).toEqual([
      "truncate",
      ...tokens(TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES),
    ]);
  });

  test("what a cell holds sits at the top of its line, and a column of prose is never squeezed below 10rem", () => {
    expect(TABLE_CELL_CONTENT_ALIGN_CLASS_NAME).toBe("[&>*]:align-top");
    expect(TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME).toBe("min-w-[10rem]");
  });
});

describe("hasMaxWidthClassName", () => {
  const CASES: Array<[string | undefined, boolean]> = [
    [undefined, false],
    ["", false],
    ["text-sm text-gray-900", false],
    ["min-w-[12rem]", false],
    ["max-w-xs", true],
    ["max-w-[10rem] 2xl:max-w-[18rem]", true],
    ["text-xs 2xl:max-w-[18rem]", true],
    ["[&>div]:max-w-sm", true],
    ["maximum", false],
  ];

  test.each(CASES)(
    "%p names a cap: %p",
    (value: string | undefined, expected: boolean) => {
      expect(hasMaxWidthClassName(value)).toBe(expected);
    },
  );
});

describe("hasMinWidthClassName", () => {
  const CASES: Array<[string | undefined, boolean]> = [
    [undefined, false],
    ["", false],
    ["text-sm text-gray-900", false],
    ["max-w-sm", false],
    ["min-w-[12rem]", true],
    ["max-w-sm min-w-[12rem]", true],
    ["md:min-w-0", true],
    ["[&>div]:min-w-0", true],
    ["minimum", false],
  ];

  test.each(CASES)(
    "%p names a floor: %p",
    (value: string | undefined, expected: boolean) => {
      expect(hasMinWidthClassName(value)).toBe(expected);
    },
  );
});

describe("the Actions column", () => {
  test("its cells stick at the table's right edge, as opaque as their row", () => {
    expect(tokens(TABLE_STICKY_END_BODY_CELL_CLASS_NAME)).toEqual([
      "sticky",
      "right-0",
      "z-[1]",
      "bg-inherit",
    ]);
  });

  test("its header sticks above them", () => {
    expect(tokens(TABLE_STICKY_END_HEADER_CELL_CLASS_NAME)).toEqual([
      "sticky",
      "right-0",
      "z-[3]",
    ]);
  });

  test("ruled off and shadowed from the cells passing under it, while the rows scroll", () => {
    const stuck: Array<string> = tokens(TABLE_STUCK_END_CELL_CLASS_NAME);

    expect(stuck).toEqual(
      expect.arrayContaining(["border-l", "border-gray-200"]),
    );
    expect(
      stuck.some((token: string): boolean => {
        return token.startsWith("shadow-[");
      }),
    ).toBe(true);
  });
});

describe("a row on a phone", () => {
  test("a field whose value is only the quiet dash is left out, whoever drew the dash", () => {
    expect(tokens(TABLE_MOBILE_FIELD_CLASS_NAME)).toEqual([
      "flex",
      "flex-col",
      "[&:has(>dd>[data-testid=table-empty-value]:only-child)]:hidden",
    ]);
    // The mark it looks for is the one TableEmptyValue draws.
    expect(TABLE_MOBILE_FIELD_CLASS_NAME).toContain(
      `[data-testid=${TABLE_EMPTY_VALUE_TEST_ID}]`,
    );
  });

  test("is a card of names over values, as a detail card writes its fields", () => {
    expect(tokens(TABLE_MOBILE_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining(["bg-white", "px-4", "py-4"]),
    );
    expect(tokens(TABLE_MOBILE_FIELD_NAME_CLASS_NAME)).toEqual([
      "text-xs",
      "font-medium",
      "text-gray-500",
    ]);
    expect(tokens(TABLE_MOBILE_FIELD_VALUE_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "text-sm",
        "leading-6",
        "text-gray-900",
        "break-words",
        "min-w-0",
      ]),
    );
  });
});
