import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
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
 * ADD LAYER STARTS A LAYER THE WAY A NEW SCHEDULE'S FIRST LAYER STARTS.
 *
 * The Layers page's Add Layer and the server's first layer of a schedule
 * created with "Who takes turns?" are built by one builder
 * (ScheduleLayerDefaults.buildNewScheduleLayer), so a layer added by hand
 * starts like the one the create made: on call from now, each person for a
 * week, handing off first a week later at the same time of day in the
 * schedule's timezone, around the clock. Add Layer used to start a daily
 * rotation with its first hand-off a day later.
 *
 * On the real Layers component, with only the network stubbed.
 */

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
      create: (...args: Array<any>) => {
        return createMock(...args);
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
            return "0e300000-0000-4000-8000-000000000001";
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

import Layers from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import EventInterval from "../../../Types/Events/EventInterval";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { RestrictionType } from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { getFirstHandOffTime } from "../../../Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import Timezone from "../../../Types/Timezone";

jest.setTimeout(30000);

const PROJECT_ID: ObjectID = new ObjectID(
  "0e300000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "0e300000-0000-4000-8000-000000000002",
);
const NEW_LAYER_ID: string = "0e300000-0000-4000-8000-000000000003";

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

beforeEach(() => {
  getItemMock.mockImplementation(async (): Promise<any> => {
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule._id = SCHEDULE_ID.toString();
    schedule.timezone = Timezone.EuropeBerlin;
    return schedule;
  });

  // A schedule with no layers yet, and no people in any.
  getListMock.mockImplementation(async (): Promise<any> => {
    return list([]);
  });

  createMock.mockImplementation(async (data: any): Promise<any> => {
    const layer: OnCallDutyPolicyScheduleLayer = data.model;
    layer._id = NEW_LAYER_ID;
    return { data: layer };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createMock.mockReset();
  jest.restoreAllMocks();
});

async function addLayerToEmptySchedule(): Promise<OnCallDutyPolicyScheduleLayer> {
  render(
    <Layers onCallDutyPolicyScheduleId={SCHEDULE_ID} projectId={PROJECT_ID} />,
  );

  expect(
    await screen.findByText("Build your on-call rotation"),
  ).toBeInTheDocument();

  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Add Layer" }));
  });

  await waitFor(() => {
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  const request: any = createMock.mock.calls[0]![0];

  expect(request.modelType).toBe(OnCallDutyPolicyScheduleLayer);

  return request.model as OnCallDutyPolicyScheduleLayer;
}

describe("Add Layer on a schedule with no layers", () => {
  test("adds Layer 1 of this schedule, first in its order", async () => {
    const layer: OnCallDutyPolicyScheduleLayer =
      await addLayerToEmptySchedule();

    expect(layer).toBeInstanceOf(OnCallDutyPolicyScheduleLayer);
    expect(layer.name).toBe("Layer 1");
    expect(layer.order).toBe(1);
    expect(layer.onCallDutyPolicyScheduleId?.toString()).toBe(
      SCHEDULE_ID.toString(),
    );
    expect(layer.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("is on call from now, each person for a week", async () => {
    const before: number = Date.now();

    const layer: OnCallDutyPolicyScheduleLayer =
      await addLayerToEmptySchedule();

    const after: number = Date.now();

    expect(layer.startsAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(layer.startsAt!.getTime()).toBeLessThanOrEqual(after);

    expect(layer.rotation?.intervalType).toBe(EventInterval.Week);
    expect(layer.rotation?.intervalCount.toNumber()).toBe(1);
  });

  test("hands off first a week later, at the same time of day in the schedule's timezone", async () => {
    const layer: OnCallDutyPolicyScheduleLayer =
      await addLayerToEmptySchedule();

    expect(layer.handOffTime?.toISOString()).toBe(
      getFirstHandOffTime({
        startsAt: layer.startsAt!,
        rotation: layer.rotation!,
        timezone: "Europe/Berlin",
      }).toISOString(),
    );

    const handOffIn: number =
      layer.handOffTime!.getTime() - layer.startsAt!.getTime();

    expect(Math.abs(handOffIn - 7 * 24 * 3600 * 1000)).toBeLessThanOrEqual(
      3600 * 1000,
    );
  });

  test("is on call around the clock", async () => {
    const layer: OnCallDutyPolicyScheduleLayer =
      await addLayerToEmptySchedule();

    expect(layer.restrictionTimes?.restictionType).toBe(RestrictionType.None);
  });
});
