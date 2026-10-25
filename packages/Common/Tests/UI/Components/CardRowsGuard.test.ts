import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  CardNestingSource,
  CardRow,
  CardRowCell,
  ImportResolver,
  makeImportResolver,
  scanCardRows,
} from "../../Helpers/CardNestingScan";

/*
 * Every row of cards ends on one line, anywhere in the product.
 *
 * "Gap between cards dont look nice. Please fix it." - the maintainer, of
 * the Security Events Overview, where a row of three cards and a row of two
 * left bare page under every card shorter than its neighbour. A card draws
 * its frame inside a box of its own, so a hand-built grid stretched the box
 * and still drew the frame only as tall as the card's content.
 *
 * Cards that sit side by side are drawn with CardGrid
 * (Common/UI/Components/Card/CardGrid): each card fills its cell, a last
 * row the cards do not fill is shared by the cards it has, and how many
 * share a row follows the room the grid has. So a grid of two columns or
 * more whose cells are whole cards - a card, a component or render helper
 * that draws one, a wrapper around one, a list of them - fails here
 * (Tests/Helpers/CardNestingScan.ts, scanCardRows). A grid of columns that
 * each stack several cards - an incident's page, its timeline beside its
 * details - is a different layout, and a grid of tiles (InfoCard, a chart
 * drawn in a frame of its own) is stretched by the grid as it is.
 *
 * The Common Test job deletes ee/ before it runs; the Enterprise Edition
 * Test workflow (test.ee.yaml) runs this guard again with ee/ present.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

/*
 * The rows of cards the overview pages draw, by file, and how many: the
 * Security Events Overview's three, and the same rows on the product's other
 * overview pages. A page that goes back to a grid of its own fails here by
 * name, as well as in the scan.
 */
const CARD_GRID_ROWS: Array<[string, number]> = [
  [`${DASHBOARD}/Pages/SecurityEvents/Overview.tsx`, 3],
  [`${DASHBOARD}/Pages/NetworkDevice/Overview.tsx`, 1],
  [`${DASHBOARD}/Pages/MessageQueue/View/Overview.tsx`, 1],
  [`${DASHBOARD}/Components/Exceptions/ExceptionExplorer.tsx`, 1],
  [`${DASHBOARD}/Components/AI/ActivityInsights/AiActivityInsightsView.tsx`, 1],
  [`${DASHBOARD}/Pages/Ceph/View/Index.tsx`, 1],
  [`${DASHBOARD}/Pages/Docker/View/Overview.tsx`, 1],
  [`${DASHBOARD}/Pages/Podman/View/Overview.tsx`, 1],
  [`${DASHBOARD}/Pages/StorageArray/View/Index.tsx`, 2],
  [`${DASHBOARD}/Components/NetworkTraffic/NetworkTrafficView.tsx`, 1],
  [`${DASHBOARD}/Components/NetworkTraffic/Meraki/MerakiTrafficView.tsx`, 1],
];

const CARD_GRID_OPENING: string = "<CardGrid";

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

let cachedSources: Array<CardNestingSource> | null = null;

function productSources(): Array<CardNestingSource> {
  if (!cachedSources) {
    cachedSources = listScanRoots(REPOSITORY_ROOT)
      .flatMap(listSourceFiles)
      .filter((file: string): boolean => {
        return file.endsWith(".tsx");
      })
      .map((file: string): CardNestingSource => {
        return { file: relative(file), text: fs.readFileSync(file, "utf8") };
      });
  }

  return cachedSources;
}

function resolverFor(sources: Array<CardNestingSource>): ImportResolver {
  return makeImportResolver(
    new Set<string>(
      sources.map((source: CardNestingSource): string => {
        return source.file;
      }),
    ),
  );
}

function describeRow(row: CardRow): string {
  return `${row.file}:${row.line} ${row.className} holds ${row.cells
    .map((cell: CardRowCell): string => {
      return cell.name;
    })
    .join(", ")}`;
}

// Scans made-up modules, as a page would write them.
function rowsIn(sources: Array<CardNestingSource>): Array<CardRow> {
  return scanCardRows(sources, resolverFor(sources));
}

function page(text: string): CardNestingSource {
  return { file: `${DASHBOARD}/Pages/Example/Index.tsx`, text };
}

describe("every row of cards ends on one line, anywhere in the product", () => {
  test("the scan reads every frontend", () => {
    const sources: Array<CardNestingSource> = productSources();

    // Every frontend's source, not a handful of files.
    expect(sources.length).toBeGreaterThan(1000);

    for (const [file] of CARD_GRID_ROWS) {
      expect([
        file,
        sources.some((source: CardNestingSource): boolean => {
          return source.file === file;
        }),
      ]).toEqual([file, true]);
    }
  });

  test("no row of cards is a grid built by hand: cards side by side are a CardGrid", () => {
    const sources: Array<CardNestingSource> = productSources();

    /*
     * Draw the cards in <CardGrid columns={2 | 3}> instead
     * (Common/UI/Components/Card/CardGrid): every card fills its cell, so
     * the row ends on one line however much each card holds.
     */
    expect(rowsIn(sources).map(describeRow)).toEqual([]);
  });

  test.each(CARD_GRID_ROWS)(
    "%s draws its rows of cards with CardGrid (%i)",
    (file: string, count: number) => {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect(text.split(CARD_GRID_OPENING).length - 1).toBe(count);
      expect(text).toContain(
        'import CardGrid from "Common/UI/Components/Card/CardGrid";',
      );
    },
  );
});

