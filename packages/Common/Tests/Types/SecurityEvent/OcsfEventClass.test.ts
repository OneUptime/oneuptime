import { describe, expect, test } from "@jest/globals";
import {
  OcsfCategory,
  OcsfCategoryId,
  OcsfEventClassProps,
  OcsfEventClasses,
  ocsfCategoryForClassUid,
  ocsfEventClassByUid,
} from "../../../Types/SecurityEvent/OcsfEventClass";

/*
 * Every normalizer stamps classUid/className/categoryUid/categoryName from
 * this table, and the SIEM UI groups events by those columns. Two things
 * must never regress: a class uid always lands in the category OCSF says it
 * belongs to (floor(uid/1000), except extension classes like 201001 which
 * are curated by hand), and an unknown uid degrades to a sensible category
 * instead of being dropped — the schema grows faster than our curated
 * subset, so "unknown class" is an expected steady state, not an error.
 */
describe("OcsfEventClass", () => {
  describe("ocsfEventClassByUid", () => {
    test.each<[number, string, OcsfCategory]>([
      [0, "Base Event", OcsfCategory.Uncategorized],
      [1007, "Process Activity", OcsfCategory.SystemActivity],
      [2004, "Detection Finding", OcsfCategory.Findings],
      [3002, "Authentication", OcsfCategory.IdentityAndAccessManagement],
      [4003, "DNS Activity", OcsfCategory.NetworkActivity],
      [5002, "Device Config State", OcsfCategory.Discovery],
      [6003, "API Activity", OcsfCategory.ApplicationActivity],
      [201001, "Registry Key Activity", OcsfCategory.SystemActivity],
    ])(
      "uid %i -> %s in %s",
      (uid: number, name: string, category: OcsfCategory) => {
        const cls: OcsfEventClassProps | undefined = ocsfEventClassByUid(uid);

        expect(cls).toBeDefined();
        expect(cls?.name).toBe(name);
        expect(cls?.category).toBe(category);
      },
    );

    test.each<[number]>([[1234], [3999], [99999], [-1]])(
      "unknown uid %i -> undefined",
      (uid: number) => {
        expect(ocsfEventClassByUid(uid)).toBeUndefined();
      },
    );
  });

  describe("ocsfCategoryForClassUid", () => {
    test("known class uses its curated category", () => {
      expect(ocsfCategoryForClassUid(3002)).toEqual({
        categoryUid: 3,
        categoryName: "Identity & Access Management",
      });
    });

    test("unknown uid in a known category range derives the category", () => {
      expect(ocsfCategoryForClassUid(4999)).toEqual({
        categoryUid: 4,
        categoryName: "Network Activity",
      });

      expect(ocsfCategoryForClassUid(2999)).toEqual({
        categoryUid: 2,
        categoryName: "Findings",
      });
    });

    test("unknown uid outside every category range -> Uncategorized", () => {
      expect(ocsfCategoryForClassUid(9999)).toEqual({
        categoryUid: 0,
        categoryName: "Uncategorized",
      });
    });

    test("uid 0 (Base Event) -> Uncategorized, not a derived guess", () => {
      expect(ocsfCategoryForClassUid(0)).toEqual({
        categoryUid: 0,
        categoryName: "Uncategorized",
      });
    });

    /*
     * The Windows extension class does NOT follow floor(uid/1000): 201001
     * would derive to nothing sensible, so the curated entry must win and
     * put registry events under System Activity.
     */
    test("windows extension class 201001 -> System Activity", () => {
      expect(ocsfCategoryForClassUid(201001)).toEqual({
        categoryUid: 1,
        categoryName: "System Activity",
      });
    });

    test("every curated class resolves to its own category", () => {
      for (const cls of OcsfEventClasses) {
        expect(ocsfCategoryForClassUid(cls.uid)).toEqual({
          categoryUid: OcsfCategoryId[cls.category],
          categoryName: cls.category,
        });
      }
    });
  });
});
