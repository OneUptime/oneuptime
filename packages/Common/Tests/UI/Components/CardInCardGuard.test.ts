import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  CardNesting,
  CardNestingSource,
  CardSectionsChild,
  ImportResolver,
  listCardDrawingModules,
  makeImportResolver,
  scanCardNesting,
  scanCardSectionsChildren,
} from "../../Helpers/CardNestingScan";

/*
 * No card inside a card, anywhere in the product.
 *
 * "If you look at More Settings, it looks like a card inside of a card. Can
 * you please fix that UI? More Settings should look like one card instead of
 * a card inside of a card, and it should have dividers. ... Please do this
 * everywhere in the project." - the maintainer.
 *
 * A card that holds cards holds them in CardSections (or is a page's More
 * settings, AdvancedPageSection, which does): they are drawn as its
 * sections, a divider above each. Anywhere else a whole card - Card, a
 * detail card, a table's or list's card, a switch card, any component that
 * draws one - inside another card, a fold, a dialog or a box built by hand
 * with a card's frame fails here. See Tests/Helpers/CardNestingScan.ts for
 * what is read, and why a side panel is not a card.
 *
 * Tiles, option cards and the items of a list (a runbook's steps, a form's
 * questions) are not whole cards: they have no card header and are the
 * content of the card they are in.
 *
 * The Common Test job deletes ee/ before it runs; the Enterprise Edition
 * Test workflow (test.ee.yaml) runs this guard again with ee/ present, which
 * is where the enterprise dashboards are held to it.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

/*
 * Whole cards that the scan finds inside another one but that are not drawn
 * as a card there, each with the reason. A new nesting fails the guard until
 * it is drawn as a section (CardSections) or listed here; an entry that no
 * longer matches fails too.
 */
interface CardLeftInside {
  file: string;
  card: string;
  container: string;
  reason: string;
}

const NOT_A_CARD_WHERE_IT_IS: Array<CardLeftInside> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/ScheduleSubscribeCard.tsx",
    card: "PersonalCalendarFeedCard",
    container: "Card",
    reason:
      "Its schedule variant (PersonalCalendarFeedVariant.Schedule) draws a plain block with a line of text, not a card: it returns before the card the scan reads as the component's own.",
  },
];

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

interface ProductSources {
  sources: Array<CardNestingSource>;
  resolveImport: ImportResolver;
}

let cachedSources: ProductSources | null = null;

function productSources(): ProductSources {
  if (cachedSources) {
    return cachedSources;
  }

  const sources: Array<CardNestingSource> = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .map((file: string): CardNestingSource => {
      return { file: relative(file), text: fs.readFileSync(file, "utf8") };
    });

  cachedSources = {
    sources,
    resolveImport: makeImportResolver(
      new Set<string>(
        sources.map((source: CardNestingSource): string => {
          return source.file;
        }),
      ),
    ),
  };

  return cachedSources;
}

let cachedNestings: Array<CardNesting> | null = null;

function productNestings(): Array<CardNesting> {
  if (!cachedNestings) {
    const product: ProductSources = productSources();
    cachedNestings = scanCardNesting(product.sources, product.resolveImport);
  }

  return cachedNestings;
}

function isListed(nesting: CardNesting): boolean {
  return NOT_A_CARD_WHERE_IT_IS.some((entry: CardLeftInside): boolean => {
    return (
      entry.file === nesting.file &&
      entry.card === nesting.card &&
      entry.container === nesting.container
    );
  });
}

