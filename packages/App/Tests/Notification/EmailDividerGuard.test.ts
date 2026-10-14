import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { beforeAll, describe, expect, test } from "@jest/globals";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
/*
 * The production initializer: registers concat, ifCond, ifNotCond, the
 * brand helpers and the detail card helpers on the global Handlebars.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  BRAND_VARIABLE_NAMES,
  getEmailBrandingVariables,
} from "../../FeatureSet/Notification/Utils/EmailBranding";
import {
  childElements,
  EmailElement,
  EmailMarkupTree,
  findElements,
  inlineStyle,
  readEmailMarkup,
  textOf,
} from "./Fixtures/EmailMarkupTree";
import {
  DetailCard,
  detailCards,
  dividerSides,
  dividersOnlyBetweenRows,
  drawsBox,
  MisplacedDivider,
  misplacedDividers,
} from "./Fixtures/EmailDividers";
import {
  templateVariables,
  VariableSet,
  variableSetsFor,
} from "./Fixtures/EmailTemplateVariables";

/*
 * NO EMAIL ENDS A CARD, A LIST OR A SECTION WITH A DIVIDER.
 *
 * The maintainer saw a divider sitting right above a card's bottom border
 * with nothing after it. It came from the detail cards, whose rows each
 * drew a divider under themselves, and the same habit was in the lists
 * some emails draw with {{#each}} (the incidents or alerts added to an
 * episode, the people a missed call rang, the monitors a probe affects),
 * in the alert and incident lists of the episode page-out emails, in the
 * tables Markdown renders into a description, and in the rollup's summary
 * card when it had no categories to show.
 *
 * This guard renders EVERY template in the catalog with every way its rows
 * can come and go (Fixtures/EmailTemplateVariables: every variable, none,
 * all empty, all but one, only one, and every list with no items, one and
 * three), each as MailService.render sends it - with the brand variables
 * of an installation that goes by OneUptime and of one renamed - and reads
 * each email as a client that keeps nothing but inline styles reads it. In
 * every one:
 *
 *   - every divider has something visible on each side of it, inside the
 *     box around it (Fixtures/EmailDividers.misplacedDividers): none sits
 *     on the edge of a card, a list or a section, and none is drawn above
 *     or under nothing;
 *   - every detail card draws a divider above each row but its first, and
 *     none under any row, and holds nothing but rows;
 *   - every row of a detail card shows something under its label: a row
 *     whose value is empty is left out, so no card ends - or holds - a
 *     label over empty space (an alert without a description has no
 *     "Description:" row).
 *
 * BlankTemplate is a customer's own HTML, sent as written, and is left out.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const catalog: Array<string> = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".hbs") && name !== EmailTemplateType.BlankTemplate;
  })
  .sort();

const readTemplate: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8");
};

/*
 * Variables a template's sender always sets, so no email is sent without
 * them: the rollup's notification count (EmailRollupRenderer.test.ts pins
 * that buildRollupEmail always writes it), which the summary card's
 * categories are divided from.
 */
const ALWAYS_SET: Record<string, Array<string>> = {
  [EmailTemplateType.NotificationRollup]: ["summaryCount"],
};

const variableSetsOf: (name: string) => Array<VariableSet> = (
  name: string,
): Array<VariableSet> => {
  return variableSetsFor(readTemplate(name), {
    leaveOut: BRAND_VARIABLE_NAMES,
    alwaysSet: ALWAYS_SET[name] || [],
  });
};

// The variables MailService.render adds to every email, for two installations.
const BRANDINGS: Array<[string, Record<string, unknown>]> = [
  ["OneUptime", { year: "2026", ...getEmailBrandingVariables(null) }],
  [
    "a renamed product",
    {
      year: "2026",
      ...getEmailBrandingVariables({
        productName: "Acme Ops",
        websiteUrl: "https://ops.acme.example.test",
      }),
    },
  ],
];

const compiled: Map<string, Handlebars.TemplateDelegate> = new Map<
  string,
  Handlebars.TemplateDelegate
>();

const render: (name: string, variables: Record<string, unknown>) => string = (
  name: string,
  variables: Record<string, unknown>,
): string => {
  let template: Handlebars.TemplateDelegate | undefined = compiled.get(name);

  if (!template) {
    template = Handlebars.compile(readTemplate(name));
    compiled.set(name, template);
  }

  return template(variables);
};

