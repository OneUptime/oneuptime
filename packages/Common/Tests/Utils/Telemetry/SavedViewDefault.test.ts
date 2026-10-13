import { describe, expect, test } from "@jest/globals";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import { JSONObject } from "../../../Types/JSON";
import { leaveSavedViewDefaultOutUnlessTicked } from "../../../Utils/Telemetry/SavedViewDefault";

/*
 * A new saved view says it is the default only when "Set as default" is
 * ticked; otherwise the create leaves isDefault out, and the service makes a
 * project's first saved view its default (LogSavedViewService).
 */

function sent(isDefault: boolean | undefined): JSONObject {
  const view: LogSavedView = new LogSavedView();
  view.name = "Checkout errors";

  // An untouched box the form never set: the property is not there at all.
  if (isDefault !== undefined) {
    view.isDefault = isDefault;
  }

  const returned: LogSavedView = leaveSavedViewDefaultOutUnlessTicked(view);

  expect(returned).toBe(view);

  return BaseModel.toJSONObject(returned, LogSavedView);
}

describe("leaveSavedViewDefaultOutUnlessTicked", () => {
  test("keeps a ticked box: the view asks to be the default", () => {
    expect(sent(true)["isDefault"]).toBe(true);
  });

  test("leaves an unticked box out, so the service decides", () => {
    expect(sent(false)).not.toHaveProperty("isDefault");
    expect(sent(undefined)).not.toHaveProperty("isDefault");
  });

  test("leaves the rest of the view as it is", () => {
    expect(sent(false)["name"]).toBe("Checkout errors");
  });
});
