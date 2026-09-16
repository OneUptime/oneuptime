import EmptyStateGuideLinks, {
  EmptyStateGuideLink,
  GUIDE_GRID_CLASS_NAME,
} from "../../../../UI/Components/EmptyState/EmptyStateGuideLinks";
import EmptyState from "../../../../UI/Components/EmptyState/EmptyState";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import IconProp from "../../../../Types/Icon/IconProp";
import Navigation from "../../../../UI/Utils/Navigation";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import type { SpyInstance } from "jest-mock";
import React from "react";
import { I18nextProvider } from "react-i18next";

/*
 * The grid of setup-guide cards an EmptyState footer uses when there is
 * more than one place to start.
 */

const SENTINEL: EmptyStateGuideLink = {
  id: "sentinel",
  title: "Microsoft Sentinel",
  subtitle: "SIEM",
  icon: IconProp.ShieldCheck,
  to: URL.fromString("https://oneuptime.com/docs/integrations/sentinel"),
};

const OKTA: EmptyStateGuideLink = {
  id: "okta",
  title: "Okta System Log",
  subtitle: "Identity",
  icon: IconProp.Key,
  to: URL.fromString("https://oneuptime.com/docs/integrations/okta"),
};

const INTERNAL: EmptyStateGuideLink = {
  id: "internal",
  title: "Setup guide",
  to: new Route("/dashboard/security-events/documentation"),
  openInNewTab: false,
};

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: {
          "Setup guides": "Einrichtungsanleitungen",
          Identity: "Identität",
          "(opens in a new tab)": "(öffnet in einem neuen Tab)",
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

function renderLinks(links: Array<EmptyStateGuideLink>): RenderResult {
  return render(
    <EmptyStateGuideLinks id="guides" heading="Setup guides" links={links} />,
  );
}

describe("EmptyStateGuideLinks", () => {
  test("renders nothing without links", () => {
    const { container } = renderLinks([]);

    expect(container).toBeEmptyDOMElement();
  });

  test("renders one list item and one link per guide, in order", () => {
    renderLinks([SENTINEL, OKTA]);

    const list: HTMLElement = screen.getByRole("list", {
      name: "Setup guides",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(list)
        .getAllByRole("link")
        .map((link: HTMLElement): string | null => {
          return link.getAttribute("id");
        }),
    ).toEqual(["guides-sentinel", "guides-okta"]);
  });

  test("the heading names the list", () => {
    renderLinks([SENTINEL]);

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 4,
      name: "Setup guides",
    });
    expect(heading).toHaveAttribute("id", "guides-heading");
    expect(screen.getByRole("list")).toHaveAttribute(
      "aria-labelledby",
      "guides-heading",
    );
  });

  test("without a heading the list has no label and no top margin", () => {
    render(<EmptyStateGuideLinks id="guides" links={[SENTINEL]} />);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    const list: HTMLElement = screen.getByRole("list");
    expect(list).not.toHaveAttribute("aria-labelledby");
    expect(list).not.toHaveClass("mt-3");
  });

  test("the root carries the id and caps its width", () => {
    const { container } = renderLinks([SENTINEL]);

    const root: HTMLElement = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("id", "guides");
    expect(root).toHaveClass("w-full", "max-w-5xl", "text-left");
  });

  /*
   * An empty state sits beside side menus and inside modals, so the column
   * count has to follow the space the grid really has.
   */
  test("sizes its columns from its own width, not the viewport's", () => {
    renderLinks([SENTINEL, OKTA]);

    const list: HTMLElement = screen.getByRole("list");
    expect(GUIDE_GRID_CLASS_NAME).toContain(
      "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]",
    );
    for (const className of GUIDE_GRID_CLASS_NAME.split(" ")) {
      expect(list).toHaveClass(className);
    }
    expect(list.className).not.toMatch(/\b(sm|md|lg|xl):grid-cols-/);
  });

  describe("a guide link", () => {
    test("opens in a new tab by default and points at the guide", () => {
      renderLinks([SENTINEL]);

      const link: HTMLElement = screen.getByRole("link", {
        name: /Microsoft Sentinel/,
      });
      expect(link).toHaveAttribute(
        "href",
        "https://oneuptime.com/docs/integrations/sentinel",
      );
      expect(link).toHaveAttribute("target", "_blank");
    });

    test("tells screen readers that it opens a new tab", () => {
      renderLinks([SENTINEL]);

      const link: HTMLElement = screen.getByRole("link", {
        name: /Microsoft Sentinel/,
      });
      expect(link).toHaveAccessibleName(
        "Microsoft Sentinel SIEM (opens in a new tab)",
      );
      expect(within(link).getByText("(opens in a new tab)")).toHaveClass(
        "sr-only",
      );
    });

    test("shows the title and the subtitle", () => {
      renderLinks([OKTA]);

      const link: HTMLElement = screen.getByRole("link", {
        name: /Okta System Log/,
      });
      expect(within(link).getByText("Okta System Log")).toHaveClass(
        "font-medium",
        "text-gray-900",
      );
      expect(within(link).getByText("Identity")).toHaveClass(
        "text-xs",
        "text-gray-500",
      );
    });

    test("is a full-width card with a visible keyboard focus ring", () => {
      renderLinks([OKTA]);

      const link: HTMLElement = screen.getByRole("link", {
        name: /Okta System Log/,
      });
      expect(link).toHaveClass(
        "flex",
        "w-full",
        "rounded-lg",
        "border",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
      );
      expect(link.parentElement).toHaveClass("flex");
    });

    test("draws the provider icon and an external-link marker, both hidden from assistive tech", () => {
      renderLinks([OKTA]);

      const link: HTMLElement = screen.getByRole("link", {
        name: /Okta System Log/,
      });
      const svgs: Array<SVGElement> = Array.from(link.querySelectorAll("svg"));
      expect(svgs).toHaveLength(2);
      for (const svg of svgs) {
        expect(svg).toHaveAttribute("aria-hidden", "true");
      }
      const markers: Array<Element> = Array.from(
        link.querySelectorAll("[aria-hidden='true']"),
      ).filter((element: Element): boolean => {
        return element.tagName === "DIV";
      });
      expect(markers).toHaveLength(2);
    });

    test("without an icon or subtitle only the title and marker render", () => {
      renderLinks([INTERNAL]);

      const link: HTMLElement = screen.getByRole("link", {
        name: "Setup guide",
      });
      expect(link.querySelectorAll("svg")).toHaveLength(1);
      expect(link).toHaveTextContent(/^Setup guide$/);
    });

    test("an in-app guide opens in the same tab behind a chevron", () => {
      const navigate: SpyInstance<typeof Navigation.navigate> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {});
      renderLinks([INTERNAL]);

      const link: HTMLElement = screen.getByRole("link", {
        name: "Setup guide",
      });
      expect(link).not.toHaveAttribute("target");
      expect(link).toHaveAttribute(
        "href",
        "/dashboard/security-events/documentation",
      );
      expect(
        within(link).queryByText("(opens in a new tab)"),
      ).not.toBeInTheDocument();

      fireEvent.click(link);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate.mock.calls[0]?.[0]?.toString()).toBe(
        "/dashboard/security-events/documentation",
      );
    });

    test("an external guide is left to the browser rather than routed in-app", () => {
      const navigate: SpyInstance<typeof Navigation.navigate> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {});
      renderLinks([SENTINEL]);

      fireEvent.click(screen.getByRole("link", { name: /Microsoft Sentinel/ }));
      expect(navigate).not.toHaveBeenCalled();
    });

    test("keeps its explicit openInNewTab: true", () => {
      renderLinks([{ ...OKTA, openInNewTab: true }]);

      expect(
        screen.getByRole("link", { name: /Okta System Log/ }),
      ).toHaveAttribute("target", "_blank");
    });
  });

  test("translates the heading, subtitles and the new-tab hint", () => {
    render(
      <I18nextProvider i18n={german}>
        <EmptyStateGuideLinks
          id="guides"
          heading="Setup guides"
          links={[OKTA]}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("list", { name: "Einrichtungsanleitungen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Okta System Log Identität (öffnet in einem neuen Tab)",
      }),
    ).toBeInTheDocument();
  });

  test("sits centred in an EmptyState footer", () => {
    render(
      <EmptyState
        id="empty"
        icon={IconProp.Link}
        title="Nothing connected"
        description="Pick a product to connect."
        footer={
          <EmptyStateGuideLinks
            id="guides"
            heading="Setup guides"
            links={[SENTINEL, OKTA]}
          />
        }
      />,
    );

    const footer: HTMLElement = screen.getByTestId("empty-footer");
    expect(footer).toHaveClass("flex", "justify-center");
    expect(within(footer).getAllByRole("link")).toHaveLength(2);
  });
});
