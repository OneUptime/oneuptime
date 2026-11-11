import { describe, expect, test } from "@jest/globals";
import {
  DataLineageDrawnTable,
  DataLineageExpandRequest,
  MAX_DATA_LINEAGE_DRAWN_TABLES,
  readDataLineageExpandRequest,
  readLineageCardId,
} from "../../../Types/DataObservability/DataLineageExpansion";
import {
  DataLineageSide,
  MAX_DATA_LINEAGE_DASHBOARDS,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
} from "../../../Types/DataObservability/DataTableLineage";

/*
 * WHAT PRESSING A LINEAGE CARD'S COUNT ASKS, READ STRICTLY (#6667).
 *
 * The route that draws more (POST /data-observability/lineage/expand)
 * reads its body with readDataLineageExpandRequest: the request, or why it
 * is refused, in words sent back as they are. A card is named by its id,
 * "table:<uuid>" or "pipeline:<uuid>"; a pipeline's card only on its own
 * drawing; a way, Upstream or Downstream; every table drawn, with its side
 * and steps, at most as many as a drawing holds; every dashboard drawn.
 * The drawing's own table is in its middle whatever the request says, a
 * table named twice is read once, and only `true` asks for columns.
 */

const FOCUS: string = "11111111-1111-4111-8111-000000000001";
const UP: string = "11111111-1111-4111-8111-000000000002";
const DOWN: string = "11111111-1111-4111-8111-000000000003";
const PIPELINE: string = "22222222-2222-4222-8222-000000000001";
const BOARD: string = "33333333-3333-4333-8333-000000000001";

function aTable(index: number): string {
  return `44444444-4444-4444-8444-${index.toString().padStart(12, "0")}`;
}

function aBody(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    focusNodeId: `table:${FOCUS}`,
    nodeId: `table:${UP}`,
    side: DataLineageSide.Upstream,
    tables: [
      { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
      { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -1 },
      { dataAssetId: DOWN, side: DataLineageSide.Downstream, depth: 1 },
    ],
    dataDashboardIds: [BOARD],
    ...fields,
  };
}

function read(fields: Record<string, unknown> = {}): DataLineageExpandRequest {
  const request: DataLineageExpandRequest | string =
    readDataLineageExpandRequest(aBody(fields));

  expect(typeof request).toBe("object");

  return request as DataLineageExpandRequest;
}

const NAME_THE_FOCUS: string =
  "Name the card the drawing is about: focusNodeId, as table:<table ID> or pipeline:<pipeline ID>.";
const NAME_THE_CARD: string =
  "Name the card to draw more of: nodeId, as table:<table ID> or pipeline:<pipeline ID>.";
const NAME_THE_TABLES: string =
  "Name the tables drawn: tables, each with its dataAssetId, side and depth.";

describe("a card's id", () => {
  test.each([
    [`table:${FOCUS}`, { kind: "table", id: FOCUS }],
    [`pipeline:${PIPELINE}`, { kind: "pipeline", id: PIPELINE }],
  ])("%s is read apart", (value: string, expected: unknown) => {
    expect(readLineageCardId(value)).toEqual(expected);
  });

  test.each([
    [`dashboard:${BOARD}`],
    [FOCUS],
    ["table:orders"],
    [`table:${FOCUS}x`],
    [`Table:${FOCUS}`],
    [` table:${FOCUS}`],
    ["table:"],
    [""],
    [42],
    [null],
    [undefined],
    [{ id: FOCUS }],
  ])("%p is no card", (value: unknown) => {
    expect(readLineageCardId(value)).toBeNull();
  });
});

