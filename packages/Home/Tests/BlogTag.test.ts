import BlogTag from "../Utils/BlogTag";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * A blog tag's slug and the paths built from it (Utils/BlogTag.ts).
 *
 * A tag with a slash in it - "CI/CD", "Pub/Sub" - linked to /blog/tag/ci%2Fcd,
 * and its page linked its later pages and its feed as /blog/tag/ci/cd?page=2
 * and /blog/tag/ci/cd/rss.xml: two path segments, which the tag route does
 * not match, so they were 404s. A slug now holds only what a URL path
 * carries as it is (and letters of other scripts, percent-encoded), so no
 * tag's address can be split, and every link to a tag is built from it.
 *
 * BlogPages.test.ts serves these addresses through the real routes.
 */

// The address a tag had before: lowercased, spaces as hyphens, then encoded.
const oldPagePath: (tag: string) => string = (tag: string): string => {
  return `/blog/tag/${encodeURIComponent(tag.split(" ").join("-").toLowerCase())}`;
};

describe("a tag with a slash in its name", () => {
  test.each([
    ["CI/CD", "ci-cd"],
    ["ci/cd", "ci-cd"],
    ["Pub/Sub", "pub-sub"],
    ["pub/sub", "pub-sub"],
    ["Cloud Pub/Sub", "cloud-pub-sub"],
    ["Google Cloud Pub/Sub", "google-cloud-pub-sub"],
    ["A/B Testing", "a-b-testing"],
    ["HTTP/2", "http-2"],
    ["TCP/IP", "tcp-ip"],
    ["I/O", "i-o"],
    ["/etc/hosts", "etc-hosts"],
    ["/etc/network/interfaces", "etc-network-interfaces"],
    ["10.0.0.0/8", "10.0.0.0-8"],
  ])("%s has the slug %s", (tag: string, slug: string) => {
    expect(BlogTag.getSlug(tag)).toBe(slug);
  });

  test("its page is one path segment under /blog/tag", () => {
    expect(BlogTag.getPagePathOfTag("CI/CD")).toBe("/blog/tag/ci-cd");
    expect(BlogTag.getPagePathOfTag("Pub/Sub")).toBe("/blog/tag/pub-sub");
  });

  test("its feed is that page's rss.xml", () => {
    expect(BlogTag.getFeedPath(BlogTag.getSlug("CI/CD"))).toBe(
      "/blog/tag/ci-cd/rss.xml",
    );
  });

  test("its address holds no slash, encoded or not", () => {
    for (const tag of [
      "CI/CD",
      "Pub/Sub",
      "/etc/hosts",
      "@azure/service-bus",
    ]) {
      const pagePath: string = BlogTag.getPagePathOfTag(tag) as string;

      expect(pagePath.split("/")).toHaveLength(4);
      expect(pagePath.toLowerCase()).not.toContain("%2f");
    }
  });
});

describe("spaces", () => {
  test.each([
    ["Site Reliability Engineering", "site-reliability-engineering"],
    ["  Kubernetes  ", "kubernetes"],
    ["Incident  Management", "incident-management"],
    ["Incident\tManagement", "incident-management"],
    ["Incident\nManagement", "incident-management"],
    ["CI / CD", "ci-cd"],
    ["Blue - Green", "blue-green"],
    // A no-break space and an ideographic space are spaces too.
    ["Open Source", "open-source"],
    ["Open　Source", "open-source"],
  ])("%j has the slug %s", (tag: string, slug: string) => {
    expect(BlogTag.getSlug(tag)).toBe(slug);
  });
});

