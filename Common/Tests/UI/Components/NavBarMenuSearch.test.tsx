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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Mock } from "jest-mock";
import React from "react";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { MoreMenuItem } from "../../../UI/Components/Navbar/NavBar";
import NavBarMenuModal from "../../../UI/Components/Navbar/NavBarMenuModal";
import Navigation from "../../../UI/Utils/Navigation";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
      };
    },
  };
});

const RECENT_STORAGE_KEY: string = "oneuptime-navbar-recent-products";

// Resources are deliberately interleaved with Observability. Keyboard selection
// must follow the grouped order on screen, including after an alias search.
const ITEMS: Array<MoreMenuItem> = [
  {
    title: "Monitors",
    description: "Check uptime and availability.",
    route: new Route("/products/monitors"),
    icon: IconProp.AltGlobe,
    category: "Essentials",
  },
  {
    title: "Real User Monitoring",
    description: "Understand actual visitor behavior.",
    route: new Route("/products/rum"),
    icon: IconProp.Globe,
    category: "Resources",
    keywords: ["RUM", "browser", "telemetry"],
  },
  {
    title: "Logs",
    description: "Investigate application events.",
    route: new Route("/products/logs"),
    icon: IconProp.Logs,
    category: "Observability",
    keywords: ["logging", "telemetry"],
  },
  {
    title: "Kubernetes",
    description: "Explore workload health.",
    route: new Route("/products/kubernetes"),
    icon: IconProp.Kubernetes,
    category: "Resources",
    keywords: ["K8S", "kube", "telemetry"],
  },
  {
    title: "Performance Profiles",
    description: "Find application bottlenecks.",
    route: new Route("/products/profiles"),
    icon: IconProp.Fire,
    category: "Observability",
    keywords: ["flamegraph", "telemetry"],
  },
  {
    title: "Reports [beta]",
    description: "Export historical summaries.",
    route: new Route("/products/reports"),
    icon: IconProp.ChartPie,
    keywords: [],
  },
];

function queryFor(value: string): void {
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value },
  });
}

function resultTitles(): Array<string> {
  return screen.queryAllByRole("option").map((option: HTMLElement): string => {
    return option.querySelector("span.truncate")?.textContent ?? "";
  });
}

