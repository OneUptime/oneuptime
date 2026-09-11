import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  filterSloOverviewItems,
  getSloOverviewCounts,
  getSloOverviewStatusFilter,
  hasCurrentSloOverviewEvaluation,
  SloOverviewCounts,
  SloOverviewStatusFilter,
  sortSloOverviewItems,
} from "../../../Utils/Slo/SloOverview";

function monitor(name: string): Monitor {
  const item: Monitor = new Monitor();
  item.id = ObjectID.generate();
  item.name = name;
  return item;
}

function label(name: string): Label {
  const item: Label = new Label();
  item.id = ObjectID.generate();
  item.name = name;
  return item;
}

function slo(data: {
  name: string;
  status?: SloStatus | undefined;
  isEnabled?: boolean | undefined;
  monitors?: Array<Monitor> | undefined;
  labels?: Array<Label> | undefined;
}): ServiceLevelObjective {
  const item: ServiceLevelObjective = new ServiceLevelObjective();
  item.id = ObjectID.generate();
  item.name = data.name;

  if (data.status !== undefined) {
    item.sloStatus = data.status;
  }

  if (data.isEnabled !== undefined) {
    item.isEnabled = data.isEnabled;
  }

  if (data.monitors !== undefined) {
    item.monitors = data.monitors;
  }

  if (data.labels !== undefined) {
    item.labels = data.labels;
  }

  return item;
}

