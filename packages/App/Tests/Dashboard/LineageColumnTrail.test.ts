import { describe, expect, test } from "@jest/globals";
import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import DataAssetLineageSource from "Common/Types/DataObservability/DataAssetLineageSource";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "Common/Types/DataObservability/DataTableLineage";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  LineageColumnTrail,
  LineageHighlightSets,
  followLineageColumn,
  getLineageArrowLook,
  getLineageCardRole,
  getLineageColumnChoices,
  getLineageColumnHighlightSets,
  isLineageCardDimmed,
} from "../../FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";

/*
 * FOLLOWING ONE COLUMN UP AND DOWN A TABLE'S LINEAGE (#6665), WITHOUT A
 * BROWSER.
 *
 * The columns a table's Lineage tab offers to follow (getLineageColumnChoices):
 * those an arrow into or out of the table names, in the table's own order,
 * each once whatever its case. Where one goes (followLineageColumn): up the
 * arrows into the table to what it is built from, down the arrows out of it
 * to what is built from it, renamed on the way or built from several, each
 * way on its own, a cycle ending, and whether an arrow that says nothing of
 * its columns may carry it further. And how its way is picked out
 * (getLineageColumnHighlightSets): as an alert's are, naming no cause.
 * LineageFollowColumn.test.tsx (Common) follows one on the Lineage tab.
 */

const FOCUS: string = getLineageTableNodeId("focus");

function tableNode(
  name: string,
  side: DataLineageSide,
  depth: number,
): DataTableLineageNode {
  return {
    id: getLineageTableNodeId(name),
    kind: DataLineageNodeKind.Table,
    side,
    depth,
    name,
    dataAssetId: name,
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    hiddenUpstreamCount: 0,
    hiddenDownstreamCount: 0,
  };
}

// An arrow between two tables, with the columns it carries when its sources named them.
function feeds(
  source: string,
  target: string,
  columns?: Array<[string, string]>,
): DataTableLineageEdge {
  const from: string = getLineageTableNodeId(source);
  const to: string = getLineageTableNodeId(target);

  return {
    id: getLineageEdgeId({
      kind: DataLineageEdgeKind.Feeds,
      source: from,
      target: to,
    }),
    source: from,
    target: to,
    kind: DataLineageEdgeKind.Feeds,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
    ...(columns
      ? {
          columnMappings: columns.map(
            ([upstreamColumn, downstreamColumn]: [string, string]) => {
              return { upstreamColumn, downstreamColumn };
            },
          ),
        }
      : {}),
  };
}

function lineageOf(edges: Array<DataTableLineageEdge>): DataTableLineage {
  const names: Set<string> = new Set(["focus"]);

  for (const arrow of edges) {
    for (const end of [arrow.source, arrow.target]) {
      if (end.startsWith("table:")) {
        names.add(end.slice("table:".length));
      }
    }
  }

  return {
    focusNodeId: FOCUS,
    depth: 3,
    nodes: Array.from(names).map((name: string): DataTableLineageNode => {
      return tableNode(
        name,
        name === "focus" ? DataLineageSide.Focus : DataLineageSide.Upstream,
        name === "focus" ? 0 : -1,
      );
    }),
    edges,
    hiddenDashboardCount: 0,
    isTruncated: false,
  };
}

// The trail's columns as text, by table name: "staging=amount_cents,tax_cents".
function columnsOf(trail: LineageColumnTrail): Array<string> {
  return Array.from(trail.columns.entries())
    .map(([nodeId, names]: [string, Array<string>]): string => {
      return `${nodeId.slice("table:".length)}=${names.join(",")}`;
    })
    .sort();
}

function arrowsOf(trail: LineageColumnTrail): Array<string> {
  return Array.from(trail.edgeIds)
    .map((id: string): string => {
      const arrow: string = id.slice(id.indexOf(":") + 1);

      return arrow.split("table:").join("");
    })
    .sort();
}

