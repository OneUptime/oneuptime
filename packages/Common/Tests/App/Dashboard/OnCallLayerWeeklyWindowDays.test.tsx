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
import LayerCard from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerCard";
import LayerConfigForm, {
  withDaysShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm";
import { hasWeeklyWindowsToCheck } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import RestrictionTimesFieldElement, {
  getShownDay,
  getShownTimezone,
  getWindowToCheckNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate, { Moment } from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WeeklyWindowDays from "../../../Types/OnCallDutyPolicy/WeeklyWindowDays";
import Permission from "../../../Types/Permission";
import Timezone from "../../../Types/Timezone";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";

/*
 * A LAYER'S WEEKLY WINDOWS SHOW, AND SAVE, THE DAYS THEY ARE ON CALL (#11455).
 *
 * A window is on call on the days its times fall on in the schedule's
 * zone. Its day menus showed the days it was saved with instead, which a
 * window written through the API with other dates, or stored before its
 * schedule's zone changed, is not on call on - so the form said Monday
 * while Sunday was paged. Now:
 *
 *   - the menus show the days it is on call;
 *   - a window whose times fall on other days than it was saved with says
 *     so under it, and its card says it has active hours to check;
 *   - Save Layer stores the days shown, so a save that touches nothing
 *     pages as before, and the server's check of a window's days takes it.
 *
 * The browser's zone (India, see the docblock), the settings zone (New
 * York) and the schedule's zone (Warsaw, or New York) are set apart, so a
 * day read in the wrong one is seen.
 */

const SETTINGS_ZONE: Timezone = Timezone.AmericaNew_York;
const WARSAW: string = "Europe/Warsaw";
const NEW_YORK: string = "America/New_York";
const LAYER_ID: ObjectID = new ObjectID("11455444-0000-4000-8000-000000000001");

interface SaveRequest {
  model: BaseModel;
  modelType: { new (): BaseModel };
}

let savedRequests: Array<SaveRequest> = [];
let loadedLayer: BaseModel | null = null;

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

// An instant given as a wall clock in a zone, e.g. "2026-01-05 01:00".
function at(wallClock: string, zone: string): Date {
  return Moment.tz(wallClock, "YYYY-MM-DD HH:mm", zone).toDate();
}

function weekly(windows: Array<WeeklyResctriction>): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restrictionType = RestrictionType.Weekly;
  restrictionTimes.dayRestrictionTimes = null;
  restrictionTimes.weeklyRestrictionTimes = windows;
  return restrictionTimes;
}

/*
 * Set up as Monday 01:00 to 09:00 in Warsaw, its schedule's zone changed to
 * New York before #11455: there it is on call Sunday 19:00 to Monday 03:00.
 */
function movedByAZoneChange(): RestrictionTimes {
  return weekly([
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Monday,
      startTime: at("2026-01-05 01:00", WARSAW),
      endTime: at("2026-01-05 09:00", WARSAW),
    },
  ]);
}

// The issue's window: named Monday, dated on a Wednesday (09:00 to 17:00 in Warsaw).
function theIssues(): RestrictionTimes {
  return weekly([
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Monday,
      startTime: at("2026-01-07 09:00", WARSAW),
      endTime: at("2026-01-07 17:00", WARSAW),
    },
  ]);
}

// On its days in Warsaw: Monday 09:00 to Friday 17:30.
function onItsDays(): RestrictionTimes {
  return weekly([
    {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Friday,
      startTime: at("2026-01-05 09:00", WARSAW),
      endTime: at("2026-01-09 17:30", WARSAW),
    },
  ]);
}

// The day a window's end shows, read from its From: or To: label's end.
function shownEnd(label: "From:" | "To:", index: number = 0): string {
  const end: HTMLElement = screen.getAllByText(label)[index]!
    .parentElement as HTMLElement;
  return end.textContent || "";
}

