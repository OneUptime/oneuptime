/** @timezone Asia/Kolkata */

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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import LayerConfigForm from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm";
import RestrictionTimesFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OneUptimeDate, { Moment } from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";

/*
 * Opening a layer's edit form must not overwrite its saved restriction times.
 *
 * BasicRadioButtons reports its initialValue through onChange whenever that
 * value changes, including on mount and when a fetched value arrives. The
 * restriction field treated every onChange as the user picking an option, and
 * picking "Daily" or "Weekly" resets the restrictions to the defaults. So
 * merely opening the form replaced a saved 09:00-11:30 window with 00:00-01:00,
 * and "Save Layer" wrote that over the stored schedule even though nobody had
 * touched the field. Weekly restrictions were replaced by a single default
 * Sunday-Monday window the same way. And a caller that passed a
 * RestrictionTimes instance had it edited in place, because
 * RestrictionTimes.fromJSON hands back the instance it is given.
 *
 * The settings zone (New York), the browser zone (India, see the docblock) and
 * the schedule zone (Singapore) all differ, so a default window built in any
 * of them can never pass for the saved one.
 */

const SETTINGS_ZONE: Timezone = Timezone.AmericaNew_York;
const SCHEDULE_TIMEZONE: string = "Asia/Singapore";
const LAYER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

interface SaveRequest {
  model: BaseModel;
  modelType: { new (): BaseModel };
}

let savedRequests: Array<SaveRequest> = [];
let loadedLayer: BaseModel | null = null;