describe("symbols", () => {
  test("C, C# and C++ keep pages of their own", () => {
    expect(BlogTag.getSlug("C")).toBe("c");
    expect(BlogTag.getSlug("C#")).toBe("c-sharp");
    expect(BlogTag.getSlug("C++")).toBe("c-plus-plus");
    expect(BlogTag.getSlug("C/C++")).toBe("c-c-plus-plus");
    expect(BlogTag.getSlug("F#")).toBe("f-sharp");
  });

  test.each([
    ["N+1", "n-plus-1"],
    ["TACACS+", "tacacs-plus"],
    ["Q&A", "q-and-a"],
    ["R&D", "r-and-d"],
    ["Weights & Biases", "weights-and-biases"],
    ["Lambda@Edge", "lambda-at-edge"],
    ["@azure/service-bus", "at-azure-service-bus"],
  ])("%s spells its symbol out: %s", (tag: string, slug: string) => {
    expect(BlogTag.getSlug(tag)).toBe(slug);
  });

  test.each([
    ["Let's Encrypt", "lets-encrypt"],
    ["Let’s Encrypt", "lets-encrypt"],
    ["Dead Man's Switch", "dead-mans-switch"],
    ["Cap'n Proto", "capn-proto"],
  ])("%s drops its apostrophe: %s", (tag: string, slug: string) => {
    expect(BlogTag.getSlug(tag)).toBe(slug);
  });

  test.each([
    ["$lookup", "lookup"],
    ["cluster()", "cluster"],
    ["::1", "1"],
    ["2001:db8::/32", "2001-db8-32"],
    ["Std::io::Error", "std-io-error"],
    ["JSON:API", "json-api"],
    ["100%", "100"],
    ["What?", "what"],
    ["a\\b", "a-b"],
    ['"Quoted"', "quoted"],
    ["<T>", "t"],
    ["a|b", "a-b"],
  ])(
    "%s turns its other symbols into hyphens: %s",
    (tag: string, slug: string) => {
      expect(BlogTag.getSlug(tag)).toBe(slug);
    },
  );

  test("dots, underscores and tildes are kept: a URL path carries them as they are", () => {
    expect(BlogTag.getSlug(".NET")).toBe(".net");
    expect(BlogTag.getSlug("Node.js")).toBe("node.js");
    expect(BlogTag.getSlug("ASP.NET Core")).toBe("asp.net-core");
    expect(BlogTag.getSlug("for_each")).toBe("for_each");
    expect(BlogTag.getSlug("~user")).toBe("~user");
  });

  test('"." and ".." are steps along a path, so a tag of only dots has no slug', () => {
    expect(BlogTag.getSlug(".")).toBe("");
    expect(BlogTag.getSlug("..")).toBe("");
    expect(BlogTag.getSlug("...")).toBe("");
    expect(BlogTag.getSlug(" .. ")).toBe("");
  });

  test("a tag with nothing that can go into a URL has no slug and no page", () => {
    for (const tag of ["", " ", "::", "/", "$", "()", "🚀", "⚠️", "---"]) {
      expect([tag, BlogTag.getSlug(tag)]).toEqual([tag, ""]);
      expect([tag, BlogTag.getPagePathOfTag(tag)]).toEqual([tag, null]);
    }
  });
});

describe("other scripts and Unicode", () => {
  test("accented letters are kept, lowercased", () => {
    expect(BlogTag.getSlug("Café")).toBe("café");
    expect(BlogTag.getSlug("CAFÉ")).toBe("café");
    expect(BlogTag.getSlug("Straße")).toBe("straße");
    expect(BlogTag.getSlug("Ünïcödé Tag")).toBe("ünïcödé-tag");
  });

  test("a letter and its combining accent are the same tag as the accented letter", () => {
    expect(BlogTag.getSlug("Café")).toBe(BlogTag.getSlug("Café"));
    expect(BlogTag.getSlug("Café")).toBe("café");
  });

  test("full-width letters are the letters", () => {
    expect(BlogTag.getSlug("ＣＩ/ＣＤ")).toBe("ci-cd");
    expect(BlogTag.getSlug("Ｋｕｂｅｒｎｅｔｅｓ")).toBe("kubernetes");
  });

  test("letters of other scripts are kept, and percent-encoded in the path", () => {
    expect(BlogTag.getSlug("日本語")).toBe("日本語");
    expect(BlogTag.getPagePathOfTag("日本語")).toBe(
      "/blog/tag/%E6%97%A5%E6%9C%AC%E8%AA%9E",
    );
    expect(BlogTag.getSlug("Мониторинг Логов")).toBe("мониторинг-логов");
    expect(BlogTag.getSlug("监控 / 告警")).toBe("监控-告警");
  });

  test("the marks of a script that writes vowels as marks are kept (Devanagari)", () => {
    expect(BlogTag.getSlug("हिन्दी")).toBe("हिन्दी");
    expect(BlogTag.getSlug("लॉग")).toBe("लॉग");
  });

  test("an emoji and its invisible variation selector become a hyphen, not part of the slug", () => {
    expect(BlogTag.getSlug("⚠️ Alerts")).toBe("alerts");
    expect(BlogTag.getSlug("Launch 🚀 Day")).toBe("launch-day");
  });
});

