import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import SecurityEventConnectionsEmptyState, {
  SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID,
  SECURITY_EVENT_CONNECTION_REQUIREMENTS,
  SecurityEventConnectionRequirement,
  securityEventConnectorGuideLinks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsEmptyState";
import { connectorDocsUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import IconProp from "../../../Types/Icon/IconProp";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { EmptyStateGuideLink } from "../../../UI/Components/EmptyState/EmptyStateGuideLinks";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events > Connections with no connections: what a connection
 * does, the button that adds one, what it needs before its first poll, and
 * one setup-guide card per provider.
 *
 * It replaced a paragraph and a bulleted list centred inside the table,
 * whose bullets sat at the far left edge of the table while the links sat
 * in the middle.
 */

const EXPECTED_GUIDES: Array<{ title: string; category: string }> = [
  { title: "Microsoft Sentinel", category: "SIEM" },
  { title: "Microsoft Defender XDR", category: "EDR / XDR" },
  { title: "CrowdStrike Falcon", category: "EDR / XDR" },
  { title: "Splunk Enterprise Security", category: "SIEM" },
  { title: "Elastic Security", category: "SIEM" },
  { title: "AWS Security Hub", category: "Cloud security" },
  { title: "Okta System Log", category: "Identity" },
  { title: "Google SecOps", category: "SIEM" },
];

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

function renderEmptyState(
  props: {
    canCreate?: boolean;
    createDisabledReason?: string | undefined;
    onAddConnection?: MockFunction;
  } = {},
): RenderResult {
  return render(
    <SecurityEventConnectionsEmptyState
      canCreate={props.canCreate ?? true}
      createDisabledReason={props.createDisabledReason}
      onAddConnection={props.onAddConnection || getJestMockFunction()}
    />,
  );
}

function root(): HTMLElement {
  return document.getElementById(
    SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID,
  ) as HTMLElement;
}

function guides(): HTMLElement {
  return screen.getByRole("list", { name: "Setup guides" });
}

function addButton(): HTMLElement {
  return screen.getByTestId(
    `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-add-connection`,
  );
}

describe("SecurityEventConnectionsEmptyState", () => {
  describe("header", () => {
    test("is an EmptyState with the connection icon, a title and one sentence of what a connection does", () => {
      renderEmptyState();

      expect(SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID).toBe(
        "security-event-connections-empty-state",
      );
      expect(root()).toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: "No security event connections yet",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-description`,
        ),
      ).toHaveTextContent(
        "Connect a SIEM, EDR / XDR, cloud security or identity product and OneUptime polls it on a schedule, importing each new alert, finding or log event as an OCSF security event.",
      );
    });

    test("the description names every provider category the catalog has", () => {
      renderEmptyState();

      const description: string =
        screen.getByTestId(
          `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-description`,
        ).textContent || "";
      for (const definition of SecurityEventConnectorCatalog) {
        expect(description.toLowerCase()).toContain(
          definition.category.toLowerCase(),
        );
      }
    });

    /*
     * Inside a table the full-page 13rem padding pushed the Refresh link
     * far below the content.
     */
    test("uses compact table padding rather than the full-page default", () => {
      renderEmptyState();

      expect(root()).toHaveClass("py-4");
      expect(root()).not.toHaveClass("pt-52");
      expect(root()).not.toHaveClass("pb-52");
    });
  });

  describe("Add connection", () => {
    test("is a primary button that opens the create form", () => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderEmptyState({ onAddConnection });

      const button: HTMLElement = screen.getByRole("button", {
        name: "Add connection",
      });
      expect(button).toBe(addButton());
      expect(button).toBeEnabled();
      expect(button).toHaveClass("bg-indigo-600");
      // Cancels the variant's modal-footer margin so it sits on the centre line.
      expect(button).toHaveClass("md:!ml-0");

      fireEvent.click(button);
      expect(onAddConnection).toHaveBeenCalledTimes(1);
    });

    test("comes before the requirements and the guides", () => {
      renderEmptyState();

      const requirements: HTMLElement = document.getElementById(
        `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirements`,
      ) as HTMLElement;
      expect(
        addButton().compareDocumentPosition(requirements) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        requirements.compareDocumentPosition(guides()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test("is disabled, with the permission reason, for a member who cannot create connections", () => {
      const onAddConnection: MockFunction = getJestMockFunction();
      renderEmptyState({
        canCreate: false,
        createDisabledReason:
          "You do not have permission to create security event connections.",
        onAddConnection,
      });

      const button: HTMLElement = addButton();
      expect(button).toBeDisabled();
      expect(button).toHaveClass("bg-indigo-300");

      /*
       * A disabled button cannot be hovered, so the tooltip hangs off a
       * focusable wrapper instead.
       */
      const wrapper: HTMLElement = screen.getByTestId(
        `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-add-connection-disabled-wrapper`,
      );
      expect(wrapper).toHaveAttribute("tabindex", "0");
      expect(wrapper).toContainElement(button);

      fireEvent.click(button);
      expect(onAddConnection).not.toHaveBeenCalled();
    });

    test("an allowed button has no tooltip wrapper even when a reason is passed", () => {
      renderEmptyState({
        canCreate: true,
        createDisabledReason: "Stale reason",
      });

      expect(addButton()).toBeEnabled();
      expect(
        screen.queryByTestId(
          `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-add-connection-disabled-wrapper`,
        ),
      ).not.toBeInTheDocument();
    });

    test("stays visible, disabled, even without a reason", () => {
      renderEmptyState({ canCreate: false });

      expect(addButton()).toBeDisabled();
    });
  });

  describe("requirements", () => {
    test("lists a read-only credential and a running worker, in that order", () => {
      renderEmptyState();

      const requirements: HTMLElement = document.getElementById(
        `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirements`,
      ) as HTMLElement;
      expect(
        within(requirements).getByRole("heading", {
          level: 4,
          name: "Before you connect",
        }),
      ).toBeInTheDocument();

      const items: Array<HTMLElement> =
        within(requirements).getAllByRole("listitem");
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
          `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirement-${requirement.id}`,
        );
        expect(item).toHaveTextContent(requirement.title);
        expect(item).toHaveTextContent(requirement.description);
        const svg: SVGElement | null = item.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg).toHaveAttribute("aria-hidden", "true");
      }
    });

    test("stack on narrow screens and sit side by side from md up", () => {
      renderEmptyState();

      const list: HTMLElement = within(
        document.getElementById(
          `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-requirements`,
        ) as HTMLElement,
      ).getByRole("list");
      expect(list).toHaveClass("grid", "md:grid-cols-2");
    });

    test("are shown to members who cannot create connections too", () => {
      renderEmptyState({ canCreate: false });

      expect(screen.getByText("A read-only credential")).toBeVisible();
      expect(screen.getByText("A running OneUptime worker")).toBeVisible();
    });
  });

  describe("setup guides", () => {
    test("show one card per provider, in catalog order, with its category", () => {
      renderEmptyState();

      const links: Array<HTMLElement> = within(guides()).getAllByRole("link");
      expect(links).toHaveLength(SecurityEventConnectorCatalog.length);
      links.forEach((link: HTMLElement, index: number): void => {
        const expected: { title: string; category: string } =
          EXPECTED_GUIDES[index]!;
        expect(link).toHaveAccessibleName(
          `${expected.title} ${expected.category} (opens in a new tab)`,
        );
        expect(within(link).getByText(expected.title)).toHaveClass(
          "font-medium",
        );
        expect(within(link).getByText(expected.category)).toHaveClass(
          "text-xs",
        );
      });
    });

    test("every card opens that provider's docs page in a new tab", () => {
      renderEmptyState();

      for (const definition of SecurityEventConnectorCatalog) {
        const link: HTMLElement = within(guides()).getByRole("link", {
          name: new RegExp(`^${definition.title} `),
        });
        expect(link).toHaveAttribute(
          "href",
          connectorDocsUrl(definition).toString(),
        );
        expect(link.getAttribute("href")).toMatch(
          /\/docs\/integrations\/[a-z-]+$/,
        );
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute(
          "id",
          `${SECURITY_EVENT_CONNECTIONS_EMPTY_STATE_ID}-guides-${definition.provider}`,
        );
      }
    });

    test("Google SecOps is last and points at its own guide", () => {
      renderEmptyState();

      const links: Array<HTMLElement> = within(guides()).getAllByRole("link");
      expect(links[links.length - 1]).toHaveAccessibleName(
        "Google SecOps SIEM (opens in a new tab)",
      );
      expect(links[links.length - 1]?.getAttribute("href")).toMatch(
        /\/docs\/integrations\/google-secops$/,
      );
    });

    test("each card shows the provider's own icon", () => {
      renderEmptyState();

      for (const definition of SecurityEventConnectorCatalog) {
        const link: HTMLElement = within(guides()).getByRole("link", {
          name: new RegExp(`^${definition.title} `),
        });
        // The provider icon, then the external-link marker.
        expect(link.querySelectorAll("svg")).toHaveLength(2);
      }
    });

    test("are the only links in the empty state", () => {
      renderEmptyState();

      expect(screen.getAllByRole("link")).toHaveLength(
        within(guides()).getAllByRole("link").length,
      );
    });
  });

  describe("securityEventConnectorGuideLinks", () => {
    test("maps the whole catalog by default", () => {
      const links: Array<EmptyStateGuideLink> =
        securityEventConnectorGuideLinks();

      expect(links).toHaveLength(SecurityEventConnectorCatalog.length);
      expect(
        links.map((link: EmptyStateGuideLink): string => {
          return link.id;
        }),
      ).toEqual(
        SecurityEventConnectorCatalog.map(
          (definition: SecurityEventConnectorDefinition): string => {
            return definition.provider;
          },
        ),
      );
    });

    test("carries each provider's title, category, icon and docs URL", () => {
      const links: Array<EmptyStateGuideLink> =
        securityEventConnectorGuideLinks();

      SecurityEventConnectorCatalog.forEach(
        (definition: SecurityEventConnectorDefinition, index: number): void => {
          const link: EmptyStateGuideLink = links[index]!;
          expect(link.title).toBe(definition.title);
          expect(link.subtitle).toBe(definition.category);
          expect(link.icon).toBe(definition.icon);
          expect(link.to.toString()).toBe(
            connectorDocsUrl(definition).toString(),
          );
          expect(link.openInNewTab).toBe(true);
        },
      );
    });

    test("maps a given catalog, keeping its order", () => {
      const okta: SecurityEventConnectorDefinition =
        SecurityEventConnectorCatalog.find(
          (definition: SecurityEventConnectorDefinition): boolean => {
            return (
              definition.provider ===
              SecurityEventConnectorProvider.OktaSystemLog
            );
          },
        )!;
      const sentinel: SecurityEventConnectorDefinition =
        SecurityEventConnectorCatalog.find(
          (definition: SecurityEventConnectorDefinition): boolean => {
            return (
              definition.provider ===
              SecurityEventConnectorProvider.MicrosoftSentinel
            );
          },
        )!;

      const links: Array<EmptyStateGuideLink> =
        securityEventConnectorGuideLinks([okta, sentinel]);

      expect(
        links.map((link: EmptyStateGuideLink): string => {
          return link.title;
        }),
      ).toEqual(["Okta System Log", "Microsoft Sentinel"]);
    });

    test("an empty catalog gives no links", () => {
      expect(securityEventConnectorGuideLinks([])).toEqual([]);
    });

    test("provider ids are unique, so they are safe React keys and element ids", () => {
      const ids: Array<string> = securityEventConnectorGuideLinks().map(
        (link: EmptyStateGuideLink): string => {
          return link.id;
        },
      );

      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
