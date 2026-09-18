import "../TestingUtils/Init";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import AnalyticsDataModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { describe, expect, it } from "@jest/globals";

describe("BaseAnalyticsAPI.clampAggregateLimit", () => {
  type MakeAggregateByFunction = (
    limit: unknown,
  ) => AggregateBy<AnalyticsDataModel>;

  const makeAggregateBy: MakeAggregateByFunction = (
    limit: unknown,
  ): AggregateBy<AnalyticsDataModel> => {
    return { limit } as unknown as AggregateBy<AnalyticsDataModel>;
  };

  it("clamps a client-sent limit above LIMIT_PER_PROJECT down to LIMIT_PER_PROJECT", () => {
    const aggregateBy: AggregateBy<AnalyticsDataModel> =
      makeAggregateBy(999999999);

    BaseAnalyticsAPI.clampAggregateLimit(aggregateBy);

    expect(aggregateBy.limit).toBe(LIMIT_PER_PROJECT);
  });

  it("clamps limit = LIMIT_PER_PROJECT + 1", () => {
    const aggregateBy: AggregateBy<AnalyticsDataModel> = makeAggregateBy(
      LIMIT_PER_PROJECT + 1,
    );

    BaseAnalyticsAPI.clampAggregateLimit(aggregateBy);

    expect(aggregateBy.limit).toBe(LIMIT_PER_PROJECT);
  });

  it("does NOT clamp down to 1000 — grouped charts legitimately use the full 10k", () => {
    const aggregateBy: AggregateBy<AnalyticsDataModel> =
      makeAggregateBy(LIMIT_PER_PROJECT);

    BaseAnalyticsAPI.clampAggregateLimit(aggregateBy);

    expect(aggregateBy.limit).toBe(LIMIT_PER_PROJECT);
  });

  it("leaves an in-range limit untouched", () => {
    const aggregateBy: AggregateBy<AnalyticsDataModel> = makeAggregateBy(500);

    BaseAnalyticsAPI.clampAggregateLimit(aggregateBy);

    expect(aggregateBy.limit).toBe(500);
  });

  it("leaves an absent limit for the service layer's own defaulting", () => {
    const aggregateBy: AggregateBy<AnalyticsDataModel> =
      makeAggregateBy(undefined);

    BaseAnalyticsAPI.clampAggregateLimit(aggregateBy);

    expect(aggregateBy.limit).toBeUndefined();
  });

  it("leaves a non-numeric limit untouched (existing validation handles it)", () => {
    const aggregateBy: AggregateBy<AnalyticsDataModel> =
      makeAggregateBy("not-a-number");

    BaseAnalyticsAPI.clampAggregateLimit(aggregateBy);

    expect(aggregateBy.limit).toBe("not-a-number" as unknown as number);
  });
});