describe("no card inside a card, anywhere in the product", () => {
  test("the scan reads every frontend and knows their cards", () => {
    const product: ProductSources = productSources();
    const cardModules: Array<string> = listCardDrawingModules(
      product.sources,
      product.resolveImport,
    );

    // Every frontend's source, not a handful of files.
    expect(product.sources.length).toBeGreaterThan(1000);

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/ApiKey/ApiKeyPermissionTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/AISettings/AIInvestigationRulesTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/StatusPage/SearchEngineIndexingCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation.tsx",
      "packages/Common/UI/Components/ModelSwitch/ModelSwitchCard.tsx",
      "packages/Common/UI/Components/ResetObjectID/ResetObjectID.tsx",
    ]) {
      expect([file, cardModules.includes(file)]).toEqual([file, true]);
    }
  });

  test("no whole card is drawn inside another card, a fold, a dialog or a hand-built card frame", () => {
    const nested: Array<string> = productNestings()
      .filter((nesting: CardNesting): boolean => {
        return !isListed(nesting);
      })
      .map((nesting: CardNesting): string => {
        return `${nesting.file}:${nesting.line} <${nesting.card}> inside <${nesting.container}> (line ${nesting.containerLine})`;
      });

    /*
     * Hold the cards in <CardSections> (Common/UI/Components/Card) so they
     * are drawn as sections of the card around them - or, for a page's
     * rarely needed cards, in <AdvancedPageSection>.
     */
    expect(nested).toEqual([]);
  });

  test("each card listed as not a card where it is is still found there, once", () => {
    const stale: Array<string> = NOT_A_CARD_WHERE_IT_IS.filter(
      (entry: CardLeftInside): boolean => {
        // Only files in this checkout: CI's Common job deletes ee/.
        return fs.existsSync(path.join(REPOSITORY_ROOT, entry.file));
      },
    )
      .filter((entry: CardLeftInside): boolean => {
        return (
          productNestings().filter((nesting: CardNesting): boolean => {
            return (
              nesting.file === entry.file &&
              nesting.card === entry.card &&
              nesting.container === entry.container
            );
          }).length !== 1
        );
      })
      .map((entry: CardLeftInside): string => {
        return `${entry.file}: <${entry.card}> inside <${entry.container}>`;
      });

    expect(stale).toEqual([]);

    for (const entry of NOT_A_CARD_WHERE_IT_IS) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

/*
 * What a page folds under More settings, or a card holds in CardSections,
 * is drawn as a section with a divider above it only when it is a whole
 * card: a bare element in there would sit in the card with no divider and
 * no padding.
 */
describe("what More settings and CardSections hold", () => {
  const MORE_SETTINGS_PAGES: Array<string> = [
    "packages/App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Settings/APIKeyView.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Teams/View/Permissions.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/AuthenticationSettings.tsx",
    "packages/App/FeatureSet/Dashboard/src/Pages/Dashboards/View/Sharing.tsx",
  ];

  function sectionsChildren(): Array<CardSectionsChild> {
    const product: ProductSources = productSources();

    return scanCardSectionsChildren(product.sources, product.resolveImport);
  }

  test("every page that folds cards under More settings is read", () => {
    const files: Set<string> = new Set<string>(
      sectionsChildren().map((child: CardSectionsChild): string => {
        return child.file;
      }),
    );

    for (const page of MORE_SETTINGS_PAGES) {
      expect([page, files.has(page)]).toEqual([page, true]);
    }
  });

  test("everything in them is a whole card, so each is drawn as a section with a divider", () => {
    const notCards: Array<string> = sectionsChildren()
      .filter((child: CardSectionsChild): boolean => {
        return !child.isCard;
      })
      .map((child: CardSectionsChild): string => {
        return `${child.file}:${child.line} <${child.element}>`;
      });

    expect(notCards).toEqual([]);
  });
});

/*
 * A card's body drawn edge to edge under a rule across the card takes its
 * class from useCardRuledBodyClassName - or useCardRuledListClassName for a
 * list of ruled rows - (Card/CardSurface.ts), so in a section of a card the
 * rule goes: there it would read as the divider of a section without a
 * title.
 */
describe("ruled edge-to-edge card bodies", () => {
  const RULED_BODY_TOKENS: Array<string> = [
    "-mx-5",
    "md:-mx-6",
    "-mb-6",
    "border-t",
  ];

  const HAND_RULED_ON_PURPOSE: Record<string, string> = {
    "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Resources.tsx":
      "The status page's Resources workspace: two panes edge to edge that are the page itself, never a section of another card.",
    "packages/App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldSettingsCard.tsx":
      "Incidents -> Settings -> Custom Fields' list of fields, a page card whose rows are ruled a lighter grey than its header rule, like the tables beside it; never a section of another card.",
  };

  function stringsIn(text: string, file: string): Array<string> {
    const source: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const found: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        found.push(node.text);
      } else if (ts.isTemplateExpression(node)) {
        found.push(
          [
            node.head.text,
            ...node.templateSpans.map((span: ts.TemplateSpan): string => {
              return span.literal.text;
            }),
          ].join(" "),
        );
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    return found;
  }

  function isRuledBody(value: string): boolean {
    const tokens: Array<string> = value.split(/\s+/);

    return RULED_BODY_TOKENS.every((token: string): boolean => {
      return tokens.includes(token);
    });
  }

  test("only CardSurface spells one out", () => {
    const spelled: Array<string> = productSources()
      .sources.filter((source: CardNestingSource): boolean => {
        return !HAND_RULED_ON_PURPOSE[source.file];
      })
      .filter((source: CardNestingSource): boolean => {
        return stringsIn(source.text, source.file).some(isRuledBody);
      })
      .map((source: CardNestingSource): string => {
        return source.file;
      });

    expect(spelled).toEqual([]);
  });

  test("the bodies ruled by hand on purpose still are", () => {
    for (const file of Object.keys(HAND_RULED_ON_PURPOSE)) {
      const full: string = path.join(REPOSITORY_ROOT, file);

      expect([
        file,
        stringsIn(fs.readFileSync(full, "utf8"), file).some(isRuledBody),
      ]).toEqual([file, true]);
    }
  });

  test("the classes they come from are ruled on a page and not in a section", () => {
    const surface: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "Common",
        "UI",
        "Components",
        "Card",
        "CardSurface.ts",
      ),
      "utf8",
    );
    const ruled: Array<string> = stringsIn(surface, "CardSurface.ts").filter(
      isRuledBody,
    );

    // A body, and a list of ruled rows: each ruled only on a page.
    expect(ruled).toEqual([
      "-mx-5 -mb-6 border-t border-gray-200 md:-mx-6",
      "-mx-5 -mb-6 divide-y divide-gray-200 border-t border-gray-200 md:-mx-6",
    ]);
  });
});

