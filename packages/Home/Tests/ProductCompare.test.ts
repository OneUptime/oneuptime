import { RetiredClaim, RetiredEditionClaims } from "../Utils/Claims";
import ProductCompare, {
  Category,
  FAQ,
  Item,
  KeyDifference,
  PricingTier,
  Product,
  UseCaseComparison,
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

const FULLY_OPEN_SOURCE_CLAIM: RegExp = /OneUptime is fully open[- ]source/i;

const WHOLE_PLATFORM_FREE_CLAIM: RegExp =
  /self-host the (?:entire|whole) (?:Apache|OneUptime|platform)|(?:entire|whole) platform self-hosts/i;

describe("Comparison copy matches the Community / Enterprise Edition split", () => {
  /*
   * OneUptime is open-core: SSO, SCIM and audit logs live in the separately
   * licensed ee/ directory. The SigNoz page used to contrast "OneUptime is
   * fully Apache 2.0 across the platform" with SigNoz's open-core ee module,
   * which now describes OneUptime as well.
   */
  const signoz: Product = ProductCompare("signoz");

  const findSignozRow: (title: string) => Item | undefined = (
    title: string,
  ): Item | undefined => {
    for (const category of signoz.items as Array<Category>) {
      const row: Item | undefined = category.data.find((item: Item) => {
        return item.title === title;
      });

      if (row) {
        return row;
      }
    }

    return undefined;
  };

  test("the SigNoz license row describes OneUptime as open-core too", () => {
    const row: Item | undefined = findSignozRow("Open Source License");

    expect(row).toBeDefined();
    expect(row!.productColumn).toBe("Open-core (ee module)");
    expect(row!.oneuptimeColumn).toContain("Open-core");
    expect(row!.oneuptimeColumn).toContain("Apache 2.0");
  });

  test("the SigNoz SSO row no longer implies OneUptime SSO is ungated", () => {
    const row: Item | undefined = findSignozRow("SSO/SAML");

    expect(row).toBeDefined();
    expect(row!.oneuptimeColumn).not.toBe("tick");
    expect(row!.oneuptimeColumn).toContain("Enterprise Edition");
  });

  test("the SigNoz page no longer sells OneUptime as a single permissive license", () => {
    const text: string = [
      ...signoz.keyDifferences.map((difference: KeyDifference) => {
        return `${difference.title} ${difference.description}`;
      }),
      ...signoz.faq.map((faq: FAQ) => {
        return faq.answer;
      }),
      ...(signoz.migrationBenefits || []),
    ].join(" ");

    expect(text).not.toMatch(/fully apache/i);
    expect(text).not.toMatch(/single permissive license/i);
    expect(text).not.toMatch(/stay fully open source/i);
    expect(text).toContain("both follow an open-core model");
  });

  test.each(slugs)(
    "%s does not say OneUptime is fully open source or free to self-host in full",
    (slug: string) => {
      const product: Product = ProductCompare(slug);
      const oneUptimeCopy: string = [
        product.oneUptimeDescription,
        product.description,
        product.descriptionLine2,
        ...(product.migrationBenefits || []),
        ...product.keyDifferences.map((difference: KeyDifference) => {
          return difference.description;
        }),
        ...product.faq.map((faq: FAQ) => {
          return faq.answer;
        }),
      ].join(" ");

      expect(oneUptimeCopy).not.toMatch(FULLY_OPEN_SOURCE_CLAIM);
      expect(oneUptimeCopy).not.toMatch(WHOLE_PLATFORM_FREE_CLAIM);
    },
  );
});

/*
 * What a comparison page says about OneUptime, as it renders. A comparison
 * row shows its title over its description, so the two are joined with ": "
 * (the shape Utils/Claims.ts expects for a row): "Free to self-host" over "Run
 * the full platform on your own infrastructure" is one claim, and neither line
 * says it alone. Rows OneUptime does not tick, and the competitor-only fields
 * (productDescription, competitorFocus, pricing tiers, hidden costs, the
 * competitor side of a use case), are left out.
 */
type OneUptimeCopyFunction = (product: Product) => Array<string>;

const oneUptimeCopyOf: OneUptimeCopyFunction = (
  product: Product,
): Array<string> => {
  const rows: Array<string> = product.items.flatMap((category: Category) => {
    return category.data
      .filter((item: Item) => {
        return item.oneuptimeColumn.trim().length > 0;
      })
      .map((item: Item) => {
        return `${item.title}: ${item.description}`;
      });
  });

  return [
    product.tagline,
    product.oneuptimeFocus,
    product.oneUptimeDescription,
    product.description,
    product.descriptionLine2,
    ...(product.migrationBenefits || []),
    ...product.keyDifferences.map((difference: KeyDifference) => {
      return `${difference.title}: ${difference.description}`;
    }),
    ...product.faq.map((faq: FAQ) => {
      return faq.answer;
    }),
    ...(product.useCases || []).map((useCase: UseCaseComparison) => {
      return `${useCase.oneuptimeSolution}: ${useCase.oneuptimeCost}`;
    }),
    ...rows,
  ];
};

type RetiredEditionLanguageFunction = (copy: Array<string>) => Array<string>;

const retiredEditionLanguageIn: RetiredEditionLanguageFunction = (
  copy: Array<string>,
): Array<string> => {
  const found: Array<string> = [];

  for (const text of copy) {
    for (const retired of RetiredEditionClaims) {
      if (retired.pattern.test(text)) {
        found.push(`"${retired.example}" (${retired.replacement}) in: ${text}`);
      }
    }
  }

  return found;
};

describe("Comparison pages, as rendered, use no retired edition language", () => {
  test.each(slugs)("%s", (slug: string) => {
    const copy: Array<string> = oneUptimeCopyOf(ProductCompare(slug));

    // The page has to carry copy for the scan to prove anything.
    expect(copy.length).toBeGreaterThan(5);
    expect(retiredEditionLanguageIn(copy)).toEqual([]);
  });

  test("a row whose title and description only together overclaim is caught", () => {
    const planted: Product = {
      ...ProductCompare(slugs[0]!),
      items: [
        {
          name: "Platform & Pricing",
          data: [
            {
              title: "Free to self-host",
              description: "Run the full platform on your own infrastructure.",
              productColumn: "",
              oneuptimeColumn: "tick",
            },
          ],
        },
      ],
    };

    expect(retiredEditionLanguageIn(oneUptimeCopyOf(planted))).toHaveLength(1);

    // Neither line overclaims on its own, which is why the rows are joined.
    for (const line of [
      "Free to self-host",
      "Run the full platform on your own infrastructure.",
    ]) {
      expect(
        RetiredEditionClaims.some((retired: RetiredClaim) => {
          return retired.pattern.test(line);
        }),
      ).toBe(false);
    }
  });

  test("a row OneUptime does not tick is not read as a claim about OneUptime", () => {
    const planted: Product = {
      ...ProductCompare(slugs[0]!),
      items: [
        {
          name: "Platform & Pricing",
          data: [
            {
              title: "Free to self-host",
              description: "Run the full platform on your own infrastructure.",
              productColumn: "tick",
              oneuptimeColumn: "",
            },
          ],
        },
      ],
    };

    expect(retiredEditionLanguageIn(oneUptimeCopyOf(planted))).toEqual([]);
  });

  test("the accurate Community Edition row passes", () => {
    const planted: Product = {
      ...ProductCompare(slugs[0]!),
      items: [
        {
          name: "Platform & Pricing",
          data: [
            {
              title: "Free to self-host",
              description:
                "Run the Apache 2.0 Community Edition on your own infrastructure.",
              productColumn: "",
              oneuptimeColumn: "tick",
            },
          ],
        },
      ],
    };

    expect(retiredEditionLanguageIn(oneUptimeCopyOf(planted))).toEqual([]);
  });
});
