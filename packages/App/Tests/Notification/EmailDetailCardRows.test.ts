import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
/*
 * The production initializer: registers concat, ifCond, ifNotCond, the
 * brand helpers and the detail card helpers on the global Handlebars.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  EmailElement,
  EmailMarkupTree,
  findElements,
  hasClass,
  inlineStyle,
  readEmailMarkup,
} from "./Fixtures/EmailMarkupTree";
import {
  DetailCard,
  DetailCardRow,
  detailCards,
  misplacedDividers,
} from "./Fixtures/EmailDividers";

/*
 * THE BOTTOM OF A DETAIL CARD: WHICH ROWS SHOW, AND THE SPACE UNDER EACH.
 *
 * With the divider under the last row gone (EmailDetailCardDividers.test.ts),
 * two things still kept the bottom of a card from looking finished:
 *
 *  1. A row with no value still drew its label. An alert, incident, monitor,
 *     probe, status page or maintenance without a description ended its card
 *     with a bare "Description:" over empty space, right above the card's
 *     bottom border. DetailBoxField now leaves such a row out, label and
 *     all, and StateTransition / StatusTransition do the same without a
 *     current state or status. The card's dividers stay between the rows
 *     that show.
 *
 *  2. A rich value's last block added its own bottom margin to the row's
 *     bottom padding. Gmail drops pseudo-classes, so .st-Rich p:last-child
 *     never took a paragraph's 12px away there, and a list's, a table's or a
 *     code block's margin was never taken away in any client. The screenshot's
 *     card had 32px under its last line and 18px above its first, and every
 *     divider after a rich value sat 27px below it but 14px above the next
 *     label. The space under a row is a margin now, and nothing between the
 *     value and that margin keeps them apart, so they collapse into one -
 *     CSS margin collapsing, which every browser-based mail client does - and
 *     a row's last line is 14px from what follows it, whatever it ends in.
 *     (Measured in Chromium in Gmail's, Apple Mail's and a style-less
 *     client's reading: 19px under the last line, 18px above the first,
 *     dividers 15px / 14px, in all three.)
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const readPartial: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(PARTIALS_DIR, `${name}.hbs`), "utf8");
};

const readTemplate: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8");
};

beforeAll(() => {
  // The production initializer's own partial reads are asynchronous.
  for (const file of fs.readdirSync(PARTIALS_DIR)) {
    if (file.endsWith(".hbs")) {
      Handlebars.registerPartial(
        file.slice(0, -4),
        readPartial(file.slice(0, -4)),
      );
    }
  }
});

const render: (
  source: string,
  variables?: Record<string, unknown>,
) => string = (
  source: string,
  variables: Record<string, unknown> = {},
): string => {
  return Handlebars.compile(source)(variables);
};

const card: (rows: string) => string = (rows: string): string => {
  return `{{> DetailBoxStart this }}\n${rows}{{> DetailBoxEnd this }}\n`;
};

// "Label" for a row with no divider, "|Label" for one with a divider above it.
const shapeOf: (detailCard: DetailCard) => Array<string> = (
  detailCard: DetailCard,
): Array<string> => {
  return detailCard.rows.map((row: DetailCardRow): string => {
    return `${row.dividerAbove ? "|" : ""}${row.label}${row.dividerBelow ? "_" : ""}`;
  });
};

const cardsOf: (html: string) => Array<DetailCard> = (
  html: string,
): Array<DetailCard> => {
  return detailCards(readEmailMarkup(html));
};

describe("a row with nothing to show is left out, label and all", () => {
  test.each(["text", "blockText", "plainText"])(
    "a %s row shows for a value, and draws nothing without one",
    (slot: string) => {
      const source: string = `{{> DetailBoxField title="Notes" ${slot}=value }}`;

      expect(render(source, { value: "Rolled back" })).toContain("Notes");

      for (const empty of ["", undefined, null, false]) {
        expect(render(source, { value: empty }).trim()).toBe("");
      }
    },
  );

  test("a row with its value in any one slot shows that value once", () => {
    for (const slot of ["text", "blockText", "plainText"]) {
      const html: string = render(
        `{{> DetailBoxField title="Notes" text=text blockText=blockText plainText=plainText }}`,
        { text: "", blockText: "", plainText: "", [slot]: "Rolled back" },
      );

      expect(html.split("Rolled back")).toHaveLength(2);
      expect(html.split('class="st-DetailCard-field"')).toHaveLength(2);
    }
  });

  describe("in a card, the dividers stay between the rows that show", () => {
    const source: string = card(
      ["A", "B", "C"]
        .map((label: string): string => {
          return `{{> DetailBoxField title="${label}" text=${label.toLowerCase()} }}\n`;
        })
        .join(""),
    );

    test.each([
      [
        ["A", "B", "C"],
        ["A", "|B", "|C"],
      ],
      [
        ["B", "C"],
        ["B", "|C"],
      ],
      [
        ["A", "C"],
        ["A", "|C"],
      ],
      [
        ["A", "B"],
        ["A", "|B"],
      ],
      [["C"], ["C"]],
      [[], []],
    ])(
      "with values for %j the card draws %j",
      (withValues: Array<string>, expected: Array<string>) => {
        const variables: Record<string, unknown> = { a: "", b: "", c: "" };

        for (const label of withValues) {
          variables[label.toLowerCase()] = `<p>Value of ${label}</p>`;
        }

        const html: string = render(source, variables);
        const cards: Array<DetailCard> = cardsOf(html);

        expect(cards).toHaveLength(1);
        expect(shapeOf(cards[0]!)).toEqual(expected);
        expect(
          cards[0]!.rows.every((row: DetailCardRow): boolean => {
            return row.showsValue;
          }),
        ).toBe(true);
        expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
      },
    );
  });

  test("an incident's custom field with no value is left out of the subscriber email's card", () => {
    const html: string = render(
      card(
        `{{> DetailBoxField title="Incident" plainText=incidentTitle }}\n{{> IncidentCustomFieldRows this }}`,
      ),
      {
        incidentTitle: "Checkout unavailable",
        customFieldRows: [
          { title: "Region", plainText: "eu-west-1" },
          { title: "Owner", plainText: "" },
          { title: "Runbook", renderedHtml: "<p>Restart the gateway.</p>" },
          { title: "Ticket", renderedHtml: "", plainText: "" },
        ],
      },
    );

    expect(shapeOf(cardsOf(html)[0]!)).toEqual([
      "Incident",
      "|Region",
      "|Runbook",
    ]);
    expect(html).not.toContain("Owner");
    expect(html).not.toContain("Ticket");
  });

  describe.each([
    ["StateTransition", "STATE CHANGE", "previousState", "currentState"],
    ["StatusTransition", "STATUS CHANGE", "previousStatus", "currentStatus"],
  ])(
    "%s",
    (partial: string, label: string, previous: string, current: string) => {
      const source: string = card(
        `{{> ${partial} this}}\n{{> DetailBoxField title="Next" plainText="Next value" }}\n`,
      );

      test("shows the change when there is a current one", () => {
        const html: string = render(source, {
          [previous]: "Investigating",
          [current]: "Resolved",
        });

        expect(shapeOf(cardsOf(html)[0]!)).toEqual([label, "|Next"]);
        expect(cardsOf(html)[0]!.rows[0]!.showsValue).toBe(true);
      });

      test.each([
        ["no current one", { [previous]: "Investigating", [current]: "" }],
        ["nothing at all", {}],
      ])(
        "is left out with %s, and the next row starts the card",
        (_name: string, variables: Record<string, unknown>) => {
          const html: string = render(source, variables);

          expect(html).not.toContain(label);
          expect(shapeOf(cardsOf(html)[0]!)).toEqual(["Next"]);
        },
      );
    },
  );

  test("the screenshot's email, for an alert without a description, ends its card with the root cause", () => {
    const html: string = render(
      readTemplate(EmailTemplateType.AcknowledgeAlert),
      {
        alertNumber: "ALT-42",
        alertTitle: "API: Status Page is currently offline",
        projectName: "Acme",
        currentState: "Created",
        alertSeverity: "Critical",
        resourcesAffected: "Status Page API",
        rootCause: "<p><strong>Probes in Agreement</strong>: US, EU</p>",
        alertDescription: "",
      },
    );
    const tree: EmailMarkupTree = readEmailMarkup(html);

    expect(detailCards(tree).map(shapeOf)).toEqual([
      [
        "Alert Title:",
        "|Current State:",
        "|Resources Affected:",
        "|Severity:",
        "|Root Cause:",
      ],
    ]);
    expect(html).not.toContain("Description:");
    expect(misplacedDividers(tree)).toEqual([]);
  });

  test("a monitor's status email without a description ends its card with when the status changed", () => {
    const html: string = render(
      readTemplate(EmailTemplateType.MonitorOwnerStatusChanged),
      {
        monitorName: "Status Page API",
        previousStatus: "Operational",
        currentStatus: "Offline",
        rootCause: "<p><strong>Probes in Agreement</strong>: US, EU</p>",
        statusChangedAt: "14 Oct 2026, 10:30 UTC",
        monitorDescription: "",
      },
    );
    const rows: Array<string> = shapeOf(cardsOf(html)[0]!);

    expect(rows[rows.length - 1]).toBe("|Status changed at:");
    expect(rows).not.toContain("|Description:");
  });
});

// One side of a padding or margin, from its longhand or its shorthand.
const boxSide: (
  style: Map<string, string>,
  property: "padding" | "margin",
  side: "top" | "bottom",
) => string = (
  style: Map<string, string>,
  property: "padding" | "margin",
  side: "top" | "bottom",
): string => {
  const longhand: string | undefined = style.get(`${property}-${side}`);

  if (longhand !== undefined) {
    return longhand;
  }

  const values: Array<string> = (style.get(property) || "0")
    .split(" ")
    .filter((value: string): boolean => {
      return value.length > 0;
    });

  // 1 value: all sides; 2: vertical, horizontal; 3 or 4: top, ..., bottom.
  if (side === "top" || values.length < 3) {
    return values[0]!;
  }

  return values[2]!;
};

const pixels: (value: string) => number = (value: string): number => {
  return value === "0" ? 0 : parseFloat(value);
};

/*
 * Rows of every kind a DetailBoxField draws, in one card: plain, inline HTML
 * and Markdown blocks.
 */