describe("the scan finds a row of cards in every shape a page writes one", () => {
  test("cards side by side, as children of a grid of two columns or more", () => {
    const rows: Array<CardRow> = rowsIn([
      page(`
const Example = () => {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="Top Detections" />
      <Card title="Riskiest Entities" />
    </div>
  );
};
export default Example;
`),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.line).toBe(4);
    expect(rows[0]!.className).toBe('"grid grid-cols-1 gap-6 lg:grid-cols-2"');
    expect(rows[0]!.cells).toEqual([
      { name: "Card", isCard: true, isRepeated: false },
      { name: "Card", isCard: true, isRepeated: false },
    ]);
  });

  test("a card in a wrapper that spans columns, a detail card, a table's card", () => {
    const rows: Array<CardRow> = rowsIn([
      page(`
const Example = () => {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      <Card title="Open Cases" />
      <CardModelDetail cardProps={{ title: "Details" }} />
      <ModelTable cardProps={{ title: "Rules" }} />
      <div className="md:col-span-2 xl:col-span-1">
        <Card title="MITRE ATT&CK Tactics" />
      </div>
    </div>
  );
};
export default Example;
`),
    ]);

    expect(
      rows[0]!.cells.map((cell: CardRowCell): string => {
        return `${cell.name}:${cell.isCard}`;
      }),
    ).toEqual([
      "Card:true",
      "CardModelDetail:true",
      "ModelTable:true",
      "div>Card:true",
    ]);
  });

  test("a list of cards, a card shown on a condition, and a container-query grid", () => {
    const rows: Array<CardRow> = rowsIn([
      page(`
const Example = () => {
  return (
    <div>
      <div className="grid gap-4 [@container(min-width:40rem)]:grid-cols-3">
        {items.map((item) => {
          return <Card key={item.id} title={item.name} />;
        })}
      </div>
      <div className="grid gap-x-5 lg:grid-cols-2">
        {isShown ? <Card title="Shown" /> : <></>}
        <Card title="Always" />
      </div>
    </div>
  );
};
export default Example;
`),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells).toEqual([
      { name: "Card", isCard: true, isRepeated: true },
    ]);
    expect(
      rows[1]!.cells.map((cell: CardRowCell): boolean => {
        return cell.isCard;
      }),
    ).toEqual([true, true]);
  });

  test("a render helper or a component of the page's own that draws a card", () => {
    const rows: Array<CardRow> = rowsIn([
      page(`
function HotspotsCard(props) {
  return (
    <Card title={props.title}>
      <ul />
    </Card>
  );
}

const Example = () => {
  const renderTopList = (title) => {
    if (!title) {
      return <Fragment />;
    }

    return (
      <Card title={title}>
        <div />
      </Card>
    );
  };

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {renderTopList("Slowest Volumes")}
        {renderTopList("Largest Volumes")}
      </div>
      <div className="grid gap-x-5 lg:grid-cols-2">
        <HotspotsCard title="Monitors" />
        <HotspotsCard title="Services" />
      </div>
    </div>
  );
};
export default Example;
`),
    ]);

    expect(
      rows.map((row: CardRow): Array<string> => {
        return row.cells.map((cell: CardRowCell): string => {
          return `${cell.name}:${cell.isCard}`;
        });
      }),
    ).toEqual([
      ["renderTopList:true", "renderTopList:true"],
      ["HotspotsCard:true", "HotspotsCard:true"],
    ]);
  });

  test("a component of another module whose root is a card", () => {
    const card: CardNestingSource = {
      file: `${DASHBOARD}/Components/Example/ServicesCard.tsx`,
      text: `
const ServicesCard = (props) => {
  return (
    <Card title={props.side}>
      <div />
    </Card>
  );
};
export default ServicesCard;
`,
    };
    const rows: Array<CardRow> = rowsIn([
      card,
      page(`
import ServicesCard from "../../Components/Example/ServicesCard";

const Example = () => {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
      <ServicesCard side="producers" />
      <ServicesCard side="consumers" />
    </div>
  );
};
export default Example;
`),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.file).toBe(`${DASHBOARD}/Pages/Example/Index.tsx`);
  });

  test("not a row of cards: CardGrid, columns that stack several cards, tiles, one column, one card", () => {
    const rows: Array<CardRow> = rowsIn([
      page(`
function Tile() {
  return <div className="rounded-xl border bg-white p-4">1</div>;
}

const Example = () => {
  return (
    <div>
      <CardGrid columns={2}>
        <Card title="Open Cases" />
        <Card title="Riskiest Entities" />
      </CardGrid>
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <Card title="What happened" />
          <Card title="Timeline" />
        </div>
        <div className="min-w-0">
          <Card title="Details" />
          <Card title="Owners" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoCard title="Monitors" />
        <Tile />
        <Tile />
      </div>
      <div className="grid grid-cols-1 gap-4">
        <Card title="One" />
        <Card title="Two" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Alone" />
      </div>
    </div>
  );
};
export default Example;
`),
    ]);

    expect(rows.map(describeRow)).toEqual([]);
  });
});
