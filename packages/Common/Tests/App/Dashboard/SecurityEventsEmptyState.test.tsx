import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
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
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events with no events: a centred hero (a shield badge, the title
 * and one sentence), then the two ways events start arriving as two equal
 * cards - push JSON to the ingest endpoint (the setup guide), or have
 * OneUptime poll a security product (Connections).
 *
 * It used to be the full-page EmptyState dropped into a table: 13rem of
 * padding, one long sentence that tried to describe both ways at once, and
 * a primary and an outline button side by side, as if one way were the
 * real one. Each way is now a card of its own and one click target.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
      getCurrentPath: (): string => {
        return "/dashboard/11111111-1111-4111-8111-111111111111/security-events";
      },
      getParamByName: (): string => {
        return "11111111-1111-4111-8111-111111111111";
      },
      getCurrentRoute: (): string => {
        return "/dashboard/11111111-1111-4111-8111-111111111111/security-events";
      },
    },
  };
});

import SecurityEventsEmptyState, {
  SECURITY_EVENTS_EMPTY_STATE_ID,
  SECURITY_EVENTS_INGEST_METHOD,
  SECURITY_EVENTS_INGEST_PATH,
  SECURITY_EVENTS_WAYS_IN,
  SecurityEventsWayIn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsEmptyState";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorCategories,
  SecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import Icon from "../../../UI/Components/Icon/Icon";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const WAYS_LIST_NAME: string = "Ways to start sending security events";

const DESCRIPTION: string =
  "Events show up here as soon as a source starts sending. Every event is normalized to OCSF, whatever format it arrives in.";

/*
 * What each card must say and do, written out rather than read back from
 * SECURITY_EVENTS_WAYS_IN, so a change to the constant is a visible change
 * to this table too.
 */
interface ExpectedWayIn {
  id: string;
  icon: IconProp;
  title: string;
  description: string;
  actionTitle: string;
  actionTestId: string;
  destination: PageMap;
}

const EXPECTED_WAYS_IN: Array<ExpectedWayIn> = [
  {
    id: "send",
    icon: IconProp.PaperAirplane,
    title: "Send events to OneUptime",
    description:
      "POST JSON from a SIEM, a SOAR webhook, a log forwarder or any other source.",
    actionTitle: "Read the setup guide",
    actionTestId: `${SECURITY_EVENTS_EMPTY_STATE_ID}-setup-guide`,
    destination: PageMap.SECURITY_EVENTS_DOCUMENTATION,
  },
  {
    id: "connect",
    icon: IconProp.Link,
    title: "Pull from a security product",
    description:
      "OneUptime polls Microsoft Sentinel, CrowdStrike, Splunk and more on a schedule.",
    actionTitle: "Connect a security product",
    actionTestId: `${SECURITY_EVENTS_EMPTY_STATE_ID}-connections`,
    destination: PageMap.SECURITY_EVENTS_CONNECTIONS,
  },
];

function renderEmptyState(): RenderResult {
  return render(
    <MemoryRouter>
      <SecurityEventsEmptyState />
    </MemoryRouter>,
  );
}

function root(): HTMLElement {
  return document.getElementById(SECURITY_EVENTS_EMPTY_STATE_ID) as HTMLElement;
}

function waysList(): HTMLElement {
  return screen.getByRole("list", { name: WAYS_LIST_NAME });
}

function card(id: string): HTMLElement {
  return screen.getByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-${id}`);
}

function actionButton(wayIn: ExpectedWayIn): HTMLElement {
  return screen.getByRole("button", { name: wayIn.actionTitle });
}

function endpointChip(): HTMLElement {
  return screen.getByTestId(
    `${SECURITY_EVENTS_EMPTY_STATE_ID}-ingest-endpoint`,
  );
}

function categoriesLine(): HTMLElement {
  return screen.getByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-categories`);
}

function expectedRoute(pageMap: PageMap): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route).toString();
}

