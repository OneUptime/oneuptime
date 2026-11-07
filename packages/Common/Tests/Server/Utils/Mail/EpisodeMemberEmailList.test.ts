import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import EpisodeMemberEmailList, {
  ALERT_NUMBER_BADGE,
  EPISODE_MEMBER_ROW_DIVIDER,
  EpisodeMemberEmailListItem,
  getEpisodeMemberViewCellWidth,
  INCIDENT_NUMBER_BADGE,
} from "../../../../Server/Utils/Mail/EpisodeMemberEmailList";
import { getServerTranslator } from "../../../../Server/Utils/ServerTranslation";
import { READER_LANGUAGE_CODES } from "../../../../Types/ReaderLanguage";

/*
 * THE ALERTS OR INCIDENTS OF AN EPISODE, AS ITS PAGE-OUT EMAIL LISTS THEM
 * (Server/Utils/Mail/EpisodeMemberEmailList).
 *
 * One bordered box, a row per member. A divider separates two rows and
 * nothing else: it is drawn above every row but the first. Each row used to
 * draw one under itself, so the last row's sat on the box's own bottom
 * border and doubled it.
 *
 * The rows are read here a cell at a time with indexOf: the opening of each
 * row's cell is this builder's own markup.
 */

const ROW_CELL: string = '<td style="padding: 16px 20px;';

const item: (index: number) => EpisodeMemberEmailListItem = (
  index: number,
): EpisodeMemberEmailListItem => {
  return {
    number: `ALT-${index}`,
    title: `Checkout latency ${index}`,
    link: `https://oneuptime.example.test/dashboard/alerts/${index}`,
    monitorName: `Checkout API ${index}`,
  };
};

const items: (count: number) => Array<EpisodeMemberEmailListItem> = (
  count: number,
): Array<EpisodeMemberEmailListItem> => {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return item(index + 1);
  });
};

// The style of each row's cell, in order.
const rowStyles: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const styles: Array<string> = [];
  let at: number = html.indexOf(ROW_CELL);

  while (at !== -1) {
    const styleStart: number = at + '<td style="'.length;
    const styleEnd: number = html.indexOf('"', styleStart);

    styles.push(html.slice(styleStart, styleEnd));
    at = html.indexOf(ROW_CELL, styleEnd);
  }

  return styles;
};

describe("EpisodeMemberEmailList.toHtml", () => {
  test("an episode with no members is no list at all: the template leaves the section out", () => {
    expect(EpisodeMemberEmailList.toHtml([], ALERT_NUMBER_BADGE)).toBe("");
  });

  test("one member is one row with no divider: nothing to divide it from", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      items(1),
      ALERT_NUMBER_BADGE,
    );

    expect(rowStyles(html)).toEqual([
      "padding: 16px 20px; overflow-wrap: anywhere; word-break: break-word;",
    ]);
    expect(html).not.toContain(EPISODE_MEMBER_ROW_DIVIDER);
  });

  test.each([2, 3, 10])(
    "%d members draw a divider above every row but the first",
    (count: number) => {
      const styles: Array<string> = rowStyles(
        EpisodeMemberEmailList.toHtml(items(count), INCIDENT_NUMBER_BADGE),
      );

      expect(styles).toHaveLength(count);
      styles.forEach((style: string, index: number): void => {
        expect(style.includes(EPISODE_MEMBER_ROW_DIVIDER)).toBe(index > 0);
      });
    },
  );

  test("no row draws a line under itself: the box's own border ends the list", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      items(4),
      ALERT_NUMBER_BADGE,
    );

    expect(html).not.toContain("border-bottom");
    expect(html).toContain("border: 1px solid #e2e8f0;");
    expect(html.split("border: 1px solid #e2e8f0;")).toHaveLength(2);
  });

  test("the rows keep their members' order, each with its number, title, link and monitors", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      items(3),
      ALERT_NUMBER_BADGE,
    );

    let previous: number = -1;

    for (const member of items(3)) {
      const position: number = html.indexOf(`>${member.title}</a>`);

      expect(position).toBeGreaterThan(previous);
      expect(html).toContain(`>${member.number}</span>`);
      expect(html).toContain(`Monitor: ${member.monitorName}`);
      expect(html.split(`href="${member.link}"`)).toHaveLength(3);
      previous = position;
    }
  });

  test("a member with no monitors has no monitor line", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      [{ ...item(1), monitorName: "" }],
      ALERT_NUMBER_BADGE,
    );

    expect(html).not.toContain("Monitor:");
  });

  test.each([
    ["an alert", ALERT_NUMBER_BADGE, "#f1f5f9", "#111111"],
    ["an incident", INCIDENT_NUMBER_BADGE, "#fee2e2", "#991b1b"],
  ])(
    "%s's number keeps its badge colours",
    (
      _: string,
      badge: { backgroundColor: string; color: string },
      background: string,
      color: string,
    ) => {
      const html: string = EpisodeMemberEmailList.toHtml(items(2), badge);

      expect(
        html.split(`background-color: ${background}; color: ${color};`),
      ).toHaveLength(3);
    },
  );

  test("every value is escaped: a title, a monitor name, a number and a link are text", () => {
    const hostile: string = '<img src=x onerror="alert(1)">';
    const html: string = EpisodeMemberEmailList.toHtml(
      [
        {
          number: `#1${hostile}`,
          title: `Title ${hostile}`,
          link: `https://oneuptime.example.test/a?x="><script>`,
          monitorName: `Monitor ${hostile}`,
        },
      ],
      ALERT_NUMBER_BADGE,
    );

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain(
      "Title &lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(html).toContain(
      "Monitor: Monitor &lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(html).toContain(
      'href="https://oneuptime.example.test/a?x=&quot;&gt;&lt;script&gt;"',
    );
  });
});