beforeAll(() => {
  // The production initializer's own partial reads are asynchronous.
  for (const file of fs.readdirSync(PARTIALS_DIR)) {
    if (file.endsWith(".hbs")) {
      Handlebars.registerPartial(
        file.slice(0, -4),
        fs.readFileSync(Path.join(PARTIALS_DIR, file), "utf8"),
      );
    }
  }
});

interface Finding {
  variables: string;
  problem: string;
}

// What is wrong with the dividers of one rendered email.
const findingsFor: (
  variableSet: VariableSet,
  html: string,
) => Array<Finding> = (
  variableSet: VariableSet,
  html: string,
): Array<Finding> => {
  const tree: EmailMarkupTree = readEmailMarkup(html);
  const findings: Array<Finding> = [];

  for (const divider of misplacedDividers(tree)) {
    findings.push({
      variables: variableSet.name,
      problem: `a ${divider.side} divider with nothing ${divider.nothing} it in its box: ${divider.element} in ${divider.box}`,
    });
  }

  detailCards(tree).forEach((card: DetailCard, index: number): void => {
    if (!dividersOnlyBetweenRows(card)) {
      findings.push({
        variables: variableSet.name,
        problem: `detail card ${index + 1} draws ${JSON.stringify(card.rows)}`,
      });
    }

    if (card.strayElements.length > 0) {
      findings.push({
        variables: variableSet.name,
        problem: `detail card ${index + 1} holds more than rows: ${card.strayElements.join(", ")}`,
      });
    }

    for (const row of card.rows) {
      if (!row.showsValue) {
        findings.push({
          variables: variableSet.name,
          problem: `detail card ${index + 1} shows the label "${row.label}" with nothing under it`,
        });
      }
    }
  });

  return findings;
};

describe("every email in the catalog", () => {
  test("the catalog is every template but the customer's own HTML", () => {
    expect(catalog.length).toBeGreaterThan(90);
    expect(catalog).toContain(EmailTemplateType.AcknowledgeIncident);
    expect(catalog).not.toContain(EmailTemplateType.BlankTemplate);
  });

  test.each(catalog)(
    "%s never puts a divider on the edge of a card, a list or a section",
    (name: string) => {
      const findings: Array<Finding> = [];

      for (const variableSet of variableSetsOf(name)) {
        for (const [branding, brandVariables] of BRANDINGS) {
          findings.push(
            ...findingsFor(
              {
                name: `${variableSet.name}, branded ${branding}`,
                variables: variableSet.variables,
              },
              render(name, { ...variableSet.variables, ...brandVariables }),
            ),
          );
        }
      }

      expect(findings).toEqual([]);
    },
  );

  test.each(
    catalog.filter((name: string): boolean => {
      return readTemplate(name).includes("{{> DetailBoxStart");
    }),
  )(
    "%s shows its detail card, rows and all, when every variable is set",
    (name: string) => {
      const everything: VariableSet = variableSetsOf(name)[0]!;
      const cards: Array<DetailCard> = detailCards(
        readEmailMarkup(render(name, everything.variables)),
      );

      expect(everything.name).toBe("every variable");
      expect(cards).toHaveLength(1);
      expect(cards[0]!.rows.length).toBeGreaterThan(0);
    },
  );

  /*
   * The variable sets reach the rows: a template whose card has a
   * conditional row shows a different number of rows for some of them.
   */
  test("the variable sets make the conditional rows of a card come and go", () => {
    const counts: Set<number> = new Set<number>();

    for (const variableSet of variableSetsOf(
      EmailTemplateType.IncidentOwnerResourceCreated,
    )) {
      for (const card of detailCards(
        readEmailMarkup(
          render(
            EmailTemplateType.IncidentOwnerResourceCreated,
            variableSet.variables,
          ),
        ),
      )) {
        counts.add(card.rows.length);
      }
    }

    expect(counts.size).toBeGreaterThan(1);
  });

  test("the variable sets give a template's lists no items, one and three", () => {
    const found: ReturnType<typeof templateVariables> = templateVariables(
      readTemplate(EmailTemplateType.SubscriberIncidentCreated),
    );
    const sizes: Set<number> = new Set<number>();

    expect([...found.lists.keys()]).toContain("customFieldRows");

    for (const variableSet of variableSetsOf(
      EmailTemplateType.SubscriberIncidentCreated,
    )) {
      const rows: unknown = variableSet.variables["customFieldRows"];

      if (Array.isArray(rows)) {
        sizes.add(rows.length);
      }
    }

    expect([...sizes].sort()).toEqual([0, 1, 3]);
  });
});

