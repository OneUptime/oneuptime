import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import {
  DETAIL_CARD_DATA_KEY,
  detailCardDivider,
  detailCardEnd,
  detailCardStart,
  registerEmailDetailCardHelpers,
} from "../../FeatureSet/Notification/Utils/EmailDetailCard";
/*
 * The production initializer: registers concat, ifCond, ifNotCond, the
 * brand helpers and the detail card helpers on the global Handlebars.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";
import { EmailMarkupTree, readEmailMarkup } from "./Fixtures/EmailMarkupTree";
import {
  DetailCard,
  DetailCardRow,
  detailCards,
  misplacedDividers,
} from "./Fixtures/EmailDividers";

/*
 * A DETAIL CARD DRAWS ITS DIVIDERS BETWEEN ITS ROWS, NEVER AFTER THE LAST.
 *
 * The maintainer, looking at an email: "I see the divider near the bottom
 * border. Can we please remove it?" Every row of a detail card drew a
 * divider under itself, and the <style> rule that took the last one away
 * (.st-DetailCard-field:last-child) never reached a client that drops
 * pseudo-classes or the <style> block. So the last row's divider sat just
 * inside the card's bottom border with nothing after it.
 *
 * Now a row draws its divider ABOVE itself, inline, unless it is the first
 * row of its card (Utils/EmailDetailCard.ts). These tests render the real
 * partials and hold them to that: no divider before the first row, one
 * between every two rows, none after the last - however many rows a card
 * has, whichever of them a template's conditions leave out, and however
 * many cards an email has. EmailDividerGuard.test.ts holds every template
 * in the catalog to the same rule.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const DIVIDER: string = "border-top: 1px solid #e2e8f0;";

const partialNames: Array<string> = fs
  .readdirSync(PARTIALS_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".hbs");
  })
  .map((name: string): string => {
    return name.slice(0, -4);
  });

const readPartial: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(PARTIALS_DIR, `${name}.hbs`), "utf8");
};

const templateNames: Array<string> = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".hbs");
  })
  .sort();

const readTemplate: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8");
};

// An engine with every production partial and, unless told not to, the card helpers.
const createEngine: (withCardHelpers: boolean) => typeof Handlebars = (
  withCardHelpers: boolean,
): typeof Handlebars => {
  const engine: typeof Handlebars = Handlebars.create();

  for (const name of partialNames) {
    engine.registerPartial(name, readPartial(name));
  }

  if (withCardHelpers) {
    registerEmailDetailCardHelpers(engine);
  }

  return engine;
};

const engine: typeof Handlebars = createEngine(true);

const render: (source: string, variables?: Record<string, unknown>) => string =
  (source: string, variables: Record<string, unknown> = {}): string => {
    return engine.compile(source)(variables);
  };

const cardsOf: (html: string) => Array<DetailCard> = (
  html: string,
): Array<DetailCard> => {
  return detailCards(readEmailMarkup(html));
};

/*
 * What a card's rows draw: "Label" for a row with no divider, "|Label" for
 * one with a divider above it, "Label_" for one with a divider under it.
 */
const shapeOf: (card: DetailCard) => Array<string> = (
  card: DetailCard,
): Array<string> => {
  return card.rows.map((row: DetailCardRow): string => {
    return `${row.dividerAbove ? "|" : ""}${row.label}${row.dividerBelow ? "_" : ""}`;
  });
};

const field: (label: string) => string = (label: string): string => {
  return `{{> DetailBoxField title="${label}" plainText="Value of ${label}" }}\n`;
};

const card: (rows: string) => string = (rows: string): string => {
  return `{{> DetailBoxStart this }}\n${rows}{{> DetailBoxEnd this }}\n`;
};

const labels: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `Row ${index + 1}`;
  });
};

beforeAll(() => {
  // The production initializer's own partial reads are asynchronous.
  for (const name of partialNames) {
    Handlebars.registerPartial(name, readPartial(name));
  }
});