function navigatedTo(): Array<string> {
  return navigateMock.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

/*
 * The paths an icon draws, so a rendered badge can be matched to an
 * IconProp. The reference is rendered into a detached node, never into the
 * document the test queries.
 */
function iconPaths(icon: IconProp): string {
  const view: RenderResult = render(<Icon icon={icon} className="h-5 w-5" />, {
    container: document.createElement("div"),
  });
  const markup: string = view.container.querySelector("svg")?.innerHTML || "";
  view.unmount();
  return markup;
}

function svgPaths(element: Element | null): string {
  return element?.querySelector("svg")?.innerHTML || "";
}

// The element whose box an absolutely positioned ::after would cover.
function nearestPositionedAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    if (
      current.classList.contains("relative") ||
      current.classList.contains("absolute")
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function classTokens(element: Element): Array<string> {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
}

beforeEach((): void => {
  navigateMock.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("SecurityEventsEmptyState", () => {
  describe("hero", () => {
    test("keeps the id pages and tests target", () => {
      renderEmptyState();

      expect(SECURITY_EVENTS_EMPTY_STATE_ID).toBe(
        "security-events-empty-state",
      );
      expect(root()).toBeInTheDocument();
      expect(
        document.querySelectorAll(`#${SECURITY_EVENTS_EMPTY_STATE_ID}`),
      ).toHaveLength(1);
    });

    /*
     * The badge is decoration: the h3 under it already says what the page
     * is, so a screen reader must not announce an unnamed image first.
     */
    test("opens with a decorative shield badge, hidden from assistive technology", () => {
      renderEmptyState();

      const badge: HTMLElement = root().firstElementChild as HTMLElement;
      expect(badge.tagName).toBe("DIV");
      expect(badge).toHaveAttribute("aria-hidden", "true");
      expect(badge).toHaveClass(
        "mx-auto",
        "h-11",
        "w-11",
        "rounded-xl",
        "bg-indigo-50",
        "text-indigo-600",
      );
      expect(svgPaths(badge)).toBe(iconPaths(IconProp.ShieldCheck));
      expect(within(badge).queryByRole("img")).not.toBeInTheDocument();
    });

    test("the title is the only level-3 heading, directly after the badge", () => {
      renderEmptyState();

      const title: HTMLElement = screen.getByRole("heading", {
        level: 3,
        name: "No security events yet",
      });
      expect(screen.getAllByRole("heading", { level: 3 })).toEqual([title]);
      expect(root().firstElementChild?.nextElementSibling).toBe(title);
    });

    test("one sentence says events arrive on their own and are normalized to OCSF", () => {
      renderEmptyState();

      const description: HTMLElement = screen.getByTestId(
        `${SECURITY_EVENTS_EMPTY_STATE_ID}-description`,
      );
      expect(description.tagName).toBe("P");
      expect(description.textContent).toBe(DESCRIPTION);
      expect(screen.getByRole("heading", { level: 3 }).nextElementSibling).toBe(
        description,
      );
    });

    /*
     * The old description described both ways in, in one long sentence.
     * Each way now has its own card, so the hero must not repeat them.
     */
    test("the description no longer tries to explain both ways in", () => {
      renderEmptyState();

      const description: string =
        screen.getByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-description`)
          .textContent || "";
      expect(description).not.toContain("POST JSON");
      expect(description).not.toContain("SOAR webhook");
      expect(description).not.toContain("polls it for you");
      expect(description).not.toContain("dialect");
    });

    test("the description is capped to a readable width and centred", () => {
      renderEmptyState();

      expect(
        screen.getByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-description`),
      ).toHaveClass("max-w-xl", "mx-auto");
      expect(root()).toHaveClass("text-center", "w-full");
    });

    test("uses table padding rather than the full-page 13rem", () => {
      renderEmptyState();

      expect(root()).toHaveClass("py-8");
      expect(root()).not.toHaveClass("pt-52");
      expect(root()).not.toHaveClass("pb-52");
    });

    test("headings read as one outline: the title, then each card's title", () => {
      renderEmptyState();

      expect(
        Array.from(root().querySelectorAll("h1, h2, h3, h4, h5, h6")).map(
          (heading: Element): string => {
            return `${heading.tagName}:${heading.textContent}`;
          },
        ),
      ).toEqual([
        "H3:No security events yet",
        "H4:Send events to OneUptime",
        "H4:Pull from a security product",
      ]);
    });
  });

  describe("the ways in", () => {
    test("SECURITY_EVENTS_WAYS_IN is send, then connect, with their copy and icons", () => {
      expect(
        SECURITY_EVENTS_WAYS_IN.map(
          (wayIn: SecurityEventsWayIn): SecurityEventsWayIn => {
            return { ...wayIn };
          },
        ),
      ).toEqual(
        EXPECTED_WAYS_IN.map((wayIn: ExpectedWayIn): SecurityEventsWayIn => {
          return {
            id: wayIn.id,
            icon: wayIn.icon,
            title: wayIn.title,
            description: wayIn.description,
            actionTitle: wayIn.actionTitle,
          };
        }),
      );
    });

    test("every way has its own id, icon, title and action", () => {
      for (const key of ["id", "icon", "title", "actionTitle"] as const) {
        const values: Array<string> = SECURITY_EVENTS_WAYS_IN.map(
          (wayIn: SecurityEventsWayIn): string => {
            return String(wayIn[key]);
          },
        );
        expect({ key, unique: new Set(values).size }).toEqual({
          key,
          unique: values.length,
        });
      }
    });

    /*
     * role="list" is explicit because Safari drops list semantics from a
     * list styled with list-style: none, and the name says what the list
     * is to someone who cannot see the two cards side by side.
     */
    test("are a list named for what it offers, of exactly two cards in order", () => {
      renderEmptyState();

      const list: HTMLElement = waysList();
      expect(list.tagName).toBe("UL");
      expect(list).toHaveAttribute("role", "list");
      expect(list).toHaveAttribute("aria-label", WAYS_LIST_NAME);
      expect(root().contains(list)).toBe(true);

      const items: Array<HTMLElement> = within(list).getAllByRole("listitem");
      expect(
        items.map((item: HTMLElement): string | null => {
          return item.getAttribute("data-testid");
        }),
      ).toEqual([
        `${SECURITY_EVENTS_EMPTY_STATE_ID}-send`,
        `${SECURITY_EVENTS_EMPTY_STATE_ID}-connect`,
      ]);
      expect(Array.from(list.children)).toEqual(items);
    });

    test("the list follows the hero, after the description", () => {
      renderEmptyState();

      expect(
        screen.getByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-description`)
          .nextElementSibling,
      ).toBe(waysList());
    });

    test.each(EXPECTED_WAYS_IN)(
      "the $id card has its title as an h4, its description and its icon",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        const current: HTMLElement = card(wayIn.id);
        const title: HTMLElement = within(current).getByRole("heading", {
          level: 4,
        });
        expect(title).toHaveTextContent(wayIn.title);
        expect(title.textContent).toBe(wayIn.title);
        expect(title).toHaveAttribute(
          "id",
          `${SECURITY_EVENTS_EMPTY_STATE_ID}-${wayIn.id}-title`,
        );
        expect(within(current).getByText(wayIn.description).tagName).toBe("P");

        const badge: HTMLElement = title.previousElementSibling as HTMLElement;
        expect(badge).toHaveAttribute("aria-hidden", "true");
        expect(badge).toHaveClass("h-9", "w-9", "shrink-0", "rounded-lg");
        expect(svgPaths(badge)).toBe(iconPaths(wayIn.icon));
      },
    );

    /*
     * Three badges on one screen: the hero's shield and one per card. The
     * same mark twice would say two different things are the same thing.
     */
    test("the hero and the two cards each draw a different icon", () => {
      renderEmptyState();

      const drawn: Array<string> = [
        svgPaths(root().firstElementChild),
        svgPaths(card("send").querySelector("[aria-hidden='true']")),
        svgPaths(card("connect").querySelector("[aria-hidden='true']")),
      ];
      expect(drawn).toEqual([
        iconPaths(IconProp.ShieldCheck),
        iconPaths(IconProp.PaperAirplane),
        iconPaths(IconProp.Link),
      ]);
      for (const markup of drawn) {
        expect(markup.length).toBeGreaterThan(0);
      }
      expect(new Set(drawn).size).toBe(3);
    });

    /*
     * The same weight for both: neither way is the "real" one, so nothing
     * but the order tells them apart.
     */
    test("the two cards are built the same way, element for element", () => {
      renderEmptyState();

      const shape: (element: HTMLElement) => Array<string> = (
        element: HTMLElement,
      ): Array<string> => {
        return Array.from(element.children).map((child: Element): string => {
          return child.tagName;
        });
      };
      const send: HTMLElement = card("send");
      const connect: HTMLElement = card("connect");

      expect(send.className).toBe(connect.className);
      expect(shape(send)).toEqual(["DIV", "P", "DIV", "DIV"]);
      expect(shape(connect)).toEqual(shape(send));
      expect(
        within(send)
          .getAllByRole("button")
          .map((button: HTMLElement): string => {
            return button.className;
          }),
      ).toEqual(
        within(connect)
          .getAllByRole("button")
          .map((button: HTMLElement): string => {
            return button.className;
          }),
      );
    });

    /*
     * The connect card's description promises products by name; every one
     * of them must be a product the catalog can actually poll.
     */
    test("the products the connect card names are all in the connector catalog", () => {
      const titles: Array<string> = SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): string => {
          return definition.title;
        },
      );

      for (const product of ["Microsoft Sentinel", "CrowdStrike", "Splunk"]) {
        expect(EXPECTED_WAYS_IN[1]!.description).toContain(product);
        expect(
          titles.some((title: string): boolean => {
            return title.includes(product);
          }),
        ).toBe(true);
      }
    });
  });

  describe("each card is one click target", () => {
    test.each(EXPECTED_WAYS_IN)(
      "the $id card's action is a native button named for what it does",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        const button: HTMLElement = actionButton(wayIn);
        expect(button.tagName).toBe("BUTTON");
        expect(button).toHaveAttribute("type", "button");
        expect(button).toHaveAttribute("data-testid", wayIn.actionTestId);
        expect(screen.getByTestId(wayIn.actionTestId)).toBe(button);
        expect(button).toBeEnabled();
        // The arrow is drawn, not read: the name is the action alone.
        expect(button.textContent).toBe(wayIn.actionTitle);
        expect(button).toHaveAccessibleName(wayIn.actionTitle);
        expect(button.querySelector("svg")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        expect(svgPaths(button)).toBe(iconPaths(IconProp.ArrowRight));
        expect(card(wayIn.id).contains(button)).toBe(true);
      },
    );

    /*
     * "Read the setup guide" alone does not say what it is a guide to; the
     * card's title, read as the button's description, does.
     */
    test.each(EXPECTED_WAYS_IN)(
      "the $id card's button is described by its card's title",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        const button: HTMLElement = actionButton(wayIn);
        const titleId: string = `${SECURITY_EVENTS_EMPTY_STATE_ID}-${wayIn.id}-title`;
        expect(button).toHaveAttribute("aria-describedby", titleId);
        expect(button).toHaveAccessibleDescription(wayIn.title);

        const title: HTMLElement = document.getElementById(
          titleId,
        ) as HTMLElement;
        expect(title.tagName).toBe("H4");
        expect(card(wayIn.id).contains(title)).toBe(true);
        expect(document.querySelectorAll(`#${titleId}`)).toHaveLength(1);
      },
    );

    /*
     * Clicking anywhere on a card is modelled by the button's ::after: it
     * is absolutely positioned and inset to zero, so it covers the nearest
     * positioned ancestor, which must be the card itself and not some
     * wrapper in between.
     */
    test.each(EXPECTED_WAYS_IN)(
      "the $id card's button stretches over the whole card",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        const button: HTMLElement = actionButton(wayIn);
        expect(button).toHaveClass(
          "after:absolute",
          "after:inset-0",
          "after:rounded-lg",
          "after:content-['']",
        );
        expect(button).not.toHaveClass("relative");

        const current: HTMLElement = card(wayIn.id);
        expect(current).toHaveClass("relative", "rounded-lg");
        expect(nearestPositionedAncestor(button)).toBe(current);
      },
    );

    /*
     * The button drops its own outline, so the keyboard focus ring must be
     * drawn somewhere: on the overlay, around the whole card.
     */
    test.each(EXPECTED_WAYS_IN)(
      "the $id card shows keyboard focus around the whole card",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        const button: HTMLElement = actionButton(wayIn);
        expect(button).toHaveClass("focus:outline-none");
        expect(button).toHaveClass(
          "focus-visible:after:ring-2",
          "focus-visible:after:ring-indigo-500",
        );
      },
    );

    test.each(EXPECTED_WAYS_IN)(
      "the $id card's button is focusable",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        const button: HTMLElement = actionButton(wayIn);
        expect(button).not.toHaveAttribute("tabindex");
        button.focus();
        expect(button).toHaveFocus();
      },
    );

    test("a card has exactly one button, and the empty state has exactly two", () => {
      renderEmptyState();

      for (const wayIn of EXPECTED_WAYS_IN) {
        expect(within(card(wayIn.id)).getAllByRole("button")).toHaveLength(1);
      }
      expect(within(root()).getAllByRole("button")).toHaveLength(2);
      expect(root().querySelectorAll("button")).toHaveLength(2);
    });

    test("Tab reaches the setup guide, then Connections, and nothing else", async () => {
      const user: UserEvent = userEvent.setup({ delay: null });
      renderEmptyState();

      await user.tab();
      expect(actionButton(EXPECTED_WAYS_IN[0]!)).toHaveFocus();
      await user.tab();
      expect(actionButton(EXPECTED_WAYS_IN[1]!)).toHaveFocus();
      await user.tab();
      expect(document.body).toHaveFocus();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    /*
     * Everything in a card lies under the overlay except the endpoint,
     * which is raised so it can still be selected and copied. Raising
     * anything else would leave a dead spot on the card.
     */
    test("only the endpoint is raised above the overlay", () => {
      renderEmptyState();

      const raised: (element: HTMLElement) => Array<Element> = (
        element: HTMLElement,
      ): Array<Element> => {
        return Array.from(element.querySelectorAll("*")).filter(
          (child: Element): boolean => {
            return classTokens(child).some((token: string): boolean => {
              return /^z-/.test(token);
            });
          },
        );
      };

      expect(raised(card("send"))).toEqual([endpointChip()]);
      expect(raised(card("connect"))).toEqual([]);
    });

    test("the action sits at the bottom of its card, so the two stay level", () => {
      renderEmptyState();

      for (const wayIn of EXPECTED_WAYS_IN) {
        const current: HTMLElement = card(wayIn.id);
        expect(current).toHaveClass("flex", "flex-col", "min-w-0");
        const wrapper: HTMLElement = actionButton(wayIn)
          .parentElement as HTMLElement;
        expect(wrapper).toHaveClass("mt-auto");
        expect(wrapper).toBe(current.lastElementChild);
      }
    });

    test("hovering a card highlights its border and nudges its arrow", () => {
      renderEmptyState();

      for (const wayIn of EXPECTED_WAYS_IN) {
        expect(card(wayIn.id)).toHaveClass("group", "hover:border-indigo-300");
        expect(actionButton(wayIn).querySelector("svg")).toHaveClass(
          "group-hover:translate-x-0.5",
        );
      }
    });
  });

  describe("the send card's endpoint", () => {
    test("exports the ingest method and path it shows", () => {
      expect(SECURITY_EVENTS_INGEST_METHOD).toBe("POST");
      expect(SECURITY_EVENTS_INGEST_PATH).toBe("/security-events/v1/ingest");
    });

    /*
     * The chip is the API, not prose. If the route moved and the chip did
     * not, the empty state would send every new customer to a 404.
     */
    test("is the route Telemetry actually registers, with the same method", () => {
      const source: string = fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Telemetry/API/SecurityEventsIngest.ts",
        ),
        "utf8",
      );
      const routes: Array<{ method: string; path: string }> = Array.from(
        source.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g),
      ).map((match: RegExpMatchArray): { method: string; path: string } => {
        return { method: match[1] || "", path: match[2] || "" };
      });

      expect(
        routes
          .filter((route: { method: string; path: string }): boolean => {
            return route.method === "post";
          })
          .map((route: { method: string; path: string }): string => {
            return route.path;
          }),
      ).toEqual([SECURITY_EVENTS_INGEST_PATH]);
      expect(routes).toEqual([
        {
          method: SECURITY_EVENTS_INGEST_METHOD.toLowerCase(),
          path: SECURITY_EVENTS_INGEST_PATH,
        },
      ]);
    });

    /*
     * The chip shows the path from the host's root. That is only true while
     * Telemetry mounts the ingest router under "/" as well as "/telemetry";
     * mounted under "/telemetry" alone, the chip would name a 404.
     */
    test("is served from the root, where Telemetry mounts the ingest router", () => {
      const source: string = fs.readFileSync(
        path.join(__dirname, "../../../../App/FeatureSet/Telemetry/Index.ts"),
        "utf8",
      );

      const prefixes: RegExpMatchArray | null = source.match(
        /const TELEMETRY_PREFIXES: Array<string> = \[([^\]]*)\]/,
      );
      expect(prefixes).not.toBeNull();
      expect(
        Array.from((prefixes?.[1] || "").matchAll(/"([^"]*)"/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1] || "";
          },
        ),
      ).toContain("/");
      expect(source).toContain(
        "app.use(TELEMETRY_PREFIXES, SecurityEventsIngestAPI);",
      );
      expect(source).toMatch(
        /import SecurityEventsIngestAPI from "\.\/API\/SecurityEventsIngest";/,
      );
    });

    /*
     * The card's button opens the setup guide, which spells out the full
     * URL. The chip and the guide must name the same endpoint, or the two
     * would contradict each other one click apart.
     */
    test("is the endpoint the setup guide it opens tells customers to call", () => {
      const source: string = fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSetupGuide.tsx",
        ),
        "utf8",
      );
      const paths: Array<string> = Array.from(
        source.matchAll(/\/security-events\/v\d+\/[a-z-]+/g),
      ).map((match: RegExpMatchArray): string => {
        return match[0];
      });

      expect(paths.length).toBeGreaterThan(0);
      expect(Array.from(new Set(paths))).toEqual([SECURITY_EVENTS_INGEST_PATH]);
    });

    test("is code: the method in its own span, then the path", () => {
      renderEmptyState();

      const chip: HTMLElement = endpointChip();
      expect(chip.tagName).toBe("CODE");
      expect(card("send").contains(chip)).toBe(true);

      const parts: Array<Element> = Array.from(chip.children);
      expect(
        parts.map((part: Element): string => {
          return part.tagName;
        }),
      ).toEqual(["SPAN", "SPAN"]);
      expect(parts[0]?.textContent).toBe("POST");
      expect(parts[0]).toHaveClass("font-semibold", "text-indigo-600");
      expect(parts[1]?.textContent).toBe("/security-events/v1/ingest");
      expect(
        parts
          .map((part: Element): string => {
            return part.textContent || "";
          })
          .join(" "),
      ).toBe("POST /security-events/v1/ingest");
      expect(chip).toHaveTextContent(SECURITY_EVENTS_INGEST_PATH);
      expect(chip).toHaveClass("font-mono");
    });

    test("sits between the description and the action", () => {
      renderEmptyState();

      const chip: HTMLElement = endpointChip();
      const detail: HTMLElement = chip.parentElement as HTMLElement;
      expect(detail.previousElementSibling).toBe(
        within(card("send")).getByText(EXPECTED_WAYS_IN[0]!.description),
      );
      expect(detail.nextElementSibling).toBe(
        actionButton(EXPECTED_WAYS_IN[0]!).parentElement,
      );
    });

    /*
     * Raised above the card's overlay (relative z-10), so it can be
     * selected and copied instead of every click opening the guide.
     */
    test("is raised above the card's overlay so it can be selected", () => {
      renderEmptyState();

      const chip: HTMLElement = endpointChip();
      expect(chip).toHaveClass("relative", "z-10");
      expect(actionButton(EXPECTED_WAYS_IN[0]!).contains(chip)).toBe(false);
    });

    test("clicking the endpoint does not navigate", () => {
      renderEmptyState();

      fireEvent.click(endpointChip());
      fireEvent.click(endpointChip().firstElementChild as HTMLElement);
      fireEvent.click(endpointChip().lastElementChild as HTMLElement);

      expect(navigateMock).not.toHaveBeenCalled();
    });

    // A narrow card beside the filters must wrap the path, not overflow.
    test("wraps inside a narrow card instead of overflowing it", () => {
      renderEmptyState();

      expect(endpointChip()).toHaveClass(
        "max-w-full",
        "flex-wrap",
        "break-all",
      );
    });
  });

  describe("the connect card's categories", () => {
    test("list every connector category, joined by a middle dot", () => {
      renderEmptyState();

      const line: HTMLElement = categoriesLine();
      expect(line.tagName).toBe("P");
      expect(card("connect").contains(line)).toBe(true);
      expect(line.textContent).toBe(
        SecurityEventConnectorCategories.join(" · "),
      );
      expect(line.textContent).toBe(
        "SIEM · EDR / XDR · Cloud security · Identity",
      );
    });

    test("no product in the catalog is in a category the line leaves out", () => {
      for (const definition of SecurityEventConnectorCatalog) {
        expect(SecurityEventConnectorCategories).toContain(definition.category);
      }
    });

    test("lies under the overlay, so clicking it counts as clicking the card", () => {
      renderEmptyState();

      expect(categoriesLine()).not.toHaveClass("relative");
      expect(categoriesLine()).not.toHaveClass("z-10");
      expect(
        actionButton(EXPECTED_WAYS_IN[1]!).contains(categoriesLine()),
      ).toBe(false);
    });

    /*
     * The endpoint chip and the categories line are the one detail under
     * each description; the same text size, line height and padding keep
     * the two buttons below them level.
     */
    test("is the same height as the send card's endpoint", () => {
      renderEmptyState();

      for (const detail of [endpointChip(), categoriesLine()]) {
        expect(detail).toHaveClass("py-1", "text-xs", "leading-5");
      }
      expect(categoriesLine().parentElement).toHaveClass("mt-3");
      expect(endpointChip().parentElement).toHaveClass("mt-3");
    });
  });

  describe("navigation", () => {
    test("Read the setup guide opens the Security Events setup guide", () => {
      renderEmptyState();

      fireEvent.click(
        screen.getByRole("button", { name: "Read the setup guide" }),
      );

      expect(navigatedTo()).toEqual([
        expectedRoute(PageMap.SECURITY_EVENTS_DOCUMENTATION),
      ]);
      expect(navigatedTo()[0]).toMatch(/\/security-events\//);
      expect(navigatedTo()[0]).not.toContain(":projectId");
    });

    test("Connect a security product opens Security Events > Connections", () => {
      renderEmptyState();

      fireEvent.click(
        screen.getByRole("button", { name: "Connect a security product" }),
      );

      expect(navigatedTo()).toEqual([
        expectedRoute(PageMap.SECURITY_EVENTS_CONNECTIONS),
      ]);
      expect(navigatedTo()[0]).toMatch(/\/security-events\/connections$/);
      expect(navigatedTo()[0]).not.toContain(":projectId");
    });

    test.each(EXPECTED_WAYS_IN)(
      "the $id card's test id button navigates exactly once per click",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        fireEvent.click(screen.getByTestId(wayIn.actionTestId));
        expect(navigatedTo()).toEqual([expectedRoute(wayIn.destination)]);

        fireEvent.click(screen.getByTestId(wayIn.actionTestId));
        expect(navigatedTo()).toEqual([
          expectedRoute(wayIn.destination),
          expectedRoute(wayIn.destination),
        ]);
      },
    );

    test("both routes are populated with the current project", () => {
      for (const wayIn of EXPECTED_WAYS_IN) {
        expect(expectedRoute(wayIn.destination)).toContain(
          PROJECT_ID.toString(),
        );
      }
    });

    test("Enter and Space on the focused buttons navigate like a click", async () => {
      const user: UserEvent = userEvent.setup({ delay: null });
      renderEmptyState();

      await user.tab();
      await user.keyboard("{Enter}");
      await user.tab();
      await user.keyboard(" ");

      expect(navigatedTo()).toEqual([
        expectedRoute(PageMap.SECURITY_EVENTS_DOCUMENTATION),
        expectedRoute(PageMap.SECURITY_EVENTS_CONNECTIONS),
      ]);
    });

    test("the two actions go to different pages", () => {
      expect(expectedRoute(PageMap.SECURITY_EVENTS_DOCUMENTATION)).not.toBe(
        expectedRoute(PageMap.SECURITY_EVENTS_CONNECTIONS),
      );
    });

    test("nothing navigates until an action is clicked", () => {
      renderEmptyState();

      fireEvent.click(root());
      fireEvent.click(screen.getByRole("heading", { level: 3 }));
      fireEvent.click(waysList());
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe("layout", () => {
    /*
     * The list shares its row with the filters sidebar, so the window's
     * width says little about the room it has. Columns come from the
     * list's own width: two cards side by side when both fit at 16rem,
     * one above the other when they do not.
     */
    test("columns come from the list's own width, not viewport breakpoints", () => {
      renderEmptyState();

      const list: HTMLElement = waysList();
      expect(list).toHaveClass(
        "grid",
        "grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]",
        "gap-4",
      );
      expect(
        classTokens(list).filter((token: string): boolean => {
          return /^(sm|md|lg|xl|2xl):grid-cols-/.test(token);
        }),
      ).toEqual([]);
    });

    test("the list is centred at a readable width, and the cards read left to right", () => {
      renderEmptyState();

      expect(waysList()).toHaveClass("mx-auto", "max-w-3xl", "text-left");
    });

    /*
     * Beside the filters on a phone a card can be very narrow; its header
     * wraps the title under the badge rather than squeezing it to nothing.
     */
    test.each(EXPECTED_WAYS_IN)(
      "the $id card's header row wraps and never squeezes the title",
      (wayIn: ExpectedWayIn): void => {
        renderEmptyState();

        const title: HTMLElement = within(card(wayIn.id)).getByRole("heading", {
          level: 4,
        });
        const header: HTMLElement = title.parentElement as HTMLElement;
        expect(header).toHaveClass("flex", "flex-wrap", "items-center");
        expect(header).toBe(card(wayIn.id).firstElementChild);
        expect(title).toHaveClass("min-w-0");
      },
    );
  });

  describe("what it replaced", () => {
    /*
     * The old empty state had a primary "Read the setup guide" and an
     * outline "Connect a security product", as if pushing were the real
     * way and polling the fallback.
     */
    test("neither way is a primary button any more", () => {
      renderEmptyState();

      expect(root().querySelectorAll(".bg-indigo-600")).toHaveLength(0);
      for (const button of Array.from(root().querySelectorAll("button"))) {
        expect(button).not.toHaveClass("bg-indigo-600");
        expect(button).not.toHaveClass("bg-white");
        expect(button).not.toHaveClass("border-gray-300");
        expect(button).not.toHaveClass("md:!ml-0");
      }
    });

    /*
     * Both ways are in-app pages reached through the cards' buttons. A link
     * inside a card would be a second control under the same overlay.
     */
    test("has no links: each card's one control is its button", () => {
      renderEmptyState();

      expect(root().querySelectorAll("a")).toHaveLength(0);
      expect(within(root()).queryAllByRole("link")).toEqual([]);
    });

    test("the centred button footer is gone", () => {
      renderEmptyState();

      expect(
        screen.queryByTestId(`${SECURITY_EVENTS_EMPTY_STATE_ID}-footer`),
      ).not.toBeInTheDocument();
    });

    test("the old run-on description is gone", () => {
      renderEmptyState();

      expect(root()).not.toHaveTextContent(
        "Send events from any source that can POST JSON",
      );
      expect(root()).not.toHaveTextContent("whatever dialect it arrives in");
    });
  });
});
