import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_COUNTABLE,
  OPENSTACK_COUNT_LIMIT,
  OpenStackCountBy,
  isOpenStackCountable,
} from "../../../Types/OpenStack/OpenStackCounts";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";

/*
 * What can be counted by goes straight into a statement's GROUP BY, as a column the server
 * chooses from this list, so this list is all that stands between a request's body and the
 * SQL. A word nobody chose has to answer no.
 */

describe("what can be counted", () => {
  test("is what a page asks for, and nothing more", () => {
    expect(OPENSTACK_COUNTABLE[OpenStackResourceKind.Instance]).toEqual([
      "flavor",
      "project",
    ]);
    expect(OPENSTACK_COUNTABLE[OpenStackResourceKind.Volume]).toEqual([
      "volumeType",
      "project",
    ]);
  });

  test.each(
    Object.keys(OPENSTACK_COUNTABLE).flatMap((kind: string) => {
      return (
        OPENSTACK_COUNTABLE[
          kind as OpenStackResourceKind
        ] as ReadonlyArray<OpenStackCountBy>
      ).map((by: OpenStackCountBy): [string, OpenStackCountBy] => {
        return [kind, by];
      });
    }),
  )("%s by %s can be", (kind: string, by: OpenStackCountBy) => {
    expect(isOpenStackCountable(kind, by)).toBe(true);
  });

  test.each<[unknown, unknown]>([
    [OpenStackResourceKind.Hypervisor, "project"],
    [OpenStackResourceKind.Instance, "volumeType"],
    [OpenStackResourceKind.Volume, "flavor"],
    ["Nonsense", "project"],
    [OpenStackResourceKind.Instance, "Nonsense"],
    [OpenStackResourceKind.Instance, '"kind"; DROP TABLE "OpenStackResource"'],
    [OpenStackResourceKind.Instance, "__proto__"],
    ["__proto__", "project"],
    ["constructor", "project"],
    [OpenStackResourceKind.Instance, undefined],
    [undefined, "project"],
    [null, null],
    [42, 42],
    [{ kind: "Instance" }, ["flavor"]],
    [OpenStackResourceKind.Instance, ["flavor"]],
  ])("%j by %j can't", (kind: unknown, by: unknown) => {
    expect(isOpenStackCountable(kind, by)).toBe(false);
  });

  test("holds a count to a size a card can show, however large the cloud", () => {
    expect(OPENSTACK_COUNT_LIMIT).toBeLessThanOrEqual(500);
  });
});
