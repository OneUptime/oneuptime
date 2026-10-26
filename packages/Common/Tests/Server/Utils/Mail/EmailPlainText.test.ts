import EmailPlainText, {
  MAX_EMAIL_TEXT_PART_LENGTH,
  decodeCharacterReferences,
} from "../../../../Server/Utils/Mail/EmailPlainText";
import { EMAIL_TRUNCATED_TEXT_NOTE } from "../../../../Server/Utils/Mail/EmailSize";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PLAIN-TEXT PART OF AN EMAIL (EmailPlainText): every email was HTML
 * alone - nothing for a text-only client, and SpamAssassin's MIME_HTML_ONLY
 * against it. The text is what a reader reads in the HTML, the way a screen
 * reader says it. App's EmailPlainTextParts holds every real template to it.
 */

const text: (html: string) => string = (html: string): string => {
  return EmailPlainText.fromHtml(html);
};

describe("EmailPlainText.fromHtml", () => {
  test("paragraphs and headings are blocks with a blank line between them", () => {
    expect(
      text(
        "<h1>Incident INC-42</h1><p>Checkout is down.</p><p>Since 10:00.</p>",
      ),
    ).toBe("Incident INC-42\n\nCheckout is down.\n\nSince 10:00.");
  });

  test("divs, rows and line breaks are lines of their own", () => {
    expect(text("<div>One</div><div>Two</div>Three<br>Four<br/>Five")).toBe(
      "One\nTwo\nThree\nFour\nFive",
    );
    expect(
      text("<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>"),
    ).toBe("A B\nC");
  });

  test("whitespace is one space, as a reader sees it, and a pre keeps its own", () => {
    expect(text("<p>  Checkout\n\n   is    down  </p>")).toBe(
      "Checkout is down",
    );
    expect(text("<p>Run:</p><pre>kubectl get pods\n  -n prod</pre>")).toBe(
      "Run:\n\nkubectl get pods\n  -n prod",
    );
  });

  test("a link is its words, then its address in brackets", () => {
    expect(
      text(
        '<p><a href="https://oneuptime.com/dashboard/x/incidents/1">View on Dashboard</a></p>',
      ),
    ).toBe("View on Dashboard (https://oneuptime.com/dashboard/x/incidents/1)");
  });

  test("a link whose words are its address says it once", () => {
    expect(
      text(
        '<a href="https://oneuptime.com/l/abc">https://oneuptime.com/l/abc</a>',
      ),
    ).toBe("https://oneuptime.com/l/abc");
  });

  test("a mail link gives its address; any other link only its words", () => {
    expect(text('<a href="mailto:ops@acme.example">Write to us</a>')).toBe(
      "Write to us (ops@acme.example)",
    );
    expect(text('<a href="#top">Back to top</a>')).toBe("Back to top");
    expect(text('<a href="cid:logo">Logo</a>')).toBe("Logo");
  });

  test("a link's address has its references decoded", () => {
    expect(text('<a href="https://x.example/a?b=1&amp;c=2">Open</a>')).toBe(
      "Open (https://x.example/a?b=1&c=2)",
    );
  });

  test("an image is its alt text; a decorative one, nothing - never its data", () => {
    expect(
      text(
        '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="Response time chart"> above</p><img src="x.png" alt="">',
      ),
    ).toBe("Response time chart above");
  });

  test("lists: each item a line, numbered in an ordered list", () => {
    expect(text("<ul><li>Rolled back</li><li>Paged DBA</li></ul>")).toBe(
      "- Rolled back\n- Paged DBA",
    );
    expect(text('<ol start="3"><li>Third</li><li>Fourth</li></ol>')).toBe(
      "3. Third\n4. Fourth",
    );
    expect(
      text("<ol><li>One<ul><li>Inner</li></ul></li><li>Two</li></ol>"),
    ).toBe("1. One\n\n- Inner\n\n2. Two");
  });

  test("what is never shown says nothing: the head, styles, scripts and comments", () => {
    expect(
      text(
        "<!DOCTYPE html><html><head><title>Mail title</title><style>p{color:red}</style></head><body><!-- note --><!--[if mso]><p>For Outlook only</p><![endif]--><script>var a='<p>';</script><p>Shown</p></body></html>",
      ),
    ).toBe("Shown");
  });

  test("hidden elements say nothing: display:none, hidden and aria-hidden", () => {
    expect(
      text(
        '<div style="DISPLAY : NONE; max-height: 0; mso-hide: all;">Preview line</div><p hidden>Hidden</p><table><tr><td><img alt="OneUptime"></td><td aria-hidden="true">OneUptime</td></tr></table><p>Body</p>',
      ),
    ).toBe("OneUptime\n\nBody");
  });

  test("what only Outlook hides, every other client shows, and so does the text", () => {
    expect(
      text(
        '<a href="https://x.example/ack" style="mso-hide: all;">Acknowledge</a><!--[if mso]><p>Acknowledge, for Outlook</p><![endif]-->',
      ),
    ).toBe("Acknowledge (https://x.example/ack)");
  });

  test("a detail card's label and value share a line", () => {
    expect(
      text(
        '<div class="st-DetailCard-field"><p class="st-DetailCard-label">Severity:</p><div class="st-DetailCard-value">Critical</div></div><div class="st-DetailCard-field"><p class="st-DetailCard-label">Current State:</p><div class="st-DetailCard-value"><p>Investigating</p></div></div><p>After</p>',
      ),
    ).toBe("Severity: Critical\nCurrent State: Investigating\n\nAfter");
  });

  test("a label written without its colon gets one; one ending in other punctuation keeps it", () => {
    const field: (label: string, value: string) => string = (
      label: string,
      value: string,
    ): string => {
      return `<div class="st-DetailCard-field"><p class="st-DetailCard-label">${label}</p><div class="st-DetailCard-value">${value}</div></div>`;
    };

    expect(
      text(
        field("Severity", "Major") +
          field("Affected Resources", "API<br/>Checkout") +
          field("Acknowledged?", "No") +
          field("Owner (team)", "SRE"),
      ),
    ).toBe(
      "Severity: Major\nAffected Resources: API\nCheckout\nAcknowledged? No\nOwner (team): SRE",
    );
    // A label with nothing to read adds nothing.
    expect(text(field('<span aria-hidden="true">x</span>', "Value"))).toBe(
      "Value",
    );
  });

  test("a data table is a row a line, its cells parted; a layout table's cells by a space", () => {
    expect(
      text(
        "<table><thead><tr><th>Resource</th><th>Uptime</th><th>Incidents</th></tr></thead><tbody><tr><td><div>API</div><span> &middot; 3 resources</span></td><td>99.95%</td><td>1</td></tr><tr><td><p>Checkout</p></td><td></td><td>0<br>today</td></tr></tbody></table><p>After</p>",
      ),
    ).toBe(
      "Resource | Uptime | Incidents\nAPI \u{00B7} 3 resources | 99.95% | 1\nCheckout | | 0 today\n\nAfter",
    );
    // A layout table around it changes nothing, and its own cells are spaced.
    expect(
      text(
        '<table><tr><td><img alt="Logo"></td><td><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></td></tr></table>',
      ),
    ).toBe("Logo\n\nA | B\n1 | 2");
  });

  test("references are decoded once, and unknown ones stay as written", () => {
    expect(
      text(
        "<p>A &amp;amp; B &lt;b&gt; &copy; 2026 &middot; &#39;x&#x27; &unknown; &#xFFFFFFF;</p>",
      ),
    ).toBe("A &amp; B <b> \u{00A9} 2026 \u{00B7} 'x' &unknown; &#xFFFFFFF;");
    expect(decodeCharacterReferences("&nbsp;&nbsp;x")).toBe(
      "\u{00A0}\u{00A0}x".replace(/\u{00A0}/gu, " "),
    );
  });

  test("markup a person wrote as text stays text", () => {
    expect(text("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
      "<script>alert(1)</script>",
    );
  });

  test("an end tag with nothing of its name open ends nothing", () => {
    // A browser reads it the same way: "OneTwo".
    expect(text("<p>One</span></td></table>Two</p>")).toBe("OneTwo");
  });

  test("an element left open ends with what it is inside", () => {
    expect(text("<div><p>One<div>Two</div>Three")).toBe("One\nTwo\nThree");
  });

  test("no spaces at the ends of lines, and at most one blank line in a row", () => {
    expect(text("<p>One </p><p></p><p> </p><div></div><p>Two</p>")).toBe(
      "One\n\nTwo",
    );
    expect(text("<p>One<br><br><br><br>Two</p><pre>a  \n\n\n\nb</pre>")).toBe(
      "One\n\nTwo\n\na\n\nb",
    );
  });

  test("nothing to read: an empty text", () => {
    expect(text("")).toBe("");
    expect(EmailPlainText.fromHtml(undefined)).toBe("");
    expect(EmailPlainText.fromHtml(null)).toBe("");
    expect(text('<img alt=""><div style="display:none">x</div>')).toBe("");
  });

  test("a text too long for an email is cut at a line and says so", () => {
    const html: string = Array.from(
      { length: 2000 },
      (_value: unknown, index: number): string => {
        return "<p>Line " + index + " of the incident's log, with words.</p>";
      },
    ).join("");

    const cut: string = EmailPlainText.fromHtml(html, 10000);

    expect(cut.length).toBeLessThanOrEqual(10000);
    expect(cut.endsWith("\n\n" + EMAIL_TRUNCATED_TEXT_NOTE)).toBe(true);
    // Cut between lines, never inside one.
    expect(cut.slice(0, -EMAIL_TRUNCATED_TEXT_NOTE.length).trimEnd()).toMatch(
      /with words\.$/,
    );
    expect(MAX_EMAIL_TEXT_PART_LENGTH).toBe(512 * 1024);
  });

  /*
   * An email's HTML can carry megabytes: a screenshot's base64 in an
   * attribute, a long log in a description. Each shape below is the worst
   * of one part of the walk - read in time in line with it.
   */
  test("its slowest shapes take well under two seconds", () => {
    const shapes: Array<string> = [
      // A screenshot's base64 in one attribute.
      '<p><img alt="Screenshot" src="data:image/png;base64,' +
        "A".repeat(3 * 1024 * 1024) +
        '"></p>',
      // Elements opened and never closed, then end tags that match none.
      "<div>".repeat(100000) + "</span>".repeat(100000),
      // Deeply nested lists, rows and links.
      '<ul><li><table><tr><td><a href="https://x.example">x'.repeat(20000),
      // A data table's row of many cells, blocks in each, and nested tables.
      "<table><tr><th>h</th></tr><tr>" +
        "<td><div><p>x</p></div><br></td>".repeat(100000) +
        "<table><tr><th>x".repeat(20000),
      // References that never end and ampersands everywhere.
      "&amp".repeat(100000) + "&".repeat(100000),
      // Words and spaces.
      "word ".repeat(200000),
    ];

    for (const shape of shapes) {
      const written: FastestRun<string> = fastestRun({
        run: (): string => {
          return EmailPlainText.fromHtml(shape);
        },
        limitInMs: 2000,
      });

      expect(written.inMs).toBeLessThan(2000);
    }
  });
});
