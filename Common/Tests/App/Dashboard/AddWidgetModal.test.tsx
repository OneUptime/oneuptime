import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import AddWidgetModal from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/AddWidgetModal";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

/**
 * What the picker reported back to the dashboard: the widget types it asked to
 * add, in order, and how many times it asked to be closed.
 */
interface ModalCalls {
  added: Array<DashboardComponentType>;
  closed: number;
}

type RenderModalFunction = () => ModalCalls;

const renderModal: RenderModalFunction = (): ModalCalls => {
  const calls: ModalCalls = { added: [], closed: 0 };

  render(
    <AddWidgetModal
      onAddComponentClick={(type: DashboardComponentType) => {
        calls.added.push(type);
      }}
      onClose={() => {
        calls.closed = calls.closed + 1;
      }}
    />,
  );

  return calls;
};

type GetSearchInputFunction = () => HTMLInputElement;

const getSearchInput: GetSearchInputFunction = (): HTMLInputElement => {
  return screen.getByTestId("add-widget-search") as HTMLInputElement;
};

type TypeSearchFunction = (value: string) => void;

const typeSearch: TypeSearchFunction = (value: string): void => {
  fireEvent.change(getSearchInput(), { target: { value: value } });
};

type GetVisibleWidgetTypesFunction = () => Array<string>;

/**
 * Widget types of every card currently rendered in the grid, in DOM order.
 */
const getVisibleWidgetTypes: GetVisibleWidgetTypesFunction =
  (): Array<string> => {
    return screen
      .queryAllByTestId(/^widget-card-/)
      .map((element: HTMLElement) => {
        return (element.getAttribute("data-testid") || "").replace(
          "widget-card-",
          "",
        );
      });
  };

type GetRailCategoryNamesFunction = () => Array<string>;

const getRailCategoryNames: GetRailCategoryNamesFunction =
  (): Array<string> => {
    return screen
      .queryAllByTestId(/^widget-category-/)
      .map((element: HTMLElement) => {
        return (element.getAttribute("data-testid") || "").replace(
          "widget-category-",
          "",
        );
      })
      .filter((name: string) => {
        return name !== "all";
      });
  };

const ALL_COMPONENT_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
);

type GetCategoryFunction = (name: string) => WidgetCatalogCategory;

const getCategory: GetCategoryFunction = (
  name: string,
): WidgetCatalogCategory => {
  const category: WidgetCatalogCategory | undefined = WIDGET_CATALOG.find(
    (candidate: WidgetCatalogCategory) => {
      return candidate.name === name;
    },
  );

  if (!category) {
    throw new Error(`Category "${name}" is missing from the widget catalog.`);
  }

  return category;
};

type GetTypesInFunction = (name: string) => Array<string>;

const getTypesIn: GetTypesInFunction = (name: string): Array<string> => {
  return getCategory(name).items.map((item: WidgetCatalogItem) => {
    return item.type.toString();
  });
};

