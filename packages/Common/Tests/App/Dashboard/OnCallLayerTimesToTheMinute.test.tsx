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
import LayerDateTimeFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeFieldElement";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OneUptimeDate, { Moment } from "../../../Types/Date";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";

/*
 * A LAYER'S ROTATION STARTS AT AND FIRST HAND-OFF TIME, TO THE MINUTE
 * (issue #7593).
 *
 * A layer added at 08:00:17 showed "Rotation starts at 11/11/2026 08:00:17"
 * and the browser's picker asked for the seconds. Both fields now show and
 * take hours and minutes. A layer saved with seconds reads 08:00 and is
 * saved as it was until the person picks another time: no stored time
 * moves because a form was opened and saved.
 *
 * The settings zone (New York), the browser zone (India, see the docblock)
 * and the schedule zone (Singapore) all differ, so a time read or written in
 * the wrong one cannot pass.
 */

const SETTINGS_ZONE: Timezone = Timezone.AmericaNew_York;
const SCHEDULE_TIMEZONE: string = "Asia/Singapore";
const LAYER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

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

// An instant given as a wall clock in the schedule's zone, to the second.
function inSchedule(wallClock: string): Date {
  return Moment.tz(
    wallClock,
    "YYYY-MM-DD HH:mm:ss",
    SCHEDULE_TIMEZONE,
  ).toDate();
}

// What an instant reads in the schedule's zone, to the second.
function wallClockInSchedule(date: Date | undefined): string {
  return Moment.tz(date, SCHEDULE_TIMEZONE).format("YYYY-MM-DD HH:mm:ss");
}

const SAVED_START: Date = inSchedule("2026-09-01 08:00:17");
const SAVED_HAND_OFF: Date = inSchedule("2026-09-02 08:00:17");

