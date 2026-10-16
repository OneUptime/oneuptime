import {
  Reseller,
  ResellerCard,
  ResellerRegion,
  ResellerRegionGroup,
  ResellerRegions,
  Resellers,
  ResellersPageContent,
  getRegionAnchorId,
  getResellerRegionGroups,
  getResellersPageContent,
  getWebsiteLabel,
  toResellerCard,
} from "../Utils/Resellers";
import {
  DEFAULT_RESELLER_INQUIRY_INBOX,
  RESELLER_INQUIRY_HONEYPOT_FIELD,
  RESELLER_INQUIRY_INBOX_VARIABLE,
  RESELLER_INQUIRY_PATH,
  ResellerInquiryFieldRules,
} from "../Utils/ResellerInquiry";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE RESELLERS PAGE'S DATA.
 *
 * The page, its markdown variant and its tests all read Utils/Resellers.ts,
 * so adding the next reseller is one entry. These hold every entry to what
 * the page can show without a broken card or a dead link, pin what is
 * known about SLEXN (and nothing more), and pin how the entries become the
 * regions and cards the page draws.
 */

const STATIC_ROOT: string = path.join(__dirname, "..", "Static");

function reseller(overrides: Partial<Reseller> = {}): Reseller {
  return {
    name: "Example Partner",
    country: "Japan",
    region: "Asia Pacific",
    websiteUrl: "https://www.example-partner.co.jp",
    summary: "Software reselling.",
    ...overrides,
  };
}

describe("the list of resellers", () => {
  test("is not empty, so the page never opens on the empty state", () => {
    expect(Resellers.length).toBeGreaterThan(0);
  });

  test.each(Resellers.map((entry: Reseller): [string, Reseller] => {
    return [entry.name, entry];
  }))("%s says who it is, where it is and what it does", (_name: string, entry: Reseller) => {
    for (const text of [entry.name, entry.country, entry.summary]) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).toBe(text.trim());
    }

    if (entry.city !== undefined) {
      expect(entry.city.trim().length).toBeGreaterThan(0);
    }

    // A summary is one line of the page: a sentence, not a paragraph.
    expect(entry.summary.length).toBeLessThanOrEqual(120);
    expect(entry.summary.endsWith(".")).toBe(true);
  });

  test.each(Resellers.map((entry: Reseller): [string, Reseller] => {
    return [entry.name, entry];
  }))("%s sits in one of the page's regions", (_name: string, entry: Reseller) => {
    expect(ResellerRegions).toContain(entry.region);
  });

  test.each(Resellers.map((entry: Reseller): [string, Reseller] => {
    return [entry.name, entry];
  }))("%s links to its own website over https", (_name: string, entry: Reseller) => {
    const url: URL = new URL(entry.websiteUrl);

    expect(url.protocol).toBe("https:");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(url.hostname.split(".").length).toBeGreaterThanOrEqual(2);
  });

  test.each(Resellers.map((entry: Reseller): [string, Reseller] => {
    return [entry.name, entry];
  }))("%s has a local name only with the language it is written in", (_name: string, entry: Reseller) => {
    if (entry.localName) {
      expect(entry.localNameLanguage).toBeDefined();
      expect(entry.localNameLanguage).not.toBe("en");
    } else {
      expect(entry.localNameLanguage).toBeUndefined();
    }
  });

  test.each(Resellers.map((entry: Reseller): [string, Reseller] => {
    return [entry.name, entry];
  }))("%s shows a logo only once its file is in Static/img/resellers", (_name: string, entry: Reseller) => {
    if (!entry.logoPath) {
      return;
    }

    expect(entry.logoPath.startsWith("/img/resellers/")).toBe(true);
    expect(fs.existsSync(path.join(STATIC_ROOT, entry.logoPath))).toBe(true);
  });

  test("names each reseller once", () => {
    const names: Array<string> = Resellers.map((entry: Reseller): string => {
      return entry.name.toLowerCase();
    });

    expect(new Set(names).size).toBe(names.length);
  });

  test("lists SLEXN of Seoul, South Korea, with only what its own website says", () => {
    const slexn: Reseller | undefined = Resellers.find((entry: Reseller) => {
      return entry.name === "SLEXN";
    });

    /*
     * https://www.slexn.com: "(유)슬렉슨", an address in 서울 강서구, and
     * "소프트웨어 기반 솔루션 & 컨설팅 전문" (software-based solutions and
     * consulting). No logo until SLEXN supplies one.
     */
    expect(slexn).toEqual({
      name: "SLEXN",
      localName: "슬렉슨",
      localNameLanguage: "ko",
      city: "Seoul",
      country: "South Korea",
      region: "Asia Pacific",
      websiteUrl: "https://www.slexn.com",
      summary: "Software solutions and consulting.",
    });
  });
});

