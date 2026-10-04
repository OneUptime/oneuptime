import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ADDING AN ON-CALL OVERRIDE ASKS WHO IS AWAY AND WHO COVERS, IN PLAIN
 * WORDS, STARTING NOW - on the real User Overrides pages (a policy's own
 * tab, and On-Call Duty > User Overrides for every policy), with only the
 * network stubbed.
 *
 * The dialog used to ask "Override User - Select the user who will override
 * the on-call duty" and "Route Alerts To User" over two steps (Users, Time
 * Window), with nothing filled in. The first one is the person whose pages
 * are rerouted, so the label said the opposite of what it did, and someone
 * covering a colleague could set the override up backwards. Now:
 *
 *   - it is one page: Who is away?, Who covers?, Starts, Ends;
 *   - Who is away? starts as you, Starts as now, and Ends is left to you;
 *   - Who covers? does not offer the person who is away, and the same
 *     person twice, or an end before the start, is refused before anything
 *     is sent;
 *   - the override is saved with the person away as overrideUserId and the
 *     person covering as routeAlertsToUserId, for the policy whose page it
 *     was added on, or for every policy;
 *   - the list reads Away, Covered by, Starts, Ends - with no policy column,
 *     which said the same thing on every row;
 *   - opened from "Get cover" on an upcoming shift, the page opens Add User
 *     Override on that shift's window, with you away.
 */

let permissionsForTest: Array<string> = [];
let signedInUserId: string | null = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return signedInUserId || "";
          },
        };
      },
      getProfilePictureRoute: (): string => {
        return "/picture";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0d400000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import GlobalUserOverridesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/UserOverrides";
import PolicyUserOverridesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/UserOverrides";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import { getUserOverrideCoverQueryParams } from "../../../Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

jest.setTimeout(30000);

const PROJECT_ID: string = "0d400000-0000-4000-8000-000000000001";
const POLICY_ID: string = "0d400000-0000-4000-8000-000000000002";

const ALEX: string = "0d400000-0000-4000-8000-0000000000a1";
const SAM: string = "0d400000-0000-4000-8000-0000000000b1";
const PAT: string = "0d400000-0000-4000-8000-0000000000c1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALEX]: { name: "Alex Chen", email: "alex@example.com" },
  [SAM]: { name: "Sam Rivera", email: "sam@example.com" },
  [PAT]: { name: "Pat Kim", email: "pat@example.com" },
};

// The dialog opens at 12:34 on 3 March 2026, UTC.
const NOW: Date = OneUptimeDate.fromString("2026-03-03T12:34:00.000Z");
const NEXT_WEEK: Date = OneUptimeDate.fromString("2026-03-10T09:00:00.000Z");

const pageProps: PageComponentProps = {
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

let overrides: Array<OnCallDutyPolicyUserOverride> = [];

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

// The ids an Includes query asks for, or every id when it asks for none.
function wanted(value: unknown, id: string): boolean {
  if (!(value instanceof Includes)) {
    return true;
  }

  return (value.values as Array<unknown>).some(
    (candidate: unknown): boolean => {
      return String(candidate).toLowerCase() === id.toLowerCase();
    },
  );
}

function user(id: string): User {
  const person: User = new User();
  person._id = id;
  person.name = new Name(PEOPLE[id]!.name);
  person.email = new Email(PEOPLE[id]!.email);
  return person;
}

function override(data: {
  away: string;
  cover: string;
}): OnCallDutyPolicyUserOverride {
  const row: OnCallDutyPolicyUserOverride = new OnCallDutyPolicyUserOverride();
  row._id = "0d400000-0000-4000-8000-0000000000f1";
  row.overrideUserId = new ObjectID(data.away);
  row.overrideUser = user(data.away);
  row.routeAlertsToUserId = new ObjectID(data.cover);
  row.routeAlertsToUser = user(data.cover);
  row.startsAt = NOW;
  row.endsAt = NEXT_WEEK;
  return row;
}

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  signedInUserId = ALEX;
  overrides = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    if (params.modelType === OnCallDutyPolicyUserOverride) {
      return list(overrides);
    }

    // The people pickers' search lists, and their look-ups by id.
    if (params.modelType === TeamMember) {
      return list(
        [ALEX, SAM, PAT]
          .filter((id: string): boolean => {
            return wanted(query["userId"], id);
          })
          .map((id: string): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.user = user(id);
            return member;
          }),
      );
    }

    return list([]);
  });

  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    return { data: data.model };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

type Page = "global" | "policy";

