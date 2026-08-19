import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import CardSelect, {
  CardSelectOption,
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";
import MonitorTypeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/MonitorType";

/*
 * The real catalog, driven through the real picker. The unit tests either side
 * of this one prove the search ranks correctly and the component renders
 * correctly; what is pinned here is that the dashboard hands the component the
 * data it needs to do either - the adapter drops keywords silently, and every
 * search below still "works" while finding nothing.
 */

const categorizedOptions: Array<CardSelectOptionGroup> =
  MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions();

type RenderPickerFunction = (value?: string) => MockFunction;

const renderPicker: RenderPickerFunction = (value?: string): MockFunction => {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <CardSelect
      options={categorizedOptions}
      value={value}
      onChange={onChange}
      searchable={true}
      searchPlaceholder="Search monitor types - try ping, ssl, k8s, postgres"
      collapsibleGroups={true}
    />,
  );

  return onChange;
};

type SearchFunction = (value: string) => void;

const search: SearchFunction = (value: string): void => {
  fireEvent.change(screen.getByTestId("card-select-search"), {
    target: { value: value },
  });
};

// Every type the catalog actually offers, in the order the picker lists them.
const catalogTypeValues: Array<string> = categorizedOptions.flatMap(
  (group: CardSelectOptionGroup) => {
    return group.options.map((option: CardSelectOption) => {
      return option.value;
    });
  },
);

type ShownTypesFunction = () => Array<string>;

const shownTypes: ShownTypesFunction = (): Array<string> => {
  return screen.queryAllByRole("radio").map((card: HTMLElement) => {
    return (card.getAttribute("data-testid") || "").replace(
      "card-select-option-",
      "",
    );
  });
};

