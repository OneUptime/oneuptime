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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Security Events > Entities, as a reader meets it. Riskiest Entities leads
 * the page now, in the shared table - a row per entity, its counts, its
 * worst severity and when it was last seen, each one click from Correlate,
 * which the card's words promised and the old table's rows never were -
 * with the shared window switch (a day, a week, a month). It used to sit
 * under the lookup, a table of its own that scrolled sideways on a phone.
 * Its reads that fail say why in the product's words, never a gateway's.
 */

import SecurityEntitiesPage, {
  ENTITY_WINDOWS_IN_DAYS,
  RISKIEST_ENTITIES_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Entities";
import SecurityCaseApi, {
  EntityActivity,
  EntityFindingSummary,
  SecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const NOW: Date = new Date();

function entity(
  value: string,
  findingCount: number,
  ruleCount: number,
  maxSeverityId: number,
): EntityFindingSummary {
  return {
    value,
    findingCount,
    ruleCount,
    maxSeverityId,
    lastSeen: new Date(NOW.getTime() - 9 * 60 * 1000),
  } as EntityFindingSummary;
}

const RANKED: Array<EntityFindingSummary> = [
  entity("203.0.113.47", 36, 2, 4),
  entity("k.morgan@acme-commerce.example", 33, 3, 5),
  entity("fin-ws-112", 12, 2, 5),
];

let daysAsked: Array<number> = [];
let topEntities: Array<EntityFindingSummary> = RANKED;
let topFailure: Error | null = null;
let navigatedTo: Array<string> = [];

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityEntitiesPage
          pageRoute={new Route("/dashboard/security-events/entities")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function rowOf(value: string): HTMLElement {
  return screen.getByTestId(`security-entity-row-${value}`);
}

beforeEach(() => {
  daysAsked = [];
  topEntities = RANKED;
  topFailure = null;
  navigatedTo = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "navigate").mockImplementation((route: unknown) => {
    navigatedTo.push(String(route));
  });
  jest
    .spyOn(SecurityCaseApi, "getTopEntities")
    .mockImplementation(
      async (data: {
        days: number;
        limit: number;
      }): Promise<Array<EntityFindingSummary>> => {
        daysAsked.push(data.days);

        if (topFailure) {
          throw topFailure;
        }

        return topEntities;
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Riskiest Entities", () => {
  test("leads the page, above the lookup, and says what an entity is", async () => {
    await renderPage();

    const headings: Array<string> = screen
      .getAllByRole("heading")
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });

    expect(headings.indexOf("Riskiest Entities")).toBeLessThan(
      headings.indexOf("Look Up an Entity"),
    );
    expect(document.body).toHaveTextContent(
      "The users, hosts, addresses and files your findings name most",
    );
  });

  test("is the shared table: a row per entity, in the order the findings rank them", async () => {
    await renderPage();

    // The shared table, as every list in the product draws one.
    expect(RISKIEST_ENTITIES_TABLE_ID).toBe("security-riskiest-entities");
    expect(screen.getByRole("table")).toBeInTheDocument();

    expect(
      within(screen.getByRole("table"))
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return (header.textContent || "").trim();
        })
        .filter(Boolean),
    ).toEqual([
      "Entity",
      "Findings",
      "Rules",
      "Worst Severity",
      "Last Seen",
      // Named for screen readers: Open in Correlate's column.
      "Actions",
    ]);

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      /^security-entity-row-/,
    );
    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-testid");
      }),
    ).toEqual(
      RANKED.map((item: EntityFindingSummary): string => {
        return `security-entity-row-${item.value}`;
      }),
    );

    const first: HTMLElement = rowOf("203.0.113.47");
    expect(first).toHaveTextContent("36");
    expect(first).toHaveTextContent("High");
    expect(first).toHaveTextContent("9 minutes ago");
  });

  test("opens each entity in Correlate, from its button and from its row", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(
        within(rowOf("fin-ws-112")).getByRole("button", {
          name: "Open in Correlate",
        }),
      );
    });

    expect(navigatedTo).toHaveLength(1);
    expect(navigatedTo[0]).toContain("/security-events/correlate");
    expect(navigatedTo[0]).toContain("observable=fin-ws-112");

    await act(async () => {
      fireEvent.click(within(rowOf("203.0.113.47")).getAllByRole("cell")[1]!);
    });

    expect(navigatedTo).toHaveLength(2);
    expect(navigatedTo[1]).toContain("observable=203.0.113.47");
  });

  test("ranks over a week first, and over a day or a month at the switch", async () => {
    await renderPage();

    expect(ENTITY_WINDOWS_IN_DAYS).toEqual([1, 7, 30]);
    expect(daysAsked).toEqual([7]);

    const switcher: HTMLElement = screen.getByTestId(
      "security-entities-window",
    );
    expect(
      within(switcher)
        .getAllByRole("radio")
        .map((option: HTMLElement): string => {
          return option.textContent || "";
        }),
    ).toEqual(["1 day", "7 days", "30 days"]);
    expect(
      within(switcher).getByRole("radio", { name: "7 days" }),
    ).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      fireEvent.click(within(switcher).getByRole("radio", { name: "30 days" }));
    });

    expect(daysAsked).toEqual([7, 30]);
    expect(
      within(switcher).getByRole("radio", { name: "30 days" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("an empty window says so, and what puts an entity here", async () => {
    topEntities = [];

    await renderPage();

    const empty: HTMLElement = screen.getByTestId("security-entities-empty");
    expect(empty).toHaveTextContent(
      "No finding named an entity in this window",
    );
    expect(empty).toHaveTextContent(
      "A user, host or address shows up here once a detection rule, a threat intel match or a connected product's alert names it.",
    );
  });

  test("a read that fails says so in the product's words, and Try again reads it again", async () => {
    topFailure = new SecurityApiError(
      "Request failed to https://oneuptime.example/api/security-case/top-entities. Gateway Timeout",
      504,
    );

    await renderPage();

    expect(document.body).toHaveTextContent(
      "Something went wrong. Try again in a moment.",
    );
    expect(document.body).not.toHaveTextContent("Gateway Timeout");

    topFailure = null;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    });

    expect(daysAsked).toEqual([7, 7]);
    expect(rowOf("203.0.113.47")).toBeInTheDocument();
  });

  test("a role that may not read them is told so, as the server words it", async () => {
    topFailure = new SecurityApiError(
      "You do not have permission to read Security Event.",
      403,
    );

    await renderPage();

    expect(document.body).toHaveTextContent(
      "You do not have permission to read Security Event.",
    );
  });
});

