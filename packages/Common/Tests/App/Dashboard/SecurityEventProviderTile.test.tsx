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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import SecurityEventProviderTile from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventProviderTile";
import { connectorDocsUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import IconProp from "../../../Types/Icon/IconProp";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import Icon from "../../../UI/Components/Icon/Icon";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * One product in the Security Event Connections empty state, on its own.
 *
 * The tile carries two actions that must never nest: a stretched button
 * that starts a connection for the product (its ::after covers the whole
 * tile) and a setup-guide link raised above that overlay. A member who
 * cannot create connections gets the same tile with no button and no plus,
 * so it reads as a list of supported products rather than dead controls.
 *
 * These tests pin that contract in isolation, so the empty state's own
 * tests only have to check how the tiles are laid out and wired up.
 */

const ID_PREFIX: string = "test-gallery";

/*
 * Real i18next instances rather than a mocked hook, so the tile goes
 * through the same translateString path as in the product. "german" also
 * translates the product names, which the tile must ignore: they are
 * brands.
 */
const english: i18n = createInstance();
const german: i18n = createInstance();

beforeAll(async (): Promise<void> => {
  await english.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: {
          Connect: "Verbinden",
          "Setup guide": "Einrichtungsanleitung",
          "(opens in a new tab)": "(öffnet in einem neuen Tab)",
          "Cloud security": "Cloud-Sicherheit",
          Identity: "Identität",
          // Bait: a product name must never be looked up.
          "AWS Security Hub": "AWS-Sicherheitszentrale",
          "Okta System Log": "Okta-Systemprotokoll",
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

function definitionFor(
  provider: SecurityEventConnectorProvider,
): SecurityEventConnectorDefinition {
  const definition: SecurityEventConnectorDefinition | undefined =
    SecurityEventConnectorCatalog.find(
      (candidate: SecurityEventConnectorDefinition): boolean => {
        return candidate.provider === provider;
      },
    );
  if (!definition) {
    throw new Error(`No catalog entry for ${provider}`);
  }
  return definition;
}

const SENTINEL: SecurityEventConnectorDefinition = definitionFor(
  SecurityEventConnectorProvider.MicrosoftSentinel,
);
const AWS: SecurityEventConnectorDefinition = definitionFor(
  SecurityEventConnectorProvider.AwsSecurityHub,
);

interface RenderTileOptions {
  definition?: SecurityEventConnectorDefinition | undefined;
  canConnect?: boolean | undefined;
  idPrefix?: string | undefined;
  onConnect?: MockFunction | undefined;
  translations?: i18n | undefined;
}

interface RenderedTile {
  view: RenderResult;
  tile: HTMLElement;
  onConnect: MockFunction;
}

function renderTile(options: RenderTileOptions = {}): RenderedTile {
  const definition: SecurityEventConnectorDefinition =
    options.definition || SENTINEL;
  const idPrefix: string = options.idPrefix || ID_PREFIX;
  const onConnect: MockFunction = options.onConnect || getJestMockFunction();

  // A tile is an <li>; render it where one is valid.
  const view: RenderResult = render(
    <I18nextProvider i18n={options.translations || english}>
      <ul role="list">
        <SecurityEventProviderTile
          idPrefix={idPrefix}
          definition={definition}
          canConnect={options.canConnect ?? true}
          onConnect={() => {
            onConnect();
          }}
        />
      </ul>
    </I18nextProvider>,
  );

  return {
    view,
    tile: screen.getByTestId(`${idPrefix}-provider-${definition.provider}`),
    onConnect,
  };
}

// The tile's direct children: badge, text, and (when connectable) plus.
function parts(tile: HTMLElement): Array<HTMLElement> {
  return Array.from(tile.children) as Array<HTMLElement>;
}

function badge(tile: HTMLElement): HTMLElement {
  return parts(tile)[0]!;
}

function textColumn(tile: HTMLElement): HTMLElement {
  return parts(tile)[1]!;
}

function guideLink(tile: HTMLElement): HTMLElement {
  return within(tile).getByRole("link");
}

/*
 * The inner markup of an icon rendered on its own, so a tile's svg can be
 * compared with the icon it is meant to show. Icon renders an empty
 * fragment for an IconProp it has no drawing for, so a match against a
 * non-empty drawing also proves the icon exists.
 */
function iconMarkup(icon: IconProp): string {
  const view: RenderResult = render(<Icon icon={icon} className="h-5 w-5" />);
  const svg: SVGElement | null = view.container.querySelector("svg");
  const markup: string = svg ? svg.innerHTML : "";
  view.unmount();
  view.container.remove();
  return markup;
}

function svgMarkup(element: Element): string {
  const svg: SVGElement | null = element.querySelector("svg");
  return svg ? svg.innerHTML : "";
}

function classTokens(element: Element): Array<string> {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
}

function allElements(root: HTMLElement): Array<Element> {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

/*
 * Guide links open in a new tab and are left to the browser, which jsdom
 * answers with a "navigation not implemented" error. Cancelling the
 * default below React's root keeps that out of the output without
 * touching the handlers under test.
 */
function suppressNavigation(element: HTMLElement): void {
  element.addEventListener("click", (event: Event): void => {
    event.preventDefault();
  });
}

describe("SecurityEventProviderTile", () => {
  describe("when the member can connect", () => {
    test("is a list item named by its test id, holding one button and one link", () => {
      const { tile } = renderTile();

      expect(tile.tagName).toBe("LI");
      expect(screen.getByRole("listitem")).toBe(tile);
      expect(tile).toHaveAttribute(
        "data-testid",
        `${ID_PREFIX}-provider-${SecurityEventConnectorProvider.MicrosoftSentinel}`,
      );
      expect(within(tile).getAllByRole("button")).toHaveLength(1);
      expect(within(tile).getAllByRole("link")).toHaveLength(1);
    });

    test("the button is named Connect plus the product, described by its category", () => {
      const { tile } = renderTile();

      const button: HTMLElement = within(tile).getByRole("button");
      expect(button).toHaveAccessibleName("Connect Microsoft Sentinel");
      expect(button).toHaveAccessibleDescription("SIEM");
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute(
        "data-provider-tile",
        SecurityEventConnectorProvider.MicrosoftSentinel,
      );
      // The visible label is the product alone; "Connect" is for AT only.
      expect(button).toHaveTextContent(/^Connect Microsoft Sentinel$/);
      const srOnly: HTMLElement = button.querySelector(
        ".sr-only",
      ) as HTMLElement;
      expect(srOnly).not.toBeNull();
      expect(srOnly.textContent).toBe("Connect ");
    });

    test("aria-describedby points at the category element inside the same tile", () => {
      const { tile } = renderTile();

      const button: HTMLElement = within(tile).getByRole("button");
      const describedBy: string | null =
        button.getAttribute("aria-describedby");
      expect(describedBy).toBe(
        `${ID_PREFIX}-provider-${SecurityEventConnectorProvider.MicrosoftSentinel}-category`,
      );
      const category: HTMLElement | null = document.getElementById(
        describedBy as string,
      );
      expect(category).not.toBeNull();
      expect(tile).toContainElement(category);
      expect(category).toHaveTextContent(/^SIEM$/);
      expect(category!.tagName).toBe("SPAN");
    });

    test("clicking the button calls onConnect exactly once", () => {
      const { tile, onConnect } = renderTile();

      fireEvent.click(within(tile).getByRole("button"));

      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    /*
     * The button is the only thing that starts a connection. In a browser
     * its ::after overlay turns a click anywhere on the tile into a click on
     * it; jsdom has no pseudo-elements, so a click on the tile's other parts
     * must not reach onConnect through some other handler.
     */
    test("clicking the tile around the button does not call onConnect by itself", () => {
      const { tile, onConnect } = renderTile();

      fireEvent.click(tile);
      fireEvent.click(badge(tile));
      fireEvent.click(parts(tile)[2]!);
      fireEvent.click(
        document.getElementById(
          `${ID_PREFIX}-provider-${SecurityEventConnectorProvider.MicrosoftSentinel}-category`,
        ) as HTMLElement,
      );

      expect(onConnect).not.toHaveBeenCalled();
    });

    test("the button is enabled, focusable and not removed from the tab order", () => {
      const { tile } = renderTile();

      const button: HTMLElement = within(tile).getByRole("button");
      expect(button.tagName).toBe("BUTTON");
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute("tabindex");
      expect(button).not.toHaveAttribute("aria-hidden");
      button.focus();
      expect(button).toHaveFocus();
    });

    test("shows the plus at the end, decorative and drawn with the Add icon", () => {
      const { tile } = renderTile();

      expect(parts(tile)).toHaveLength(3);
      // Product icon, external-link marker, plus: the plus is drawn once.
      expect(
        Array.from(tile.querySelectorAll("svg")).filter(
          (svg: SVGElement): boolean => {
            return svg.innerHTML === iconMarkup(IconProp.Add);
          },
        ),
      ).toHaveLength(1);
      const plus: HTMLElement = parts(tile)[2]!;
      expect(plus).toHaveAttribute("aria-hidden", "true");
      expect(svgMarkup(plus)).toBe(iconMarkup(IconProp.Add));
      expect(plus.querySelector("svg")).toHaveClass(
        "h-4",
        "w-4",
        "group-hover:text-indigo-600",
      );
    });

    test("the product badge is decorative", () => {
      const { tile } = renderTile();

      expect(badge(tile)).toHaveAttribute("aria-hidden", "true");
      expect(badge(tile).querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(badge(tile).textContent).toBe("");
    });

    /*
     * The stretched-button pattern: the li is the positioning context, the
     * button's ::after fills it, and the guide link is lifted above the
     * overlay so it stays separately clickable.
     */
    test("stretches the button over the tile and lifts the guide link above it", () => {
      const { tile } = renderTile();

      expect(tile).toHaveClass("relative");
      const button: HTMLElement = within(tile).getByRole("button");
      expect(button).toHaveClass(
        "after:absolute",
        "after:inset-0",
        "after:rounded-lg",
        "after:content-['']",
        "focus:outline-none",
        "focus-visible:after:ring-2",
        "focus-visible:after:ring-indigo-500",
      );
      expect(guideLink(tile)).toHaveClass(
        "relative",
        "z-10",
        "focus-visible:ring-2",
      );
    });

    test("hover styles are applied, on the tile, the badge and the icons", () => {
      const { tile } = renderTile();

      expect(tile).toHaveClass(
        "group",
        "hover:border-indigo-300",
        "transition-colors",
      );
      expect(badge(tile)).toHaveClass("group-hover:bg-indigo-50");
      expect(badge(tile).querySelector("svg")).toHaveClass(
        "group-hover:text-indigo-600",
      );
    });

    test("is a three-column row below lg and an upright card at lg", () => {
      const { tile } = renderTile();

      expect(tile).toHaveClass(
        "grid",
        "min-w-0",
        "grid-cols-[auto_minmax(0,1fr)_auto]",
        "items-center",
        "lg:grid-cols-[auto_minmax(0,1fr)]",
        "lg:items-start",
        "lg:gap-y-3",
        "lg:p-4",
      );
      // At lg the name drops under the badge and spans the full width...
      expect(textColumn(tile)).toHaveClass(
        "min-w-0",
        "lg:col-span-2",
        "lg:row-start-2",
      );
      // ...and the plus moves up beside the badge, on the right.
      expect(parts(tile)[2]).toHaveClass(
        "lg:col-start-2",
        "lg:row-start-1",
        "lg:self-center",
        "lg:justify-self-end",
      );
    });

    test("children are badge, text and plus, in that DOM order", () => {
      const { tile } = renderTile();

      const [first, second, third] = parts(tile);
      expect(first).toBe(badge(tile));
      expect(second).toContainElement(within(tile).getByRole("button"));
      expect(second).toContainElement(guideLink(tile));
      expect(third!.querySelector("svg")).not.toBeNull();
      expect(third!.textContent).toBe("");
    });
  });

  describe("when the member cannot connect", () => {
    test("has no button and no plus, and names the product in plain text", () => {
      const { tile, onConnect } = renderTile({ canConnect: false });

      expect(within(tile).queryByRole("button")).not.toBeInTheDocument();
      expect(tile.querySelector("[data-provider-tile]")).toBeNull();
      expect(parts(tile)).toHaveLength(2);

      const title: HTMLElement = within(tile).getByText("Microsoft Sentinel", {
        selector: "p",
      });
      expect(title).toHaveClass("text-sm", "font-semibold", "text-gray-900");

      // Nothing on the tile starts a connection.
      fireEvent.click(tile);
      fireEvent.click(title);
      fireEvent.click(badge(tile));
      expect(onConnect).not.toHaveBeenCalled();
    });

    /*
     * A plus promises an action. Without the button there is nothing to
     * add, so the icon must go with it rather than sit there looking live.
     */
    test("draws no plus anywhere: only the product icon and the external-link marker", () => {
      const { tile } = renderTile({ canConnect: false });

      const add: string = iconMarkup(IconProp.Add);
      const drawn: Array<string> = Array.from(tile.querySelectorAll("svg")).map(
        (svg: SVGElement): string => {
          return svg.innerHTML;
        },
      );
      expect(drawn).toEqual([
        iconMarkup(SENTINEL.icon),
        iconMarkup(IconProp.ExternalLink),
      ]);
      expect(drawn).not.toContain(add);
    });

    test("still links the setup guide, the tile's only control", () => {
      const { tile } = renderTile({ canConnect: false });

      const link: HTMLElement = guideLink(tile);
      expect(link).toHaveAttribute(
        "href",
        connectorDocsUrl(SENTINEL).toString(),
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAccessibleName(
        "Microsoft Sentinel Setup guide (opens in a new tab)",
      );
    });

    test("keeps the category, with the same id, for consistency", () => {
      const { tile } = renderTile({ canConnect: false });

      const category: HTMLElement | null = document.getElementById(
        `${ID_PREFIX}-provider-${SecurityEventConnectorProvider.MicrosoftSentinel}-category`,
      );
      expect(tile).toContainElement(category);
      expect(category).toHaveTextContent(/^SIEM$/);
      // No button, so nothing is described by it.
      expect(tile.querySelector("[aria-describedby]")).toBeNull();
    });

    test("has no hover styles anywhere but on the guide link", () => {
      const { tile } = renderTile({ canConnect: false });

      expect(tile).not.toHaveClass("group");
      const link: HTMLElement = guideLink(tile);
      for (const element of allElements(tile)) {
        if (link === element || link.contains(element)) {
          continue;
        }
        const hoverTokens: Array<string> = classTokens(element).filter(
          (token: string): boolean => {
            return token.includes("hover:");
          },
        );
        expect(hoverTokens).toEqual([]);
        expect(classTokens(element)).not.toContain("transition-colors");
      }
    });

    test("is a two-column row below lg, since there is no plus column", () => {
      const { tile } = renderTile({ canConnect: false });

      expect(tile).toHaveClass(
        "grid",
        "grid-cols-[auto_minmax(0,1fr)]",
        "items-center",
        "lg:items-start",
        "lg:gap-y-3",
        "lg:p-4",
      );
      expect(tile).not.toHaveClass("grid-cols-[auto_minmax(0,1fr)_auto]");
      expect(textColumn(tile)).toHaveClass("lg:col-span-2", "lg:row-start-2");
    });

    test("the badge is the same decorative badge as a connectable tile", () => {
      const connectable: string = svgMarkup(badge(renderTile().tile));
      cleanup();
      const { tile } = renderTile({ canConnect: false });

      expect(badge(tile)).toHaveAttribute("aria-hidden", "true");
      expect(svgMarkup(badge(tile))).toBe(connectable);
      expect(badge(tile)).toHaveClass(
        "h-9",
        "w-9",
        "rounded-lg",
        "bg-gray-50",
        "text-gray-500",
      );
    });
  });

  describe("setup guide link", () => {
    test.each([true, false])(
      "opens the product's docs in a new tab (canConnect: %s)",
      (canConnect: boolean) => {
        const { tile } = renderTile({ canConnect });

        const link: HTMLElement = guideLink(tile);
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute(
          "href",
          connectorDocsUrl(SENTINEL).toString(),
        );
        expect(link.getAttribute("href")).toMatch(
          /\/docs\/integrations\/microsoft-sentinel$/,
        );
        expect(link).toHaveAttribute("target", "_blank");
      },
    );

    test("is named with the product, the label and a new-tab warning, in screen-reader text", () => {
      const { tile } = renderTile();

      const link: HTMLElement = guideLink(tile);
      expect(link).toHaveAccessibleName(
        "Microsoft Sentinel Setup guide (opens in a new tab)",
      );
      // Sighted users see only "Setup guide" and the external-link icon.
      const srOnly: Array<string> = Array.from(
        link.querySelectorAll(".sr-only"),
      ).map((element: Element): string => {
        return element.textContent || "";
      });
      expect(srOnly).toEqual(["Microsoft Sentinel ", " (opens in a new tab)"]);
      expect(link).toHaveTextContent("Setup guide");
      expect(svgMarkup(link)).toBe(iconMarkup(IconProp.ExternalLink));
      expect(link.querySelectorAll("svg")).toHaveLength(1);
    });

    test("clicking it does not start a connection", () => {
      const { tile, onConnect } = renderTile();
      suppressNavigation(tile);

      fireEvent.click(guideLink(tile));

      expect(onConnect).not.toHaveBeenCalled();
    });

    test("is a sibling of the button, never inside it or wrapping it", () => {
      const { tile } = renderTile();

      const button: HTMLElement = within(tile).getByRole("button");
      const link: HTMLElement = guideLink(tile);
      expect(button).not.toContainElement(link);
      expect(link).not.toContainElement(button);
      expect(tile.querySelectorAll("button a, a button")).toHaveLength(0);
      expect(
        tile.querySelectorAll("button [tabindex], a [tabindex]"),
      ).toHaveLength(0);
    });

    test("separates the category from the link with a decorative dot", () => {
      const { tile } = renderTile();

      const category: HTMLElement = document.getElementById(
        `${ID_PREFIX}-provider-${SecurityEventConnectorProvider.MicrosoftSentinel}-category`,
      ) as HTMLElement;
      const dot: Element | null = category.nextElementSibling;
      expect(dot).not.toBeNull();
      expect(dot).toHaveAttribute("aria-hidden", "true");
      expect(dot!.textContent).toBe("·");
      expect(dot!.nextElementSibling).toBe(guideLink(tile));
    });
  });

  describe("keyboard", () => {
    test("the button is the first tab stop and the guide link the second", async (): Promise<void> => {
      const { tile } = renderTile();
      const user: UserEvent = userEvent.setup({ delay: null });

      await user.tab();
      expect(within(tile).getByRole("button")).toHaveFocus();
      await user.tab();
      expect(guideLink(tile)).toHaveFocus();
    });

    test("Enter on the focused button starts a connection", async (): Promise<void> => {
      const { tile, onConnect } = renderTile();
      const user: UserEvent = userEvent.setup({ delay: null });

      await user.tab();
      expect(within(tile).getByRole("button")).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    test("Space on the focused button starts a connection", async (): Promise<void> => {
      const { tile, onConnect } = renderTile();
      const user: UserEvent = userEvent.setup({ delay: null });

      await user.tab();
      expect(within(tile).getByRole("button")).toHaveFocus();
      await user.keyboard(" ");

      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    test("without the button the guide link is the tile's only tab stop", async (): Promise<void> => {
      const { tile } = renderTile({ canConnect: false });
      const user: UserEvent = userEvent.setup({ delay: null });

      await user.tab();
      expect(guideLink(tile)).toHaveFocus();
      await user.tab();
      expect(tile).not.toContainElement(document.activeElement as HTMLElement);
    });

    test("activating the focused guide link does not start a connection", async (): Promise<void> => {
      const { tile, onConnect } = renderTile();
      suppressNavigation(tile);
      const user: UserEvent = userEvent.setup({ delay: null });

      await user.tab();
      await user.tab();
      expect(guideLink(tile)).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(onConnect).not.toHaveBeenCalled();
    });
  });

  describe("ids", () => {
    test("are built from idPrefix, so two galleries on one page cannot collide", () => {
      render(
        <I18nextProvider i18n={english}>
          <ul role="list">
            <SecurityEventProviderTile
              idPrefix="first"
              definition={SENTINEL}
              canConnect={true}
              onConnect={() => {}}
            />
          </ul>
          <ul role="list">
            <SecurityEventProviderTile
              idPrefix="second"
              definition={SENTINEL}
              canConnect={true}
              onConnect={() => {}}
            />
          </ul>
        </I18nextProvider>,
      );

      const first: HTMLElement = screen.getByTestId(
        "first-provider-microsoft-sentinel",
      );
      const second: HTMLElement = screen.getByTestId(
        "second-provider-microsoft-sentinel",
      );
      const firstButton: HTMLElement = within(first).getByRole("button");
      const secondButton: HTMLElement = within(second).getByRole("button");

      expect(firstButton).toHaveAttribute(
        "aria-describedby",
        "first-provider-microsoft-sentinel-category",
      );
      expect(secondButton).toHaveAttribute(
        "aria-describedby",
        "second-provider-microsoft-sentinel-category",
      );
      expect(first).toContainElement(
        document.getElementById("first-provider-microsoft-sentinel-category"),
      );
      expect(second).toContainElement(
        document.getElementById("second-provider-microsoft-sentinel-category"),
      );

      const ids: Array<string> = Array.from(
        document.querySelectorAll("[id]"),
      ).map((element: Element): string => {
        return element.id;
      });
      expect(new Set(ids).size).toBe(ids.length);
    });

    test.each(SecurityEventConnectorCatalog)(
      "$title uses its provider value in the test id and category id",
      (definition: SecurityEventConnectorDefinition) => {
        const { tile } = renderTile({ definition });

        expect(tile).toHaveAttribute(
          "data-testid",
          `${ID_PREFIX}-provider-${definition.provider}`,
        );
        expect(within(tile).getByRole("button")).toHaveAttribute(
          "aria-describedby",
          `${ID_PREFIX}-provider-${definition.provider}-category`,
        );
      },
    );
  });

  describe("translation", () => {
    test("translates the labels and category but never the product name", () => {
      const { tile } = renderTile({ definition: AWS, translations: german });

      const button: HTMLElement = within(tile).getByRole("button");
      expect(button).toHaveAccessibleName("Verbinden AWS Security Hub");
      expect(button).toHaveAccessibleDescription("Cloud-Sicherheit");
      expect(guideLink(tile)).toHaveAccessibleName(
        "AWS Security Hub Einrichtungsanleitung (öffnet in einem neuen Tab)",
      );
      expect(tile).not.toHaveTextContent("AWS-Sicherheitszentrale");
    });

    test("the plain-text title of a static tile is not translated either", () => {
      const { tile } = renderTile({
        definition: definitionFor(SecurityEventConnectorProvider.OktaSystemLog),
        canConnect: false,
        translations: german,
      });

      expect(
        within(tile).getByText("Okta System Log", { selector: "p" }),
      ).toBeInTheDocument();
      expect(tile).not.toHaveTextContent("Okta-Systemprotokoll");
      expect(tile).toHaveTextContent("Identität");
    });
  });

  describe("dark mode", () => {
    /*
     * Theme.css re-colours text-gray-* for the dark theme. On one element
     * with a group-hover:text-indigo-* the two fight and the icon turns
     * near-white on hover, so a hover colour may only sit on an element
     * that has no resting grey of its own.
     */
    test.each([true, false])(
      "no element carries both a resting grey and a hover text colour (canConnect: %s)",
      (canConnect: boolean) => {
        const { tile } = renderTile({ canConnect });

        for (const element of allElements(tile)) {
          const tokens: Array<string> = classTokens(element);
          const hasGrey: boolean = tokens.some((token: string): boolean => {
            return token.startsWith("text-gray-");
          });
          const hoverTextClass: RegExp = /(^|:)hover:text-/;
          const hasHoverText: boolean = tokens.some(
            (token: string): boolean => {
              return hoverTextClass.test(token);
            },
          );
          expect(hasGrey && hasHoverText).toBe(false);
        }
      },
    );
  });

  describe("every catalog provider", () => {
    test.each(SecurityEventConnectorCatalog)(
      "$title renders its own catalog icon in the badge",
      (definition: SecurityEventConnectorDefinition) => {
        const expected: string = iconMarkup(definition.icon);
        expect(expected.length).toBeGreaterThan(0);

        const { tile } = renderTile({ definition });

        const svg: SVGElement | null = badge(tile).querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg!.children.length).toBeGreaterThan(0);
        expect(svg!.innerHTML).toBe(expected);
      },
    );

    test.each(SecurityEventConnectorCatalog)(
      "$title is named, described and linked from its catalog entry",
      (definition: SecurityEventConnectorDefinition) => {
        const { tile, onConnect } = renderTile({ definition });

        const button: HTMLElement = within(tile).getByRole("button");
        expect(button).toHaveAccessibleName(`Connect ${definition.title}`);
        expect(button).toHaveAccessibleDescription(definition.category);
        expect(guideLink(tile)).toHaveAccessibleName(
          `${definition.title} Setup guide (opens in a new tab)`,
        );
        expect(guideLink(tile)).toHaveAttribute(
          "href",
          connectorDocsUrl(definition).toString(),
        );

        fireEvent.click(button);
        expect(onConnect).toHaveBeenCalledTimes(1);
      },
    );

    test("no two providers draw the same badge", () => {
      const markups: Array<string> = SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): string => {
          const { tile } = renderTile({ definition });
          const markup: string = svgMarkup(badge(tile));
          cleanup();
          return markup;
        },
      );

      expect(markups).toHaveLength(SecurityEventConnectorCatalog.length);
      expect(new Set(markups).size).toBe(markups.length);
    });

    test("every tile has the same structure and classes, whichever the product", () => {
      const signatures: Array<string> = SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): string => {
          const { tile } = renderTile({ definition });
          const signature: string = [tile, ...parts(tile)]
            .map((element: HTMLElement): string => {
              return `${element.tagName}.${classTokens(element).join(".")}`;
            })
            .join(" > ");
          cleanup();
          return signature;
        },
      );

      expect(new Set(signatures).size).toBe(1);
    });
  });
});