describe("the tags that kept their address", () => {
  test.each([
    "Kubernetes",
    "Site Reliability Engineering",
    "OpenTelemetry",
    "Node.js",
    "for_each",
    "Blue-Green Deployment",
    "Learning Resource",
    "K8s",
    "2024",
  ])("%s links where it did before", (tag: string) => {
    expect(BlogTag.getPagePathOfTag(tag)).toBe(oldPagePath(tag));
  });

  /*
   * Every tag of letters, digits, dots and underscores, in words joined by
   * one space or hyphen - what nearly all of the blog's 20,758 tags are -
   * has the address it had. Only tags with other characters moved.
   */
  test("every tag of words joined by single spaces or hyphens keeps its address", () => {
    const random: SeededRandom = seededRandom(20261013);
    const words: Array<string> = generatedTexts(4000, 1012, [
      "a",
      "K",
      "z",
      "0",
      "8",
      ".",
      "_",
      "Ops",
    ]).filter((word: string) => {
      // A tag of dots alone ("." or "..") has no slug: see the path steps above.
      return word.split(".").join("").length > 0;
    });
    const tags: Array<string> = [];
    let tag: string = words[0] as string;

    for (const word of words.slice(1)) {
      if (random(4) === 0) {
        tags.push(tag);
        tag = word;
      } else {
        tag = `${tag}${random(2) === 0 ? " " : "-"}${word}`;
      }
    }

    tags.push(tag);

    expect(tags.length).toBeGreaterThan(500);
    expect(
      tags.filter((written: string) => {
        return BlogTag.getPagePathOfTag(written) !== oldPagePath(written);
      }),
    ).toEqual([]);
  });
});

describe("tags that come out the same share a page", () => {
  test("CI/CD, CI CD, Ci-cd and ci/cd are one tag", () => {
    const slugs: Set<string> = new Set(
      ["CI/CD", "CI CD", "Ci-cd", "ci/cd", "CI - CD"].map((tag: string) => {
        return BlogTag.getSlug(tag);
      }),
    );

    expect([...slugs]).toEqual(["ci-cd"]);
  });

  test("Pub/Sub, Pub-Sub and Pub Sub are one tag", () => {
    const slugs: Set<string> = new Set(
      ["Pub/Sub", "Pub-Sub", "Pub Sub", "pub/sub"].map((tag: string) => {
        return BlogTag.getSlug(tag);
      }),
    );

    expect([...slugs]).toEqual(["pub-sub"]);
  });
});

describe("paths", () => {
  test("a tag page's path is /blog/tag/ and its slug, encoded", () => {
    expect(BlogTag.getPagePath("kubernetes")).toBe("/blog/tag/kubernetes");
    expect(BlogTag.getPagePath("café")).toBe("/blog/tag/caf%C3%A9");
  });

  test("a tag feed's path is its page's path and /rss.xml", () => {
    expect(BlogTag.getFeedPath("kubernetes")).toBe(
      "/blog/tag/kubernetes/rss.xml",
    );
    expect(BlogTag.getFeedPath("日本語")).toBe(
      "/blog/tag/%E6%97%A5%E6%9C%AC%E8%AA%9E/rss.xml",
    );
  });
});

