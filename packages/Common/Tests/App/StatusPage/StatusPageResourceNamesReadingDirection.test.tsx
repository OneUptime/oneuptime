import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A RESOURCE'S NAME IN STATUS PAGE > RESOURCES, ON AN ARABIC OR PERSIAN
 * PAGE (#6864).
 *
 * Each row of a group's list (ResourceList) and each chip of its grid
 * (ResourceGrid) names its resource by its monitor's or monitor group's
 * link, which the Dashboard hands in (StatusPageResourcePanel's
 * getResourceElement, drawn by StatusPageResourceName). With monitor
 * groups off, the link draws its bare name, <span class="flex"> name
 * </span>, which the row's box lays out as a block that truncates - a line
 * of the page's. So on a Persian page an English name too long for its
 * column was cut at its start: "...ilization on AllNodesInEuWest1". The
 * grid's chip drew the same span in a box that truncates, which a flex
 * span never lets reach its text: a long name was clipped mid-letter, with
 * no "..." at all.
 *
 * Now the bare name is a line of its own that reads the way it is written
 * (IsolatedLine): its block takes the line's dir and its alignment, so an
 * English name ends in "..." at its own end and a short one still starts
 * where the page's lines do. The grid's chip lays the bare span out as a
 * block that truncates, as the list does, and its rule reaches nothing in
 * the row an icon draws when monitor groups are on.
 *
 * jsdom lays nothing out: these read each box's dir and classes, and which
 * boxes the name's descendant rules reach.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
        dir?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            dir: props.dir,
          },
          props.children,
        );
      },
    };
  },
);

import ResourceList, {
  RESOURCE_ROW_NAME_CLASS_NAME,
} from "../../../UI/Components/StatusPage/ResourceList";
import ResourceGrid, {
  RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME,
  RESOURCE_GRID_ORPHAN_AXIS_CLASS_NAME,
} from "../../../UI/Components/StatusPage/ResourceGrid";
import { isWrappingLineClassName } from "../../../UI/Components/IsolatedText/IsolatedLine";
import {
  RESOURCE_BARE_NAME_CLASS_NAME,
  RESOURCE_CHIP_NAME_CLASS_NAME,
  RESOURCE_CHIP_TEXT_CLASS_NAME,
} from "../../../UI/Components/StatusPage/ResourceNameClassNames";
import StatusPageResourceName, {
  STATUS_PAGE_RESOURCE_NAME_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourceName";
import {
  RECORD_LINK_NAME_ROW_CLASS_NAME,
  RECORD_LINK_NAME_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/RecordLink/RecordLinkName";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { PROJECT_ID, goTo } from "../Dashboard/SideMenuHarness";

const ENGLISH_MONITOR: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1";
const ARABIC_MONITOR: string = "استخدام الذاكرة المرتفع على كل العقد";
const ENGLISH_GROUP: string = "Checkout and payments (all regions)";
const ENGLISH_PUBLISHED: string = "Memory (EU West, all nodes)";
const ARABIC_PUBLISHED: string = "الذاكرة في غرب أوروبا";

const UNKNOWN_RESOURCE: Record<string, string> = {
  ar: "مورد غير معروف",
  fa: "منبع ناشناس",
};

const LIST_ROW_NAME_TEST_ID: string = "status-page-resource-row-name";
const LIST_DISPLAY_NAME_TEST_ID: string =
  "status-page-resource-row-display-name";
const GRID_NAME_TEST_ID: string = "status-page-resource-grid-name";
const GRID_DISPLAY_NAME_TEST_ID: string =
  "status-page-resource-grid-display-name";
const GRID_ORPHAN_NAME_TEST_ID: string =
  "status-page-resource-grid-orphan-name";
const GRID_CHIP_TEST_ID: string = "status-page-resource-grid-cell-item";
const GRID_CHIP_TEXT_TEST_ID: string = "status-page-resource-grid-chip-text";

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: { translation: { "Unknown resource": UNKNOWN_RESOURCE["ar"]! } },
        fa: { translation: { "Unknown resource": UNKNOWN_RESOURCE["fa"]! } },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  // Route population reads the project id from the current URL.
  goTo(`/dashboard/${PROJECT_ID}/status-pages`);
});

afterEach(() => {
  cleanup();
});

let nextId: number = 1;

const makeId: () => string = (): string => {
  const id: string = String(nextId++).padStart(12, "0");
  return `0193c0de-6864-4aaa-8bbb-${id}`;
};

