import RecordsBeingCreated from "../../../../Server/Utils/Database/RecordsBeingCreated";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The records whose create is still going on in this process
 * (Server/Utils/Database/RecordsBeingCreated): marked from the moment the row
 * is written until the create has announced it, so the updates its own hooks
 * make in between are known to be part of it.
 */

const ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4a001";
const OTHER_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd4a002";

describe("a record being created", () => {
  test("is known as one until its create is done, and not after", () => {
    const done: () => void = RecordsBeingCreated.start({
      tableName: "Incident",
      id: new ObjectID(ID),
    });

    expect(
      RecordsBeingCreated.isBeingCreated({ tableName: "Incident", id: ID }),
    ).toBe(true);

    done();

    expect(
      RecordsBeingCreated.isBeingCreated({ tableName: "Incident", id: ID }),
    ).toBe(false);
    expect(RecordsBeingCreated.count()).toBe(0);
  });

  test("is known by its table and its ID, both", () => {
    const done: () => void = RecordsBeingCreated.start({
      tableName: "Incident",
      id: ID,
    });

    // Another table's record with the same ID, and another of this table.
    expect(
      RecordsBeingCreated.isBeingCreated({ tableName: "Alert", id: ID }),
    ).toBe(false);
    expect(
      RecordsBeingCreated.isBeingCreated({
        tableName: "Incident",
        id: OTHER_ID,
      }),
    ).toBe(false);
    // The ID as an ObjectID, or in capitals, is the same record.
    expect(
      RecordsBeingCreated.isBeingCreated({
        tableName: "Incident",
        id: new ObjectID(ID),
      }),
    ).toBe(true);
    expect(
      RecordsBeingCreated.isBeingCreated({
        tableName: "Incident",
        id: ID.toUpperCase(),
      }),
    ).toBe(true);

    done();
  });

  test("marking it done twice does nothing more", () => {
    const first: () => void = RecordsBeingCreated.start({
      tableName: "Incident",
      id: ID,
    });
    const second: () => void = RecordsBeingCreated.start({
      tableName: "Incident",
      id: ID,
    });

    first();
    first();

    // The other create of it is still going on.
    expect(
      RecordsBeingCreated.isBeingCreated({ tableName: "Incident", id: ID }),
    ).toBe(true);

    second();

    expect(
      RecordsBeingCreated.isBeingCreated({ tableName: "Incident", id: ID }),
    ).toBe(false);
    expect(RecordsBeingCreated.count()).toBe(0);
  });

  test("nothing to name is never being created", () => {
    expect(
      RecordsBeingCreated.isBeingCreated({ tableName: undefined, id: ID }),
    ).toBe(false);
    expect(
      RecordsBeingCreated.isBeingCreated({ tableName: "Incident", id: null }),
    ).toBe(false);
  });

  test("many creates at once keep no record after they are done", () => {
    const dones: Array<() => void> = [];

    for (let index: number = 0; index < 500; index++) {
      dones.push(
        RecordsBeingCreated.start({
          tableName: "Incident",
          id: ObjectID.generate(),
        }),
      );
    }

    expect(RecordsBeingCreated.count()).toBe(500);

    for (const done of dones) {
      done();
    }

    expect(RecordsBeingCreated.count()).toBe(0);
  });
});
