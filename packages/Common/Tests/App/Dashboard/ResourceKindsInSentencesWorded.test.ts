import { describe, expect, test } from "@jest/globals";
import { LINKED_RESOURCE_KIND_NOUNS } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  INVENTORY_TYPE_DESCRIPTORS,
  InventoryTypeDescriptor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import {
  canHaveLinkedResource,
  describeMissingLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/LinkedResource";
import { getResourceSentenceName } from "../../../Types/AI/ResourceAiAccessPermissions";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE KIND OF A RESOURCE, IN THE MIDDLE OF A SENTENCE, IN EVERY LANGUAGE
 * (#7862).
 *
 * The AI card's decision lines and planned commands, the AI activity feed
 * and an inventory item's empty state each put a resource's kind in the
 * middle of a sentence, as a term the Translator cases for it there. A
 * kind a language does not word reads in English in the middle of that
 * language's sentence: the decision lines' "Database server" was a key in
 * no locale, so a database server read "(Database server)" in all 17
 * languages.
 */

// The keys a decision line or a planned command names a resource's kind by.
const AI_RESOURCE_KIND_KEYS: ReadonlyArray<string> = [
  ...ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): string => {
    return getResourceSentenceName(type);
  }),
  // A type this build does not know.
  "resource",
];

// The keys the activity feed names a linked resource's kind by.
const FEED_KIND_KEYS: ReadonlyArray<string> = [
  ...Object.values(LINKED_RESOURCE_KIND_NOUNS),
  "Resource",
];

// The types an inventory item's empty state names: those that never link.
const UNLINKED_TYPE_LABELS: ReadonlyArray<string> =
  INVENTORY_TYPE_DESCRIPTORS.filter(
    (descriptor: InventoryTypeDescriptor): boolean => {
      return !canHaveLinkedResource(descriptor.entityType);
    },
  ).map((descriptor: InventoryTypeDescriptor): string => {
    return descriptor.label;
  });

function unwordedIn(
  language: string,
  keys: ReadonlyArray<string>,
): Array<string> {
  return keys.filter((key: string): boolean => {
    return !isWordedInDashboardLocale(key, language);
  });
}

describe("the AI card's lines and the activity feed", () => {
  test("name a database server by its name for the middle of a sentence", () => {
    expect(AI_RESOURCE_KIND_KEYS).toContain("database server");
    expect(AI_RESOURCE_KIND_KEYS).not.toContain("Database server");
    expect(FEED_KIND_KEYS.length).toBeGreaterThanOrEqual(17);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every kind a decision line or a planned command names",
    (language: string) => {
      expect(unwordedIn(language, AI_RESOURCE_KIND_KEYS)).toEqual([]);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every kind the activity feed names",
    (language: string) => {
      expect(unwordedIn(language, FEED_KIND_KEYS)).toEqual([]);
    },
  );
});

/*
 * An inventory item's empty state names the item's type after "This". A
 * language that words the sentence words every type in it too; one that
 * has not worded it yet shows it in English, types included.
 */
describe("an inventory item's empty state", () => {
  const wordsTheSentence: (language: string) => boolean = (
    language: string,
  ): boolean => {
    return (
      describeMissingLink(
        EntityType.Container,
        "incidents",
        dashboardTranslator(language),
      ) !== describeMissingLink(EntityType.Container, "incidents")
    );
  };

  const SENTENCE_LANGUAGES: ReadonlyArray<string> =
    DASHBOARD_LANGUAGES.filter(wordsTheSentence);

  test("Japanese, Persian and Arabic word it", () => {
    expect(UNLINKED_TYPE_LABELS.length).toBeGreaterThanOrEqual(40);
    expect(SENTENCE_LANGUAGES).toEqual(
      expect.arrayContaining(["ja", "fa", "ar"]),
    );
  });

  test.each(SENTENCE_LANGUAGES)(
    "%s words every type the sentence names",
    (language: string) => {
      expect(unwordedIn(language, UNLINKED_TYPE_LABELS)).toEqual([]);
    },
  );

  /*
   * The type follows "this" ("この", "این"); Arabic says "this item" and
   * names the type in brackets, so its verb and pronouns agree with "item"
   * whatever the type's gender.
   */
  test.each([
    ["ja", "このコンテナには独自のものはありません"],
    ["fa", "این کانتینر موارد خودش را ندارد"],
    ["ar", "لا يحمل هذا العنصر (الحاوية) ما يخصه منها"],
  ])(
    "%s names the type after its word for this",
    (language: string, named: string) => {
      expect(
        withoutIsolateMarks(
          describeMissingLink(
            EntityType.Container,
            "incidents",
            dashboardTranslator(language),
          ),
        ),
      ).toContain(named);
    },
  );
});