describe("Look Up an Entity", () => {
  test("says how busy any value has been, and opens it in Correlate", async () => {
    jest
      .spyOn(SecurityCaseApi, "getEntityActivity")
      .mockImplementation(async (): Promise<Array<EntityActivity>> => {
        return [
          {
            value: "web-01",
            eventCount: 412,
            findingCount: 3,
            maxSeverityId: 3,
            firstSeen: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
            lastSeen: new Date(NOW.getTime() - 5 * 60 * 1000),
          } as EntityActivity,
        ];
      });

    await renderPage();

    fireEvent.change(screen.getByTestId("security-entity-lookup-input"), {
      target: { value: "web-01" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
    });

    const result: HTMLElement = screen.getByTestId(
      "security-entity-lookup-result",
    );
    expect(result).toHaveTextContent("412 events");
    expect(result).toHaveTextContent("3 findings");
    expect(result).toHaveTextContent("Last seen 5 minutes ago");

    await act(async () => {
      fireEvent.click(
        within(result).getByRole("button", { name: "Open in Correlate" }),
      );
    });

    expect(navigatedTo[0]).toContain("observable=web-01");
  });

  test("a lookup that fails says so in the product's words", async () => {
    jest
      .spyOn(SecurityCaseApi, "getEntityActivity")
      .mockImplementation(async (): Promise<Array<EntityActivity>> => {
        throw new SecurityApiError("socket hang up", 502);
      });

    await renderPage();

    fireEvent.change(screen.getByTestId("security-entity-lookup-input"), {
      target: { value: "web-01" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Look Up" }));
    });

    expect(document.body).toHaveTextContent(
      "Something went wrong. Try again in a moment.",
    );
    expect(document.body).not.toHaveTextContent("socket hang up");
  });
});

/*
 * A busy week names a hundred entities: the ranking (read whole, the
 * server's top 100) is paged ten at a time with the foot every list has -
 * "Showing 1-10 of 23 entities", rows per page, the pages. It used to be
 * one table five screens long, with no count and no foot, and with no
 * foot the last row ran over the card's rounded corners.
 */
describe("Riskiest Entities, a page at a time", () => {
  const MANY: Array<EntityFindingSummary> = Array.from(
    { length: 23 },
    (_value: unknown, index: number): EntityFindingSummary => {
      return entity(`host-${index + 1}`, 100 - index, 1, 3);
    },
  );

  function shownValues(): Array<string> {
    return screen
      .getAllByTestId(/^security-entity-row-/)
      .map((row: HTMLElement): string => {
        return (row.getAttribute("data-testid") || "").replace(
          "security-entity-row-",
          "",
        );
      });
  }

  test("shows the first ten, and says how many there are in the foot", async () => {
    topEntities = MANY;

    await renderPage();

    expect(shownValues()).toEqual(
      MANY.slice(0, 10).map((item: EntityFindingSummary): string => {
        return item.value;
      }),
    );
    expect(screen.getByTestId("pagination-summary").textContent).toMatch(
      /^Showing 1.10 of 23 entities$/,
    );
  });

  test("the next page carries on down the ranking", async () => {
    topEntities = MANY;

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("pagination-next-button"));
    });

    expect(shownValues()).toEqual(
      MANY.slice(10, 20).map((item: EntityFindingSummary): string => {
        return item.value;
      }),
    );
    expect(screen.getByTestId("pagination-summary").textContent).toMatch(
      /^Showing 11.20 of 23 entities$/,
    );
  });

  test("another window starts at the top of its ranking", async () => {
    topEntities = MANY;

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTestId("pagination-next-button"));
    });
    expect(shownValues()[0]).toBe("host-11");

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("security-entities-window")).getByRole(
          "radio",
          { name: "1 day" },
        ),
      );
    });

    expect(daysAsked).toEqual([7, 1]);
    expect(shownValues()[0]).toBe("host-1");
  });

  test("a short ranking still has its foot, and nothing more to page to", async () => {
    await renderPage();

    expect(shownValues()).toHaveLength(RANKED.length);
    expect(screen.getByTestId("pagination-summary").textContent).toMatch(
      /^Showing 1.3 of 3 entities$/,
    );
    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
  });

  test("an empty window has no foot under its empty state", async () => {
    topEntities = [];

    await renderPage();

    expect(screen.getByTestId("security-entities-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("pagination-summary")).toBeNull();
  });
});