describe("the columns a table's Lineage tab offers to follow", () => {
  test("those an arrow into or out of the table names: what it is built into, and what it is built from", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("staging", "focus", [
        ["id", "order_id"],
        ["amount_cents", "amount"],
      ]),
      feeds("focus", "mart", [
        ["amount", "revenue"],
        ["region", "region"],
      ]),
    ]);

    expect(getLineageColumnChoices(lineage)).toEqual([
      "amount",
      "order_id",
      "region",
    ]);
  });

  test("never one of another table's arrows, nor of an arrow that is not a table's", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("raw", "staging", [["ID", "id"]]),
      feeds("staging", "focus", [["id", "order_id"]]),
    ]);

    lineage.edges.push({
      ...feeds("focus", "mart"),
      id: "reads:x",
      kind: DataLineageEdgeKind.Reads,
      target: getLineageDashboardNodeId("board"),
      columnMappings: [
        { upstreamColumn: "secret", downstreamColumn: "secret" },
      ],
    });

    expect(getLineageColumnChoices(lineage)).toEqual(["order_id"]);
  });

  test("in the table's own order, then by name, each named as the table names it", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("staging", "focus", [
        ["a", "ZETA"],
        ["b", "alpha"],
        ["c", "Middle"],
        ["d", "unlisted_b"],
        ["e", "unlisted_a"],
      ]),
    ]);

    expect(
      getLineageColumnChoices(lineage, [
        "middle",
        "zeta",
        "created_at",
        "Alpha",
      ]),
    ).toEqual(["middle", "zeta", "Alpha", "unlisted_a", "unlisted_b"]);
  });

  test("a column named in several cases, or with spaces around it, is offered once", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("staging", "focus", [
        ["x", "Amount"],
        ["y", " amount "],
      ]),
      feeds("focus", "mart", [["AMOUNT", "revenue"]]),
    ]);

    expect(getLineageColumnChoices(lineage)).toEqual(["Amount"]);
  });

  test("no arrow next to the table names a column: nothing to offer", () => {
    expect(
      getLineageColumnChoices(
        lineageOf([feeds("staging", "focus"), feeds("focus", "mart")]),
        ["order_id"],
      ),
    ).toEqual([]);
    expect(
      getLineageColumnChoices(
        lineageOf([feeds("staging", "focus", [["", " "]])]),
      ),
    ).toEqual([]);
  });
});

