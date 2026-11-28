import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * REQUIRE UNIQUE NAMES, ON PROJECT SETTINGS > PROJECT (#10761).
 *
 * One switch that saves when flipped - while it is on, two monitors,
 * templates or other records of one kind cannot share a name in the
 * project - and under it the names the project already holds more than
 * once, kind by kind, each record linked to its page for renaming. Turning
 * it on refuses nothing that exists, so it never asks first, and the list
 * says the twins keep working until someone renames them.
 *
 * The real card, switch and list are drawn; the network (the project's
 * column and the server's list) and the permission snapshot are stubbed.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import RequireUniqueNamesCard from "../../../../App/FeatureSet/Dashboard/src/Components/Project/RequireUniqueNamesCard";
import RequireUniqueNamesCopy, {
  DUPLICATE_NAMES_TEST_ID,
  REQUIRE_UNIQUE_NAMES_COLUMN,
  REQUIRE_UNIQUE_NAMES_SWITCH_TEST_ID,
  UNIQUE_NAMES_CARD_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Project/RequireUniqueNamesCopy";
import Project from "../../../Models/DatabaseModels/Project";
import OneUptimeDate from "../../../Types/Date";
import {
  DuplicateNameGroup,
  DuplicateNamesAnswer,
  DuplicateNamesOfKind,
} from "../../../Types/Database/RequiredUniqueNames";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { DETAIL_SKELETON_TEST_ID } from "../../../UI/Components/Detail/DetailSkeleton";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import { writeReaderDay } from "../../../UI/Utils/ReaderMoments";
import UniqueNamesApi from "../../../UI/Utils/UniqueNamesApi";
import UserUtil from "../../../UI/Utils/User";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const PROJECT_ID: string = "9a9a9a9a-0000-4000-8000-000000010761";

const MONITOR_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const MONITOR_B: string = "aaaaaaaa-0000-4000-8000-00000000000b";
const GROUP_A: string = "bbbbbbbb-0000-4000-8000-00000000000a";
const GROUP_B: string = "bbbbbbbb-0000-4000-8000-00000000000b";
// An OpenStack budget's cloud (#11020).
const CLOUD: string = "cccccccc-0000-4000-8000-000000011020";

const CREATED_A: string = "2026-03-02T10:00:00.000Z";
const CREATED_B: string = "2026-09-14T08:30:00.000Z";

let stored: Record<string, unknown> = {};
let readDuplicatesMock: jest.SpyInstance<any, any>;

interface ItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function monitorKind(
  groups: Array<DuplicateNameGroup>,
  groupCount: number = groups.length,
): DuplicateNamesOfKind {
  return {
    tableName: "Monitor",
    pluralName: "Monitors",
    groupCount,
    groups,
  };
}

const API_HEALTH_CHECK: DuplicateNameGroup = {
  name: "API Health Check",
  count: 2,
  records: [
    {
      id: MONITOR_A,
      name: "API Health Check",
      createdAt: CREATED_A,
      isArchived: false,
    },
    {
      id: MONITOR_B,
      name: "api health check",
      createdAt: CREATED_B,
      isArchived: true,
    },
  ],
};

const EDGE: DuplicateNamesOfKind = {
  tableName: "MonitorGroup",
  pluralName: "Monitor Groups",
  groupCount: 1,
  groups: [
    {
      name: "Edge",
      count: 2,
      records: [
        { id: GROUP_A, name: "Edge", createdAt: CREATED_A, isArchived: false },
        { id: GROUP_B, name: "Edge", createdAt: CREATED_B, isArchived: false },
      ],
    },
  ],
};

function duplicates(kinds: Array<DuplicateNamesOfKind>): DuplicateNamesAnswer {
  return { requireUniqueNames: Boolean(stored["requireUniqueNames"]), kinds };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

function permit(permissions: Array<Permission>): void {
  getJestSpyOn(PermissionUtil, "getAllPermissions").mockReturnValue(
    permissions,
  );
}

async function renderCard(): Promise<HTMLElement> {
  render(<RequireUniqueNamesCard projectId={new ObjectID(PROJECT_ID)} />);
  await flush();
  return screen.getByTestId(REQUIRE_UNIQUE_NAMES_SWITCH_TEST_ID);
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function updateCall(index: number = 0): UpdateCall {
  return updateByIdMock.mock.calls[index]![0] as UpdateCall;
}

beforeEach(() => {
  stored = { requireUniqueNames: false };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    Object.assign(project, stored);
    return project;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      Object.assign(stored, (options as UpdateCall).data);
      return {};
    },
  );

  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  permit([Permission.ProjectOwner]);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );

  readDuplicatesMock = getJestSpyOn(
    UniqueNamesApi,
    "readDuplicates",
  ).mockImplementation(async (): Promise<DuplicateNamesAnswer> => {
    return duplicates([]);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the switch", () => {
  test("is one switch, Require Unique Names, under the card's title and line, with no Edit button", async () => {
    const control: HTMLElement = await renderCard();

    expect(
      screen.getByText(RequireUniqueNamesCopy.cardTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(RequireUniqueNamesCopy.cardDescription),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: RequireUniqueNamesCopy.switchTitle }),
    ).toBe(control);
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    // Found at #unique-names, where search and links take people.
    expect(document.getElementById(UNIQUE_NAMES_CARD_ID)).toContainElement(
      control,
    );
  });

  test("reads the project's column; off, it says records may share a name and forms still warn", async () => {
    const control: HTMLElement = await renderCard();

    const call: ItemCall = getItemMock.mock.calls[0]![0] as ItemCall;

    expect(call.modelType).toBe(Project);
    expect(call.id.toString()).toBe(PROJECT_ID);
    expect(call.select).toEqual({ requireUniqueNames: true });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(RequireUniqueNamesCopy.switchOffDescription),
    ).toBeInTheDocument();
  });

  test("on, it says a shared name is refused here, through the API and in Terraform, case and spaces aside", async () => {
    stored = { requireUniqueNames: true };

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(RequireUniqueNamesCopy.switchOnDescription),
    ).toBeInTheDocument();
    expect(RequireUniqueNamesCopy.switchOnDescription).toContain("API");
    expect(RequireUniqueNamesCopy.switchOnDescription).toContain("Terraform");
  });

  test("turning it on saves at once, with no dialog: it refuses nothing that exists", async () => {
    const control: HTMLElement = await renderCard();

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateCall().modelType).toBe(Project);
    expect(updateCall().id.toString()).toBe(PROJECT_ID);
    expect(updateCall().data).toEqual({ [REQUIRE_UNIQUE_NAMES_COLUMN]: true });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(RequireUniqueNamesCopy.switchOnDescription),
    ).toBeInTheDocument();
  });

  test("turning it off saves at once too", async () => {
    stored = { requireUniqueNames: true };

    const control: HTMLElement = await renderCard();

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCall().data).toEqual({ requireUniqueNames: false });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("a project admin may flip it", async () => {
    permit([Permission.ProjectAdmin]);

    const control: HTMLElement = await renderCard();

    expect(control).not.toHaveAttribute("aria-disabled", "true");

    await press(control);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });

  test("a member may not: it is locked, and pressing it saves nothing", async () => {
    permit([Permission.ProjectMember]);

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-disabled", "true");

    await press(control);

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("its words are short, and its column is the model's", () => {
    expect(REQUIRE_UNIQUE_NAMES_COLUMN).toBe("requireUniqueNames");
    expect(
      new Project().getTableColumnMetadata("requireUniqueNames"),
    ).toBeTruthy();
    expect(RequireUniqueNamesCopy.switchTitle).toBe("Require Unique Names");
    expect(RequireUniqueNamesCopy.cardTitle).toBe("Unique Names");

    for (const sentence of [
      RequireUniqueNamesCopy.cardDescription,
      RequireUniqueNamesCopy.switchOnDescription,
      RequireUniqueNamesCopy.switchOffDescription,
    ]) {
      expect(sentence.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("the names the project holds more than once", () => {
  test("while the list loads, a skeleton holds its place", async () => {
    readDuplicatesMock.mockImplementation((): Promise<DuplicateNamesAnswer> => {
      return new Promise((): void => {});
    });

    await renderCard();

    const details: HTMLElement = screen.getByTestId(
      `${REQUIRE_UNIQUE_NAMES_SWITCH_TEST_ID}-details`,
    );

    expect(
      within(details).getByTestId(DETAIL_SKELETON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("none repeat: one calm line says so", async () => {
    await renderCard();

    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-none`)),
    ).toBe("No two records of one kind share a name in this project.");
    expect(screen.queryByTestId(DUPLICATE_NAMES_TEST_ID)).toBeNull();
  });

  test("names held twice, kind by kind: each record linked to its page in a new tab, with the day it was made, and whether it is archived", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([monitorKind([API_HEALTH_CHECK]), EDGE]),
    );

    await renderCard();

    const list: HTMLElement = screen.getByTestId(DUPLICATE_NAMES_TEST_ID);

    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-summary`)),
    ).toBe(
      "2 names are used by more than one record. Turning this on keeps them working until someone renames them.",
    );

    const monitors: HTMLElement = within(list).getByRole("region", {
      name: "Monitors",
    });
    const groups: HTMLElement = within(list).getByRole("region", {
      name: "Monitor Groups",
    });

    expect(
      monitors.compareDocumentPosition(groups) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const links: Array<HTMLElement> = within(monitors).getAllByTestId(
      `${DUPLICATE_NAMES_TEST_ID}-record-link`,
    );

    expect(links.map(readText)).toEqual([
      "API Health Check",
      "api health check",
    ]);
    expect(links[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_A}`,
    );
    expect(links[1]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/${MONITOR_B}`,
    );
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
    }

    // The day each was made tells twins apart.
    expect(monitors).toHaveTextContent(
      `Created ${writeReaderDay(OneUptimeDate.fromString(CREATED_A))}`,
    );
    expect(monitors).toHaveTextContent(
      `Created ${writeReaderDay(OneUptimeDate.fromString(CREATED_B))}`,
    );

    // Only the archived one says so.
    expect(within(monitors).getAllByTestId("pill")).toHaveLength(1);
    expect(within(monitors).getByTestId("pill")).toHaveTextContent("Archived");

    expect(
      within(groups).getAllByTestId(
        `${DUPLICATE_NAMES_TEST_ID}-record-link`,
      )[0],
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitor-groups/${GROUP_A}`,
    );
  });

  test("while it is on, the list says the twins keep working, and new records and renames need a name of their own", async () => {
    stored = { requireUniqueNames: true };
    readDuplicatesMock.mockResolvedValue(
      duplicates([monitorKind([API_HEALTH_CHECK])]),
    );

    await renderCard();

    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-summary`)),
    ).toBe(
      "1 name is used by more than one record. They keep working until someone renames them. New records and renames need a name of their own.",
    );
  });

  test("flipping the switch changes what the list says, without asking the server for it again", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([monitorKind([API_HEALTH_CHECK])]),
    );

    const control: HTMLElement = await renderCard();

    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-summary`)),
    ).toContain(RequireUniqueNamesCopy.repeatKeptWhenTurnedOn);

    await press(control);

    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-summary`)),
    ).toContain(RequireUniqueNamesCopy.repeatKeptWhileOn);
    expect(readDuplicatesMock).toHaveBeenCalledTimes(1);
  });

  test("a kind whose names were cut says how many more; a name with records the reader cannot open says how many", async () => {
    const hidden: DuplicateNameGroup = {
      ...API_HEALTH_CHECK,
      count: 4,
    };

    readDuplicatesMock.mockResolvedValue(
      duplicates([monitorKind([hidden], 4)]),
    );

    await renderCard();

    const list: HTMLElement = screen.getByTestId(DUPLICATE_NAMES_TEST_ID);

    expect(list).toHaveTextContent("And 3 more names.");
    expect(list).toHaveTextContent("and 2 records you cannot open");
    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-summary`)),
    ).toContain("4 names are used by more than one record.");
  });

  test("one more name, one record the reader cannot open: said in the singular", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([monitorKind([{ ...API_HEALTH_CHECK, count: 3 }], 2)]),
    );

    await renderCard();

    const list: HTMLElement = screen.getByTestId(DUPLICATE_NAMES_TEST_ID);

    expect(list).toHaveTextContent("And 1 more name.");
    expect(list).toHaveTextContent("and 1 record you cannot open");
  });

  test("a kind with no page here: each record's name, without a link", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([
        {
          tableName: "AIAgent",
          pluralName: "AI Agents",
          groupCount: 1,
          groups: [
            {
              name: "Builder",
              count: 2,
              records: [
                {
                  id: MONITOR_A,
                  name: "Builder",
                  createdAt: null,
                  isArchived: false,
                },
                {
                  id: MONITOR_B,
                  name: "builder",
                  createdAt: null,
                  isArchived: false,
                },
              ],
            },
          ],
        },
      ]),
    );

    await renderCard();

    const agents: HTMLElement = screen.getByRole("region", {
      name: "AI Agents",
    });

    expect(agents).toHaveTextContent("Builder");
    expect(agents).toHaveTextContent("builder");
    expect(
      within(agents).queryByTestId(`${DUPLICATE_NAMES_TEST_ID}-record-link`),
    ).toBeNull();
    // No day to tell them apart by, and nothing invented.
    expect(agents).not.toHaveTextContent("Created");

    // Said plainly, once, under the kind: no page shows AI agents (#11020).
    const notes: Array<HTMLElement> = within(agents).getAllByTestId(
      `${DUPLICATE_NAMES_TEST_ID}-no-page`,
    );
    expect(notes).toHaveLength(1);
    expect(readText(notes[0]!)).toBe(
      "AI agents have no page in the dashboard: rename one with the API or Terraform.",
    );
  });

  test("a kind with a page says nothing of pages it has none of", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([monitorKind([API_HEALTH_CHECK]), EDGE]),
    );

    await renderCard();

    expect(
      screen.queryByTestId(`${DUPLICATE_NAMES_TEST_ID}-no-page`),
    ).toBeNull();
  });

  /*
   * The kinds opened under another record or page (#11020): linked from
   * what the server sends beside each record - only what the reader may
   * read, so a record without it is named without a link.
   */
  test("an OpenStack budget is linked to its cloud's Spend page; one whose cloud the reader may not read is not", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([
        {
          tableName: "OpenStackBudget",
          pluralName: "OpenStack Budgets",
          groupCount: 1,
          groups: [
            {
              name: "Compute",
              count: 2,
              records: [
                {
                  id: MONITOR_A,
                  name: "Compute",
                  createdAt: CREATED_A,
                  isArchived: false,
                  pageFields: { openStackCloudId: CLOUD },
                },
                {
                  id: MONITOR_B,
                  name: "compute",
                  createdAt: CREATED_B,
                  isArchived: false,
                },
              ],
            },
          ],
        },
      ]),
    );

    await renderCard();

    const budgets: HTMLElement = screen.getByRole("region", {
      name: "OpenStack Budgets",
    });
    const links: Array<HTMLElement> = within(budgets).getAllByTestId(
      `${DUPLICATE_NAMES_TEST_ID}-record-link`,
    );

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Compute");
    expect(links[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/openstack/${CLOUD}/spend`,
    );
    expect(links[0]).toHaveAttribute("target", "_blank");
    // The other is named, without a link.
    expect(budgets).toHaveTextContent("compute");
    expect(
      within(budgets).queryByTestId(`${DUPLICATE_NAMES_TEST_ID}-no-page`),
    ).toBeNull();
  });

  test("a workspace summary is linked to the Summary tab of its workspace's page", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([
        {
          tableName: "WorkspaceNotificationSummary",
          pluralName: "Workspace Notification Summaries",
          groupCount: 1,
          groups: [
            {
              name: "Morning",
              count: 2,
              records: [
                {
                  id: MONITOR_A,
                  name: "Morning",
                  createdAt: CREATED_A,
                  isArchived: false,
                  pageFields: {
                    workspaceType: "Slack",
                    summaryType: "Incident",
                  },
                },
                {
                  id: MONITOR_B,
                  name: "morning",
                  createdAt: CREATED_B,
                  isArchived: false,
                  pageFields: {
                    workspaceType: "MicrosoftTeams",
                    summaryType: "Alert Episode",
                  },
                },
              ],
            },
          ],
        },
      ]),
    );

    await renderCard();

    const links: Array<HTMLElement> = within(
      screen.getByRole("region", { name: "Workspace Notification Summaries" }),
    ).getAllByTestId(`${DUPLICATE_NAMES_TEST_ID}-record-link`);

    expect(
      links.map((link: HTMLElement): string | null => {
        return link.getAttribute("href");
      }),
    ).toEqual([
      `/dashboard/${PROJECT_ID}/incidents/workspace-connection-slack?tab=summary`,
      `/dashboard/${PROJECT_ID}/alerts/workspace-connection-microsoft-teams?tab=summary`,
    ]);
  });

  test("the list could not be read: says so, with why, and the switch still works", async () => {
    readDuplicatesMock.mockRejectedValue(new Error("Network down"));

    const control: HTMLElement = await renderCard();

    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-error`)),
    ).toMatch(/^Could not check which names are used more than once\. /);

    await press(control);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
  });
});

describe("in German", () => {
  const DE: Record<string, string> = readDashboardLocale("de");

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: { de: { translation: DE } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    await act(async () => {
      await i18next.changeLanguage("de");
    });
  });

  afterAll(async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
  });

  test("the card, the switch and the list read in German, the kinds in German", async () => {
    readDuplicatesMock.mockResolvedValue(
      duplicates([monitorKind([API_HEALTH_CHECK]), EDGE]),
    );

    await renderCard();

    expect(
      screen.getByText(DE[RequireUniqueNamesCopy.cardTitle]!),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: DE[RequireUniqueNamesCopy.switchTitle]!,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(DE[RequireUniqueNamesCopy.switchOffDescription]!),
    ).toBeInTheDocument();
    expect(
      readText(screen.getByTestId(`${DUPLICATE_NAMES_TEST_ID}-summary`)),
    ).toBe(
      `${DE[RequireUniqueNamesCopy.repeatCount.other]!.replace(
        "{{count}}",
        "2",
      )} ${DE[RequireUniqueNamesCopy.repeatKeptWhenTurnedOn]!}`,
    );
    expect(
      screen.getByRole("region", { name: DE["Monitors"]! }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: DE["Monitor Groups"]! }),
    ).toBeInTheDocument();
  });
});
