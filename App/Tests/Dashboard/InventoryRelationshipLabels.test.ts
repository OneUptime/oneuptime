import { describe, expect, test } from "@jest/globals";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import {
  RelationshipDirection,
  getRelationshipPhrase,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryRelationshipLabels";

/*
 * A stored edge is directed and its type is named from the source's end:
 * `runs-on` means "the from-entity runs on the to-entity". The relationships
 * list renders edges pointing both ways, so rendering an incoming edge with
 * the stored label states the inverse of the truth — a node claiming it
 * "runs-on" the pod scheduled on it.
 *
 * These tests pin that every type has a distinct reading in each direction,
 * which is the property that makes the inversion impossible.
 */

const ALL_TYPES: Array<EntityRelationshipType> = Object.values(
  EntityRelationshipType,
);

const DIRECTIONS: Array<RelationshipDirection> = ["outgoing", "incoming"];

describe("every relationship type reads in both directions", () => {
  test("there are relationship types to cover", () => {
    expect(ALL_TYPES.length).toBeGreaterThan(0);
  });

  test.each(ALL_TYPES)(
    "%s has a phrase in both directions",
    (relationshipType: EntityRelationshipType) => {
      for (const direction of DIRECTIONS) {
        const phrase: string = getRelationshipPhrase(
          relationshipType,
          direction,
        );

        expect(phrase.length).toBeGreaterThan(0);
        // A hyphen means the raw wire value leaked through the fallback.
        expect(phrase).not.toContain("-");
      }
    },
  );

  test.each(ALL_TYPES)(
    "%s reads differently each way round",
    (relationshipType: EntityRelationshipType) => {
      /*
       * Identical phrasings would mean the direction is not actually being
       * expressed, which is the bug this module exists to prevent.
       */
      expect(getRelationshipPhrase(relationshipType, "outgoing")).not.toBe(
        getRelationshipPhrase(relationshipType, "incoming"),
      );
    },
  );

  test("the outgoing phrasings are all distinct", () => {
    const phrases: Array<string> = ALL_TYPES.map(
      (relationshipType: EntityRelationshipType): string => {
        return getRelationshipPhrase(relationshipType, "outgoing");
      },
    );

    expect(new Set(phrases).size).toBe(phrases.length);
  });

  test("a few readings are exactly right", () => {
    expect(
      getRelationshipPhrase(EntityRelationshipType.RunsOn, "outgoing"),
    ).toBe("runs on");
    expect(
      getRelationshipPhrase(EntityRelationshipType.RunsOn, "incoming"),
    ).toBe("runs");
    expect(
      getRelationshipPhrase(EntityRelationshipType.DependsOn, "incoming"),
    ).toBe("is depended on by");
  });
});

describe("unknown and missing types degrade readably", () => {
  test("an unknown type renders as words, not as a hyphenated slug", () => {
    expect(getRelationshipPhrase("talks-to-sometimes", "outgoing")).toBe(
      "talks to sometimes",
    );
  });

  test("a missing type falls back to a neutral phrase", () => {
    expect(getRelationshipPhrase(undefined, "outgoing")).toBe("is related to");
    expect(getRelationshipPhrase("", "incoming")).toBe("is related to");
  });
});
