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
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction from "../../MockType";
import LayerConfigForm from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm";
import LayerDateTimeFieldElement, {
  TIME_ZONE_NOTE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeFieldElement";
import RestrictionTimesFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OneUptimeDate from "../../../Types/Date";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission from "../../../Types/Permission";

/*
 * THE ZONE NOTE UNDER A LAYER'S TIMES (the UI review of #7593).
 *
 * "Rotation starts at" and "First hand-off time" take a minute in the
 * schedule's zone, and the line under each says which: "This time is in
 * the schedule's timezone: Asia/Singapore." It was drawn in gray-400 -
 * 2.5:1 on white, fainter than any other words on the form - and no screen
 * reader heard it, nor the field's own help over it: the fields took the
 * form's label but dropped its description. Each field is now described by
 * its help, then its zone, then its error once it has one, and the line is
 * gray-500, as the help is.
 *
 * The same line under a layer's restriction hours is drawn the same way,
 * and names the zone as the two fields over it do: a schedule stored as
 * "US/Pacific" read America/Los_Angeles under the times and US/Pacific
 * under the hours.
 */

const LAYER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const START_HELP: string = "When the first person in the layer goes on call.";
const HAND_OFF_HELP: string =
  "When the first turn passes to the next person. Later hand-offs follow every turn.";
const HAND_OFF_ERROR: string =
  "The first hand-off time must be at or after the rotation start.";

let loadedLayer: BaseModel | null = null;
let saveCount: number = 0;

// The real form, fields and validation; only the network and the signed-in user are replaced.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<BaseModel | null> => {
        return loadedLayer;
      },
      createOrUpdate: async (): Promise<{ data: JSONObject }> => {
        saveCount++;
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

function dailyHours(): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.addDefaultDailyRestriction();
  return restrictionTimes;
}

