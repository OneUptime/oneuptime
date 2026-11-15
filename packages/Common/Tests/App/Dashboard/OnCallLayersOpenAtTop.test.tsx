import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
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
 * THE LAYERS PAGE OPENS AT ITS TOP (issue #7812).
 *
 * An on-call schedule's Layers page opens its first layer by itself, and
 * that layer's settings form put the cursor in its Layer name field: the
 * browser scrolled the window down to it, past the page's header, the
 * layer's rotation and its people - what people come to the page for - and
 * on a phone the keyboard opened over the page. Opening a layer with its
 * chevron jumped the window to that layer's name the same way.
 *
 * The real Layers page here, with only the network stubbed: the page and a
 * layer opened by its chevron leave focus where it was; a layer just made
 * with Add Layer takes the cursor in its name, to be named right away -
 * once.
 *
 * The schedule: Primary (Alice) above Backup (Bob).
 */

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
            return "0d750000-0000-4000-8000-0000000000a1";
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
const createMock: MockFunction = getJestMockFunction();

// The arrow wrappers matter: jest.mock is hoisted above the consts.
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
        return createMock(...args);
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

// The final schedule's calendar, drawn as nothing: not what this is about.
jest.mock("../../../UI/Components/Calendar/Calendar", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="calendar" />;
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
import User from "../../../Models/DatabaseModels/User";
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
import LeaveGuard from "../../../UI/Utils/LeaveGuard";

jest.setTimeout(60000);

const PROJECT_ID: string = "0d750000-0000-4000-8000-000000000001";
const SCHEDULE_ID: string = "0d750000-0000-4000-8000-000000000002";
const PRIMARY: string = "0d750000-0000-4000-8000-000000000003";
const BACKUP: string = "0d750000-0000-4000-8000-000000000004";
const NEW_LAYER: string = "0d750000-0000-4000-8000-000000000005";

const ALICE: string = "0d750000-0000-4000-8000-0000000000a1";
const BOB: string = "0d750000-0000-4000-8000-0000000000b1";

const PEOPLE: Record<string, string> = {
  [ALICE]: "Alice Andersson",
  [BOB]: "Bob Berg",
};

interface StoredLayer {
  id: string;
  name: string;
  order: number;
  userId: string | null;
}

let stored: Array<StoredLayer>;

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

function user(id: string): User {
  const person: User = new User();
  person._id = id;
  person.name = new Name(PEOPLE[id]!);
  person.email = new Email(`${id.slice(-2)}@example.com`);
  return person;
}

// Daily turns, on call around the clock, started 30 days ago.
function layerModel(storedLayer: StoredLayer): OnCallDutyPolicyScheduleLayer {
  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();
  const anchor: Date = OneUptimeDate.addRemoveDays(
    OneUptimeDate.getCurrentDate(),
    -30,
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

function rowModel(storedLayer: StoredLayer): OnCallDutyPolicyScheduleLayerUser {
  const row: OnCallDutyPolicyScheduleLayerUser =
    new OnCallDutyPolicyScheduleLayerUser();
  row._id = `${storedLayer.id.slice(0, -3)}1${storedLayer.id.slice(-2)}`;
  row.order = 1;
  row.userId = new ObjectID(storedLayer.userId!);
  row.user = user(storedLayer.userId!);
  row.onCallDutyPolicyScheduleLayerId = new ObjectID(storedLayer.id);
  row.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE_ID);
  row.projectId = new ObjectID(PROJECT_ID);
  return row;
}

function storedLayer(id: string): StoredLayer | undefined {
  return stored.find((layer: StoredLayer): boolean => {
    return layer.id.toLowerCase() === id.toLowerCase();
  });
}

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
  LeaveGuard.reset();

  stored = [
    { id: PRIMARY, name: "Primary", order: 1, userId: ALICE },
    { id: BACKUP, name: "Backup", order: 2, userId: BOB },
  ];

  getItemMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicySchedule) {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule._id = SCHEDULE_ID;
      schedule.timezone = Timezone.UTC;
      return schedule;
    }

    // A layer's settings form reads the layer it edits.
    if (params.modelType === OnCallDutyPolicyScheduleLayer) {
      const layer: StoredLayer | undefined = storedLayer(params.id.toString());
      return layer ? layerModel(layer) : null;
    }

    return null;
  });

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicyScheduleLayer) {
      return list(stored.map(layerModel));
    }

    if (params.modelType === OnCallDutyPolicyScheduleLayerUser) {
      return list(
        stored
          .filter((layer: StoredLayer): boolean => {
            return Boolean(layer.userId);
          })
          .map(rowModel),
      );
    }

    return list([]);
  });

  // Add Layer: the server saves the layer it is given, with nobody in it.
  createMock.mockImplementation(async (params: any): Promise<unknown> => {
    if (params.modelType !== OnCallDutyPolicyScheduleLayer) {
      throw new Error("The page created something other than a layer");
    }

    const added: StoredLayer = {
      id: NEW_LAYER,
      name: params.model.name.toString(),
      order: params.model.order,
      userId: null,
    };
    stored.push(added);
    return { data: layerModel(added) };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createMock.mockReset();
  jest.restoreAllMocks();
  LeaveGuard.reset();
  OneUptimeDate.setUserTimezone(null);
});

// The Layer name fields on the page, each with the name it holds.
function nameFields(): Array<HTMLInputElement> {
  return screen.queryAllByRole("textbox", {
    name: /^Layer name/,
  }) as Array<HTMLInputElement>;
}