const monitorResource: (data: {
  name: string;
  displayName?: string | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}) => StatusPageResource = (data: {
  name: string;
  displayName?: string | undefined;
  rowAxisValue?: string | undefined;
  columnAxisValue?: string | undefined;
}): StatusPageResource => {
  const monitor: Monitor = new Monitor();
  monitor._id = makeId();
  monitor.name = data.name;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = makeId();
  resource.monitor = monitor;

  if (data.displayName) {
    resource.displayName = data.displayName;
  }

  if (data.rowAxisValue) {
    resource.rowAxisValue = data.rowAxisValue;
  }

  if (data.columnAxisValue) {
    resource.columnAxisValue = data.columnAxisValue;
  }

  return resource;
};

const groupResource: (name: string) => StatusPageResource = (
  name: string,
): StatusPageResource => {
  const group: MonitorGroup = new MonitorGroup();
  group._id = makeId();
  group.name = name;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = makeId();
  resource.monitorGroup = group;

  return resource;
};

// A resource whose monitor was deleted: its display name, or nothing.
const strandedResource: (displayName?: string) => StatusPageResource = (
  displayName?: string,
): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = makeId();

  if (displayName) {
    resource.displayName = displayName;
  }

  return resource;
};

// As Status Page > Resources draws a resource (StatusPageResourcePanel).
const resourceElementFor: (
  isMonitorGroupsFeatureEnabled: boolean,
) => (statusPageResource: StatusPageResource) => ReactElement = (
  isMonitorGroupsFeatureEnabled: boolean,
): ((statusPageResource: StatusPageResource) => ReactElement) => {
  const getResourceElement: (
    statusPageResource: StatusPageResource,
  ) => ReactElement = (
    statusPageResource: StatusPageResource,
  ): ReactElement => {
    return (
      <StatusPageResourceName
        statusPageResource={statusPageResource}
        showIcon={isMonitorGroupsFeatureEnabled}
      />
    );
  };

  return getResourceElement;
};

const drawList: (data: {
  language: string;
  resources: Array<StatusPageResource>;
  isMonitorGroupsFeatureEnabled?: boolean | undefined;
}) => void = (data: {
  language: string;
  resources: Array<StatusPageResource>;
  isMonitorGroupsFeatureEnabled?: boolean | undefined;
}): void => {
  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <ResourceList
        statusPageResources={data.resources}
        listKey="names"
        getResourceElement={resourceElementFor(
          Boolean(data.isMonitorGroupsFeatureEnabled),
        )}
        isEditable={true}
        isDeleteable={true}
        isReorderable={false}
        isSelectable={true}
        selectedResourceIds={new Set<string>()}
        isAllSelected={false}
        isSelectionIndeterminate={false}
        onToggleResourceSelected={() => {}}
        onToggleAllSelected={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onShowId={() => {}}
        onReorder={() => {}}
        visibleCount={100}
        onShowMore={() => {}}
        emptyState={<div>Nothing here</div>}
      />
    </I18nextProvider>,
  );
};

const drawGrid: (data: {
  language: string;
  resources: Array<StatusPageResource>;
  isMonitorGroupsFeatureEnabled?: boolean | undefined;
  rowLabel?: string | undefined;
  columnLabel?: string | undefined;
}) => void = (data: {
  language: string;
  resources: Array<StatusPageResource>;
  isMonitorGroupsFeatureEnabled?: boolean | undefined;
  rowLabel?: string | undefined;
  columnLabel?: string | undefined;
}): void => {
  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <ResourceGrid
        rowLabel={data.rowLabel || "Region"}
        columnLabel={data.columnLabel || "Service"}
        rowValues={["EU"]}
        columnValues={["API"]}
        statusPageResources={data.resources}
        getResourceElement={resourceElementFor(
          Boolean(data.isMonitorGroupsFeatureEnabled),
        )}
        isCreateable={true}
        isEditable={true}
        isDeleteable={true}
        isSelectable={true}
        selectedResourceIds={new Set<string>()}
        onToggleResourceSelected={() => {}}
        onAddToCell={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onShowId={() => {}}
      />
    </I18nextProvider>,
  );
};

// The box with this test id whose words are `text`.
const boxReading: (testId: string, text: string) => HTMLElement = (
  testId: string,
  text: string,
): HTMLElement => {
  const box: HTMLElement | undefined = screen
    .getAllByTestId(testId)
    .find((each: HTMLElement): boolean => {
      return each.textContent?.trim() === text;
    });

  if (!box) {
    throw new Error(`No ${testId} reads "${text}"`);
  }

  return box;
};

// The line a bare name is drawn on, inside its row's or chip's box.
const nameLineIn: (holder: HTMLElement) => HTMLElement = (
  holder: HTMLElement,
): HTMLElement => {
  return within(holder).getByTestId(STATUS_PAGE_RESOURCE_NAME_TEST_ID);
};

/*
 * The selectors a class's descendant variants reach ([&_span]:block
 * reaches "span"), and what each applies. Tailwind writes a space as "_".
 */
interface DescendantRule {
  selector: string;
  utility: string;
}

