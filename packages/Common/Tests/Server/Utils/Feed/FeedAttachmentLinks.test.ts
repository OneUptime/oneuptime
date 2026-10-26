import FeedAttachmentLinks, {
  FEED_ATTACHMENT_ROUTES_NOT_SERVED,
  FEED_ATTACHMENT_ROUTES_SERVED,
  FeedAttachmentLinksRewrite,
  isUuidAt,
} from "../../../../Server/Utils/Feed/FeedAttachmentLinks";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ATTACHMENT LINKS OLD FEED ENTRIES CARRY (FeedAttachmentLinks), as the
 * RewriteFeedAttachmentLinks data migration rewrites them. The download
 * routes took the project id in November 2025 and the feed kept writing
 * the address without it until #4925, so every attachment link stored in a
 * feed entry before then is a 404.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const NOTE: string = "22222222-2222-4222-8222-222222222222";
const FILE: string = "33333333-3333-4333-8333-333333333333";
const FILE_2: string = "44444444-4444-4444-8444-444444444444";

const oldAddress: (route: string, file?: string) => string = (
  route: string,
  file?: string,
): string => {
  return "/api/" + route + "/attachment/" + NOTE + "/" + (file || FILE);
};

const newAddress: (route: string, file?: string) => string = (
  route: string,
  file?: string,
): string => {
  return (
    "/api/" + route + "/attachment/" + PROJECT + "/" + NOTE + "/" + (file || FILE)
  );
};

// A feed entry as a note service wrote it: the note, then its files.
const entry: (attachments: string) => string = (
  attachments: string,
): string => {
  return (
    "📄 posted **private note** for this [Incident #42](https://oneuptime.example/dashboard/" +
    PROJECT +
    "/incidents/1):\n\nRolled back the deploy.\n\n**Attachments:**\n" +
    attachments +
    "\n"
  );
};

const rewrite: (markdown: string) => FeedAttachmentLinksRewrite = (
  markdown: string,
): FeedAttachmentLinksRewrite => {
  return FeedAttachmentLinks.rewriteOldLinks(markdown, PROJECT);
};