function asJSON(restrictionTimes: RestrictionTimes): JSONObject {
  return RestrictionTimes.fromJSON(restrictionTimes).toJSON();
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

describe("the zones are set apart", () => {
  test("browser India, settings New York", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(SETTINGS_ZONE);
    expect(new Date(2026, 0, 5, 9, 0, 0).getTimezoneOffset()).toBe(-330);
  });
});

describe("getShownTimezone and getShownDay", () => {
  test("times are shown in the schedule's zone, or for a schedule without one in the reader's", () => {
    expect(getShownTimezone(WARSAW)).toBe(WARSAW);
    expect(getShownTimezone(undefined)).toBe(SETTINGS_ZONE.toString());
  });

  test("the day shown is the day the time falls on in that zone", () => {
    const window: WeeklyResctriction =
      movedByAZoneChange().weeklyRestrictionTimes[0]!;

    expect(
      getShownDay({
        time: window.startTime,
        savedDay: window.startDay,
        timezone: NEW_YORK,
      }),
    ).toBe(DayOfWeek.Sunday);
    expect(
      getShownDay({
        time: window.startTime,
        savedDay: window.startDay,
        timezone: WARSAW,
      }),
    ).toBe(DayOfWeek.Monday);
  });

  test("the issue's window shows the Wednesday it is on call", () => {
    const window: WeeklyResctriction = theIssues().weeklyRestrictionTimes[0]!;

    expect(
      getShownDay({
        time: window.startTime,
        savedDay: window.startDay,
        timezone: WARSAW,
      }),
    ).toBe(DayOfWeek.Wednesday);
  });

  test("a time as JSON, as a fetched form holds it, is read too; one that is no date and time shows the day saved", () => {
    expect(
      getShownDay({
        time: { _type: "DateTime", value: "2026-01-07T08:00:00.000Z" },
        savedDay: DayOfWeek.Monday,
        timezone: WARSAW,
      }),
    ).toBe(DayOfWeek.Wednesday);
    expect(
      getShownDay({
        time: "09:00",
        savedDay: DayOfWeek.Monday,
        timezone: WARSAW,
      }),
    ).toBe(DayOfWeek.Monday);
  });
});

describe("getWindowToCheckNote", () => {
  test("says what it was saved as, that it is on call on the days shown, and why", () => {
    expect(
      getWindowToCheckNote({
        translator: getGlobalTranslator(),
        window: {
          index: 0,
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Monday,
          startsOn: DayOfWeek.Sunday,
          endsOn: DayOfWeek.Monday,
        },
        timezone: NEW_YORK,
      }),
    ).toBe(
      "Saved as Monday to Monday, but on call on the days shown, which its times fall on in America/New_York. Pick the days you mean, then save the layer.",
    );
  });

  test("a zone under an old name is named as it is now", () => {
    expect(
      getWindowToCheckNote({
        translator: getGlobalTranslator(),
        window: {
          index: 0,
          startDay: DayOfWeek.Friday,
          endDay: DayOfWeek.Monday,
          startsOn: DayOfWeek.Thursday,
          endsOn: DayOfWeek.Sunday,
        },
        timezone: "US/Eastern",
      }),
    ).toContain("in America/New_York.");
  });
});

