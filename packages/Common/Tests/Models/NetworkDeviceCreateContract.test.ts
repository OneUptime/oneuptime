import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import Permission from "../../Types/Permission";

/*
 * What a caller must supply to create a NetworkDevice — and, just as
 * importantly, what it must NOT be asked for.
 *
 * `DatabaseService.checkRequiredFields` runs before any permission branch and
 * before the row reaches Postgres, and it rejects a create unless every
 * required column either has a value or is marked `isDefaultValueColumn`. A
 * column that is `required: true`, has no default flag, and carries an empty
 * `create` access-control list is therefore UNSATISFIABLE: nobody is allowed
 * to set it and the check will not let it through unset. Every create path
 * fails — the dashboard form, the CRUD API, the discovery auto-import, seeding
 * — with a message that reads like a validation error rather than the
 * contradiction it is.
 *
 * `nextPollAt` became `required: true` when the polling claim's index needed a
 * NOT NULL column to order by. Nothing else about that change is visible from
 * the create path, which is exactly why it is pinned here.
 */
describe("creating a NetworkDevice", () => {
  const device: NetworkDevice = new NetworkDevice();

  /** Required columns the caller is actually expected to provide. */
  function callerSuppliedRequiredColumns(): Array<string> {
    return device.getRequiredColumns().columns.filter((column: string) => {
      return !device.isDefaultValueColumn(column);
    });
  }

  /*
   * The identity of a device, and nothing else. Adding to this list is a
   * breaking API change and should be a deliberate edit to this test.
   */
  test("asks the caller for exactly the four columns that identify a device", () => {
    expect(callerSuppliedRequiredColumns().sort()).toEqual([
      "hostname",
      "name",
      "projectId",
      "slug",
    ]);
  });

  /*
   * The general rule the case above is one instance of. Stated separately so a
   * future column that falls into the same trap fails with a message that
   * explains it.
   *
   * The slug is excluded because `DatabaseService.create` fills it in from the
   * name (`generateSlug`) BEFORE `checkRequiredFields` runs — so it is
   * required, unsettable by any caller, and still satisfiable. That is the
   * only sanctioned way to be all three, and it is what makes the rest of this
   * assertion meaningful.
   */
  test("never requires a column that no caller is permitted to set", () => {
    const filledInByTheFramework: Array<string> = [
      device.getSaveSlugToColumn() || "",
    ];

    const unsatisfiable: Array<string> = callerSuppliedRequiredColumns()
      .filter((column: string) => {
        return !filledInByTheFramework.includes(column);
      })
      .filter((column: string) => {
        const createPermissions: Array<Permission> =
          device.getColumnAccessControlFor(column)?.create || [];

        return createPermissions.length === 0;
      });

    expect(unsatisfiable).toEqual([]);
  });

  /*
   * ...and the exception really is an exception: the slug column is the one
   * that is filled in for the caller, and it comes from a column the caller
   * DOES supply. If slugification were ever removed, the test above would go
   * quietly permissive rather than red.
   */
  test("the slug is derived from a column the caller supplies", () => {
    expect(device.getSaveSlugToColumn()).toBe("slug");
    expect(callerSuppliedRequiredColumns()).toContain(
      device.getSlugifyColumn(),
    );
  });

  /*
   * `nextPollAt` specifically: NOT NULL in the database with a `now()` default,
   * write-protected on create, and therefore filled in by Postgres. "Due now"
   * is what a NULL used to mean, so a freshly created device is still polled on
   * the assigned probe's next claim cycle.
   */
  test("nextPollAt is the database's to fill in, not the caller's", () => {
    expect(device.isDefaultValueColumn("nextPollAt")).toBe(true);
    expect(device.getRequiredColumns().columns).toContain("nextPollAt");
    expect(
      device.getColumnAccessControlFor("nextPollAt")?.create || [],
    ).toEqual([]);
  });
});