describe("following a column", () => {
  /*
   * raw (capitals) -> staging -> focus -> mart -> report: staging renames
   * customer_id, amount is built from two of staging's columns, the mart
   * renames amount revenue, and the report total_revenue.
   */
  function chain(): DataTableLineage {
    return lineageOf([
      feeds("raw", "staging", [
        ["ID", "id"],
        ["CUSTOMER", "cust_id"],
        ["AMOUNT", "amount_cents"],
      ]),
      feeds("staging", "focus", [
        ["id", "order_id"],
        ["cust_id", "customer_id"],
        ["amount_cents", "amount"],
        ["tax_cents", "amount"],
      ]),
      feeds("focus", "mart", [
        ["order_id", "order_id"],
        ["amount", "revenue"],
      ]),
      feeds("mart", "report", [["revenue", "total_revenue"]]),
    ]);
  }

  test("up to what it is built from and down to what is built from it, renamed and built from several", () => {
    const trail: LineageColumnTrail = followLineageColumn(chain(), "amount");

    expect(trail.column).toBe("amount");
    expect(columnsOf(trail)).toEqual([
      "focus=amount",
      "mart=revenue",
      "raw=AMOUNT",
      "report=total_revenue",
      "staging=amount_cents,tax_cents",
    ]);
    expect(arrowsOf(trail)).toEqual([
      "focus>mart",
      "mart>report",
      "raw>staging",
      "staging>focus",
    ]);
    expect(trail.mayGoFurther).toBe(false);
  });

  test("whatever case a table writes the name in", () => {
    const trail: LineageColumnTrail = followLineageColumn(chain(), "ORDER_ID");

    expect(columnsOf(trail)).toEqual([
      "focus=ORDER_ID",
      "mart=order_id",
      "raw=ID",
      "staging=id",
    ]);
  });

  test("a column only some tables carry stops where they do", () => {
    const trail: LineageColumnTrail = followLineageColumn(
      chain(),
      "customer_id",
    );

    expect(columnsOf(trail)).toEqual([
      "focus=customer_id",
      "raw=CUSTOMER",
      "staging=cust_id",
    ]);
    expect(arrowsOf(trail)).toEqual(["raw>staging", "staging>focus"]);
  });

  test("a column no arrow names is the table's alone", () => {
    const trail: LineageColumnTrail = followLineageColumn(chain(), "notes");

    expect(columnsOf(trail)).toEqual(["focus=notes"]);
    expect(trail.edgeIds.size).toBe(0);
  });

  test("a name of nothing but spaces is followed nowhere", () => {
    const trail: LineageColumnTrail = followLineageColumn(chain(), "  ");

    expect(trail.columns.size).toBe(0);
    expect(trail.edgeIds.size).toBe(0);
    expect(trail.mayGoFurther).toBe(false);
  });

  test("each way on its own: what feeds the table is not followed down into the other tables it feeds", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("staging", "focus", [["amount_cents", "amount"]]),
      // staging's amount_cents also feeds another table: not where the table's amount goes.
      feeds("staging", "sibling", [["amount_cents", "cents"]]),
      // A table built from the mart feeds the table back? Its way down is followed, not up.
      feeds("focus", "mart", [["amount", "revenue"]]),
      feeds("other", "mart", [["x", "revenue"]]),
    ]);
    const trail: LineageColumnTrail = followLineageColumn(lineage, "amount");

    expect(columnsOf(trail)).toEqual([
      "focus=amount",
      "mart=revenue",
      "staging=amount_cents",
    ]);
    expect(trail.columns.has(getLineageTableNodeId("sibling"))).toBe(false);
    expect(trail.columns.has(getLineageTableNodeId("other"))).toBe(false);
  });

  test("a cycle ends: each table's column is followed once", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("a", "focus", [["x", "x"]]),
      feeds("focus", "a", [["x", "x"]]),
      feeds("b", "a", [["x", "x"]]),
      feeds("a", "b", [["x", "x"]]),
    ]);
    const trail: LineageColumnTrail = followLineageColumn(lineage, "x");

    expect(columnsOf(trail)).toEqual(["a=x", "b=x", "focus=x"]);
    expect(arrowsOf(trail)).toEqual(["a>b", "a>focus", "b>a", "focus>a"]);
  });

  test("two ways to one table name its column once", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("left", "focus", [["l", "total"]]),
      feeds("right", "focus", [["r", "total"]]),
      feeds("raw", "left", [["v", "l"]]),
      feeds("raw", "right", [["V", "r"]]),
    ]);
    const trail: LineageColumnTrail = followLineageColumn(lineage, "total");

    expect(trail.columns.get(getLineageTableNodeId("raw"))).toEqual(["v"]);
  });

  test("an arrow on its way that names no columns may carry it further, up or down", () => {
    const up: LineageColumnTrail = followLineageColumn(
      lineageOf([
        feeds("staging", "focus", [["amount_cents", "amount"]]),
        feeds("legacy", "staging"),
      ]),
      "amount",
    );
    const down: LineageColumnTrail = followLineageColumn(
      lineageOf([
        feeds("staging", "focus", [["amount_cents", "amount"]]),
        feeds("focus", "mart"),
      ]),
      "amount",
    );

    expect(up.mayGoFurther).toBe(true);
    expect(down.mayGoFurther).toBe(true);
    // Nothing is guessed: the arrow is not on the way, nor its table.
    expect(up.columns.has(getLineageTableNodeId("legacy"))).toBe(false);
    expect(down.edgeIds.size).toBe(1);
  });

  test("an arrow that names no columns off its way says nothing of it", () => {
    const trail: LineageColumnTrail = followLineageColumn(
      lineageOf([
        feeds("staging", "focus", [["amount_cents", "amount"]]),
        // Into a table the column never reaches.
        feeds("legacy", "elsewhere"),
        feeds("elsewhere", "focus", [["y", "order_id"]]),
      ]),
      "amount",
    );

    expect(trail.mayGoFurther).toBe(false);
  });

  test("an arrow that names columns but not this one does not carry it", () => {
    const trail: LineageColumnTrail = followLineageColumn(
      lineageOf([
        feeds("staging", "focus", [["amount_cents", "amount"]]),
        feeds("raw", "staging", [["ID", "id"]]),
      ]),
      "amount",
    );

    expect(trail.mayGoFurther).toBe(false);
    expect(trail.columns.has(getLineageTableNodeId("raw"))).toBe(false);
  });

  test("a pipeline's or a dashboard's arrow is never on a column's way", () => {
    const lineage: DataTableLineage = lineageOf([
      feeds("staging", "focus", [["amount_cents", "amount"]]),
    ]);
    const etl: string = getLineagePipelineNodeId("etl");

    lineage.edges.push({
      ...feeds("staging", "focus", [["amount_cents", "amount"]]),
      id: "writes:etl",
      kind: DataLineageEdgeKind.Writes,
      source: etl,
    });

    const trail: LineageColumnTrail = followLineageColumn(lineage, "amount");

    expect(trail.columns.has(etl)).toBe(false);
    expect(trail.edgeIds.has("writes:etl")).toBe(false);
    // A pipeline's arrow says nothing of columns, and is no reason to say it may go further.
    expect(trail.mayGoFurther).toBe(false);
  });

  test("any drawing: every arrow on the way joins two tables on it, each reached from the table along the way", () => {
    const random: SeededRandom = seededRandom(6665);
    const columns: Array<string> = ["a", "b", "c", "A", "d"];

    for (let round: number = 0; round < 300; round++) {
      const names: Array<string> = [
        "focus",
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
      ];
      const edges: Array<DataTableLineageEdge> = [];
      const seen: Set<string> = new Set();

      for (let index: number = 0; index < 4 + random(10); index++) {
        const source: string = names[random(names.length)]!;
        const target: string = names[random(names.length)]!;
        const arrow: DataTableLineageEdge = feeds(source, target);

        if (source === target || seen.has(arrow.id)) {
          continue;
        }

        seen.add(arrow.id);

        const pairs: Array<[string, string]> = [];

        for (let pair: number = 0; pair < random(4); pair++) {
          pairs.push([
            columns[random(columns.length)]!,
            columns[random(columns.length)]!,
          ]);
        }

        edges.push(feeds(source, target, random(4) === 0 ? undefined : pairs));
      }

      const lineage: DataTableLineage = lineageOf(edges);
      const column: string = columns[random(columns.length)]!;
      const trail: LineageColumnTrail = followLineageColumn(lineage, column);

      expect(trail.columns.get(FOCUS)?.[0]).toBe(column);

      // Every arrow on the way: a table on it at each end.
      for (const id of trail.edgeIds) {
        const arrow: DataTableLineageEdge = lineage.edges.find(
          (candidate: DataTableLineageEdge): boolean => {
            return candidate.id === id;
          },
        )!;

        expect({
          round,
          id,
          ends:
            trail.columns.has(arrow.source) && trail.columns.has(arrow.target),
        }).toEqual({ round, id, ends: true });
      }

      // Every table on the way, reached from the table along its arrows.
      const reached: Set<string> = new Set([FOCUS]);
      let isGrowing: boolean = true;

      while (isGrowing) {
        isGrowing = false;

        for (const id of trail.edgeIds) {
          const arrow: DataTableLineageEdge = lineage.edges.find(
            (candidate: DataTableLineageEdge): boolean => {
              return candidate.id === id;
            },
          )!;

          for (const [from, to] of [
            [arrow.source, arrow.target],
            [arrow.target, arrow.source],
          ] as Array<[string, string]>) {
            if (reached.has(from) && !reached.has(to)) {
              reached.add(to);
              isGrowing = true;
            }
          }
        }
      }

      expect({
        round,
        reached: Array.from(trail.columns.keys()).every(
          (id: string): boolean => {
            return reached.has(id);
          },
        ),
      }).toEqual({ round, reached: true });

      // No table names one column twice.
      for (const names of trail.columns.values()) {
        expect(
          new Set(
            names.map((name: string): string => {
              return name.toLowerCase();
            }),
          ).size,
        ).toBe(names.length);
      }
    }
  });
});

