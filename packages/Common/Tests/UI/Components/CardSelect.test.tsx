import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import getJestMockFunction, { MockFunction } from "../../MockType";
import CardSelect, {
  CardSelectOption,
  CardSelectOptionGroup,
  ComponentProps,
  cardSelectOptionMatchesSearch,
  getCardSelectOptionSearchScore,
  getCardSelectSearchTokens,
  isCardSelectOptionGroup,
  normalizeCardSelectGroups,
} from "../../../UI/Components/CardSelect/CardSelect";

/*
 * CardSelect grew a search box and collapsible groups for the monitor type
 * picker, where 29 cards under nine headings made picking one a scrolling
 * exercise. Both are opt in, so the two callers that do not ask for them -
 * the team role picker and the metrics pipeline rule picker - must keep
 * exactly the plain grid they had. That is what the first block pins.
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

    test("shows no collapse control, so every group stays open", () => {
      renderComponent({});

      expect(
        screen.queryByTestId("card-select-group-Infrastructure"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
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

    test("arrows skip the cards folded away in closed groups", () => {
      renderComponent({ collapsibleGroups: true });

      const first: HTMLElement = screen.getByTestId(
        "card-select-option-Website",
      );

      first.focus();
      fireEvent.keyDown(first, { key: "ArrowRight" });

      // Website is the only card on screen, so there is nowhere to go.
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

  describe("collapsible groups", () => {
    test("opens the first group and closes the rest behind a count", () => {
      renderComponent({ collapsibleGroups: true });

      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(
        screen.queryByTestId("card-select-option-Kubernetes"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("card-select-option-Manual"),
      ).not.toBeInTheDocument();
    });

    test("every group header stays on screen so nothing is hidden outright", () => {
      renderComponent({ collapsibleGroups: true });

      for (const group of groupedOptions) {
        expect(
          screen.getByTestId(`card-select-group-${group.label}`),
        ).toBeVisible();
      }
    });

    test("says how many cards a closed group holds", () => {
      renderComponent({ collapsibleGroups: true });

      expect(
        screen.getByTestId("card-select-group-Infrastructure"),
      ).toHaveTextContent("1");
    });

    test("reports its state to assistive technology", () => {
      renderComponent({ collapsibleGroups: true });

      expect(
        screen.getByTestId("card-select-group-Basic Monitoring"),
      ).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.getByTestId("card-select-group-Infrastructure"),
      ).toHaveAttribute("aria-expanded", "false");
    });

    test("clicking a closed header opens it", () => {
      renderComponent({ collapsibleGroups: true });

      fireEvent.click(screen.getByTestId("card-select-group-Infrastructure"));

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
      expect(
        screen.getByTestId("card-select-group-Infrastructure"),
      ).toHaveAttribute("aria-expanded", "true");
    });

    test("clicking an open header closes it", () => {
      renderComponent({ collapsibleGroups: true });

      fireEvent.click(screen.getByTestId("card-select-group-Basic Monitoring"));

      expect(
        screen.queryByTestId("card-select-option-Website"),
      ).not.toBeInTheDocument();
    });

    /*
     * Re-entering a half-filled form must show the choice already made, not
     * hide it behind a closed heading and look like nothing was picked.
     */
    test("opens the group holding the current selection", () => {
      renderComponent({ collapsibleGroups: true, value: "Manual" });

      expect(screen.getByTestId("card-select-option-Manual")).toBeVisible();
      expect(screen.getByTestId("card-select-group-Other")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });

    test("a group the user closed by hand stays closed", () => {
      renderComponent({ collapsibleGroups: true, value: "Website" });

      fireEvent.click(screen.getByTestId("card-select-group-Basic Monitoring"));

      expect(
        screen.queryByTestId("card-select-option-Website"),
      ).not.toBeInTheDocument();
    });

    test("leaves a run of flat options alone, having no header to collapse", () => {
      renderComponent({
        options: [website, kubernetes],
        collapsibleGroups: true,
      });

      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
    });

    test("a search reaches into closed groups", () => {
      renderComponent({ collapsibleGroups: true, searchable: true });

      typeSearch("k8s");

      expect(screen.getByTestId("card-select-option-Kubernetes")).toBeVisible();
    });

    test("clearing the search puts the groups back as they were", () => {
      renderComponent({ collapsibleGroups: true, searchable: true });

      typeSearch("k8s");
      fireEvent.click(screen.getByTestId("card-select-search-clear"));

      expect(screen.getByTestId("card-select-option-Website")).toBeVisible();
      expect(
        screen.queryByTestId("card-select-option-Kubernetes"),
      ).not.toBeInTheDocument();
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

  describe("isCardSelectOptionGroup", () => {
    test("tells a group from an option", () => {
      expect(isCardSelectOptionGroup(basicGroup)).toBe(true);
      expect(isCardSelectOptionGroup(website)).toBe(false);
    });
  });
});
