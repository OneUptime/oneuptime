// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  CardBodyImportReader,
  CardBodyPadding,
  CardBodyPaddingScan,
  CardBodyPaddingScanOptions,
  CardBodyPaddingSource,
  createRepositoryImportReader,
  paddingClassesOf,
  readClassUtility,
  scanCardBodyPadding,
} from "../../Helpers/CardBodyPaddingScan";
import {
  CARD_HEADERLESS_PADDING_CLASS_NAME,
  CARD_PADDING_CLASS_NAME,
} from "../../../UI/Components/Card/Card";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "../../../UI/Components/Card/CardGridLayout";
import {
  CARD_RULED_BODY_CLASS_NAME,
  CARD_SECTION_RULED_BODY_CLASS_NAME,
} from "../../../UI/Components/Card/CardSurface";

/*
 * WHAT A CARD HOLDS LINES UP WITH ITS TITLE (#6555, #6956).
 *
 * A card pads what it holds itself (CARD_PADDING_CLASS_NAME), so on every
 * product's cards what a card holds starts under its title's first letter
 * and ends a card's padding over its bottom edge. Data Observability's
 * cards padded their bodies again (px-6 pb-6, #6555), and so did 31 more
 * across the product (#6956): OpenStack's Checks, Traces, Feed, Requests
 * and Capacity (p-4), Kubernetes' Workloads and Infrastructure links, Phone
 * Numbers (p-6), every Enterprise feature's upgrade card, a pipeline's
 * filter... What they held started 16 to 40px right of their title,
 * stopped as far short of the card's right edge and left as much more
 * under it.
 *
 * This guard reads every card of every frontend that draws Common's Card -
 * the Dashboard, the Admin Dashboard, the status page, Accounts, the public
 * dashboard, Common's own components and, when ee/ is there, the Enterprise
 * Edition's pages - (Tests/Helpers/CardBodyPaddingScan.ts says how) and
 * fails when the top of a card's body pads the card again. What needs room
 * of its own keeps it, by rule rather than by a list of files:
 *
 *   - a notice in a box of its own pads its own content;
 *   - a table that scrolls sideways, or a body ruled from edge to edge,
 *     bleeds over the card's padding and pads it back (a detail card's
 *     useCardRuledBodyClassName(), Home's row of cards);
 *   - a loading or an empty state set in the middle of the card pads above
 *     and below itself (text-center py-12);
 *   - a bulleted list draws its bullets in the padding at its start (pl-5);
 *   - a list's rows keep their own padding between them.
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
const ADMIN_DASHBOARD_SOURCE: string =
  "packages/App/FeatureSet/AdminDashboard/src";

// Every frontend that draws Common's Card, ee/ aside.
const FRONTEND_FOLDERS: ReadonlyArray<string> = [
  DASHBOARD_SOURCE,
  ADMIN_DASHBOARD_SOURCE,
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/Common/UI",
];

/*
 * The Enterprise Edition's pages. Common Test runs without ee/ (CI removes
 * it first), so they are read only when ee/ is there - keyed on ee/ itself,
 * so a folder moved inside ee/ still fails.
 */
