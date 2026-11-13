import { describe, expect, test } from "@jest/globals";
import ResourceUtil, {
  ModelDocumentation,
} from "../../../FeatureSet/APIReference/Utils/Resources";

/*
 * The API Reference opens with a few resources picked out. It picked them by
 * the name a person reads, and on-call policies had silently dropped out:
 * the list said "On-Call Duty", which no model was called - and #6817
 * renames what people read again. So it picks them by table, which no
 * rename changes, and every one it names is there.
 */
describe("the resources the API Reference opens with", () => {
  const featured: Array<ModelDocumentation> =
    ResourceUtil.getFeaturedResources();

  test("each table it names is a resource the reference serves, on-call policies included", () => {
    expect(
      featured
        .map((resource: ModelDocumentation): string => {
          return resource.model.tableName || "";
        })
        .sort(),
    ).toEqual([...ResourceUtil.FEATURED_TABLES].sort());
    expect(
      featured.map((resource: ModelDocumentation): string => {
        return resource.name;
      }),
    ).toContain("On-Call Policy");
  });

  test("it names each by table, never by a name a person reads", () => {
    for (const table of ResourceUtil.FEATURED_TABLES) {
      expect(table).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });
});