const richCard: () => string = (): string => {
  return render(
    card(
      [
        `{{> DetailBoxField title="Title" plainText=title }}`,
        `{{> DetailBoxField title="Started" text=startedAt }}`,
        `{{> DetailBoxField title="Root Cause" blockText=rootCause }}`,
      ].join("\n"),
    ),
    {
      title: "Checkout unavailable",
      startedAt: "10:30 UTC<br/>11:30 BST",
      rootCause:
        '<p>One</p><ul style="margin:6px 0 12px 0;"><li style="margin:0 0 4px;">Two</li></ul>',
    },
  );
};

const rowsOf: (html: string) => Array<EmailElement> = (
  html: string,
): Array<EmailElement> => {
  return findElements(
    readEmailMarkup(html).root,
    (element: EmailElement): boolean => {
      return hasClass(element, "st-DetailCard-field");
    },
  );
};

describe("the space under a row is one its value's last block collapses into", () => {
  test("a row keeps its 14px under it as a margin, with no padding or border under it", () => {
    const rows: Array<EmailElement> = rowsOf(richCard());

    expect(rows).toHaveLength(3);

    for (const row of rows) {
      const style: Map<string, string> = inlineStyle(row);

      expect(boxSide(style, "padding", "top")).toBe("14px");
      expect(pixels(boxSide(style, "padding", "bottom"))).toBe(0);
      expect(boxSide(style, "margin", "bottom")).toBe("14px");
      expect(pixels(boxSide(style, "margin", "top"))).toBe(0);
      expect(style.has("border-bottom")).toBe(false);
      expect(style.has("border")).toBe(false);
    }
  });

  test("nothing between a value and its row's margin keeps the two apart", () => {
    const values: Array<EmailElement> = findElements(
      readEmailMarkup(richCard()).root,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-value");
      },
    );

    expect(values).toHaveLength(3);

    for (const value of values) {
      const style: Map<string, string> = inlineStyle(value);

      expect(style.get("margin")).toBe("0");

      // Each of these would hold the value's last margin inside the row.
      for (const property of [
        "padding",
        "padding-bottom",
        "border",
        "border-bottom",
        "overflow",
        "display",
        "float",
        "position",
        "height",
        "min-height",
      ]) {
        expect(style.has(property)).toBe(false);
      }
    }
  });

  test("a card's first line is as far from its top border as its last line is from its bottom border", () => {
    const start: EmailElement = findElements(
      readEmailMarkup(render(card(""))).root,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-content");
      },
    )[0]!;
    const content: Map<string, string> = inlineStyle(start);
    const row: Map<string, string> = inlineStyle(rowsOf(richCard())[0]!);

    expect(boxSide(content, "padding", "top")).toBe(
      boxSide(content, "padding", "bottom"),
    );
    expect(boxSide(row, "padding", "top")).toBe(
      boxSide(row, "margin", "bottom"),
    );
  });

  /*
   * Margins that touch collapse into the LARGER one: a block with a bottom
   * margin over 14px would still push the next divider, or the card's bottom
   * border, further away. None of the blocks an email's Markdown draws has
   * one, inline or in the email's styles.
   */
  test("no block an email's Markdown draws has a bottom margin larger than a row's", async () => {
    const html: string = await Markdown.convertToHTML(
      [
        "Rolled back the deploy.",
        "",
        "1. checkout-7f9c",
        "   - Restarts: 7",
        "",
        "| Timestamp | Value |",
        "| --- | ---: |",
        "| 10:30 UTC | 1.07 GB |",
        "",
        "> Customers saw failed payments.",
      ].join("\n"),
      MarkdownContentType.Email,
    );
    const blocks: Array<EmailElement> = findElements(
      readEmailMarkup(html).root,
      (element: EmailElement): boolean => {
        return inlineStyle(element).has("margin");
      },
    );

    expect(
      blocks.map((block: EmailElement): string => {
        return block.name;
      }),
    ).toEqual(expect.arrayContaining(["ol", "ul", "li", "table"]));

    for (const block of blocks) {
      expect(
        pixels(boxSide(inlineStyle(block), "margin", "bottom")),
      ).toBeLessThanOrEqual(14);
    }

    // The email's styles as sent, without the partial's own comments.
    const richRules: Array<string> = [];

    for (const rule of render("{{> Style}}").split("}")) {
      if (rule.includes(".st-Rich") && rule.includes("margin")) {
        const declaration: string = rule.slice(rule.indexOf("{") + 1);

        richRules.push(rule.slice(0, rule.indexOf("{")).trim());
        expect(
          pixels(
            boxSide(
              inlineStyle({
                attributes: { style: declaration },
              } as unknown as EmailElement),
              "margin",
              "bottom",
            ),
          ),
        ).toBeLessThanOrEqual(14);
      }
    }

    // A paragraph's and a quote's margins come from these rules.
    expect(richRules).toEqual(
      expect.arrayContaining([".st-Rich p", ".st-Rich blockquote"]),
    );
  });
});
