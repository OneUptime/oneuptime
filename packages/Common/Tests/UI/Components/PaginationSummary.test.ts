import { describe, expect, it } from "@jest/globals";
import PaginationCopy from "../../../UI/Components/Pagination/PaginationCopy";
import {
  PaginationSummaryInput,
  TranslateTemplateFunction,
  getPaginationSummary,
} from "../../../UI/Components/Pagination/PaginationSummary";
import PaginationUtil from "../../../UI/Components/Pagination/PaginationUtil";
import {
  TemplateValues,
  fillTemplate,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The line beside the pagination controls. English names the rows; a locale
 * that translates the noun-free sentence gets that instead, because the noun
 * is the caller's and no locale can hold it in every case its grammar needs.
 */

type SummaryFunction = (
  overrides: Partial<PaginationSummaryInput> & {
    currentPageNumber?: number;
    itemsOnPage?: number;
    itemsOnCurrentPage?: number;
  },
) => string;

const summary: SummaryFunction = (
  overrides: Partial<PaginationSummaryInput> & {
    currentPageNumber?: number;
    itemsOnPage?: number;
    itemsOnCurrentPage?: number;
  },
): string => {
  const totalItemsCount: number = overrides.totalItemsCount ?? 240;

  return getPaginationSummary({
    itemRange: PaginationUtil.getItemRange({
      currentPageNumber: overrides.currentPageNumber ?? 1,
      itemsOnPage: overrides.itemsOnPage ?? 10,
      totalItemsCount: totalItemsCount,
      itemsOnCurrentPage: overrides.itemsOnCurrentPage,
    }),
    totalItemsCount: totalItemsCount,
    singularLabel: overrides.singularLabel ?? "Monitor",
    pluralLabel: overrides.pluralLabel ?? "Monitors",
    hasMore: overrides.hasMore,
    translate: overrides.translate,
  });
};

// A locale with its own noun-free sentences, as the German file has them.
const GERMAN: Record<string, string> = {
  [PaginationCopy.showingRangeOfTotal]: "Einträge {{range}} von {{total}}",
  [PaginationCopy.showingRange]: "Einträge {{range}}",
  [PaginationCopy.noItems]: "Keine Einträge",
};

const german: TranslateTemplateFunction = (
  template: string,
  values?: TemplateValues,
): string => {
  return fillTemplate(GERMAN[template] ?? template, values);
};

// What an English Dashboard does: every string looks up to itself.
const english: TranslateTemplateFunction = (
  template: string,
  values?: TemplateValues,
): string => {
  return fillTemplate(template, values);
};

describe("getPaginationSummary", () => {
  describe("in English", () => {
    it("prints the range and the total in the list's own words", () => {
      expect(summary({})).toBe("Showing 1-10 of 240 monitors");
    });

    it("offsets the range by the pages already passed", () => {
      expect(summary({ currentPageNumber: 3, itemsOnPage: 25 })).toBe(
        "Showing 51-75 of 240 monitors",
      );
    });

    it("stops a short last page at the last row there is", () => {
      expect(summary({ currentPageNumber: 3, totalItemsCount: 23 })).toBe(
        "Showing 21-23 of 23 monitors",
      );
    });

    it("prints a single row as one number", () => {
      expect(summary({ currentPageNumber: 3, totalItemsCount: 21 })).toBe(
        "Showing 21 of 21 monitors",
      );
    });

    it("uses the singular for a list of one", () => {
      expect(summary({ totalItemsCount: 1 })).toBe("Showing 1 of 1 monitor");
    });

    it("says there is nothing when the list is empty", () => {
      expect(summary({ totalItemsCount: 0 })).toBe("No monitors");
    });

    it("groups the digits of large numbers", () => {
      expect(
        summary({
          currentPageNumber: 12346,
          itemsOnPage: 100,
          totalItemsCount: 1234567,
        }),
      ).toBe(
        `Showing ${(1234501).toLocaleString()}-${(1234567).toLocaleString()} of ${(1234567).toLocaleString()} monitors`,
      );
    });

    it("caps the range at the rows the page really drew", () => {
      expect(
        summary({
          currentPageNumber: 24,
          totalItemsCount: 236,
          itemsOnCurrentPage: 6,
        }),
      ).toBe("Showing 231-236 of 236 monitors");
    });

    /*
     * Lower-casing every letter, as the control used to, printed "slos" and
     * "api keys".
     */
    it("keeps the acronyms in a label", () => {
      expect(
        summary({
          singularLabel: "SLO",
          pluralLabel: "SLOs",
          totalItemsCount: 12,
        }),
      ).toBe("Showing 1-10 of 12 SLOs");
      expect(
        summary({
          singularLabel: "API Key",
          pluralLabel: "API Keys",
          totalItemsCount: 1,
        }),
      ).toBe("Showing 1 of 1 API key");
    });

    it("lower-cases a label of ordinary words", () => {
      expect(
        summary({
          singularLabel: "On-Call Duty Policy",
          pluralLabel: "On-Call Duty Policies",
        }),
      ).toBe("Showing 1-10 of 240 on-call duty policies");
    });

    it("falls back to a generic noun when the caller passes none", () => {
      expect(summary({ singularLabel: "", pluralLabel: "" })).toBe(
        "Showing 1-10 of 240 items",
      );
      expect(
        summary({ singularLabel: " ", pluralLabel: " ", totalItemsCount: 1 }),
      ).toBe("Showing 1 of 1 item");
      expect(
        summary({ singularLabel: "", pluralLabel: "", totalItemsCount: 0 }),
      ).toBe("No items");
    });

    it("is the same whether or not an English locale is loaded", () => {
      expect(summary({ translate: english })).toBe(summary({}));
      expect(summary({ translate: english, totalItemsCount: 0 })).toBe(
        "No monitors",
      );
      expect(summary({ translate: english, hasMore: true })).toBe(
        "Showing 1-10+ monitors",
      );
    });
  });

  /*
   * Has-more mode: the analytics list endpoints skip COUNT(*), so the total is
   * a lower bound and is never printed.
   */
  describe("when the total is unknown", () => {
    it("marks that more rows follow", () => {
      expect(
        summary({ hasMore: true, totalItemsCount: 11, itemsOnCurrentPage: 10 }),
      ).toBe("Showing 1-10+ monitors");
    });

    it("drops the plus on the page that reports no more rows", () => {
      expect(
        summary({
          hasMore: false,
          currentPageNumber: 2,
          totalItemsCount: 13,
          itemsOnCurrentPage: 3,
        }),
      ).toBe("Showing 11-13 monitors");
    });

    it("never prints the lower bound as a total", () => {
      expect(
        summary({ hasMore: true, totalItemsCount: 11, itemsOnCurrentPage: 10 }),
      ).not.toContain("11");
    });

    it("says there is nothing on an empty page", () => {
      expect(
        summary({
          hasMore: false,
          currentPageNumber: 2,
          totalItemsCount: 10,
          itemsOnCurrentPage: 0,
        }),
      ).toBe("No monitors");
    });
  });

  describe("in a locale with its own sentences", () => {
    it("leaves the caller's noun out", () => {
      expect(summary({ translate: german })).toBe("Einträge 1-10 von 240");
    });

    it("leaves it out for a list of one too", () => {
      expect(summary({ translate: german, totalItemsCount: 1 })).toBe(
        "Einträge 1 von 1",
      );
    });

    it("says there is nothing without the noun", () => {
      expect(summary({ translate: german, totalItemsCount: 0 })).toBe(
        "Keine Einträge",
      );
    });

    it("marks that more rows follow when the total is unknown", () => {
      expect(
        summary({
          translate: german,
          hasMore: true,
          totalItemsCount: 31,
          currentPageNumber: 3,
          itemsOnCurrentPage: 10,
        }),
      ).toBe("Einträge 21-30+");
    });

    it("hands the locale the numbers already formatted", () => {
      const seen: Array<TemplateValues | undefined> = [];

      summary({
        translate: (template: string, values?: TemplateValues): string => {
          seen.push(values);
          return german(template, values);
        },
        totalItemsCount: 1234567,
      });

      expect(seen).toEqual([
        { range: "1-10", total: (1234567).toLocaleString() },
      ]);
    });

    it("keeps the English sentence when the locale gives nothing back", () => {
      expect(
        summary({
          translate: (): string => {
            return "";
          },
        }),
      ).toBe("Showing 1-10 of 240 monitors");
    });

    it("asks for the noun-free sentence by its English text", () => {
      const asked: Array<string> = [];

      for (const overrides of [
        {},
        { totalItemsCount: 0 },
        { hasMore: true },
      ] as Array<Partial<PaginationSummaryInput>>) {
        summary({
          ...overrides,
          translate: (template: string, values?: TemplateValues): string => {
            asked.push(template);
            return english(template, values);
          },
        });
      }

      expect(asked).toEqual([
        "Showing {{range}} of {{total}}",
        "No items",
        "Showing {{range}}",
      ]);
    });
  });
});