const descendantRulesOf: (className: string) => Array<DescendantRule> = (
  className: string,
): Array<DescendantRule> => {
  const rules: Array<DescendantRule> = [];

  for (const token of className.split(" ")) {
    if (!token.startsWith("[&_")) {
      continue;
    }

    let depth: number = 0;
    let end: number = -1;

    for (let index: number = 0; index < token.length; index++) {
      if (token.charAt(index) === "[") {
        depth++;
      } else if (token.charAt(index) === "]") {
        depth--;

        if (depth === 0) {
          end = index;
          break;
        }
      }
    }

    rules.push({
      selector: token.slice(3, end).split("_").join(" "),
      utility: token.slice(end + 2),
    });
  }

  return rules;
};

// Every element in `holder` one of `className`'s descendant rules reaches.
const reachedIn: (holder: HTMLElement, className: string) => Array<Element> = (
  holder: HTMLElement,
  className: string,
): Array<Element> => {
  const reached: Set<Element> = new Set<Element>();

  for (const rule of descendantRulesOf(className)) {
    for (const element of Array.from(holder.querySelectorAll(rule.selector))) {
      reached.add(element);
    }
  }

  return Array.from(reached);
};

const BARE_NAME_RULES: Array<DescendantRule> = [
  { selector: "span[class=flex]", utility: "block" },
  { selector: "span[class=flex]", utility: "truncate" },
];

describe("the classes a resource's name is drawn with", () => {
  test("a bare name's span is laid out as a block that truncates, and nothing else is reached", () => {
    expect(descendantRulesOf(RESOURCE_BARE_NAME_CLASS_NAME)).toEqual(
      BARE_NAME_RULES,
    );
  });

  test("a list's row and a grid's chip lay it out alike, each in its own type", () => {
    expect(RESOURCE_ROW_NAME_CLASS_NAME).toBe(
      `truncate text-sm font-medium text-gray-900 ${RESOURCE_BARE_NAME_CLASS_NAME}`,
    );
    expect(RESOURCE_CHIP_NAME_CLASS_NAME).toBe(
      `truncate font-medium text-gray-900 ${RESOURCE_BARE_NAME_CLASS_NAME}`,
    );
    expect(descendantRulesOf(RESOURCE_ROW_NAME_CLASS_NAME)).toEqual(
      BARE_NAME_RULES,
    );
    expect(descendantRulesOf(RESOURCE_CHIP_NAME_CLASS_NAME)).toEqual(
      BARE_NAME_RULES,
    );
  });

  /*
   * A grid's column is as wide as the longest line in it, and a chip's
   * names are lines that never wrap: a long one widened its column, the
   * grid ran past its card and the next column was cut off mid-word, and
   * no name ever ended in "...". Contained in the inline axis, the chip's
   * words never size their column; they take the room the chip has left.
   */
  test("a grid's chip holds its words in the room it has left, never sized by them", () => {
    expect(RESOURCE_CHIP_TEXT_CLASS_NAME).toBe(
      "min-w-0 flex-1 [contain:inline-size]",
    );
  });
});