describe("SloOverview", () => {
  describe("status buckets and counts", () => {
    const statusBucketCases: Array<
      [SloStatus | undefined, SloOverviewStatusFilter]
    > = [
      [SloStatus.Healthy, SloOverviewStatusFilter.Healthy],
      [SloStatus.AtRisk, SloOverviewStatusFilter.AtRisk],
      [SloStatus.BudgetExhausted, SloOverviewStatusFilter.BudgetExhausted],
      [SloStatus.Misconfigured, SloOverviewStatusFilter.NotEvaluating],
      [SloStatus.Paused, SloOverviewStatusFilter.NotEvaluating],
      [undefined, SloOverviewStatusFilter.NotEvaluating],
    ];

    it.each(statusBucketCases)(
      "maps %s to %s",
      (
        status: SloStatus | undefined,
        expected: SloOverviewStatusFilter,
      ): void => {
        expect(getSloOverviewStatusFilter(slo({ name: "API", status }))).toBe(
          expected,
        );
      },
    );

    it("puts a disabled SLO in Not Evaluating even when its stale status is Healthy", () => {
      expect(
        getSloOverviewStatusFilter(
          slo({
            name: "Disabled",
            status: SloStatus.Healthy,
            isEnabled: false,
          }),
        ),
      ).toBe(SloOverviewStatusFilter.NotEvaluating);
    });

    it("counts the whole fleet without dropping unknown or disabled rows", () => {
      const counts: SloOverviewCounts = getSloOverviewCounts([
        slo({ name: "Healthy", status: SloStatus.Healthy }),
        slo({ name: "Risk", status: SloStatus.AtRisk }),
        slo({ name: "Breach", status: SloStatus.BudgetExhausted }),
        slo({ name: "Paused", status: SloStatus.Paused }),
        slo({ name: "Unknown" }),
        slo({
          name: "Disabled",
          status: SloStatus.Healthy,
          isEnabled: false,
        }),
      ]);

      expect(counts).toEqual({
        total: 6,
        healthy: 1,
        atRisk: 1,
        budgetExhausted: 1,
        notEvaluating: 3,
      });
    });

    it("returns zeroes for an empty fleet", () => {
      expect(getSloOverviewCounts([])).toEqual({
        total: 0,
        healthy: 0,
        atRisk: 0,
        budgetExhausted: 0,
        notEvaluating: 0,
      });
    });

    const currentEvaluationCases: Array<
      [SloStatus | undefined, boolean, boolean]
    > = [
      [SloStatus.Healthy, true, true],
      [SloStatus.AtRisk, true, true],
      [SloStatus.BudgetExhausted, true, true],
      [SloStatus.Paused, true, false],
      [SloStatus.Misconfigured, true, false],
      [SloStatus.Healthy, false, false],
      [undefined, true, false],
    ];

    it.each(currentEvaluationCases)(
      "treats %s with enabled=%s as current=%s",
      (
        status: SloStatus | undefined,
        isEnabled: boolean,
        expected: boolean,
      ): void => {
        expect(
          hasCurrentSloOverviewEvaluation(
            slo({ name: "API", status, isEnabled }),
          ),
        ).toBe(expected);
      },
    );
  });

  describe("filters", () => {
    const api: Monitor = monitor("Checkout API");
    const web: Monitor = monitor("Storefront Web");
    const payments: Label = label("Payments");
    const customer: Label = label("Customer-facing");
    const fleet: Array<ServiceLevelObjective> = [
      slo({
        name: "Checkout availability",
        status: SloStatus.BudgetExhausted,
        monitors: [api],
        labels: [payments, customer],
      }),
      slo({
        name: "Storefront latency",
        status: SloStatus.Healthy,
        monitors: [web],
        labels: [customer],
      }),
      slo({
        name: "Settlement freshness",
        status: SloStatus.AtRisk,
        monitors: [],
        labels: [payments],
      }),
    ];

    it("searches SLO names case-insensitively and trims the query", () => {
      expect(
        filterSloOverviewItems(fleet, { search: "  LATENCY " }).map(
          (item: ServiceLevelObjective): string => {
            return item.name || "";
          },
        ),
      ).toEqual(["Storefront latency"]);
    });

    it("lets service names satisfy the search", () => {
      expect(
        filterSloOverviewItems(fleet, { search: "checkout api" }).map(
          (item: ServiceLevelObjective): string => {
            return item.name || "";
          },
        ),
      ).toEqual(["Checkout availability"]);
    });

    it("lets label names satisfy the search", () => {
      expect(
        filterSloOverviewItems(fleet, { search: "payments" }),
      ).toHaveLength(2);
    });

    it("filters by an exact attached monitor id", () => {
      expect(
        filterSloOverviewItems(fleet, {
          monitorId: api.id!.toString(),
        }).map((item: ServiceLevelObjective): string => {
          return item.name || "";
        }),
      ).toEqual(["Checkout availability"]);
    });

    it("filters by an exact SLO label id", () => {
      expect(
        filterSloOverviewItems(fleet, {
          labelId: payments.id!.toString(),
        }).map((item: ServiceLevelObjective): string => {
          return item.name || "";
        }),
      ).toEqual(["Checkout availability", "Settlement freshness"]);
    });

    it("combines name, service, label and status filters with AND", () => {
      expect(
        filterSloOverviewItems(fleet, {
          search: "checkout",
          monitorId: api.id!.toString(),
          labelId: customer.id!.toString(),
          status: SloOverviewStatusFilter.BudgetExhausted,
        }),
      ).toEqual([fleet[0]]);

      expect(
        filterSloOverviewItems(fleet, {
          search: "checkout",
          status: SloOverviewStatusFilter.Healthy,
        }),
      ).toEqual([]);
    });

    it("treats blank search and All status as no filter", () => {
      expect(
        filterSloOverviewItems(fleet, {
          search: "   ",
          status: SloOverviewStatusFilter.All,
        }),
      ).toEqual(fleet);
    });
  });

  describe("attention-first sorting", () => {
    it("sorts breached, at-risk, setup, then healthy and alphabetizes ties", () => {
      const sorted: Array<ServiceLevelObjective> = sortSloOverviewItems([
        slo({ name: "Zulu healthy", status: SloStatus.Healthy }),
        slo({ name: "Beta risk", status: SloStatus.AtRisk }),
        slo({ name: "Alpha risk", status: SloStatus.AtRisk }),
        slo({ name: "Paused", status: SloStatus.Paused }),
        slo({ name: "Breach", status: SloStatus.BudgetExhausted }),
      ]);

      expect(
        sorted.map((item: ServiceLevelObjective): string => {
          return item.name || "";
        }),
      ).toEqual([
        "Breach",
        "Alpha risk",
        "Beta risk",
        "Paused",
        "Zulu healthy",
      ]);
    });

    it("does not mutate the caller's array", () => {
      const original: Array<ServiceLevelObjective> = [
        slo({ name: "Healthy", status: SloStatus.Healthy }),
        slo({ name: "Breach", status: SloStatus.BudgetExhausted }),
      ];

      sortSloOverviewItems(original);

      expect(
        original.map((item: ServiceLevelObjective) => {
          return item.name;
        }),
      ).toEqual(["Healthy", "Breach"]);
    });
  });
});
