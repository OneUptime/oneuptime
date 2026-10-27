import { describe, expect, test } from "@jest/globals";
import { getActorInitials } from "../../FeatureSet/Dashboard/src/Components/AuditLogs/AuditLogsTableUtils";
import { getNameInitials } from "Common/Utils/NameInitials";

/*
 * The avatar beside a person on an audit log entry (ee/Dashboard/AuditLogs):
 * their initials as every other avatar of the product draws them
 * (Common/Utils/NameInitials) - from the words of their name, or of their
 * address when the entry has no name. It took the first character of the
 * first two bits of the name as written: "Maya Chen (contractor)" was
 * "MC" only by luck of its order, "(bot) Release" was "(R", and an address
 * was the one letter it starts with.
 */

describe("getActorInitials", () => {
  test.each([
    ["Ada Lovelace", "AL"],
    // The first and the last word, as an owner's avatar has them.
    ["Ada Byron Lovelace", "AL"],
    ["(bot) Release Manager", "RM"],
    ["Maya Chen (contractor)", "MC"],
    ["jane.doe@acme-commerce.example", "JD"],
    ["Root Admin", "RA"],
  ])("%j is %j", (name: string, initials: string) => {
    expect(getActorInitials(name)).toBe(initials);
  });

  test("an entry with no name or address is a question mark", () => {
    expect(getActorInitials(undefined)).toBe("?");
    expect(getActorInitials("")).toBe("?");
    expect(getActorInitials("  ")).toBe("?");
  });

  test("is what every avatar draws for the same name", () => {
    for (const name of [
      "Ada Lovelace",
      "Security Operations Center (EMEA)",
      "k_morgan@acme-commerce.example",
      "Ünal Öz",
    ]) {
      expect(getActorInitials(name)).toBe(getNameInitials(name));
    }
  });
});