describe("AddWidgetModal", () => {
  describe("default view", () => {
    test("renders the picker heading and search box", () => {
      renderModal();

      expect(screen.getByText("Add Widget")).toBeInTheDocument();
      expect(
        screen.getByText("Pick a widget to add to your dashboard."),
      ).toBeInTheDocument();
      expect(getSearchInput()).toBeInTheDocument();
    });

    test("renders a card for every widget in the catalog", () => {
      renderModal();

      expect(getVisibleWidgetTypes()).toHaveLength(ALL_COMPONENT_TYPES.length);

      for (const type of ALL_COMPONENT_TYPES) {
        expect(screen.getByTestId(`widget-card-${type}`)).toBeInTheDocument();
      }
    });

    test("leads with Essentials — Text, Clock, and HTML", () => {
      renderModal();

      expect(getVisibleWidgetTypes().slice(0, 3)).toEqual([
        DashboardComponentType.Text,
        DashboardComponentType.Clock,
        DashboardComponentType.Html,
      ]);
    });

    test("lists every catalog category in the rail, in catalog order", () => {
      renderModal();

      expect(getRailCategoryNames()).toEqual(
        WIDGET_CATALOG.map((category: WidgetCatalogCategory) => {
          return category.name;
        }),
      );
    });

    test("renders the rail group headings", () => {
      renderModal();

      expect(screen.getByText("General")).toBeInTheDocument();
      expect(screen.getByText("Observability")).toBeInTheDocument();
      expect(screen.getByText("Infrastructure")).toBeInTheDocument();
    });

    test("shows the widget count next to each rail category", () => {
      renderModal();

      expect(screen.getByTestId("widget-category-Essentials").textContent).toBe(
        "Essentials3",
      );
      expect(screen.getByTestId("widget-category-Metrics").textContent).toBe(
        "Metrics4",
      );
      expect(screen.getByTestId("widget-category-Kubernetes").textContent).toBe(
        "Kubernetes8",
      );
    });

    test("selects All widgets by default and shows the catalog total", () => {
      renderModal();

      const allButton: HTMLElement = screen.getByTestId("widget-category-all");

      expect(allButton).toHaveAttribute("aria-pressed", "true");
      expect(allButton.textContent).toBe(
        `All widgets${ALL_COMPONENT_TYPES.length}`,
      );
      expect(screen.getByTestId("widget-category-Metrics")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    test("shows neither a result count nor the empty state before searching", () => {
      renderModal();

      expect(
        screen.queryByTestId("add-widget-result-count"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("add-widget-empty")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("add-widget-search-clear"),
      ).not.toBeInTheDocument();
    });
  });

  describe("category rail", () => {
    test("narrows the grid to the selected category", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Metrics"));

      expect(getVisibleWidgetTypes()).toEqual(getTypesIn("Metrics"));
      expect(
        screen.queryByTestId(`widget-card-${DashboardComponentType.Text}`),
      ).not.toBeInTheDocument();
    });

    test("moves the pressed state onto the selected category", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Logs"));

      expect(screen.getByTestId("widget-category-Logs")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("widget-category-all")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    test("restores the full catalog when All widgets is clicked", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Logs"));
      expect(getVisibleWidgetTypes()).toEqual(getTypesIn("Logs"));

      fireEvent.click(screen.getByTestId("widget-category-all"));

      expect(getVisibleWidgetTypes()).toHaveLength(ALL_COMPONENT_TYPES.length);
      expect(screen.getByTestId("widget-category-all")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    test("keeps identically-labelled widgets in different categories apart", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Docker"));
      expect(getVisibleWidgetTypes()).toEqual(getTypesIn("Docker"));

      fireEvent.click(screen.getByTestId("widget-category-Podman"));
      expect(getVisibleWidgetTypes()).toEqual(getTypesIn("Podman"));
    });

    test("keeps every rail category reachable while a category is selected", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Ceph"));

      expect(getRailCategoryNames()).toHaveLength(WIDGET_CATALOG.length);
    });
  });

  describe("adding a widget", () => {
    test("reports the clicked widget type and closes the picker", () => {
      const calls: ModalCalls = renderModal();

      fireEvent.click(
        screen.getByTestId(`widget-card-${DashboardComponentType.Gauge}`),
      );

      expect(calls.added).toEqual([DashboardComponentType.Gauge]);
      expect(calls.closed).toBe(1);
    });

    test("adds the right widget when two categories share a label", () => {
      const calls: ModalCalls = renderModal();

      fireEvent.click(
        screen.getByTestId(
          `widget-card-${DashboardComponentType.PodmanVolumeList}`,
        ),
      );

      expect(calls.added).toEqual([DashboardComponentType.PodmanVolumeList]);
    });

    test("adds a widget found through search", () => {
      const calls: ModalCalls = renderModal();

      typeSearch("cronjob");
      fireEvent.click(
        screen.getByTestId(
          `widget-card-${DashboardComponentType.KubernetesCronJobList}`,
        ),
      );

      expect(calls.added).toEqual([
        DashboardComponentType.KubernetesCronJobList,
      ]);
      expect(calls.closed).toBe(1);
    });

    test("does not add anything when the picker is only opened", () => {
      const calls: ModalCalls = renderModal();

      expect(calls.added).toEqual([]);
      expect(calls.closed).toBe(0);
    });
  });

  describe("search", () => {
    test("narrows the grid to matching widgets", () => {
      renderModal();

      typeSearch("gauge");

      // Both gauge widgets: the metrics one and the external Data Source one.
      expect(getVisibleWidgetTypes()).toEqual([
        DashboardComponentType.Gauge,
        DashboardComponentType.DataSourceGauge,
      ]);
    });

    test("announces how many widgets matched", () => {
      renderModal();

      typeSearch("gauge");

      expect(screen.getByTestId("add-widget-result-count")).toHaveTextContent(
        "2 widgets match",
      );

      typeSearch("docker");

      expect(screen.getByTestId("add-widget-result-count")).toHaveTextContent(
        `${
          getTypesIn("Docker").length + getTypesIn("Docker Swarm").length
        } widgets match`,
      );
    });

    test("is case insensitive", () => {
      renderModal();

      typeSearch("GAUGE");

      expect(getVisibleWidgetTypes()).toEqual([
        DashboardComponentType.Gauge,
        DashboardComponentType.DataSourceGauge,
      ]);
    });

    test("finds widgets by keywords that are not shown on the card", () => {
      renderModal();

      typeSearch("error budget");

      expect(getVisibleWidgetTypes()).toEqual([DashboardComponentType.Slo]);
    });

    test("narrows further with each additional word", () => {
      renderModal();

      // "volume" also hits the Log Chart card, which is about log volume.
      typeSearch("volume");
      expect(getVisibleWidgetTypes()).toEqual([
        DashboardComponentType.LogChart,
        DashboardComponentType.DockerVolumeList,
        DashboardComponentType.PodmanVolumeList,
      ]);

      typeSearch("podman volume");
      expect(getVisibleWidgetTypes()).toEqual([
        DashboardComponentType.PodmanVolumeList,
      ]);
    });

    test("matches a whole category by name", () => {
      renderModal();

      typeSearch("kubernetes");

      expect(getVisibleWidgetTypes()).toEqual(getTypesIn("Kubernetes"));
    });

    test("hides rail categories that have no matches and re-counts the rest", () => {
      renderModal();

      typeSearch("kubernetes");

      expect(getRailCategoryNames()).toEqual(["Kubernetes"]);
      expect(screen.getByTestId("widget-category-all").textContent).toBe(
        `All widgets${getTypesIn("Kubernetes").length}`,
      );
    });

    test("re-counts a rail category down to its matching widgets", () => {
      renderModal();

      typeSearch("gauge");

      expect(screen.getByTestId("widget-category-Metrics").textContent).toBe(
        "Metrics1",
      );
    });

    test("shows the empty state when nothing matches", () => {
      renderModal();

      typeSearch("zzzzz-not-a-widget");

      expect(screen.getByTestId("add-widget-empty")).toBeInTheDocument();
      expect(
        screen.getByText(/No widgets match .*zzzzz-not-a-widget/),
      ).toBeInTheDocument();
      expect(getVisibleWidgetTypes()).toEqual([]);
      expect(
        screen.queryByTestId("add-widget-result-count"),
      ).not.toBeInTheDocument();
    });

    test("restores the catalog from the empty state's Clear search button", () => {
      renderModal();

      typeSearch("zzzzz-not-a-widget");
      fireEvent.click(screen.getByTestId("add-widget-empty-clear"));

      expect(getSearchInput().value).toBe("");
      expect(getVisibleWidgetTypes()).toHaveLength(ALL_COMPONENT_TYPES.length);
      expect(screen.queryByTestId("add-widget-empty")).not.toBeInTheDocument();
    });

    test("restores the catalog from the inline clear button", () => {
      renderModal();

      typeSearch("gauge");
      fireEvent.click(screen.getByTestId("add-widget-search-clear"));

      expect(getSearchInput().value).toBe("");
      expect(getVisibleWidgetTypes()).toHaveLength(ALL_COMPONENT_TYPES.length);
      expect(
        screen.queryByTestId("add-widget-search-clear"),
      ).not.toBeInTheDocument();
    });

    test("treats a whitespace-only search as no search", () => {
      renderModal();

      typeSearch("   ");

      expect(getVisibleWidgetTypes()).toHaveLength(ALL_COMPONENT_TYPES.length);
      expect(
        screen.queryByTestId("add-widget-result-count"),
      ).not.toBeInTheDocument();
    });

    test("keeps the category filter when the selection still has matches", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Docker"));
      typeSearch("registry");

      expect(getVisibleWidgetTypes()).toEqual([
        DashboardComponentType.DockerImageList,
      ]);
    });

    test("falls back to every match when the selected category is filtered away", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Metrics"));
      typeSearch("kubernetes");

      expect(getVisibleWidgetTypes()).toEqual(getTypesIn("Kubernetes"));
      expect(screen.getByTestId("widget-category-all")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    test("picks the selected category back up once it matches again", () => {
      renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Metrics"));
      typeSearch("kubernetes");
      typeSearch("gauge");

      expect(getVisibleWidgetTypes()).toEqual([DashboardComponentType.Gauge]);
      expect(screen.getByTestId("widget-category-Metrics")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("keyboard", () => {
    test("adds the top match when Enter is pressed while searching", () => {
      const calls: ModalCalls = renderModal();

      typeSearch("trace");
      fireEvent.keyDown(getSearchInput(), { key: "Enter" });

      expect(calls.added).toEqual([DashboardComponentType.TraceList]);
      expect(calls.closed).toBe(1);
    });

    test("respects the selected category when Enter is pressed", () => {
      const calls: ModalCalls = renderModal();

      fireEvent.click(screen.getByTestId("widget-category-Podman"));
      typeSearch("volume");
      fireEvent.keyDown(getSearchInput(), { key: "Enter" });

      expect(calls.added).toEqual([DashboardComponentType.PodmanVolumeList]);
    });

    test("does nothing when Enter is pressed with an empty search", () => {
      const calls: ModalCalls = renderModal();

      fireEvent.keyDown(getSearchInput(), { key: "Enter" });

      expect(calls.added).toEqual([]);
      expect(calls.closed).toBe(0);
    });

    test("does nothing when Enter is pressed with no matches", () => {
      const calls: ModalCalls = renderModal();

      typeSearch("zzzzz-not-a-widget");
      fireEvent.keyDown(getSearchInput(), { key: "Enter" });

      expect(calls.added).toEqual([]);
      expect(calls.closed).toBe(0);
    });

    test("ignores other keys", () => {
      const calls: ModalCalls = renderModal();

      typeSearch("trace");
      fireEvent.keyDown(getSearchInput(), { key: "a" });

      expect(calls.added).toEqual([]);
      expect(calls.closed).toBe(0);
    });
  });

  describe("closing", () => {
    test("closes from the Cancel button without adding a widget", () => {
      const calls: ModalCalls = renderModal();

      fireEvent.click(screen.getByTestId("modal-footer-close-button"));

      expect(calls.closed).toBe(1);
      expect(calls.added).toEqual([]);
    });
  });
});