const HAS_ENTERPRISE_EDITION: boolean = fs.existsSync(
  path.join(REPOSITORY_ROOT, "ee"),
);
const ENTERPRISE_FOLDERS: ReadonlyArray<string> = [
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// The cards whose bodies #6555 took the padding from (Data Observability): each must still be read.
const DATA_OBSERVABILITY_CARDS_ONCE_PADDED: ReadonlyArray<string> = [
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
].map((file: string): string => {
  return `${DASHBOARD_SOURCE}/${file}`;
});

// The cards whose bodies #6956 took the padding from, everywhere else: each must still be read.
const CARDS_ONCE_PADDED: ReadonlyArray<string> = [
  ...[
    "Components/CallSMS/PhoneNumberPurchase.tsx",
    "Components/EnterpriseEdition/EnterpriseFeatureUpgrade.tsx",
    "Components/FilterQueryBuilder/FilterQueryBuilder.tsx",
    "Components/Home/ExploreProducts.tsx",
    "Components/Kubernetes/OpenShiftHealthCard.tsx",
    "Components/OpenStack/Checks/OpenStackApiChecksCard.tsx",
    "Components/OpenStack/Checks/OpenStackLifecycleCheckCard.tsx",
    "Components/OpenStack/OpenStackRequestTrail.tsx",
    "Components/OpenStack/OpenStackRunbookTemplatesCard.tsx",
    "Components/OpenStack/OpenStackTopConsumersCard.tsx",
    "Components/OpenStack/Part/OpenStackPartFeed.tsx",
    "Components/OpenStack/Part/OpenStackPartLogs.tsx",
    "Components/OpenStack/Traces/OpenStackControlPlaneMapCard.tsx",
    "Components/OpenStack/Traces/OpenStackTraceARequestCard.tsx",
    "Components/OpenStack/Traces/OpenStackTraceContextCard.tsx",
    "Components/OpenStack/Traces/OpenStackTracesStatusCard.tsx",
    "Components/ResourceTopology/ResourceTopologyPage.tsx",
    "Pages/Alerts/View/AffectedResources.tsx",
    "Pages/Incidents/View/AffectedResources.tsx",
    "Pages/Kubernetes/View/Index.tsx",
    "Pages/OpenStack/View/Capacity.tsx",
    "Pages/OpenStack/View/ProjectDetail.tsx",
    "Pages/OpenStack/View/StackDetail.tsx",
    "Pages/StatusPages/Settings/SubscriberNotificationTemplateView.tsx",
  ].map((file: string): string => {
    return `${DASHBOARD_SOURCE}/${file}`;
  }),
  `${ADMIN_DASHBOARD_SOURCE}/Components/EnterpriseEdition/EnterpriseFeatureUpgrade.tsx`,
];

/*
 * Cards of today's pages whose bodies pad by one of the rules, each with
 * what turns the rule off: a centred state without its centring, a list
 * without its bullets, a class name whose other module is not read. With
 * the rule off the scan finds the padding, so it is the rule - not a blind
 * spot of the scan - that lets each one pass.
 */
interface DeliberatePadding {
  file: string;
  rule: string;
  // The text that makes the rule hold, and what it becomes without it.
  from?: string | undefined;
  to?: string | undefined;
  // The rule needs the module a class name is imported from.
  needsImports?: boolean | undefined;
}

const DELIBERATE_PADDINGS: ReadonlyArray<DeliberatePadding> = [
  {
    file: `${DASHBOARD_SOURCE}/Components/NetworkDevice/DeviceMonitorsCard.tsx`,
    rule: "an empty state centred by its text",
    from: `className="text-center py-10"`,
    to: `className="py-10"`,
  },
  {
    file: `${DASHBOARD_SOURCE}/Pages/Incidents/View/Sla.tsx`,
    rule: "an empty state centred by its text",
    from: `className="text-center py-12"`,
    to: `className="py-12"`,
  },
  {
    file: `${DASHBOARD_SOURCE}/Components/ResourceTopology/ResourceTopologyPage.tsx`,
    rule: "a loading state centred by its text",
    from: `className="py-12 text-center"`,
    to: `className="py-12"`,
  },
  {
    file: `${DASHBOARD_SOURCE}/Components/Topology/NetworkTopologyExplorer.tsx`,
    rule: "a loading state centred by a flex column",
    from: `"flex flex-col items-center justify-center gap-3 py-20"`,
    to: `"flex flex-col gap-3 py-20"`,
  },
  {
    file: `${DASHBOARD_SOURCE}/Components/Owners/OwnersCard.tsx`,
    rule: "a loader centred by a flex row",
    from: `"flex items-center justify-center py-6"`,
    to: `"flex items-center py-6"`,
  },
  {
    file: `${DASHBOARD_SOURCE}/Pages/NetworkDevice/View/Tables.tsx`,
    rule: "a bulleted list's indent",
    from: `"list-disc space-y-1 pl-5`,
    to: `"space-y-1 pl-5`,
  },
  {
    file: `${DASHBOARD_SOURCE}/Components/MessageQueue/MessageQueueServicesCard.tsx`,
    rule: "an empty state centred by Common's CARD_GRID_CENTERED_STATE_CLASS_NAME",
    needsImports: true,
  },
  {
    file: `${DASHBOARD_SOURCE}/Pages/NetworkDevice/Overview.tsx`,
    rule: "an empty state centred by a constant built on Common's",
    needsImports: true,
  },
  {
    file: `${DASHBOARD_SOURCE}/Components/Home/NeedsAttention.tsx`,
    rule: "a body the card bleeds to its edges (HOME_ROW_CARD_BODY_CLASS_NAME)",
    needsImports: true,
  },
  {
    file: `${DASHBOARD_SOURCE}/Components/VMware/Host/VMwareHostDetailsCard.tsx`,
    rule: "a ruled body, bled by useCardRuledBodyClassName() and padded back",
    needsImports: true,
  },
  {
    file: `${DASHBOARD_SOURCE}/Components/ResourcePart/ResourcePartDetailsCard.tsx`,
    rule: "a ruled body, bled by useCardRuledBodyClassName() and padded back",
    needsImports: true,
  },
];

const ENTERPRISE_DELIBERATE_PADDINGS: ReadonlyArray<DeliberatePadding> = [
  {
    file: "ee/AdminDashboard/Health/QueryConsole.tsx",
    rule: "an empty state centred by its text",
    from: `"text-sm text-gray-400 py-8 text-center"`,
    to: `"text-sm text-gray-400 py-8"`,
  },
];

const EXAMPLE_FILE: string = `${DASHBOARD_SOURCE}/Components/Example/Example.tsx`;

const READ_REPOSITORY_IMPORT: CardBodyImportReader =
  createRepositoryImportReader(REPOSITORY_ROOT);

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
  // The card's own attributes, after its description.
  cardAttributes?: string | undefined;
  // Other modules an import of the example names, by specifier.
  imports?: Record<string, string> | undefined;
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
    `    <${tag} title="Example" description="An example card."${module.cardAttributes ? ` ${module.cardAttributes}` : ""}>`,
    module.body,
    `    </${tag}>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
}

// Reads the example's imports from the modules it was given, as the repository's reader would.
function exampleImports(modules: Record<string, string>): CardBodyImportReader {
  return (specifier: string): CardBodyPaddingSource | undefined => {
    const text: string | undefined = modules[specifier];

    return text === undefined
      ? undefined
      : { file: `${DASHBOARD_SOURCE}/Example/${specifier}.tsx`, text };
  };
}

function scanExample(module: ExampleModule): CardBodyPaddingScan {
  return scanCardBodyPadding(
    { file: EXAMPLE_FILE, text: exampleText(module) },
    module.imports ? { readImport: exampleImports(module.imports) } : {},
  );
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

function readSource(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

function scanFile(
  file: string,
  text: string,
  options: CardBodyPaddingScanOptions,
): CardBodyPaddingScan {
  return scanCardBodyPadding({ file, text }, options);
}

interface FrontendScan {
  files: Array<string>;
  cardCount: number;
  cardCountByFile: Map<string, number>;
  paddings: Array<CardBodyPadding>;
}

const cachedScans: Map<string, FrontendScan> = new Map<string, FrontendScan>();

// Every .tsx of the folders, each card in them and every padded body.
function scanFolders(folders: ReadonlyArray<string>): FrontendScan {
  const key: string = folders.join("|");
  const cached: FrontendScan | undefined = cachedScans.get(key);

  if (cached) {
    return cached;
  }

  const files: Array<string> = folders
    .flatMap((folder: string): Array<string> => {
      return listSourceFiles(path.join(REPOSITORY_ROOT, folder));
    })
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    })
    .sort();

  const scan: FrontendScan = {
    files,
    cardCount: 0,
    cardCountByFile: new Map<string, number>(),
    paddings: [],
  };

  for (const file of files) {
    const found: CardBodyPaddingScan = scanFile(file, readSource(file), {
      readImport: READ_REPOSITORY_IMPORT,
    });

    scan.cardCount += found.cardCount;
    scan.cardCountByFile.set(file, found.cardCount);
    scan.paddings.push(...found.paddings);
  }

  cachedScans.set(key, scan);

  return scan;
}

function cardsOfFrontends(): FrontendScan {
  return scanFolders(FRONTEND_FOLDERS);
}

// The rule's padding is found once the rule is turned off, and nothing while it holds.
function expectRuleIsWhatPasses(deliberate: DeliberatePadding): void {
  const text: string = readSource(deliberate.file);
  const withRule: CardBodyPaddingScan = scanFile(deliberate.file, text, {
    readImport: READ_REPOSITORY_IMPORT,
  });

  expect(withRule.cardCount).toBeGreaterThan(0);
  expect(withRule.paddings.map(describePadding)).toEqual([]);

  let withoutRule: CardBodyPaddingScan;

  if (deliberate.needsImports) {
    withoutRule = scanFile(deliberate.file, text, {});
  } else {
    // The text that makes the rule hold is on the page, once.
    expect(text.split(deliberate.from!).length - 1).toBe(1);
    withoutRule = scanFile(
      deliberate.file,
      text.replace(deliberate.from!, deliberate.to!),
      { readImport: READ_REPOSITORY_IMPORT },
    );
  }

  expect(withoutRule.paddings.length).toBeGreaterThan(0);
}

describe("what a card holds lines up with its title, on every page", () => {
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

  test("the scan reads every frontend's folder and the cards in it", () => {
    const scan: FrontendScan = cardsOfFrontends();

    for (const folder of FRONTEND_FOLDERS) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, folder))).toBe(true);
      expect(
        scan.files.some((file: string): boolean => {
          return file.startsWith(`${folder}/`);
        }),
      ).toBe(true);
    }

    const cardsIn: (folder: string) => number = (folder: string): number => {
      return [...scan.cardCountByFile.entries()]
        .filter(([file]: [string, number]): boolean => {
          return file.startsWith(`${folder}/`);
        })
        .reduce((sum: number, [, count]: [string, number]): number => {
          return sum + count;
        }, 0);
    };

    // 749 Dashboard cards, 31 Admin Dashboard cards and 22 of Common's when #6956 was fixed.
    expect(cardsIn(DASHBOARD_SOURCE)).toBeGreaterThanOrEqual(700);
    expect(cardsIn(ADMIN_DASHBOARD_SOURCE)).toBeGreaterThanOrEqual(25);
    expect(cardsIn("packages/Common/UI")).toBeGreaterThanOrEqual(15);
    expect(cardsIn("packages/App/FeatureSet/StatusPage/src")).toBeGreaterThan(
      0,
    );

    // Every module whose card bodies were padded twice is read, and a card found in it.
    expect(
      [...DATA_OBSERVABILITY_CARDS_ONCE_PADDED, ...CARDS_ONCE_PADDED].filter(
        (file: string): boolean => {
          return !scan.cardCountByFile.get(file);
        },
      ),
    ).toEqual([]);

    // An alert's Data card and its Downstream Impact card, each read.
    expect(
      scan.cardCountByFile.get(
        `${DASHBOARD_SOURCE}/Components/DataObservability/DataAlertLineage.tsx`,
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  test("no card's body pads the card again", () => {
    expect(cardsOfFrontends().paddings.map(describePadding)).toEqual([]);
  });

  test.each(
    DELIBERATE_PADDINGS.map(
      (deliberate: DeliberatePadding): [string, string, DeliberatePadding] => {
        return [path.basename(deliberate.file), deliberate.rule, deliberate];
      },
    ),
  )(
    "%s pads by a rule - %s - and pads the card again without it",
    (_file: string, _rule: string, deliberate: DeliberatePadding) => {
      expectRuleIsWhatPasses(deliberate);
    },
  );

  test("the Enterprise Edition's pages, when ee/ is there: no card's body pads the card again", () => {
    if (!HAS_ENTERPRISE_EDITION) {
      return;
    }

    const scan: FrontendScan = scanFolders(ENTERPRISE_FOLDERS);

    for (const folder of ENTERPRISE_FOLDERS) {
      expect(
        scan.files.some((file: string): boolean => {
          return file.startsWith(`${folder}/`);
        }),
      ).toBe(true);
    }

    expect(scan.cardCount).toBeGreaterThanOrEqual(20);
    expect(scan.paddings.map(describePadding)).toEqual([]);

    for (const deliberate of ENTERPRISE_DELIBERATE_PADDINGS) {
      expectRuleIsWhatPasses(deliberate);
    }
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
    ["-m-1 p-1", []],
    ["-mb-6 pb-6", []],
    ["-my-6 py-6", []],
    ["-ml-6 -mr-6 pl-6 pr-6", []],
    ["-ml-6 -mr-6 px-6", []],
    ["-ms-6 -me-6 ps-6 pe-6", []],
    ["-mx-6 ps-6 pe-6", []],
    ["-mx-6 px-6 pb-6", [["pb-6"]]],
    ["-mx-1 px-1 pb-1", [["pb-1"]]],
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

  test.each([
    ["text-center py-12", "div"],
    ["py-6 text-center text-sm text-gray-500", "p"],
    ["flex flex-col items-center justify-center gap-3 py-20", "div"],
    ["flex items-center justify-center py-6", "div"],
    ["inline-flex justify-center pb-4", "div"],
    ["grid place-items-center py-8", "div"],
    ["grid justify-items-center py-8", "div"],
    ["flex flex-1 flex-col justify-center text-center py-6", "div"],
    ["text-center pt-6 pb-10", "div"],
  ])(
    "a state set in the middle of the card, padded only above and below, has room of its own: %s",
    (classes: string, tag: string) => {
      expect(
        paddedClasses({
          body: `      <${tag} className="${classes}">Nothing yet.</${tag}>`,
        }),
      ).toEqual([]);
    },
  );

  test.each([
    // Centred on its own line only: a flex row's items-center, a column's justify-center.
    ["flex items-center gap-2 py-6", ["py-6"]],
    ["flex flex-col justify-center py-6", ["py-6"]],
    ["grid py-8", ["py-8"]],
    // Centred at some widths only.
    ["md:text-center py-12", ["py-12"]],
    ["flex md:justify-center py-6", ["py-6"]],
    // Centred, but padded at the sides as well: every padding of it counts.
    ["text-center px-4 py-6", ["px-4", "py-6"]],
    ["p-10 flex items-center justify-center", ["p-10"]],
    ["text-center pl-4 pb-6", ["pl-4", "pb-6"]],
  ])(
    "a state not centred across at every width, or one that pads its sides too, pads the card again: %s",
    (classes: string, found: Array<string>) => {
      expect(
        paddedClasses({
          body: `      <div className="${classes}">State</div>`,
        }),
      ).toEqual([found]);
    },
  );

  test("a centred state's constant, of the module or imported, is read as the state's classes", () => {
    const centred: string = `flex flex-1 flex-col justify-center text-center`;

    expect(
      paddedClasses({
        head: `const CENTERED: string = "${centred}";`,
        body: "      <div className={`${CENTERED} py-6 text-sm`}>Nothing yet.</div>",
      }),
    ).toEqual([]);
    expect(
      paddedClasses({
        head: `import { CENTERED } from "./Layout";`,
        body: "      <div className={`${CENTERED} py-6 text-sm`}>Nothing yet.</div>",
        imports: {
          "./Layout": `export const CENTERED: string = "${centred}";`,
        },
      }),
    ).toEqual([]);
    // Built with + from another constant, as the Network overview's empty lists are.
    expect(
      paddedClasses({
        head: [
          `import { CENTERED } from "./Layout";`,
          `const EMPTY_LIST: string = CENTERED + " py-6 text-sm text-gray-500";`,
        ].join("\n"),
        body: `      <p className={EMPTY_LIST}>Nothing yet.</p>`,
        imports: {
          "./Layout": `export const CENTERED: string = "${centred}";`,
        },
      }),
    ).toEqual([]);
    // Common's own constant is a centred state.
    expect(
      paddingClassesOf(`${CARD_GRID_CENTERED_STATE_CLASS_NAME} py-6`),
    ).toEqual([]);
  });

  test("an imported name the scan cannot read is read as nothing: what is written beside it still counts", () => {
    const module: ExampleModule = {
      head: `import { CENTERED } from "./Layout";`,
      body: "      <div className={`${CENTERED} py-6`}>Nothing yet.</div>",
    };

    // No reader, and a reader that cannot find the module: py-6 is all there is.
    expect(paddedClasses(module)).toEqual([["py-6"]]);
    expect(paddedClasses({ ...module, imports: {} })).toEqual([["py-6"]]);
  });

  test.each([
    ["ul", "list-disc space-y-1 pl-5 text-sm"],
    ["ol", "list-decimal pl-6"],
    ["ul", "list-disc ps-5"],
    ["ul", "list-[square] pl-4"],
    ["ul", "list-disc list-outside pl-5"],
  ])(
    "a bulleted list draws its bullets in its start padding: <%s> %s",
    (tag: string, classes: string) => {
      expect(
        paddedClasses({
          body: `      <${tag} className="${classes}"><li>One</li></${tag}>`,
        }),
      ).toEqual([]);
    },
  );

  test.each([
    // Its other sides and its bottom are the card's.
    ["ul", "list-disc px-5", ["px-5"]],
    ["ul", "list-disc pl-5 pr-2", ["pr-2"]],
    ["ul", "list-disc pl-5 pb-2", ["pb-2"]],
    ["ol", "list-decimal pe-4", ["pe-4"]],
    // A list without bullets, or with them inside its rows, is not indented for them.
    ["ul", "pl-5", ["pl-5"]],
    ["ul", "list-none pl-5", ["pl-5"]],
    ["ul", "list-disc list-inside pl-5", ["pl-5"]],
    ["ul", "md:list-disc pl-5", ["pl-5"]],
    // Only a list draws bullets.
    ["div", "list-disc pl-5", ["pl-5"]],
  ])(
    "a list pads the card again everywhere but at its bullets: <%s> %s",
    (tag: string, classes: string, found: Array<string>) => {
      expect(
        paddedClasses({
          body: `      <${tag} className="${classes}"><li>One</li></${tag}>`,
        }),
      ).toEqual([found]);
    },
  );

  test("a card whose body bleeds to its edges lets its elements pad back what it bleeds, and no more", () => {
    // Home's row of cards: the body runs to the card's edges and its bottom.
    expect(
      paddedClasses({
        cardAttributes: `bodyClassName="mt-3 -mx-5 -mb-6 md:-mx-6"`,
        body: [
          `      <div className="space-y-1 border-t border-gray-100 py-2">Loading</div>`,
          `      <div className="px-5 py-6 md:px-6">Nothing yet.</div>`,
        ].join("\n"),
      }),
    ).toEqual([]);
    // Bled at the bottom only: its sides are still the card's.
    expect(
      paddedClasses({
        cardAttributes: `bodyClassName="-mb-6"`,
        body: `      <div className="px-6 pb-6">Rows</div>`,
      }),
    ).toEqual([["px-6"]]);
    // A body class that bleeds nothing lets nothing pad.
    expect(
      paddedClasses({
        cardAttributes: `bodyClassName="mt-6"`,
        body: `      <div className="px-6">Rows</div>`,
      }),
    ).toEqual([["px-6"]]);
    // The card's body class from another module.
    expect(
      paddedClasses({
        head: `import { HOME_ROW } from "./HomeRowCard";`,
        cardAttributes: `bodyClassName={HOME_ROW}`,
        body: `      <div className="px-5 md:px-6">Rows</div>`,
        imports: {
          "./HomeRowCard": `export const HOME_ROW: string = "mt-3 -mx-5 -mb-6 md:-mx-6";`,
        },
      }),
    ).toEqual([]);
  });

  test("a ruled body read through Common's hook bleeds to the card's edges, on a page and in a section", () => {
    // What the hook gives, on either surface: both bleed the sides and the bottom.
    for (const ruled of [
      CARD_RULED_BODY_CLASS_NAME,
      CARD_SECTION_RULED_BODY_CLASS_NAME,
    ]) {
      expect(paddingClassesOf(`${ruled} px-5 py-5 md:px-6`)).toEqual([]);
    }

    // The hook itself, read from Common's CardSurface as a details card calls it.
    const module: ExampleModule = {
      head: `import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";`,
      before: `  const bodyClassName: string = useCardRuledBodyClassName();`,
      body: "      <div className={`${bodyClassName} px-5 py-5 md:px-6`}>Fields</div>",
    };

    expect(
      scanCardBodyPadding(
        { file: EXAMPLE_FILE, text: exampleText(module) },
        { readImport: READ_REPOSITORY_IMPORT },
      ).paddings,
    ).toEqual([]);
    // Without reading the hook, the padding is all the scan sees.
    expect(paddedClasses(module)).toEqual([["px-5", "py-5", "md:px-6"]]);
  });

  test("a class name is followed through helpers, conditions, re-exports and default exports", () => {
    const bleed: string = `export const BLEED: string = "-mx-6 -mb-6";`;

    // A helper of another module, choosing between two constants.
    expect(
      paddedClasses({
        head: `import { bodyFor } from "./Surface";`,
        body: "      <div className={`${bodyFor(props.isWide)} px-6 pb-6`}>Rows</div>",
        imports: {
          "./Surface": [
            `const WIDE: string = "-mx-6 -mb-6";`,
            `const NARROW: string = "-mx-4 -mb-4";`,
            `export function bodyFor(isWide: boolean): string {`,
            `  return isWide ? WIDE : NARROW;`,
            `}`,
          ].join("\n"),
        },
      }),
    ).toEqual([]);
    // Re-exported by name from a third module.
    expect(
      paddedClasses({
        head: `import { BLEED } from "./Index";`,
        body: "      <div className={`${BLEED} px-6 pb-6`}>Rows</div>",
        imports: {
          "./Index": `export { BLEED } from "./Bleed";`,
          "./Bleed": bleed,
        },
      }),
    ).toEqual([]);
    // A default export, under the name the importing module gives it.
    expect(
      paddedClasses({
        head: `import Bled from "./Bleed";`,
        body: "      <div className={`${Bled} px-6 pb-6`}>Rows</div>",
        imports: {
          "./Bleed": `const BLEED: string = "-mx-6 -mb-6";\nexport default BLEED;`,
        },
      }),
    ).toEqual([]);
    // An import renamed where it is imported.
    expect(
      paddedClasses({
        head: `import { BLEED as EDGE } from "./Bleed";`,
        body: "      <div className={`${EDGE} px-6 pb-6`}>Rows</div>",
        imports: { "./Bleed": bleed },
      }),
    ).toEqual([]);
    // A property of something is not a name of the module.
    expect(
      paddedClasses({
        head: `const BLEED: string = "-mx-6 -mb-6";`,
        body: "      <div className={`${props.BLEED} px-6`}>Rows</div>",
      }),
    ).toEqual([["px-6"]]);
  });

  test("names that read each other end the scan, and two modules importing each other too", () => {
    expect(
      paddedClasses({
        head: [
          `import { B } from "./B";`,
          `const A: string = B + " px-2";`,
          `let C: string = "pb-2";`,
          `C = C + " pl-1";`,
        ].join("\n"),
        body: "      <div className={`${A} ${C}`}>Rows</div>",
        imports: {
          "./B": `import { A } from "./A";\nexport const B: string = A;`,
          "./A": `import { B } from "./B";\nexport const A: string = B;`,
        },
      }),
    ).toEqual([["px-2", "pb-2", "pl-1"]]);
  });

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
          `      <div className={("p-2" as string)}>Four</div>`,
        ].join("\n"),
      }),
    ).toEqual([["px-6", "pb-6"], ["pl-4"], ["pr-4"], ["p-2"]]);
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

  test("paddingClassesOf reads an element's tag and its card's body class as the scan does", () => {
    expect(
      paddingClassesOf({ classNames: "list-disc pl-5", tag: "ul" }),
    ).toEqual([]);
    expect(
      paddingClassesOf({ classNames: "list-disc pl-5", tag: "div" }),
    ).toEqual(["pl-5"]);
    expect(
      paddingClassesOf({
        classNames: "px-5 py-2 md:px-6",
        cardBodyClassNames: "mt-3 -mx-5 -mb-6 md:-mx-6",
      }),
    ).toEqual([]);
  });
});

