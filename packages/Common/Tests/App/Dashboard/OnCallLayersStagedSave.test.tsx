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
 * THE LAYERS PAGE HOLDS ITS CHANGES UNTIL SAVE (issue #7575).
 *
 * Dragging someone in a layer of an on-call schedule used to save at once,
 * and each change made on its own told the people it reached who was on
 * call. The real Layers page here, with only the network stubbed: people
 * dragged, added and taken out, layers moved and deleted - held on the page,
 * shown as they will be, named in a bar at its foot, and sent in ONE request
 * by Save changes; Discard puts the layers back; leaving asks first; a save
 * refused because someone else changed the layers asks for a reload.
 *
 * The schedule: Primary - Alice, Bob and Carol taking turns of a day, Alice
 * on call now - and below it Backup, Dana. Erin is a member of the project
 * in no layer.
 */

let signedInUserId: string = "";

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectAdmin"] };
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
      isLoggedIn: (): boolean => {
        return true;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return signedInUserId;
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
const getItemMock: MockFunction = getJestMockFunction();
// Any write the page makes on its own, row by row: none is expected.
const rowWriteMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * consts, so they are dereferenced at call time.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { "x-common": "yes" };
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      create: (...args: Array<any>) => {
        return rowWriteMock("create", ...args);
      },
      createOrUpdate: (...args: Array<any>) => {
        return rowWriteMock("createOrUpdate", ...args);
      },
      updateById: (...args: Array<any>) => {
        return rowWriteMock("updateById", ...args);
      },
      deleteItem: (...args: Array<any>) => {
        return rowWriteMock("deleteItem", ...args);
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
            return "0d750000-0000-4000-8000-000000000001";
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

// The final schedule's calendar, as a list of its blocks.
jest.mock("../../../UI/Components/Calendar/Calendar", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      return (
        <ul data-testid="calendar-events">
          {(props.events || []).map((event: any, index: number) => {
            return (
              <li key={index} data-testid="calendar-event">
                {event.title}
              </li>
            );
          })}
        </ul>
      );
    },
    DefaultCalendarView: {
      Month: "month",
      Week: "week",
      Day: "day",
      Agenda: "agenda",
    },
  };
});

import Layers from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import ScheduleLayersSaveUtil, {
  ScheduleLayersSavePlan,
  ScheduleLayersSaveRequest,
  ScheduleLayersState,
} from "../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import Timezone from "../../../Types/Timezone";
import API from "../../../UI/Utils/API/API";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";

jest.setTimeout(60000);

const PROJECT_ID: string = "0d750000-0000-4000-8000-000000000001";
const SCHEDULE_ID: string = "0d750000-0000-4000-8000-000000000002";
const PRIMARY: string = "0d750000-0000-4000-8000-000000000003";
const BACKUP: string = "0d750000-0000-4000-8000-000000000004";

const ALICE: string = "0d750000-0000-4000-8000-0000000000a1";
const BOB: string = "0d750000-0000-4000-8000-0000000000b1";
const CAROL: string = "0d750000-0000-4000-8000-0000000000c1";
const DANA: string = "0d750000-0000-4000-8000-0000000000d1";
const ERIN: string = "0d750000-0000-4000-8000-0000000000e1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALICE]: { name: "Alice Andersson", email: "alice@example.com" },
  [BOB]: { name: "Bob Berg", email: "bob@example.com" },
  [CAROL]: { name: "Carol Chen", email: "carol@example.com" },
  [DANA]: { name: "Dana Diaz", email: "dana@example.com" },
  [ERIN]: { name: "Erin Ek", email: "erin@example.com" },
};

const MEMBERS: Array<string> = [ALICE, BOB, CAROL, DANA, ERIN];

const ROW: Record<string, string> = {
  [ALICE]: "0d750000-0000-4000-8000-000000000101",
  [BOB]: "0d750000-0000-4000-8000-000000000102",
  [CAROL]: "0d750000-0000-4000-8000-000000000103",
  [DANA]: "0d750000-0000-4000-8000-000000000201",
};

interface StoredLayer {
  id: string;
  name: string;
  order: number;
}

interface StoredRow {
  id: string;
  layerId: string;
  userId: string;
  order: number;
}

// The layers and their people as the server holds them.
let stored: { layers: Array<StoredLayer>; rows: Array<StoredRow> };
let createdRows: number;

interface SaveCall {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}

let saveCalls: Array<SaveCall>;
// How the server answers a save; by default, it saves it.
let answerSave: (
  body: JSONObject,
) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};
const ARROW_DOWN: { keyCode: number; key: string } = {
  keyCode: 40,
  key: "ArrowDown",
};

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