describe("the page's regions", () => {
  test("are listed in a fixed order, each once", () => {
    expect(ResellerRegions).toEqual([
      "Americas",
      "Asia Pacific",
      "Europe, Middle East and Africa",
    ]);
  });

  test.each([
    ["Americas", "americas"],
    ["Asia Pacific", "asia-pacific"],
    ["Europe, Middle East and Africa", "europe-middle-east-and-africa"],
  ] as Array<[ResellerRegion, string]>)(
    "%s is anchored at #region-%s",
    (region: ResellerRegion, anchorId: string) => {
      expect(getRegionAnchorId(region)).toBe(anchorId);
    },
  );

  test("have anchors of letters, digits and hyphens only", () => {
    for (const region of ResellerRegions) {
      for (const character of getRegionAnchorId(region)) {
        expect(
          (character >= "a" && character <= "z") || character === "-",
        ).toBe(true);
      }
    }
  });
});

describe("a website's label", () => {
  test.each([
    ["https://www.slexn.com", "slexn.com"],
    ["https://slexn.com", "slexn.com"],
    ["https://www.slexn.com/about-us/", "slexn.com"],
    ["https://partners.example.co.kr", "partners.example.co.kr"],
    ["https://WWW.Example.COM", "example.com"],
    ["https://www2.example.com", "www2.example.com"],
  ])("%s reads as %s", (websiteUrl: string, label: string) => {
    expect(getWebsiteLabel(websiteUrl)).toBe(label);
  });
});

describe("a reseller's card", () => {
  test("says the city and the country when the city is known", () => {
    expect(
      toResellerCard(reseller({ city: "Osaka", country: "Japan" })).location,
    ).toBe("Osaka, Japan");
  });

  test("says the country alone when the city is not", () => {
    expect(toResellerCard(reseller({ country: "Japan" })).location).toBe(
      "Japan",
    );
  });

  test("carries the local name and its language, or neither", () => {
    expect(
      toResellerCard(
        reseller({ localName: "パートナー", localNameLanguage: "ja" }),
      ),
    ).toMatchObject({ localName: "パートナー", localNameLanguage: "ja" });

    expect(toResellerCard(reseller())).toMatchObject({
      localName: null,
      localNameLanguage: null,
    });

    // A language without a name to write in it is dropped.
    expect(
      toResellerCard(reseller({ localNameLanguage: "ja" })).localNameLanguage,
    ).toBeNull();
  });

  test("carries the logo only when there is one", () => {
    expect(toResellerCard(reseller()).logoPath).toBeNull();
    expect(
      toResellerCard(reseller({ logoPath: "/img/resellers/example.svg" }))
        .logoPath,
    ).toBe("/img/resellers/example.svg");
  });

  test("is SLEXN's card for SLEXN", () => {
    const card: ResellerCard = toResellerCard(
      Resellers.find((entry: Reseller) => {
        return entry.name === "SLEXN";
      })!,
    );

    expect(card).toEqual({
      name: "SLEXN",
      localName: "슬렉슨",
      localNameLanguage: "ko",
      location: "Seoul, South Korea",
      country: "South Korea",
      websiteUrl: "https://www.slexn.com",
      websiteLabel: "slexn.com",
      summary: "Software solutions and consulting.",
      logoPath: null,
    });
  });
});