/*
 * In the language of the person the email pages (fu-i18n-larger): the
 * monitor line and the View link are in their words, the values as
 * written; read from the right, the View link sits at the row's end on the
 * left. English reads byte for byte as before.
 */
describe("in the language of the person it pages", () => {
  test("German: the monitor line and the View link in German, the values as written", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      items(2),
      ALERT_NUMBER_BADGE,
      getServerTranslator("de"),
    );

    expect(html).toContain("Überwachung: Checkout API 1");
    expect(html).toContain("Überwachung: Checkout API 2");
    expect(html.split(">Ansehen →</a>")).toHaveLength(3);
    expect(html).toContain(">Checkout latency 1</a>");
    expect(html).toContain(">ALT-2</span>");
    expect(html).not.toContain("Monitor:");
    expect(html).not.toContain(">View →</a>");
    // Read from the left, as English: the badge's space on its right.
    expect(html).toContain("margin-right: 8px;");
    expect(html).toContain(
      "text-align: right; vertical-align: middle; padding-left: 8px;",
    );
  });

  test("a longer View word widens its cell, so it never wraps inside the word", () => {
    expect(getEpisodeMemberViewCellWidth("View →")).toBe(52);
    expect(getEpisodeMemberViewCellWidth("Se →")).toBe(52);
    expect(getEpisodeMemberViewCellWidth("Ansehen →")).toBe(79);
    expect(getEpisodeMemberViewCellWidth("Bekijken →")).toBe(88);

    const german: string = EpisodeMemberEmailList.toHtml(
      items(1),
      ALERT_NUMBER_BADGE,
      getServerTranslator("de"),
    );

    expect(german).toContain('<td width="79" style="text-align: right;');
    expect(german).not.toContain('width="52"');
  });

  test("Persian: the View link at the row's end on the left, the badge's space on its left", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      items(2),
      INCIDENT_NUMBER_BADGE,
      getServerTranslator("fa"),
    );

    expect(html).toContain(">مشاهده ←</a>");
    expect(html).toContain("margin-left: 8px;");
    expect(html).not.toContain("margin-right: 8px;");
    expect(html).toContain(
      "text-align: left; vertical-align: middle; padding-right: 8px;",
    );
    expect(html).not.toContain("text-align: right;");
  });

  test("a monitor's name is escaped once its line is worded, in any language", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      [{ ...item(1), monitorName: "<b>API</b>" }],
      ALERT_NUMBER_BADGE,
      getServerTranslator("ja"),
    );

    expect(html).toContain("モニター：&lt;b&gt;API&lt;/b&gt;");
    expect(html).not.toContain("<b>API");
  });

  test("every language OneUptime writes in has a View word of its own", () => {
    const LETTER: RegExp = /\p{L}/u;

    for (const code of READER_LANGUAGE_CODES) {
      const html: string = EpisodeMemberEmailList.toHtml(
        items(1),
        ALERT_NUMBER_BADGE,
        getServerTranslator(code),
      );
      const linkText: string =
        html
          .split('text-decoration: underline;">')
          .pop()
          ?.split("</a>")[0]
          ?.trim() || "";

      // A word before (or, read from the right, after) its arrow.
      expect([code, LETTER.test(linkText)]).toEqual([code, true]);
      expect([code, code === "en" || linkText !== "View →"]).toEqual([
        code,
        true,
      ]);
    }
  });

  test("English, named or not, is the list as it always was", () => {
    const html: string = EpisodeMemberEmailList.toHtml(
      items(3),
      ALERT_NUMBER_BADGE,
    );

    expect(
      EpisodeMemberEmailList.toHtml(
        items(3),
        ALERT_NUMBER_BADGE,
        getServerTranslator("en"),
      ),
    ).toBe(html);
    expect(html).toContain("Monitor: Checkout API 1");
    expect(html.split(">View →</a>")).toHaveLength(4);
    expect(html.split('<td width="52" style="text-align: right;')).toHaveLength(
      4,
    );
  });
});

/*
 * The page-out emails build their lists through it, and nothing in the
 * service draws a list row of its own any more.
 */
describe("UserNotificationRuleService", () => {
  const source: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../Server/Services/UserNotificationRuleService.ts",
    ),
    "utf8",
  );

  test("builds the alert and incident lists of an episode with EpisodeMemberEmailList", () => {
    expect(source.split("EpisodeMemberEmailList.toHtml(")).toHaveLength(3);
    expect(source).toContain("ALERT_NUMBER_BADGE,");
    expect(source).toContain("INCIDENT_NUMBER_BADGE,");
  });

  test("draws no divider under a row anywhere", () => {
    expect(source).not.toContain("border-bottom");
  });
});