async function renderLayerForm(options: {
  timezone: string;
  restrictionTimes: RestrictionTimes;
}): Promise<void> {
  // Loaded the way ModelAPI.getItem does, from the JSON the API returns.
  const response: JSONObject = JSON.parse(
    JSON.stringify(
      JSONFunctions.serialize({
        _id: LAYER_ID.toString(),
        name: "Weekday Primary",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        handOffTime: new Date("2026-09-08T00:00:00.000Z"),
        rotation: Recurring.getDefault(),
        restrictionTimes: options.restrictionTimes,
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
        timezone={options.timezone}
        onLayerChange={getJestMockFunction()}
      />,
    );
  });

  await screen.findByRole("button", { name: "Save Layer" });
}

function timeField(name: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(name);
}

beforeEach(() => {
  loadedLayer = null;
  saveCount = 0;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a layer's rotation start and first hand-off, in the real form", () => {
  test("each is described by its help, then the zone its minute is in", async () => {
    await renderLayerForm({
      timezone: "Asia/Singapore",
      restrictionTimes: RestrictionTimes.getDefault(),
    });

    expect(timeField("Rotation starts at")).toHaveAccessibleDescription(
      `${START_HELP} This time is in the schedule's timezone: Asia/Singapore.`,
    );
    expect(timeField("First hand-off time")).toHaveAccessibleDescription(
      `${HAND_OFF_HELP} This time is in the schedule's timezone: Asia/Singapore.`,
    );
  });

  test("a schedule stored under an old zone name is described by its current one", async () => {
    await renderLayerForm({
      timezone: "US/Pacific",
      restrictionTimes: RestrictionTimes.getDefault(),
    });

    expect(timeField("Rotation starts at")).toHaveAccessibleDescription(
      `${START_HELP} This time is in the schedule's timezone: America/Los_Angeles.`,
    );
  });

  test("a hand-off before the start is described by its help, its zone and then the error", async () => {
    await renderLayerForm({
      timezone: "Asia/Singapore",
      restrictionTimes: RestrictionTimes.getDefault(),
    });

    fireEvent.change(timeField("First hand-off time"), {
      target: { value: "2026-08-31T07:59" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save Layer" }));
    });

    expect(await screen.findByText(HAND_OFF_ERROR)).toBeInTheDocument();
    expect(saveCount).toBe(0);

    const description: string =
      timeField("First hand-off time").getAttribute("aria-describedby") || "";
    const spoken: Array<string> = description.split(" ").map((id: string) => {
      return (document.getElementById(id)?.textContent || "").trim();
    });

    expect(spoken).toEqual([
      HAND_OFF_HELP,
      "This time is in the schedule's timezone: Asia/Singapore.",
      expect.stringContaining(HAND_OFF_ERROR),
    ]);
  });

  test("every zone line on the form is drawn gray-500, as the help over it, not gray-400", async () => {
    await renderLayerForm({
      timezone: "Asia/Singapore",
      restrictionTimes: dailyHours(),
    });

    const lines: Array<HTMLElement> = [
      ...screen.getAllByText(
        "This time is in the schedule's timezone: Asia/Singapore.",
      ),
      screen.getByText(
        "These times are in the schedule's timezone: Asia/Singapore.",
      ),
    ];

    expect(lines).toHaveLength(3);

    for (const line of lines) {
      expect(line).toHaveClass("text-gray-500");
      expect(line).not.toHaveClass("text-gray-400");
      expect(line.className).toBe(TIME_ZONE_NOTE_CLASS_NAME);
    }
  });

  test("the restriction hours name an old zone by its current name, as the times over them do", async () => {
    await renderLayerForm({
      timezone: "US/Pacific",
      restrictionTimes: dailyHours(),
    });

    expect(
      screen.getAllByText(
        "This time is in the schedule's timezone: America/Los_Angeles.",
      ),
    ).toHaveLength(2);
    expect(
      screen.getByText(
        "These times are in the schedule's timezone: America/Los_Angeles.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/US\/Pacific/)).not.toBeInTheDocument();
  });
});

describe("the layer's date and time field on its own", () => {
  test("with no help from a form, the zone alone describes it", () => {
    const result: RenderResult = render(
      <LayerDateTimeFieldElement timezone="Europe/Berlin" />,
    );

    const input: HTMLElement = result.container.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLElement;

    expect(input).toHaveAccessibleDescription(
      "This time is in the schedule's timezone: Europe/Berlin.",
    );
  });

  test("a form's help is read first, then the zone, each once", () => {
    const result: RenderResult = render(
      <>
        <p id="start-help">{START_HELP}</p>
        <LayerDateTimeFieldElement
          timezone="Europe/Berlin"
          ariaDescribedby="start-help"
        />
      </>,
    );

    const input: HTMLElement = result.container.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLElement;

    expect(input).toHaveAccessibleDescription(
      `${START_HELP} This time is in the schedule's timezone: Europe/Berlin.`,
    );

    const ids: Array<string> = (
      input.getAttribute("aria-describedby") || ""
    ).split(" ");

    expect(ids[0]).toBe("start-help");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("two fields on one form point at their own zone lines", () => {
    const result: RenderResult = render(
      <>
        <LayerDateTimeFieldElement
          dataTestId="start"
          timezone="Asia/Singapore"
        />
        <LayerDateTimeFieldElement
          dataTestId="hand-off"
          timezone="Asia/Singapore"
        />
      </>,
    );

    const first: string =
      result.getByTestId("start").getAttribute("aria-describedby") || "";
    const second: string =
      result.getByTestId("hand-off").getAttribute("aria-describedby") || "";

    expect(first).not.toBe("");
    expect(second).not.toBe("");
    expect(first).not.toBe(second);
    expect(document.getElementById(first)).toHaveTextContent(
      "This time is in the schedule's timezone: Asia/Singapore.",
    );
    expect(document.getElementById(second)).toHaveTextContent(
      "This time is in the schedule's timezone: Asia/Singapore.",
    );
  });

  test("with no schedule zone, the viewer's own zone describes it", () => {
    const result: RenderResult = render(<LayerDateTimeFieldElement />);

    const input: HTMLElement = result.container.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLElement;

    expect(input).toHaveAccessibleDescription(
      `This time is in your local timezone: ${OneUptimeDate.getCurrentTimezoneString()}.`,
    );
  });
});

describe("the zone line under restriction hours on its own", () => {
  test("names an old zone by its current name", () => {
    render(
      <RestrictionTimesFieldElement
        value={dailyHours()}
        timezone="Asia/Calcutta"
      />,
    );

    expect(
      screen.getByText(
        "These times are in the schedule's timezone: Asia/Kolkata.",
      ),
    ).toHaveClass("text-gray-500");
    expect(screen.queryByText(/Asia\/Calcutta/)).not.toBeInTheDocument();
  });

  test("a caller's own wording (an on-call rule's working hours) names it the same way", () => {
    render(
      <RestrictionTimesFieldElement
        value={dailyHours()}
        timezone="US/Pacific"
        timezoneNoteTemplate="These times are in {{timezone}}."
      />,
    );

    expect(
      screen.getByText("These times are in America/Los_Angeles."),
    ).toBeInTheDocument();
  });

  test("a current zone reads as it is", () => {
    render(
      <RestrictionTimesFieldElement
        value={dailyHours()}
        timezone="Europe/Berlin"
      />,
    );

    expect(
      screen.getByText(
        "These times are in the schedule's timezone: Europe/Berlin.",
      ),
    ).toBeInTheDocument();
  });

  test("no hours limited, no zone line", () => {
    render(
      <RestrictionTimesFieldElement
        value={RestrictionTimes.getDefault()}
        timezone="Europe/Berlin"
      />,
    );

    expect(screen.queryByText(/These times are in/)).not.toBeInTheDocument();
  });
});