describe("a list's row, with monitor groups off: a bare name on a line of its own", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page an English monitor's name reads left to right, lined up as the page's lines",
    (language: string) => {
      drawList({
        language: language,
        resources: [monitorResource({ name: ENGLISH_MONITOR })],
      });

      const holder: HTMLElement = boxReading(
        LIST_ROW_NAME_TEST_ID,
        ENGLISH_MONITOR,
      );
      const line: HTMLElement = nameLineIn(holder);

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line.getAttribute("class")).toBe(
        `truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );

      /*
       * The link's markup is as a table's cell reads it - the bare span of
       * a record link with no icon - and the row's rule lays that span out
       * as a block that truncates, inside the name's line: its "..." at the
       * name's own end.
       */
      const reached: Array<Element> = reachedIn(
        holder,
        RESOURCE_ROW_NAME_CLASS_NAME,
      );

      expect(reached).toHaveLength(1);
      expect(reached[0]!.getAttribute("class")).toBe("flex");
      expect(reached[0]!.textContent).toBe(` ${ENGLISH_MONITOR}`);
      expect(reached[0]!.parentElement!.tagName).toBe("A");
      expect(line.contains(reached[0]!)).toBe(true);
      expect(reached[0]!.closest("[dir]")).toBe(line);

      // The row's box keeps the page's way, and says the name whole.
      expect(holder).not.toHaveAttribute("dir");
      expect(holder.getAttribute("class")).toBe(RESOURCE_ROW_NAME_CLASS_NAME);
      expect(holder).toHaveAttribute("title", ENGLISH_MONITOR);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page an English monitor group's name reads left to right too",
    (language: string) => {
      drawList({
        language: language,
        resources: [groupResource(ENGLISH_GROUP)],
      });

      const holder: HTMLElement = boxReading(
        LIST_ROW_NAME_TEST_ID,
        ENGLISH_GROUP,
      );

      expect(nameLineIn(holder)).toHaveAttribute("dir", "ltr");
      expect(nameLineIn(holder)).toHaveClass(
        LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      );
      expect(holder).toHaveAttribute("title", ENGLISH_GROUP);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page an Arabic name keeps the page's way: no dir, one line cut short",
    (language: string) => {
      drawList({
        language: language,
        resources: [monitorResource({ name: ARABIC_MONITOR })],
      });

      const line: HTMLElement = nameLineIn(
        boxReading(LIST_ROW_NAME_TEST_ID, ARABIC_MONITOR),
      );

      expect(line).not.toHaveAttribute("dir");
      expect(line.getAttribute("class")).toBe("truncate");
    },
  );

  test("on an English page an English name keeps the page's way: no dir, one line cut short", () => {
    drawList({
      language: "en",
      resources: [
        monitorResource({ name: ENGLISH_MONITOR }),
        groupResource(ENGLISH_GROUP),
      ],
    });

    for (const name of [ENGLISH_MONITOR, ENGLISH_GROUP]) {
      const line: HTMLElement = nameLineIn(
        boxReading(LIST_ROW_NAME_TEST_ID, name),
      );

      expect(line).not.toHaveAttribute("dir");
      expect(line.getAttribute("class")).toBe("truncate");
      expect(line.tagName).toBe("DIV");
    }
  });

  test("on an English page an Arabic name reads right to left, lined up as the page's lines", () => {
    drawList({
      language: "en",
      resources: [monitorResource({ name: ARABIC_MONITOR })],
    });

    const line: HTMLElement = nameLineIn(
      boxReading(LIST_ROW_NAME_TEST_ID, ARABIC_MONITOR),
    );

    expect(line).toHaveAttribute("dir", "rtl");
    expect(line.getAttribute("class")).toBe(
      `truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
  });

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page a resource whose monitor was deleted is named by its display name, read its own way",
    (language: string) => {
      drawList({
        language: language,
        resources: [strandedResource(ENGLISH_PUBLISHED)],
      });

      const holder: HTMLElement = boxReading(
        LIST_ROW_NAME_TEST_ID,
        ENGLISH_PUBLISHED,
      );
      const line: HTMLElement = nameLineIn(holder);

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line.getAttribute("class")).toBe(
        `truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(line.firstElementChild).toHaveClass("text-gray-500");
      expect(holder).toHaveAttribute("title", ENGLISH_PUBLISHED);
    },
  );

  /*
   * The row's box truncates, but text-overflow only cuts a box's own
   * lines: a display name drawn as plain text on the name's line, a block
   * inside the box, ran out of it clipped mid-letter. The line cuts itself
   * short - an inline span on it, which no bare-name rule reaches - on
   * every page, whichever way the name reads.
   */
  test.each(["en", ...RIGHT_TO_LEFT_LANGUAGES])(
    "on an %s page a deleted monitor's display name ends in ... on its own line",
    (language: string) => {
      drawList({
        language: language,
        resources: [
          strandedResource(ENGLISH_PUBLISHED),
          strandedResource(ARABIC_MONITOR),
        ],
      });

      for (const name of [ENGLISH_PUBLISHED, ARABIC_MONITOR]) {
        const holder: HTMLElement = boxReading(LIST_ROW_NAME_TEST_ID, name);
        const line: HTMLElement = nameLineIn(holder);
        const text: Element = line.firstElementChild!;

        expect(line).toHaveClass("truncate");
        expect(line.parentElement).toBe(holder);
        expect(text.tagName).toBe("SPAN");
        expect(text.getAttribute("class")).toBe("text-gray-500");
        expect(text.textContent).toBe(name);
        expect(reachedIn(holder, RESOURCE_ROW_NAME_CLASS_NAME)).toEqual([]);
      }
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page a resource with no name at all says so in the page's words, with no hover title",
    (language: string) => {
      drawList({ language: language, resources: [strandedResource()] });

      const holder: HTMLElement = boxReading(
        LIST_ROW_NAME_TEST_ID,
        UNKNOWN_RESOURCE[language]!,
      );
      const line: HTMLElement = nameLineIn(holder);

      expect(line).not.toHaveAttribute("dir");
      expect(line.getAttribute("class")).toBe("truncate");
      // Never an untranslated "Unknown resource" under the pointer.
      expect(holder).not.toHaveAttribute("title");
    },
  );
});

describe("a list's row, with monitor groups on: a name beside its kind's icon", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page the link is drawn as it was, its name a line of its own (RecordLinkName)",
    (language: string) => {
      drawList({
        language: language,
        resources: [
          monitorResource({ name: ENGLISH_MONITOR }),
          groupResource(ENGLISH_GROUP),
        ],
        isMonitorGroupsFeatureEnabled: true,
      });

      for (const name of [ENGLISH_MONITOR, ENGLISH_GROUP]) {
        const holder: HTMLElement = boxReading(LIST_ROW_NAME_TEST_ID, name);
        const recordLine: HTMLElement = within(holder).getByTestId(
          RECORD_LINK_NAME_TEST_ID,
        );

        // No second line around the link: its row of icon and name is the page's.
        expect(
          within(holder).queryByTestId(STATUS_PAGE_RESOURCE_NAME_TEST_ID),
        ).toBeNull();
        expect(recordLine).toHaveAttribute("dir", "ltr");
        expect(recordLine.parentElement!.getAttribute("class")).toBe(
          RECORD_LINK_NAME_ROW_CLASS_NAME,
        );
        expect(recordLine.parentElement).not.toHaveAttribute("dir");
        expect(reachedIn(holder, RESOURCE_ROW_NAME_CLASS_NAME)).toEqual([]);
        expect(holder).toHaveAttribute("title", name);
      }
    },
  );
});

describe("a list's row: the name published on the status page", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page an English one reads left to right, lined up as the page's lines",
    (language: string) => {
      drawList({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            displayName: ENGLISH_PUBLISHED,
          }),
        ],
      });

      const published: HTMLElement = screen.getByTestId(
        LIST_DISPLAY_NAME_TEST_ID,
      );

      expect(published.tagName).toBe("P");
      expect(published).toHaveAttribute("dir", "ltr");
      expect(published.getAttribute("class")).toBe(
        `truncate text-sm text-gray-500 ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(published).toHaveAttribute("title", ENGLISH_PUBLISHED);
      expect(published.textContent).toBe(ENGLISH_PUBLISHED);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page an Arabic one is drawn as it was",
    (language: string) => {
      drawList({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            displayName: ARABIC_PUBLISHED,
          }),
        ],
      });

      const published: HTMLElement = screen.getByTestId(
        LIST_DISPLAY_NAME_TEST_ID,
      );

      expect(published).not.toHaveAttribute("dir");
      expect(published.getAttribute("class")).toBe(
        "truncate text-sm text-gray-500",
      );
    },
  );

  test("on an English page an English one is drawn as it was, and an Arabic one reads right to left", () => {
    drawList({
      language: "en",
      resources: [
        monitorResource({
          name: ENGLISH_MONITOR,
          displayName: ENGLISH_PUBLISHED,
        }),
        monitorResource({
          name: ENGLISH_GROUP,
          displayName: ARABIC_PUBLISHED,
        }),
      ],
    });

    const english: HTMLElement = boxReading(
      LIST_DISPLAY_NAME_TEST_ID,
      ENGLISH_PUBLISHED,
    );
    const arabic: HTMLElement = boxReading(
      LIST_DISPLAY_NAME_TEST_ID,
      ARABIC_PUBLISHED,
    );

    expect(english).not.toHaveAttribute("dir");
    expect(english.getAttribute("class")).toBe(
      "truncate text-sm text-gray-500",
    );
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(arabic).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });
});

