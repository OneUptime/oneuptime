// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  CardBodyPadding,
  CardBodyPaddingScan,
  paddingClassesOf,
  readClassUtility,
  scanCardBodyPadding,
} from "../../Helpers/CardBodyPaddingScan";
import {
  CARD_HEADERLESS_PADDING_CLASS_NAME,
  CARD_PADDING_CLASS_NAME,
} from "../../../UI/Components/Card/Card";

/*
 * WHAT A DATA OBSERVABILITY CARD HOLDS LINES UP WITH ITS TITLE (#6555).
 *
 * A card pads what it holds itself (CARD_PADDING_CLASS_NAME), so on every
 * product's cards what a card holds starts under its title's first letter
 * and ends a card's padding over its bottom edge. Data Observability's
 * cards padded their bodies again (px-6 pb-6): what they held started 24px
 * right of their title and left 24px more under it, and on a phone the
 * Lineage card's column picker lost 48px, cutting a column name as long as
 * provider_reference.
 *
 * This guard reads every card of Data Observability's pages and components
 * (Tests/Helpers/CardBodyPaddingScan.ts says how) and fails when the top of
 * a card's body pads the card again. What needs room of its own keeps it
 * inside: a notice in a box of its own pads its own content, a table that
 * scrolls sideways scrolls inside the card's padding, and a list's rows
 * keep their own padding between them.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src";

// Data Observability's pages and components, a data product's and a pipeline's pages among them.
const DATA_OBSERVABILITY_FOLDERS: ReadonlyArray<string> = [
  `${DASHBOARD_SOURCE}/Pages/DataObservability`,
  `${DASHBOARD_SOURCE}/Components/DataObservability`,
  `${DASHBOARD_SOURCE}/Pages/DataProduct`,
  `${DASHBOARD_SOURCE}/Pages/DataPipeline`,
];

// The cards whose bodies #6555 took the padding from: each must still be read.
const CARDS_ONCE_PADDED: ReadonlyArray<string> = [
  "Components/DataObservability/AlertLineageDiagram.tsx",
  "Components/DataObservability/CheckFromSentence.tsx",
  "Components/DataObservability/DataAlertLineage.tsx",
  "Components/DataObservability/DataSourceSuggestionsCard.tsx",
  "Components/DataObservability/DatabaseServerTablesCard.tsx",
  "Components/DataObservability/OverviewNeedsAttention.tsx",
  "Components/DataObservability/PipelineLineageDiagram.tsx",
  "Components/DataObservability/StaleTablesForAiApps.tsx",
  "Components/DataObservability/SuggestedDataChecks.tsx",
  "Components/DataObservability/TableDashboards.tsx",
  "Components/DataObservability/TableErrorsCard.tsx",
  "Components/DataObservability/TableLineageDiagram.tsx",
  "Pages/DataObservability/Documentation.tsx",
  "Pages/DataObservability/Overview.tsx",
  "Pages/DataObservability/Spend.tsx",
  "Pages/DataObservability/StoragePaths.tsx",
  "Pages/DataObservability/Stores.tsx",
  "Pages/DataObservability/TableView/Columns.tsx",
  "Pages/DataObservability/TableView/Overview.tsx",
  "Pages/DataObservability/View/Overview.tsx",
  "Pages/DataProduct/View/Overview.tsx",
];

const EXAMPLE_FILE: string = `${DASHBOARD_SOURCE}/Components/DataObservability/Example.tsx`;

interface ExampleModule {
  // What the card holds.
  body: string;
  // Statements of the component before it returns the card.
  before?: string | undefined;
  // Lines of the module before the component: imports, helpers.
  head?: string | undefined;
  // The card's import; Common's Card unless given.
  cardImport?: string | undefined;
  // The card's tag; Card unless given.
  cardTag?: string | undefined;
}

function exampleText(module: ExampleModule): string {
  const tag: string = module.cardTag || "Card";

  return [
    module.cardImport || `import Card from "Common/UI/Components/Card/Card";`,
    `import React, { Fragment, ReactElement } from "react";`,
    module.head || "",
    `export default function Example(props: { rows: Array<string>; isWide: boolean }): ReactElement {`,
    module.before || "",
    `  return (`,
    `    <${tag} title="Example" description="An example card.">`,
    module.body,
    `    </${tag}>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
}

function scanExample(module: ExampleModule): CardBodyPaddingScan {
  return scanCardBodyPadding({ file: EXAMPLE_FILE, text: exampleText(module) });
}

// The padding classes found, one list per padded element, in the order of the module.
function paddedClasses(module: ExampleModule): Array<Array<string>> {
  return scanExample(module).paddings.map(
    (padding: CardBodyPadding): Array<string> => {
      return padding.classes;
    },
  );
}

// The line a piece of text starts on in an example module.
function lineOfText(module: ExampleModule, text: string): number {
  const before: string = exampleText(module).split(text)[0]!;

  return before.split("\n").length;
}

function describePadding(padding: CardBodyPadding): string {
  return `${padding.file}:${padding.line} <${padding.element}> ${padding.classes.join(" ")} (card at line ${padding.cardLine})`;
}

interface DataObservabilityScan {
  files: Array<string>;
  cardCount: number;
  cardCountByFile: Map<string, number>;
  paddings: Array<CardBodyPadding>;
}

let cachedScan: DataObservabilityScan | null = null;

function scanDataObservability(): DataObservabilityScan {
  if (cachedScan) {
    return cachedScan;
  }

  const files: Array<string> = DATA_OBSERVABILITY_FOLDERS.flatMap(
    (folder: string): Array<string> => {
      return listSourceFiles(path.join(REPOSITORY_ROOT, folder));
    },
  )
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    })
    .sort();

  const scan: DataObservabilityScan = {
    files,
    cardCount: 0,
    cardCountByFile: new Map<string, number>(),
    paddings: [],
  };

  for (const file of files) {
    const found: CardBodyPaddingScan = scanCardBodyPadding({
      file,
      text: fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    });

    scan.cardCount += found.cardCount;
    scan.cardCountByFile.set(file, found.cardCount);
    scan.paddings.push(...found.paddings);
  }

  cachedScan = scan;

  return scan;
}

describe("what a Data Observability card holds lines up with its title", () => {
  test("a card pads its body itself, at the sides and at the bottom: why its body must not again", () => {
    expect(paddingClassesOf(CARD_PADDING_CLASS_NAME)).toEqual([
      "py-6",
      "px-5",
      "md:px-6",
    ]);
    // A card without a header pads the same sides and bottom.
    expect(paddingClassesOf(CARD_HEADERLESS_PADDING_CLASS_NAME)).toEqual([
      "pb-6",
      "px-5",
      "md:px-6",
    ]);
  });

  test("the scan reads every Data Observability folder and the cards in it", () => {
    const scan: DataObservabilityScan = scanDataObservability();

    for (const folder of DATA_OBSERVABILITY_FOLDERS) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, folder))).toBe(true);
      expect(
        scan.files.some((file: string): boolean => {
          return file.startsWith(`${folder}/`);
        }),
      ).toBe(true);
    }

    // 31 cards when #6555 was fixed.
    expect(scan.cardCount).toBeGreaterThanOrEqual(30);

    // Every module whose card bodies were padded twice is read, and a card found in it.
    expect(
      CARDS_ONCE_PADDED.filter((file: string): boolean => {
        return !scan.cardCountByFile.get(`${DASHBOARD_SOURCE}/${file}`);
      }),
    ).toEqual([]);

    // An alert's Data card and its Downstream Impact card, each read.
    expect(
      scan.cardCountByFile.get(
        `${DASHBOARD_SOURCE}/Components/DataObservability/DataAlertLineage.tsx`,
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  test("no Data Observability card's body pads the card again", () => {
    expect(scanDataObservability().paddings.map(describePadding)).toEqual([]);
  });
});

describe("the card body padding scan", () => {
  test("a body that pads its card again is found, with the classes that do and the lines of both", () => {
    const module: ExampleModule = {
      body: `      <div className="space-y-6 px-6 pb-6 text-sm">Spend</div>`,
    };
    const scan: CardBodyPaddingScan = scanExample(module);

    expect(scan.cardCount).toBe(1);
    expect(scan.paddings).toEqual([
      {
        file: EXAMPLE_FILE,
        line: lineOfText(module, `<div className="space-y-6`),
        element: "div",
        classes: ["px-6", "pb-6"],
        cardLine: lineOfText(module, `<Card title`),
      },
    ]);
  });

  test("a body flush with the card's padding is not: the room between its rows and its colours are its own", () => {
    expect(
      paddedClasses({
        body: [
          `      <div className="space-y-4 text-sm text-gray-700">Facts</div>`,
          `      <ul className="divide-y divide-gray-100">`,
          `        <li className="py-3">A row</li>`,
          `      </ul>`,
          `      <p className="mt-2 text-xs text-gray-500">And 3 more.</p>`,
          `      <div data-testid="alert-lineage-diagram">Drawing</div>`,
          `      <div className="overflow-x-auto">Columns</div>`,
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test.each([
    ["p-4", ["p-4"]],
    ["px-6", ["px-6"]],
    ["pl-2", ["pl-2"]],
    ["pr-2", ["pr-2"]],
    ["ps-3", ["ps-3"]],
    ["pe-3", ["pe-3"]],
    ["py-2", ["py-2"]],
    ["pb-6", ["pb-6"]],
    ["px-px", ["px-px"]],
    ["px-[10px]", ["px-[10px]"]],
    ["px-4 pb-2 sm:px-6", ["px-4", "pb-2", "sm:px-6"]],
    ["md:pb-4", ["md:pb-4"]],
    ["rtl:pr-6", ["rtl:pr-6"]],
    [
      "[@container(min-width:24rem)]:px-6",
      ["[@container(min-width:24rem)]:px-6"],
    ],
    ["!px-6", ["!px-6"]],
    ["md:!pb-6", ["md:!pb-6"]],
  ])(
    "a padding of a side or of the bottom pads the card again, at any width or state: %s",
    (classes: string, found: Array<string>) => {
      expect(
        paddedClasses({ body: `      <div className="${classes}">Body</div>` }),
      ).toEqual([found]);
    },
  );

  test.each([
    ["pt-4"],
    ["px-0"],
    ["pb-0"],
    ["sm:px-0"],
    ["p-[0]"],
    ["pb-[0px]"],
    ["mt-4 mb-2 mx-auto"],
    ["space-x-6 gap-6"],
  ])(
    "the room under the header, a padding of nothing and a margin are not padding: %s",
    (classes: string) => {
      expect(
        paddedClasses({ body: `      <div className="${classes}">Body</div>` }),
      ).toEqual([]);
    },
  );

  test.each([
    ["rounded-md bg-yellow-50 p-3 text-sm text-yellow-800"],
    ["rounded-md border border-gray-200 p-4"],
    ["rounded-lg border-2 px-4 py-3"],
    ["rounded-md ring-1 ring-gray-200 px-4 py-3"],
    ["rounded-md bg-[#fafafa] p-4"],
    ["rounded-md bg-gray-900/50 p-4"],
    ["rounded-md bg-black p-4"],
  ])(
    "an element that draws a box of its own pads its own content: %s",
    (classes: string) => {
      expect(
        paddedClasses({ body: `      <p className="${classes}">Notice</p>` }),
      ).toEqual([]);
    },
  );

  test.each([
    ["sm:border p-4", ["p-4"]],
    ["bg-white p-4", ["p-4"]],
    ["border-t pt-4 pb-4", ["pb-4"]],
    ["border-gray-200 px-4", ["px-4"]],
    ["dark:bg-gray-800 px-4", ["px-4"]],
    ["bg-cover px-4", ["px-4"]],
  ])(
    "a box at some widths only, a white one or a line on one side pads the card again: %s",
    (classes: string, found: Array<string>) => {
      expect(
        paddedClasses({ body: `      <div className="${classes}">Body</div>` }),
      ).toEqual([found]);
    },
  );

  test.each([
    ["-mx-6 px-6", []],
    ["-mx-5 md:-mx-6 px-5 md:px-6", []],
    ["-m-6 p-6", []],
    ["-mb-6 pb-6", []],
    ["-my-6 py-6", []],
    ["-ml-6 -mr-6 pl-6 pr-6", []],
    ["-ml-6 -mr-6 px-6", []],
    ["-ms-6 -me-6 ps-6 pe-6", []],
    ["-mx-6 ps-6 pe-6", []],
    ["-mx-6 px-6 pb-6", [["pb-6"]]],
    ["-mb-6 px-6 pb-6", [["px-6"]]],
    ["-mx-6 p-6", [["p-6"]]],
    ["-ml-6 pr-6", [["pr-6"]]],
    ["-ml-6 px-6", [["px-6"]]],
    ["-ms-6 px-6", [["px-6"]]],
    ["-mx-0 px-6", [["px-6"]]],
    ["-mt-6 pb-6", [["pb-6"]]],
  ])(
    "an element bleeding over the card's padding pads back what it bleeds, on that side only: %s",
    (classes: string, found: Array<Array<string>>) => {
      expect(
        paddedClasses({
          body: `      <div className="${classes}">Table</div>`,
        }),
      ).toEqual(found);
    },
  );

  test("both branches of a condition are read", () => {
    expect(
      paddedClasses({
        body: [
          `      {props.rows.length === 0 ? (`,
          `        <p className="px-6 pb-6 text-sm text-gray-500">Nothing yet.</p>`,
          `      ) : (`,
          `        <ul className="divide-y divide-gray-100 px-4 pb-2 sm:px-6">`,
          `          <li>A row</li>`,
          `        </ul>`,
          `      )}`,
        ].join("\n"),
      }),
    ).toEqual([
      ["px-6", "pb-6"],
      ["px-4", "pb-2", "sm:px-6"],
    ]);
  });

  test("what is drawn only when something holds, or in place of nothing, is read", () => {
    expect(
      paddedClasses({
        body: [
          `      {props.isWide && <div className="pb-4">Wide</div>}`,
          `      {props.rows[0] || <p className="px-6">Empty</p>}`,
          `      {props.rows[1] ?? <p className="pl-6">Missing</p>}`,
        ].join("\n"),
      }),
    ).toEqual([["pb-4"], ["px-6"], ["pl-6"]]);
  });

  test("a fragment's elements are the body's own: <>, Fragment and React.Fragment", () => {
    expect(
      paddedClasses({
        body: [
          `      <>`,
          `        <div className="px-6">One</div>`,
          `      </>`,
          `      <Fragment>`,
          `        <p className="pb-6">Two</p>`,
          `      </Fragment>`,
          `      <React.Fragment>`,
          `        {props.isWide ? <dl className="p-6">Three</dl> : <></>}`,
          `      </React.Fragment>`,
        ].join("\n"),
      }),
    ).toEqual([["px-6"], ["pb-6"], ["p-6"]]);
  });

  test("the rows a .map draws at the top of the body are read, whatever the callback returns them by", () => {
    expect(
      paddedClasses({
        body: [
          `      {props.rows.map((row: string): ReactElement => <div key={row} className="px-6 py-2">{row}</div>)}`,
          `      {props.rows.map((row: string): ReactElement => {`,
          `        const label = (): ReactElement => {`,
          `          return <span className="px-2">{row}</span>;`,
          `        };`,
          `        if (!row) {`,
          `          return <></>;`,
          `        }`,
          `        return <p key={row} className="pb-6">{label()}</p>;`,
          `      })}`,
        ].join("\n"),
      }),
    ).toEqual([["px-6", "py-2"], ["pb-6"]]);
  });

  test("a variable named in the body is read where it is declared and wherever it is assigned", () => {
    expect(
      paddedClasses({
        before: [
          `  let body: ReactElement = <div className="px-6">Loading</div>;`,
          `  if (props.isWide) {`,
          `    body = <p className="pb-6">Wide</p>;`,
          `  }`,
        ].join("\n"),
        body: `      <div data-testid="example">{body}</div>\n      {body}`,
      }),
    ).toEqual([["px-6"], ["pb-6"]]);
  });

  test("a render helper of the module, called in the body, is read: as a const or a function", () => {
    expect(
      paddedClasses({
        head: [
          `function renderEmpty(): ReactElement {`,
          `  return <p className="px-6 pb-6">Nothing yet.</p>;`,
          `}`,
        ].join("\n"),
        before: `  const renderRows = (): ReactElement => <ul className="pb-4">Rows</ul>;`,
        body: `      {props.rows.length ? renderRows() : renderEmpty()}`,
      }),
    ).toEqual([["pb-4"], ["px-6", "pb-6"]]);
  });

  test("a variable or helper that reads itself is read once, and the scan ends", () => {
    expect(
      paddedClasses({
        before: [
          `  let body: ReactElement = <div className="px-6">One</div>;`,
          `  body = <>{body}<p className="pb-6">Two</p></>;`,
          `  const again = (): ReactElement => again();`,
        ].join("\n"),
        body: `      {body}\n      {again()}`,
      }),
    ).toEqual([["px-6"], ["pb-6"]]);
  });

  test("an element reached two ways is told once", () => {
    expect(
      paddedClasses({
        before: `  const body: ReactElement = <div className="px-6">Body</div>;`,
        body: `      {body}\n      {props.isWide ? body : <></>}`,
      }),
    ).toEqual([["px-6"]]);
  });

  test("what the body's elements hold is theirs: a list row's padding is not the card's", () => {
    expect(
      paddedClasses({
        body: [
          `      <ul className="divide-y divide-gray-100">`,
          `        {props.rows.map((row: string): ReactElement => <li key={row} className="px-6 py-3">{row}</li>)}`,
          `      </ul>`,
          `      <div>`,
          `        <p className="px-6 pb-6">Inside a plain div</p>`,
          `      </div>`,
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test("a component given padding at the top of the body pads the card as well", () => {
    expect(
      scanExample({
        body: `      <AppLink className="block px-6 pb-6" to="/tables">Tables</AppLink>`,
      }).paddings.map((padding: CardBodyPadding): string => {
        return `${padding.element} ${padding.classes.join(" ")}`;
      }),
    ).toEqual(["AppLink px-6 pb-6"]);
  });

  test("a class attribute built by an expression is read from its strings", () => {
    expect(
      paddedClasses({
        body: [
          '      <div className={`space-y-2 px-6 ${props.isWide ? "pb-6" : "pb-0"}`}>One</div>',
          `      <div className={["space-y-2", props.isWide ? "pl-4" : ""].join(" ")}>Two</div>`,
          `      <div className={props.isWide ? "pr-4" : "mt-2"}>Three</div>`,
        ].join("\n"),
      }),
    ).toEqual([["px-6", "pb-6"], ["pl-4"], ["pr-4"]]);
  });

  test("only Common's Card is a card, whatever the module calls it", () => {
    const body: string = `      <div className="px-6 pb-6">Body</div>`;

    // Another module's card is not read: its padding is its own.
    expect(
      scanExample({ body, cardImport: `import Card from "./OwnCard";` }),
    ).toEqual({ cardCount: 0, paddings: [] });
    // A named Card of another module is not Common's either.
    expect(
      scanExample({ body, cardImport: `import { Card } from "./Cards";` }),
    ).toEqual({ cardCount: 0, paddings: [] });
    // Common's Card by another name, or by a relative path from inside Common, is.
    expect(
      paddedClasses({
        body,
        cardImport: `import Panel from "Common/UI/Components/Card/Card";`,
        cardTag: "Panel",
      }),
    ).toEqual([["px-6", "pb-6"]]);
    expect(
      paddedClasses({ body, cardImport: `import Card from "../Card/Card";` }),
    ).toEqual([["px-6", "pb-6"]]);
  });

  test("a card without a body is counted and has nothing to pad", () => {
    expect(
      scanCardBodyPadding({
        file: EXAMPLE_FILE,
        text: [
          `import Card from "Common/UI/Components/Card/Card";`,
          `const Example = (): ReactElement => <Card title="Checks" description="None." />;`,
        ].join("\n"),
      }),
    ).toEqual({ cardCount: 1, paddings: [] });
  });

  test("a module without Common's Card is not read", () => {
    expect(
      scanCardBodyPadding({
        file: EXAMPLE_FILE,
        text: `const Example = (): ReactElement => <div className="px-6 pb-6">Not a card</div>;`,
      }),
    ).toEqual({ cardCount: 0, paddings: [] });
  });

  test("every card of a module is read, each with its own line", () => {
    const text: string = [
      `import Card from "Common/UI/Components/Card/Card";`,
      `const Example = (): ReactElement => (`,
      `  <div>`,
      `    <Card title="One" description="First.">`,
      `      <div className="px-6">One</div>`,
      `    </Card>`,
      `    <Card title="Two" description="Second.">`,
      `      <div className="space-y-2">Two</div>`,
      `    </Card>`,
      `    <Card title="Three" description="Third.">`,
      `      <ul className="pb-6">Three</ul>`,
      `    </Card>`,
      `  </div>`,
      `);`,
    ].join("\n");

    expect(scanCardBodyPadding({ file: EXAMPLE_FILE, text })).toEqual({
      cardCount: 3,
      paddings: [
        {
          file: EXAMPLE_FILE,
          line: 5,
          element: "div",
          classes: ["px-6"],
          cardLine: 4,
        },
        {
          file: EXAMPLE_FILE,
          line: 11,
          element: "ul",
          classes: ["pb-6"],
          cardLine: 10,
        },
      ],
    });
  });

  test("a class's utility follows its last colon outside brackets, and ! is not part of it", () => {
    expect(readClassUtility("px-6")).toEqual({
      written: "px-6",
      utility: "px-6",
      isUnconditional: true,
    });
    expect(readClassUtility("md:!pb-6")).toEqual({
      written: "md:!pb-6",
      utility: "pb-6",
      isUnconditional: false,
    });
    expect(
      readClassUtility("[@container(min-width:24rem)]:flex-row").utility,
    ).toBe("flex-row");
    expect(readClassUtility("[container-type:inline-size]")).toEqual({
      written: "[container-type:inline-size]",
      utility: "[container-type:inline-size]",
      isUnconditional: true,
    });
  });
});