function user(id: string): User {
  const person: User = new User();
  person._id = id;
  person.name = new Name(PEOPLE[id]!.name);
  person.email = new Email(PEOPLE[id]!.email);
  return person;
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

/*
 * Daily turns, handing off six hours off the current time of day, 30 days
 * in: the first person's turn began six hours ago.
 */
function layerModel(storedLayer: StoredLayer): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  const anchor: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -30),
    -6,
  );

  layer._id = storedLayer.id;
  layer.name = storedLayer.name;
  layer.order = storedLayer.order;
  layer.projectId = new ObjectID(PROJECT_ID);
  layer.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
  layer.startsAt = anchor;
  layer.handOffTime = anchor;
  layer.rotation = Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: EventInterval.Day,
      intervalCount: { _type: "PositiveNumber", value: 1 },
    },
  } as JSONObject);

  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.None;
  layer.restrictionTimes = restrictionTimes;

  return layer;
}

function rowModel(storedRow: StoredRow): OnCallDutyPolicyScheduleLayerUser {
  const row: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  row._id = storedRow.id;
  row.order = storedRow.order;
  row.userId = new ObjectID(storedRow.userId);
  row.user = user(storedRow.userId);
  row.onCallDutyPolicyScheduleLayerId = new ObjectID(storedRow.layerId);
  row.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
  row.projectId = new ObjectID(PROJECT_ID);
  return row;
}

function storedState(): ScheduleLayersState {
  return {
    layers: stored.layers.map((layer: StoredLayer) => {
      return { id: layer.id, order: layer.order };
    }),
    layerUsers: stored.rows.map((row: StoredRow) => {
      return {
        id: row.id,
        layerId: row.layerId,
        userId: row.userId,
        order: row.order,
      };
    }),
  };
}

// The save, as the server applies it to what it holds.
function applySave(
  body: JSONObject,
): HTTPResponse<JSONObject> | HTTPErrorResponse {
  const request: ScheduleLayersSaveRequest =
    ScheduleLayersSaveUtil.parseRequest(body);
  const state: ScheduleLayersState = storedState();

  if (ScheduleLayersSaveUtil.getVersion(state) !== request.basedOnVersion) {
    return new HTTPErrorResponse(
      409,
      { error: "Someone else changed the layers of this schedule." },
      {},
    );
  }

  const plan: ScheduleLayersSavePlan = ScheduleLayersSaveUtil.plan({
    state: state,
    request: request,
  });

  const deletedLayers: Set<string> = new Set<string>(
    plan.layerDeletes.map((layer: { id: string }) => {
      return layer.id;
    }),
  );
  const deletedRows: Set<string> = new Set<string>(
    plan.layerUserDeletes.map((row: { id: string }) => {
      return row.id;
    }),
  );

  stored.layers = stored.layers.filter((layer: StoredLayer) => {
    return !deletedLayers.has(layer.id);
  });
  stored.rows = stored.rows.filter((row: StoredRow) => {
    return !deletedRows.has(row.id) && !deletedLayers.has(row.layerId);
  });

  for (const write of plan.layerOrderUpdates) {
    stored.layers.find((layer: StoredLayer) => {
      return layer.id === write.layer.id;
    })!.order = write.order;
  }

  for (const write of plan.layerUserOrderUpdates) {
    stored.rows.find((row: StoredRow) => {
      return row.id === write.layerUser.id;
    })!.order = write.order;
  }

  for (const create of plan.layerUserCreates) {
    createdRows++;
    stored.rows.push({
      id: `0d750000-0000-4000-8000-0000000009${String(createdRows).padStart(2, "0")}`,
      layerId: create.layerId,
      userId: create.userId,
      order: create.order,
    });
  }

  return new HTTPResponse<JSONObject>(
    200,
    ScheduleLayersSaveUtil.resultToJSON({
      version: ScheduleLayersSaveUtil.getVersion(storedState()),
      deletedLayers: plan.layerDeletes.length,
      movedLayers: 0,
      addedLayerUsers: plan.layerUserCreates.length,
      removedLayerUsers: plan.layerUserDeletes.length,
      movedLayerUsers: plan.layerUserMoves.length,
    }),
    {},
  );
}