describe("a detail card's rows", () => {
  test("a card with no rows draws no divider at all", () => {
    const html: string = render(card(""));
    const cards: Array<DetailCard> = cardsOf(html);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.rows).toEqual([]);
    expect(html).not.toContain(DIVIDER);
    expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
  });

  test("a card with one row draws no divider: nothing to divide it from", () => {
    const html: string = render(card(field("Only")));

    expect(shapeOf(cardsOf(html)[0]!)).toEqual(["Only"]);
    expect(html).not.toContain(DIVIDER);
  });

  test.each([2, 3, 7])(
    "a card with %d rows draws a divider above every row but the first, and none under any",
    (count: number) => {
      const html: string = render(card(labels(count).map(field).join("")));

      expect(shapeOf(cardsOf(html)[0]!)).toEqual(
        labels(count).map((label: string, index: number): string => {
          return index === 0 ? label : `|${label}`;
        }),
      );
      expect(html.split(DIVIDER)).toHaveLength(count);
      expect(html).not.toContain("border-bottom");
      expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
    },
  );

  test("the divider is the row's own inline style, which every mail client keeps", () => {
    const html: string = render(card(field("First") + field("Second")));
    const rows: Array<string> = html
      .split('class="st-DetailCard-field"')
      .slice(1);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^ style="padding: 14px 0; font-family:/);
    expect(rows[1]).toMatch(
      /^ style="padding: 14px 0; border-top: 1px solid #e2e8f0; font-family:/,
    );
  });

  describe("rows a template's conditions leave out", () => {
    const source: string = card(
      `{{#if showFirst}}${field("First")}{{/if}}` +
        field("Middle") +
        `{{#if showLast}}${field("Last")}{{/if}}`,
    );

    test.each([
      [{ showFirst: true, showLast: true }, ["First", "|Middle", "|Last"]],
      [{ showFirst: false, showLast: true }, ["Middle", "|Last"]],
      [{ showFirst: true, showLast: false }, ["First", "|Middle"]],
      [{ showFirst: false, showLast: false }, ["Middle"]],
    ])(
      "with %j the first row shown draws no divider and the last draws none under it",
      (variables: Record<string, unknown>, expected: Array<string>) => {
        const html: string = render(source, variables);

        expect(shapeOf(cardsOf(html)[0]!)).toEqual(expected);
        expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
      },
    );

    test("a card whose every row is conditional starts at whichever row shows first", () => {
      const allConditional: string = card(
        ["A", "B", "C", "D"]
          .map((label: string): string => {
            return `{{#if show${label}}}${field(label)}{{/if}}`;
          })
          .join(""),
      );

      for (const shown of [
        ["A"],
        ["D"],
        ["B", "C"],
        ["A", "D"],
        ["B", "C", "D"],
        [],
      ]) {
        const variables: Record<string, unknown> = {};

        for (const label of shown) {
          variables[`show${label}`] = true;
        }

        expect(shapeOf(cardsOf(render(allConditional, variables))[0]!)).toEqual(
          shown.map((label: string, index: number): string => {
            return index === 0 ? label : `|${label}`;
          }),
        );
      }
    });
  });

  describe("rows a loop repeats", () => {
    const loop: string = `{{#each items}}{{> DetailBoxField title=this.label plainText=this.value }}\n{{/each}}`;

    test.each([0, 1, 2, 4])(
      "%d looped rows after a fixed row each draw a divider above them",
      (count: number) => {
        const html: string = render(card(field("Fixed") + loop), {
          items: labels(count).map((label: string) => {
            return { label: label, value: `Value of ${label}` };
          }),
        });

        expect(shapeOf(cardsOf(html)[0]!)).toEqual([
          "Fixed",
          ...labels(count).map((label: string): string => {
            return `|${label}`;
          }),
        ]);
      },
    );

    test.each([1, 2, 4])(
      "a card of %d looped rows only starts with no divider",
      (count: number) => {
        const html: string = render(card(loop + field("After")), {
          items: labels(count).map((label: string) => {
            return { label: label, value: `Value of ${label}` };
          }),
        });

        expect(shapeOf(cardsOf(html)[0]!)).toEqual([
          ...labels(count).map((label: string, index: number): string => {
            return index === 0 ? label : `|${label}`;
          }),
          "|After",
        ]);
      },
    );

    test("an incident's custom field rows continue the card's dividers", () => {
      const source: string = card(
        field("Incident Title:") + "{{> IncidentCustomFieldRows this }}",
      );
      const customFieldRows: Array<Record<string, string>> = [
        { title: "Region", plainText: "eu-west-1" },
        { title: "Runbook", renderedHtml: "<p>Restart the gateway.</p>" },
      ];

      expect(
        shapeOf(cardsOf(render(source, { customFieldRows }))[0]!),
      ).toEqual(["Incident Title:", "|Region", "|Runbook"]);
      expect(
        shapeOf(cardsOf(render(source, { customFieldRows: [] }))[0]!),
      ).toEqual(["Incident Title:"]);
    });
  });

  describe.each([
    ["StateTransition", "STATE CHANGE", "previousState", "currentState"],
    ["StatusTransition", "STATUS CHANGE", "previousStatus", "currentStatus"],
  ])(
    "%s is a row like any other",
    (partial: string, label: string, previous: string, current: string) => {
      const variables: Record<string, unknown> = {
        [previous]: "Investigating",
        [current]: "Resolved",
      };

      test("as the first row it draws no divider, and the row after it draws one", () => {
        const html: string = render(
          card(`{{> ${partial} this}}\n${field("Next")}`),
          variables,
        );

        expect(shapeOf(cardsOf(html)[0]!)).toEqual([label, "|Next"]);
        expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
      });

      test("after another row it draws its divider above itself", () => {
        const html: string = render(
          card(`${field("Before")}{{> ${partial} this}}\n`),
          variables,
        );

        expect(shapeOf(cardsOf(html)[0]!)).toEqual(["Before", `|${label}`]);
        expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
      });

      test("alone in its card it draws none", () => {
        const html: string = render(card(`{{> ${partial} this}}\n`), variables);

        expect(shapeOf(cardsOf(html)[0]!)).toEqual([label]);
        expect(html).not.toContain(DIVIDER);
      });
    },
  );
});