describe("withDaysShown: what Save Layer stores", () => {
  function layerWith(
    restrictionTimes: RestrictionTimes | JSONObject | undefined,
  ): OnCallDutyPolicyScheduleLayer {
    const layer: OnCallDutyPolicyScheduleLayer =
      new OnCallDutyPolicyScheduleLayer();
    layer.restrictionTimes = restrictionTimes as RestrictionTimes;
    return layer;
  }

  test("a window to check is stored with the days it is on call, at the same moments", () => {
    const original: RestrictionTimes = movedByAZoneChange();
    const saved: OnCallDutyPolicyScheduleLayer = withDaysShown(
      layerWith(original),
      NEW_YORK,
    );

    const window: WeeklyResctriction = RestrictionTimes.fromJSON(
      saved.restrictionTimes!,
    ).weeklyRestrictionTimes[0]!;

    expect(window.startDay).toBe(DayOfWeek.Sunday);
    expect(window.endDay).toBe(DayOfWeek.Monday);
    expect(OneUptimeDate.fromString(window.startTime).getTime()).toBe(
      original.weeklyRestrictionTimes[0]!.startTime.getTime(),
    );

    // The server's check of the days, in the schedule's zone, takes it.
    expect(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        RestrictionTimes.fromJSON(saved.restrictionTimes!),
        { timezone: NEW_YORK },
      );
    }).not.toThrow();
  });

  test("windows on their days, a Daily restriction and none are stored as they are", () => {
    const agreeing: RestrictionTimes = onItsDays();
    expect(withDaysShown(layerWith(agreeing), WARSAW).restrictionTimes).toBe(
      agreeing,
    );

    const daily: RestrictionTimes = new RestrictionTimes();
    daily.restrictionType = RestrictionType.Daily;
    daily.dayRestrictionTimes = {
      startTime: at("2026-01-07 09:00", WARSAW),
      endTime: at("2026-01-07 17:00", WARSAW),
    };
    expect(withDaysShown(layerWith(daily), WARSAW).restrictionTimes).toBe(
      daily,
    );

    expect(
      withDaysShown(layerWith(undefined), WARSAW).restrictionTimes,
    ).toBeUndefined();
  });

  test("the restriction as the form holds a fetched one - its JSON - is read too", () => {
    const saved: OnCallDutyPolicyScheduleLayer = withDaysShown(
      layerWith(asJSON(theIssues())),
      WARSAW,
    );

    expect(
      RestrictionTimes.fromJSON(saved.restrictionTimes!)
        .weeklyRestrictionTimes[0]!.startDay,
    ).toBe(DayOfWeek.Wednesday);
  });

  test("a schedule without a zone stores the days as the reader sees them, which the server takes", () => {
    // Monday 00:30 in New York, the settings zone: Monday 05:30 UTC.
    const restrictionTimes: RestrictionTimes = weekly([
      {
        startDay: DayOfWeek.Tuesday,
        endDay: DayOfWeek.Tuesday,
        startTime: at("2026-01-05 00:30", NEW_YORK),
        endTime: at("2026-01-05 08:00", NEW_YORK),
      },
    ]);

    const saved: OnCallDutyPolicyScheduleLayer = withDaysShown(
      layerWith(restrictionTimes),
      undefined,
    );

    expect(
      RestrictionTimes.fromJSON(saved.restrictionTimes!)
        .weeklyRestrictionTimes[0]!.startDay,
    ).toBe(DayOfWeek.Monday);
    expect(() => {
      return WeeklyWindowDays.checkWrittenWindows(
        RestrictionTimes.fromJSON(saved.restrictionTimes!),
        { timezone: null },
      );
    }).not.toThrow();
  });
});

describe("hasWeeklyWindowsToCheck", () => {
  test("a window whose times fall on other days than it was saved with", () => {
    expect(hasWeeklyWindowsToCheck(movedByAZoneChange(), NEW_YORK)).toBe(true);
    expect(hasWeeklyWindowsToCheck(theIssues(), WARSAW)).toBe(true);
    expect(hasWeeklyWindowsToCheck(asJSON(theIssues()), WARSAW)).toBe(true);
  });

  test("windows on their days, no restriction, or one nothing reads", () => {
    expect(hasWeeklyWindowsToCheck(onItsDays(), WARSAW)).toBe(false);
    expect(hasWeeklyWindowsToCheck(movedByAZoneChange(), WARSAW)).toBe(false);
    expect(hasWeeklyWindowsToCheck(undefined, WARSAW)).toBe(false);
    expect(hasWeeklyWindowsToCheck({ hours: "nights" }, WARSAW)).toBe(false);
  });

  test("a schedule without a zone: only a window no zone explains", () => {
    expect(hasWeeklyWindowsToCheck(movedByAZoneChange(), undefined)).toBe(
      false,
    );
    expect(hasWeeklyWindowsToCheck(theIssues(), undefined)).toBe(true);
  });
});