beforeEach(() => {
  signedInUserId = ALICE;
  OneUptimeDate.setUserTimezone(Timezone.UTC);
  LeaveGuard.reset();

  createdRows = 0;
  stored = {
    layers: [
      { id: PRIMARY, name: "Primary", order: 1 },
      { id: BACKUP, name: "Backup", order: 2 },
    ],
    rows: [
      { id: ROW[ALICE]!, layerId: PRIMARY, userId: ALICE, order: 1 },
      { id: ROW[BOB]!, layerId: PRIMARY, userId: BOB, order: 2 },
      { id: ROW[CAROL]!, layerId: PRIMARY, userId: CAROL, order: 3 },
      { id: ROW[DANA]!, layerId: BACKUP, userId: DANA, order: 1 },
    ],
  };

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicySchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = SCHEDULE_ID;
      schedule.timezone = Timezone.UTC;
      return schedule;
    }

    return null;
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    if (params.modelType === OnCallDutyPolicyScheduleLayer) {
      return list(stored.layers.map(layerModel));
    }

    if (params.modelType === OnCallDutyPolicyScheduleLayerUser) {
      return list(stored.rows.map(rowModel));
    }

    if (params.modelType === OnCallDutyPolicyUserOverride) {
      return list([]);
    }

    // The people pickers, and who is a member of the project.
    if (params.modelType === TeamMember) {
      return list(
        MEMBERS.filter((id: string): boolean => {
          return wanted(query["userId"], id);
        }).map((id: string): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.userId = new ObjectID(id);
          member.user = user(id);
          member.hasAcceptedInvitation = true;
          return member;
        }),
      );
    }

    return list([]);
  });

  rowWriteMock.mockImplementation(async (): Promise<never> => {
    throw new Error("The page wrote a row on its own");
  });

  saveCalls = [];
  answerSave = async (
    body: JSONObject,
  ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    return applySave(body);
  };

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: { toString: () => string };
    data: JSONObject;
    headers: Record<string, string>;
  }) => {
    const url: string = options.url.toString();

    if (!url.includes("/save-layers")) {
      return new HTTPErrorResponse(404, { error: "Not here" }, {});
    }

    saveCalls.push({ url: url, data: options.data, headers: options.headers });
    return await answerSave(options.data);
  }) as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  rowWriteMock.mockReset();
  jest.restoreAllMocks();
  LeaveGuard.reset();
  OneUptimeDate.setUserTimezone(null);
});

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
}

async function press(
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
}

async function renderLayers(): Promise<void> {
  render(
    <MemoryRouter>
      <Layers
        onCallDutyPolicyScheduleId={new ObjectID(SCHEDULE_ID)}
        projectId={new ObjectID(PROJECT_ID)}
      />
    </MemoryRouter>,
  );

  // The first layer opens by itself, with its people listed and draggable.
  await waitFor(
    () => {
      expect(
        document.querySelectorAll("[data-rbd-drag-handle-draggable-id]").length,
      ).toBeGreaterThan(0);
    },
    { timeout: 10000 },
  );

  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

// The people of the open layer, in the order the page has them.
function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId(/^layer-user-(added-)?row$/);
}

function nameIn(element: HTMLElement): string {
  const text: string = element.textContent || "";
  return (
    MEMBERS.map((id: string): string => {
      return PEOPLE[id]!.name;
    }).find((name: string): boolean => {
      return text.includes(name);
    }) || "?"
  );
}

function shownPeople(): Array<string> {
  return rows().map(nameIn);
}

function rowOf(id: string): HTMLElement {
  const row: HTMLElement | undefined = rows().find(
    (candidate: HTMLElement): boolean => {
      return nameIn(candidate) === PEOPLE[id]!.name;
    },
  );

  if (!row) {
    throw new Error(`${PEOPLE[id]!.name} is not in the open layer`);
  }

  return row;
}

// A drag with the keyboard: up (negative) or down a number of places.
async function drag(id: string, places: number): Promise<void> {
  const grip: HTMLElement = rowOf(id).querySelector(
    "[data-rbd-drag-handle-draggable-id]",
  ) as HTMLElement;

  grip.focus();
  await press(grip, SPACE);
  for (let step: number = 0; step < Math.abs(places); step++) {
    await press(grip, places < 0 ? ARROW_UP : ARROW_DOWN);
  }
  await press(grip, SPACE);
  await wait(400);
}

async function removeFromLayer(id: string): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(rowOf(id)).getByRole("button", {
        name: "Remove user from layer",
      }),
    );
  });
}

async function addToOpenLayer(id: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add User" }));
  });

  const pick: HTMLElement = await screen.findByRole(
    "button",
    { name: new RegExp(PEOPLE[id]!.name) },
    { timeout: 5000 },
  );

  await act(async () => {
    fireEvent.click(pick);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add to layer" }));
  });
}

function bar(): HTMLElement {
  return screen.getByTestId("layers-save-bar");
}

function barLines(): Array<string> {
  return within(bar())
    .queryAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function clickSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("layers-save-bar-save"));
  });
}

// What the page's changes are made with, each a button of its own.
const CHANGE_BUTTONS: ReadonlyArray<string> = [
  "Remove user from layer",
  "Add User",
  "Delete layer",
  "Add Layer",
  "Add another layer",
];

// Each change button on the page, by name, and whether it can be pressed.
function changeButtons(): Array<{ name: string; disabled: boolean }> {
  return CHANGE_BUTTONS.flatMap(
    (name: string): Array<{ name: string; disabled: boolean }> => {
      return screen
        .getAllByRole("button", { name: name })
        .map((button: HTMLElement): { name: string; disabled: boolean } => {
          return { name, disabled: (button as HTMLButtonElement).disabled };
        });
    },
  );
}

/*
 * The page's changes wait: nobody can be dragged, taken out or added, and
 * no layer moved, deleted or added.
 */
