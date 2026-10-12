import type DatabaseService from "../../../../Server/Services/DatabaseService";
import ContiguousOrder from "../../../../Server/Utils/Database/ContiguousOrder";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import ObjectID from "../../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ContiguousOrder keeps a list numbered 1..n by its `order` column
 * contiguous after a row is created at a place, moved, or deleted: the rows
 * it displaces step one place aside, as root, and the written row itself is
 * never touched.
 *
 * The service here is a stand-in that keeps rows in memory, records every
 * read and write, and - like a real read - may hand back rows the query
 * would not match, so that the in-memory guards are exercised too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "9c1f2d3e-1111-4222-8333-444455556666",
);

function idOf(n: number): ObjectID {
  return new ObjectID(
    `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  );
}

interface FakeRow {
  id: ObjectID | null;
  order: number | null | string;
}

interface Write {
  id: string;
  order: number;
  isRoot: boolean;
}

class FakeService {
  public rows: Array<FakeRow> = [];
  public writes: Array<Write> = [];
  public reads: Array<Record<string, unknown>> = [];

  public async findBy(data: Record<string, unknown>): Promise<Array<FakeRow>> {
    this.reads.push(data);
    // Hands back every row: the guards in ContiguousOrder must hold anyway.
    return this.rows.map((row: FakeRow) => {
      return { ...row };
    });
  }

  public async updateOneBy(data: {
    query: { _id: string };
    data: { order: number };
    props: { isRoot?: boolean };
  }): Promise<number> {
    this.writes.push({
      id: data.query._id,
      order: data.data.order,
      isRoot: Boolean(data.props.isRoot),
    });

    const row: FakeRow | undefined = this.rows.find((item: FakeRow) => {
      return item.id?.toString() === data.query._id;
    });

    if (row) {
      row.order = data.data.order;
    }

    return 1;
  }

  public orderOf(n: number): number | null | string | undefined {
    return this.rows.find((row: FakeRow) => {
      return row.id?.toString() === idOf(n).toString();
    })?.order;
  }

  public asService(): DatabaseService<StatusPageGroup> {
    return this as unknown as DatabaseService<StatusPageGroup>;
  }
}

function list(): Record<string, unknown> {
  return { projectId: PROJECT_ID, statusPageId: STATUS_PAGE_ID };
}

// Rows 1..n at orders 1..n.
function seed(service: FakeService, count: number): void {
  for (let n: number = 1; n <= count; n++) {
    service.rows.push({ id: idOf(n), order: n });
  }
}

function writesById(service: FakeService): Record<number, number> {
  const result: Record<number, number> = {};

  for (const write of service.writes) {
    for (let n: number = 1; n <= 50; n++) {
      if (idOf(n).toString() === write.id) {
        result[n] = write.order;
      }
    }
  }

  return result;
}

describe("ContiguousOrder", () => {
  let service: FakeService;

  beforeEach(() => {
    service = new FakeService();
  });

  describe("afterCreate", () => {
    test("moves every other row at the new row's place or after it one place down", async () => {
      // Rows 1..4 at 1..4; row 5 was just created at order 2.
      seed(service, 4);
      service.rows.push({ id: idOf(5), order: 2 });

      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(5),
        order: 2,
      });

      expect(writesById(service)).toEqual({ 2: 3, 3: 4, 4: 5 });
      expect(service.orderOf(1)).toBe(1);
      expect(service.orderOf(5)).toBe(2);
    });

    test("never moves the created row itself", async () => {
      seed(service, 3);
      service.rows.push({ id: idOf(9), order: 1 });

      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(9),
        order: 1,
      });

      expect(
        service.writes.some((write: Write) => {
          return write.id === idOf(9).toString();
        }),
      ).toBe(false);
      expect(writesById(service)).toEqual({ 1: 2, 2: 3, 3: 4 });
    });

    test("moves nothing when the row was created at the end", async () => {
      seed(service, 3);
      service.rows.push({ id: idOf(4), order: 4 });

      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(4),
        order: 4,
      });

      expect(service.writes).toEqual([]);
    });

    test("moves nothing in an otherwise empty list", async () => {
      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(1),
        order: 1,
      });

      expect(service.writes).toEqual([]);
    });

    test("reads only the list's rows from the place on, ascending, as root", async () => {
      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(1),
        order: 3,
      });

      expect(service.reads).toHaveLength(1);

      const read: Record<string, unknown> = service.reads[0]!;
      const query: Record<string, unknown> = read["query"] as Record<
        string,
        unknown
      >;

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["statusPageId"]).toBe(STATUS_PAGE_ID);
      expect(query["order"]).toBeDefined();
      expect(read["select"]).toEqual({ _id: true, order: true });
      expect(read["sort"]).toEqual({ order: "ASC" });
      expect(read["skip"]).toBe(0);
      expect(read["props"]).toEqual({ isRoot: true });
    });

    test("writes as root", async () => {
      seed(service, 2);

      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(99),
        order: 1,
      });

      expect(service.writes.length).toBe(2);
      for (const write of service.writes) {
        expect(write.isRoot).toBe(true);
      }
    });
  });

  describe("afterMove", () => {
    test("moving up: the rows from the new place to the old one step down", async () => {
      // Row 4 moved from 4 to 2.
      seed(service, 5);
      service.rows[3]!.order = 2;

      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(4),
        previousOrder: 4,
        newOrder: 2,
      });

      expect(writesById(service)).toEqual({ 2: 3, 3: 4 });
      expect(
        [1, 2, 3, 4, 5].map((n: number) => {
          return service.orderOf(n);
        }),
      ).toEqual([1, 3, 4, 2, 5]);
    });

    test("moving down: the rows after the old place, up to the new one, step up", async () => {
      // Row 2 moved from 2 to 4.
      seed(service, 5);
      service.rows[1]!.order = 4;

      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(2),
        previousOrder: 2,
        newOrder: 4,
      });

      expect(writesById(service)).toEqual({ 3: 2, 4: 3 });
      expect(
        [1, 2, 3, 4, 5].map((n: number) => {
          return service.orderOf(n);
        }),
      ).toEqual([1, 4, 2, 3, 5]);
    });

    test("moving down never touches the rows above the old place", async () => {
      // Regression shape of the schedule-layer bug: rows above must keep their order.
      seed(service, 4);
      service.rows[1]!.order = 4;

      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(2),
        previousOrder: 2,
        newOrder: 4,
      });

      expect(service.orderOf(1)).toBe(1);
      expect(
        service.writes.some((write: Write) => {
          return write.id === idOf(1).toString();
        }),
      ).toBe(false);
    });

    test("moving to the top shifts every row above the old place", async () => {
      seed(service, 3);
      service.rows[2]!.order = 1;

      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(3),
        previousOrder: 3,
        newOrder: 1,
      });

      expect(
        [1, 2, 3].map((n: number) => {
          return service.orderOf(n);
        }),
      ).toEqual([2, 3, 1]);
    });

    test("moving to the bottom shifts every row below the old place", async () => {
      seed(service, 3);
      service.rows[0]!.order = 3;

      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(1),
        previousOrder: 1,
        newOrder: 3,
      });

      expect(
        [1, 2, 3].map((n: number) => {
          return service.orderOf(n);
        }),
      ).toEqual([3, 1, 2]);
    });

    test("a move to the same place reads and writes nothing", async () => {
      seed(service, 3);

      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(2),
        previousOrder: 2,
        newOrder: 2,
      });

      expect(service.reads).toEqual([]);
      expect(service.writes).toEqual([]);
    });

    test("never moves the moved row itself", async () => {
      seed(service, 4);
      service.rows[0]!.order = 3;

      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(1),
        previousOrder: 1,
        newOrder: 3,
      });

      expect(
        service.writes.some((write: Write) => {
          return write.id === idOf(1).toString();
        }),
      ).toBe(false);
    });
  });

  describe("afterDelete", () => {
    test("the rows after the deleted one close the gap", async () => {
      // Row 2 of 1..4 was deleted.
      seed(service, 4);
      service.rows.splice(1, 1);

      await ContiguousOrder.afterDelete({
        service: service.asService(),
        list: list() as never,
        order: 2,
      });

      expect(writesById(service)).toEqual({ 3: 2, 4: 3 });
      expect(service.orderOf(1)).toBe(1);
    });

    test("deleting the last row moves nothing", async () => {
      seed(service, 3);
      service.rows.pop();

      await ContiguousOrder.afterDelete({
        service: service.asService(),
        list: list() as never,
        order: 3,
      });

      expect(service.writes).toEqual([]);
    });

    test("deleting the first row moves every other row up", async () => {
      seed(service, 3);
      service.rows.shift();

      await ContiguousOrder.afterDelete({
        service: service.asService(),
        list: list() as never,
        order: 1,
      });

      expect(
        [2, 3].map((n: number) => {
          return service.orderOf(n);
        }),
      ).toEqual([1, 2]);
    });
  });

  describe("rows the read should not have returned", () => {
    test("skips rows with no id", async () => {
      service.rows.push({ id: null, order: 3 });
      service.rows.push({ id: idOf(2), order: 3 });

      await ContiguousOrder.afterDelete({
        service: service.asService(),
        list: list() as never,
        order: 1,
      });

      expect(service.writes).toEqual([
        { id: idOf(2).toString(), order: 2, isRoot: true },
      ]);
    });

    test("skips rows whose order is not a number", async () => {
      service.rows.push({ id: idOf(1), order: "not-a-number" });
      service.rows.push({ id: idOf(2), order: 5 });

      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(99),
        order: 1,
      });

      expect(writesById(service)).toEqual({ 2: 6 });
    });

    test("reads an order stored as a numeric string as its number", async () => {
      service.rows.push({ id: idOf(1), order: "3" });

      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(99),
        order: 2,
      });

      expect(writesById(service)).toEqual({ 1: 4 });
    });

    test("skips rows before the range and after its end", async () => {
      seed(service, 6);
      service.rows[4]!.order = 2;

      // Row 5 moved from 5 to 2: only rows at 2..4 (other than row 5) step down.
      await ContiguousOrder.afterMove({
        service: service.asService(),
        list: list() as never,
        movedItemId: idOf(5),
        previousOrder: 5,
        newOrder: 2,
      });

      expect(writesById(service)).toEqual({ 2: 3, 3: 4, 4: 5 });
      expect(service.orderOf(1)).toBe(1);
      expect(service.orderOf(6)).toBe(6);
    });

    test("skips a row whose order is null", async () => {
      service.rows.push({ id: idOf(1), order: null });
      service.rows.push({ id: idOf(2), order: 2 });

      await ContiguousOrder.afterCreate({
        service: service.asService(),
        list: list() as never,
        createdItemId: idOf(99),
        order: 1,
      });

      // Number(null) is 0, which is before the range.
      expect(writesById(service)).toEqual({ 2: 3 });
    });
  });
});
