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
 * "SKIP UNTIL..." ON THE LAYERS PAGE, END TO END IN THE BROWSER (task
 * oncall-skip-user-until).
 *
 * The real Layers page of a schedule, with only the network stubbed: click
 * "Skip until..." on a person in a layer, set when they are back, save - and
 * the page saves a skip for every policy, reads the overrides again, and
 * draws the result where people look: the person's row says they are away,
 * and their next turn is the next person's, covering for them.
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
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
      updateById: async (): Promise<void> => {
        return undefined;
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
            return "0d600000-0000-4000-8000-000000000001";
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
import { formatShiftInstant } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
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
import Timezone from "../../../Types/Timezone";

jest.setTimeout(30000);

const PROJECT_ID: string = "0d600000-0000-4000-8000-000000000001";
const SCHEDULE_ID: string = "0d600000-0000-4000-8000-000000000002";
const LAYER_ID: string = "0d600000-0000-4000-8000-000000000003";

const ALICE: string = "0d600000-0000-4000-8000-0000000000a1";
const BOB: string = "0d600000-0000-4000-8000-0000000000b1";
const CAROL: string = "0d600000-0000-4000-8000-0000000000c1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALICE]: { name: "Alice Andersson", email: "alice@example.com" },
  [BOB]: { name: "Bob Berg", email: "bob@example.com" },
  [CAROL]: { name: "Carol Chen", email: "carol@example.com" },
};

const ROTATION: Array<string> = [ALICE, BOB, CAROL];

let overrides: Array<OnCallDutyPolicyUserOverride> = [];

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
 * Daily turns, Alice -> Bob -> Carol, handing off six hours off the current
 * time of day, 30 days in: Alice's turn began six hours ago, Bob's begins in
 * eighteen.
 */
function makeLayer(): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  const anchor: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -30),
    -6,
  );

  layer._id = LAYER_ID;
  layer.name = "Primary";
  layer.order = 1;
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

function layerUsers(): Array<OnCallDutyPolicyScheduleLayerUser> {
  return ROTATION.map((id: string, index: number) => {
    const row: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    row._id = `0d600000-0000-4000-8000-00000000010${index}`;
    row.order = index + 1;
    row.userId = new ObjectID(id);
    row.user = user(id);
    row.onCallDutyPolicyScheduleLayerId = new ObjectID(LAYER_ID);
    row.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
    row.projectId = new ObjectID(PROJECT_ID);
    return row;
  });
}