function expectChangesToWait(): void {
  expect(
    document.querySelectorAll("[data-rbd-drag-handle-draggable-id]").length,
  ).toBe(0);
  expect(
    changeButtons().filter((button: { disabled: boolean }): boolean => {
      return !button.disabled;
    }),
  ).toEqual([]);
  for (const button of screen.queryAllByRole("button", {
    name: /^Move layer (up|down)/,
  })) {
    expect(button).toBeDisabled();
  }
}

// The page takes changes again.
function expectChangesToBeOpen(): void {
  expect(
    document.querySelectorAll("[data-rbd-drag-handle-draggable-id]").length,
  ).toBeGreaterThan(0);
  expect(
    changeButtons().filter((button: { disabled: boolean }): boolean => {
      return button.disabled;
    }),
  ).toEqual([]);
}

function onCallNow(): string {
  return (
    screen.getAllByTestId("layer-card-live-status")[0]!.textContent || ""
  ).trim();
}

function finalScheduleNames(): Set<string> {
  return new Set<string>(
    screen.queryAllByTestId("calendar-event").map((event: HTMLElement) => {
      return (event.textContent || "").trim();
    }),
  );
}

describe("a change is held on the page, not saved", () => {
  test("a drag sends nothing: the person is marked Moved, the bar names it, and the previews show the new order", async () => {
    await renderLayers();

    expect(shownPeople()).toEqual([
      "Alice Andersson",
      "Bob Berg",
      "Carol Chen",
    ]);
    expect(onCallNow()).toContain("Alice Andersson");
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(false);

    // Carol dragged to the top.
    await drag(CAROL, -2);

    expect(shownPeople()).toEqual([
      "Carol Chen",
      "Alice Andersson",
      "Bob Berg",
    ]);
    expect(saveCalls).toEqual([]);
    expect(rowWriteMock).not.toHaveBeenCalled();

    // Only Carol is marked: Alice and Bob kept their order.
    expect(
      within(rowOf(CAROL)).getByTestId("layer-user-moved"),
    ).toHaveTextContent("Moved");
    expect(within(rowOf(ALICE)).queryByTestId("layer-user-moved")).toBeNull();
    expect(within(rowOf(BOB)).queryByTestId("layer-user-moved")).toBeNull();

    expect(barLines()).toEqual(["New turn order in Primary"]);
    expect(bar()).toHaveTextContent("You have unsaved changes");
    expect(bar()).toHaveTextContent(
      "Nothing changes for the people on call until you save.",
    );

    // The card, and the final schedule, as it will be.
    expect(onCallNow()).toContain("Carol Chen");
    expect(screen.getAllByTestId("layer-card-unsaved").length).toBe(1);
    expect(screen.getByTestId("final-schedule-unsaved")).toHaveTextContent(
      "Includes unsaved changes",
    );
    expect(LeaveGuard.isHeld()).toBe(true);
  });

  test("dragging back where they were is no change: the bar goes", async () => {
    await renderLayers();

    await drag(BOB, 1);
    expect(shownPeople()).toEqual([
      "Alice Andersson",
      "Carol Chen",
      "Bob Berg",
    ]);
    expect(screen.getByTestId("layers-save-bar")).toBeInTheDocument();

    await drag(BOB, -1);

    expect(shownPeople()).toEqual([
      "Alice Andersson",
      "Bob Berg",
      "Carol Chen",
    ]);
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
    expect(screen.queryByTestId("layer-user-moved")).toBeNull();
    expect(screen.queryByTestId("final-schedule-unsaved")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(false);
  });

  test("someone taken out: listed under Removed when you save, with Undo - which puts them back where they were", async () => {
    await renderLayers();

    await removeFromLayer(BOB);

    expect(shownPeople()).toEqual(["Alice Andersson", "Carol Chen"]);
    const removed: HTMLElement = screen.getByTestId("layer-users-removed");
    expect(removed).toHaveTextContent("Removed when you save");
    expect(removed).toHaveTextContent("Bob Berg");
    expect(barLines()).toEqual(["1 user removed from Primary"]);
    expect(saveCalls).toEqual([]);

    // Bob has no turn in the final schedule as it will be.
    await waitFor(() => {
      expect(finalScheduleNames().has("Bob Berg")).toBe(false);
    });

    await act(async () => {
      fireEvent.click(
        within(removed).getByRole("button", { name: "Undo removing Bob Berg" }),
      );
    });

    expect(shownPeople()).toEqual([
      "Alice Andersson",
      "Bob Berg",
      "Carol Chen",
    ]);
    expect(screen.queryByTestId("layer-users-removed")).toBeNull();
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
  });

  test("someone added: at the end, marked New, in the final schedule - and not saved", async () => {
    await renderLayers();

    await addToOpenLayer(ERIN);

    expect(shownPeople()).toEqual([
      "Alice Andersson",
      "Bob Berg",
      "Carol Chen",
      "Erin Ek",
    ]);
    expect(within(rowOf(ERIN)).getByTestId("layer-user-new")).toHaveTextContent(
      "New",
    );
    expect(barLines()).toEqual(["1 user added to Primary"]);
    expect(saveCalls).toEqual([]);
    expect(rowWriteMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(finalScheduleNames().has("Erin Ek")).toBe(true);
    });
  });

  test("a layer moved up: the bar says so, and both layers show they changed", async () => {
    await renderLayers();

    const upButtons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Move layer up (higher priority)",
    });
    expect(upButtons[0]).toBeDisabled();

    await act(async () => {
      fireEvent.click(upButtons[1]!);
    });

    expect(barLines()).toEqual(["Layers in a new priority order"]);
    expect(screen.getAllByTestId("layer-card-unsaved").length).toBe(2);
    expect(saveCalls).toEqual([]);
  });

  test("a layer deleted: in its place, it says it goes when you save, with Undo", async () => {
    await renderLayers();

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Delete layer" })[1]!,
      );
    });

    const deleted: HTMLElement = screen.getByTestId("layer-deleted");
    expect(deleted).toHaveTextContent("Backup will be deleted when you save.");
    expect(barLines()).toEqual(["Backup will be deleted"]);
    expect(saveCalls).toEqual([]);
    // The one layer left cannot be moved past it, nor deleted.
    expect(
      screen.queryAllByRole("button", {
        name: "Move layer up (higher priority)",
      }),
    ).toEqual([]);

    await act(async () => {
      fireEvent.click(
        within(deleted).getByRole("button", { name: "Undo deleting Backup" }),
      );
    });

    expect(screen.queryByTestId("layer-deleted")).toBeNull();
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
  });

  test("the last layer kept cannot be deleted: the page says why", async () => {
    await renderLayers();

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Delete layer" })[1]!,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete layer" }));
    });

    expect(
      screen.getByText(
        "A schedule must have at least one layer. Add another layer before deleting this one.",
      ),
    ).toBeInTheDocument();
    expect(barLines()).toEqual(["Backup will be deleted"]);
  });

  test("the bar names the first three changes and counts the rest", async () => {
    await renderLayers();

    await removeFromLayer(BOB);
    await addToOpenLayer(ERIN);
    await drag(CAROL, -1);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", {
          name: "Move layer up (higher priority)",
        })[1]!,
      );
    });

    expect(barLines()).toEqual([
      "Layers in a new priority order",
      "1 user added to Primary",
      "1 user removed from Primary",
      "and 1 more change",
    ]);
  });
});

