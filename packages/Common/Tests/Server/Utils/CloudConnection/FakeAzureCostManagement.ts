import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * AZURE COST MANAGEMENT IN A TEST, LIMITED AS MICROSOFT DOCUMENTS IT.
 *
 * One tenant's Query API on a clock of the test's own: every query is
 * charged a QPU for each calendar month its timePeriod touches, and one
 * that would take any of the tenant's quotas - 12 QPU in 10 seconds, 60 in
 * a minute, 600 in an hour ("Manage Azure costs with automation", Query API
 * query processing units) - past its limit is refused as Azure refuses it:
 * HTTP 429 "Too many requests. Please retry.", with
 * x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after saying in seconds
 * when it would fit. An answer carries qpu-consumed and qpu-remaining.
 *
 * It records what it was asked - each query's scope, days, QPU and time -
 * and the most QPU any window ever held, so a test can hold the read to the
 * documented limits. Other callers of the tenant (its people's cost analysis
 * in the portal) can be made to use some of the quota too.
 */

export const DOCUMENTED_QPU_QUOTAS: ReadonlyArray<{
  spanMs: number;
  limit: number;
}> = [
  { spanMs: 10 * 1000, limit: 12 },
  { spanMs: 60 * 1000, limit: 60 },
  { spanMs: 60 * 60 * 1000, limit: 600 },
];

export const FAKE_TENANT: string = "6f1d4a8b-2c3e-4d5f-8a9b-0c1d2e3f4a5b";

const COLUMNS: Array<JSONObject> = [
  { name: "Cost", type: "Number" },
  { name: "UsageDate", type: "Number" },
  { name: "ResourceId", type: "String" },
  { name: "ServiceName", type: "String" },
  { name: "Currency", type: "String" },
];

// The test's clock: what time it is, and a wait that moves it on.
export class FakeClock {
  public nowMs: number;

  public constructor(start: Date) {
    this.nowMs = start.getTime();
  }

  public now(): Date {
    return new Date(this.nowMs);
  }

  public async sleep(milliseconds: number): Promise<void> {
    this.nowMs += Math.max(0, milliseconds);
  }

  public advance(milliseconds: number): void {
    this.nowMs += milliseconds;
  }
}

export interface FakeCostQuery {
  atMs: number;
  scope: string;
  subscriptionId: string;
  from: string;
  to: string;
  qpu: number;
  // What it was answered: 200, or 429 when a quota was spent.
  status: number;
  // What its headers said, as sent.
  headers: Dictionary<string>;
  clientType: string;
}

// A QPU for each calendar month a period's days touch, as Azure deducts it.
export function qpuOfPeriod(from: string, to: string): number {
  const start: Date = new Date(from);
  const end: Date = new Date(to);

  return Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth()) +
      1,
  );
}

export class FakeAzureCostManagement {
  public readonly clock: FakeClock;
  public readonly queries: Array<FakeCostQuery> = [];
  // The most QPU any window of each quota ever held, by its span.
  public readonly mostQpuInWindow: Map<number, number> = new Map();
  public readonly api: FakeProviderApi;
  // Charges against the tenant's quotas: OneUptime's and its other callers'.
  private charges: Array<{ atMs: number; qpu: number }> = [];
  // QPU the tenant's other callers use every 10 seconds, from when until when.
  private othersQpuPer10s: number = 0;
  private othersFromMs: number = 0;
  private othersUntilMs: number = 0;
  private othersChargedUntilMs: number = 0;