/*
 * The lists some templates draw with {{#each}}: one bordered box, a row
 * per item, a divider above every row but the first.
 */
describe.each([
  [
    EmailTemplateType.IncidentEpisodeOwnerIncidentAdded,
    "incidents",
    (index: number): Record<string, unknown> => {
      return {
        incidentNumber: `INC-${index}`,
        incidentTitle: `Incident ${index}`,
        incidentSeverity: "Critical",
        incidentViewLink: `https://oneuptime.example.test/incidents/${index}`,
        addedAt: "12:30 UTC",
      };
    },
  ],
  [
    EmailTemplateType.AlertEpisodeOwnerAlertAdded,
    "alerts",
    (index: number): Record<string, unknown> => {
      return {
        alertNumber: `ALT-${index}`,
        alertTitle: `Alert ${index}`,
        alertSeverity: "Warning",
        alertViewLink: `https://oneuptime.example.test/alerts/${index}`,
        addedAt: "12:30 UTC",
      };
    },
  ],
  [
    EmailTemplateType.MonitorsAffectedByProbeStatus,
    "monitors",
    (index: number): Record<string, unknown> => {
      return {
        monitorName: `Monitor ${index}`,
        monitorViewLink: `https://oneuptime.example.test/monitors/${index}`,
      };
    },
  ],
  [
    EmailTemplateType.IncomingCallPolicyOwnerMissedCall,
    "attempts",
    (index: number): Record<string, unknown> => {
      return {
        position: String(index),
        userName: `Person ${index}`,
        details: "Did not answer",
      };
    },
  ],
])(
  "%s lists its items with dividers only between them",
  (
    name: string,
    list: string,
    item: (index: number) => Record<string, unknown>,
  ) => {
    // Text only the first item's row shows.
    const firstItemText: string = String(
      Object.values(item(1)).find((value: unknown): boolean => {
        return typeof value === "string" && value.endsWith(" 1");
      }),
    );

    const listCells: (
      count: number,
    ) => Array<{ text: string; sides: Array<string> }> = (
      count: number,
    ): Array<{ text: string; sides: Array<string> }> => {
      const items: Array<Record<string, unknown>> = Array.from(
        { length: count },
        (_: unknown, index: number): Record<string, unknown> => {
          return item(index + 1);
        },
      );
      const tree: EmailMarkupTree = readEmailMarkup(
        render(name, {
          [list]: items,
          hasAttempts: "true",
          projectName: "Acme",
        }),
      );
      // The list's box: the innermost bordered table around the first item.
      const box: EmailElement | undefined = findElements(
        tree.root,
        (element: EmailElement): boolean => {
          return (
            element.name === "table" &&
            drawsBox(element) &&
            textOf(element).includes(firstItemText)
          );
        },
      ).pop();

      expect(box).toBeDefined();
      expect(misplacedDividers(tree)).toEqual([]);

      const body: EmailElement = childElements(box!).find(
        (element: EmailElement): boolean => {
          return element.name === "tbody";
        },
      )!;

      return childElements(body).map(
        (row: EmailElement): { text: string; sides: Array<string> } => {
          const cell: EmailElement = childElements(row)[0]!;

          return { text: textOf(cell), sides: dividerSides(cell) };
        },
      );
    };

    test.each([1, 2, 5])(
      "with %d item(s), a divider above every item but the first and none under any",
      (count: number) => {
        const cells: Array<{ text: string; sides: Array<string> }> =
          listCells(count);

        expect(cells).toHaveLength(count);
        cells.forEach(
          (
            cell: { text: string; sides: Array<string> },
            index: number,
          ): void => {
            expect(cell.text).toContain(` ${index + 1}`);
            expect(cell.sides).toEqual(index === 0 ? [] : ["top"]);
          },
        );
      },
    );
  },
);