async function renderLayerForm(
  times: { startsAt: Date; handOffTime: Date } = {
    startsAt: SAVED_START,
    handOffTime: SAVED_HAND_OFF,
  },
): Promise<void> {
  // Loaded the way ModelAPI.getItem does, from the JSON the API returns.
  const response: JSONObject = JSON.parse(
    JSON.stringify(
      JSONFunctions.serialize({
        _id: LAYER_ID.toString(),
        name: "Weekday Primary",
        startsAt: times.startsAt,
        handOffTime: times.handOffTime,
        rotation: Recurring.getDefault(),
        restrictionTimes: RestrictionTimes.getDefault(),
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

function timeField(name: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(name);
}

async function save(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save Layer" }));
  });
}

async function savedLayer(): Promise<OnCallDutyPolicyScheduleLayer> {
  await waitFor(() => {
    expect(savedRequests).toHaveLength(1);
  });

  return savedRequests[0]!.model as OnCallDutyPolicyScheduleLayer;
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

describe("a layer's times in its edit form", () => {
  test("the test really does run with three different zones", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(SETTINGS_ZONE);
    expect(new Date(2026, 8, 1, 9, 0, 0).getTimezoneOffset()).toBe(-330);
  });

  test("a layer saved with seconds reads to the minute, in the schedule's zone", async () => {
    await renderLayerForm();

    expect(timeField("Rotation starts at").value).toBe("2026-09-01T08:00");
    expect(timeField("First hand-off time").value).toBe("2026-09-02T08:00");
  });

  test("neither field asks for seconds", async () => {
    await renderLayerForm();

    for (const name of ["Rotation starts at", "First hand-off time"]) {
      expect(timeField(name)).toHaveAttribute("type", "datetime-local");
      expect(timeField(name)).not.toHaveAttribute("step");
    }
  });

  test("saved without touching them, both keep the times they were saved with, seconds and all", async () => {
    await renderLayerForm();

    await save();

    const written: OnCallDutyPolicyScheduleLayer = await savedLayer();

    expect(wallClockInSchedule(written.startsAt)).toBe("2026-09-01 08:00:17");
    expect(wallClockInSchedule(written.handOffTime)).toBe(
      "2026-09-02 08:00:17",
    );
  });

  test("a time picked is saved on the minute in the schedule's zone; the other keeps its own", async () => {
    await renderLayerForm();

    // The browser hands back the wall clock picked, to the minute.
    fireEvent.change(timeField("Rotation starts at"), {
      target: { value: "2026-09-01T09:30" },
    });

    expect(timeField("Rotation starts at").value).toBe("2026-09-01T09:30");

    await save();

    const written: OnCallDutyPolicyScheduleLayer = await savedLayer();

    expect(wallClockInSchedule(written.startsAt)).toBe("2026-09-01 09:30:00");
    expect(wallClockInSchedule(written.handOffTime)).toBe(
      "2026-09-02 08:00:17",
    );
  });

  test("a hand-off picked at the minute a start saved with seconds reads is let through", async () => {
    await renderLayerForm();

    // Both now read 08:00 on the same day.
    fireEvent.change(timeField("First hand-off time"), {
      target: { value: "2026-09-01T08:00" },
    });

    await save();

    const written: OnCallDutyPolicyScheduleLayer = await savedLayer();

    expect(
      screen.queryByText(
        "The first hand-off time must be at or after the rotation start.",
      ),
    ).not.toBeInTheDocument();
    expect(wallClockInSchedule(written.startsAt)).toBe("2026-09-01 08:00:17");
    expect(wallClockInSchedule(written.handOffTime)).toBe(
      "2026-09-01 08:00:00",
    );
  });

  test("a hand-off a minute before the start is still refused", async () => {
    await renderLayerForm();

    fireEvent.change(timeField("First hand-off time"), {
      target: { value: "2026-09-01T07:59" },
    });

    await save();

    expect(
      await screen.findByText(
        "The first hand-off time must be at or after the rotation start.",
      ),
    ).toBeInTheDocument();
    expect(savedRequests).toHaveLength(0);
  });
});

describe("the layer's date and time field on its own", () => {
  test("is named by the form's label", () => {
    render(
      <>
        <span id="rotation-label">Rotation starts at</span>
        <LayerDateTimeFieldElement
          ariaLabelledby="rotation-label"
          value={SAVED_START}
          timezone={SCHEDULE_TIMEZONE}
        />
      </>,
    );

    expect(timeField("Rotation starts at").value).toBe("2026-09-01T08:00");
  });

  test("hands back nothing until a time is picked, and then that minute in the schedule's zone", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <LayerDateTimeFieldElement
        dataTestId="rotation-start"
        value={SAVED_START}
        timezone={SCHEDULE_TIMEZONE}
        onChange={onChange}
      />,
    );

    expect(onChange).not.toHaveBeenCalled();

    // The minute it already reads is no change: the browser sends none.
    fireEvent.change(screen.getByTestId("rotation-start"), {
      target: { value: "2026-09-01T08:00" },
    });

    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("rotation-start"), {
      target: { value: "2026-09-01T08:05" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(wallClockInSchedule(onChange.mock.calls[0]![0] as Date)).toBe(
      "2026-09-01 08:05:00",
    );
  });

  test("in a quarter-hour zone too: Kathmandu's 08:00:17 reads 08:00, and 09:15 is saved as 09:15:00", () => {
    const onChange: MockFunction = getJestMockFunction();
    const kathmandu: string = "Asia/Kathmandu";

    render(
      <LayerDateTimeFieldElement
        dataTestId="rotation-start"
        value={Moment.tz(
          "2026-09-01 08:00:17",
          "YYYY-MM-DD HH:mm:ss",
          kathmandu,
        ).toDate()}
        timezone={kathmandu}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId<HTMLInputElement>("rotation-start").value).toBe(
      "2026-09-01T08:00",
    );

    fireEvent.change(screen.getByTestId("rotation-start"), {
      target: { value: "2026-09-01T09:15" },
    });

    expect(
      Moment.tz(onChange.mock.calls[0]![0] as Date, kathmandu).format(
        "YYYY-MM-DD HH:mm:ss",
      ),
    ).toBe("2026-09-01 09:15:00");
  });

  test("with no schedule zone, it reads the person's own zone, to the minute", () => {
    render(
      <LayerDateTimeFieldElement
        dataTestId="rotation-start"
        value={new Date("2026-09-01T12:00:17.000Z")}
      />,
    );

    // 12:00:17 UTC is 08:00:17 in New York.
    expect(screen.getByTestId<HTMLInputElement>("rotation-start").value).toBe(
      "2026-09-01T08:00",
    );
  });
});