function selectedOption(): HTMLElement {
  const option: HTMLElement = screen.getByRole("option", { selected: true });
  expect(screen.getByRole("combobox")).toHaveAttribute(
    "aria-activedescendant",
    option.id,
  );
  return option;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

describe("products menu search", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Navigation.setLocation({
      pathname: "/products/home",
      search: "",
      hash: "",
      state: null,
      key: "test",
    });
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  test.each([
    ["RUM", "Real User Monitoring"],
    ["rUm", "Real User Monitoring"],
    ["  rum  ", "Real User Monitoring"],
    ["\tRUM\n", "Real User Monitoring"],
    ["k8s", "Kubernetes"],
    [" K8s ", "Kubernetes"],
    ["browser", "Real User Monitoring"],
    ["flamegr", "Performance Profiles"],
    ["VISITOR BEHAVIOR", "Real User Monitoring"],
    ["  uptime  ", "Monitors"],
    ["MONITORS", "Monitors"],
    ["historical summaries", "Reports [beta]"],
    ["[beta]", "Reports [beta]"],
  ])(
    "%j finds %s through its title, description or alias",
    (query: string, title: string) => {
      render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

      queryFor(query);

      expect(resultTitles()).toEqual([title]);
      expect(selectedOption()).toHaveTextContent(title);
    },
  );

  test("alias matches keep the product title and description on screen", () => {
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    queryFor("rum");

    const option: HTMLElement = screen.getByRole("option");
    expect(option).toHaveTextContent("Real User Monitoring");
    expect(option).toHaveTextContent("Understand actual visitor behavior.");
    expect(option.querySelector("mark")).toBeNull();
    expect(within(option).getByRole("link")).toHaveAttribute(
      "href",
      "/products/rum",
    );
  });

  test.each([
    ["user", "User"],
    ["visitor", "visitor"],
  ])("highlights a visible %s match", (query: string, highlighted: string) => {
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    queryFor(query);

    expect(screen.getByRole("option").querySelector("mark")).toHaveTextContent(
      highlighted,
    );
  });

  test("groups alias matches in the same order as the displayed product catalog", () => {
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    queryFor("telemetry");

    expect(
      screen
        .getAllByRole("heading")
        .map((heading: HTMLElement): string | null => {
          return heading.textContent;
        }),
    ).toEqual(["Resources", "Observability"]);
    expect(resultTitles()).toEqual([
      "Real User Monitoring",
      "Kubernetes",
      "Logs",
      "Performance Profiles",
    ]);
    expect(screen.queryByText("Essentials")).not.toBeInTheDocument();
  });

  test("one product appears once when several search fields match", () => {
    const monitor: MoreMenuItem = {
      ...ITEMS[0]!,
      description: "Monitors for uptime.",
      keywords: ["monitors", "monitoring", "monitors"],
    };
    render(<NavBarMenuModal items={[monitor]} onClose={() => {}} />);

    queryFor("monitor");

    expect(resultTitles()).toEqual(["Monitors"]);
  });

  test("does not turn categories or neighboring search fields into aliases", () => {
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    queryFor("Resources");
    expect(resultTitles()).toEqual([]);

    queryFor("monitoring understand");
    expect(resultTitles()).toEqual([]);
  });

  test("clicking an alias result navigates to that product and records it as recent", () => {
    const onClose: Mock<() => void> = jest.fn<() => void>();
    render(<NavBarMenuModal items={ITEMS} onClose={onClose} />);

    queryFor("k8s");
    fireEvent.click(within(screen.getByRole("option")).getByRole("link"));

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route("/products/kubernetes"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY)!),
    ).toEqual(["/products/kubernetes"]);
  });

  test("keyboard navigation uses the order of alias results on screen", () => {
    const onClose: Mock<() => void> = jest.fn<() => void>();
    render(<NavBarMenuModal items={ITEMS} onClose={onClose} />);

    queryFor("telemetry");
    expect(selectedOption()).toHaveTextContent("Real User Monitoring");

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowRight" });
    expect(selectedOption()).toHaveTextContent("Kubernetes");

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route("/products/kubernetes"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY)!),
    ).toEqual(["/products/kubernetes"]);
  });

  test("a new alias query resets the keyboard selection to its first match", () => {
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    queryFor("telemetry");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowRight" });
    expect(selectedOption()).toHaveTextContent("Logs");

    queryFor("k8s");
    expect(selectedOption()).toHaveTextContent("Kubernetes");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(Navigation.navigate).toHaveBeenCalledWith(
      new Route("/products/kubernetes"),
    );
  });

  test("no matches clear the active descendant and Enter does not navigate", () => {
    const onClose: Mock<() => void> = jest.fn<() => void>();
    render(<NavBarMenuModal items={ITEMS} onClose={onClose} />);

    queryFor("unrecognized-product");

    expect(screen.getByText("No results found.")).toBeVisible();
    expect(resultTitles()).toEqual([]);
    expect(screen.getByRole("combobox")).not.toHaveAttribute(
      "aria-activedescendant",
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(Navigation.navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(RECENT_STORAGE_KEY)).toBeNull();
  });

  test("Escape still closes a search with no matches", () => {
    const onClose: Mock<() => void> = jest.fn<() => void>();
    render(<NavBarMenuModal items={ITEMS} onClose={onClose} />);

    queryFor("unrecognized-product");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(Navigation.navigate).not.toHaveBeenCalled();
  });

  test("recent products disappear during alias search and return when it is cleared", () => {
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(["/products/kubernetes"]),
    );
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "Recent" })).toBeVisible();
    expect(
      resultTitles().filter((title: string): boolean => {
        return title === "Kubernetes";
      }),
    ).toHaveLength(2);

    queryFor("rum");
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
    expect(resultTitles()).toEqual(["Real User Monitoring"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Recent" })).toBeVisible();
    expect(resultTitles()).toHaveLength(ITEMS.length + 1);
  });

  test("a whitespace-only query keeps the complete catalog and recent products", () => {
    window.localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(["/products/rum"]),
    );
    render(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    queryFor(" \t ");

    expect(screen.getByRole("heading", { name: "Recent" })).toBeVisible();
    expect(resultTitles()).toHaveLength(ITEMS.length + 1);
    expect(screen.queryByText("No results found.")).toBeNull();
  });

  test("a catalog update re-evaluates an existing alias query", () => {
    const { rerender } = render(
      <NavBarMenuModal items={[ITEMS[0]!]} onClose={() => {}} />,
    );

    queryFor("rum");
    expect(resultTitles()).toEqual([]);

    rerender(<NavBarMenuModal items={ITEMS} onClose={() => {}} />);

    expect(resultTitles()).toEqual(["Real User Monitoring"]);
    expect(selectedOption()).toHaveTextContent("Real User Monitoring");
  });
});
