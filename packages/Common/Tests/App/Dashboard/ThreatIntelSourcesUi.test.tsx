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
  waitFor,
  within,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * A threat-intel feed reads one of three sources: a list of indicators, a
 * TAXII collection or Google SecOps. The feed form asks for the source
 * first and then only that source's own fields; the Free Lists card adds a
 * free blocklist in one click. The feeds table is mocked to capture its
 * props; the Free Lists card renders for real, against a stubbed API.
 */

type CapturedField = Record<string, unknown> & {
  field?: Record<string, boolean>;
  title: string;
  stepId?: string;
  showIf?: (values: Record<string, unknown>) => boolean;
  required?: boolean | ((values: Record<string, unknown>) => boolean);
  customValidation?: (values: Record<string, unknown>) => string | null;
  doNotShowWhenEditing?: boolean;
  defaultValue?: unknown;
  radioButtonOptions?: Array<{
    value: string;
    title: string;
    description?: string;
  }>;
  dropdownModal?: { query?: Record<string, unknown>; labelField: string };
  sideLink?: { text: string; url: { toString: () => string } };
};

type CapturedTableProps = {
  formFields?: Array<CapturedField>;
  columns?: Array<{
    title: string;
    getElement?: (item: Record<string, unknown>) => React.ReactElement;
    isHiddenByDefault?: boolean;
    wrapContent?: boolean;
    contentClassName?: string;
  }>;
  emptyState?: { description?: string };
  actionButtons?: Array<{
    title: string;
    isVisible?: (item: Record<string, unknown>) => boolean;
  }>;
  createInitialValues?: Record<string, unknown>;
  refreshToggle?: string;
  onBeforeUpdate?: (item: Record<string, unknown>) => Promise<unknown>;
  onItemDeleted?: (item: Record<string, unknown>) => void;
  cardProps?: { title: string; description: string };
};

let capturedFeedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedFeedTableProps = props;
      return React.createElement("div", { "data-testid": "feeds-table" });
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return React.createElement("div", { "data-testid": "indicators-table" });
    },
  };
});

import ThreatIntelPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/ThreatIntel";
import ThreatIntelRecommendedLists, {
  buildFeedFromRecommendedList,
  isRecommendedListAdded,
  shouldShowRecommendedLists,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ThreatIntelRecommendedLists";
import {
  RECOMMENDED_THREAT_INTEL_LIST_TEXTS,
  THREAT_INTEL_FEED_TYPE_TEXTS,
  getThreatIntelFeedSource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ThreatIntelSourcesCopy";
import ThreatIntelFeed from "../../../Models/DatabaseModels/ThreatIntelFeed";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import ThreatIntelFeedType, {
  RECOMMENDED_THREAT_INTEL_LISTS,
  RecommendedThreatIntelList,
  THREAT_INTEL_FEED_TYPE_DEFINITIONS,
  ThreatIntelFeedTypeDefinition,
} from "../../../Types/SecurityEvent/ThreatIntelFeedType";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import BadDataException from "../../../Types/Exception/BadDataException";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const FEODO: RecommendedThreatIntelList = RECOMMENDED_THREAT_INTEL_LISTS.find(
  (list: RecommendedThreatIntelList): boolean => {
    return list.id === "feodo-tracker";
  },
)!;
const TOR: RecommendedThreatIntelList = RECOMMENDED_THREAT_INTEL_LISTS.find(
  (list: RecommendedThreatIntelList): boolean => {
    return list.id === "tor-exit-nodes";
  },
)!;

type Spy = ReturnType<typeof jest.spyOn>;

let getListSpy: Spy;
let createSpy: Spy;

function stubFeeds(listUrls: Array<string>): void {
  getListSpy = jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: listUrls.map((url: string): ThreatIntelFeed => {
      const feed: ThreatIntelFeed = new ThreatIntelFeed();
      feed.listUrl = url;
      return feed;
    }),
    count: listUrls.length,
    skip: 0,
    limit: 100,
  } as never);
}