describe("the rollup's summary card", () => {
  const summaryCard: (variables: Record<string, unknown>) => EmailElement = (
    variables: Record<string, unknown>,
  ): EmailElement => {
    const tree: EmailMarkupTree = readEmailMarkup(
      render(EmailTemplateType.NotificationRollup, {
        rollupTitle: "3 notifications from Acme",
        summaryCount: "3 notifications",
        summaryWindow: "09:30 UTC to 09:45 UTC",
        rows: [],
        ...variables,
      }),
    );

    expect(misplacedDividers(tree)).toEqual([]);

    // The innermost bordered table that shows the count.
    return findElements(tree.root, (element: EmailElement): boolean => {
      return (
        element.name === "table" &&
        drawsBox(element) &&
        textOf(element).includes("3 notifications")
      );
    }).pop()!;
  };

  test("draws its divider above the categories, with the categories after it", () => {
    const card: EmailElement = summaryCard({
      categoryCounts: "2 Incidents · 1 Monitors",
    });
    const dividers: Array<EmailElement> = findElements(
      card,
      (element: EmailElement): boolean => {
        return dividerSides(element).length > 0;
      },
    );

    expect(dividers).toHaveLength(1);
    expect(dividerSides(dividers[0]!)).toEqual(["top"]);
    expect(textOf(dividers[0]!)).toBe("2 Incidents · 1 Monitors");
  });

  test.each([undefined, ""])(
    "with no categories (%j), draws no divider: nothing would follow it",
    (categoryCounts: string | undefined) => {
      const card: EmailElement = summaryCard({ categoryCounts });

      expect(
        findElements(card, (element: EmailElement): boolean => {
          return dividerSides(element).length > 0;
        }),
      ).toEqual([]);
      expect(textOf(card)).toContain("3 notifications");
      expect(textOf(card)).toContain("09:30 UTC to 09:45 UTC");
    },
  );
});

/*
 * The guard's own reading: a guard that cannot see a misplaced divider
 * passes every email. These feed it small emails whose answer is known.
 */
describe("the guard sees a divider on the edge of its box", () => {
  const misplaced: (html: string) => Array<MisplacedDivider> = (
    html: string,
  ): Array<MisplacedDivider> => {
    return misplacedDividers(readEmailMarkup(html));
  };

  const BOX: string = 'style="border: 1px solid #e2e8f0;"';
  const TOP: string = 'style="border-top: 1px solid #e2e8f0;"';
  const BOTTOM: string = 'style="border-bottom: 1px solid #e2e8f0;"';

  test("a divider under the last thing in a box", () => {
    expect(
      misplaced(`<div ${BOX}><div>One</div><div ${BOTTOM}>Two</div></div>`),
    ).toEqual([
      expect.objectContaining({
        side: "bottom",
        nothing: "after",
      }) as unknown as MisplacedDivider,
    ]);
  });

  test("a divider above the first thing in a box", () => {
    expect(
      misplaced(`<div ${BOX}><div ${TOP}>One</div><div>Two</div></div>`),
    ).toEqual([
      expect.objectContaining({
        side: "top",
        nothing: "before",
      }) as unknown as MisplacedDivider,
    ]);
  });

  test("a divider above an empty last section: a line with nothing after it", () => {
    expect(
      misplaced(`<div ${BOX}><div>One</div><div ${TOP}> &nbsp; </div></div>`),
    ).toEqual([
      expect.objectContaining({
        side: "top",
        nothing: "after",
      }) as unknown as MisplacedDivider,
    ]);
  });

  test("a divider under an empty first section: a line with nothing before it", () => {
    expect(
      misplaced(`<div ${BOX}><div ${BOTTOM}></div><div>Two</div></div>`),
    ).toEqual([
      expect.objectContaining({
        side: "bottom",
        nothing: "before",
      }) as unknown as MisplacedDivider,
    ]);
  });

  test("a vertical divider between two cells, but not after the last one", () => {
    const RIGHT: string = 'style="border-right: 1px solid #e2e8f0;"';

    expect(
      misplaced(
        `<table ${BOX}><tr><td ${RIGHT}>1</td><td ${RIGHT}>2</td><td>3</td></tr></table>`,
      ),
    ).toEqual([]);
    expect(
      misplaced(
        `<table ${BOX}><tr><td ${RIGHT}>1</td><td ${RIGHT}>2</td></tr></table>`,
      ),
    ).toEqual([
      expect.objectContaining({
        side: "right",
        nothing: "after",
      }) as unknown as MisplacedDivider,
    ]);
  });

  test("not a divider between two things, drawn on either of them", () => {
    expect(
      misplaced(`<div ${BOX}><div ${BOTTOM}>One</div><div>Two</div></div>`),
    ).toEqual([]);
    expect(
      misplaced(`<div ${BOX}><div>One</div><div ${TOP}>Two</div></div>`),
    ).toEqual([]);
  });

  test("whitespace, &nbsp; and hidden text are not something to divide from", () => {
    expect(
      misplaced(
        `<div ${BOX}><div>One</div><div ${BOTTOM}>Two</div> &nbsp; <div style="display: none;">Preview</div></div>`,
      ),
    ).toHaveLength(1);
  });

  test("an image is", () => {
    expect(
      misplaced(
        `<div ${BOX}><div ${BOTTOM}>One</div><img src="https://example.test/a.png" alt=""></div>`,
      ),
    ).toEqual([]);
  });

  test("the box is the nearest one around the divider", () => {
    expect(
      misplaced(
        `<div ${BOX}><div ${BOX}><div>One</div><div ${BOTTOM}>Two</div></div><p>After the inner box</p></div>`,
      ),
    ).toHaveLength(1);
  });

  test("a table's rows are read as rows: a line under the last one sits on the table's border", () => {
    const table: (cellStyle: string) => string = (
      cellStyle: string,
    ): string => {
      return `<table ${BOX}><thead><tr><th>Head</th></tr></thead><tbody><tr><td ${cellStyle}>One</td></tr><tr><td ${cellStyle}>Two</td></tr></tbody></table>`;
    };

    expect(misplaced(table(BOTTOM))).toHaveLength(1);
    expect(misplaced(table(TOP))).toEqual([]);
  });

  test("a line that draws nothing is no divider", () => {
    expect(
      misplaced(
        `<div ${BOX}><div style="border-bottom: 0;">One</div><div style="border-top: none;">Two</div><div style="border-bottom: 1px none #000;">Three</div></div>`,
      ),
    ).toEqual([]);
  });
});