  public constructor(data: {
    clock: FakeClock;
    // Each subscription's rows for a day: a cost for each resource on each day.
    resourcesPerSubscription?: number | undefined;
    // Rows a page holds, before nextLink.
    pageSize?: number | undefined;
  }) {
    this.clock = data.clock;

    const resources: number = data.resourcesPerSubscription ?? 2;
    const pageSize: number = data.pageSize ?? 5000;

    this.api = createFakeProviderApi([
      {
        host: "login.microsoftonline.com",
        path: `/${FAKE_TENANT}/oauth2/v2.0/token`,
        method: "POST",
        respond: (): FakeResponse => {
          return json({ access_token: "azure-token", expires_in: 3599 });
        },
      },
      {
        host: "management.azure.com",
        path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.CostManagement\/query$/,
        method: "POST",
        respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
          return this.answer({ request, url, resources, pageSize });
        },
      },
      {
        host: "management.azure.com",
        path: /^\/subscriptions\/[^/]+\/providers\/Microsoft\.Advisor\/recommendations$/,
        respond: (): FakeResponse => {
          return json({ value: [] });
        },
      },
    ]);
  }

  /*
   * The tenant's other callers - a person in the portal's cost analysis -
   * ask this many QPU every 10 seconds from now, for `forMs`: what fits the
   * quotas, as Azure holds them to the quotas too.
   */
  public othersUse(qpuPer10s: number, forMs: number): void {
    this.othersQpuPer10s = qpuPer10s;
    this.othersFromMs = this.clock.nowMs;
    this.othersUntilMs = this.clock.nowMs + forMs;
    this.othersChargedUntilMs = this.clock.nowMs;
  }

  // The QPU charged in the window of `spanMs` that ends at atMs.
  public usedQpu(atMs: number, spanMs: number): number {
    return this.charges
      .filter((charge: { atMs: number }): boolean => {
        return charge.atMs > atMs - spanMs && charge.atMs <= atMs;
      })
      .reduce((sum: number, charge: { qpu: number }): number => {
        return sum + charge.qpu;
      }, 0);
  }

  // The queries OneUptime sent that Azure turned away.
  public refused(): Array<FakeCostQuery> {
    return this.queries.filter((query: FakeCostQuery): boolean => {
      return query.status === 429;
    });
  }

  // The subscriptions answered in full, each with the days it was read over.
  public answeredSubscriptions(): Map<string, Array<{ from: string }>> {
    const answered: Map<string, Array<{ from: string }>> = new Map();

    for (const query of this.queries) {
      if (query.status !== 200) {
        continue;
      }

      const list: Array<{ from: string }> =
        answered.get(query.subscriptionId) || [];
      list.push({ from: query.from });
      answered.set(query.subscriptionId, list);
    }

    return answered;
  }

  private chargeOthers(): void {
    if (this.othersQpuPer10s <= 0) {
      return;
    }

    // Their use, every 10 seconds, up to now: what the quotas let them have.
    while (
      this.othersChargedUntilMs + 10_000 <= this.clock.nowMs &&
      this.othersChargedUntilMs + 10_000 <= this.othersUntilMs
    ) {
      this.othersChargedUntilMs += 10_000;

      const atMs: number = this.othersChargedUntilMs;
      const fits: boolean = DOCUMENTED_QPU_QUOTAS.every(
        (quota: { spanMs: number; limit: number }): boolean => {
          return (
            this.usedQpu(atMs, quota.spanMs) + this.othersQpuPer10s <=
            quota.limit
          );
        },
      );

      if (atMs > this.othersFromMs && fits) {
        this.charges.push({ atMs, qpu: this.othersQpuPer10s });
      }
    }
  }

  // Seconds until a query of `qpu` fits every quota; 0 when it fits now.
  private waitSeconds(qpu: number): number {
    const nowMs: number = this.clock.nowMs;
    let waitMs: number = 0;

    for (const quota of DOCUMENTED_QPU_QUOTAS) {
      const inWindow: Array<{ atMs: number; qpu: number }> = this.charges
        .filter((charge: { atMs: number }): boolean => {
          return charge.atMs > nowMs - quota.spanMs;
        })
        .sort((a: { atMs: number }, b: { atMs: number }): number => {
          return a.atMs - b.atMs;
        });
      let used: number = inWindow.reduce(
        (sum: number, charge: { qpu: number }): number => {
          return sum + charge.qpu;
        },
        0,
      );

      for (const charge of inWindow) {
        if (used + qpu <= quota.limit) {
          break;
        }

        used -= charge.qpu;
        waitMs = Math.max(waitMs, charge.atMs + quota.spanMs - nowMs);
      }
    }

    return Math.ceil(waitMs / 1000);
  }

  private noteWindows(): void {
    for (const quota of DOCUMENTED_QPU_QUOTAS) {
      this.mostQpuInWindow.set(
        quota.spanMs,
        Math.max(
          this.mostQpuInWindow.get(quota.spanMs) || 0,
          this.usedQpu(this.clock.nowMs, quota.spanMs),
        ),
      );
    }
  }

  private answer(data: {
    request: DataSourceHttpRequest;
    url: URL;
    resources: number;
    pageSize: number;
  }): FakeResponse {
    this.chargeOthers();

    const body: JSONObject = JSON.parse(
      String(data.request.body),
    ) as JSONObject;
    const period: JSONObject = (body["timePeriod"] || {}) as JSONObject;
    const from: string = String(period["from"] || "");
    const to: string = String(period["to"] || "");
    const qpu: number = qpuOfPeriod(from, to);
    const subscriptionId: string = data.url.pathname.split("/")[2]!;
    const wait: number = this.waitSeconds(qpu);
    const record: FakeCostQuery = {
      atMs: this.clock.nowMs,
      scope: `/subscriptions/${subscriptionId}`,
      subscriptionId,
      from,
      to,
      qpu,
      status: 200,
      headers: {},
      clientType: String((data.request.headers || {})["ClientType"] || ""),
    };

    this.queries.push(record);

    if (wait > 0) {
      record.status = 429;
      record.headers = {
        "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": String(wait),
        "x-ms-ratelimit-microsoft.costmanagement-qpu-consumed": "0",
      };

      return {
        status: 429,
        body: {
          error: { code: "429", message: "Too many requests. Please retry." },
        },
        headers: record.headers,
      };
    }

    this.charges.push({ atMs: this.clock.nowMs, qpu });
    this.noteWindows();

    const rows: Array<Array<unknown>> = [];
    const firstDay: Date = new Date(from);
    const lastDay: Date = new Date(to);

    for (
      let day: Date = new Date(
        Date.UTC(
          firstDay.getUTCFullYear(),
          firstDay.getUTCMonth(),
          firstDay.getUTCDate(),
        ),
      );
      day.getTime() <= lastDay.getTime();
      day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
    ) {
      const usageDate: number = Number(
        day.toISOString().slice(0, 10).replace(/-/g, ""),
      );

      for (let resource: number = 0; resource < data.resources; resource++) {
        rows.push([
          1.25,
          usageDate,
          `/subscriptions/${subscriptionId}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-${resource}`,
          "Virtual Machines",
          "USD",
        ]);
      }
    }

    const offset: number = Number(data.url.searchParams.get("$skiptoken") || 0);
    const page: Array<Array<unknown>> = rows.slice(
      offset,
      offset + data.pageSize,
    );
    const next: number = offset + data.pageSize;
    record.headers = {
      "x-ms-ratelimit-microsoft.costmanagement-qpu-consumed": String(qpu),
      "x-ms-ratelimit-microsoft.costmanagement-qpu-remaining":
        DOCUMENTED_QPU_QUOTAS.map(
          (quota: { spanMs: number; limit: number }): string => {
            return `QueryQuota${quota.spanMs / 1000}s:${
              quota.limit - this.usedQpu(this.clock.nowMs, quota.spanMs)
            }`;
          },
        ).join(","),
    };

    // Its rows as Cost Management answers them: each a list of numbers and text.
    const answer: JSONObject = {
      properties: {
        columns: COLUMNS,
        rows: page as unknown as JSONObject,
        ...(next < rows.length
          ? {
              nextLink: `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01&$skiptoken=${next}`,
            }
          : {}),
      },
    };

    return { status: 200, body: answer, headers: record.headers };
  }
}

// Fifty subscription ids, as a tenant of fifty would have them.
export function makeSubscriptionIds(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    const hex: string = index.toString(16).padStart(12, "0");
    return `aaaaaaaa-bbbb-4ccc-8ddd-${hex}`;
  });
}
