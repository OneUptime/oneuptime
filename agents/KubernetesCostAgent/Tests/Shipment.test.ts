import * as assert from "assert";
import { test } from "node:test";
import { buildShipment, Shipment } from "../Shipment";
import { KubernetesCostAllocationIngestRow } from "../Types";

/*
 * Shipment.ts is Config-free (like AllocationMapper), so these tests load it
 * without the agent's required environment variables.
 */

function row(
  overrides: Partial<KubernetesCostAllocationIngestRow> = {},
): KubernetesCostAllocationIngestRow {
  return {
    windowStart: "2026-07-24T10:00:00Z",
    windowEnd: "2026-07-24T11:00:00Z",
    namespace: "prod",
    controllerKind: "deployment",
    controllerName: "api",
    podName: "api-abc",
    containerName: "api",
    totalCost: 1,
    ...overrides,
  };
}

test("buildShipment orders rows independently of the engine's ordering", (): void => {
  const forward: Shipment = buildShipment([
    row({ podName: "a" }),
    row({ podName: "b" }),
    row({ podName: "c" }),
  ]);
  const reversed: Shipment = buildShipment([
    row({ podName: "c" }),
    row({ podName: "b" }),
    row({ podName: "a" }),
  ]);

  const podsOf: (shipment: Shipment) => Array<string> = (
    shipment: Shipment,
  ): Array<string> => {
    return shipment.rows.map(
      (entry: KubernetesCostAllocationIngestRow): string => {
        return entry.podName || "";
      },
    );
  };

  assert.deepStrictEqual(podsOf(forward), ["a", "b", "c"]);
  assert.deepStrictEqual(podsOf(reversed), ["a", "b", "c"]);
});

/*
 * The restart case, and the whole point of the hash: the poller re-ships its
 * lookback windows after a restart, and the server must recognise those as
 * the SAME delivery so it dedups them chunk by chunk instead of storing the
 * window twice.
 */
test("buildShipment gives the same id to the same window shipped again", (): void => {
  const first: Shipment = buildShipment([
    row({ podName: "a" }),
    row({ podName: "b" }),
  ]);
  const second: Shipment = buildShipment([
    row({ podName: "b" }),
    row({ podName: "a" }),
  ]);

  assert.strictEqual(first.id, second.id);
});

/*
 * Costs are not hashed: an engine that re-prices a settled window must not
 * make the shipment look new, or the re-priced rows land alongside the
 * originals and the hour double-counts.
 */
test("buildShipment ignores cost changes when the row identities match", (): void => {
  const cheap: Shipment = buildShipment([row({ totalCost: 1 })]);
  const expensive: Shipment = buildShipment([row({ totalCost: 999 })]);

  assert.strictEqual(cheap.id, expensive.id);
});

test("buildShipment gives different ids to different windows and row sets", (): void => {
  const base: Shipment = buildShipment([row()]);

  const laterWindow: Shipment = buildShipment([
    row({
      windowStart: "2026-07-24T11:00:00Z",
      windowEnd: "2026-07-24T12:00:00Z",
    }),
  ]);
  const extraRow: Shipment = buildShipment([row(), row({ podName: "api-2" })]);
  const otherContainer: Shipment = buildShipment([
    row({ containerName: "sidecar" }),
  ]);

  assert.notStrictEqual(base.id, laterWindow.id);
  assert.notStrictEqual(base.id, extraRow.id);
  assert.notStrictEqual(base.id, otherContainer.id);
});

/*
 * The parts are NUL-joined so a name containing the separator cannot make two
 * different workloads hash alike.
 */
test("buildShipment does not let a name forge another row's identity", (): void => {
  const split: Shipment = buildShipment([
    row({ controllerName: "api", podName: "abc" }),
  ]);
  const forged: Shipment = buildShipment([
    row({ controllerName: "api\u0000abc", podName: "" }),
  ]);

  assert.notStrictEqual(split.id, forged.id);
});

test("buildShipment handles an empty window without throwing", (): void => {
  const empty: Shipment = buildShipment([]);

  assert.deepStrictEqual(empty.rows, []);
  assert.strictEqual(empty.id.length, 32);
});

/*
 * #9969: a correction is a later reading of a window the server holds. Its
 * identity hashes its costs too, so a server older than corrections takes it
 * for another delivery of the window, and skips it, rather than for chunks
 * of the first one.
 */
test("a correction's identity never matches the first delivery's, and follows its costs", (): void => {
  const first: Shipment = buildShipment([row()]);
  const correction: Shipment = buildShipment([row()], { correction: true });
  const reconciled: Shipment = buildShipment([row({ totalCost: 0.7 })], {
    correction: true,
  });

  assert.notStrictEqual(correction.id, first.id);
  assert.notStrictEqual(reconciled.id, correction.id);
  assert.strictEqual(correction.id.length, 32);
  // The first delivery's identity still ignores costs.
  assert.strictEqual(buildShipment([row({ totalCost: 0.7 })]).id, first.id);
});

test("the same correction sent twice hashes the same, in any row order", (): void => {
  const a: Shipment = buildShipment(
    [row({ podName: "a" }), row({ podName: "b", totalCost: 3 })],
    { correction: true },
  );
  const b: Shipment = buildShipment(
    [row({ podName: "b", totalCost: 3 }), row({ podName: "a" })],
    { correction: true },
  );

  assert.strictEqual(a.id, b.id);
  assert.deepStrictEqual(a.rows, b.rows);
});
