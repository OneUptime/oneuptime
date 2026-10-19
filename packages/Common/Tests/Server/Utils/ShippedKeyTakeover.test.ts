import ShippedKeyTakeover, {
  TakeoverCandidate,
} from "../../../Server/Utils/ShippedKeyTakeover";
import { describe, expect, test } from "@jest/globals";

/*
 * ShippedKeyTakeover.pickRowToTakeOver decides which row a global probe or
 * the in-cluster Runner's global agent takes over when it comes back under a
 * key no row holds: the row that already holds the key, else only a row
 * whose key is a value the repository ships - the most recently alive of
 * them - and never a row whose key is the installation's own.
 */

interface Row extends TakeoverCandidate {
  id: string;
}

const NEW_KEY: string = "7f3c9a1e5b2d4f6a8c0e9b7d5f3a1c2e";

function row(
  id: string,
  key: string | null | undefined,
  lastAlive?: Date | null,
): Row {
  return { id, key, lastAlive };
}

function pick(rows: Array<Row>, presentedKey: string = NEW_KEY): string | null {
  const picked: Row | null = ShippedKeyTakeover.pickRowToTakeOver({
    rows,
    presentedKey,
  });

  return picked ? picked.id : null;
}

describe("ShippedKeyTakeover.pickRowToTakeOver", () => {
  test("takes over the row whose key is the config.example.env placeholder", () => {
    expect(
      pick([row("bundled", "probe-1-please-change-this-to-random-value")]),
    ).toBe("bundled");
  });

  test.each([
    ["the old fallback", "secret"],
    ["the bare placeholder", "please-change-this-to-random-value"],
    ["a partially edited placeholder", "please-change-this-to-random-value-2"],
    ["a padded placeholder", "  please-change-this-to-random-value "],
    ["a blank key", "   "],
    ["an empty key", ""],
    ["no key at all", null],
  ])(
    "takes over a row whose key is %s",
    (_label: string, key: string | null) => {
      expect(pick([row("dead", key)])).toBe("dead");
    },
  );

  test("never takes over a row whose key is the installation's own", () => {
    expect(pick([row("live", "a1b2c3d4e5f60718293a4b5c6d7e8f90")])).toBeNull();
  });

  test.each([
    ["one that only resembles the fallback", "secretive-key-99"],
    ["one in other letters", "PLEASE-CHANGE-THIS-TO-RANDOM-VALUE"],
    ["one that ends like the fallback", "my-top-secret"],
  ])(
    "treats %s as the installation's own, as every other check does",
    (_label: string, key: string) => {
      expect(pick([row("live", key)])).toBeNull();
    },
  );

  test("of a live row and a dead one, takes over only the dead one", () => {
    expect(
      pick([
        row("live", "a1b2c3d4e5f60718293a4b5c6d7e8f90", new Date()),
        row("dead", "probe-1-please-change-this-to-random-value"),
      ]),
    ).toBe("dead");
  });

  test("a row that already holds the presented key is the one, before any dead row", () => {
    expect(
      pick([
        row("dead", "please-change-this-to-random-value", new Date()),
        row("already-taken-over", NEW_KEY),
      ]),
    ).toBe("already-taken-over");
  });

  test("of several dead rows, takes over the one that reported in last", () => {
    expect(
      pick([
        row(
          "older",
          "please-change-this-to-random-value",
          new Date("2026-10-01T00:00:00Z"),
        ),
        row("never", "secret", null),
        row(
          "newest",
          "probe-1-please-change-this-to-random-value",
          new Date("2026-10-18T00:00:00Z"),
        ),
        row(
          "middle",
          "please-change-this-to-random-value-2",
          new Date("2026-10-10T00:00:00Z"),
        ),
      ]),
    ).toBe("newest");
  });

  test("a dead row that never reported in comes after one that did, and ties keep their order", () => {
    expect(
      pick([
        row("never-1", "secret"),
        row("once", "secret", new Date("2026-01-01T00:00:00Z")),
      ]),
    ).toBe("once");

    expect(pick([row("never-1", "secret"), row("never-2", "secret")])).toBe(
      "never-1",
    );
  });

  test("reads a last-alive time written as text, as a JSON round-trip leaves it", () => {
    expect(
      pick([
        row("older", "secret", "2026-10-01T00:00:00.000Z" as unknown as Date),
        row("newer", "secret", "2026-10-02T00:00:00.000Z" as unknown as Date),
      ]),
    ).toBe("newer");
  });

  test("takes over nothing when there are no rows", () => {
    expect(pick([])).toBeNull();
  });

  test("does not reorder the rows it was given", () => {
    const rows: Array<Row> = [
      row("a", "secret", new Date("2026-10-01T00:00:00Z")),
      row("b", "secret", new Date("2026-10-18T00:00:00Z")),
    ];

    pick(rows);

    expect(
      rows.map((each: Row) => {
        return each.id;
      }),
    ).toEqual(["a", "b"]);
  });
});
