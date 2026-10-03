import { describe, expect, test } from "@jest/globals";
import { getNameAfterPick } from "../../../../UI/Components/Forms/Utils/FollowPickName";

/*
 * The one rule behind every name a form fills in from a pick - a status
 * page resource's display name after its monitor, a new ingestion key's
 * name after its type: it follows the pick while it is still the form's
 * own, and never overwrites a name somebody typed.
 */
describe("a name the form fills in from a pick", () => {
  test.each([undefined, null, "", "   ", 42])(
    "an empty name (%j) takes the picked name",
    (name: unknown) => {
      expect(
        getNameAfterPick({
          name,
          pickedName: "Checkout API",
          filledInNames: [],
        }),
      ).toBe("Checkout API");
    },
  );

  test("the name the form filled in last follows the next pick", () => {
    expect(
      getNameAfterPick({
        name: "Server key",
        pickedName: "Browser key",
        filledInNames: ["Server key"],
      }),
    ).toBe("Browser key");
  });

  test("any of the names the form filled in counts as its own", () => {
    expect(
      getNameAfterPick({
        name: "Checkout API",
        pickedName: "Billing Worker",
        filledInNames: ["Search Service", "Checkout API"],
      }),
    ).toBe("Billing Worker");
  });

  test("a name somebody typed stays", () => {
    expect(
      getNameAfterPick({
        name: "Payments",
        pickedName: "Billing Worker",
        filledInNames: ["Checkout API"],
      }),
    ).toBeNull();
  });

  test("a typed name that only differs in case or spacing stays too", () => {
    for (const name of ["checkout api", "Checkout API ", " Checkout API"]) {
      expect(
        getNameAfterPick({
          name,
          pickedName: "Billing Worker",
          filledInNames: ["Checkout API"],
        }),
      ).toBeNull();
    }
  });

  test("names that are not text are passed over", () => {
    expect(
      getNameAfterPick({
        name: "Payments",
        pickedName: "Billing Worker",
        filledInNames: [null, undefined, 7, { name: "Payments" }],
      }),
    ).toBeNull();
  });

  test.each([null, undefined, ""])(
    "nothing to fill in (%j) leaves the name alone",
    (pickedName: string | null | undefined) => {
      expect(
        getNameAfterPick({
          name: "",
          pickedName,
          filledInNames: [""],
        }),
      ).toBeNull();
    },
  );
});