describe("RestrictionTimesFieldElement: a window's menus show the days it is on call", () => {
  test("a window a change of zone moved shows Sunday to Monday in New York, and says it was saved as Monday to Monday", () => {
    render(
      <RestrictionTimesFieldElement
        value={movedByAZoneChange()}
        timezone={NEW_YORK}
        marksWindowsToCheck={true}
      />,
    );

    expect(shownEnd("From:")).toContain("Sunday");
    expect(shownEnd("To:")).toContain("Monday");

    expect(screen.getByTestId("restriction-window-to-check")).toHaveTextContent(
      "Saved as Monday to Monday, but on call on the days shown, which its times fall on in America/New_York. Pick the days you mean, then save the layer.",
    );
  });

  test("REGRESSION #11455: the issue's window shows the Wednesday it pages on, not the Monday it was saved with", () => {
    render(
      <RestrictionTimesFieldElement
        value={theIssues()}
        timezone={WARSAW}
        marksWindowsToCheck={true}
      />,
    );

    expect(shownEnd("From:")).toContain("Wednesday");
    expect(shownEnd("From:")).not.toContain("Monday");
    expect(screen.getByTestId("restriction-window-to-check")).toHaveTextContent(
      "Saved as Monday to Monday",
    );
  });

  test("a window on its days shows them, and says nothing more", () => {
    render(
      <RestrictionTimesFieldElement
        value={onItsDays()}
        timezone={WARSAW}
        marksWindowsToCheck={true}
      />,
    );

    expect(shownEnd("From:")).toContain("Monday");
    expect(shownEnd("To:")).toContain("Friday");
    expect(
      screen.queryByTestId("restriction-window-to-check"),
    ).not.toBeInTheDocument();
  });

  test("only the window to check says so, among several", () => {
    const restrictionTimes: RestrictionTimes = weekly([
      ...onItsDays().weeklyRestrictionTimes,
      ...theIssues().weeklyRestrictionTimes,
    ]);

    render(
      <RestrictionTimesFieldElement
        value={restrictionTimes}
        timezone={WARSAW}
        marksWindowsToCheck={true}
      />,
    );

    expect(screen.getAllByTestId("restriction-window-to-check")).toHaveLength(
      1,
    );
    expect(shownEnd("From:", 0)).toContain("Monday");
    expect(shownEnd("From:", 1)).toContain("Wednesday");
  });

  test("showing the days it is on call reports no change", () => {
    const onChange: MockFunction = getJestMockFunction();
    const value: RestrictionTimes = movedByAZoneChange();
    const before: JSONObject = asJSON(movedByAZoneChange());

    render(
      <RestrictionTimesFieldElement
        value={value}
        timezone={NEW_YORK}
        marksWindowsToCheck={true}
        onChange={onChange}
      />,
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(asJSON(value)).toEqual(before);
  });

  test("as an on-call rule's working hours use it: the days the times fall on are shown, and no layer's note", () => {
    render(
      <RestrictionTimesFieldElement
        value={theIssues()}
        timezone={WARSAW}
        hidesNoRestrictions={true}
      />,
    );

    expect(shownEnd("From:")).toContain("Wednesday");
    expect(
      screen.queryByTestId("restriction-window-to-check"),
    ).not.toBeInTheDocument();
  });
});

describe("Save Layer stores the days a window shows", () => {
  async function renderLayerForm(
    restrictionTimes: RestrictionTimes,
    timezone: string,
  ): Promise<void> {
    const response: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          _id: LAYER_ID.toString(),
          name: "Early Mondays",
          startsAt: at("2026-01-05 01:00", timezone),
          handOffTime: at("2026-01-12 01:00", timezone),
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
          timezone={timezone}
          onLayerChange={getJestMockFunction()}
        />,
      );
    });

    await screen.findByRole("button", { name: "Save Layer" });
  }

  async function save(): Promise<OnCallDutyPolicyScheduleLayer> {
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save Layer" }));
    });

    await waitFor(() => {
      expect(savedRequests).toHaveLength(1);
    });

    return savedRequests[0]!.model as OnCallDutyPolicyScheduleLayer;
  }

  test("a save that touches nothing stores a window to check with the days it is on call, and the same moments, so it pages as before", async () => {
    const original: RestrictionTimes = movedByAZoneChange();

    await renderLayerForm(original, NEW_YORK);
    const written: OnCallDutyPolicyScheduleLayer = await save();

    const window: WeeklyResctriction = RestrictionTimes.fromJSON(
      written.restrictionTimes!,
    ).weeklyRestrictionTimes[0]!;

    expect(window.startDay).toBe(DayOfWeek.Sunday);
    expect(window.endDay).toBe(DayOfWeek.Monday);
    expect(OneUptimeDate.fromString(window.startTime).toISOString()).toBe(
      original.weeklyRestrictionTimes[0]!.startTime.toISOString(),
    );
    expect(OneUptimeDate.fromString(window.endTime).toISOString()).toBe(
      original.weeklyRestrictionTimes[0]!.endTime.toISOString(),
    );
  });

  test("a layer whose windows are on their days is saved exactly as it was", async () => {
    const saved: JSONObject = asJSON(onItsDays());

    await renderLayerForm(onItsDays(), WARSAW);
    const written: OnCallDutyPolicyScheduleLayer = await save();

    expect(asJSON(written.restrictionTimes!)).toEqual(saved);
  });
});