describe("a request to draw more", () => {
  test("is read as it was asked", () => {
    expect(read()).toEqual({
      focusNodeId: `table:${FOCUS}`,
      nodeId: `table:${UP}`,
      side: DataLineageSide.Upstream,
      tables: [
        { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
        { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: DOWN, side: DataLineageSide.Downstream, depth: 1 },
      ],
      dataDashboardIds: [BOARD],
      withColumns: false,
    });
  });

  test.each([
    [true, true],
    [false, false],
    ["true", false],
    [1, false],
    [undefined, false],
  ])(
    "withColumns %p asks for columns: %p",
    (given: unknown, asked: boolean) => {
      expect(read({ withColumns: given }).withColumns).toBe(asked);
    },
  );

  test("the drawing's own table is in the middle at no steps, whatever the request says of it", () => {
    const tables: Array<DataLineageDrawnTable> = read({
      nodeId: `table:${FOCUS}`,
      tables: [
        { dataAssetId: FOCUS, side: DataLineageSide.Upstream, depth: -3 },
      ],
    }).tables;

    expect(tables).toEqual([
      { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
    ]);
  });

  test("the drawing's own table left out is drawn all the same", () => {
    expect(
      read({
        tables: [
          { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -1 },
        ],
      }).tables,
    ).toEqual([
      { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -1 },
      { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
    ]);
  });

  test("a table named twice is read once, as it was first named; a dashboard too", () => {
    const request: DataLineageExpandRequest = read({
      tables: [
        { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -4 },
      ],
      dataDashboardIds: [BOARD, BOARD],
    });

    expect(request.tables).toEqual([
      { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -1 },
      { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
    ]);
    expect(request.dataDashboardIds).toEqual([BOARD]);
  });

  test("no dashboards named: none drawn", () => {
    expect(read({ dataDashboardIds: undefined }).dataDashboardIds).toEqual([]);
  });

  test("the drawing's own table draws more either way", () => {
    expect(
      read({ nodeId: `table:${FOCUS}`, side: DataLineageSide.Downstream })
        .nodeId,
    ).toBe(`table:${FOCUS}`);
    expect(
      read({ nodeId: `table:${FOCUS}`, side: DataLineageSide.Upstream }).side,
    ).toBe(DataLineageSide.Upstream);
  });

  test("a pipeline's drawing: its own card draws more, each way, and a table on it", () => {
    const tables: Array<Record<string, unknown>> = [
      { dataAssetId: UP, side: DataLineageSide.Upstream, depth: -1 },
      { dataAssetId: DOWN, side: DataLineageSide.Downstream, depth: 1 },
    ];

    for (const side of [DataLineageSide.Upstream, DataLineageSide.Downstream]) {
      const request: DataLineageExpandRequest = read({
        focusNodeId: `pipeline:${PIPELINE}`,
        nodeId: `pipeline:${PIPELINE}`,
        side,
        tables,
      });

      expect(request.nodeId).toBe(`pipeline:${PIPELINE}`);
      // No table of its own in the middle.
      expect(request.tables).toEqual(tables);
    }

    expect(
      read({
        focusNodeId: `pipeline:${PIPELINE}`,
        nodeId: `table:${DOWN}`,
        side: DataLineageSide.Downstream,
        tables,
      }).nodeId,
    ).toBe(`table:${DOWN}`);
  });

  test("as many tables as a drawing holds are read", () => {
    const tables: Array<Record<string, unknown>> = [];

    for (
      let index: number = 0;
      index < MAX_DATA_LINEAGE_DRAWN_TABLES;
      index++
    ) {
      tables.push({
        dataAssetId: index === 0 ? FOCUS : index === 1 ? UP : aTable(index),
        side:
          index === 0
            ? DataLineageSide.Focus
            : index <= MAX_DATA_LINEAGE_TABLES_PER_SIDE
              ? DataLineageSide.Upstream
              : DataLineageSide.Downstream,
        depth:
          index === 0 ? 0 : index <= MAX_DATA_LINEAGE_TABLES_PER_SIDE ? -1 : 1,
      });
    }

    expect(read({ tables }).tables).toHaveLength(MAX_DATA_LINEAGE_DRAWN_TABLES);
  });
});

describe("a request refused, in words to send back", () => {
  test.each([
    ["no body", null, NAME_THE_FOCUS],
    ["a list for a body", [], NAME_THE_FOCUS],
    ["a body of words", "table", NAME_THE_FOCUS],
    ["no drawing named", aBody({ focusNodeId: undefined }), NAME_THE_FOCUS],
    [
      "a dashboard as the drawing",
      aBody({ focusNodeId: `dashboard:${BOARD}` }),
      NAME_THE_FOCUS,
    ],
    [
      "a drawing named by a bare id",
      aBody({ focusNodeId: FOCUS }),
      NAME_THE_FOCUS,
    ],
    ["no card named", aBody({ nodeId: undefined }), NAME_THE_CARD],
    [
      "a dashboard's card",
      aBody({ nodeId: `dashboard:${BOARD}` }),
      NAME_THE_CARD,
    ],
    ["a card named by a bare id", aBody({ nodeId: UP }), NAME_THE_CARD],
    [
      "a pipeline's card on a table's drawing",
      aBody({ nodeId: `pipeline:${PIPELINE}` }),
      "A pipeline's card counts the tables it does not draw only on its own drawing: name a table's card, or that pipeline's.",
    ],
    [
      "another pipeline's card on a pipeline's drawing",
      aBody({
        focusNodeId: `pipeline:${PIPELINE}`,
        nodeId: "pipeline:22222222-2222-4222-8222-000000000002",
        tables: [],
      }),
      "A pipeline's card counts the tables it does not draw only on its own drawing: name a table's card, or that pipeline's.",
    ],
    ...[undefined, "Focus", "upstream", "Sideways", 1].map(
      (side: unknown): [string, unknown, string] => {
        return [
          `the way ${JSON.stringify(side)}`,
          aBody({ side }),
          "Say which way to draw more: side, Upstream or Downstream.",
        ];
      },
    ),
    ["no tables", aBody({ tables: undefined }), NAME_THE_TABLES],
    [
      "tables that are not a list",
      aBody({ tables: { [UP]: -1 } }),
      NAME_THE_TABLES,
    ],
    ["a table that is no object", aBody({ tables: [UP] }), NAME_THE_TABLES],
    [
      "a table with no id",
      aBody({ tables: [{ side: "Upstream", depth: -1 }] }),
      NAME_THE_TABLES,
    ],
    [
      "a table not named by its id",
      aBody({
        tables: [{ dataAssetId: "orders", side: "Upstream", depth: -1 }],
      }),
      NAME_THE_TABLES,
    ],
    [
      "a table on no side",
      aBody({ tables: [{ dataAssetId: UP, side: "Left", depth: -1 }] }),
      NAME_THE_TABLES,
    ],
    [
      "a table at steps that are no whole number",
      aBody({ tables: [{ dataAssetId: UP, side: "Upstream", depth: -1.5 }] }),
      NAME_THE_TABLES,
    ],
    [
      "a table at steps given in words",
      aBody({ tables: [{ dataAssetId: UP, side: "Upstream", depth: "-1" }] }),
      NAME_THE_TABLES,
    ],
    [
      "a table further than any drawing goes",
      aBody({
        tables: [
          {
            dataAssetId: UP,
            side: "Upstream",
            depth: -(MAX_DATA_LINEAGE_DRAWN_TABLES + 1),
          },
        ],
      }),
      NAME_THE_TABLES,
    ],
    [
      "another table in the middle",
      aBody({ tables: [{ dataAssetId: UP, side: "Focus", depth: 0 }] }),
      "Only the table the drawing is about is in its middle: give every other table's side as Upstream or Downstream.",
    ],
    [
      "the card not among the tables drawn",
      aBody({ tables: [{ dataAssetId: DOWN, side: "Downstream", depth: 1 }] }),
      "The card to draw more of is not on the drawing: name it among the tables drawn.",
    ],
    [
      "a table upstream asked for more downstream",
      aBody({ side: DataLineageSide.Downstream }),
      "A table upstream has more drawn upstream, and a table downstream downstream.",
    ],
    [
      "a table downstream asked for more upstream",
      aBody({ nodeId: `table:${DOWN}` }),
      "A table upstream has more drawn upstream, and a table downstream downstream.",
    ],
    [
      "dashboards that are not a list",
      aBody({ dataDashboardIds: BOARD }),
      "Name the dashboards drawn by their IDs: dataDashboardIds.",
    ],
    [
      "a dashboard not named by its id",
      aBody({ dataDashboardIds: ["Revenue"] }),
      "Name the dashboards drawn by their IDs: dataDashboardIds.",
    ],
    [
      "a dashboard named by a number",
      aBody({ dataDashboardIds: [7] }),
      "Name the dashboards drawn by their IDs: dataDashboardIds.",
    ],
  ])("%s", (_name: string, body: unknown, refusal: string) => {
    expect(readDataLineageExpandRequest(body)).toBe(refusal);
  });

  test("more tables than any drawing holds", () => {
    const tables: Array<Record<string, unknown>> = [];

    for (
      let index: number = 0;
      index <= MAX_DATA_LINEAGE_DRAWN_TABLES;
      index++
    ) {
      tables.push({ dataAssetId: aTable(index), side: "Upstream", depth: -1 });
    }

    expect(readDataLineageExpandRequest(aBody({ tables }))).toBe(
      `Name at most ${MAX_DATA_LINEAGE_DRAWN_TABLES} drawn tables: no drawing holds more.`,
    );
  });

  test("more dashboards than any drawing holds, counted once each", () => {
    const dashboards: Array<string> = [];

    for (let index: number = 0; index <= MAX_DATA_LINEAGE_DASHBOARDS; index++) {
      dashboards.push(aTable(1000 + index));
    }

    expect(
      readDataLineageExpandRequest(aBody({ dataDashboardIds: dashboards })),
    ).toBe(
      `Name at most ${MAX_DATA_LINEAGE_DASHBOARDS} drawn dashboards: no drawing holds more.`,
    );
    // The same dashboard named past the most is one dashboard.
    expect(
      typeof readDataLineageExpandRequest(
        aBody({
          dataDashboardIds: new Array(MAX_DATA_LINEAGE_DASHBOARDS + 5).fill(
            BOARD,
          ),
        }),
      ),
    ).toBe("object");
  });

  test("a drawing holds its own table and the most each side", () => {
    expect(MAX_DATA_LINEAGE_DRAWN_TABLES).toBe(
      2 * MAX_DATA_LINEAGE_TABLES_PER_SIDE + 1,
    );
  });
});