describe("the resellers by region", () => {
  test("puts SLEXN under Asia Pacific", () => {
    const asiaPacific: ResellerRegionGroup | undefined =
      getResellerRegionGroups(Resellers).find((group: ResellerRegionGroup) => {
        return group.region === "Asia Pacific";
      });

    expect(asiaPacific?.anchorId).toBe("asia-pacific");
    expect(
      asiaPacific?.resellers.map((card: ResellerCard) => {
        return card.name;
      }),
    ).toContain("SLEXN");
  });

  test("shows every reseller of the list exactly once", () => {
    const shown: Array<string> = getResellerRegionGroups(Resellers).flatMap(
      (group: ResellerRegionGroup) => {
        return group.resellers.map((card: ResellerCard) => {
          return card.name;
        });
      },
    );

    expect([...shown].sort()).toEqual(
      Resellers.map((entry: Reseller) => {
        return entry.name;
      }).sort(),
    );
  });

  test("leaves a region without resellers out, rather than showing it empty", () => {
    const groups: Array<ResellerRegionGroup> = getResellerRegionGroups([
      reseller({ name: "Andes Partner", region: "Americas", country: "Chile" }),
      reseller({
        name: "Nordic Partner",
        region: "Europe, Middle East and Africa",
        country: "Sweden",
      }),
    ]);

    expect(
      groups.map((group: ResellerRegionGroup) => {
        return group.region;
      }),
    ).toEqual(["Americas", "Europe, Middle East and Africa"]);
  });

  test("orders the regions as the page does, whatever order the list is in", () => {
    const groups: Array<ResellerRegionGroup> = getResellerRegionGroups([
      reseller({ name: "C", region: "Europe, Middle East and Africa" }),
      reseller({ name: "B", region: "Asia Pacific" }),
      reseller({ name: "A", region: "Americas" }),
    ]);

    expect(
      groups.map((group: ResellerRegionGroup) => {
        return group.region;
      }),
    ).toEqual([...ResellerRegions]);
  });

  test("orders a region's resellers by name", () => {
    const groups: Array<ResellerRegionGroup> = getResellerRegionGroups([
      reseller({ name: "Zeta Partner" }),
      reseller({ name: "alpha partner" }),
      reseller({ name: "Mu Partner" }),
    ]);

    expect(
      groups[0]!.resellers.map((card: ResellerCard) => {
        return card.name;
      }),
    ).toEqual(["alpha partner", "Mu Partner", "Zeta Partner"]);
  });

  test("is empty for no resellers", () => {
    expect(getResellerRegionGroups([])).toEqual([]);
  });
});

describe("the page's content", () => {
  const savedInbox: string | undefined =
    process.env[RESELLER_INQUIRY_INBOX_VARIABLE];

  afterEach(() => {
    if (savedInbox === undefined) {
      delete process.env[RESELLER_INQUIRY_INBOX_VARIABLE];
    } else {
      process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = savedInbox;
    }
  });

  test("is the resellers by region, their count and the form", () => {
    const content: ResellersPageContent = getResellersPageContent({
      inquiryInbox: "partners@example.com",
    });

    expect(content.regions).toEqual(getResellerRegionGroups(Resellers));
    expect(content.resellerCount).toBe(Resellers.length);
    expect(content.form).toEqual({
      endpoint: RESELLER_INQUIRY_PATH,
      fallbackEmail: "partners@example.com",
      honeypotField: RESELLER_INQUIRY_HONEYPOT_FIELD,
      fields: ResellerInquiryFieldRules,
    });
  });

  test("can be drawn for a list with no resellers at all", () => {
    const content: ResellersPageContent = getResellersPageContent({
      resellers: [],
      inquiryInbox: "partners@example.com",
    });

    expect(content.regions).toEqual([]);
    expect(content.resellerCount).toBe(0);
    expect(content.form.endpoint).toBe(RESELLER_INQUIRY_PATH);
  });

  test("names the configured inbox for people who would rather write", () => {
    process.env[RESELLER_INQUIRY_INBOX_VARIABLE] = "Partners@OneUptime.com";

    expect(getResellersPageContent().form.fallbackEmail).toBe(
      "partners@oneuptime.com",
    );
  });

  test("names the default inbox when none is configured", () => {
    delete process.env[RESELLER_INQUIRY_INBOX_VARIABLE];

    expect(getResellersPageContent().form.fallbackEmail).toBe(
      DEFAULT_RESELLER_INQUIRY_INBOX,
    );
  });
});