describe("Look Up an Entity's box and button", () => {
  test("the box is named for a screen reader, not only by its example", async () => {
    await renderPage();

    expect(screen.getByRole("textbox", { name: "Look Up an Entity" })).toBe(
      screen.getByTestId("security-entity-lookup-input"),
    );
  });

  /*
   * The input's own margins (mt-2 mb-1) stretched Look Up 12px taller than
   * the box beside it, the box sitting high. jsdom lays nothing out: the
   * offline browser suite measures the two; this holds the classes.
   */
  test("the box keeps no margins of its own, and the two share a line", async () => {
    await renderPage();

    const box: HTMLElement = screen.getByTestId("security-entity-lookup-input");
    const boxWrapper: HTMLElement = box.parentElement as HTMLElement;

    expect(boxWrapper.className.split(" ")).not.toEqual(
      expect.arrayContaining(["mt-2"]),
    );
    expect(boxWrapper.className.split(" ")).not.toEqual(
      expect.arrayContaining(["mb-1"]),
    );
    expect(
      (
        screen
          .getByRole("button", { name: "Look Up" })
          .closest(".sm\\:flex-row") as HTMLElement
      ).className.split(" "),
    ).toEqual(expect.arrayContaining(["sm:flex-row", "sm:items-center"]));
  });
});