/*
 * The scan itself, on modules written for it.
 */
describe("the card nesting scan", () => {
  function scan(files: Record<string, string>): Array<string> {
    const sources: Array<CardNestingSource> = Object.entries(files).map(
      ([file, text]: [string, string]): CardNestingSource => {
        return { file, text };
      },
    );
    const resolveImport: ImportResolver = makeImportResolver(
      new Set<string>(Object.keys(files)),
    );

    return scanCardNesting(sources, resolveImport).map(
      (nesting: CardNesting): string => {
        return `${nesting.card} in ${nesting.container}`;
      },
    );
  }

  function page(body: string, imports: string = ""): Record<string, string> {
    return {
      "app/Page.tsx": `${imports}
const Page = () => {
  return (
    ${body}
  );
};
export default Page;
`,
    };
  }

  test("finds a card in a card", () => {
    expect(
      scan(page(`<Card title="Outer"><Card title="Inner" /></Card>`)),
    ).toEqual(["Card in Card"]);
  });

  test("finds a detail card or a table's card in a card", () => {
    expect(
      scan(
        page(`<Card title="Outer">
      <CardModelDetail name="a" cardProps={{}} modelDetailProps={{}} />
      <ModelTable cardProps={{ title: "Rules" }} />
    </Card>`),
      ),
    ).toEqual(["CardModelDetail in Card", "ModelTable in Card"]);
  });

  test("finds a card in a fold drawn as a card, in a form's fold, in a collapsible section and in a dialog", () => {
    expect(
      scan(
        page(`<div>
      <FoldedSection title="More" isElevated={true}><Card title="A" /></FoldedSection>
      <FoldedSection title="More fields"><Card title="B" /></FoldedSection>
      <CollapsibleSection title="Guide"><Card title="C" /></CollapsibleSection>
      <Modal title="Edit"><Card title="D" /></Modal>
    </div>`),
      ),
    ).toEqual([
      "Card in FoldedSection",
      "Card in FoldedSection",
      "Card in CollapsibleSection",
      "Card in Modal",
    ]);
  });

  test("finds a card in a box built by hand with a card's frame", () => {
    expect(
      scan(
        page(
          `<div className="rounded-xl border border-gray-200 bg-white shadow-sm"><Card title="Inner" /></div>`,
        ),
      ),
    ).toEqual(["Card in div"]);
  });

  test("finds a card handed to a card as a prop", () => {
    expect(
      scan(
        page(`<Card title="Outer" rightElement={<Card title="Inner" />} />`),
      ),
    ).toEqual(["Card in Card"]);
  });

  test("finds a component that draws a card, inside a card", () => {
    expect(
      scan({
        "app/Rules.tsx": `
const Rules = () => {
  if (!ready) { return <div />; }
  return <ModelTable cardProps={{ title: "Rules" }} />;
};
export default Rules;
`,
        ...page(
          `<Card title="Outer"><Rules /></Card>`,
          `import Rules from "./Rules";`,
        ),
      }),
    ).toEqual(["Rules in Card"]);
  });

  test("finds a card in a component that draws its children inside a card", () => {
    expect(
      scan({
        "app/Frame.tsx": `
const Frame = (props) => {
  return <Card title="Frame">{props.children}</Card>;
};
export default Frame;
`,
        ...page(
          `<Frame><Card title="Inner" /></Frame>`,
          `import Frame from "./Frame";`,
        ),
      }),
    ).toEqual(["Card in Frame"]);
  });

  test("leaves alone cards drawn as sections: in CardSections, or folded under More settings", () => {
    expect(
      scan(
        page(`<div>
      <FoldedSection title="Guide" isElevated={true} isBodyFlush={true}>
        <CardSections><Card title="A" /><ModelTable cardProps={{}} /></CardSections>
      </FoldedSection>
      <AdvancedPageSection><Card title="B" /><CardModelDetail cardProps={{}} /></AdvancedPageSection>
    </div>`),
      ),
    ).toEqual([]);
  });

  test("leaves alone what draws no card: a table without a card, a card told to hide its card, a tile", () => {
    expect(
      scan({
        "app/Chart.tsx": `
const Chart = () => {
  return <Card title="Chart" />;
};
export default Chart;
`,
        ...page(
          `<Card title="Outer">
      <ModelTable id="rows" />
      <Chart hideCard={true} />
      <div className="rounded-lg border border-gray-200 p-4">A tile</div>
    </Card>`,
          `import Chart from "./Chart";`,
        ),
      }),
    ).toEqual([]);
  });

  test("leaves alone cards on a side panel: a sheet of its own, not a card", () => {
    expect(
      scan(
        page(`<SideOver title="Investigate" description="" onClose={close}>
      <Card title="Findings" />
      <Card title="Log signal" />
    </SideOver>`),
      ),
    ).toEqual([]);
  });

  test("says which children of CardSections are not whole cards", () => {
    const files: Record<string, string> = page(`<CardSections>
      <Card title="A" />
      <p>Not a card</p>
    </CardSections>`);
    const children: Array<CardSectionsChild> = scanCardSectionsChildren(
      Object.entries(files).map(
        ([file, text]: [string, string]): CardNestingSource => {
          return { file, text };
        },
      ),
      makeImportResolver(new Set<string>(Object.keys(files))),
    );

    expect(
      children.map((child: CardSectionsChild): [string, boolean] => {
        return [child.element, child.isCard];
      }),
    ).toEqual([
      ["Card", true],
      ["p", false],
    ]);
  });

  test("resolves relative imports and Common's, to a module or a directory's index", () => {
    const resolve: ImportResolver = makeImportResolver(
      new Set<string>([
        "packages/App/src/Components/Rules.tsx",
        "packages/App/src/Components/Table/Index.tsx",
        "packages/Common/UI/Components/Card/Card.tsx",
      ]),
    );

    expect(
      resolve("packages/App/src/Pages/Page.tsx", "../Components/Rules"),
    ).toBe("packages/App/src/Components/Rules.tsx");
    expect(resolve("packages/App/src/Components/Page.tsx", "./Table")).toBe(
      "packages/App/src/Components/Table/Index.tsx",
    );
    expect(
      resolve(
        "packages/App/src/Pages/Page.tsx",
        "Common/UI/Components/Card/Card",
      ),
    ).toBe("packages/Common/UI/Components/Card/Card.tsx");
    expect(resolve("packages/App/src/Pages/Page.tsx", "react")).toBeNull();
    expect(resolve("packages/App/src/Pages/Page.tsx", "./Missing")).toBeNull();
  });
});
