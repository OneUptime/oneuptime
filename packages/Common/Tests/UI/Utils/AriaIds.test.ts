import joinAriaIds from "../../../UI/Utils/AriaIds";
import { describe, expect, test } from "@jest/globals";

/*
 * Utils/AriaIds: the ids that describe a control, in order - a field's help
 * first, then its error - or nothing at all.
 */

describe("joinAriaIds", () => {
  test("joins the ids there are, in order", () => {
    expect(joinAriaIds("field-description", "field-error")).toBe(
      "field-description field-error",
    );
  });

  test("leaves out the ones that are not there", () => {
    expect(joinAriaIds(undefined, "field-error")).toBe("field-error");
    expect(joinAriaIds("field-description", null, false, "")).toBe(
      "field-description",
    );
  });

  test("is undefined when no id is there: no empty attribute is drawn", () => {
    expect(joinAriaIds()).toBeUndefined();
    expect(joinAriaIds(undefined, null, false, "")).toBeUndefined();
  });

  test("reads an id a host gave twice once", () => {
    expect(joinAriaIds("help", "help error", "error")).toBe("help error");
  });

  test("splits a value that already holds several ids", () => {
    expect(joinAriaIds("a  b", "c")).toBe("a b c");
  });
});