describe("Save changes", () => {
  test("sends every change at once, in one request - the layers as the page shows them", async () => {
    await renderLayers();
    const savedVersion: string =
      ScheduleLayersSaveUtil.getVersion(storedState());

    // Carol to the top, Bob out, Erin added, Backup moved above Primary.
    await drag(CAROL, -2);
    await removeFromLayer(BOB);
    await addToOpenLayer(ERIN);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", {
          name: "Move layer up (higher priority)",
        })[1]!,
      );
    });

    expect(saveCalls).toEqual([]);

    await clickSave();

    await screen.findByTestId("layers-save-bar-saved", undefined, {
      timeout: 5000,
    });

    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]!.url).toContain(
      `/on-call-duty-policy-schedule/${SCHEDULE_ID}/save-layers`,
    );
    expect(saveCalls[0]!.headers).toEqual(
      expect.objectContaining({ tenantid: PROJECT_ID, "x-common": "yes" }),
    );
    expect(saveCalls[0]!.data).toEqual({
      basedOnVersion: savedVersion,
      layers: [
        {
          layerId: BACKUP,
          users: [{ layerUserId: ROW[DANA], userId: DANA }],
        },
        {
          layerId: PRIMARY,
          users: [
            { layerUserId: ROW[CAROL], userId: CAROL },
            { layerUserId: ROW[ALICE], userId: ALICE },
            { userId: ERIN },
          ],
        },
      ],
      deletedLayerIds: [],
    });

    // No row written on its own along the way.
    expect(rowWriteMock).not.toHaveBeenCalled();

    // The page reads the layers again: as saved now, with nothing held.
    expect(screen.getByTestId("layers-save-bar-saved")).toHaveTextContent(
      "Changes saved",
    );
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
    expect(screen.queryByTestId("layer-user-moved")).toBeNull();
    expect(screen.queryByTestId("layer-user-new")).toBeNull();
    expect(screen.queryByTestId("layer-users-removed")).toBeNull();
    expect(screen.queryByTestId("final-schedule-unsaved")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(false);
  });

  test("a layer deleted is sent as deleted, and gone once saved", async () => {
    await renderLayers();

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Delete layer" })[1]!,
      );
    });
    await clickSave();
    await screen.findByTestId("layers-save-bar-saved", undefined, {
      timeout: 5000,
    });

    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]!.data["deletedLayerIds"]).toEqual([BACKUP]);
    expect(
      stored.layers.map((layer: StoredLayer) => {
        return layer.name;
      }),
    ).toEqual(["Primary"]);
    expect(screen.queryByTestId("layer-deleted")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Delete layer" }).length).toBe(
      1,
    );
  });

  test("while it saves, Save and Discard wait, and so does every other change", async () => {
    await renderLayers();
    await drag(CAROL, -2);

    let answer!: (
      response: HTTPResponse<JSONObject> | HTTPErrorResponse,
    ) => void;
    answerSave = (
      body: JSONObject,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      return new Promise(
        (
          resolve: (
            response: HTTPResponse<JSONObject> | HTTPErrorResponse,
          ) => void,
        ) => {
          answer = (): void => {
            resolve(applySave(body));
          };
        },
      );
    };

    await clickSave();

    const save: HTMLElement = screen.getByTestId("layers-save-bar-save");
    expect(save).toBeDisabled();
    expect(save).toHaveTextContent("Saving…");
    expect(screen.getByTestId("layers-save-bar-discard")).toBeDisabled();
    for (const button of screen.getAllByRole("button", {
      name: "Delete layer",
    })) {
      expect(button).toBeDisabled();
    }
    for (const button of screen.getAllByRole("button", {
      name: "Remove user from layer",
    })) {
      expect(button).toBeDisabled();
    }

    // A second click sends nothing more.
    await clickSave();
    expect(saveCalls.length).toBe(1);

    await act(async () => {
      answer(new HTTPResponse<JSONObject>(200, {}, {}));
    });
    await screen.findByTestId("layers-save-bar-saved", undefined, {
      timeout: 5000,
    });
    expect(saveCalls.length).toBe(1);
  });

  test("a refusal says why under the changes, and keeps them to save again", async () => {
    await renderLayers();
    await removeFromLayer(BOB);

    answerSave = async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(
        400,
        {
          error:
            "You do not have permission to take people out of this schedule's layers.",
        },
        {},
      );
    };

    await clickSave();

    const refusal: HTMLElement = await screen.findByTestId(
      "layers-save-bar-error",
    );
    expect(refusal).toHaveTextContent(
      "You do not have permission to take people out of this schedule's layers.",
    );
    expect(shownPeople()).toEqual(["Alice Andersson", "Carol Chen"]);
    expect(barLines()).toEqual(["1 user removed from Primary"]);
    expect(LeaveGuard.isHeld()).toBe(true);

    // Allowed now: saved.
    answerSave = async (
      body: JSONObject,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      return applySave(body);
    };
    await clickSave();
    await screen.findByTestId("layers-save-bar-saved", undefined, {
      timeout: 5000,
    });

    expect(saveCalls.length).toBe(2);
    expect(
      stored.rows.map((row: StoredRow) => {
        return row.userId;
      }),
    ).not.toContain(BOB);
  });

  test("someone else changed the layers first: nothing is saved, changes wait, and the bar asks for a reload", async () => {
    await renderLayers();
    await drag(CAROL, -2);

    // Someone else adds Erin to Backup meanwhile.
    stored.rows.push({
      id: "0d750000-0000-4000-8000-000000000301",
      layerId: BACKUP,
      userId: ERIN,
      order: 2,
    });

    await clickSave();

    const conflict: HTMLElement = await screen.findByTestId(
      "layers-save-bar-conflict",
    );
    expect(conflict).toHaveTextContent("Someone else changed these layers");
    expect(conflict).toHaveTextContent(
      "Your changes were not saved. Reload to see the layers as they are now, then make your changes again.",
    );
    // Nothing of this page's was saved; its changes are still on it.
    expect(
      stored.rows
        .filter((row: StoredRow) => {
          return row.layerId === PRIMARY;
        })
        .map((row: StoredRow) => {
          return `${row.userId}:${row.order}`;
        }),
    ).toEqual([`${ALICE}:1`, `${BOB}:2`, `${CAROL}:3`]);
    expect(shownPeople()).toEqual([
      "Carol Chen",
      "Alice Andersson",
      "Bob Berg",
    ]);
    expect(LeaveGuard.isHeld()).toBe(true);

    /*
     * A change made now would be refused as well - the layers have moved on
     * - so every change waits for Reload layers, and the bar offers nothing
     * else to press.
     */
    expectChangesToWait();
    expect(screen.queryByTestId("layers-save-bar-save")).toBeNull();
    expect(screen.queryByTestId("layers-save-bar-discard")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("layers-save-bar-reload"));
    });

    // The layers as they are now: theirs, without this page's changes.
    await waitFor(() => {
      expect(screen.queryByTestId("layers-save-bar-conflict")).toBeNull();
    });
    expect(shownPeople()).toEqual([
      "Alice Andersson",
      "Bob Berg",
      "Carol Chen",
    ]);
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(false);
    expect(saveCalls.length).toBe(1);

    // Read again: changes are made once more.
    expectChangesToBeOpen();
  });

  test("saved, but the layers could not be read back: nothing is marked unsaved, and changes wait for Reload layers", async () => {
    await renderLayers();

    // Carol to the top, Bob out, Erin added, Backup deleted.
    await drag(CAROL, -2);
    await removeFromLayer(BOB);
    await addToOpenLayer(ERIN);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Delete layer" })[1]!,
      );
    });

    // The save goes through; reading the layers again after it does not.
    const readList: (params: any) => Promise<any> =
      getListMock.getMockImplementation()!;
    let layerReadsFail: boolean = false;
    getListMock.mockImplementation(async (params: any): Promise<any> => {
      if (
        layerReadsFail &&
        params.modelType === OnCallDutyPolicyScheduleLayer
      ) {
        throw new Error("The layers could not be loaded.");
      }

      return await readList(params);
    });
    answerSave = async (
      body: JSONObject,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        applySave(body);
      layerReadsFail = true;
      return response;
    };

    await clickSave();

    const saved: HTMLElement = await screen.findByTestId(
      "layers-save-bar-reload-failed",
      undefined,
      { timeout: 5000 },
    );
    expect(saved).toHaveTextContent("Your changes were saved");
    expect(saved).toHaveTextContent(
      "The page could not load the layers again. Reload to keep editing them.",
    );
    expect(saveCalls.length).toBe(1);
    expect(
      stored.rows.map((row: StoredRow) => {
        return `${PEOPLE[row.userId]!.name}:${row.order}`;
      }),
    ).toEqual(["Alice Andersson:2", "Carol Chen:1", "Erin Ek:3"]);
    expect(
      stored.layers.map((layer: StoredLayer) => {
        return layer.name;
      }),
    ).toEqual(["Primary"]);

    // The page shows the layers as saved, and marks nothing as still to save.
    expect(shownPeople()).toEqual(["Carol Chen", "Alice Andersson", "Erin Ek"]);
    expect(screen.queryAllByTestId("layer-user-added-row")).toEqual([]);
    expect(screen.queryByTestId("layer-user-new")).toBeNull();
    expect(screen.queryByTestId("layer-user-moved")).toBeNull();
    expect(screen.queryByTestId("layer-users-removed")).toBeNull();
    expect(screen.queryByTestId("layer-deleted")).toBeNull();
    expect(screen.queryByTestId("layer-card-unsaved")).toBeNull();
    expect(screen.queryByTestId("final-schedule-unsaved")).toBeNull();
    expect(screen.queryByText("Backup")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(false);

    /*
     * A change made to the layers as last read would be refused - the save
     * moved them on - so changes wait for Reload layers.
     */
    for (const button of screen.getAllByRole("button", {
      name: "Delete layer",
    })) {
      expect(button).toBeDisabled();
    }
    for (const button of screen.getAllByRole("button", {
      name: "Remove user from layer",
    })) {
      expect(button).toBeDisabled();
    }
    expect(
      document.querySelectorAll("[data-rbd-drag-handle-draggable-id]").length,
    ).toBe(0);

    layerReadsFail = false;
    await act(async () => {
      fireEvent.click(screen.getByTestId("layers-save-bar-reload"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("layers-save-bar-reload-failed")).toBeNull();
    });
    expect(shownPeople()).toEqual(["Carol Chen", "Alice Andersson", "Erin Ek"]);
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(false);
    for (const button of screen.getAllByRole("button", {
      name: "Remove user from layer",
    })) {
      expect(button).not.toBeDisabled();
    }
    expect(saveCalls.length).toBe(1);
  });
});