describe("each card counts its own rows", () => {
  test("a second card in the same email starts again with no divider", () => {
    const html: string = render(
      card(field("A1") + field("A2") + field("A3")) +
        card(field("B1") + field("B2")),
    );

    expect(cardsOf(html).map(shapeOf)).toEqual([
      ["A1", "|A2", "|A3"],
      ["B1", "|B2"],
    ]);
  });

  test("a card for every item of a list starts each one with no divider", () => {
    const html: string = render(
      `{{#each groups}}${card(
        `{{#each this.rows}}{{> DetailBoxField title=this plainText=this }}\n{{/each}}`,
      )}{{/each}}`,
      { groups: [{ rows: ["A1", "A2"] }, { rows: ["B1"] }, { rows: ["C1", "C2", "C3"] }] },
    );

    expect(cardsOf(html).map(shapeOf)).toEqual([
      ["A1", "|A2"],
      ["B1"],
      ["C1", "|C2", "|C3"],
    ]);
  });

  test("a row outside any card draws no divider, before a card or after one", () => {
    const html: string = render(
      field("Before") + card(field("In 1") + field("In 2")) + field("After"),
    );

    expect(html.split(DIVIDER)).toHaveLength(2);
    expect(cardsOf(html).map(shapeOf)).toEqual([["In 1", "|In 2"]]);
    expect(html.indexOf(DIVIDER)).toBeGreaterThan(html.indexOf("In 1"));
    expect(html.indexOf(DIVIDER)).toBeLessThan(html.indexOf("In 2"));
  });

  test("rendering an email again draws it the same: no count is carried from one render to the next", () => {
    const template: Handlebars.TemplateDelegate = engine.compile(
      card(field("A") + field("B") + field("C")),
    );
    const first: string = template({});

    expect(template({})).toBe(first);
    expect(template({})).toBe(first);
    expect(first.split(DIVIDER)).toHaveLength(3);
  });

  test("an email rendered in the middle of another's card leaves that card's count alone", () => {
    const inner: Handlebars.TemplateDelegate = engine.compile(
      card(field("Inner 1") + field("Inner 2")),
    );
    const nested: typeof Handlebars = createEngine(true);
    const renderedInside: Array<string> = [];

    nested.registerHelper("renderAnotherEmail", (): string => {
      renderedInside.push(inner({}));
      return "";
    });

    const html: string = nested.compile(
      card(field("Outer 1") + "{{renderAnotherEmail}}" + field("Outer 2")),
    )({});

    expect(cardsOf(html).map(shapeOf)).toEqual([["Outer 1", "|Outer 2"]]);
    expect(cardsOf(renderedInside[0]!).map(shapeOf)).toEqual([
      ["Inner 1", "|Inner 2"],
    ]);
  });
});

describe("the card helpers", () => {
  test("keep the open card in the render's own data frame, under one key", () => {
    const data: Record<string, unknown> = {};

    expect(detailCardStart({ data })).toBe("");
    expect(data[DETAIL_CARD_DATA_KEY]).toEqual({ rows: 0, isOpen: true });

    const block: Handlebars.HelperOptions = {
      data,
      fn: (): string => {
        return "DIVIDER";
      },
      inverse: (): string => {
        return "";
      },
      hash: {},
    } as unknown as Handlebars.HelperOptions;

    expect(detailCardDivider.call({}, block)).toBe("");
    expect(detailCardDivider.call({}, block)).toBe("DIVIDER");
    expect(detailCardDivider.call({}, block)).toBe("DIVIDER");
    expect(data[DETAIL_CARD_DATA_KEY]).toEqual({ rows: 3, isOpen: true });

    expect(detailCardEnd({ data })).toBe("");
    expect(data[DETAIL_CARD_DATA_KEY]).toEqual({ rows: 3, isOpen: false });
    expect(detailCardDivider.call({}, block)).toBe("");
  });

  test("do nothing, and never throw, for a render without a data frame", () => {
    const block: Handlebars.HelperOptions = {
      fn: (): string => {
        return "DIVIDER";
      },
    } as unknown as Handlebars.HelperOptions;

    expect(detailCardStart({})).toBe("");
    expect(detailCardStart(undefined)).toBe("");
    expect(detailCardDivider.call({}, block)).toBe("");
    expect(detailCardEnd({})).toBe("");

    /*
     * Its own engine: Handlebars keeps a partial compiled for the first
     * template that renders it, with that template's options.
     */
    const html: string = createEngine(true).compile(
      card(field("A") + field("B")),
      { data: false },
    )({});

    expect(html).toContain("Value of A");
    expect(html).not.toContain(DIVIDER);
  });

  test("an engine without them still renders every partial - just with no dividers", () => {
    const bare: typeof Handlebars = createEngine(false);
    const html: string = bare.compile(card(field("A") + field("B")))({});

    expect(html).toContain("Value of A");
    expect(html).toContain("Value of B");
    expect(html).not.toContain(DIVIDER);
  });

  test("are what the production initializer registers on the Handlebars MailService renders with", () => {
    expect(Handlebars.helpers["detailCardStart"]).toBe(detailCardStart);
    expect(Handlebars.helpers["detailCardDivider"]).toBe(detailCardDivider);
    expect(Handlebars.helpers["detailCardEnd"]).toBe(detailCardEnd);

    const html: string = Handlebars.compile(
      readTemplate(EmailTemplateType.AcknowledgeIncident),
    )({
      incidentTitle: "Checkout unavailable",
      projectName: "Acme",
      currentState: "Investigating",
      incidentSeverity: "Critical",
      resourcesAffected: "Checkout API",
      rootCause: "<p><strong>Probes in Agreement</strong>: US, EU</p>",
      incidentDescription: "<p>API: Status Page is currently offline.</p>",
    });
    const cards: Array<DetailCard> = cardsOf(html);

    expect(cards).toHaveLength(1);
    expect(shapeOf(cards[0]!)).toEqual([
      "Incident Title:",
      "|Current State:",
      "|Resources Affected:",
      "|Severity:",
      "|Root Cause:",
      "|Description:",
    ]);
    expect(misplacedDividers(readEmailMarkup(html))).toEqual([]);
  });
});

/*
 * The rule holds only while every row draws its divider through the card,
 * and every card opens and closes the count. These read the sources, so a
 * new row partial, a new card or a new CSS shortcut fails here first.
 */
describe("the sources keep dividers between rows", () => {
  const rowPartials: Array<string> = partialNames.filter(
    (name: string): boolean => {
      return readPartial(name).includes('class="st-DetailCard-field"');
    },
  );

  test("the row partials are the ones this suite renders", () => {
    expect(rowPartials.sort()).toEqual([
      "DetailBoxField",
      "StateTransition",
      "StatusTransition",
    ]);
  });

  test.each(
    partialNames.filter((name: string): boolean => {
      return readPartial(name).includes('class="st-DetailCard-field"');
    }),
  )(
    "%s draws its divider once, above itself, through detailCardDivider",
    (name: string) => {
      const source: string = readPartial(name);

      expect(source.split("{{#detailCardDivider}}")).toHaveLength(2);
      expect(source.split("{{/detailCardDivider}}")).toHaveLength(2);
      expect(source).toContain(
        `{{#detailCardDivider}} ${DIVIDER}{{/detailCardDivider}}`,
      );
      expect(source.split('class="st-DetailCard-field"')).toHaveLength(2);
      expect(source).not.toContain("border-bottom");
    },
  );

  test("DetailBoxStart opens the count inside the card, and DetailBoxEnd closes it", () => {
    const start: string = readPartial("DetailBoxStart");
    const end: string = readPartial("DetailBoxEnd");

    expect(start.indexOf("{{detailCardStart}}")).toBeGreaterThan(
      start.indexOf('class="st-DetailCard-content"'),
    );
    expect(start.split("{{detailCardStart}}")).toHaveLength(2);
    expect(end.indexOf("{{detailCardEnd}}")).toBe(0);
    expect(end.split("{{detailCardEnd}}")).toHaveLength(2);
  });

  test("only the card partials call the card helpers", () => {
    const calls: Array<string> = [
      "{{detailCardStart}}",
      "{{#detailCardDivider}}",
      "{{detailCardEnd}}",
    ];
    const callers: Array<string> = [
      ...partialNames.map((name: string): string => {
        return `Partials/${name}.hbs`;
      }),
      ...templateNames,
    ].filter((file: string): boolean => {
      const source: string = fs.readFileSync(
        Path.join(TEMPLATES_DIR, file),
        "utf8",
      );

      return calls.some((call: string): boolean => {
        return source.includes(call);
      });
    });

    expect(callers.sort()).toEqual([
      "Partials/DetailBoxEnd.hbs",
      "Partials/DetailBoxField.hbs",
      "Partials/DetailBoxStart.hbs",
      "Partials/StateTransition.hbs",
      "Partials/StatusTransition.hbs",
    ]);
  });

  /*
   * A card opened in one block and closed in another - or opened twice
   * before it closes - would count one card's rows as another's.
   */
  test.each(templateNames)(
    "%s opens and closes each card in the same block, never one inside another",
    (name: string) => {
      const problems: Array<string> = [];

      type Statement = { type: string; [key: string]: unknown };

      const visit: (program: unknown) => void = (program: unknown): void => {
        if (!program || typeof program !== "object") {
          return;
        }

        let open: boolean = false;

        for (const statement of (program as { body: Array<Statement> })
          .body) {
          if (statement.type === "PartialStatement") {
            const partial: string = String(
              (statement["name"] as Statement)["original"],
            );

            if (partial === "DetailBoxStart") {
              if (open) {
                problems.push("a card opens inside another");
              }

              open = true;
            }

            if (partial === "DetailBoxEnd") {
              if (!open) {
                problems.push("a card closes that this block did not open");
              }

              open = false;
            }
          }

          visit(statement["program"]);
          visit(statement["inverse"]);
        }

        if (open) {
          problems.push("a card this block opened is never closed in it");
        }
      };

      visit(Handlebars.parse(readTemplate(name)));

      expect(problems).toEqual([]);
    },
  );

  test("no template or partial draws a divider under something: every one is drawn above what it divides", () => {
    const drawingUnder: Array<string> = [
      ...partialNames.map((name: string): string => {
        return `Partials/${name}.hbs`;
      }),
      ...templateNames,
    ].filter((file: string): boolean => {
      return fs
        .readFileSync(Path.join(TEMPLATES_DIR, file), "utf8")
        .includes("border-bottom");
    });

    expect(drawingUnder).toEqual([]);
  });

  test("the <style> block neither draws nor hides a divider", () => {
    const style: string = readPartial("Style");

    expect(style).not.toContain("st-DetailCard-field");
    // A rich value's table draws its own lines, inline (Markdown.ts).
    expect(style).not.toContain("border-top");
    expect(style).not.toContain("border-bottom");

    for (const pseudoClass of [":last-child", ":first-child", ":nth-child"]) {
      for (const rule of style.split("}")) {
        if (rule.includes(pseudoClass)) {
          expect(rule).not.toContain("border");
        }
      }
    }
  });
});

describe("the email in the maintainer's screenshot", () => {
  /*
   * Its card ended "Probes in Agreement: US, EU", a divider, Description,
   * and a divider sitting on the card's bottom border. Read as a client
   * that keeps no <style> block reads it - the inline styles alone.
   */
  test("ends its card with the description, and no divider after it", () => {
    const html: string = Handlebars.compile(
      readTemplate(EmailTemplateType.AcknowledgeAlert),
    )({
      alertTitle: "API: Status Page is currently offline",
      projectName: "Acme",
      currentState: "Created",
      alertSeverity: "Critical",
      resourcesAffected: "API",
      rootCause:
        "<p><strong>Probes in Agreement</strong>: US, EU</p>",
      alertDescription: "<p>API: Status Page is currently offline.</p>",
    });
    const tree: EmailMarkupTree = readEmailMarkup(html);

    expect(detailCards(tree).map(shapeOf)).toEqual([
      [
        "Alert Title:",
        "|Current State:",
        "|Resources Affected:",
        "|Severity:",
        "|Root Cause:",
        "|Description:",
      ],
    ]);
    expect(misplacedDividers(tree)).toEqual([]);
  });
});