function nameFieldOf(name: string): HTMLInputElement {
  const field: HTMLInputElement | undefined = nameFields().find(
    (candidate: HTMLInputElement): boolean => {
      return candidate.value === name;
    },
  );

  if (!field) {
    throw new Error(`No Layer name field holds ${name}`);
  }

  return field;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  });
}

// The page, once its first layer's settings form has read the layer.
async function renderLayers(): Promise<void> {
  render(
    <MemoryRouter>
      <Layers
        onCallDutyPolicyScheduleId={new ObjectID(SCHEDULE_ID)}
        projectId={new ObjectID(PROJECT_ID)}
      />
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      expect(
        nameFields().map((field: HTMLInputElement) => {
          return field.value;
        }),
      ).toEqual(["Primary"]);
    },
    { timeout: 10000 },
  );

  await settle();
}

// A layer's chevron, by the layer's number on the page ("Expand layer 2").
function chevronOf(number: number): HTMLElement {
  const chevrons: Array<HTMLElement> = screen.getAllByRole("button", {
    name: /^(Expand|Collapse) layer$/,
  });

  return chevrons[number - 1]!;
}

async function clickAddLayer(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add Layer" }));
  });
}

describe("the Layers page opens at its top", () => {
  test("the first layer opens by itself, and its name field does not take the cursor", async () => {
    await renderLayers();

    const primaryName: HTMLInputElement = nameFieldOf("Primary");

    // Open, with its people and its settings drawn...
    expect(primaryName).toBeInTheDocument();
    expect(screen.getAllByText("Alice Andersson").length).toBeGreaterThan(0);

    // ...and nothing on the page took focus, so the window was not scrolled.
    expect(document.activeElement).not.toBe(primaryName);
    expect(document.activeElement).toBe(document.body);
  });

  test("no field of the first layer's form takes focus: not its name, not any other", async () => {
    await renderLayers();

    // The form is drawn under the id the layer gives it.
    const form: HTMLElement | null = document.getElementById(
      `layer-configuration-${PRIMARY}`,
    );

    expect(form).not.toBeNull();
    expect(form!.contains(nameFieldOf("Primary"))).toBe(true);
    expect(form!.contains(document.activeElement)).toBe(false);
  });

  test("a layer opened with its chevron leaves focus on the chevron", async () => {
    await renderLayers();

    const chevron: HTMLElement = chevronOf(2);

    await act(async () => {
      chevron.focus();
      fireEvent.click(chevron);
    });

    await waitFor(
      () => {
        expect(nameFieldOf("Backup")).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    await settle();

    expect(document.activeElement).not.toBe(nameFieldOf("Backup"));
    expect(document.activeElement).toBe(chevron);
  });
});

describe("a layer made with Add Layer is ready to be named", () => {
  async function addLayer(): Promise<HTMLInputElement> {
    await clickAddLayer();

    await waitFor(
      () => {
        expect(nameFieldOf("Layer 3")).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    await settle();

    return nameFieldOf("Layer 3");
  }

  test("its name field takes the cursor", async () => {
    await renderLayers();

    const newName: HTMLInputElement = await addLayer();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(newName);
    // Only the new layer's: the first layer's form is still open, unfocused.
    expect(document.activeElement).not.toBe(nameFieldOf("Primary"));
  });

  test("folded and opened again, it no longer takes the cursor", async () => {
    await renderLayers();
    await addLayer();

    const chevron: HTMLElement = chevronOf(3);

    // Folded...
    await act(async () => {
      chevron.focus();
      fireEvent.click(chevron);
    });
    await waitFor(() => {
      expect(
        nameFields().map((field: HTMLInputElement) => {
          return field.value;
        }),
      ).not.toContain("Layer 3");
    });

    // ...and opened again with the same chevron.
    await act(async () => {
      fireEvent.click(chevronOf(3));
    });
    await waitFor(
      () => {
        expect(nameFieldOf("Layer 3")).toBeInTheDocument();
      },
      { timeout: 10000 },
    );
    await settle();

    expect(document.activeElement).not.toBe(nameFieldOf("Layer 3"));
    expect(document.activeElement).toBe(chevronOf(3));
  });

  test("the layers that were open before it stay unfocused when it is added", async () => {
    await renderLayers();

    // Backup opened too, before the new layer is added.
    await act(async () => {
      fireEvent.click(chevronOf(2));
    });
    await waitFor(
      () => {
        expect(nameFieldOf("Backup")).toBeInTheDocument();
      },
      { timeout: 10000 },
    );

    const newName: HTMLInputElement = await addLayer();

    expect(document.activeElement).toBe(newName);
    expect(
      nameFields().map((field: HTMLInputElement) => {
        return field.value;
      }),
    ).toEqual(["Primary", "Backup", "Layer 3"]);
  });
});

/*
 * The shape of the fix, read from the source, so a refactor that drops it
 * says why: the form autofocuses only when its layer asks for it.
 */
describe("the layer form autofocuses only a layer just added", () => {
  const LAYER_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer",
  );

  test("LayerConfigForm turns autofocus off unless focusesNameOnOpen is set", () => {
    const source: string = fs.readFileSync(
      path.join(LAYER_DIR, "LayerConfigForm.tsx"),
      "utf8",
    );

    expect(source).toContain("disableAutofocus={!props.focusesNameOnOpen}");
  });

  test("Layers asks for it for the layer Add Layer made, and nowhere else", () => {
    const source: string = fs.readFileSync(
      path.join(LAYER_DIR, "Layers.tsx"),
      "utf8",
    );

    expect(source.match(/setLayerToNameId\(createdLayerId\)/g)).toHaveLength(1);
    expect(source.match(/focusesNameOnOpen=/g)).toHaveLength(1);
  });
});