/*
 * Add Layer still adds the layer at once, changes held or not: a layer with
 * nobody in it changes nothing for anyone on call, and its settings form
 * needs a saved layer to save to.
 */
describe("Add Layer while changes are held", () => {
  const NEW_LAYER: string = "0d750000-0000-4000-8000-000000000005";

  // The server takes the new layer; any other row write is still refused.
  function letLayersBeAdded(): void {
    rowWriteMock.mockImplementation(
      async (kind: unknown, params: any): Promise<unknown> => {
        if (
          kind !== "create" ||
          params.modelType !== OnCallDutyPolicyScheduleLayer
        ) {
          throw new Error("The page wrote a row on its own");
        }

        const added: StoredLayer = {
          id: NEW_LAYER,
          name: params.model.name.toString(),
          order: params.model.order,
        };
        stored.layers.push(added);
        return { data: layerModel(added) };
      },
    );
  }

  async function clickAddLayer(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Layer" }));
    });
  }

  async function waitForLayers(count: number): Promise<void> {
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Delete layer" }).length,
      ).toBe(count);
    });
  }

  test("keeps the changes; Save then sends them with the new layer, in one request, with no conflict", async () => {
    await renderLayers();
    await drag(CAROL, -2);
    letLayersBeAdded();

    await clickAddLayer();
    await waitForLayers(3);

    // The new layer was added - and only it.
    expect(
      rowWriteMock.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual(["create"]);
    expect(saveCalls).toEqual([]);

    // The drag is still held, and still says so.
    expect(shownPeople()).toEqual([
      "Carol Chen",
      "Alice Andersson",
      "Bob Berg",
    ]);
    expect(barLines()).toEqual(["New turn order in Primary"]);
    expect(screen.queryByTestId("layers-save-bar-conflict")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(true);

    await clickSave();
    await screen.findByTestId("layers-save-bar-saved", undefined, {
      timeout: 5000,
    });

    expect(saveCalls.length).toBe(1);
    expect(saveCalls[0]!.data["layers"]).toEqual([
      {
        layerId: PRIMARY,
        users: [
          { layerUserId: ROW[CAROL], userId: CAROL },
          { layerUserId: ROW[ALICE], userId: ALICE },
          { layerUserId: ROW[BOB], userId: BOB },
        ],
      },
      {
        layerId: BACKUP,
        users: [{ layerUserId: ROW[DANA], userId: DANA }],
      },
      { layerId: NEW_LAYER, users: [] },
    ]);
    expect(
      stored.layers.map((layer: StoredLayer) => {
        return `${layer.name}:${layer.order}`;
      }),
    ).toEqual(["Primary:1", "Backup:2", "Layer 3:3"]);
    expect(
      stored.rows
        .filter((row: StoredRow) => {
          return row.layerId === PRIMARY;
        })
        .sort((a: StoredRow, b: StoredRow) => {
          return a.order - b.order;
        })
        .map((row: StoredRow) => {
          return row.userId;
        }),
    ).toEqual([CAROL, ALICE, BOB]);
  });

  test("after someone else changed the layers, asks for a reload rather than save over their change", async () => {
    await renderLayers();
    await drag(CAROL, -2);
    letLayersBeAdded();

    // Someone else adds Erin to Backup meanwhile.
    stored.rows.push({
      id: "0d750000-0000-4000-8000-000000000301",
      layerId: BACKUP,
      userId: ERIN,
      order: 2,
    });

    await clickAddLayer();

    expect(
      await screen.findByTestId("layers-save-bar-conflict"),
    ).toHaveTextContent("Someone else changed these layers");
    expect(saveCalls).toEqual([]);
    // The drag is still on the page, unsaved, until the reload.
    expect(shownPeople()[0]).toBe("Carol Chen");
    // Another layer, like any other change, waits for the reload.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add Layer" })).toBeDisabled();
    });
    expectChangesToWait();

    await act(async () => {
      fireEvent.click(screen.getByTestId("layers-save-bar-reload"));
    });

    // As saved now: the new layer, Erin in Backup, and no drag.
    await waitForLayers(3);
    await waitFor(() => {
      expect(screen.queryByTestId("layers-save-bar-conflict")).toBeNull();
    });
    expect(shownPeople()[0]).toBe("Alice Andersson");
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
    expect(LeaveGuard.isHeld()).toBe(false);
    expect(saveCalls).toEqual([]);
    expectChangesToBeOpen();
  });
});