/*
 * Keep the real form, fields, validation, model metadata and serialization.
 * Only the network boundary and the signed-in user's environment are replaced.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<BaseModel | null> => {
        return loadedLayer;
      },
      createOrUpdate: async (
        request: SaveRequest,
      ): Promise<{ data: JSONObject }> => {
        savedRequests.push(request);
        return { data: {} };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [Permission.ProjectOwner] };
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
      getUserId: (): null => {
        return null;
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

// An instant given as a wall clock in the schedule's zone, e.g. "2026-09-23 09:00".
function inSchedule(wallClock: string): Date {
  return Moment.tz(wallClock, "YYYY-MM-DD HH:mm", SCHEDULE_TIMEZONE).toDate();
}

function dailyRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: inSchedule("2026-09-23 09:00"),
    endTime: inSchedule("2026-09-23 11:30"),
  };
  restrictionTimes.weeklyRestrictionTimes = [];
  return restrictionTimes;
}

// 2026-09-21 is a Monday.
function weeklyRestriction(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.dayRestrictionTimes = null;
  restrictionTimes.weeklyRestrictionTimes = [
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Friday,
      startTime: inSchedule("2026-09-21 09:00"),
      endTime: inSchedule("2026-09-25 17:30"),
    },
    {
      startDay: DayOfWeek.Saturday,
      endDay: DayOfWeek.Sunday,
      startTime: inSchedule("2026-09-26 10:00"),
      endTime: inSchedule("2026-09-27 12:00"),
    },
  ];
  return restrictionTimes;
}

const SAVED_RESTRICTIONS: Array<{
  label: string;
  build: () => RestrictionTimes;
}> = [
  { label: "daily", build: dailyRestriction },
  { label: "weekly", build: weeklyRestriction },
];

function asJSON(restrictionTimes: RestrictionTimes): JSONObject {
  return RestrictionTimes.fromJSON(restrictionTimes).toJSON();
}

function lastEmitted(onChange: MockFunction): RestrictionTimes {
  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as RestrictionTimes;
}

beforeEach(() => {
  savedRequests = [];
  loadedLayer = null;
  window.localStorage.clear();
  OneUptimeDate.setUserTimezone(SETTINGS_ZONE);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("RestrictionTimesFieldElement leaves saved restrictions alone until the user changes them", () => {
  test("the test really does run with three different zones", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(SETTINGS_ZONE);
    expect(new Date(2026, 8, 23, 9, 0, 0).getTimezoneOffset()).toBe(-330);
  });

  describe.each(SAVED_RESTRICTIONS)(
    "saved $label restrictions",
    ({ build }: { label: string; build: () => RestrictionTimes }) => {
      test("mounting does not report a change", () => {
        const onChange: MockFunction = getJestMockFunction();

        render(
          <RestrictionTimesFieldElement
            value={build()}
            timezone={SCHEDULE_TIMEZONE}
            onChange={onChange}
          />,
        );

        expect(onChange).not.toHaveBeenCalled();
      });

      test("mounting does not edit the value it was given", () => {
        const value: RestrictionTimes = build();
        const before: JSONObject = asJSON(build());

        render(
          <RestrictionTimesFieldElement
            value={value}
            timezone={SCHEDULE_TIMEZONE}
            onChange={getJestMockFunction()}
          />,
        );

        expect(asJSON(value)).toEqual(before);
      });

      test("a value that arrives after mount, as a fetched form value does, is not reset", () => {
        const onChange: MockFunction = getJestMockFunction();
        const value: RestrictionTimes = build();
        const before: JSONObject = asJSON(build());

        const { rerender } = render(
          <RestrictionTimesFieldElement
            timezone={SCHEDULE_TIMEZONE}
            onChange={onChange}
          />,
        );

        rerender(
          <RestrictionTimesFieldElement
            value={value}
            timezone={SCHEDULE_TIMEZONE}
            onChange={onChange}
          />,
        );

        // And again with an equal copy, as a parent re-render would pass.
        rerender(
          <RestrictionTimesFieldElement
            value={RestrictionTimes.fromJSON(before)}
            timezone={SCHEDULE_TIMEZONE}
            onChange={onChange}
          />,
        );

        expect(onChange).not.toHaveBeenCalled();
        expect(asJSON(value)).toEqual(before);
      });
    },
  );

  test("the saved type's option is the one selected", () => {
    render(
      <RestrictionTimesFieldElement
        value={weeklyRestriction()}
        timezone={SCHEDULE_TIMEZONE}
      />,
    );

    expect(
      screen.getByRole("radio", { name: "Specific Times of the Week" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Specific Times of the Day" }),
    ).not.toBeChecked();
  });

  test("picking another option still resets to that option's defaults, without editing the value given", () => {
    const onChange: MockFunction = getJestMockFunction();
    const value: RestrictionTimes = dailyRestriction();
    const before: JSONObject = asJSON(dailyRestriction());

    render(
      <RestrictionTimesFieldElement
        value={value}
        timezone={SCHEDULE_TIMEZONE}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("radio", { name: "Specific Times of the Week" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const weekly: RestrictionTimes = lastEmitted(onChange);
    expect(weekly.restictionType).toBe(RestrictionType.Weekly);
    expect(weekly.dayRestrictionTimes).toBeNull();
    expect(weekly.weeklyRestrictionTimes).toHaveLength(1);
    expect(weekly.weeklyRestrictionTimes[0]!.startDay).toBe(DayOfWeek.Sunday);
    expect(weekly.weeklyRestrictionTimes[0]!.endDay).toBe(DayOfWeek.Monday);
    expect(
      Moment.tz(
        weekly.weeklyRestrictionTimes[0]!.startTime,
        SCHEDULE_TIMEZONE,
      ).format("dddd HH:mm"),
    ).toBe("Sunday 00:00");
    expect(value).not.toBe(weekly);
    expect(asJSON(value)).toEqual(before);

    fireEvent.click(screen.getByRole("radio", { name: "No Restrictions" }));

    expect(onChange).toHaveBeenCalledTimes(2);
    const none: RestrictionTimes = lastEmitted(onChange);
    expect(none.restictionType).toBe(RestrictionType.None);
    expect(none.dayRestrictionTimes).toBeNull();
    expect(none.weeklyRestrictionTimes).toEqual([]);

    fireEvent.click(
      screen.getByRole("radio", { name: "Specific Times of the Day" }),
    );

    expect(onChange).toHaveBeenCalledTimes(3);
    const daily: RestrictionTimes = lastEmitted(onChange);
    expect(daily.restictionType).toBe(RestrictionType.Daily);
    expect(daily.dayRestrictionTimes).not.toBeNull();
    expect(daily.weeklyRestrictionTimes).toEqual([]);
    expect(asJSON(value)).toEqual(before);
  });

  test("deleting a weekly window reports the rest without editing the value given", () => {
    const onChange: MockFunction = getJestMockFunction();
    const value: RestrictionTimes = weeklyRestriction();
    const before: JSONObject = asJSON(weeklyRestriction());

    render(
      <RestrictionTimesFieldElement
        value={value}
        timezone={SCHEDULE_TIMEZONE}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    const remaining: RestrictionTimes = lastEmitted(onChange);
    expect(remaining.weeklyRestrictionTimes).toHaveLength(1);
    expect(remaining.weeklyRestrictionTimes[0]!.startDay).toBe(
      DayOfWeek.Saturday,
    );
    expect(value.weeklyRestrictionTimes).toHaveLength(2);
    expect(asJSON(value)).toEqual(before);
  });
});

describe("Saving a layer without touching its restrictions", () => {
  async function renderLayerForm(
    restrictionTimes: RestrictionTimes,
  ): Promise<void> {
    /*
     * Load the layer the way ModelAPI.getItem does, from the JSON the API
     * returns. RestrictionTimes is not in SerializableObjectDictionary, so
     * the form holds it as its serialized JSON (with real Dates inside), not
     * as an instance - just as it does live.
     */
    const response: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          _id: LAYER_ID.toString(),
          name: "Weekday Primary",
          startsAt: inSchedule("2026-09-01 09:00"),
          handOffTime: inSchedule("2026-09-02 09:00"),
          rotation: Recurring.getDefault(),
          restrictionTimes: restrictionTimes,
        } as JSONObject),
      ),
    );

    loadedLayer = BaseModel.fromJSONObject(
      JSONFunctions.deserialize(response),
      OnCallDutyPolicyScheduleLayer,
    );

    const layer: OnCallDutyPolicyScheduleLayer =
      new OnCallDutyPolicyScheduleLayer();
    layer.id = LAYER_ID;

    await act(async (): Promise<void> => {
      render(
        <LayerConfigForm
          layer={layer}
          timezone={SCHEDULE_TIMEZONE}
          onLayerChange={getJestMockFunction()}
        />,
      );
    });

    await screen.findByRole("button", { name: "Save Layer" });
  }

  test.each(SAVED_RESTRICTIONS)(
    "writes the saved $label restrictions back unchanged",
    async ({ build }: { label: string; build: () => RestrictionTimes }) => {
      const saved: JSONObject = asJSON(build());

      await renderLayerForm(build());

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByRole("button", { name: "Save Layer" }));
      });

      await waitFor(() => {
        expect(savedRequests).toHaveLength(1);
      });

      const written: OnCallDutyPolicyScheduleLayer = savedRequests[0]!
        .model as OnCallDutyPolicyScheduleLayer;

      expect(written.restrictionTimes).toBeTruthy();
      expect(asJSON(written.restrictionTimes!)).toEqual(saved);
    },
  );
});