describe("FeedAttachmentLinks.rewriteOldLinks", () => {
  test.each(FEED_ATTACHMENT_ROUTES_SERVED.map((route: string) => [route]))(
    "an old %s link gets the project id, and leads to the route that serves it",
    (route: string) => {
      const before: string = entry(
        "- [runbook.pdf](" + oldAddress(route) + ")",
      );

      expect(rewrite(before)).toEqual({
        markdown: entry("- [runbook.pdf](" + newAddress(route) + ")"),
        rewritten: 1,
      });
    },
  );

  test.each(FEED_ATTACHMENT_ROUTES_NOT_SERVED.map((route: string) => [route]))(
    "an old %s link, whose route never existed, becomes the file's name",
    (route: string) => {
      expect(
        rewrite(entry("- [runbook.pdf](" + oldAddress(route) + ")")),
      ).toEqual({ markdown: entry("- runbook.pdf"), rewritten: 1 });
    },
  );

  test("every link of an entry, each kind, in order", () => {
    const before: string = entry(
      [
        "- [a.png](" + oldAddress("incident-internal-note") + ")",
        "- [b.txt](" + oldAddress("incident-internal-note", FILE_2) + ")",
      ].join("\n"),
    );

    expect(rewrite(before)).toEqual({
      markdown: entry(
        [
          "- [a.png](" + newAddress("incident-internal-note") + ")",
          "- [b.txt](" + newAddress("incident-internal-note", FILE_2) + ")",
        ].join("\n"),
      ),
      rewritten: 2,
    });

    const episode: string = entry(
      [
        "- [a.png](" + oldAddress("alert-episode-internal-note") + ")",
        "- [b.txt](" + oldAddress("alert-episode-internal-note", FILE_2) + ")",
      ].join("\n"),
    );

    expect(rewrite(episode)).toEqual({
      markdown: entry("- a.png\n- b.txt"),
      rewritten: 2,
    });
  });

  test("an address written in angle brackets is read too", () => {
    expect(
      rewrite("- [a b.pdf](<" + oldAddress("alert-internal-note") + ">)"),
    ).toEqual({
      markdown: "- [a b.pdf](<" + newAddress("alert-internal-note") + ">)",
      rewritten: 1,
    });
    expect(
      rewrite(
        "- [a b.pdf](<" + oldAddress("incident-episode-internal-note") + ">)",
      ),
    ).toEqual({ markdown: "- a b.pdf", rewritten: 1 });
  });

  test("a name with escaped brackets stays the escaped name", () => {
    expect(
      rewrite(
        "- [report \\[final\\].pdf](" +
          oldAddress("incident-episode-internal-note") +
          ")",
      ),
    ).toEqual({ markdown: "- report \\[final\\].pdf", rewritten: 1 });
  });

  test("a link written today is left as it is, so running it again changes nothing", () => {
    const today: string = entry(
      "- [runbook.pdf](" + newAddress("incident-internal-note") + ")",
    );

    expect(rewrite(today)).toEqual({ markdown: today, rewritten: 0 });

    const once: string = rewrite(
      entry("- [runbook.pdf](" + oldAddress("incident-public-note") + ")"),
    ).markdown;

    expect(rewrite(once)).toEqual({ markdown: once, rewritten: 0 });
  });

  test.each([
    [
      "an address in a note's text, not a link",
      "See " + oldAddress("incident-internal-note") + " in the logs.",
    ],
    [
      "a link to another note route",
      "- [x](/api/incident-note/attachment/" + NOTE + "/" + FILE + ")",
    ],
    [
      "an id cut short",
      "- [x](/api/incident-internal-note/attachment/" +
        NOTE +
        "/" +
        FILE.slice(0, 30) +
        ")",
    ],
    [
      "a path that is not an id",
      "- [x](/api/incident-internal-note/attachment/" +
        NOTE +
        "/not-a-file-id-at-all-not-a-file-id-x)",
    ],
    ["a link to another site", "- [x](https://example.com/api/x/attachment/)"],
    [
      "an episode link with no words before it",
      "(" + oldAddress("alert-episode-internal-note") + ")",
    ],
  ])("never touches %s", (_name: string, markdown: string) => {
    expect(rewrite(markdown)).toEqual({ markdown: markdown, rewritten: 0 });
  });

  test("without a project id, or with one that is no id, nothing changes", () => {
    const before: string = entry(
      "- [a](" + oldAddress("incident-internal-note") + ")",
    );

    for (const projectId of [undefined, null, "", "project-1", PROJECT + "x"]) {
      expect(FeedAttachmentLinks.rewriteOldLinks(before, projectId)).toEqual({
        markdown: before,
        rewritten: 0,
      });
    }
  });

  test("an empty entry stays empty", () => {
    expect(FeedAttachmentLinks.rewriteOldLinks(undefined, PROJECT)).toEqual({
      markdown: "",
      rewritten: 0,
    });
  });

  test("isUuidAt reads a whole id, in either case, and nothing shorter", () => {
    expect(isUuidAt(NOTE, 0)).toBe(true);
    expect(isUuidAt(NOTE.toUpperCase(), 0)).toBe(true);
    expect(isUuidAt("x" + NOTE, 1)).toBe(true);
    expect(isUuidAt(NOTE.slice(0, 35), 0)).toBe(false);
    expect(isUuidAt(NOTE.replace("-", "x"), 0)).toBe(false);
    expect(isUuidAt(NOTE, -1)).toBe(false);
  });

  /*
   * The episode links' words are read back from each link: never further
   * than where the link before ended. Read back to the start of the line
   * instead, the second shape took 1.5 s at 400,000 characters - and far
   * longer at the 1,200,000 here - so it is sized to fail that, well past
   * any slower runner.
   */
  test("its slowest shapes, up to 1,200,000 characters, take well under two seconds", () => {
    const shapes: Array<string> = [
      // Addresses that start like an old link and never finish.
      "/api/incident-internal-note/attachment/".repeat(10000),
      // Episode links with no "[" before them, all on one line.
      ("x](" + oldAddress("alert-episode-internal-note") + ")").repeat(10000),
      // Escaped brackets before every episode link.
      ("\\[\\\\\\[](" + oldAddress("incident-episode-internal-note") + ")").repeat(
        3000,
      ),
    ];

    for (const shape of shapes) {
      expect(shape.length).toBeGreaterThan(300000);

      const written: FastestRun<FeedAttachmentLinksRewrite> = fastestRun({
        run: (): FeedAttachmentLinksRewrite => {
          return rewrite(shape);
        },
        limitInMs: 2000,
      });

      expect(written.result.markdown.length).toBeGreaterThan(0);
      expect(written.inMs).toBeLessThan(2000);
    }
  });
});