describe("Discard", () => {
  test("asks first; Keep Editing keeps the changes, Discard Changes puts the layers back as saved", async () => {
    await renderLayers();

    await drag(CAROL, -2);
    await removeFromLayer(ALICE);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Delete layer" })[1]!,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("layers-save-bar-discard"));
    });
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    });
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(shownPeople()).toEqual(["Carol Chen", "Bob Berg"]);

    await act(async () => {
      fireEvent.click(screen.getByTestId("layers-save-bar-discard"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    });

    expect(shownPeople()).toEqual([
      "Alice Andersson",
      "Bob Berg",
      "Carol Chen",
    ]);
    expect(screen.queryByTestId("layer-deleted")).toBeNull();
    expect(screen.queryByTestId("layer-users-removed")).toBeNull();
    expect(screen.queryByTestId("layers-save-bar")).toBeNull();
    expect(onCallNow()).toContain("Alice Andersson");
    expect(saveCalls).toEqual([]);
    expect(LeaveGuard.isHeld()).toBe(false);
  });
});

describe("leaving the page with changes", () => {
  test("asks first: Keep Editing stays with the changes, Discard Changes leaves", async () => {
    await renderLayers();
    await drag(CAROL, -2);

    const leave: ReturnType<typeof jest.fn> = jest.fn();

    await act(async () => {
      LeaveGuard.whenLeaving("/dashboard/elsewhere", leave as () => void);
    });
    expect(screen.getByText("Leave without saving?")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    });
    expect(leave).not.toHaveBeenCalled();
    expect(shownPeople()[0]).toBe("Carol Chen");

    await act(async () => {
      LeaveGuard.whenLeaving("/dashboard/elsewhere", leave as () => void);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    });

    expect(leave).toHaveBeenCalledTimes(1);
    expect(saveCalls).toEqual([]);
  });

  test("with nothing held, the page lets go at once", async () => {
    await renderLayers();

    const leave: ReturnType<typeof jest.fn> = jest.fn();
    LeaveGuard.whenLeaving("/dashboard/elsewhere", leave as () => void);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Leave without saving?")).toBeNull();
  });
});
