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
import SecurityEventConnectionsEmptyState, {
  SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID,
  SECURITY_EVENT_CONNECTION_REQUIREMENTS,
  SecurityEventConnectionRequirement,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsEmptyState";
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
 * Security Events > Connections with no connections.
 *
 * It used to be a centred icon and paragraph, a button, a grey "Before you
 * connect" box and a "Setup guides" grid of eight heavy docs cards, each
 * block a different width and alignment. Now it is a centred header (badge,
 * title, one sentence, Add connection), then every product in the catalog
 * as one tile that starts a connection with that product already selected
 * (the setup guide is a separate link on the tile), then what a connection
 * needs.
 *
 * SecurityEventProviderTile has its own tests; these check how the empty
 * state lays the tiles out, wires them to onAddConnection, and gates them.
 */

const ID: string = SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID;

const DISABLED_REASON: string =
  "You do not have permission to create security event connections.";

/*
 * The catalog order, written out: the tiles are the list the Add connection
 * form offers, so a change here is a change to the product, not a detail.
 */
const EXPECTED_PRODUCTS: Array<{
  provider: SecurityEventConnectorProvider;
  title: string;
  category: string;
}> = [
  {
    provider: SecurityEventConnectorProvider.MicrosoftSentinel,
    title: "Microsoft Sentinel",
    category: "SIEM",
  },
  {
    provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    title: "Microsoft Defender XDR",
    category: "EDR / XDR",
  },
  {
    provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
    title: "CrowdStrike Falcon",
    category: "EDR / XDR",
  },
  {
    provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    title: "Splunk Enterprise Security",
    category: "SIEM",
  },
  {
    provider: SecurityEventConnectorProvider.ElasticSecurity,
    title: "Elastic Security",
    category: "SIEM",
  },
  {
    provider: SecurityEventConnectorProvider.AwsSecurityHub,
    title: "AWS Security Hub",
    category: "Cloud security",
  },
  {
    provider: SecurityEventConnectorProvider.OktaSystemLog,
    title: "Okta System Log",
    category: "Identity",
  },
  {
    provider: SecurityEventConnectorProvider.GoogleSecOps,
    title: "Google SecOps",
    category: "SIEM",
  },
];

/*
 * Real i18next instances rather than a mocked hook. "german" also has
 * entries for a product name and for the permission reason, neither of
 * which the empty state may look up: a product name is a brand, and the
 * reason is already the API's own sentence.
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
          "No security event connections yet":
            "Noch keine Verbindungen für Sicherheitsereignisse",
          "Pick a product to connect": "Wählen Sie ein Produkt",
          "Supported products": "Unterstützte Produkte",
          "What you'll need": "Was Sie brauchen",
          "A read-only credential": "Ein schreibgeschützter Zugang",
          "Add connection": "Verbindung hinzufügen",
          Connect: "Verbinden",
          "Setup guide": "Einrichtungsanleitung",
          "(opens in a new tab)": "(öffnet in einem neuen Tab)",
          // Bait: neither of these may be looked up.
          "Microsoft Sentinel": "Microsoft Wächter",
          [DISABLED_REASON]: "Sie dürfen keine Verbindungen erstellen.",
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

interface RenderOptions {
  canCreate?: boolean | undefined;
  createDisabledReason?: string | undefined;
  onAddConnection?: MockFunction | undefined;
  translations?: i18n | undefined;
}

function renderEmptyState(options: RenderOptions = {}): RenderResult {
  return render(
    <I18nextProvider i18n={options.translations || english}>
      <SecurityEventConnectionsEmptyState
        canCreate={options.canCreate ?? true}
        createDisabledReason={options.createDisabledReason}
        onAddConnection={options.onAddConnection || getJestMockFunction()}
      />
    </I18nextProvider>,
  );
}

function renderBlocked(onAddConnection?: MockFunction): RenderResult {
  return renderEmptyState({
    canCreate: false,
    createDisabledReason: DISABLED_REASON,
    onAddConnection,
  });
}

function root(): HTMLElement {
  return document.getElementById(ID) as HTMLElement;
}

// The centred header: badge, title, description, button, reason.
function hero(): HTMLElement {
  return root().children[0] as HTMLElement;
}

function addButton(): HTMLElement {
  return screen.getByTestId(`${ID}-add-connection`);
}

function providersSection(): HTMLElement {
  return document.getElementById(`${ID}-providers`) as HTMLElement;
}

function requirementsSection(): HTMLElement {
  return document.getElementById(`${ID}-requirements`) as HTMLElement;
}

function tiles(): Array<HTMLElement> {
  return within(providersSection()).getAllByRole("listitem");
}

function tileFor(provider: SecurityEventConnectorProvider): HTMLElement {
  return screen.getByTestId(`${ID}-provider-${provider}`);
}

function connectButton(title: string): HTMLElement {
  return screen.getByRole("button", { name: `Connect ${title}` });
}

function guideLinkFor(title: string): HTMLElement {
  return screen.getByRole("link", {
    name: `${title} Setup guide (opens in a new tab)`,
  });
}

function follows(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

// The inner markup of an icon on its own, to compare with a rendered one.
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

/*
 * Guide links open in a new tab and are left to the browser, which jsdom
 * answers with a "navigation not implemented" error. Cancelling the
 * default below React's root keeps that out of the output without
 * touching the handlers under test.
 */
function suppressNavigation(): void {
  root().addEventListener("click", (event: Event): void => {
    event.preventDefault();
  });
}

async function tabStops(
  user: UserEvent,
  count: number,
): Promise<Array<Element | null>> {
  const stops: Array<Element | null> = [];
  for (let index: number = 0; index < count; index++) {
    await user.tab();
    stops.push(document.activeElement);
  }
  return stops;
}

/*
 * toEqual on DOM nodes compares their markup, which two tiles could share;
 * a focus order is about which element, so compare identities.
 */
function expectSameElements(
  actual: Array<Element | null>,
  expected: Array<Element>,
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((element: Element | null, index: number): void => {
    expect(element).toBe(expected[index]);
  });
}

describe("SecurityEventConnectionsEmptyState", () => {
  describe("header", () => {
    test("has the root id, a level 3 title and one sentence of what a connection does", () => {
      renderEmptyState();

      expect(SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID).toBe(
        "security-event-connections-empty-state",
      );
      expect(root()).toBeInTheDocument();
      const title: HTMLElement = screen.getByRole("heading", {
        level: 3,
        name: "No security event connections yet",
      });
      expect(title.tagName).toBe("H3");
      expect(hero()).toContainElement(title);
      expect(screen.getByTestId(`${ID}-description`)).toHaveTextContent(
        "Connect a SIEM, EDR / XDR, cloud security or identity product and OneUptime polls it on a schedule, importing each new alert, finding or log event as an OCSF security event.",
      );
      expect(hero()).toContainElement(screen.getByTestId(`${ID}-description`));
    });

    test("the description names every provider category the catalog has", () => {
      renderEmptyState();

      const description: string =
        screen.getByTestId(`${ID}-description`).textContent || "";
      for (const definition of SecurityEventConnectorCatalog) {
        expect(description.toLowerCase()).toContain(
          definition.category.toLowerCase(),
        );
      }
    });

    test("opens with a decorative, tinted badge drawn with the Link icon", () => {
      renderEmptyState();

      const badge: HTMLElement = hero().children[0] as HTMLElement;
      expect(badge).toHaveAttribute("aria-hidden", "true");
      expect(badge).toHaveClass(
        "rounded-xl",
        "bg-indigo-50",
        "text-indigo-600",
        "ring-1",
        "ring-indigo-200",
      );
      expect(badge.textContent).toBe("");
      expect(svgMarkup(badge)).toBe(iconMarkup(IconProp.Link));
      expect(follows(badge, screen.getByRole("heading", { level: 3 }))).toBe(
        true,
      );
    });

    test("is centred, while the root is left-aligned for the tiles", () => {
      renderEmptyState();

      expect(hero()).toHaveClass(
        "flex",
        "flex-col",
        "items-center",
        "text-center",
      );
      expect(root()).toHaveClass("mx-auto", "w-full", "max-w-5xl", "text-left");
    });

    /*
     * It renders inside the table's ErrorMessage: the full-page 13rem
     * padding of the old EmptyState pushed the Refresh link far below the
     * content.
     */
    test("uses compact padding rather than the full-page default", () => {
      renderEmptyState();

      expect(root()).toHaveClass("py-2");
      expect(root()).not.toHaveClass("pt-52");
      expect(root()).not.toHaveClass("pb-52");
      expect(root()).not.toHaveClass("py-4");
    });

    test("has one level 3 title and two level 4 section headings under it", () => {
      renderEmptyState();

      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
      const sectionHeadings: Array<HTMLElement> = screen.getAllByRole(
        "heading",
        { level: 4 },
      );
      expect(
        sectionHeadings.map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
      ).toEqual(["Pick a product to connect", "What you'll need"]);
      expect(screen.getAllByRole("heading")).toHaveLength(3);
    });
  });

  describe("Add connection", () => {
    test("is a primary button in the header that opens the create form with no provider", () => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderEmptyState({ onAddConnection });

      const button: HTMLElement = screen.getByRole("button", {
        name: "Add connection",
      });
      expect(button).toBe(addButton());
      expect(hero()).toContainElement(button);
      expect(button).toBeEnabled();
      expect(button).toHaveClass("bg-indigo-600");
      // Cancels the variant's modal-footer margin so it sits on the centre line.
      expect(button).toHaveClass("md:!ml-0");
      expect(svgMarkup(button)).toBe(iconMarkup(IconProp.Add));

      fireEvent.click(button);
      expect(onAddConnection).toHaveBeenCalledTimes(1);
      // No provider, and not the click event either.
      expect(onAddConnection.mock.calls[0]).toEqual([]);
    });

    test("comes before the tiles and the requirements", () => {
      renderEmptyState();

      expect(follows(addButton(), providersSection())).toBe(true);
      expect(follows(addButton(), tiles()[0]!)).toBe(true);
      expect(follows(addButton(), requirementsSection())).toBe(true);
    });

    test("is disabled, with the permission reason, for a member who cannot create connections", () => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderBlocked(onAddConnection);

      const button: HTMLElement = addButton();
      expect(button).toBeDisabled();
      expect(button).toHaveClass("bg-indigo-300");
      expect(button).not.toHaveClass("bg-indigo-600");

      /*
       * A disabled button cannot be hovered, so the tooltip hangs off a
       * focusable wrapper instead.
       */
      const wrapper: HTMLElement = screen.getByTestId(
        `${ID}-add-connection-disabled-wrapper`,
      );
      expect(wrapper).toHaveAttribute("tabindex", "0");
      expect(wrapper).toContainElement(button);

      fireEvent.click(button);
      fireEvent.click(wrapper);
      expect(onAddConnection).not.toHaveBeenCalled();
    });

    test("an allowed button has no tooltip wrapper even when a reason is passed", () => {
      renderEmptyState({
        canCreate: true,
        createDisabledReason: "Stale reason",
      });

      expect(addButton()).toBeEnabled();
      expect(
        screen.queryByTestId(`${ID}-add-connection-disabled-wrapper`),
      ).not.toBeInTheDocument();
    });

    test("stays visible, disabled, even without a reason", () => {
      renderEmptyState({ canCreate: false });

      expect(addButton()).toBeVisible();
      expect(addButton()).toBeDisabled();
      // No reason, no tooltip, so no wrapper to focus.
      expect(
        screen.queryByTestId(`${ID}-add-connection-disabled-wrapper`),
      ).not.toBeInTheDocument();
    });
  });

  describe("disabled reason", () => {
    test("is written out under the disabled button, since a tooltip never shows on touch", () => {
      renderBlocked();

      const reason: HTMLElement = screen.getByTestId(`${ID}-disabled-reason`);
      expect(reason).toHaveTextContent(DISABLED_REASON);
      expect(reason.textContent).toBe(DISABLED_REASON);
      expect(hero()).toContainElement(reason);
      expect(follows(addButton(), reason)).toBe(true);
      expect(follows(reason, providersSection())).toBe(true);
    });

    test("leads with a decorative lock icon", () => {
      renderBlocked();

      const reason: HTMLElement = screen.getByTestId(`${ID}-disabled-reason`);
      const svg: SVGElement | null = reason.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg!.innerHTML).toBe(iconMarkup(IconProp.Lock));
      expect(reason.querySelectorAll("svg")).toHaveLength(1);
    });

    test("shows the API's own sentence, not a translation of it", () => {
      renderEmptyState({
        canCreate: false,
        createDisabledReason: DISABLED_REASON,
        translations: german,
      });

      const reason: HTMLElement = screen.getByTestId(`${ID}-disabled-reason`);
      expect(reason.textContent).toBe(DISABLED_REASON);
      expect(
        screen.queryByText("Sie dürfen keine Verbindungen erstellen."),
      ).not.toBeInTheDocument();
    });

    test("is not shown to a member who can create connections, even with a reason", () => {
      renderEmptyState({
        canCreate: true,
        createDisabledReason: "Stale reason",
      });

      expect(
        screen.queryByTestId(`${ID}-disabled-reason`),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Stale reason")).not.toBeInTheDocument();
    });

    test.each([
      ["no reason", undefined],
      ["an empty reason", ""],
    ])(
      "is not shown for a blocked member with %s",
      (_label: string, createDisabledReason: string | undefined) => {
        renderEmptyState({ canCreate: false, createDisabledReason });

        expect(
          screen.queryByTestId(`${ID}-disabled-reason`),
        ).not.toBeInTheDocument();
        expect(root().querySelectorAll("svg")).toHaveLength(
          // Badge, Add icon, 8 tile badges, 8 external-link icons, 2 requirements.
          1 + 1 + 8 + 8 + 2,
        );
      },
    );
  });

  describe("layout", () => {
    test("runs header, then products, then requirements", () => {
      renderEmptyState();

      const children: Array<Element> = Array.from(root().children);
      expect(children).toHaveLength(3);
      expect(children[0]).toBe(hero());
      expect(children[1]).toBe(providersSection());
      expect(children[2]).toBe(requirementsSection());
      expect(providersSection().tagName).toBe("SECTION");
      expect(requirementsSection().tagName).toBe("SECTION");
    });

    test("keeps that order for a member who cannot create connections", () => {
      renderBlocked();

      expect(follows(hero(), providersSection())).toBe(true);
      expect(follows(providersSection(), requirementsSection())).toBe(true);
      expect(
        follows(
          screen.getByTestId(`${ID}-disabled-reason`),
          providersSection(),
        ),
      ).toBe(true);
    });

    /*
     * The old layout put a grey requirements box between the button and
     * the guides. The requirements now come last, separated by a rule,
     * and are not a box.
     */
    test("the requirements are no longer a grey box before the products", () => {
      renderEmptyState();

      expect(follows(requirementsSection(), providersSection())).toBe(false);
      for (const tile of tiles()) {
        expect(follows(tile, requirementsSection())).toBe(true);
      }
      expect(requirementsSection()).not.toHaveClass("bg-gray-50");
      expect(requirementsSection()).not.toHaveClass("rounded-lg");
      expect(requirementsSection()).not.toHaveClass("ring-1");
      expect(requirementsSection()).toHaveClass(
        "border-t",
        "border-gray-100",
        "pt-6",
      );
    });

    test("the product grid is one column, two from sm and four from lg", () => {
      renderEmptyState();

      const list: HTMLElement = screen.getByRole("list", {
        name: "Pick a product to connect",
      });
      expect(list).toHaveClass(
        "grid",
        "grid-cols-1",
        "gap-3",
        "sm:grid-cols-2",
        "lg:grid-cols-4",
      );
    });
  });

  describe("providers", () => {
    test("are a region and a list named by their heading", () => {
      renderEmptyState();

      const region: HTMLElement = screen.getByRole("region", {
        name: "Pick a product to connect",
      });
      expect(region).toBe(providersSection());
      const heading: HTMLElement = within(region).getByRole("heading", {
        level: 4,
        name: "Pick a product to connect",
      });
      expect(heading).toHaveAttribute("id", `${ID}-providers-heading`);
      expect(region).toHaveAttribute(
        "aria-labelledby",
        `${ID}-providers-heading`,
      );

      const list: HTMLElement = within(region).getByRole("list", {
        name: "Pick a product to connect",
      });
      expect(list).toHaveAttribute(
        "aria-labelledby",
        `${ID}-providers-heading`,
      );
      expect(within(list).getAllByRole("listitem")).toHaveLength(
        SecurityEventConnectorCatalog.length,
      );
    });

    test("are headed Supported products for a member who cannot create connections", () => {
      renderBlocked();

      expect(screen.getByRole("region", { name: "Supported products" })).toBe(
        providersSection(),
      );
      expect(
        screen.getByRole("heading", { level: 4, name: "Supported products" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("list", { name: "Supported products" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Pick a product to connect"),
      ).not.toBeInTheDocument();
    });

    test("show all eight products, in catalog order", () => {
      renderEmptyState();

      expect(SecurityEventConnectorCatalog).toHaveLength(8);
      expect(tiles()).toHaveLength(EXPECTED_PRODUCTS.length);
      tiles().forEach((tile: HTMLElement, index: number): void => {
        const expected: {
          provider: SecurityEventConnectorProvider;
          title: string;
          category: string;
        } = EXPECTED_PRODUCTS[index]!;
        expect(tile).toHaveAttribute(
          "data-testid",
          `${ID}-provider-${expected.provider}`,
        );
        expect(tile).toHaveTextContent(expected.title);
        expect(
          document.getElementById(
            `${ID}-provider-${expected.provider}-category`,
          ),
        ).toHaveTextContent(new RegExp(`^${expected.category}$`));
        expect(SecurityEventConnectorCatalog[index]!.provider).toBe(
          expected.provider,
        );
      });
    });

    test("Google SecOps is last and points at its own guide", () => {
      renderEmptyState();

      const last: HTMLElement = tiles()[tiles().length - 1]!;
      expect(last).toBe(tileFor(SecurityEventConnectorProvider.GoogleSecOps));
      expect(within(last).getByRole("link")).toHaveAccessibleName(
        "Google SecOps Setup guide (opens in a new tab)",
      );
      expect(within(last).getByRole("link").getAttribute("href")).toMatch(
        /\/docs\/integrations\/google-secops$/,
      );
    });

    test.each(SecurityEventConnectorCatalog)(
      "$title's tile opens Add connection with $provider selected",
      (definition: SecurityEventConnectorDefinition) => {
        const onAddConnection: MockFunction = getJestMockFunction();
        renderEmptyState({ onAddConnection });

        const button: HTMLElement = connectButton(definition.title);
        expect(tileFor(definition.provider)).toContainElement(button);
        expect(button).toHaveAccessibleDescription(definition.category);

        fireEvent.click(button);

        expect(onAddConnection).toHaveBeenCalledTimes(1);
        expect(onAddConnection.mock.calls[0]).toEqual([definition.provider]);
      },
    );

    test("each tile passes its own provider, in the order they are clicked", () => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderEmptyState({ onAddConnection });

      for (const tile of [...tiles()].reverse()) {
        fireEvent.click(within(tile).getByRole("button"));
      }

      expect(onAddConnection.mock.calls).toEqual(
        [...SecurityEventConnectorCatalog]
          .reverse()
          .map(
            (definition: SecurityEventConnectorDefinition): Array<string> => {
              return [definition.provider];
            },
          ),
      );
    });

    test.each(SecurityEventConnectorCatalog)(
      "$title's setup guide opens its docs page in a new tab",
      (definition: SecurityEventConnectorDefinition) => {
        renderEmptyState();

        const link: HTMLElement = guideLinkFor(definition.title);
        expect(tileFor(definition.provider)).toContainElement(link);
        expect(link).toHaveAttribute(
          "href",
          connectorDocsUrl(definition).toString(),
        );
        expect(link.getAttribute("href")).toMatch(
          /\/docs\/integrations\/[a-z-]+$/,
        );
        expect(link).toHaveAttribute("target", "_blank");
      },
    );

    test("clicking a setup guide does not open Add connection", () => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderEmptyState({ onAddConnection });
      suppressNavigation();

      for (const definition of SecurityEventConnectorCatalog) {
        fireEvent.click(guideLinkFor(definition.title));
      }

      expect(onAddConnection).not.toHaveBeenCalled();
    });

    test("tiles have no connect buttons for a member who cannot create connections", () => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderBlocked(onAddConnection);

      for (const expected of EXPECTED_PRODUCTS) {
        const tile: HTMLElement = tileFor(expected.provider);
        expect(within(tile).queryByRole("button")).not.toBeInTheDocument();
        expect(
          within(tile).getByText(expected.title, { selector: "p" }),
        ).toBeInTheDocument();
        // The guide stays: reading it is not creating anything.
        expect(within(tile).getByRole("link")).toHaveAccessibleName(
          `${expected.title} Setup guide (opens in a new tab)`,
        );
        fireEvent.click(tile);
      }
      expect(root().querySelectorAll("[data-provider-tile]")).toHaveLength(0);
      expect(onAddConnection).not.toHaveBeenCalled();
    });

    test("every tile has the same structure and classes", () => {
      renderEmptyState();

      const signatures: Array<string> = tiles().map(
        (tile: HTMLElement): string => {
          return [tile, ...(Array.from(tile.children) as Array<HTMLElement>)]
            .map((element: HTMLElement): string => {
              return `${element.tagName}.${classTokens(element).join(".")}`;
            })
            .join(" > ");
        },
      );
      expect(new Set(signatures).size).toBe(1);
      for (const tile of tiles()) {
        // Badge, text, plus.
        expect(tile.children).toHaveLength(3);
      }
    });

    test("static tiles share one structure too, without the plus", () => {
      renderBlocked();

      for (const tile of tiles()) {
        expect(tile.children).toHaveLength(2);
        expect(tile).not.toHaveClass("group");
      }
    });

    test("each tile shows its catalog icon, and no two tiles share one", () => {
      renderEmptyState();

      const markups: Array<string> = SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): string => {
          const badge: Element = tileFor(definition.provider).children[0]!;
          expect(badge).toHaveAttribute("aria-hidden", "true");
          const markup: string = svgMarkup(badge);
          expect(markup.length).toBeGreaterThan(0);
          return markup;
        },
      );
      expect(new Set(markups).size).toBe(markups.length);

      SecurityEventConnectorCatalog.forEach(
        (definition: SecurityEventConnectorDefinition, index: number): void => {
          expect(markups[index]).toBe(iconMarkup(definition.icon));
        },
      );
    });

    test("tiles use the empty state's id as their prefix", () => {
      renderEmptyState();

      for (const definition of SecurityEventConnectorCatalog) {
        expect(connectButton(definition.title)).toHaveAttribute(
          "aria-describedby",
          `${ID}-provider-${definition.provider}-category`,
        );
      }
    });
  });

  describe("requirements", () => {
    test("are a region and a list named What you'll need", () => {
      renderEmptyState();

      const region: HTMLElement = screen.getByRole("region", {
        name: "What you'll need",
      });
      expect(region).toBe(requirementsSection());
      expect(
        within(region).getByRole("heading", {
          level: 4,
          name: "What you'll need",
        }),
      ).toHaveAttribute("id", `${ID}-requirements-heading`);
      expect(
        within(region).getByRole("list", { name: "What you'll need" }),
      ).toHaveAttribute("aria-labelledby", `${ID}-requirements-heading`);
    });

    test("lists a read-only credential and a running worker, in that order", () => {
      renderEmptyState();

      const items: Array<HTMLElement> = within(
        screen.getByRole("list", { name: "What you'll need" }),
      ).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("A read-only credential");
      expect(items[0]).toHaveTextContent(
        "A service principal, API client or API token with permission to list the product's alerts, findings or log events.",
      );
      expect(items[1]).toHaveTextContent("A running OneUptime worker");
      expect(items[1]).toHaveTextContent(
        "Polls every connection on its schedule. Test connection checks access and worker health before you save.",
      );
    });

    test("each requirement renders from the exported list, with a decorative icon", () => {
      renderEmptyState();

      expect(
        SECURITY_EVENT_CONNECTION_REQUIREMENTS.map(
          (requirement: SecurityEventConnectionRequirement) => {
            return [requirement.id, requirement.icon];
          },
        ),
      ).toEqual([
        ["credential", IconProp.Key],
        ["worker", IconProp.ServerStack],
      ]);

      for (const requirement of SECURITY_EVENT_CONNECTION_REQUIREMENTS) {
        const item: HTMLElement = screen.getByTestId(
          `${ID}-requirement-${requirement.id}`,
        );
        expect(requirementsSection()).toContainElement(item);
        expect(item).toHaveTextContent(requirement.title);
        expect(item).toHaveTextContent(requirement.description);
        const iconBadge: Element = item.children[0]!;
        expect(iconBadge).toHaveAttribute("aria-hidden", "true");
        const svg: SVGElement | null = item.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(svg!.innerHTML).toBe(iconMarkup(requirement.icon));
      }
    });

    test("stack on narrow screens and sit side by side from md up", () => {
      renderEmptyState();

      expect(
        screen.getByRole("list", { name: "What you'll need" }),
      ).toHaveClass("grid", "grid-cols-1", "md:grid-cols-2");
    });

    test("are shown to members who cannot create connections too", () => {
      renderBlocked();

      expect(
        screen.getByRole("region", { name: "What you'll need" }),
      ).toBeVisible();
      expect(screen.getByText("A read-only credential")).toBeVisible();
      expect(screen.getByText("A running OneUptime worker")).toBeVisible();
    });
  });

  describe("accessibility", () => {
    test("has the Add button and one connect button per product, and nothing else", () => {
      renderEmptyState();

      const names: Array<string> = screen
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.getAttribute("data-testid") === `${ID}-add-connection`
            ? "Add connection"
            : `tile:${button.getAttribute("data-provider-tile")}`;
        });
      expect(names).toEqual([
        "Add connection",
        ...EXPECTED_PRODUCTS.map(
          (expected: { provider: SecurityEventConnectorProvider }): string => {
            return `tile:${expected.provider}`;
          },
        ),
      ]);
      expect(screen.getAllByRole("button")).toHaveLength(
        1 + SecurityEventConnectorCatalog.length,
      );
    });

    test("a blocked member sees only the disabled Add button", () => {
      renderBlocked();

      const buttons: Array<HTMLElement> = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toBe(addButton());
      expect(buttons[0]).toBeDisabled();
    });

    test.each([true, false])(
      "the only links are the eight setup guides, one per tile (canCreate: %s)",
      (canCreate: boolean) => {
        renderEmptyState({ canCreate });

        const links: Array<HTMLElement> = screen.getAllByRole("link");
        expect(links).toHaveLength(SecurityEventConnectorCatalog.length);
        links.forEach((link: HTMLElement, index: number): void => {
          expect(tiles()[index]).toContainElement(link);
          expect(link).toHaveAccessibleName(
            `${EXPECTED_PRODUCTS[index]!.title} Setup guide (opens in a new tab)`,
          );
        });
      },
    );

    test.each([true, false])(
      "no control is nested inside another (canCreate: %s)",
      (canCreate: boolean) => {
        renderEmptyState({ canCreate, createDisabledReason: DISABLED_REASON });

        expect(
          root().querySelectorAll(
            "a a, a button, button a, button button, a [tabindex], button [tabindex], a input, button input",
          ),
        ).toHaveLength(0);
      },
    );

    test.each([true, false])(
      "every id is unique and every aria reference resolves (canCreate: %s)",
      (canCreate: boolean) => {
        renderEmptyState({ canCreate, createDisabledReason: DISABLED_REASON });

        const ids: Array<string> = Array.from(
          root().querySelectorAll("[id]"),
        ).map((element: Element): string => {
          return element.id;
        });
        expect(new Set(ids).size).toBe(ids.length);

        const references: Array<Element> = Array.from(
          root().querySelectorAll("[aria-labelledby], [aria-describedby]"),
        );
        expect(references.length).toBeGreaterThan(0);
        for (const element of references) {
          const referenced: Array<string> = [
            element.getAttribute("aria-labelledby") || "",
            element.getAttribute("aria-describedby") || "",
          ]
            .join(" ")
            .split(/\s+/)
            .filter((id: string): boolean => {
              return id.length > 0;
            });
          for (const id of referenced) {
            expect(root()).toContainElement(document.getElementById(id));
          }
        }
      },
    );

    test.each([true, false])(
      "every icon is hidden from assistive technology (canCreate: %s)",
      (canCreate: boolean) => {
        renderEmptyState({ canCreate, createDisabledReason: DISABLED_REASON });

        const svgs: Array<SVGElement> = Array.from(
          root().querySelectorAll("svg"),
        );
        expect(svgs.length).toBeGreaterThan(0);
        for (const svg of svgs) {
          expect(svg).toHaveAttribute("aria-hidden", "true");
        }
        expect(root().querySelectorAll("[role='img']")).toHaveLength(0);
      },
    );

    test("tabs through Add connection, then each tile's button and guide, in catalog order", async (): Promise<void> => {
      renderEmptyState();
      const user: UserEvent = userEvent.setup({ delay: null });

      const stops: Array<Element | null> = await tabStops(
        user,
        1 + 2 * SecurityEventConnectorCatalog.length,
      );

      const expected: Array<HTMLElement> = [addButton()];
      for (const definition of SecurityEventConnectorCatalog) {
        expected.push(connectButton(definition.title));
        expected.push(guideLinkFor(definition.title));
      }
      expectSameElements(stops, expected);
    });

    test("a blocked member tabs to the reason's wrapper, then the guides only", async (): Promise<void> => {
      renderBlocked();
      const user: UserEvent = userEvent.setup({ delay: null });

      const stops: Array<Element | null> = await tabStops(
        user,
        1 + SecurityEventConnectorCatalog.length,
      );

      expectSameElements(stops, [
        screen.getByTestId(`${ID}-add-connection-disabled-wrapper`),
        ...SecurityEventConnectorCatalog.map(
          (definition: SecurityEventConnectorDefinition): HTMLElement => {
            return guideLinkFor(definition.title);
          },
        ),
      ]);
    });

    test("Enter on a focused tile button opens Add connection with that provider", async (): Promise<void> => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderEmptyState({ onAddConnection });
      const user: UserEvent = userEvent.setup({ delay: null });

      // Add connection, then Sentinel's button and guide, then Defender's button.
      await tabStops(user, 4);
      expect(connectButton("Microsoft Defender XDR")).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(onAddConnection).toHaveBeenCalledTimes(1);
      expect(onAddConnection.mock.calls[0]).toEqual([
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      ]);
    });

    test("Space on the focused Add button opens it with no provider", async (): Promise<void> => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderEmptyState({ onAddConnection });
      const user: UserEvent = userEvent.setup({ delay: null });

      await user.tab();
      expect(addButton()).toHaveFocus();
      await user.keyboard(" ");

      expect(onAddConnection).toHaveBeenCalledTimes(1);
      expect(onAddConnection.mock.calls[0]).toEqual([]);
    });
  });

  describe("translation", () => {
    test("translates the copy but not product names or the permission reason", () => {
      renderEmptyState({
        canCreate: false,
        createDisabledReason: DISABLED_REASON,
        translations: german,
      });

      expect(
        screen.getByRole("heading", {
          level: 3,
          name: "Noch keine Verbindungen für Sicherheitsereignisse",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Unterstützte Produkte" }),
      ).toBe(providersSection());
      expect(screen.getByRole("region", { name: "Was Sie brauchen" })).toBe(
        requirementsSection(),
      );
      expect(screen.getByText("Ein schreibgeschützter Zugang")).toBeVisible();
      expect(addButton()).toHaveTextContent("Verbindung hinzufügen");

      expect(
        within(
          tileFor(SecurityEventConnectorProvider.MicrosoftSentinel),
        ).getByText("Microsoft Sentinel", { selector: "p" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Microsoft Wächter")).not.toBeInTheDocument();
      expect(screen.getByTestId(`${ID}-disabled-reason`).textContent).toBe(
        DISABLED_REASON,
      );
    });

    test("tile buttons and guides use the translated labels around the brand", () => {
      renderEmptyState({ translations: german });

      expect(
        screen.getByRole("button", { name: "Verbinden Microsoft Sentinel" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", {
          name: "Microsoft Sentinel Einrichtungsanleitung (öffnet in einem neuen Tab)",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "Wählen Sie ein Produkt" }),
      ).toBe(providersSection());
    });
  });

  describe("regressions", () => {
    test("there is no Setup guides list of docs cards any more", () => {
      renderEmptyState();

      expect(
        screen.queryByRole("list", { name: "Setup guides" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Setup guides")).not.toBeInTheDocument();
      expect(document.getElementById(`${ID}-guides`)).toBeNull();
      expect(root().querySelectorAll(`[id^='${ID}-guides']`)).toHaveLength(0);
    });

    /*
     * The old cards were whole links holding the provider icon as well as
     * the external-link marker. A guide is now a small text link: its only
     * icon is the external-link marker, and the provider icon lives on the
     * tile outside it.
     */
    test("a guide link is not a docs card: it carries no provider icon", () => {
      renderEmptyState();

      const externalLink: string = iconMarkup(IconProp.ExternalLink);
      for (const link of screen.getAllByRole("link")) {
        const svgs: Array<SVGElement> = Array.from(
          link.querySelectorAll("svg"),
        );
        expect(svgs).toHaveLength(1);
        expect(svgs[0]!.innerHTML).toBe(externalLink);
      }
    });

    test("there is no Before you connect heading", () => {
      renderEmptyState();

      expect(screen.queryByText("Before you connect")).not.toBeInTheDocument();
      expect(
        root().querySelectorAll("h4.uppercase, h4.tracking-wide"),
      ).toHaveLength(0);
    });

    /*
     * Sentinel, Elastic and Google SecOps all used to be drawn with a
     * shield, three identical marks in a row of eight.
     */
    test("only one tile is drawn with the ShieldCheck icon", () => {
      renderEmptyState();

      const shield: string = iconMarkup(IconProp.ShieldCheck);
      const shielded: Array<HTMLElement> = tiles().filter(
        (tile: HTMLElement): boolean => {
          return svgMarkup(tile.children[0]!) === shield;
        },
      );
      expectSameElements(shielded, [
        tileFor(SecurityEventConnectorProvider.MicrosoftSentinel),
      ]);
      expect(
        svgMarkup(
          tileFor(SecurityEventConnectorProvider.ElasticSecurity).children[0]!,
        ),
      ).toBe(iconMarkup(IconProp.Database));
      expect(
        svgMarkup(
          tileFor(SecurityEventConnectorProvider.GoogleSecOps).children[0]!,
        ),
      ).toBe(iconMarkup(IconProp.ViewfinderCircle));
    });
  });
});