describe("the repository's import reader", () => {
  const fromDashboard: string = `${DASHBOARD_SOURCE}/Components/Home/NeedsAttention.tsx`;

  test("reads Common's modules by package, and a frontend's by a relative path", () => {
    expect(
      READ_REPOSITORY_IMPORT(
        "Common/UI/Components/Card/CardSurface",
        fromDashboard,
      )?.file,
    ).toBe("packages/Common/UI/Components/Card/CardSurface.ts");
    expect(READ_REPOSITORY_IMPORT("./HomeRowCard", fromDashboard)?.file).toBe(
      `${DASHBOARD_SOURCE}/Components/Home/HomeRowCard.ts`,
    );
    expect(
      READ_REPOSITORY_IMPORT("../../Utils/PageMap", fromDashboard)?.file,
    ).toBe(`${DASHBOARD_SOURCE}/Utils/PageMap.ts`);
    // What it reads is the module's text.
    expect(
      READ_REPOSITORY_IMPORT("./HomeRowCard", fromDashboard)?.text,
    ).toContain("export const HOME_ROW_CARD_BODY_CLASS_NAME");
  });

  test("reads the Dashboard's and the Admin Dashboard's own modules as ee/ names them", () => {
    expect(
      READ_REPOSITORY_IMPORT(
        "@oneuptime/dashboard/Components/Home/HomeRowCard",
        "ee/Dashboard/Index.tsx",
      )?.file,
    ).toBe(`${DASHBOARD_SOURCE}/Components/Home/HomeRowCard.ts`);
    expect(
      READ_REPOSITORY_IMPORT(
        "@oneuptime/admin-dashboard/Components/EnterpriseEdition/EnterpriseFeatureUpgrade",
        "ee/AdminDashboard/Index.tsx",
      )?.file,
    ).toBe(
      `${ADMIN_DASHBOARD_SOURCE}/Components/EnterpriseEdition/EnterpriseFeatureUpgrade.tsx`,
    );
  });

  test("reads a folder's index, and nothing for a package or a module that is not there", () => {
    expect(
      READ_REPOSITORY_IMPORT("../../Utils/Breadcrumbs", fromDashboard)?.file,
    ).toBe(`${DASHBOARD_SOURCE}/Utils/Breadcrumbs/index.ts`);
    expect(
      READ_REPOSITORY_IMPORT(
        "Common/UI/Components/HeaderAlert/NotificationBell",
        fromDashboard,
      )?.file,
    ).toBe(
      "packages/Common/UI/Components/HeaderAlert/NotificationBell/index.ts",
    );
    expect(
      READ_REPOSITORY_IMPORT(
        "Common/Tests/Helpers/NoSuchModule",
        fromDashboard,
      ),
    ).toBeUndefined();
    expect(READ_REPOSITORY_IMPORT("react", fromDashboard)).toBeUndefined();
    expect(
      READ_REPOSITORY_IMPORT("./NoSuchModule", fromDashboard),
    ).toBeUndefined();
  });
});