// The page, once its Free Lists card has read which lists the project has.
async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <ThreatIntelPage
        pageRoute={new Route("/dashboard/security-events/threat-intel")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(
      screen.getByTestId("threat-intel-recommended-lists"),
    ).toHaveAttribute("data-loaded", "true");
  });
}

// The Free Lists card, once it has read which lists the project has.
async function renderLists(onAdded: () => void = () => {}): Promise<void> {
  render(
    <MemoryRouter>
      <ThreatIntelRecommendedLists onAdded={onAdded} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(
      screen.getByTestId("threat-intel-recommended-lists"),
    ).toHaveAttribute("data-loaded", "true");
  });
}

function fields(): Array<CapturedField> {
  return capturedFeedTableProps?.formFields || [];
}

function byColumn(column: string): CapturedField {
  const found: CapturedField | undefined = fields().find(
    (field: CapturedField): boolean => {
      return Object.keys(field.field || {})[0] === column;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function isRequired(
  field: CapturedField,
  values: Record<string, unknown>,
): boolean {
  return typeof field.required === "function"
    ? field.required(values)
    : Boolean(field.required);
}

const LIST: Record<string, unknown> = { feedType: "list" };
const TAXII: Record<string, unknown> = { feedType: "taxii" };
const SECOPS: Record<string, unknown> = { feedType: "google-secops" };

beforeEach(() => {
  capturedFeedTableProps = null;
  window.localStorage.clear();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  stubFeeds([]);
  createSpy = jest.spyOn(ModelAPI, "create").mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("a new feed's source", () => {
  test("is the first question: a list of indicators, a TAXII collection or Google SecOps", async () => {
    await renderPage();

    const source: CapturedField = byColumn("feedType");

    expect(source.stepId).toBe("source");
    expect(source.doNotShowWhenEditing).toBe(true);
    expect(source.defaultValue).toBe("list");
    expect(capturedFeedTableProps?.createInitialValues).toMatchObject({
      feedType: "list",
    });
    expect(
      (source.radioButtonOptions || []).map(
        (option: { value: string; title: string }) => {
          return [option.value, option.title];
        },
      ),
    ).toEqual([
      ["list", "List of indicators"],
      ["taxii", "TAXII collection"],
      ["google-secops", "Google SecOps"],
    ]);
  });

  test("each source asks only for its own fields, and requires them", async () => {
    await renderPage();

    const sourceFields: Array<string> = [
      "listUrl",
      "indicatorConfidence",
      "apiRootUrl",
      "collectionId",
      "securityEventConnection",
    ];

    const asked: (values: Record<string, unknown>) => {
      shown: Array<string>;
      required: Array<string>;
    } = (values: Record<string, unknown>) => {
      const own: Array<CapturedField> = sourceFields.map(byColumn);

      return {
        shown: own
          .filter((field: CapturedField) => {
            return !field.showIf || field.showIf(values);
          })
          .map((field: CapturedField) => {
            return Object.keys(field.field || {})[0]!;
          }),
        required: own
          .filter((field: CapturedField) => {
            return isRequired(field, values);
          })
          .map((field: CapturedField) => {
            return Object.keys(field.field || {})[0]!;
          }),
      };
    };

    expect(asked(LIST)).toEqual({
      shown: ["listUrl", "indicatorConfidence"],
      required: ["listUrl"],
    });
    expect(asked(TAXII)).toEqual({
      shown: ["apiRootUrl", "collectionId"],
      required: ["apiRootUrl", "collectionId"],
    });
    expect(asked(SECOPS)).toEqual({
      shown: ["securityEventConnection"],
      required: ["securityEventConnection"],
    });
  });

  test("a Google SecOps feed picks one of the project's Google SecOps connections, or connects one", async () => {
    await renderPage();

    const connection: CapturedField = byColumn("securityEventConnection");

    expect(connection.stepId).toBe("google-secops");
    expect(connection.dropdownModal?.labelField).toBe("name");
    expect(connection.dropdownModal?.query).toEqual({
      provider: SecurityEventConnectorProvider.GoogleSecOps,
    });
    expect(connection.sideLink?.text).toBe("Connect Google SecOps");
    expect(connection.sideLink?.url.toString()).toContain("connections");
  });

  test("a list is read every 15 minutes at most; a TAXII collection every minute", async () => {
    await renderPage();

    const pollInterval: CapturedField = byColumn("pollIntervalInMinutes");

    expect(
      pollInterval.customValidation!({ ...LIST, pollIntervalInMinutes: 5 }),
    ).toBe("A list is read every 15 minutes at most.");
    expect(
      pollInterval.customValidation!({ ...LIST, pollIntervalInMinutes: 15 }),
    ).toBeNull();
    expect(
      pollInterval.customValidation!({ ...TAXII, pollIntervalInMinutes: 1 }),
    ).toBeNull();
  });

  /*
   * A list's step asks for its address alone: how sure the list is (empty is
   * Medium) waits under its own More fields, as the source step's settings
   * that have a default do.
   */
  test("a list asks for its address alone; how sure the list is waits under More fields", async () => {
    await renderPage();

    const confidence: CapturedField = byColumn("indicatorConfidence");
    const address: CapturedField = byColumn("listUrl");

    expect(confidence.stepId).toBe("list");
    expect(confidence["collapsibleSection"]).toBeDefined();
    expect(isRequired(confidence, LIST)).toBe(false);
    expect(address["collapsibleSection"]).toBeUndefined();
    // Its own fold: the source step's More fields sit on another step.
    expect(confidence["collapsibleSection"]).not.toBe(
      byColumn("description")["collapsibleSection"],
    );
  });

  // The name's example fits every source, not a TAXII server only.
  test("a feed's name is asked in words that fit every source", async () => {
    await renderPage();

    const name: CapturedField = byColumn("name");

    expect(name.stepId).toBe("source");
    expect(name["placeholder"]).toBe("e.g. Partner threat feed");
    expect(name["description"]).toBe(
      "How this feed appears in the list and on its indicators.",
    );
  });

  test("a list's indicators all have the list's confidence: no confidence floor", async () => {
    await renderPage();

    const floor: CapturedField = byColumn("minimumConfidence");

    expect(floor.showIf!(LIST)).toBe(false);
    expect(floor.showIf!(TAXII)).toBe(true);
    expect(floor.showIf!(SECOPS)).toBe(true);
  });

  test("an edit does not send the source back", async () => {
    await renderPage();

    const item: Record<string, unknown> = {
      name: "Tor exit nodes",
      feedType: "list",
    };

    await capturedFeedTableProps!.onBeforeUpdate!(item);

    expect("feedType" in item).toBe(false);
    expect(item["name"]).toBe("Tor exit nodes");
  });
});

describe("the feeds table", () => {
  /*
   * Where a feed's indicators come from sits under its name on every row
   * (SecurityListNameCell): with a column of its own the table ran past
   * its card at 1280 (#5246).
   */
  test("says where each feed's indicators come from, under its name", async () => {
    await renderPage();

    const column:
      | {
          title: string;
          wrapContent?: boolean;
          getElement?: (item: Record<string, unknown>) => React.ReactElement;
        }
      | undefined = capturedFeedTableProps?.columns?.find(
      (each: { title: string }) => {
        return each.title === "Name";
      },
    );

    expect(column).toBeDefined();
    // A long name takes a second line rather than an ellipsis.
    expect(column?.wrapContent).toBe(true);

    for (const [item, text] of [
      [{ name: "Partner list", feedType: "list" }, "List of indicators"],
      [{ name: "Partner list", feedType: "google-secops" }, "Google SecOps"],
      [{ name: "Partner list", feedType: "taxii" }, "TAXII collection"],
      [{ name: "Partner list" }, "TAXII collection"],
    ] as Array<[Record<string, unknown>, string]>) {
      const { unmount } = render(column!.getElement!(item));

      expect(screen.getByTestId("security-list-name")).toHaveTextContent(
        "Partner list",
      );
      expect(
        screen.getByTestId("threat-intel-feed-source-cell"),
      ).toHaveTextContent(text);
      unmount();
    }
  });

  test("the source has no column of its own, and the table still reads it for every row", async () => {
    await renderPage();

    type Column = { title: string; isHiddenByDefault?: boolean };

    const columns: Array<Column> = capturedFeedTableProps?.columns || [];

    expect(
      columns.slice(0, 2).map((column: Column): string => {
        return column.title;
      }),
    ).toEqual(["Name", "Status"]);
    expect(
      columns.some((column: Column): boolean => {
        return column.title === "Source";
      }),
    ).toBe(false);
    expect(
      (
        capturedFeedTableProps as unknown as {
          selectMoreFields?: Record<string, unknown>;
        }
      ).selectMoreFields,
    ).toEqual({ feedType: true });
  });

  // A project with no feed has Free Lists right above the empty table.
  test("an empty table points at Free Lists first, then at a feed of one's own", async () => {
    await renderPage();

    expect(capturedFeedTableProps?.emptyState?.description).toBe(
      "Add a free list above in one click, or create a feed that reads your own list, a TAXII collection or Google SecOps.",
    );
  });

  test("offers Update Credentials on a TAXII feed only", async () => {
    await renderPage();

    const update: { isVisible?: (item: Record<string, unknown>) => boolean } =
      capturedFeedTableProps!.actionButtons!.find(
        (button: { title: string }) => {
          return button.title === "Update Credentials";
        },
      )!;

    expect(update.isVisible!({ feedType: "taxii" })).toBe(true);
    expect(update.isVisible!({})).toBe(true);
    expect(update.isVisible!({ feedType: "list" })).toBe(false);
    expect(update.isVisible!({ feedType: "google-secops" })).toBe(false);
  });

  test("names every source in its description", async () => {
    await renderPage();

    expect(capturedFeedTableProps?.cardProps?.description).toBe(
      "Where your indicators come from: lists of indicators, TAXII 2.1 collections and Google SecOps. Matching events get threat.* attributes, and a match opens a case, as a detection rule does.",
    );
  });
});

describe("Free Lists", () => {
  /*
   * Who publishes a list, how often it is read and its terms share one line
   * under its name: the tile's foot holds only its one action, so every tile
   * ends alike. A confidence number told a reader nothing; the feed's form
   * keeps it.
   */
  test("shows each free list with its publisher, schedule and terms", async () => {
    await renderLists();

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalled();
    });

    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      const tile: HTMLElement = screen.getByTestId(
        `threat-intel-list-${list.id}`,
      );
      const about: HTMLElement = screen.getByTestId(
        `threat-intel-list-about-${list.id}`,
      );

      expect(tile).toHaveTextContent(list.title);
      expect(about).toHaveTextContent(list.provider);
      expect(tile).not.toHaveTextContent("Confidence");

      const terms: HTMLElement = within(about).getByRole("link", {
        name: /Terms/,
      });

      expect(terms).toHaveAttribute("target", "_blank");
      expect(new URL(terms.getAttribute("href") || "").href).toBe(
        new URL(list.termsUrl).href,
      );
      expect(
        screen.getByTestId(`threat-intel-list-add-${list.id}`),
      ).toBeInTheDocument();
    }

    expect(
      screen.getByTestId("threat-intel-list-feodo-tracker"),
    ).toHaveTextContent("Read every hour");
    expect(
      screen.getByTestId("threat-intel-list-emerging-threats-compromised"),
    ).toHaveTextContent("Read every day");

    // It asked only for the project's list feeds, and only their addresses.
    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(args["query"]).toEqual({ feedType: ThreatIntelFeedType.List });
    expect(args["select"]).toEqual({ _id: true, listUrl: true });
  });

  test("a list the project reads already says Added", async () => {
    stubFeeds([FEODO.url.toUpperCase()]);

    await renderLists();

    expect(
      await screen.findByTestId("threat-intel-list-added-feodo-tracker"),
    ).toHaveTextContent("Added");
    expect(
      screen.queryByTestId("threat-intel-list-add-feodo-tracker"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("threat-intel-list-add-tor-exit-nodes"),
    ).toBeInTheDocument();
  });

  test("Add List creates the list feed, says Added and tells the page", async () => {
    const onAdded: Mock<() => void> = jest.fn<() => void>();

    await renderLists(onAdded);

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("threat-intel-list-add-tor-exit-nodes"));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    const created: ThreatIntelFeed = (
      createSpy.mock.calls[0]![0] as { model: ThreatIntelFeed }
    ).model;

    expect(created.feedType).toBe(ThreatIntelFeedType.List);
    expect(created.listUrl).toBe(TOR.url);
    expect(created.name).toBe(TOR.title);
    expect(created.indicatorConfidence).toBe(TOR.indicatorConfidence);
    expect(created.pollIntervalInMinutes).toBe(TOR.pollIntervalInMinutes);
    // The Tor exit nodes are worth a look, not a page: a case, no alert.
    expect(created.shouldCreateCase).toBe(true);
    expect(created.shouldCreateAlert).toBe(false);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByTestId("threat-intel-list-added-tor-exit-nodes"),
    ).toBeInTheDocument();
  });

  test("a list that could not be added says why, and stays to add", async () => {
    // Thrown as the call is made: a rejected promise built ahead trips zone.js's unhandled-rejection check.
    createSpy.mockImplementation((() => {
      throw new BadDataException("Threat intel list host is not allowed.");
    }) as never);

    await renderLists();

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("threat-intel-list-add-feodo-tracker"));

    expect(
      await screen.findByText(
        /Could not add Feodo Tracker botnet C2 servers: Threat intel list host is not allowed\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("threat-intel-list-add-feodo-tracker"),
    ).toBeInTheDocument();
  });

  test("someone who may not add feeds sees the lists, and why they cannot add one", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need Create Threat Intel Feed.",
    } as never);

    await renderLists();

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalled();
    });

    expect(
      screen.getByTestId("threat-intel-list-add-feodo-tracker"),
    ).toBeDisabled();
  });

  test("draws nothing until the project's feeds are read: no Add flashes for a list it has", async () => {
    let answer: (value: unknown) => void = () => {};

    getListSpy.mockImplementation((() => {
      return new Promise((resolve: (value: unknown) => void) => {
        answer = resolve;
      });
    }) as never);

    render(
      <MemoryRouter>
        <ThreatIntelRecommendedLists onAdded={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("threat-intel-recommended-lists"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Free Lists")).not.toBeInTheDocument();

    await act(async () => {
      answer({ data: [], count: 0, skip: 0, limit: 100 });
    });

    expect(
      await screen.findByTestId("threat-intel-recommended-lists"),
    ).toHaveAttribute("data-loaded", "true");
  });

  // A suggestion shows only while it applies: every list is a feed already.
  test("a project that reads every free list has no Free Lists card", async () => {
    stubFeeds(
      RECOMMENDED_THREAT_INTEL_LISTS.map(
        (list: RecommendedThreatIntelList): string => {
          return list.url;
        },
      ),
    );

    render(
      <MemoryRouter>
        <ThreatIntelRecommendedLists onAdded={() => {}} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalled();
    });
    // Past the read's answer: the card has decided, not merely not drawn yet.
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(
      screen.queryByTestId("threat-intel-recommended-lists"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Free Lists")).not.toBeInTheDocument();
  });

  // The card does not vanish under the click that adds the last list.
  test("adding the last list keeps the card, every tile saying Added", async () => {
    stubFeeds(
      RECOMMENDED_THREAT_INTEL_LISTS.filter(
        (list: RecommendedThreatIntelList): boolean => {
          return list.id !== TOR.id;
        },
      ).map((list: RecommendedThreatIntelList): string => {
        return list.url;
      }),
    );

    await renderLists();

    fireEvent.click(screen.getByTestId("threat-intel-list-add-tor-exit-nodes"));

    expect(
      await screen.findByTestId("threat-intel-list-added-tor-exit-nodes"),
    ).toBeInTheDocument();

    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      expect(
        screen.getByTestId(`threat-intel-list-added-${list.id}`),
      ).toHaveTextContent("Added");
    }
  });

  test("a read that fails still offers the lists, and says why", async () => {
    getListSpy.mockImplementation((() => {
      throw new BadDataException("The feeds could not be read.");
    }) as never);

    await renderLists();

    expect(
      screen.getByText("The feeds could not be read."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("threat-intel-list-add-feodo-tracker"),
    ).toBeInTheDocument();
  });

  test("has something to offer while a list is left to add, or one was added from it", () => {
    const every: Array<string> = RECOMMENDED_THREAT_INTEL_LISTS.map(
      (list: RecommendedThreatIntelList): string => {
        return list.url;
      },
    );

    const shows: (
      listUrls: Array<string>,
      hasAddedHere: boolean,
      hasError: boolean,
    ) => boolean = (
      listUrls: Array<string>,
      hasAddedHere: boolean,
      hasError: boolean,
    ): boolean => {
      return shouldShowRecommendedLists({ listUrls, hasAddedHere, hasError });
    };

    expect(shows([], false, false)).toBe(true);
    expect(shows(every.slice(1), false, false)).toBe(true);
    expect(shows(every, false, false)).toBe(false);
    // Read the way a project wrote it: case and spaces aside.
    expect(
      shows(
        every.map((url: string): string => {
          return ` ${url.toUpperCase()} `;
        }),
        false,
        false,
      ),
    ).toBe(false);
    // Added from the card just now, or a read that failed: it stays.
    expect(shows(every, true, false)).toBe(true);
    expect(shows(every, false, true)).toBe(true);
  });

  test("a feed of a list, as built: every recommended list raises a case, those worth a page an alert", () => {
    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      const feed: ThreatIntelFeed = buildFeedFromRecommendedList(list);

      expect(feed.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(feed.isEnabled).toBe(true);
      expect(feed.shouldWriteDetectionFinding).toBe(true);
      expect(feed.shouldCreateIncident).toBe(false);
      expect(feed.shouldCreateAlert).toBe(list.raisesAlerts);
    }

    expect(isRecommendedListAdded(FEODO, [` ${FEODO.url} `])).toBe(true);
    expect(isRecommendedListAdded(FEODO, [TOR.url])).toBe(false);
  });
});

describe("the words the page shows for Common's definitions", () => {
  test("are the definitions' own, word for word", () => {
    for (const definition of THREAT_INTEL_FEED_TYPE_DEFINITIONS) {
      expect(THREAT_INTEL_FEED_TYPE_TEXTS[definition.type]).toEqual({
        title: definition.title,
        description: definition.description,
      });
    }

    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      expect(RECOMMENDED_THREAT_INTEL_LIST_TEXTS[list.id]).toEqual({
        title: list.title,
        description: list.description,
      });
    }

    expect(Object.keys(THREAT_INTEL_FEED_TYPE_TEXTS).sort()).toEqual(
      THREAT_INTEL_FEED_TYPE_DEFINITIONS.map(
        (definition: ThreatIntelFeedTypeDefinition): string => {
          return definition.type;
        },
      ).sort(),
    );
  });

  test("a feed's source is read from its values, a TAXII collection when it has none", () => {
    expect(
      getThreatIntelFeedSource({ feedType: ThreatIntelFeedType.List }),
    ).toBe(ThreatIntelFeedType.List);
    expect(getThreatIntelFeedSource({})).toBe(ThreatIntelFeedType.Taxii);
    expect(
      getThreatIntelFeedSource({
        feedType: "rss",
      } as unknown as ThreatIntelFeed),
    ).toBe(ThreatIntelFeedType.Taxii);
  });

  test("every free list is served over https and polled no more often than its provider asks", () => {
    for (const list of RECOMMENDED_THREAT_INTEL_LISTS) {
      expect(list.url.startsWith("https://")).toBe(true);
      expect(list.termsUrl.startsWith("https://")).toBe(true);
      expect(list.pollIntervalInMinutes).toBeGreaterThanOrEqual(15);
      expect(list.indicatorConfidence).toBeGreaterThanOrEqual(1);
      expect(list.indicatorConfidence).toBeLessThanOrEqual(100);
    }
  });
});