/*
 * Whatever a tag is written as. The alphabet holds every kind of character a
 * tag has been seen with, and the ones a URL path cannot carry as they are.
 * Each test lists the tags that break its rule, so a failure names them.
 */
describe("every slug", () => {
  const TAGS: Array<string> = generatedTexts(
    6000,
    1309,
    [
      "C",
      "i",
      "Ops",
      "/",
      "+",
      "#",
      "&",
      "@",
      "$",
      " ",
      "  ",
      "\t",
      "\n",
      "-",
      "--",
      ".",
      "..",
      "_",
      "~",
      "'",
      "\u2019",
      "(",
      ")",
      ":",
      "?",
      "%",
      "%2F",
      "\\",
      '"',
      "<",
      "|",
      "日本",
      "é",
      "e\u0301",
      "Ａ",
      "ß",
      "हि",
      "⚠️",
      "🚀",
      "\uFE0F",
      "\u200D",
      "\u0000",
    ],
    12,
  );

  // What a slug may hold: letters, marks and numbers of any script, and -._~.
  const SLUG_CHARACTERS: RegExp = /^[\p{L}\p{M}\p{N}._~-]*$/u;

  // What a server, proxy or browser would read as more than part of a name.
  const NOT_A_NAME: RegExp = /[?#\s\\]/;

  const tagsWhere: (
    breaksTheRule: (tag: string, slug: string) => boolean,
  ) => Array<string> = (
    breaksTheRule: (tag: string, slug: string) => boolean,
  ): Array<string> => {
    return TAGS.filter((tag: string) => {
      return breaksTheRule(tag, BlogTag.getSlug(tag));
    });
  };

  test("holds only letters, marks, numbers and - . _ ~", () => {
    expect(
      tagsWhere((_tag: string, slug: string) => {
        return !SLUG_CHARACTERS.test(slug);
      }),
    ).toEqual([]);
  });

  test("has no hyphen at either end and no two in a row, and is never a path step", () => {
    expect(
      tagsWhere((_tag: string, slug: string) => {
        return (
          slug.startsWith("-") ||
          slug.endsWith("-") ||
          slug.includes("--") ||
          slug === "." ||
          slug === ".."
        );
      }),
    ).toEqual([]);
  });

  test("is lowercase and NFKC-normal", () => {
    expect(
      tagsWhere((_tag: string, slug: string) => {
        return slug !== slug.toLowerCase() || slug !== slug.normalize("NFKC");
      }),
    ).toEqual([]);
  });

  test("is its own slug, so a slug read back as a tag finds the same page", () => {
    expect(
      tagsWhere((_tag: string, slug: string) => {
        return BlogTag.getSlug(slug) !== slug;
      }),
    ).toEqual([]);
  });

  test("goes into one path segment and comes back out of it unchanged", () => {
    expect(
      tagsWhere((tag: string, slug: string) => {
        const pagePath: string | null = BlogTag.getPagePathOfTag(tag);

        if (!slug) {
          return pagePath !== null;
        }

        const segments: Array<string> = (pagePath || "").split("/");

        return (
          segments.length !== 4 ||
          decodeURIComponent(segments[3] || "") !== slug ||
          NOT_A_NAME.test(pagePath || "")
        );
      }),
    ).toEqual([]);
  });

  test("covers tags with and without a slug", () => {
    expect(
      tagsWhere((_tag: string, slug: string) => {
        return slug === "";
      }).length,
    ).toBeGreaterThan(0);
    expect(
      tagsWhere((_tag: string, slug: string) => {
        return slug.length > 3;
      }).length,
    ).toBeGreaterThan(TAGS.length / 2);
  });
});
