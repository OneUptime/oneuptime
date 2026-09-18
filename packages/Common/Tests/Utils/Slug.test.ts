import Slug, { SLUG_SUFFIX_LENGTH } from "../../Utils/Slug";
import ColumnLength from "../../Types/Database/ColumnLength";

describe("Slug.getSlug()", () => {
  test("should return empty string, if name is empty ", () => {
    expect(Slug.getSlug("")).toEqual("");
    expect(Slug.getSlug("     ")).toEqual("");
  });
  test("should generate a slug from a valid name when name is null", () => {
    expect(Slug.getSlug(null)).toMatch(/^[a-z0-9-]+$/);
  });
  test("should replaces spaces in nonEmpty with hyphen -", () => {
    expect(Slug.getSlug("this is slug")).toMatch(/this-is-slug/g);
  });

  test("should append 10 numbers if non-empty string name is given", () => {
    expect(Slug.getSlug("slug")).toMatch(/^slug-+[\d]{10}$/);
  });
  test("should remove  character in [&*+~.,\\/()|'\"!:@]", () => {
    expect(Slug.getSlug(" *+~.,\\/()'\"!:@slug is awesome")).toMatch(
      /^slug-is-awesome-+[\d]{10}$/,
    );
  });
});

/*
 * The ceiling exists because the create path THROWS on an oversized value
 * rather than truncating it (DatabaseService.checkMaxLengthOfFields), and slug
 * sources are routinely wider than the slug column they feed: Incident.title
 * is varchar(500) against a varchar(100) slug. DatabaseService.generateSlug
 * passes the destination column's declared width in.
 */
describe("Slug.getSlug() — clamped to a destination column", () => {
  const LONG_NAME: string = "a very long incident title indeed ".repeat(10);

  test("leaves a name that already fits alone", () => {
    expect(Slug.getSlug("short name", ColumnLength.Slug)).toMatch(
      /^short-name-[\d]{10}$/,
    );
  });

  test("fits the result inside the ceiling", () => {
    expect(
      Slug.getSlug(LONG_NAME, ColumnLength.Slug).length,
    ).toBeLessThanOrEqual(ColumnLength.Slug);
  });

  test("cuts the readable half and keeps the unique tail whole", () => {
    const slug: string = Slug.getSlug(LONG_NAME, ColumnLength.Slug);

    expect(slug.substring(slug.length - SLUG_SUFFIX_LENGTH)).toMatch(
      /^-[\d]{10}$/,
    );
    expect(slug.startsWith("a-very-long-incident-title-indeed")).toBe(true);
  });

  test("leaves no dash dangling where the cut fell", () => {
    /*
     * 44 puts the ceiling exactly on the dash after the second "indeed",
     * which is the case that would otherwise read `...indeed--0123456789`.
     */
    expect(Slug.getSlug(LONG_NAME, 45)).not.toMatch(/--[\d]{10}$/);

    /* Every nearby ceiling, so the case above is not the only one covered. */
    for (let ceiling: number = 20; ceiling <= 100; ceiling++) {
      const slug: string = Slug.getSlug(LONG_NAME, ceiling);

      expect(slug.length).toBeLessThanOrEqual(ceiling);
      expect(slug).not.toMatch(/--[\d]{10}$/);
    }
  });

  test("still answers with a random name for a null source", () => {
    const slug: string = Slug.getSlug(null, ColumnLength.Slug);

    expect(slug).toMatch(/^[a-z0-9-]+-[\d]{10}$/);
    expect(slug.length).toBeLessThanOrEqual(ColumnLength.Slug);
  });

  test("still answers with an empty string for an empty name", () => {
    expect(Slug.getSlug("", ColumnLength.Slug)).toEqual("");
  });
});