describe("the guard reads an email's markup as a browser would", () => {
  test("elements nest, void elements hold nothing, and a > in a quoted value stays in it", () => {
    const tree: EmailMarkupTree = readEmailMarkup(
      '<div class="a" title="x > y"><br><img src="i.png"/><span>Text</span></div>',
    );
    const div: EmailElement = childElements(tree.root)[0]!;

    expect(div.name).toBe("div");
    expect(div.attributes).toEqual({ class: "a", title: "x > y" });
    expect(
      childElements(div).map((child: EmailElement): string => {
        return child.name;
      }),
    ).toEqual(["br", "img", "span"]);
    expect(textOf(div)).toBe("Text");
    expect(tree.unmatchedEndTags).toEqual([]);
    expect(tree.unclosedElements).toEqual([]);
  });

  test("comments, the doctype and a <style> block are not text", () => {
    const tree: EmailMarkupTree = readEmailMarkup(
      "<!DOCTYPE html><html><head><style>td { border-bottom: 1px solid #000; }</style></head><body><!-- note --><p>Hi</p></body></html>",
    );

    expect(textOf(tree.root)).toBe("Hi");
  });

  test("an end tag closes the nearest open element of its name, and a stray one is noted", () => {
    const tree: EmailMarkupTree = readEmailMarkup(
      "<div><span>One</div></p><b>Two",
    );

    expect(tree.unmatchedEndTags).toEqual(["</p>"]);
    expect(tree.unclosedElements).toEqual(["b"]);
  });

  test("an inline style is read a declaration at a time, the last one winning", () => {
    const tree: EmailMarkupTree = readEmailMarkup(
      '<td style="padding: 14px 0; BORDER-TOP: 1px solid #e2e8f0;border-top:2px solid #000">x</td>',
    );
    const style: Map<string, string> = inlineStyle(
      childElements(tree.root)[0]!,
    );

    expect(style.get("padding")).toBe("14px 0");
    expect(style.get("border-top")).toBe("2px solid #000");
  });

  test.each(catalog)("%s closes every element it opens", (name: string) => {
    const everything: VariableSet = variableSetsOf(name)[0]!;
    const tree: EmailMarkupTree = readEmailMarkup(
      render(name, everything.variables),
    );

    expect(tree.unmatchedEndTags).toEqual([]);
    expect(tree.unclosedElements).toEqual([]);
  });
});