describe("how a column's way is picked out", () => {
  const lineage: DataTableLineage = lineageOf([
    feeds("staging", "focus", [["amount_cents", "amount"]]),
    feeds("focus", "mart", [["amount", "revenue"]]),
    feeds("other", "focus", [["x", "order_id"]]),
  ]);
  const trail: LineageColumnTrail = followLineageColumn(lineage, "amount");
  const sets: LineageHighlightSets = getLineageColumnHighlightSets(trail);

  test("its tables and arrows, as an alert's ways are; no cause, no consequence, no pipeline named", () => {
    expect(Array.from(sets.nodeIds).sort()).toEqual(
      [FOCUS, "table:mart", "table:staging"].sort(),
    );
    expect(sets.edgeIds).toEqual(trail.edgeIds);
    expect(sets.edgeIds).not.toBe(trail.edgeIds);
    expect(sets.causeNodeIds.size).toBe(0);
    expect(sets.consequenceNodeIds.size).toBe(0);
    expect(sets.dataPipelineIds.size).toBe(0);
    // No arrow on it says Cause.
    expect(sets.causeDataPipelineIds.size).toBe(0);
    expect(sets.causeEdgeIds.size).toBe(0);
  });

  test("a table off it is faint and named nothing; one on it is neither", () => {
    expect(isLineageCardDimmed(sets, "table:other")).toBe(true);
    expect(isLineageCardDimmed(sets, "table:staging")).toBe(false);
    expect(getLineageCardRole(sets, "table:staging")).toBeNull();
  });

  test("an arrow on it is drawn wide, one off it faint", () => {
    const onIt: DataTableLineageEdge = lineage.edges[0]!;
    const offIt: DataTableLineageEdge = lineage.edges[2]!;

    expect(getLineageArrowLook(onIt, FOCUS, sets).isHighlighted).toBe(true);
    expect(getLineageArrowLook(offIt, FOCUS, sets).isDimmed).toBe(true);
  });
});