async function renderPage(page: Page, search: string = ""): Promise<void> {
  const path: string =
    page === "global"
      ? `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`
      : `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/user-overrides`;

  window.history.replaceState(window.history.state, "", `${path}${search}`);

  // The policy's page reads the policy's id from the route.
  Navigation.setLocation({
    pathname: path,
    search: search,
    hash: "",
    state: null,
    key: "test",
  } as never);

  render(
    <MemoryRouter>
      {page === "global" ? (
        <GlobalUserOverridesPage {...pageProps} />
      ) : (
        <PolicyUserOverridesPage {...pageProps} />
      )}
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      expect(
        getListMock.mock.calls.some((call: Array<any>): boolean => {
          return call[0].modelType === OnCallDutyPolicyUserOverride;
        }),
      ).toBe(true);
    },
    { timeout: 10000 },
  );
}

function overrideListQuery(): Record<string, unknown> {
  const call: Array<any> | undefined = getListMock.mock.calls.find(
    (candidate: Array<any>): boolean => {
      return candidate[0].modelType === OnCallDutyPolicyUserOverride;
    },
  );

  return (call?.[0].query || {}) as Record<string, unknown>;
}

function columnTitles(): Array<string> {
  return screen
    .getAllByRole("columnheader")
    .map((header: HTMLElement): string => {
      return (header.textContent || "").trim();
    })
    .filter((title: string): boolean => {
      return title.length > 0;
    });
}

async function openAddDialog(): Promise<HTMLElement> {
  const button: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = screen
      .getAllByRole("button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").trim() === "Add User Override";
      });

    if (!found) {
      throw new Error("No Add User Override button yet");
    }

    return found;
  });

  fireEvent.click(button);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByText("Who covers?");

  // BasicForm fills in the fields' defaults in an effect of its own.
  await waitFor(() => {
    expect(timeInput(modal, "Starts").value).not.toBe("");
  });

  return modal;
}

