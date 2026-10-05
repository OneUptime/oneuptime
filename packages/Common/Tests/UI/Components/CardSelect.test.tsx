import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../MockType";
import CardSelect, {
  CardSelectCatalog,
  CardSelectOption,
  CardSelectOptionGroup,
  ComponentProps,
  cardSelectOptionMatchesSearch,
  getCardSelectCatalogSections,
  getCardSelectOptionSearchScore,
  getCardSelectSearchTokens,
  isCardSelectOptionGroup,
  normalizeCardSelectGroups,
} from "../../../UI/Components/CardSelect/CardSelect";

/*
 * CardSelect grew a search box and a catalog layout for the monitor type
 * picker, where 29 cards under nine headings made picking one a scrolling
 * exercise. Both are opt in, so the callers that do not ask for them - the
 * team role picker and the metrics pipeline rule picker - must keep exactly
 * the plain grid they had. That is what the first block pins.
 *
 * The catalog layout (the "catalog layout" block) is the maintainer's "this
 * UI is extremely confusing": the common choices first as compact rows, the
 * rest one More press away under plain headings, and a picked choice shrunk
 * to one line with a Change button.
 */

const website: CardSelectOption = {
  value: "Website",
  title: "Website",
  description: "Check a page loads and responds.",
  icon: IconProp.Globe,
  keywords: ["url", "http", "https"],
};

const kubernetes: CardSelectOption = {
  value: "Kubernetes",
  title: "Kubernetes",
  description: "Cluster, node, workload, and pod health.",
  icon: IconProp.Cube,
  keywords: ["k8s", "cluster", "pod"],
};

const sqlQuery: CardSelectOption = {
  value: "SQL Query",
  title: "SQL Query",
  description: "Run a read only query on a schedule.",
  icon: IconProp.Database,
  keywords: ["postgres", "mysql", "database"],
};

const manual: CardSelectOption = {
  value: "Manual",
  title: "Manual",
  description: "No automatic checks.",
  icon: IconProp.EmptyCircle,
};

const basicGroup: CardSelectOptionGroup = {
  label: "Basic Monitoring",
  options: [website],
};

const infrastructureGroup: CardSelectOptionGroup = {
  label: "Infrastructure",
  options: [kubernetes],
};

const databaseGroup: CardSelectOptionGroup = {
  label: "Database Monitoring",
  options: [sqlQuery],
};

const otherGroup: CardSelectOptionGroup = {
  label: "Other",
  options: [manual],
};

const groupedOptions: Array<CardSelectOptionGroup> = [
  basicGroup,
  infrastructureGroup,
  databaseGroup,
  otherGroup,
];

type RenderComponentFunction = (props: Partial<ComponentProps>) => {
  onChange: MockFunction;
};

const renderComponent: RenderComponentFunction = (
  props: Partial<ComponentProps>,
): { onChange: MockFunction } => {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <CardSelect
      options={props.options || groupedOptions}
      onChange={onChange}
      {...props}
    />,
  );

  return { onChange: onChange };
};

/*
 * A catalog: the same groups, Basic Monitoring holding two more options so a
 * group still has something to show once its common choices are taken out.
 */
const ping: CardSelectOption = {
  value: "Ping",
  title: "Ping",
  description: "ICMP reachability.",
  icon: IconProp.Signal,
  keywords: ["icmp"],
};

const ip: CardSelectOption = {
  value: "IP",
  title: "IP",
  description: "Reachability of an address.",
  icon: IconProp.AltGlobe,
};

const catalogOptions: Array<CardSelectOptionGroup> = [
  { label: "Basic Monitoring", options: [website, ping, ip] },
  infrastructureGroup,
  databaseGroup,
  otherGroup,
];

// Ping before Website: the common rows follow the catalog, not the groups.
const CATALOG: CardSelectCatalog = {
  commonOptionValues: ["Ping", "Website"],
  moreOptionsText: "More monitor types",
};

interface CatalogHarnessProps {
  onChange: MockFunction;
  onParentKeyDown: MockFunction;
  initialValue?: string | undefined;
  searchable?: boolean | undefined;
  error?: string | undefined;
  catalog?: CardSelectCatalog | undefined;
  options?: Array<CardSelectOption | CardSelectOptionGroup> | undefined;
}

/*
 * The picker inside a form that keeps what was picked, as FormField does, so
 * a pick comes back as the value and the summary follows it. The wrapper
 * stands for a dialog: it hears every key the picker lets through.
 */
const CatalogHarness: (props: CatalogHarnessProps) => ReactElement = (
  props: CatalogHarnessProps,
): ReactElement => {
  const [value, setValue] = useState<string | undefined>(props.initialValue);

  return (
    <div
      onKeyDown={(event: React.KeyboardEvent) => {
        props.onParentKeyDown(event.key);
      }}
    >
      <label id="monitor-type-label">Monitor Type</label>
      <CardSelect
        options={props.options || catalogOptions}
        value={value}
        onChange={(next: string) => {
          props.onChange(next);
          setValue(next);
        }}
        catalog={props.catalog || CATALOG}
        searchable={props.searchable}
        searchPlaceholder="Search monitor types"
        ariaLabelledby="monitor-type-label"
        error={props.error}
      />
    </div>
  );
};

type RenderCatalogFunction = (
  props?: Partial<Omit<CatalogHarnessProps, "onChange" | "onParentKeyDown">>,
) => { onChange: MockFunction; onParentKeyDown: MockFunction };

const renderCatalog: RenderCatalogFunction = (
  props: Partial<
    Omit<CatalogHarnessProps, "onChange" | "onParentKeyDown">
  > = {},
): { onChange: MockFunction; onParentKeyDown: MockFunction } => {
  const onChange: MockFunction = getJestMockFunction();
  const onParentKeyDown: MockFunction = getJestMockFunction();

  render(
    <CatalogHarness
      onChange={onChange}
      onParentKeyDown={onParentKeyDown}
      {...props}
    />,
  );

  return { onChange: onChange, onParentKeyDown: onParentKeyDown };
};

