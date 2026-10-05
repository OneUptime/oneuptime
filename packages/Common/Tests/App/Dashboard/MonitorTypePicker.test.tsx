import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import MonitorType, {
  MonitorTypeCategory,
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import CardSelect, {
  CardSelectCatalog,
  CardSelectOption,
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";
import Field from "../../../UI/Components/Forms/Types/Field";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTypeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/MonitorType";
import getMonitorTypeFormField from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorTypeFormField";

/*
 * The real catalog, driven through the real picker, configured exactly as
 * Create Monitor and the monitor template forms configure it
 * (getMonitorTypeFormField). The unit tests either side of this one prove the
 * search ranks correctly and the component renders correctly; what is pinned
 * here is that the dashboard hands the component the data it needs to do
 * either - the adapter drops keywords silently, and every search below still
 * "works" while finding nothing - and that what a user meets first is short.
 *
 * The maintainer, on Create Monitor: "this UI is extremely confusing to use".
 * It opened on eight large cards under "32 to choose from", over eight more
 * category headings with counts. It now opens on the six common types as
 * compact rows, everything else one search or one "More monitor types" away,
 * and a picked type shrinks to one line with a Change button.
 */

const field: Field<Monitor> = getMonitorTypeFormField<Monitor>();

const categorizedOptions: Array<CardSelectOptionGroup> =
  field.cardSelectOptions as Array<CardSelectOptionGroup>;

const catalog: CardSelectCatalog = field.cardSelectCatalog!;

const COMMON_TYPES: Array<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.Ping,
  MonitorType.Port,
  MonitorType.SSLCertificate,
  MonitorType.IncomingRequest,
];

interface PickerProps {
  onChange: MockFunction;
  value?: string | undefined;
}

// The picker in a form that keeps the value picked, as FormField does.
const Picker: (props: PickerProps) => ReactElement = (
  props: PickerProps,
): ReactElement => {
  const [value, setValue] = useState<string | undefined>(props.value);

  return (
    <CardSelect
      options={categorizedOptions}
      value={value}
      onChange={(next: string) => {
        props.onChange(next);
        setValue(next);
      }}
      searchable={field.cardSelectSearchable}
      searchPlaceholder={field.cardSelectSearchPlaceholder}
      catalog={field.cardSelectCatalog}
    />
  );
};

type RenderPickerFunction = (value?: string) => MockFunction;

const renderPicker: RenderPickerFunction = (value?: string): MockFunction => {
  const onChange: MockFunction = getJestMockFunction();

  render(<Picker onChange={onChange} value={value} />);

  return onChange;
};

type SearchFunction = (value: string) => void;

const search: SearchFunction = (value: string): void => {
  fireEvent.change(screen.getByTestId("card-select-search"), {
    target: { value: value },
  });
};

type PressMoreFunction = () => void;

const pressMore: PressMoreFunction = (): void => {
  fireEvent.click(screen.getByTestId("card-select-more"));
};

// Every type the catalog actually offers, in the order the categories list them.
const catalogTypeValues: Array<string> = categorizedOptions.flatMap(
  (group: CardSelectOptionGroup) => {
    return group.options.map((option: CardSelectOption) => {
      return option.value;
    });
  },
);

const longTailTypeValues: Array<string> = catalogTypeValues.filter(
  (value: string) => {
    return !(COMMON_TYPES as Array<string>).includes(value);
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

  describe("the common types", () => {
    test("are the six types most people create, in this order", () => {
      expect(MonitorTypeHelper.getCommonMonitorTypes()).toEqual(COMMON_TYPES);
      expect(catalog.commonOptionValues).toEqual(COMMON_TYPES);
    });

    /*
     * A common type the categories stopped offering would vanish from the
     * picker without a sound: the catalog layout skips a value no option
     * carries.
     */
    test("are every one a type the catalog offers", () => {
      for (const monitorType of COMMON_TYPES) {
        expect(catalogTypeValues).toContain(monitorType);
      }
    });

    test("are not repeated", () => {
      expect(new Set(COMMON_TYPES).size).toBe(COMMON_TYPES.length);
    });

    test("leave the long tail its own: everything else in the catalog", () => {
      expect(longTailTypeValues.length).toBe(
        catalogTypeValues.length - COMMON_TYPES.length,
      );
      expect(longTailTypeValues).toContain(MonitorType.Kubernetes);
      expect(longTailTypeValues).toContain(MonitorType.Manual);
    });
  });

  describe("what a user sees on opening the form", () => {
    test("the six common types, in order, and nothing else", () => {
      renderPicker();

      expect(shownTypes()).toEqual(COMMON_TYPES);
    });

    test("the long tail is not on screen at all", () => {
      renderPicker();

      for (const value of longTailTypeValues) {
        expect(
          screen.queryByTestId(`card-select-option-${value}`),
        ).not.toBeInTheDocument();
      }
    });

    /*
     * The whole point of the change: no wall of headings and counts before
     * a type can be picked.
     */
    test("no category heading and no count", () => {
      renderPicker();

      for (const group of categorizedOptions) {
        expect(screen.queryByText(group.label)).not.toBeInTheDocument();
      }

      expect(screen.queryByText(/to choose from/)).not.toBeInTheDocument();
    });

    test("one plain way to the rest: More monitor types", () => {
      renderPicker();

      expect(screen.getByTestId("card-select-more")).toHaveTextContent(
        "More monitor types",
      );
    });

    // The only thing that says the search knows words no card prints.
    test("a search box that says it understands the user's own words", () => {
      renderPicker();

      expect(screen.getByTestId("card-select-search")).toHaveAttribute(
        "placeholder",
        "Search monitor types - try ping, ssl, k8s, postgres",
      );
    });

    test("nothing is picked for the user", () => {
      renderPicker();

      for (const radio of screen.getAllByRole("radio")) {
        expect(radio).toHaveAttribute("aria-checked", "false");
      }
    });
  });

  describe("More monitor types", () => {
    test("shows every type in the catalog, each exactly once", () => {
      renderPicker();

      pressMore();

      expect([...shownTypes()].sort()).toEqual([...catalogTypeValues].sort());
    });

    test("puts each type under its category's heading", () => {
      renderPicker();

      pressMore();

      for (const group of categorizedOptions) {
        const rest: Array<CardSelectOption> = group.options.filter(
          (option: CardSelectOption) => {
            return !(COMMON_TYPES as Array<string>).includes(option.value);
          },
        );

        if (rest.length === 0) {
          expect(
            screen.queryByTestId(`card-select-group-${group.label}`),
          ).not.toBeInTheDocument();
          continue;
        }

        const section: HTMLElement = screen.getByTestId(
          `card-select-group-${group.label}`,
        );

        expect(within(section).getByText(group.label)).toBeVisible();

        for (const option of rest) {
          expect(
            within(section).getByTestId(`card-select-option-${option.value}`),
          ).toBeVisible();
        }
      }
    });

    test("the infrastructure types sit together", () => {
      renderPicker();

      pressMore();

      const infrastructure: HTMLElement = screen.getByTestId(
        "card-select-group-Infrastructure",
      );

      for (const monitorType of [
        MonitorType.Host,
        MonitorType.Kubernetes,
        MonitorType.Docker,
        MonitorType.Ceph,
      ]) {
        expect(
          within(infrastructure).getByTestId(
            `card-select-option-${monitorType}`,
          ),
        ).toBeVisible();
      }
    });

    test("a type can be picked by browsing, with no typing at all", () => {
      const onChange: MockFunction = renderPicker();

      pressMore();
      fireEvent.click(screen.getByTestId("card-select-option-Kubernetes"));

      expect(onChange).toHaveBeenCalledWith(MonitorType.Kubernetes);
    });
  });

  describe("finding a type by the words a user already knows", () => {
    test.each([
      ["k8s", MonitorType.Kubernetes],
      // An engine name means health series; "query" means the escape hatch.
      ["postgres", MonitorType.Database],
      ["query", MonitorType.SQLQuery],
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

    test("a search reaches types that More holds back", () => {
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
     * The e2e suite reaches a held-back type by typing its MonitorType value
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

  describe("picking and changing a type", () => {
    test("a picked type shrinks the picker to that type, with Change", () => {
      renderPicker();

      fireEvent.click(screen.getByTestId("card-select-option-Website"));

      const summary: HTMLElement = screen.getByTestId("card-select-summary");

      expect(summary).toHaveAttribute("data-card-select-value", "Website");
      expect(summary).toHaveTextContent("Website");
      expect(summary).toHaveTextContent(
        MonitorTypeHelper.getDescription(MonitorType.Website),
      );
      expect(screen.queryAllByRole("radio")).toEqual([]);
    });

    test("Change, then another type: both picks reported, the last one shown", () => {
      const onChange: MockFunction = renderPicker();

      fireEvent.click(screen.getByTestId("card-select-option-Website"));
      fireEvent.click(screen.getByTestId("card-select-change"));
      fireEvent.click(screen.getByTestId("card-select-option-API"));

      expect(onChange.mock.calls).toEqual([
        [MonitorType.Website],
        [MonitorType.API],
      ]);
      expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
        "data-card-select-value",
        "API",
      );
    });

    test("Change, then a type from the long tail by search", () => {
      const onChange: MockFunction = renderPicker();

      fireEvent.click(screen.getByTestId("card-select-option-Ping"));
      fireEvent.click(screen.getByTestId("card-select-change"));
      search("postgres");
      fireEvent.keyDown(screen.getByTestId("card-select-search"), {
        key: "Enter",
      });

      expect(onChange).toHaveBeenLastCalledWith(MonitorType.Database);
      expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
        "data-card-select-value",
        MonitorType.Database,
      );
    });
  });

  describe("coming back to a form that already has a type", () => {
    test("shows the type chosen, not the catalog", () => {
      renderPicker(MonitorType.Ceph);

      expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
        "data-card-select-value",
        "Ceph",
      );
      expect(shownTypes()).toEqual([]);
    });

    test("Change shows it checked, without pressing More", () => {
      renderPicker(MonitorType.Ceph);

      fireEvent.click(screen.getByTestId("card-select-change"));

      expect(screen.getByTestId("card-select-option-Ceph")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.queryByTestId("card-select-more")).not.toBeInTheDocument();
    });

    /*
     * Server and Profiles are monitor types the picker no longer offers. A
     * template that still names one opens on the catalog, as before.
     */
    test("a type the picker no longer offers opens the catalog", () => {
      renderPicker(MonitorType.Server);

      expect(
        screen.queryByTestId("card-select-summary"),
      ).not.toBeInTheDocument();
      expect(shownTypes()).toEqual(COMMON_TYPES);
    });
  });
});