// The labels of the dialog's fields, in order.
function fieldLabels(modal: HTMLElement): Array<string> {
  return Array.from(modal.querySelectorAll("label"))
    .map((label: HTMLLabelElement): string => {
      return (label.textContent || "").replace("(Optional)", "").trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

function timeInput(modal: HTMLElement, title: string): HTMLInputElement {
  const label: HTMLLabelElement | undefined = Array.from(
    modal.querySelectorAll("label"),
  ).find((candidate: HTMLLabelElement): boolean => {
    return (candidate.textContent || "").trim().startsWith(title);
  });

  if (!label) {
    throw new Error(`No field ${title}`);
  }

  return modal.querySelector(
    `[id="${label.getAttribute("for")}"]`,
  ) as HTMLInputElement;
}

// The people picker under a question: its group is named by the label.
function picker(modal: HTMLElement, question: string): HTMLElement {
  return within(modal).getByRole("group", { name: question });
}

function chipIds(group: HTMLElement): Array<string | null> {
  return within(group)
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

async function openPicker(
  modal: HTMLElement,
  question: string,
  listName: string,
): Promise<HTMLElement> {
  fireEvent.click(
    within(picker(modal, question)).getByTestId("people-picker-add-button"),
  );

  const popup: HTMLElement = await screen.findByRole("dialog", {
    name: listName,
  });

  await waitFor(() => {
    expect(within(popup).getByRole("listbox")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  return popup;
}

function listedIds(popup: HTMLElement): Array<string | null> {
  return within(popup)
    .queryAllByRole("option")
    .map((option: HTMLElement): string | null => {
      return option.getAttribute("data-id");
    });
}

async function pick(
  modal: HTMLElement,
  question: string,
  listName: string,
  personId: string,
): Promise<void> {
  const popup: HTMLElement = await openPicker(modal, question, listName);

  const option: HTMLElement | undefined = within(popup)
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-id") === personId;
    });

  if (!option) {
    throw new Error(`${PEOPLE[personId]?.name} is not offered`);
  }

  await act(async (): Promise<void> => {
    fireEvent.click(option);
  });

  await waitFor(() => {
    expect(
      screen.queryByRole("dialog", { name: listName }),
    ).not.toBeInTheDocument();
  });
}

function setEnds(modal: HTMLElement, at: Date): void {
  fireEvent.change(timeInput(modal, "Ends"), {
    target: { value: OneUptimeDate.toDateTimeLocalString(at) },
  });
}

async function submit(modal: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(modal).getByRole("button", {
        name: "Add User Override",
        exact: true,
      }),
    );
  });
}

function sentOverride(): OnCallDutyPolicyUserOverride {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  return (createOrUpdateMock.mock.calls[0]![0] as any)
    .model as OnCallDutyPolicyUserOverride;
}

function idOf(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

describe.each(["global", "policy"] as Array<Page>)(
  "the %s User Overrides page",
  (page: Page) => {
    test("lists who is away, who covers, and when, with no policy column", async () => {
      overrides = [override({ away: ALEX, cover: SAM })];

      await renderPage(page);

      await screen.findAllByText("Alex Chen");

      await waitFor(() => {
        expect(columnTitles()).toEqual(
          expect.arrayContaining(["Away", "Covered by", "Starts", "Ends"]),
        );
      });

      const titles: Array<string> = columnTitles();

      expect(titles.indexOf("Away")).toBeLessThan(titles.indexOf("Covered by"));
      expect(titles.indexOf("Covered by")).toBeLessThan(
        titles.indexOf("Starts"),
      );
      expect(titles.indexOf("Starts")).toBeLessThan(titles.indexOf("Ends"));

      for (const retired of [
        "Override User",
        "Route Alerts To User",
        "Policy Name",
        "Starts At",
        "Ends At",
      ]) {
        expect(titles).not.toContain(retired);
      }

      // The row names Alex under Away and Sam under Covered by.
      const rows: Array<HTMLElement> = screen.getAllByRole("row");
      const dataRow: HTMLElement | undefined = rows.find(
        (row: HTMLElement): boolean => {
          return (row.textContent || "").includes("Alex Chen");
        },
      );

      expect(dataRow).toBeDefined();

      const cells: Array<string> = within(dataRow!)
        .getAllByRole("cell")
        .map((cell: HTMLElement): string => {
          return cell.textContent || "";
        });

      const awayCell: number = cells.findIndex((text: string): boolean => {
        return text.includes("Alex Chen");
      });
      const coverCell: number = cells.findIndex((text: string): boolean => {
        return text.includes("Sam Rivera");
      });

      expect(awayCell).toBeGreaterThanOrEqual(0);
      expect(coverCell).toBe(awayCell + 1);
    });

    test("lists the overrides it is about: the policy's, or the global ones", async () => {
      await renderPage(page);

      const query: Record<string, unknown> = overrideListQuery();

      if (page === "policy") {
        expect(String(query["onCallDutyPolicyId"])).toBe(POLICY_ID);
      } else {
        expect(query["onCallDutyPolicyId"]).toBeInstanceOf(IsNull);
      }
    });

    test("Add User Override is one page: who is away, who covers, starts, ends", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      expect(fieldLabels(modal)).toEqual([
        "Who is away?",
        "Who covers?",
        "Starts",
        "Ends",
      ]);

      // No steps.
      expect(
        screen.queryByRole("navigation", { name: "Progress" }),
      ).not.toBeInTheDocument();
      expect(within(modal).queryByText("Users")).not.toBeInTheDocument();
      expect(within(modal).queryByText("Time Window")).not.toBeInTheDocument();
      expect(
        within(modal).getByRole("button", {
          name: "Add User Override",
          exact: true,
        }),
      ).toBeInTheDocument();

      // Nothing of the old, inverted wording.
      for (const retired of [
        "Override User",
        "Select the user who will override the on-call duty.",
        "Route Alerts To User",
        "Select the user to whom alerts will be routed.",
      ]) {
        expect(modal.textContent).not.toContain(retired);
      }

      expect(modal).toHaveTextContent(
        "Alerts that would page them go to the person who covers.",
      );
      expect(modal).toHaveTextContent(
        "They get those alerts until the override ends.",
      );
    });

    test("starts with you away, from now, with who covers and the end left to you", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      await waitFor(() => {
        expect(chipIds(picker(modal, "Who is away?"))).toEqual([ALEX]);
      });

      // The chip shows the id at once, and the name once it is looked up.
      await waitFor(() => {
        expect(picker(modal, "Who is away?")).toHaveTextContent("Alex Chen");
      });
      expect(chipIds(picker(modal, "Who covers?"))).toEqual([]);
      expect(
        within(picker(modal, "Who covers?")).getByTestId(
          "people-picker-add-button",
        ),
      ).toHaveTextContent("Choose who covers");

      // Now, to the minute the input shows.
      expect(timeInput(modal, "Starts").value).toMatch(/^2026-03-03T12:34/);
      expect(timeInput(modal, "Ends").value).toBe("");
    });

    test("Who covers? does not offer the person who is away", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      const popup: HTMLElement = await openPicker(
        modal,
        "Who covers?",
        "Choose who covers",
      );

      expect(listedIds(popup)).toEqual([PAT, SAM]);
      expect(listedIds(popup)).not.toContain(ALEX);
    });

    test("saves you as away and the person you picked as covering", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      await pick(modal, "Who covers?", "Choose who covers", SAM);
      setEnds(modal, NEXT_WEEK);
      await submit(modal);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const sent: OnCallDutyPolicyUserOverride = sentOverride();

      // The regression: the person away is overrideUserId, never the cover.
      expect(idOf(sent.overrideUserId)).toBe(ALEX);
      expect(idOf(sent.routeAlertsToUserId)).toBe(SAM);
      expect(sent.overrideUserId).toBeInstanceOf(ObjectID);
      expect(sent.routeAlertsToUserId).toBeInstanceOf(ObjectID);

      expect(OneUptimeDate.fromString(sent.startsAt!).toISOString()).toBe(
        NOW.toISOString(),
      );
      expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
        NEXT_WEEK.toISOString(),
      );
      expect(idOf(sent.projectId)).toBe(PROJECT_ID);

      if (page === "policy") {
        expect(idOf(sent.onCallDutyPolicyId)).toBe(POLICY_ID);
      } else {
        expect(sent.onCallDutyPolicyId).toBeFalsy();
      }
    });

    test("books cover for someone else when Who is away? is changed", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      await waitFor(() => {
        expect(chipIds(picker(modal, "Who is away?"))).toEqual([ALEX]);
      });

      // Pat is off sick; Alex, signed in, covers.
      await pick(modal, "Who is away?", "Choose who is away", PAT);

      const popup: HTMLElement = await openPicker(
        modal,
        "Who covers?",
        "Choose who covers",
      );

      // Now Pat is the one left out.
      expect(listedIds(popup)).toEqual([ALEX, SAM]);

      const alex: HTMLElement = within(popup)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") === ALEX;
        })!;

      await act(async (): Promise<void> => {
        fireEvent.click(alex);
      });

      setEnds(modal, NEXT_WEEK);
      await submit(modal);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      expect(idOf(sentOverride().overrideUserId)).toBe(PAT);
      expect(idOf(sentOverride().routeAlertsToUserId)).toBe(ALEX);
    });

    test("asks who covers before saving", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      setEnds(modal, NEXT_WEEK);
      await submit(modal);

      expect(
        await within(modal).findByText("Choose who covers."),
      ).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("asks when the override ends before saving", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      await pick(modal, "Who covers?", "Choose who covers", SAM);
      await submit(modal);

      expect(await within(modal).findByText("Ends is required.")).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("refuses an end before the start", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      await pick(modal, "Who covers?", "Choose who covers", SAM);
      setEnds(modal, OneUptimeDate.fromString("2026-03-03T09:00:00.000Z"));
      await submit(modal);

      expect(
        await within(modal).findByText(
          "The override has to end after it starts.",
        ),
      ).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("refuses the same person away and covering", async () => {
      await renderPage(page);
      const modal: HTMLElement = await openAddDialog();

      await pick(modal, "Who covers?", "Choose who covers", SAM);
      // Then Sam is said to be the one away, too.
      await pick(modal, "Who is away?", "Choose who is away", SAM);
      setEnds(modal, NEXT_WEEK);
      await submit(modal);

      expect(
        await within(modal).findByText(
          "Choose someone other than the person who is away.",
        ),
      ).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });
  },
);

/*
 * "Get cover" on Jane's shift from 14:00 to 22:00 tomorrow, as the Upcoming
 * shifts card writes it (getUserOverrideCoverQueryParams).
 */
const SHIFT_STARTS: Date = OneUptimeDate.fromString("2026-03-04T14:00:00.000Z");
const SHIFT_ENDS: Date = OneUptimeDate.fromString("2026-03-04T22:00:00.000Z");

function coverSearch(window: { startsAt: Date; endsAt: Date }): string {
  const params: Record<string, string> =
    getUserOverrideCoverQueryParams(window);

  return `?${Object.entries(params)
    .map(([key, value]: [string, string]): string => {
      return `${key}=${value}`;
    })
    .join("&")}`;
}

async function findOpenDialog(): Promise<HTMLElement> {
  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByText("Who covers?");

  await waitFor(() => {
    expect(timeInput(modal, "Ends").value).not.toBe("");
  });

  return modal;
}

describe.each(["global", "policy"] as Array<Page>)(
  "the %s page, opened from 'Get cover' on an upcoming shift",
  (page: Page) => {
    test("opens Add User Override on the shift's window, with you away", async () => {
      await renderPage(
        page,
        coverSearch({ startsAt: SHIFT_STARTS, endsAt: SHIFT_ENDS }),
      );

      const modal: HTMLElement = await findOpenDialog();

      expect(timeInput(modal, "Starts").value).toMatch(/^2026-03-04T14:00/);
      expect(timeInput(modal, "Ends").value).toMatch(/^2026-03-04T22:00/);

      await waitFor(() => {
        expect(chipIds(picker(modal, "Who is away?"))).toEqual([ALEX]);
      });
      expect(chipIds(picker(modal, "Who covers?"))).toEqual([]);
    });

    test("takes the window out of the address, so a reload opens the page as usual", async () => {
      await renderPage(
        page,
        coverSearch({ startsAt: SHIFT_STARTS, endsAt: SHIFT_ENDS }),
      );

      await findOpenDialog();

      expect(window.location.search).toBe("");
    });

    test("books cover for that shift once who covers is picked", async () => {
      await renderPage(
        page,
        coverSearch({ startsAt: SHIFT_STARTS, endsAt: SHIFT_ENDS }),
      );

      const modal: HTMLElement = await findOpenDialog();

      await pick(modal, "Who covers?", "Choose who covers", SAM);
      await submit(modal);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const sent: OnCallDutyPolicyUserOverride = sentOverride();

      expect(idOf(sent.overrideUserId)).toBe(ALEX);
      expect(idOf(sent.routeAlertsToUserId)).toBe(SAM);
      expect(OneUptimeDate.fromString(sent.startsAt!).toISOString()).toBe(
        SHIFT_STARTS.toISOString(),
      );
      expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
        SHIFT_ENDS.toISOString(),
      );

      if (page === "policy") {
        expect(idOf(sent.onCallDutyPolicyId)).toBe(POLICY_ID);
      } else {
        expect(sent.onCallDutyPolicyId).toBeFalsy();
      }

      // Booked: the next Add User Override starts afresh, from now.
      await waitFor(() => {
        expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
      });

      const next: HTMLElement = await openAddDialog();

      expect(timeInput(next, "Starts").value).toMatch(/^2026-03-03T12:34/);
      expect(timeInput(next, "Ends").value).toBe("");
    });

    test("cancelled, it is not offered again: the next Add User Override starts from now", async () => {
      await renderPage(
        page,
        coverSearch({ startsAt: SHIFT_STARTS, endsAt: SHIFT_ENDS }),
      );

      const modal: HTMLElement = await findOpenDialog();

      fireEvent.click(
        within(modal).getByRole("button", { name: "Cancel", exact: true }),
      );

      await waitFor(() => {
        expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
      });

      const next: HTMLElement = await openAddDialog();

      expect(timeInput(next, "Starts").value).toMatch(/^2026-03-03T12:34/);
      expect(timeInput(next, "Ends").value).toBe("");
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("a shift that has started is covered from now", async () => {
      await renderPage(
        page,
        coverSearch({
          startsAt: OneUptimeDate.fromString("2026-03-03T08:00:00.000Z"),
          endsAt: SHIFT_ENDS,
        }),
      );

      const modal: HTMLElement = await findOpenDialog();

      expect(timeInput(modal, "Starts").value).toMatch(/^2026-03-03T12:34/);
    });

    test("an address that asks for nothing usable opens the page as usual", async () => {
      for (const search of [
        // The shift has ended.
        coverSearch({
          startsAt: OneUptimeDate.fromString("2026-03-02T08:00:00.000Z"),
          endsAt: OneUptimeDate.fromString("2026-03-02T16:00:00.000Z"),
        }),
        // Half of it.
        `?coverStartsAt=${encodeURIComponent(SHIFT_STARTS.toISOString())}`,
        // Not times at all.
        "?coverStartsAt=soon&coverEndsAt=later",
      ]) {
        await renderPage(page, search);

        await waitFor(() => {
          expect(
            screen
              .getAllByRole("button")
              .some((button: HTMLElement): boolean => {
                return (
                  (button.textContent || "").trim() === "Add User Override"
                );
              }),
          ).toBe(true);
        });

        expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
        // Nothing the page could use is left in the address either.
        expect(window.location.search).toBe("");

        cleanup();
      }
    });
  },
);

describe("with nobody known to be signed in", () => {
  test("Who is away? starts empty and is asked for", async () => {
    signedInUserId = null;

    await renderPage("global");
    const modal: HTMLElement = await openAddDialog();

    expect(chipIds(picker(modal, "Who is away?"))).toEqual([]);

    await pick(modal, "Who covers?", "Choose who covers", SAM);
    setEnds(modal, NEXT_WEEK);
    await submit(modal);

    expect(await within(modal).findByText("Choose who is away.")).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});
