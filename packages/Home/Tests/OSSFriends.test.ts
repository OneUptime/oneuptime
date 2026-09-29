import OSSFriends, { OSSCategory, OSSFriend } from "../Utils/OSSFriends";

/*
 * The /oss-friends page and its machine-readable feed render straight from this
 * list. A blank field or a malformed URL renders a broken card or a dead link,
 * and a typo'd category silently drops an entry out of its section. These pin
 * the shape of every entry so a bad edit to the data fails here, not in prod.
 */

const ALLOWED_CATEGORIES: ReadonlySet<OSSCategory> = new Set<OSSCategory>([
  "Data & Analytics",
  "Developer Tools",
  "Productivity & Collaboration",
  "Infrastructure & DevOps",
  "Security",
  "AI & Machine Learning",
]);

describe("OSSFriends data integrity", () => {
  test("the list is non-empty", () => {
    expect(OSSFriends.length).toBeGreaterThan(0);
  });

  test("every friend has a non-empty name and description", () => {
    for (const friend of OSSFriends) {
      expect(friend.name.trim().length).toBeGreaterThan(0);
      expect(friend.description.trim().length).toBeGreaterThan(0);
    }
  });

  test("every friend sits in one of the known categories", () => {
    for (const friend of OSSFriends) {
      expect(ALLOWED_CATEGORIES.has(friend.category)).toBe(true);
    }
  });

  test("every repository and website URL is a real http(s) URL", () => {
    for (const friend of OSSFriends) {
      for (const url of [friend.repositoryUrl, friend.websiteUrl]) {
        const asString: string = url.toString();
        expect(asString).toMatch(/^https?:\/\/.+/);
      }
    }
  });

  test("friend names are unique — no accidental duplicate entries", () => {
    const names: Array<string> = OSSFriends.map((friend: OSSFriend): string => {
      return friend.name;
    });
    expect(new Set<string>(names).size).toBe(names.length);
  });
});
