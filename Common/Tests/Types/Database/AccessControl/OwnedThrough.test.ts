import { describe, expect, test } from "@jest/globals";
import OwnedThrough, {
  OwnedThroughMetadata,
} from "../../../../Types/Database/AccessControl/OwnedThrough";

/*
 * OwnedThrough is what tells the Owned access scope which parent resource
 * a row inherits its visibility from. Getting the SHAPE wrong here is not a
 * type error anywhere - the metadata is read off the prototype at query
 * time - it is a silently wrong WHERE clause, which in this direction means
 * showing rows to people who should not see them.
 *
 * Fakes rather than real models on purpose: the decorator only ever stores
 * what it is handed, and pulling real database models in would drag the ORM
 * into a test about an object literal.
 */

class FakeMonitor {}
class FakeService {}
class FakeHost {}

function metadataOf(ctr: unknown): OwnedThroughMetadata {
  return (ctr as { prototype: { ownedThrough: OwnedThroughMetadata } })
    .prototype.ownedThrough;
}

describe("OwnedThrough", () => {
  test("records the foreign key column and its single parent model", () => {
    @OwnedThrough("monitorId", FakeMonitor)
    class MonitorLog {}

    expect(metadataOf(MonitorLog)).toEqual({
      fkColumn: "monitorId",
      parentModels: [FakeMonitor],
      includeProjectScope: false,
    });
  });

  /*
   * A polymorphic FK - a telemetry row's serviceId may point at a Service,
   * a Host or a cluster - has to union the owned ids across every parent
   * type. A single parent must therefore normalize to a one-element array,
   * so callers never have to ask which shape they were given.
   */
  test("normalizes a single parent model into an array", () => {
    @OwnedThrough("serviceId", FakeService)
    class TelemetryRow {}

    expect(Array.isArray(metadataOf(TelemetryRow).parentModels)).toBe(true);
    expect(metadataOf(TelemetryRow).parentModels).toHaveLength(1);
  });

  test("keeps several parent models, in the order given", () => {
    @OwnedThrough("serviceId", [FakeService, FakeHost, FakeMonitor])
    class PolymorphicRow {}

    expect(metadataOf(PolymorphicRow).parentModels).toEqual([
      FakeService,
      FakeHost,
      FakeMonitor,
    ]);
  });

  /*
   * The default is the restrictive one. includeProjectScope widens Owned to
   * rows tagged with the project id itself - the unattributed telemetry
   * bucket - and a decorator that turned that on by default would quietly
   * widen every model that never asked for it.
   */
  test("does not include project scope unless asked", () => {
    @OwnedThrough("serviceId", FakeService)
    class WithoutOptions {}

    @OwnedThrough("serviceId", FakeService, {})
    class WithEmptyOptions {}

    expect(metadataOf(WithoutOptions).includeProjectScope).toBe(false);
    expect(metadataOf(WithEmptyOptions).includeProjectScope).toBe(false);
  });

  test("includes project scope when asked", () => {
    @OwnedThrough("serviceId", [FakeService, FakeHost], {
      includeProjectScope: true,
    })
    class UnattributedTelemetry {}

    expect(metadataOf(UnattributedTelemetry).includeProjectScope).toBe(true);
  });

  test("treats an explicit false as false", () => {
    @OwnedThrough("serviceId", FakeService, { includeProjectScope: false })
    class Explicit {}

    expect(metadataOf(Explicit).includeProjectScope).toBe(false);
  });

  /*
   * Each decorated class must carry its own metadata. They all inherit from
   * Object.prototype, so a decorator that wrote anywhere shared would give
   * every model the last one's foreign key.
   */
  test("keeps each decorated class's metadata to itself", () => {
    @OwnedThrough("monitorId", FakeMonitor)
    class First {}

    @OwnedThrough("serviceId", FakeService, { includeProjectScope: true })
    class Second {}

    expect(metadataOf(First).fkColumn).toBe("monitorId");
    expect(metadataOf(First).includeProjectScope).toBe(false);
    expect(metadataOf(Second).fkColumn).toBe("serviceId");
    expect(metadataOf(Second).includeProjectScope).toBe(true);
  });

  test("is visible on instances, which is where the scope reads it", () => {
    @OwnedThrough("monitorId", FakeMonitor)
    class MonitorLog {}

    expect(
      (new MonitorLog() as unknown as { ownedThrough: OwnedThroughMetadata })
        .ownedThrough.fkColumn,
    ).toBe("monitorId");
  });

  test("leaves an undecorated class with no metadata at all", () => {
    class Undecorated {}

    expect(
      (
        new Undecorated() as unknown as {
          ownedThrough: OwnedThroughMetadata | undefined;
        }
      ).ownedThrough,
    ).toBeUndefined();
  });
});
