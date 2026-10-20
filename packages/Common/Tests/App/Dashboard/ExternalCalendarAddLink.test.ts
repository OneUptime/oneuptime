import { describe, expect, test } from "@jest/globals";
import {
  ADD_EXTERNAL_CALENDAR_ACTION,
  EXTERNAL_CALENDAR_OPEN_QUERY_PARAM,
  getAddExternalCalendarQuery,
  isAddExternalCalendarAsked,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarAddLink";

/*
 * Add External Calendar, in the Maintenance Calendar's ⋯, opens Calendar
 * Settings with its Add dialog open: the ask rides in the address as
 * ?open=add-external-calendar, the way Network's quick actions ask for a form
 * (?open=add-device). The address is anyone's to type, so only that exact
 * ask opens the dialog.
 */

describe("the ask Add External Calendar puts in Calendar Settings' address", () => {
  test("is ?open=add-external-calendar, as Network's quick actions word theirs", () => {
    expect(EXTERNAL_CALENDAR_OPEN_QUERY_PARAM).toBe("open");
    expect(ADD_EXTERNAL_CALENDAR_ACTION).toBe("add-external-calendar");
    expect(getAddExternalCalendarQuery()).toEqual({
      open: "add-external-calendar",
    });
  });

  test("is read back from a query string, with or without its question mark", () => {
    expect(isAddExternalCalendarAsked("?open=add-external-calendar")).toBe(
      true,
    );
    expect(isAddExternalCalendarAsked("open=add-external-calendar")).toBe(true);
    expect(
      isAddExternalCalendarAsked("?name=holidays&open=add-external-calendar"),
    ).toBe(true);
  });

  test("nothing else asks for the dialog", () => {
    for (const search of [
      undefined,
      null,
      "",
      "?",
      "?open=add-device",
      "?open=add-external-calendar-x",
      "?opened=add-external-calendar",
      "?open=ADD-EXTERNAL-CALENDAR",
    ]) {
      expect({ search, asked: isAddExternalCalendarAsked(search) }).toEqual({
        search,
        asked: false,
      });
    }
  });
});