// The options on screen, in the order they are drawn.
type ShownValuesFunction = () => Array<string>;

const shownValues: ShownValuesFunction = (): Array<string> => {
  return screen.queryAllByRole("radio").map((radio: HTMLElement) => {
    return radio.getAttribute("data-card-select-value") || "";
  });
};

type TypeSearchFunction = (value: string) => void;

const typeSearch: TypeSearchFunction = (value: string): void => {
  fireEvent.change(screen.getByTestId("card-select-search"), {
    target: { value: value },
  });
};

describe("CardSelect", () => {
  describe("default behaviour is unchanged for callers that opt into nothing", () => {
    test("renders every flat option as a card", () => {
      renderComponent({ options: [website, kubernetes, manual] });

      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Manual")).toBeVisible();
    });

    test("renders every group heading and every card under it", () => {
      renderComponent({});

      for (const group of groupedOptions) {
        expect(screen.getByText(group.label)).toBeInTheDocument();
      }

      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
      expect(screen.getByTestId("card-select-option-SQL Query")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Manual")).toBeVisible();
    });

    test("renders a run of flat options interleaved between groups", () => {
      renderComponent({ options: [manual, basicGroup, kubernetes] });

      expect(screen.getByTestId("card-select-option-Manual")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
      expect(screen.getByText("Basic Monitoring")).toBeInTheDocument();
    });

    test("shows no search box", () => {
      renderComponent({});

      expect(
        screen.queryByTestId("card-select-search"),
      ).not.toBeInTheDocument();
    });

    test("shows no More button, so every group stays open", () => {
      renderComponent({});

      expect(screen.queryByTestId("card-select-more")).not.toBeInTheDocument();
      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
    });

    /*
     * Only a catalog shrinks to its choice: a team's role picker with a role
     * picked still shows every role, the picked one checked.
     */
    test("keeps every card on screen when a value is picked", () => {
      renderComponent({ value: "Kubernetes" });

      expect(
        screen.queryByTestId("card-select-summary"),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(4);
    });

    test("draws the large cards, not the catalog's compact rows", () => {
      renderComponent({});

      expect(screen.getByTestId("card-select-option-Website")).toHaveClass(
        "p-4",
      );
    });
  });

  describe("selection", () => {
    test("calls onChange with the option value when a card is clicked", () => {
      const { onChange } = renderComponent({});

      fireEvent.click(screen.getByTestId("card-select-option-Website"));

      expect(onChange).toHaveBeenCalledWith("Website");
    });

    test("calls onChange when Enter is pressed on a card", () => {
      const { onChange } = renderComponent({});

      fireEvent.keyDown(screen.getByTestId("card-select-option-Website"), {
        key: "Enter",
      });

      expect(onChange).toHaveBeenCalledWith("Website");
    });

    test("calls onChange when Space is pressed on a card", () => {
      const { onChange } = renderComponent({});

      fireEvent.keyDown(screen.getByTestId("card-select-option-Website"), {
        key: " ",
      });

      expect(onChange).toHaveBeenCalledWith("Website");
    });

    test("does not call onChange for an unrelated key", () => {
      const { onChange } = renderComponent({});

      fireEvent.keyDown(screen.getByTestId("card-select-option-Website"), {
        key: "a",
      });

      expect(onChange).not.toHaveBeenCalled();
    });

    test("marks only the selected card aria-checked", () => {
      renderComponent({ value: "Kubernetes" });

      expect(
        screen.getByTestId("card-select-option-Kubernetes"),
      ).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTestId("card-select-option-Website")).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    test("every card is a radio inside a radiogroup", () => {
      renderComponent({});

      expect(screen.getByRole("radiogroup")).toBeInTheDocument();
      expect(screen.getAllByRole("radio")).toHaveLength(4);
    });
  });

  describe("error and labelling", () => {
    test("renders the error as an alert", () => {
      renderComponent({ error: "Monitor type is required." });

      const error: HTMLElement = screen.getByRole("alert");

      expect(error).toHaveTextContent("Monitor type is required.");
    });

    test("renders no alert when there is no error", () => {
      renderComponent({});

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("points the radiogroup at the field label", () => {
      renderComponent({ ariaLabelledby: "monitor-type-label" });

      expect(screen.getByRole("radiogroup")).toHaveAttribute(
        "aria-labelledby",
        "monitor-type-label",
      );
    });

    test("exposes the dataTestId on the wrapper", () => {
      renderComponent({ dataTestId: "monitor-type-picker" });

      expect(screen.getByTestId("monitor-type-picker")).toBeInTheDocument();
    });
  });

  describe("search", () => {
    test("shows the search box only when asked", () => {
      renderComponent({ searchable: true });

      expect(screen.getByTestId("card-select-search")).toBeInTheDocument();
    });

    test("uses the caller's placeholder as the accessible name", () => {
      renderComponent({ searchable: true, searchPlaceholder: "Search types" });

      expect(screen.getByLabelText("Search types")).toBeInTheDocument();
    });

    test("counts everything on offer before anything is typed", () => {
      renderComponent({ searchable: true });

      expect(
        screen.getByTestId("card-select-search-summary"),
      ).toHaveTextContent("4 to choose from");
    });

    test("narrows to the cards that match a title", () => {
      renderComponent({ searchable: true });

      typeSearch("kubernetes");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
      expect(
        screen.queryByTestId("card-select-option-Website"),
      ).not.toBeInTheDocument();
    });

    test("matches on a keyword that appears nowhere on the card", () => {
      renderComponent({ searchable: true });

      typeSearch("k8s");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
      expect(screen.getAllByRole("radio")).toHaveLength(1);
    });

    test("matches on the description", () => {
      renderComponent({ searchable: true });

      typeSearch("workload");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
    });

    test("matches on the group heading the card sits under", () => {
      renderComponent({ searchable: true });

      typeSearch("infrastructure");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
      expect(
        screen.queryByTestId("card-select-option-Website"),
      ).not.toBeInTheDocument();
    });

    test("ignores case on both sides", () => {
      renderComponent({ searchable: true });

      typeSearch("K8S");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
    });

    test("matches part of a word", () => {
      renderComponent({ searchable: true });

      typeSearch("kube");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
    });

    /*
     * The words are matched separately and can come from different fields, so
     * a user describing what they want in their own order still lands on the
     * card. Requiring every word is what keeps that from matching everything.
     */
    test("requires every word typed, taking them from different fields", () => {
      renderComponent({ searchable: true });

      typeSearch("postgres query");

      expect(screen.getByTestId("card-select-option-SQL Query")).toBeVisible();
      expect(screen.getAllByRole("radio")).toHaveLength(1);
    });

    test("does not care what order the words are typed in", () => {
      renderComponent({ searchable: true });

      typeSearch("query postgres");

      expect(screen.getByTestId("card-select-option-SQL Query")).toBeVisible();
    });

    /*
     * The strict pass drops it - nothing contains "mainframe" - so what comes
     * back is labelled a closest match rather than presented as a hit. The
     * strict rule itself is pinned on cardSelectOptionMatchesSearch below.
     */
    test("stops treating a card as a match when one of the words misses", () => {
      renderComponent({ searchable: true });

      typeSearch("postgres mainframe");

      expect(screen.getByTestId("card-select-closest-matches")).toBeVisible();
      expect(
        screen.getByTestId("card-select-search-summary"),
      ).toHaveTextContent("closest of");
    });

    test("hides the group headings while a search is running", () => {
      renderComponent({ searchable: true });

      typeSearch("kubernetes");

      expect(screen.queryByText("Infrastructure")).not.toBeInTheDocument();
    });

    test("reports how many of the total are showing", () => {
      renderComponent({ searchable: true });

      typeSearch("k8s");

      expect(
        screen.getByTestId("card-select-search-summary"),
      ).toHaveTextContent("Showing 1 of 4");
    });

    test("a card can still be picked out of the search results", () => {
      const { onChange } = renderComponent({ searchable: true });

      typeSearch("k8s");
      fireEvent.click(screen.getByTestId("card-select-option-Kubernetes"));

      expect(onChange).toHaveBeenCalledWith("Kubernetes");
    });

    describe("when nothing matches", () => {
      test("says so rather than rendering an empty grid", () => {
        renderComponent({ searchable: true });

        typeSearch("mainframe");

        expect(screen.getByTestId("card-select-no-results")).toBeVisible();
        expect(screen.queryAllByRole("radio")).toHaveLength(0);
      });

      test("offers a way back to the full list", () => {
        renderComponent({ searchable: true });

        typeSearch("mainframe");
        fireEvent.click(screen.getByText("Clear search"));

        expect(
          screen.queryByTestId("card-select-no-results"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      });
    });

    test("the clear button restores the full list", () => {
      renderComponent({ searchable: true });

      typeSearch("k8s");
      fireEvent.click(screen.getByTestId("card-select-search-clear"));

      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(screen.getByText("Basic Monitoring")).toBeInTheDocument();
    });

    test("there is nothing to clear before anything is typed", () => {
      renderComponent({ searchable: true });

      expect(
        screen.queryByTestId("card-select-search-clear"),
      ).not.toBeInTheDocument();
    });

    /*
     * The picker is used inside forms that live in modals and side overs. An
     * Escape meant for the search box must not also close the form around it.
     */
    test("Escape clears the search without escaping the surrounding form", () => {
      renderComponent({ searchable: true });

      typeSearch("k8s");

      const searchInput: HTMLElement = screen.getByTestId("card-select-search");
      const escape: boolean = fireEvent.keyDown(searchInput, {
        key: "Escape",
      });

      expect(escape).toBe(false);
      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
    });

    test("Escape on an empty search box is left to the form", () => {
      renderComponent({ searchable: true });

      const escape: boolean = fireEvent.keyDown(
        screen.getByTestId("card-select-search"),
        { key: "Escape" },
      );

      expect(escape).toBe(true);
    });
  });

  describe("keyboard", () => {
    /*
     * Every card used to get its own increasing tabIndex. With the 0 that
     * FormField passes, that produced 1, 2, 3 ... 28 - positive tab indices,
     * which jump the whole grid ahead of every other control on the page and
     * make 29 stops out of what should be one.
     */
    test("the group is a single tab stop, not one per card", () => {
      renderComponent({});

      const tabbable: Array<HTMLElement> = screen
        .getAllByRole("radio")
        .filter((card: HTMLElement) => {
          return card.getAttribute("tabindex") === "0";
        });

      expect(tabbable).toHaveLength(1);
    });

    test("no card carries a positive tab index", () => {
      renderComponent({});

      for (const card of screen.getAllByRole("radio")) {
        expect(Number(card.getAttribute("tabindex"))).toBeLessThanOrEqual(0);
      }
    });

    test("the tab stop is the first card when nothing is selected", () => {
      renderComponent({});

      expect(screen.getByTestId("card-select-option-Website")).toHaveAttribute(
        "tabindex",
        "0",
      );
    });

    test("the tab stop follows the selection", () => {
      renderComponent({ value: "SQL Query" });

      expect(
        screen.getByTestId("card-select-option-SQL Query"),
      ).toHaveAttribute("tabindex", "0");
      expect(screen.getByTestId("card-select-option-Website")).toHaveAttribute(
        "tabindex",
        "-1",
      );
    });

    test("arrow right moves focus to the next card", () => {
      renderComponent({});

      const first: HTMLElement = screen.getByTestId(
        "card-select-option-Website",
      );

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowRight" });

      expect(screen.getByTestId("card-select-option-Kubernetes")).toHaveFocus();
    });

    test("arrow down moves focus to the next card", () => {
      renderComponent({});

      const first: HTMLElement = screen.getByTestId(
        "card-select-option-Website",
      );

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowDown" });

      expect(screen.getByTestId("card-select-option-Kubernetes")).toHaveFocus();
    });

    test("arrow left moves focus back", () => {
      renderComponent({});

      const second: HTMLElement = screen.getByTestId(
        "card-select-option-Kubernetes",
      );

      second.focus();
      fireEvent.keyDown(second, { key: "ArrowLeft" });

      expect(screen.getByTestId("card-select-option-Website")).toHaveFocus();
    });

    test("arrows stop at the ends rather than wrapping round", () => {
      renderComponent({});

      const first: HTMLElement = screen.getByTestId(
        "card-select-option-Website",
      );

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowLeft" });

      expect(first).toHaveFocus();
    });

    /*
     * Moving focus must not choose anything: on the create form choosing a
     * type resets the criteria built below it, so arrowing past a card cannot
     * be allowed to fire onChange.
     */
    test("moving focus chooses nothing", () => {
      const { onChange } = renderComponent({});

      const first: HTMLElement = screen.getByTestId(
        "card-select-option-Website",
      );

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowRight" });

      expect(onChange).not.toHaveBeenCalled();
    });

    test("arrows skip the options a catalog holds back behind More", () => {
      renderComponent({ catalog: { ...CATALOG, commonOptionValues: ["Website"] } });

      const first: HTMLElement = screen.getByTestId(
        "card-select-option-Website",
      );

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowRight" });

      // Website is the only option on screen, so there is nowhere to go.
      expect(first).toHaveFocus();
    });

    test("Enter in the search box picks the top result", () => {
      const { onChange } = renderComponent({ searchable: true });

      typeSearch("k8s");
      fireEvent.keyDown(screen.getByTestId("card-select-search"), {
        key: "Enter",
      });

      expect(onChange).toHaveBeenCalledWith("Kubernetes");
    });

    test("Enter in an empty search box picks nothing", () => {
      const { onChange } = renderComponent({ searchable: true });

      fireEvent.keyDown(screen.getByTestId("card-select-search"), {
        key: "Enter",
      });

      expect(onChange).not.toHaveBeenCalled();
    });

    test("arrow down from the search box moves into the results", () => {
      renderComponent({ searchable: true });

      typeSearch("k8s");
      fireEvent.keyDown(screen.getByTestId("card-select-search"), {
        key: "ArrowDown",
      });

      expect(screen.getByTestId("card-select-option-Kubernetes")).toHaveFocus();
    });
  });

  describe("closest matches", () => {
    /*
     * A dead end is the worst answer a search can give. When no card carries
     * every word, the cards carrying any of them beat an empty panel.
     */
    test("falls back to the cards matching any word", () => {
      renderComponent({ searchable: true });

      typeSearch("postgres uptime");

      expect(screen.getByTestId("card-select-option-SQL Query")).toBeVisible();
      expect(screen.getByTestId("card-select-closest-matches")).toBeVisible();
    });

    test("says the results are only the closest ones", () => {
      renderComponent({ searchable: true });

      typeSearch("postgres uptime");

      expect(
        screen.getByTestId("card-select-search-summary"),
      ).toHaveTextContent("closest of");
    });

    test("does not claim closest matches when every word landed", () => {
      renderComponent({ searchable: true });

      typeSearch("k8s");

      expect(
        screen.queryByTestId("card-select-closest-matches"),
      ).not.toBeInTheDocument();
    });

    test("a card from the closest matches can still be picked", () => {
      const { onChange } = renderComponent({ searchable: true });

      typeSearch("postgres uptime");
      fireEvent.click(screen.getByTestId("card-select-option-SQL Query"));

      expect(onChange).toHaveBeenCalledWith("SQL Query");
    });

    test("a single word that matches nothing still says nothing matches", () => {
      renderComponent({ searchable: true });

      typeSearch("mainframe");

      expect(screen.getByTestId("card-select-no-results")).toBeVisible();
      expect(
        screen.queryByTestId("card-select-closest-matches"),
      ).not.toBeInTheDocument();
    });

    test("several words that all match nothing still say nothing matches", () => {
      renderComponent({ searchable: true });

      typeSearch("mainframe cobol");

      expect(screen.getByTestId("card-select-no-results")).toBeVisible();
    });
  });

  describe("search ranking", () => {
    type TitlesFunction = () => Array<string>;

    const renderedTitles: TitlesFunction = (): Array<string> => {
      return screen.getAllByRole("radio").map((card: HTMLElement) => {
        return card.getAttribute("data-testid") || "";
      });
    };

    test("puts an exact title match first", () => {
      const ping: CardSelectOption = {
        value: "Ping",
        title: "Ping",
        description: "ICMP reachability.",
        icon: IconProp.Signal,
      };
      const other: CardSelectOption = {
        value: "Other",
        title: "Other",
        description: "Mentions ping in passing.",
        icon: IconProp.Globe,
      };

      renderComponent({ options: [other, ping], searchable: true });

      typeSearch("ping");

      expect(renderedTitles()[0]).toBe("card-select-option-Ping");
    });

    test("puts a keyword match above a description-only match", () => {
      const keywordCard: CardSelectOption = {
        value: "Keyword",
        title: "Keyword",
        description: "Nothing relevant here.",
        icon: IconProp.Globe,
        keywords: ["postgres"],
      };
      const descriptionCard: CardSelectOption = {
        value: "Description",
        title: "Description",
        description: "Talks about postgres somewhere in the copy.",
        icon: IconProp.Globe,
      };

      renderComponent({
        options: [descriptionCard, keywordCard],
        searchable: true,
      });

      typeSearch("postgres");

      expect(renderedTitles()[0]).toBe("card-select-option-Keyword");
    });

    test("falls back to alphabetical order when the scores tie", () => {
      const beta: CardSelectOption = {
        value: "Beta",
        title: "Beta",
        description: "shared",
        icon: IconProp.Globe,
      };
      const alpha: CardSelectOption = {
        value: "Alpha",
        title: "Alpha",
        description: "shared",
        icon: IconProp.Globe,
      };

      renderComponent({ options: [beta, alpha], searchable: true });

      typeSearch("shared");

      expect(renderedTitles()).toEqual([
        "card-select-option-Alpha",
        "card-select-option-Beta",
      ]);
    });
  });

  describe("catalog layout", () => {
    describe("on opening", () => {
      test("lists only the common choices, in the catalog's order", () => {
        renderCatalog();

        expect(shownValues()).toEqual(["Ping", "Website"]);
      });

      test("draws them as compact rows, at most two to a line", () => {
        renderCatalog();

        const row: HTMLElement = screen.getByTestId(
          "card-select-option-Website",
        );

        expect(row).toHaveClass("px-3", "py-2.5");
        expect(row).not.toHaveClass("p-4");
        expect(screen.getByTestId("card-select-common")).toHaveClass(
          "grid-cols-1",
          "sm:grid-cols-2",
        );
        expect(screen.getByTestId("card-select-common")).not.toHaveClass(
          "lg:grid-cols-3",
        );
      });

      test("holds every other option back behind the More button", () => {
        renderCatalog();

        expect(
          screen.queryByTestId("card-select-option-Kubernetes"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("card-select-option-IP"),
        ).not.toBeInTheDocument();

        const more: HTMLElement = screen.getByTestId("card-select-more");

        expect(more).toHaveTextContent("More monitor types");
        expect(more).toHaveAttribute("aria-expanded", "false");
      });

      /*
       * The wall the maintainer pointed at: a heading for every category,
       * each with a count beside it, before anything could be picked.
       */
      test("shows no group heading and no count", () => {
        renderCatalog();

        for (const label of [
          "Basic Monitoring",
          "Infrastructure",
          "Database Monitoring",
          "Other",
        ]) {
          expect(screen.queryByText(label)).not.toBeInTheDocument();
        }

        expect(
          screen.queryByTestId("card-select-more-options"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("card-select-more")).not.toHaveTextContent(
          /\d/,
        );
      });

      test("says nothing about how many there are to choose from", () => {
        renderCatalog({ searchable: true });

        const summary: HTMLElement = screen.getByTestId(
          "card-select-search-summary",
        );

        expect(summary).toBeEmptyDOMElement();
        // Still the live region a search's result count is read out from.
        expect(summary).toHaveAttribute("role", "status");
        expect(screen.queryByText(/to choose from/)).not.toBeInTheDocument();
      });

      test("is a radiogroup labelled by its field, nothing checked", () => {
        renderCatalog();

        expect(screen.getByRole("radiogroup")).toHaveAttribute(
          "aria-labelledby",
          "monitor-type-label",
        );

        for (const radio of screen.getAllByRole("radio")) {
          expect(radio).toHaveAttribute("aria-checked", "false");
        }
      });

      test("shows no summary while nothing is picked", () => {
        renderCatalog();

        expect(
          screen.queryByTestId("card-select-summary"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("card-select-change"),
        ).not.toBeInTheDocument();
      });
    });

    describe("More", () => {
      test("shows every other option under its own group's heading", () => {
        renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-more"));

        const moreOptions: HTMLElement = screen.getByTestId(
          "card-select-more-options",
        );

        for (const label of [
          "Basic Monitoring",
          "Infrastructure",
          "Database Monitoring",
          "Other",
        ]) {
          expect(within(moreOptions).getByText(label)).toBeVisible();
        }

        expect(
          within(screen.getByTestId("card-select-group-Infrastructure")).getByTestId(
            "card-select-option-Kubernetes",
          ),
        ).toBeVisible();
        expect(
          within(screen.getByTestId("card-select-group-Basic Monitoring")).getByTestId(
            "card-select-option-IP",
          ),
        ).toBeVisible();
      });

      test("lists no common choice twice", () => {
        renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-more"));

        expect(shownValues()).toEqual([
          "Ping",
          "Website",
          "IP",
          "Kubernetes",
          "SQL Query",
          "Manual",
        ]);
      });

      test("its headings are the group names alone, with no count", () => {
        renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-more"));

        const heading: HTMLElement = within(
          screen.getByTestId("card-select-group-Infrastructure"),
        ).getByText("Infrastructure");

        expect(heading.textContent).toBe("Infrastructure");
      });

      test("drops a group whose every option is a common one", () => {
        renderCatalog({
          catalog: { ...CATALOG, commonOptionValues: ["Kubernetes", "Ping"] },
        });

        fireEvent.click(screen.getByTestId("card-select-more"));

        expect(
          screen.queryByTestId("card-select-group-Infrastructure"),
        ).not.toBeInTheDocument();
        expect(
          screen.getAllByTestId("card-select-option-Kubernetes"),
        ).toHaveLength(1);
      });

      test("is pressed once: the button goes, and focus lands on the first option it brought", () => {
        renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-more"));

        expect(
          screen.queryByTestId("card-select-more"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("card-select-option-IP")).toHaveFocus();
      });

      test("names the part of the page it shows", () => {
        renderCatalog();

        const more: HTMLElement = screen.getByTestId("card-select-more");
        const controls: string | null = more.getAttribute("aria-controls");

        expect(controls).toBeTruthy();

        fireEvent.click(more);

        expect(screen.getByTestId("card-select-more-options")).toHaveAttribute(
          "id",
          controls!,
        );
      });

      test("a catalog with nothing beyond its common choices has no More button", () => {
        renderCatalog({
          catalog: {
            ...CATALOG,
            commonOptionValues: [
              "Website",
              "Ping",
              "IP",
              "Kubernetes",
              "SQL Query",
              "Manual",
            ],
          },
        });

        expect(
          screen.queryByTestId("card-select-more"),
        ).not.toBeInTheDocument();
        expect(shownValues()).toHaveLength(6);
      });

      test("arrows walk on from the common rows into what More brought", () => {
        renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-more"));

        const lastCommon: HTMLElement = screen.getByTestId(
          "card-select-option-Website",
        );

        lastCommon.focus();
        fireEvent.keyDown(lastCommon, { key: "ArrowDown" });

        expect(screen.getByTestId("card-select-option-IP")).toHaveFocus();
      });

      test("an option More brought can be picked", () => {
        const { onChange } = renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-more"));
        fireEvent.click(screen.getByTestId("card-select-option-Kubernetes"));

        expect(onChange).toHaveBeenCalledWith("Kubernetes");
      });
    });

    describe("search", () => {
      test("runs over the whole catalog, not only the common choices", () => {
        renderCatalog({ searchable: true });

        typeSearch("k8s");

        expect(shownValues()).toEqual(["Kubernetes"]);
      });

      test("hides the More button while it runs, and clearing it brings the button back", () => {
        renderCatalog({ searchable: true });

        typeSearch("k8s");

        expect(
          screen.queryByTestId("card-select-more"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("card-select-common"),
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId("card-select-search-clear"));

        expect(screen.getByTestId("card-select-more")).toBeVisible();
        expect(shownValues()).toEqual(["Ping", "Website"]);
      });

      test("shows its results as compact rows", () => {
        renderCatalog({ searchable: true });

        typeSearch("k8s");

        expect(
          screen.getByTestId("card-select-option-Kubernetes"),
        ).toHaveClass("px-3", "py-2.5");
      });

      test("says how many it shows out of the whole catalog", () => {
        renderCatalog({ searchable: true });

        typeSearch("k8s");

        expect(
          screen.getByTestId("card-select-search-summary"),
        ).toHaveTextContent("Showing 1 of 6");
      });

      test("Enter picks the top result and shrinks the picker to it", () => {
        const { onChange } = renderCatalog({ searchable: true });

        typeSearch("k8s");
        fireEvent.keyDown(screen.getByTestId("card-select-search"), {
          key: "Enter",
        });

        expect(onChange).toHaveBeenCalledWith("Kubernetes");
        expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
          "data-card-select-value",
          "Kubernetes",
        );
      });
    });

    describe("a pick", () => {
      test("reports the value", () => {
        const { onChange } = renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-option-Website"));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith("Website");
      });

      test("shrinks the picker to the choice: its title, its description and Change", () => {
        renderCatalog({ searchable: true });

        fireEvent.click(screen.getByTestId("card-select-option-Website"));

        const summary: HTMLElement = screen.getByTestId("card-select-summary");

        expect(summary).toHaveAttribute("data-card-select-value", "Website");
        expect(
          within(summary).getByTestId("card-select-summary-title"),
        ).toHaveTextContent("Website");
        expect(summary).toHaveTextContent("Check a page loads and responds.");
        expect(within(summary).getByTestId("card-select-change")).toHaveTextContent(
          "Change",
        );

        // Nothing else of the picker is left on screen.
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(screen.queryAllByRole("radio")).toEqual([]);
        expect(
          screen.queryByTestId("card-select-search"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("card-select-more"),
        ).not.toBeInTheDocument();
      });

      test("the summary is a group labelled by the field", () => {
        renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-option-Website"));

        const summary: HTMLElement = screen.getByTestId("card-select-summary");

        expect(summary).toHaveAttribute("role", "group");
        expect(summary).toHaveAttribute(
          "aria-labelledby",
          "monitor-type-label",
        );
      });

      test("Change says which choice it would change", () => {
        renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-option-Website"));

        const change: HTMLElement = screen.getByTestId("card-select-change");
        const describedBy: string | null =
          change.getAttribute("aria-describedby");

        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy!)).toHaveTextContent(
          "Website",
        );
      });

      /*
       * The card that had focus is gone once the picker shrinks; focus goes
       * to Change, where the picker was, instead of falling back to the page.
       */
      test("moves focus to Change", () => {
        renderCatalog();

        const row: HTMLElement = screen.getByTestId("card-select-option-Website");

        row.focus();
        fireEvent.click(row);

        expect(screen.getByTestId("card-select-change")).toHaveFocus();
      });

      test("made from the keyboard moves focus to Change too", () => {
        const { onChange } = renderCatalog();

        const row: HTMLElement = screen.getByTestId("card-select-option-Ping");

        row.focus();
        fireEvent.keyDown(row, { key: "Enter" });

        expect(onChange).toHaveBeenCalledWith("Ping");
        expect(screen.getByTestId("card-select-change")).toHaveFocus();
      });
    });

    describe("Change", () => {
      test("opens the picker again, the choice still checked, focus in the search box", () => {
        renderCatalog({ searchable: true });

        fireEvent.click(screen.getByTestId("card-select-option-Website"));
        fireEvent.click(screen.getByTestId("card-select-change"));

        expect(
          screen.queryByTestId("card-select-summary"),
        ).not.toBeInTheDocument();
        expect(screen.getByTestId("card-select-option-Website")).toHaveAttribute(
          "aria-checked",
          "true",
        );
        expect(screen.getByTestId("card-select-search")).toHaveFocus();
      });

      test("without a search box, focus goes to the checked option", () => {
        renderCatalog({ searchable: false });

        fireEvent.click(screen.getByTestId("card-select-option-Website"));
        fireEvent.click(screen.getByTestId("card-select-change"));

        expect(screen.getByTestId("card-select-option-Website")).toHaveFocus();
      });

      /*
       * onChange resets what the form built on the choice (the criteria a
       * monitor type seeded), so picking the same choice again must not
       * fire it.
       */
      test("picking the choice already made only closes the picker again", () => {
        const { onChange } = renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-option-Website"));
        fireEvent.click(screen.getByTestId("card-select-change"));
        fireEvent.click(screen.getByTestId("card-select-option-Website"));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
          "data-card-select-value",
          "Website",
        );
        expect(screen.getByTestId("card-select-change")).toHaveFocus();
      });

      test("picking another choice reports it and shows it", () => {
        const { onChange } = renderCatalog();

        fireEvent.click(screen.getByTestId("card-select-option-Website"));
        fireEvent.click(screen.getByTestId("card-select-change"));
        fireEvent.click(screen.getByTestId("card-select-option-Ping"));

        expect(onChange).toHaveBeenLastCalledWith("Ping");
        expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
          "data-card-select-value",
          "Ping",
        );
      });

      test("Escape keeps the choice made and goes back to it, focus on Change", () => {
        const { onChange } = renderCatalog({ searchable: true });

        fireEvent.click(screen.getByTestId("card-select-option-Website"));
        fireEvent.click(screen.getByTestId("card-select-change"));
        fireEvent.keyDown(screen.getByTestId("card-select-search"), {
          key: "Escape",
        });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
          "data-card-select-value",
          "Website",
        );
        expect(screen.getByTestId("card-select-change")).toHaveFocus();
      });

      test("that Escape does not reach a dialog the picker sits in", () => {
        const { onParentKeyDown } = renderCatalog({ searchable: true });

        fireEvent.click(screen.getByTestId("card-select-option-Website"));
        fireEvent.click(screen.getByTestId("card-select-change"));
        fireEvent.keyDown(screen.getByTestId("card-select-search"), {
          key: "Escape",
        });

        expect(onParentKeyDown).not.toHaveBeenCalledWith("Escape");
      });

      // Nothing to go back to: a dialog's own Escape still closes it.
      test("Escape before anything is picked is left to the dialog", () => {
        const { onParentKeyDown } = renderCatalog({ searchable: true });

        fireEvent.keyDown(screen.getByTestId("card-select-search"), {
          key: "Escape",
        });

        expect(onParentKeyDown).toHaveBeenCalledWith("Escape");
      });

      test("Escape with words in the search clears them first, keeping the picker open", () => {
        renderCatalog({ searchable: true });

        fireEvent.click(screen.getByTestId("card-select-option-Website"));
        fireEvent.click(screen.getByTestId("card-select-change"));
        typeSearch("k8s");
        fireEvent.keyDown(screen.getByTestId("card-select-search"), {
          key: "Escape",
        });

        expect(screen.getByTestId("card-select-search")).toHaveValue("");
        expect(
          screen.queryByTestId("card-select-summary"),
        ).not.toBeInTheDocument();
        expect(shownValues()).toEqual(["Ping", "Website"]);
      });

      test("a choice More holds back is on screen without pressing More", () => {
        renderCatalog({ initialValue: "Kubernetes" });

        expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
          "data-card-select-value",
          "Kubernetes",
        );

        fireEvent.click(screen.getByTestId("card-select-change"));

        expect(
          screen.getByTestId("card-select-option-Kubernetes"),
        ).toHaveAttribute("aria-checked", "true");
        expect(
          screen.queryByTestId("card-select-more"),
        ).not.toBeInTheDocument();
      });

      test("a pick clears what was typed, so the next Change starts on the common choices", () => {
        renderCatalog({ searchable: true });

        typeSearch("k8s");
        fireEvent.click(screen.getByTestId("card-select-option-Kubernetes"));
        fireEvent.click(screen.getByTestId("card-select-change"));

        expect(screen.getByTestId("card-select-search")).toHaveValue("");
        expect(screen.getByTestId("card-select-common")).toBeVisible();
      });
    });

    describe("coming back to a form that already holds a choice", () => {
      test("shows the choice, not the catalog", () => {
        renderCatalog({ initialValue: "Ping" });

        expect(screen.getByTestId("card-select-summary")).toHaveAttribute(
          "data-card-select-value",
          "Ping",
        );
        expect(screen.queryAllByRole("radio")).toEqual([]);
      });

      /*
       * A monitor type the picker no longer offers (Server, Profiles) has
       * nothing to summarise; the picker stays open with nothing checked.
       */
      test("a value no option carries leaves the picker open, nothing checked", () => {
        renderCatalog({ initialValue: "Server" });

        expect(
          screen.queryByTestId("card-select-summary"),
        ).not.toBeInTheDocument();
        expect(shownValues()).toEqual(["Ping", "Website"]);

        for (const radio of screen.getAllByRole("radio")) {
          expect(radio).toHaveAttribute("aria-checked", "false");
        }
      });
    });

    describe("errors", () => {
      test("show under the picker", () => {
        renderCatalog({ error: "Monitor Type is required" });

        expect(screen.getByRole("alert")).toHaveTextContent(
          "Monitor Type is required",
        );
      });

      test("and under the summary", () => {
        renderCatalog({
          initialValue: "Website",
          error: "Monitor Type is required",
        });

        expect(screen.getByTestId("card-select-summary")).toBeVisible();
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Monitor Type is required",
        );
      });
    });
  });

  describe("getCardSelectSearchTokens", () => {
    test("splits into lower case words, ignoring runs of whitespace", () => {
      expect(getCardSelectSearchTokens("  SSL   Cert ")).toEqual([
        "ssl",
        "cert",
      ]);
    });

    test("is empty when nothing was typed", () => {
      expect(getCardSelectSearchTokens("")).toEqual([]);
      expect(getCardSelectSearchTokens("   ")).toEqual([]);
    });
  });

  describe("cardSelectOptionMatchesSearch", () => {
    test("matches everything when nothing was typed", () => {
      expect(cardSelectOptionMatchesSearch(website, [])).toBe(true);
    });

    test("matches on a keyword", () => {
      expect(cardSelectOptionMatchesSearch(kubernetes, ["k8s"])).toBe(true);
    });

    test("matches on the group label when one is given", () => {
      expect(
        cardSelectOptionMatchesSearch(kubernetes, ["infra"], "Infrastructure"),
      ).toBe(true);
    });

    test("does not match on a group label that was not given", () => {
      expect(cardSelectOptionMatchesSearch(kubernetes, ["infra"])).toBe(false);
    });

    test("requires every word", () => {
      expect(cardSelectOptionMatchesSearch(kubernetes, ["k8s", "pod"])).toBe(
        true,
      );
      expect(
        cardSelectOptionMatchesSearch(kubernetes, ["k8s", "mainframe"]),
      ).toBe(false);
    });

    test("copes with an option carrying no keywords at all", () => {
      expect(cardSelectOptionMatchesSearch(manual, ["manual"])).toBe(true);
      expect(cardSelectOptionMatchesSearch(manual, ["k8s"])).toBe(false);
    });
  });

  describe("getCardSelectOptionSearchScore", () => {
    test("scores nothing when nothing was typed", () => {
      expect(getCardSelectOptionSearchScore(website, [])).toBe(0);
    });

    test("scores an exact title above a title it merely starts", () => {
      const exact: number = getCardSelectOptionSearchScore(website, [
        "website",
      ]);
      const prefix: number = getCardSelectOptionSearchScore(website, ["web"]);

      expect(exact).toBeGreaterThan(prefix);
    });

    test("scores an exact keyword above a keyword it merely starts", () => {
      const exact: number = getCardSelectOptionSearchScore(sqlQuery, [
        "postgres",
      ]);
      const prefix: number = getCardSelectOptionSearchScore(sqlQuery, ["post"]);

      expect(exact).toBeGreaterThan(prefix);
    });

    test("adds up the words typed", () => {
      const oneWord: number = getCardSelectOptionSearchScore(kubernetes, [
        "k8s",
      ]);
      const twoWords: number = getCardSelectOptionSearchScore(kubernetes, [
        "k8s",
        "pod",
      ]);

      expect(twoWords).toBeGreaterThan(oneWord);
    });

    test("counts the group label when one is given", () => {
      const withLabel: number = getCardSelectOptionSearchScore(
        kubernetes,
        ["infrastructure"],
        "Infrastructure",
      );

      expect(withLabel).toBeGreaterThan(0);
      expect(
        getCardSelectOptionSearchScore(kubernetes, ["infrastructure"]),
      ).toBe(0);
    });
  });

  describe("normalizeCardSelectGroups", () => {
    test("keeps groups as they are", () => {
      expect(normalizeCardSelectGroups([basicGroup])).toEqual([
        { label: "Basic Monitoring", options: [website] },
      ]);
    });

    test("gathers a run of flat options into one unlabelled group", () => {
      expect(normalizeCardSelectGroups([website, kubernetes])).toEqual([
        { label: null, options: [website, kubernetes] },
      ]);
    });

    test("flushes the flat options before each group it precedes", () => {
      expect(
        normalizeCardSelectGroups([manual, basicGroup, kubernetes]),
      ).toEqual([
        { label: null, options: [manual] },
        { label: "Basic Monitoring", options: [website] },
        { label: null, options: [kubernetes] },
      ]);
    });

    test("returns nothing for nothing", () => {
      expect(normalizeCardSelectGroups([])).toEqual([]);
    });
  });

  describe("getCardSelectCatalogSections", () => {
    test("takes the common choices out, in the order the catalog names them", () => {
      const sections: ReturnType<typeof getCardSelectCatalogSections> =
        getCardSelectCatalogSections({
          options: catalogOptions,
          commonOptionValues: ["Manual", "Website"],
        });

      expect(sections.commonOptions).toEqual([manual, website]);
    });

    test("keeps every other option under its own group, in the groups' order", () => {
      const sections: ReturnType<typeof getCardSelectCatalogSections> =
        getCardSelectCatalogSections({
          options: catalogOptions,
          commonOptionValues: ["Website"],
        });

      expect(sections.moreGroups).toEqual([
        { label: "Basic Monitoring", options: [ping, ip] },
        { label: "Infrastructure", options: [kubernetes] },
        { label: "Database Monitoring", options: [sqlQuery] },
        { label: "Other", options: [manual] },
      ]);
    });

    test("drops a group left with nothing in it", () => {
      const sections: ReturnType<typeof getCardSelectCatalogSections> =
        getCardSelectCatalogSections({
          options: catalogOptions,
          commonOptionValues: ["Kubernetes", "Manual"],
        });

      expect(
        sections.moreGroups.map(
          (group: { label: string | null }): string | null => {
            return group.label;
          },
        ),
      ).toEqual(["Basic Monitoring", "Database Monitoring"]);
    });

    test("skips a common value no option carries, and a repeat", () => {
      const sections: ReturnType<typeof getCardSelectCatalogSections> =
        getCardSelectCatalogSections({
          options: catalogOptions,
          commonOptionValues: ["Server", "Ping", "Ping"],
        });

      expect(sections.commonOptions).toEqual([ping]);
    });

    test("reads flat options the way the plain layout does", () => {
      const sections: ReturnType<typeof getCardSelectCatalogSections> =
        getCardSelectCatalogSections({
          options: [website, kubernetes],
          commonOptionValues: ["Kubernetes"],
        });

      expect(sections.commonOptions).toEqual([kubernetes]);
      expect(sections.moreGroups).toEqual([
        { label: null, options: [website] },
      ]);
    });

    test("with no common values, everything waits behind More", () => {
      const sections: ReturnType<typeof getCardSelectCatalogSections> =
        getCardSelectCatalogSections({
          options: catalogOptions,
          commonOptionValues: [],
        });

      expect(sections.commonOptions).toEqual([]);
      expect(sections.moreGroups).toHaveLength(4);
    });
  });

  describe("isCardSelectOptionGroup", () => {
    test("tells a group from an option", () => {
      expect(isCardSelectOptionGroup(basicGroup)).toBe(true);
      expect(isCardSelectOptionGroup(website)).toBe(false);
    });
  });

  /*
   * A short choice inside a dialog - the measurement form's four ready-made
   * measurements - reads better as two wide columns than as three narrow
   * ones whose titles wrap.
   */
  describe("columns", () => {
    type GridFunction = () => HTMLElement;

    const grid: GridFunction = (): HTMLElement => {
      return screen.getByTestId("card-select-option-Website")
        .parentElement as HTMLElement;
    };

    test("up to three side by side when nothing is asked for", () => {
      renderComponent({ options: [website, kubernetes, manual] });

      expect(grid()).toHaveClass(
        "grid-cols-1",
        "sm:grid-cols-2",
        "lg:grid-cols-3",
      );
    });

    test("at most two side by side with maxColumns 2", () => {
      renderComponent({
        options: [website, kubernetes, manual],
        maxColumns: 2,
      });

      expect(grid()).toHaveClass("grid-cols-1", "sm:grid-cols-2");
      expect(grid()).not.toHaveClass("lg:grid-cols-3");
    });

    test("one a row wins over maxColumns", () => {
      renderComponent({
        options: [website, kubernetes, manual],
        maxColumns: 2,
        singleColumn: true,
      });

      expect(grid()).toHaveClass("grid-cols-1");
      expect(grid()).not.toHaveClass("sm:grid-cols-2");
    });
  });
});