describe("a grid's chip: its name ends in '...' at its own end", () => {
  test.each(["en", ...RIGHT_TO_LEFT_LANGUAGES])(
    "on an %s page a long name never widens its column: the chip's words are contained, its column as wide as its heading",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            displayName: ENGLISH_PUBLISHED,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
          monitorResource({
            name: ARABIC_MONITOR,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
        ],
      });

      const chips: Array<HTMLElement> =
        screen.getAllByTestId(GRID_CHIP_TEST_ID);

      expect(chips).toHaveLength(2);

      for (const chip of chips) {
        const words: HTMLElement = within(chip).getByTestId(
          GRID_CHIP_TEXT_TEST_ID,
        );

        // Between the chip's box and its actions, which keep their width.
        expect(words.parentElement).toBe(chip);
        expect(words.getAttribute("class")).toBe(RESOURCE_CHIP_TEXT_CLASS_NAME);
        expect(words.previousElementSibling).toBe(
          within(chip).getByTestId("status-page-resource-grid-select"),
        );
        expect(words.nextElementSibling).toBe(
          within(chip).getByTestId("status-page-resource-grid-actions"),
        );

        for (const side of [
          words.previousElementSibling!,
          words.nextElementSibling!,
        ]) {
          expect(side).toHaveClass("flex-shrink-0");
        }
        expect(within(words).getByTestId(GRID_NAME_TEST_ID).parentElement).toBe(
          words,
        );

        // The chip is not contained: its box and its actions size it.
        expect(chip.getAttribute("class")).not.toContain("contain");
      }

      /*
       * Both of a chip's names are in its words: the monitor's, and the
       * name it is shown under on the status page.
       */
      const english: HTMLElement = boxReading(
        GRID_NAME_TEST_ID,
        ENGLISH_MONITOR,
      ).parentElement as HTMLElement;

      expect(english).toHaveAttribute("data-testid", GRID_CHIP_TEXT_TEST_ID);
      expect(Array.from(english.children)).toEqual([
        boxReading(GRID_NAME_TEST_ID, ENGLISH_MONITOR),
        boxReading(GRID_DISPLAY_NAME_TEST_ID, ENGLISH_PUBLISHED),
      ]);

      /*
       * With its words out of the count, a column is as wide as its
       * heading asks, or its share of the grid: never too narrow for a
       * name to show its start.
       */
      const heading: HTMLElement = screen.getByText("API", {
        selector: "thead th",
      });

      expect(heading).toHaveClass("min-w-[13rem]");
    },
  );

  test.each(["en", ...RIGHT_TO_LEFT_LANGUAGES])(
    "on an %s page the chip lays the bare name's span out as a block that truncates",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
        ],
      });

      const holder: HTMLElement = screen.getByTestId(GRID_NAME_TEST_ID);

      expect(holder.getAttribute("class")).toBe(RESOURCE_CHIP_NAME_CLASS_NAME);
      expect(holder).toHaveAttribute("title", ENGLISH_MONITOR);

      /*
       * The chip's box used to truncate a flex span, whose text it never
       * reaches: a long name was clipped mid-letter with no "...".
       */
      const reached: Array<Element> = reachedIn(
        holder,
        RESOURCE_CHIP_NAME_CLASS_NAME,
      );

      expect(reached).toHaveLength(1);
      expect(reached[0]!.getAttribute("class")).toBe("flex");
      expect(reached[0]!.textContent).toBe(` ${ENGLISH_MONITOR}`);
      expect(reached[0]!.parentElement!.tagName).toBe("A");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page an English name is a line read left to right",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
          monitorResource({
            name: ARABIC_MONITOR,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
        ],
      });

      const english: HTMLElement = nameLineIn(
        boxReading(GRID_NAME_TEST_ID, ENGLISH_MONITOR),
      );
      const arabic: HTMLElement = nameLineIn(
        boxReading(GRID_NAME_TEST_ID, ARABIC_MONITOR),
      );

      expect(english).toHaveAttribute("dir", "ltr");
      expect(english.getAttribute("class")).toBe(
        `truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(arabic).not.toHaveAttribute("dir");
      expect(arabic.getAttribute("class")).toBe("truncate");
    },
  );

  test.each(["en", ...RIGHT_TO_LEFT_LANGUAGES])(
    "on an %s page, with monitor groups on, the rule leaves the icon's row and the name's line alone",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
        ],
        isMonitorGroupsFeatureEnabled: true,
      });

      const holder: HTMLElement = screen.getByTestId(GRID_NAME_TEST_ID);
      const recordLine: HTMLElement = within(holder).getByTestId(
        RECORD_LINK_NAME_TEST_ID,
      );
      const row: HTMLElement = recordLine.parentElement as HTMLElement;

      expect(row.getAttribute("class")).toBe(RECORD_LINK_NAME_ROW_CLASS_NAME);
      expect(row.querySelector("svg")).not.toBeNull();
      expect(reachedIn(holder, RESOURCE_CHIP_NAME_CLASS_NAME)).toEqual([]);

      for (const each of [row, row.firstElementChild!, recordLine]) {
        for (const rule of BARE_NAME_RULES) {
          expect(each.matches(rule.selector)).toBe(false);
        }
      }
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page the chip's published name reads its own way",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ARABIC_MONITOR,
            displayName: ENGLISH_PUBLISHED,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
          monitorResource({
            name: ENGLISH_MONITOR,
            displayName: ARABIC_PUBLISHED,
            rowAxisValue: "EU",
            columnAxisValue: "API",
          }),
        ],
      });

      const english: HTMLElement = boxReading(
        GRID_DISPLAY_NAME_TEST_ID,
        ENGLISH_PUBLISHED,
      );
      const arabic: HTMLElement = boxReading(
        GRID_DISPLAY_NAME_TEST_ID,
        ARABIC_PUBLISHED,
      );

      expect(english).toHaveAttribute("dir", "ltr");
      expect(english.getAttribute("class")).toBe(
        `truncate text-[11px] text-gray-500 ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(english).toHaveAttribute("title", ENGLISH_PUBLISHED);
      expect(arabic).not.toHaveAttribute("dir");
      expect(arabic.getAttribute("class")).toBe(
        "truncate text-[11px] text-gray-500",
      );
    },
  );

  test("on an English page the chip's published name is drawn as it was", () => {
    drawGrid({
      language: "en",
      resources: [
        monitorResource({
          name: ENGLISH_MONITOR,
          displayName: ENGLISH_PUBLISHED,
          rowAxisValue: "EU",
          columnAxisValue: "API",
        }),
      ],
    });

    const published: HTMLElement = screen.getByTestId(
      GRID_DISPLAY_NAME_TEST_ID,
    );

    expect(published.tagName).toBe("DIV");
    expect(published).not.toHaveAttribute("dir");
    expect(published.getAttribute("class")).toBe(
      "truncate text-[11px] text-gray-500",
    );
    expect(
      nameLineIn(screen.getByTestId(GRID_NAME_TEST_ID)),
    ).not.toHaveAttribute("dir");
  });

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page a resource off the grid is named as a chip is",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            rowAxisValue: "Mars",
            columnAxisValue: "API",
          }),
        ],
      });

      const holder: HTMLElement = screen.getByTestId(GRID_ORPHAN_NAME_TEST_ID);

      expect(holder.getAttribute("class")).toBe(RESOURCE_CHIP_NAME_CLASS_NAME);
      expect(holder).toHaveAttribute("title", ENGLISH_MONITOR);
      expect(nameLineIn(holder)).toHaveAttribute("dir", "ltr");
      expect(reachedIn(holder, RESOURCE_CHIP_NAME_CLASS_NAME)).toHaveLength(1);
      expect(screen.queryByTestId(GRID_NAME_TEST_ID)).toBeNull();
    },
  );
});