beforeEach(() => {
  signedInUserId = ALICE;
  overrides = [];
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicySchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = SCHEDULE_ID;
      schedule.timezone = Timezone.UTC;
      return schedule;
    }

    if (params.modelType === OnCallDutyPolicyScheduleLayer) {
      return makeLayer();
    }

    return null;
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    if (params.modelType === OnCallDutyPolicyScheduleLayer) {
      return list([makeLayer()]);
    }

    if (params.modelType === OnCallDutyPolicyScheduleLayerUser) {
      return list(layerUsers());
    }

    if (params.modelType === OnCallDutyPolicyUserOverride) {
      return list(overrides);
    }

    // The people pickers, and who is a member of the project.
    if (params.modelType === TeamMember) {
      return list(
        ROTATION.filter((id: string): boolean => {
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

  // Saved: the server would list it with the person away, as stored.
  createOrUpdateMock.mockImplementation(async (data: any): Promise<any> => {
    const saved: OnCallDutyPolicyUserOverride = data.model;
    const stored: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    stored._id = "0d600000-0000-4000-8000-0000000000f1";
    stored.projectId = new ObjectID(PROJECT_ID);
    stored.overrideUserId = new ObjectID(String(saved.overrideUserId));
    stored.overrideUser = user(String(saved.overrideUserId));
    stored.startsAt = OneUptimeDate.fromString(saved.startsAt!);
    stored.endsAt = OneUptimeDate.fromString(saved.endsAt!);
    overrides = [stored];
    return { data: saved };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

async function renderLayers(): Promise<void> {
  render(
    <MemoryRouter>
      <Layers
        onCallDutyPolicyScheduleId={new ObjectID(SCHEDULE_ID)}
        projectId={new ObjectID(PROJECT_ID)}
      />
    </MemoryRouter>,
  );

  // The first layer opens by itself, with its people listed.
  await screen.findAllByTestId("layer-user-skip-button", undefined, {
    timeout: 10000,
  });
}

function skipButtonOf(id: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Skip ${PEOPLE[id]!.name} until a date`,
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

function chipIds(modal: HTMLElement, question: string): Array<string | null> {
  return within(within(modal).getByRole("group", { name: question }))
    .queryAllByTestId("people-chip")
    .map((chip: HTMLElement): string | null => {
      return chip.getAttribute("data-id");
    });
}

async function openSkip(id: string): Promise<HTMLElement> {
  fireEvent.click(skipButtonOf(id));

  const modal: HTMLElement = await screen.findByTestId("modal");

  await waitFor(() => {
    expect(chipIds(modal, "Who is away?")).toEqual([id]);
    expect(timeInput(modal, "Starts").value).not.toBe("");
  });

  return modal;
}

function overrideFetches(): number {
  return getListMock.mock.calls.filter((call: Array<any>): boolean => {
    return call[0].modelType === OnCallDutyPolicyUserOverride;
  }).length;
}

describe("Skip until... on the Layers page", () => {
  test("every person in the layer can be skipped from their row", async () => {
    await renderLayers();

    for (const id of ROTATION) {
      expect(skipButtonOf(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("layer-user-away-now")).toBeNull();
  });

  test("opens 'Skip <name>' for that person, with the rotation covering", async () => {
    await renderLayers();

    const modal: HTMLElement = await openSkip(BOB);

    expect(
      within(modal).getByRole("heading", { name: "Skip Bob Berg" }),
    ).toBeInTheDocument();
    expect(chipIds(modal, "Who covers?")).toEqual([]);
    expect(
      within(modal).getByTestId("people-picker-nobody-picked"),
    ).toHaveTextContent("Next person in the rotation");
  });

  test("saved, it skips them for every policy, and the page shows it at once", async () => {
    await renderLayers();

    const fetchesBefore: number = overrideFetches();
    const back: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      3,
    );
    // To the minute, as the field takes it.
    back.setUTCSeconds(0, 0);

    const modal: HTMLElement = await openSkip(BOB);

    fireEvent.change(timeInput(modal, "Ends"), {
      target: { value: OneUptimeDate.toDateTimeLocalString(back) },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(modal).getByRole("button", {
          name: "Skip Bob Berg",
          exact: true,
        }),
      );
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const sent: OnCallDutyPolicyUserOverride = (
      createOrUpdateMock.mock.calls[0]![0] as any
    ).model;

    expect(String(sent.overrideUserId)).toBe(BOB);
    expect(sent.routeAlertsToUserId).toBeFalsy();
    expect(sent.onCallDutyPolicyId).toBeFalsy();
    expect(OneUptimeDate.fromString(sent.endsAt!).toISOString()).toBe(
      back.toISOString(),
    );

    // The dialog closes, and the page reads the overrides again.
    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    await waitFor(() => {
      expect(overrideFetches()).toBeGreaterThan(fetchesBefore);
    });

    // Bob's row says he is away, and until when.
    const badge: HTMLElement = await screen.findByTestId(
      "layer-user-away-now",
      undefined,
      { timeout: 10000 },
    );
    expect(badge).toHaveTextContent(
      `Away until ${formatShiftInstant(back, "UTC")}`,
    );

    // His next turn is Carol's, covering for him.
    await waitFor(() => {
      const pills: Array<string> = screen
        .queryAllByTestId("rotation-covering-pill")
        .map((pill: HTMLElement): string => {
          return pill.textContent || "";
        });
      expect(pills).toContain("Covering for Bob Berg");
    });
  });

  test("Cancel saves nothing and changes nothing", async () => {
    await renderLayers();

    const modal: HTMLElement = await openSkip(CAROL);

    fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("layer-user-away-now")).toBeNull();
  });
});