describe("Monitor type picker", () => {
  describe("the options the dashboard builds", () => {
    test("carries the keywords through from the monitor type catalog", () => {
      for (const group of categorizedOptions) {
        for (const option of group.options) {
          expect({
            monitorType: option.value,
            hasKeywords: Boolean(option.keywords && option.keywords.length > 0),
          }).toEqual({ monitorType: option.value, hasKeywords: true });
        }
      }
    });

    test("carries keywords through the flat option list too", () => {
      const flat: Array<CardSelectOption> =
        MonitorTypeUtil.monitorTypesAsCardSelectOptions();

      for (const option of flat) {
        expect(option.keywords).toBeDefined();
        expect((option.keywords || []).length).toBeGreaterThan(0);
      }
    });

    test("offers one group per category, in catalog order", () => {
      const categories: Array<MonitorTypeCategory> =
        MonitorTypeHelper.getMonitorTypeCategories();

      expect(
        categorizedOptions.map((group: CardSelectOptionGroup) => {
          return group.label;
        }),
      ).toEqual(
        categories.map((category: MonitorTypeCategory) => {
          return category.label;
        }),
      );
    });
  });

  describe("what a user sees on opening the form", () => {
    test("the everyday types are on screen without scrolling past anything", () => {
      renderPicker();

      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(screen.getByTestId("card-select-option-API")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Ping")).toBeVisible();
    });

    /*
     * The whole point of the change. Every type used to render at once - nine
     * headings and 29 cards, about six thousand pixels of them.
     */
    test("the long tail starts folded away behind its headings", () => {
      renderPicker();

      expect(
        screen.queryByTestId("card-select-option-Kubernetes"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("card-select-option-Ceph"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("card-select-option-Traces"),
      ).not.toBeInTheDocument();
    });

    test("shows far fewer cards than the catalog holds", () => {
      renderPicker();

      const total: number = categorizedOptions.reduce(
        (count: number, group: CardSelectOptionGroup) => {
          return count + group.options.length;
        },
        0,
      );

      expect(shownTypes().length).toBeLessThan(total / 2);
    });

    test("every category is still reachable, with a count of what is inside", () => {
      renderPicker();

      for (const group of categorizedOptions) {
        const header: HTMLElement = screen.getByTestId(
          `card-select-group-${group.label}`,
        );

        expect(header).toBeVisible();
        expect(header).toHaveTextContent(String(group.options.length));
      }
    });

    test("says how many types there are to choose from", () => {
      renderPicker();

      expect(
        screen.getByTestId("card-select-search-summary"),
      ).toHaveTextContent("to choose from");
    });
  });

  describe("finding a type by the words a user already knows", () => {
    test.each([
      ["k8s", MonitorType.Kubernetes],
      ["postgres", MonitorType.SQLQuery],
      ["heartbeat", MonitorType.IncomingRequest],
      ["tls", MonitorType.SSLCertificate],
      ["snmp", MonitorType.NetworkDevice],
      ["icmp", MonitorType.Ping],
      ["whois", MonitorType.Domain],
      ["prometheus", MonitorType.Metrics],
    ])("%s finds %s first", (query: string, expected: MonitorType) => {
      renderPicker();

      search(query);

      expect(shownTypes()[0]).toBe(expected);
    });

    test("a search reaches types that are folded away", () => {
      renderPicker();

      expect(
        screen.queryByTestId("card-select-option-Kubernetes"),
      ).not.toBeInTheDocument();

      search("k8s");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
    });

    test("a search for a vendor finds the external status page monitor", () => {
      renderPicker();

      search("cloudflare");

      expect(shownTypes()).toContain(MonitorType.ExternalStatusPage);
    });

    test("a category name gathers its types together", () => {
      renderPicker();

      search("telemetry");

      const shown: Array<string> = shownTypes();

      expect(shown).toContain(MonitorType.Logs);
      expect(shown).toContain(MonitorType.Metrics);
      expect(shown).toContain(MonitorType.Traces);
      expect(shown).not.toContain(MonitorType.Website);
    });

    test("a word nothing uses says so instead of showing an empty grid", () => {
      renderPicker();

      search("mainframe");

      expect(screen.getByTestId("card-select-no-results")).toBeVisible();
      expect(shownTypes()).toEqual([]);
    });

    test("picking a type from the search results reports the monitor type", () => {
      const onChange: MockFunction = renderPicker();

      search("k8s");
      fireEvent.click(screen.getByTestId("card-select-option-Kubernetes"));

      expect(onChange).toHaveBeenCalledWith(MonitorType.Kubernetes);
    });

    /*
     * The e2e suite reaches a folded-away type by typing its MonitorType value
     * into this box and then clicking card-select-option-<value>
     * (selectMonitorTypeCard in E2E/Tests/Dashboard/Helpers/Monitors.ts). That
     * only holds while every type's own value is a search term that finds it,
     * which a renamed title or a reworded description can quietly break — and
     * the only thing that would notice is a full release e2e run.
     */
    test.each(catalogTypeValues)(
      "typing %s finds the card the e2e suite goes on to click",
      (value: string) => {
        renderPicker();

        search(value);

        expect(screen.getByTestId(`card-select-option-${value}`)).toBeVisible();
      },
    );
  });

  describe("coming back to a form that already has a type", () => {
    test("shows the selection rather than hiding it behind a closed heading", () => {
      renderPicker(MonitorType.Ceph);

      expect(screen.getByTestId("card-select-option-Ceph")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Ceph")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    test("leaves the rest folded away", () => {
      renderPicker(MonitorType.Ceph);

      expect(
        screen.queryByTestId("card-select-option-Traces"),
      ).not.toBeInTheDocument();
    });
  });

  describe("browsing without searching", () => {
    test("opening a category shows every type in it", () => {
      renderPicker();

      fireEvent.click(screen.getByTestId("card-select-group-Telemetry"));

      expect(screen.getByTestId("card-select-option-Logs")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Metrics")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Traces")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Exceptions")).toBeVisible();
    });

    test("a type can be picked by browsing, with no typing at all", () => {
      const onChange: MockFunction = renderPicker();

      fireEvent.click(screen.getByTestId("card-select-group-Infrastructure"));
      fireEvent.click(screen.getByTestId("card-select-option-Kubernetes"));

      expect(onChange).toHaveBeenCalledWith(MonitorType.Kubernetes);
    });

    test("every type in the catalog can be reached by opening its category", () => {
      renderPicker();

      // Only the closed ones - clicking an open heading would fold it away.
      for (const group of categorizedOptions) {
        const header: HTMLElement = screen.getByTestId(
          `card-select-group-${group.label}`,
        );

        if (header.getAttribute("aria-expanded") === "false") {
          fireEvent.click(header);
        }
      }

      for (const group of categorizedOptions) {
        for (const option of group.options) {
          expect(
            screen.getByTestId(`card-select-option-${option.value}`),
          ).toBeVisible();
        }
      }
    });
  });
});