describe("LayerCard says a layer has active hours to check", () => {
  function renderCard(restrictionTimes: RestrictionTimes, zone: string): void {
    const layer: OnCallDutyPolicyScheduleLayer =
      new OnCallDutyPolicyScheduleLayer();
    const now: Date = OneUptimeDate.getCurrentDate();

    layer.id = LAYER_ID;
    layer.name = "Early Mondays" as never;
    layer.startsAt = OneUptimeDate.addRemoveDays(now, -30);
    layer.handOffTime = OneUptimeDate.addRemoveDays(now, -30);
    layer.rotation = Recurring.fromJSON({
      _type: "Recurring",
      value: {
        intervalType: EventInterval.Week,
        intervalCount: { _type: "PositiveNumber", value: 1 },
      },
    } as never) as never;
    layer.restrictionTimes = restrictionTimes;

    const user: User = new User();
    user.id = new ObjectID("11455444-0000-4000-8000-0000000000aa");
    user.name = "Alex Kim" as never;
    const layerUser: OnCallDutyPolicyScheduleLayerUser =
      new OnCallDutyPolicyScheduleLayerUser();
    layerUser.id = new ObjectID("11455444-0000-4000-8000-0000000000ab");
    layerUser.userId = user.id;
    layerUser.user = user;
    layerUser.order = 1;

    const noop: () => void = (): void => {
      return undefined;
    };

    render(
      <LayerCard
        layer={layer}
        users={[layerUser]}
        timezone={zone}
        index={0}
        total={1}
        isExpanded={false}
        actionsDisabled={false}
        overrides={[]}
        overridePolicyContextId=""
        overrideUserInfo={{}}
        onToggleExpand={noop}
        onMoveUp={noop}
        onMoveDown={noop}
        onDeleteLayer={noop}
        onLayerChange={noop}
        onUsersChange={noop}
      />,
    );
  }

  test("a window whose times fall on other days than it was saved with", () => {
    renderCard(movedByAZoneChange(), NEW_YORK);

    expect(screen.getByTestId("layer-card-windows-to-check")).toHaveTextContent(
      "Active hours to check",
    );
  });

  test("not for windows on their days", () => {
    renderCard(onItsDays(), WARSAW);

    expect(
      screen.queryByTestId("layer-card-windows-to-check"),
    ).not.toBeInTheDocument();
  });
});
