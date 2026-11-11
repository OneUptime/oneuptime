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
 * A MONITOR'S NAME IN A STATUS PAGE'S RESOURCES LIST (the UI review of
 * #6740).
 *
 * Status Page > Resources lists each resource's monitor (or monitor group)
 * by its link (ResourceList, handed MonitorElement and MonitorGroupElement
 * by StatusPageResourcePanel) on one line that ends in "...". The link
 * draws a bare name inside a flex span, and text-overflow does not reach
 * the text a flex box holds, so the list laid every span in the name out
 * as a block that truncates ([&_span]:block [&_span]:truncate).
 *
 * With monitor groups on, each link draws its kind's icon too, in a row
 * whose name is a line of its own that cuts itself short (the Dashboard's
 * RecordLinkName). That rule made the row a block as well: its icon stood
 * on a line of its own above the name, and every row of the list was two
 * lines tall. It reaches the bare flex span alone now
 * (RESOURCE_ROW_NAME_CLASS_NAME).
 *
 * jsdom lays nothing out, so these read the rule's selectors from its
 * classes and ask which of the link's boxes they reach.
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
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import ResourceList, {
  RESOURCE_ROW_NAME_CLASS_NAME,
} from "../../../UI/Components/StatusPage/ResourceList";
import MonitorElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor";
import MonitorGroupElement from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupElement";
import {
  RECORD_LINK_NAME_LINE_CLASS_NAME,
  RECORD_LINK_NAME_ROW_CLASS_NAME,
  RECORD_LINK_NAME_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/RecordLink/RecordLinkName";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES } from "../../../UI/Components/Table/TableLayout";
import { PROJECT_ID, goTo } from "../Dashboard/SideMenuHarness";

const ROW_NAME_TEST_ID: string = "status-page-resource-row-name";

const ENGLISH_MONITOR: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1";
const ENGLISH_GROUP: string = "Checkout and payments (all regions)";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
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

const monitorResource: () => StatusPageResource = (): StatusPageResource => {
  const monitor: Monitor = new Monitor();
  monitor._id = "0193c0de-6740-4aaa-8bbb-000000000201";
  monitor.name = ENGLISH_MONITOR;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = "0193c0de-6740-4aaa-8bbb-000000000301";
  resource.monitor = monitor;
  resource.displayName = "Memory";

  return resource;
};

const groupResource: () => StatusPageResource = (): StatusPageResource => {
  const group: MonitorGroup = new MonitorGroup();
  group._id = "0193c0de-6740-4aaa-8bbb-000000000202";
  group.name = ENGLISH_GROUP;

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = "0193c0de-6740-4aaa-8bbb-000000000302";
  resource.monitorGroup = group;
  resource.displayName = "Checkout";

  return resource;
};

/*
 * The list as Status Page > Resources draws it: each resource's monitor or
 * monitor group, with its kind's icon when monitor groups are on
 * (StatusPageResourcePanel's getResourceElement).
 */
const drawList: (data: {
  language: string;
  isMonitorGroupsFeatureEnabled: boolean;
}) => void = (data: {
  language: string;
  isMonitorGroupsFeatureEnabled: boolean;
}): void => {
  render(
    <I18nextProvider i18n={instances[data.language]!}>
      <ResourceList
        statusPageResources={[monitorResource(), groupResource()]}
        listKey="names"
        getResourceElement={(
          statusPageResource: StatusPageResource,
        ): ReactElement => {
          if (statusPageResource.monitor) {
            return (
              <MonitorElement
                monitor={statusPageResource.monitor}
                showIcon={data.isMonitorGroupsFeatureEnabled}
              />
            );
          }

          return (
            <MonitorGroupElement
              monitorGroup={statusPageResource.monitorGroup!}
              showIcon={data.isMonitorGroupsFeatureEnabled}
            />
          );
        }}
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

// The name's holder in the row that shows `name`.
const nameHolderOf: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  const holder: HTMLElement | undefined = screen
    .getAllByTestId(ROW_NAME_TEST_ID)
    .find((each: HTMLElement): boolean => {
      return each.textContent?.trim() === name;
    });

  if (!holder) {
    throw new Error(`No row's name reads "${name}"`);
  }

  return holder;
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

    // The variant's bracket closes where its depth comes back to nothing.
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

const RULES: Array<DescendantRule> = descendantRulesOf(
  RESOURCE_ROW_NAME_CLASS_NAME,
);

// Every element in `holder` a rule of the name's holder reaches.
const reachedIn: (holder: HTMLElement) => Array<Element> = (
  holder: HTMLElement,
): Array<Element> => {
  const reached: Set<Element> = new Set<Element>();

  for (const rule of RULES) {
    for (const element of Array.from(holder.querySelectorAll(rule.selector))) {
      reached.add(element);
    }
  }

  return Array.from(reached);
};

describe("the classes a row's name is drawn with", () => {
  test("one line that ends in '...', in the list's name type", () => {
    expect(RESOURCE_ROW_NAME_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "truncate",
        "text-sm",
        "font-medium",
        "text-gray-900",
      ]),
    );
  });

  test("its rules lay out a bare name's flex span as a block that truncates, and reach nothing else", () => {
    expect(RULES).toEqual([
      { selector: "span[class=flex]", utility: "block" },
      { selector: "span[class=flex]", utility: "truncate" },
    ]);
    // The one shape a record link with no icon draws, as a table's cell reads it.
    expect(TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES).toContain(
      "span[class=flex]",
    );
  });

  test("the holder of a row's name is drawn with them", () => {
    drawList({ language: "en", isMonitorGroupsFeatureEnabled: false });

    for (const name of [ENGLISH_MONITOR, ENGLISH_GROUP]) {
      expect(nameHolderOf(name).getAttribute("class")).toBe(
        RESOURCE_ROW_NAME_CLASS_NAME,
      );
    }
  });
});

describe("with monitor groups off: a name alone", () => {
  test.each(["en", "fa"])(
    "on a %s page the rules reach the span each name is drawn in, so a long name ends in '...'",
    (language: string) => {
      drawList({ language: language, isMonitorGroupsFeatureEnabled: false });

      for (const name of [ENGLISH_MONITOR, ENGLISH_GROUP]) {
        const holder: HTMLElement = nameHolderOf(name);
        const reached: Array<Element> = reachedIn(holder);

        expect(reached).toHaveLength(1);
        expect(reached[0]!.tagName).toBe("SPAN");
        expect(reached[0]!.getAttribute("class")).toBe("flex");
        expect(reached[0]!.textContent).toBe(` ${name}`);
        // The link's one box.
        expect(reached[0]!.parentElement!.tagName).toBe("A");
        expect(holder.querySelector("svg")).toBeNull();
      }
    },
  );
});

describe("with monitor groups on: a name beside its kind's icon", () => {
  test.each(["en", "fa"])(
    "on a %s page the rules leave the icon's row, the icon and the name's line alone",
    (language: string) => {
      drawList({ language: language, isMonitorGroupsFeatureEnabled: true });

      for (const name of [ENGLISH_MONITOR, ENGLISH_GROUP]) {
        const holder: HTMLElement = nameHolderOf(name);
        const line: HTMLElement = within(holder).getByTestId(
          RECORD_LINK_NAME_TEST_ID,
        );
        const row: HTMLElement = line.parentElement as HTMLElement;

        expect(row.getAttribute("class")).toBe(RECORD_LINK_NAME_ROW_CLASS_NAME);
        expect(row.firstElementChild!.querySelector("svg")).not.toBeNull();

        /*
         * Nothing in the link is laid out as a block that truncates: not
         * the row (its icon would stand above the name), not its icon's
         * box, not the name's line, which cuts itself short.
         */
        expect(reachedIn(holder)).toEqual([]);

        for (const each of [row, row.firstElementChild!, line]) {
          for (const rule of RULES) {
            expect(each.matches(rule.selector)).toBe(false);
          }
        }
      }
    },
  );

  test("on a Persian page an English name is a line of its own, read left to right, cut short at its own end", () => {
    drawList({ language: "fa", isMonitorGroupsFeatureEnabled: true });

    for (const name of [ENGLISH_MONITOR, ENGLISH_GROUP]) {
      const line: HTMLElement = within(nameHolderOf(name)).getByTestId(
        RECORD_LINK_NAME_TEST_ID,
      );

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line).toHaveClass(...RECORD_LINK_NAME_LINE_CLASS_NAME.split(" "));
    }
  });

  /*
   * The rule the list had: every span in the name's holder. It reached
   * the icon's row, which a block puts on a line of its own above the
   * name, and the name's line.
   */
  test("the rule the list had reached the icon's row and the name's line: why it no longer reaches every span", () => {
    drawList({ language: "en", isMonitorGroupsFeatureEnabled: true });

    const holder: HTMLElement = nameHolderOf(ENGLISH_MONITOR);
    const line: HTMLElement = within(holder).getByTestId(
      RECORD_LINK_NAME_TEST_ID,
    );
    const everySpan: Array<Element> = Array.from(
      holder.querySelectorAll("span"),
    );

    expect(everySpan).toContain(line.parentElement);
    expect(everySpan).toContain(line);

    for (const rule of RULES) {
      expect(rule.selector).not.toBe("span");
    }
  });
});
