import ProductCompare, {
  Category,
  FAQ,
  Item,
  PricingTier,
  Product,
  getProductCompareSlugs,
} from "../Utils/ProductCompare";

/*
 * The /compare/<competitor> pages are sales-critical, SEO-indexed landing
 * pages, and their content is served three ways: the rendered HTML page, the
 * `/compare/<slug>.md` markdown variant, and the llms.txt catalogue. All three
 * read from this single ProductCompare table, so a malformed entry ships a
 * broken buyer-facing page everywhere at once. These tests pin the invariants
 * every entry must hold rather than asserting specific marketing copy, which is
 * expected to change.
 */

const slugs: Array<string> = getProductCompareSlugs();

describe("ProductCompare slugs", () => {
  test("there is at least one comparison page", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  test("slugs are URL-safe — they become /compare/<slug> paths", () => {
    /*
     * Lowercase alphanumerics with interior hyphens or dots (brand slugs like
     * "incident.io" and "statuspage.io" carry a dot). Anything else — a slash,
     * a space, an uppercase letter — would produce a broken or ambiguous URL.
     */
    const urlSafe: RegExp = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
    for (const slug of slugs) {
      expect(slug).toMatch(urlSafe);
    }
  });

  test("no slug ends in .md — that would collide with the markdown route", () => {
    /*
     * The `/compare/<slug>.md` variant is served by a `\.md$` route that strips
     * the suffix; a slug literally ending in .md would be unreachable as a page.
     */
    for (const slug of slugs) {
      expect(slug.endsWith(".md")).toBe(false);
    }
  });

  test("slugs are unique", () => {
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("the flagship comparison pages are present", () => {
    /*
     * These are the highest-traffic competitor terms; losing one silently
     * would drop a page buyers actively search for.
     */
    expect(slugs).toEqual(expect.arrayContaining(["pagerduty", "datadog"]));
  });
});

describe("ProductCompare lookup", () => {
  test("every slug resolves to a product", () => {
    for (const slug of slugs) {
      expect(ProductCompare(slug)).toBeDefined();
    }
  });

  test("an unknown slug resolves to undefined, not a throw", () => {
    expect(ProductCompare("does-not-exist")).toBeUndefined();
  });

  test("inherited object keys do not resolve as products", () => {
    /*
     * The lookup uses hasOwnProperty so prototype keys cannot leak a bogus,
     * half-populated object into a rendered page.
     */
    expect(ProductCompare("constructor")).toBeUndefined();
    expect(ProductCompare("toString")).toBeUndefined();
    expect(ProductCompare("__proto__")).toBeUndefined();
  });
});

describe("Every product is fully populated", () => {
  const requiredText: Array<keyof Product> = [
    "productName",
    "tagline",
    "description",
    "descriptionLine2",
    "productDescription",
    "oneUptimeDescription",
    "competitorFocus",
    "oneuptimeFocus",
  ];

  test.each(slugs)("%s has all required prose fields", (slug: string) => {
    const product: Product = ProductCompare(slug);
    for (const field of requiredText) {
      const value: unknown = product[field];
      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  test.each(slugs)(
    "%s has at least one comparison category, each with items",
    (slug: string) => {
      const product: Product = ProductCompare(slug);
      expect(Array.isArray(product.items)).toBe(true);
      expect(product.items.length).toBeGreaterThan(0);

      for (const category of product.items as Array<Category>) {
        expect(category.name.trim().length).toBeGreaterThan(0);
        expect(category.data.length).toBeGreaterThan(0);

        for (const item of category.data as Array<Item>) {
          expect(item.title.trim().length).toBeGreaterThan(0);
          /*
           * Both feature cells must be strings — the markdown renderer treats
           * "tick" as a checkmark and "" as "not available", so undefined
           * would render the literal word "undefined" in the table.
           */
          expect(typeof item.productColumn).toBe("string");
          expect(typeof item.oneuptimeColumn).toBe("string");
        }
      }
    },
  );

  test.each(slugs)(
    "%s FAQ entries all have a question and an answer",
    (slug: string) => {
      const product: Product = ProductCompare(slug);
      // FAQ is required on the interface; guard the shape regardless.
      expect(Array.isArray(product.faq)).toBe(true);
      for (const entry of product.faq as Array<FAQ>) {
        expect(entry.question.trim().length).toBeGreaterThan(0);
        expect(entry.answer.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test.each(slugs)(
    "%s optional pricing tiers are well-formed when present",
    (slug: string) => {
      const product: Product = ProductCompare(slug);
      if (!product.competitorPricingTiers) {
        return;
      }
      for (const tier of product.competitorPricingTiers as Array<PricingTier>) {
        expect(tier.name.trim().length).toBeGreaterThan(0);
        expect(typeof tier.price).toBe("string");
        expect(Array.isArray(tier.features)).toBe(true);
        expect(Array.isArray(tier.limitations)).toBe(true);
      }
    },
  );
});
