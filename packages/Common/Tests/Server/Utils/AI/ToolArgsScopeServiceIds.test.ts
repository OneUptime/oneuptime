import { ToolArgs } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * scopeServiceIds decides the `serviceIds` / `excludedServiceIds` filter the
 * aggregation tools hand to the raw-SQL aggregation services. The aggregation
 * services treat a missing/empty serviceIds as "no filter" (whole project),
 * so for a label- or Owned-restricted user this helper must NEVER return
 * undefined or [] - and services a block with labels takes away are left out
 * whatever else holds. These tests pin that invariant.
 */

const NO_RESOURCE: string = ObjectID.getZeroObjectID().toString();

function idsOf(ids: Array<ObjectID> | undefined): Array<string> | undefined {
  return ids?.map((id: ObjectID): string => {
    return id.toString();
  });
}

function scope(
  readableIds: Array<ObjectID> | null,
  blockedIds: Array<ObjectID> = [],
): TelemetryReadScope {
  return {
    readableIds: readableIds ? (idsOf(readableIds) as Array<string>) : null,
    blockedIds: idsOf(blockedIds) as Array<string>,
  };
}

describe("ToolArgs.scopeServiceIds", () => {
  test("unrestricted user, no requested service → no filter", () => {
    const filter: TelemetryServiceFilter = ToolArgs.scopeServiceIds(
      scope(null),
      undefined,
    );

    expect(filter.serviceIds).toBeUndefined();
    expect(filter.excludedServiceIds).toBeUndefined();
  });

  test("unrestricted user with a requested service → just that service", () => {
    const requested: ObjectID = ObjectID.generate();

    expect(
      idsOf(ToolArgs.scopeServiceIds(scope(null), requested).serviceIds),
    ).toEqual([requested.toString()]);
  });

  test("restricted user, no requested service → the accessible set", () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();

    expect(
      idsOf(ToolArgs.scopeServiceIds(scope([a, b]), undefined).serviceIds),
    ).toEqual([a.toString(), b.toString()]);
  });

  test("restricted user requesting an accessible service → intersection", () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();

    expect(
      idsOf(ToolArgs.scopeServiceIds(scope([a, b]), b).serviceIds),
    ).toEqual([b.toString()]);
  });

  test("restricted user requesting a forbidden service → no-match sentinel, never empty", () => {
    const accessible: ObjectID = ObjectID.generate();
    const forbidden: ObjectID = ObjectID.generate();

    expect(
      idsOf(ToolArgs.scopeServiceIds(scope([accessible]), forbidden).serviceIds),
    ).toEqual([NO_RESOURCE]);
  });

  test("restricted user with no accessible services → no-match sentinel, never empty", () => {
    expect(
      idsOf(ToolArgs.scopeServiceIds(scope([]), undefined).serviceIds),
    ).toEqual([NO_RESOURCE]);
  });

  test("a project-wide user with a labelled block keeps every service but the blocked ones", () => {
    const blocked: ObjectID = ObjectID.generate();
    const filter: TelemetryServiceFilter = ToolArgs.scopeServiceIds(
      scope(null, [blocked]),
      undefined,
    );

    expect(filter.serviceIds).toBeUndefined();
    expect(idsOf(filter.excludedServiceIds)).toEqual([blocked.toString()]);
  });

  test("a project-wide user asking for a blocked service matches nothing", () => {
    const blocked: ObjectID = ObjectID.generate();
    const filter: TelemetryServiceFilter = ToolArgs.scopeServiceIds(
      scope(null, [blocked]),
      blocked,
    );

    expect(idsOf(filter.serviceIds)).toEqual([NO_RESOURCE]);
    expect(idsOf(filter.excludedServiceIds)).toEqual([blocked.toString()]);
  });

  test("a restricted user never reads a blocked service, even one their labels reach", () => {
    const readable: ObjectID = ObjectID.generate();
    const alsoBlocked: ObjectID = ObjectID.generate();

    expect(
      idsOf(
        ToolArgs.scopeServiceIds(
          scope([readable, alsoBlocked], [alsoBlocked]),
          undefined,
        ).serviceIds,
      ),
    ).toEqual([readable.toString()]);
  });
});