/*
 * A RESOURCE OFF THE GRID SAYS WHERE IT IS: "Region: Mars · Service: API"
 * (#7087). That line was the page's: on an Arabic or Persian page an
 * English one too long for its chip was cut where the page's lines end,
 * its start - "...acific · Service: Search". Now it is a line of its own
 * that reads the way its words are written (IsolatedLine), each name and
 * value read its own way in it (IsolatedText), and the whole of it shows
 * on hover. Either value can be the one that keeps the resource off the
 * grid, so each axis is a piece of its own (an inline-block that is cut
 * short at its own end) and the line wraps between the two, never inside
 * one: on a phone, one line cut short kept only "Region: Asia Pacific · S...".
 */
describe("a resource off the grid: the line that says where it is", () => {
  const AXES_TEST_ID: string = "status-page-resource-grid-orphan-axes";
  const AXIS_TEST_ID: string = "status-page-resource-grid-orphan-axis";
  const LONG_ROW: string = "europe-west1-legacy-datacenter";
  const LONG_COLUMN: string = "Background workers (legacy queue)";

  /*
   * What sets the two axes apart, as the page's language sets two facts
   * apart (InlineSeparator): a bullet on a Persian page, where a middle dot
   * reads as its zero.
   */
  const dotOf: (language: string) => string = (language: string): string => {
    return language === "fa" ? "•" : "·";
  };

  // Each name and value on the line: its words and the way it reads.
  const partsOf: (
    line: HTMLElement,
  ) => Array<{ text: string; dir: string | null }> = (
    line: HTMLElement,
  ): Array<{ text: string; dir: string | null }> => {
    return Array.from(line.querySelectorAll("bdi")).map(
      (part: Element): { text: string; dir: string | null } => {
        return { text: part.textContent || "", dir: part.getAttribute("dir") };
      },
    );
  };

  // The line's two axes: the row's, with the dot, then the column's.
  const axesOf: (line: HTMLElement) => Array<HTMLElement> = (
    line: HTMLElement,
  ): Array<HTMLElement> => {
    const axes: Array<HTMLElement> = within(line).getAllByTestId(AXIS_TEST_ID);

    expect(axes).toHaveLength(2);

    for (const axis of axes) {
      expect(axis.tagName).toBe("SPAN");
      expect(axis.parentElement).toBe(line);
      expect(axis.getAttribute("class")).toBe(
        RESOURCE_GRID_ORPHAN_AXIS_CLASS_NAME,
      );
    }

    return axes;
  };

  test("each axis is one piece, cut short at its own end, and the line wraps only between the two", () => {
    expect(RESOURCE_GRID_ORPHAN_AXIS_CLASS_NAME).toBe(
      "inline-block max-w-full truncate align-top",
    );
    expect(RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME).toBe(
      "whitespace-normal text-gray-500",
    );
    // A line that wraps, so IsolatedLine sizes it to its words.
    expect(isWrappingLineClassName(RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME)).toBe(
      true,
    );
  });

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page an English line reads left to right, from its own start, each axis ending in '...' at its own end",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            rowAxisValue: LONG_ROW,
            columnAxisValue: LONG_COLUMN,
          }),
        ],
      });

      const line: HTMLElement = screen.getByTestId(AXES_TEST_ID);
      const whole: string = `Region: ${LONG_ROW} ${dotOf(language)} Service: ${LONG_COLUMN}`;

      expect(line).toHaveAttribute("dir", "ltr");
      /*
       * A line that wraps: as wide as its words, at the page's start, each
       * of its lines from its own start.
       */
      expect(line.getAttribute("class")).toBe(
        `${RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(line.textContent).toBe(whole);
      expect(line).toHaveAttribute("title", whole);

      const axes: Array<HTMLElement> = axesOf(line);

      expect(axes[0]!.textContent).toBe(
        `Region: ${LONG_ROW} ${dotOf(language)}`,
      );
      expect(axes[1]!.textContent).toBe(`Service: ${LONG_COLUMN}`);
      expect(partsOf(line)).toEqual([
        { text: "Region", dir: "ltr" },
        { text: LONG_ROW, dir: "ltr" },
        { text: "Service", dir: "ltr" },
        { text: LONG_COLUMN, dir: "ltr" },
      ]);

      // Under the resource's name, in the box that gives way to its buttons.
      expect(line.previousElementSibling).toBe(
        screen.getByTestId(GRID_ORPHAN_NAME_TEST_ID),
      );
      expect(line.parentElement).toHaveClass("min-w-0", "flex-1");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "on an %s page a line in the page's letters reads the page's way, and an English value in it reads its own",
    (language: string) => {
      drawGrid({
        language: language,
        rowLabel: "المنطقة",
        columnLabel: "الخدمة",
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            rowAxisValue: "القاهرة الجديدة",
            columnAxisValue: "API",
          }),
        ],
      });

      const line: HTMLElement = screen.getByTestId(AXES_TEST_ID);

      expect(line).not.toHaveAttribute("dir");
      expect(line.getAttribute("class")).toBe(
        RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME,
      );
      expect(
        axesOf(line).map((axis: HTMLElement) => {
          return axis.textContent;
        }),
      ).toEqual([`المنطقة: القاهرة الجديدة ${dotOf(language)}`, "الخدمة: API"]);
      expect(partsOf(line)).toEqual([
        { text: "المنطقة", dir: "rtl" },
        { text: "القاهرة الجديدة", dir: "rtl" },
        { text: "الخدمة", dir: "rtl" },
        { text: "API", dir: "ltr" },
      ]);
    },
  );

  test("on an English page the line reads as it did: no dir, its words, the two axes side by side", () => {
    drawGrid({
      language: "en",
      resources: [
        monitorResource({
          name: ENGLISH_MONITOR,
          rowAxisValue: "Mars",
          columnAxisValue: "API",
        }),
      ],
    });

    const line: HTMLElement = screen.getByTestId(AXES_TEST_ID);

    expect(line.tagName).toBe("DIV");
    expect(line).not.toHaveAttribute("dir");
    expect(line.getAttribute("class")).toBe(
      RESOURCE_GRID_ORPHAN_AXES_CLASS_NAME,
    );
    expect(line.textContent).toBe("Region: Mars · Service: API");
    expect(
      axesOf(line).map((axis: HTMLElement) => {
        return axis.textContent;
      }),
    ).toEqual(["Region: Mars ·", "Service: API"]);
    // A space between the two pieces: where the line may wrap.
    expect(axesOf(line)[0]!.nextSibling?.textContent).toBe(" ");
  });

  test.each(["en", ...RIGHT_TO_LEFT_LANGUAGES])(
    "on an %s page a value the resource lacks is a dash, which reads either way",
    (language: string) => {
      drawGrid({
        language: language,
        resources: [
          monitorResource({
            name: ENGLISH_MONITOR,
            rowAxisValue: "Mars",
          }),
        ],
      });

      const line: HTMLElement = screen.getByTestId(AXES_TEST_ID);

      expect(line.textContent).toBe(
        `Region: Mars ${dotOf(language)} Service: —`,
      );
      expect(partsOf(line)[3]).toEqual({ text: "—", dir: null });
    },
  );
});

/*
 * Lined up as a wrapping line is (CLAMPED_LINES_ALIGNED_AS_THE_PAGE) only
 * when it says it wraps: these names are one line each, aligned by their
 * end, which is the page's start.
 */
test("no name's line here is taken for one that wraps", () => {
  drawList({
    language: "fa",
    resources: [
      monitorResource({
        name: ENGLISH_MONITOR,
        displayName: ENGLISH_PUBLISHED,
      }),
    ],
  });

  for (const box of [
    nameLineIn(boxReading(LIST_ROW_NAME_TEST_ID, ENGLISH_MONITOR)),
    screen.getByTestId(LIST_DISPLAY_NAME_TEST_ID),
  ]) {
    for (const className of CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(
      " ",
    )) {
      expect(box).not.toHaveClass(className);
    }
  }
});
