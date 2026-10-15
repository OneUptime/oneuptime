import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import {
  DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON,
  DISCOVERY_IMPORT_STOPPED_REASON,
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportSettings,
  DiscoveryImportStatus,
  getRetryableHostResults,
  isDiscoveryImportActive,
  readDiscoveryImportSettings,
  summarizeDiscoveryImportResults,
} from "../../../Types/NetworkDevice/DiscoveryImport";
import API from "../../../UI/Utils/API/API";

/*
 * The discovery import API, in memory, for the rendered Dashboard suites
 * (issues #4811-#4813). It answers the dialog's six routes the way the
 * server does - an import recorded on start, worked through a few hosts per
 * read, its failures listed with their reasons, stopped, retried with only
 * what failed - so a test drives the real dialog against a real-shaped
 * record without a network. Every other request is answered 404, so a
 * stray call fails loudly rather than reaching for a host.
 *
 * The rules it imitates are the server's own (DiscoveryImportRunner), and
 * the counts are worked out by the same shared function the server uses.
 */

const ROUTE_PREFIX: string = "/api/network-device-discovery-import";

// The routes, read off a request's path.
const START_ROUTE: RegExp = /\/network-device-discovery-import\/start$/;
const ACTIVE_ROUTE: RegExp = /\/network-device-discovery-import\/active$/;
const LATEST_ROUTE: RegExp =
  /\/network-device-discovery-import\/scan\/([^/?]+)\/latest$/;
const IMPORT_ROUTE: RegExp =
  /\/network-device-discovery-import\/import\/([^/?]+)$/;
const STOP_ROUTE: RegExp =
  /\/network-device-discovery-import\/import\/([^/?]+)\/stop$/;
const RETRY_ROUTE: RegExp =
  /\/network-device-discovery-import\/import\/([^/?]+)\/retry$/;

export interface FakeImportRecord {
  id: string;
  scanId: string;
  status: DiscoveryImportStatus;
  settings: DiscoveryImportSettings;
  results: Array<DiscoveryImportHostResult>;
  monitorTemplateName?: string | undefined;
  createdAt: string;
  completedAt?: string | undefined;
  isStopRequested?: boolean | undefined;
  retryOfImportId?: string | undefined;
  error?: string | undefined;
  isMine: boolean;
}

export interface FakeImportControl {
  // Hosts each read of a running import settles; Infinity settles all.
  hostsPerRead: number;
  // Reads of a new import before it starts: it stays Queued until then.
  queuedReads: number;
  // Hold every import where it is.
  hold: boolean;
  failDevices: Map<string, string>;
  failMonitors: Map<string, string>;
  alreadyAdded: Set<string>;
  // Monitors already made from the template (an alert policy's).
  monitorsAlreadyThere: Set<string>;
  // A start refused with these words, as the server would refuse it.
  refuseStart: string | null;
  // Every read of an import refused with these words.
  refuseReads: string | null;
  // The name each address is created under; the address when not given.
  names: Map<string, string>;
  // Addresses that answered ping only.
  pingOnly: Set<string>;
  monitorTemplateNames: Map<string, string>;
}

export interface FakeServerCall {
  method: "GET" | "POST";
  path: string;
  // What follows the "?", when anything does.
  query?: string | undefined;
  body?: JSONObject | undefined;
}

let sequence: number = 0;

function nextId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function pathOf(url: URL): string {
  const text: string = url.toString();
  const withoutQuery: string = text.split("?")[0] || "";
  const index: number = withoutQuery.indexOf("/api/");

  return index === -1 ? withoutQuery : withoutQuery.slice(index);
}

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

function refused(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: message }, {});
}

function isWorthListing(result: DiscoveryImportHostResult): boolean {
  return (
    result.device === DiscoveryImportDeviceOutcome.Failed ||
    result.device === DiscoveryImportDeviceOutcome.NotReached ||
    result.monitor === DiscoveryImportMonitorOutcome.Failed ||
    result.monitor === DiscoveryImportMonitorOutcome.Skipped
  );
}

export default class DiscoveryImportFakeServer {
  public readonly imports: Map<string, FakeImportRecord> = new Map<
    string,
    FakeImportRecord
  >();

  public readonly calls: Array<FakeServerCall> = [];

  public readonly control: FakeImportControl = {
    hostsPerRead: Infinity,
    queuedReads: 0,
    hold: false,
    failDevices: new Map<string, string>(),
    failMonitors: new Map<string, string>(),
    alreadyAdded: new Set<string>(),
    monitorsAlreadyThere: new Set<string>(),
    refuseStart: null,
    refuseReads: null,
    names: new Map<string, string>(),
    pingOnly: new Set<string>(),
    monitorTemplateNames: new Map<string, string>(),
  };

  private readonly readsBeforeStart: Map<string, number> = new Map<
    string,
    number
  >();

  public getSpy: jest.SpyInstance | null = null;
  public postSpy: jest.SpyInstance | null = null;

  /*
   * Answers API.get and API.post: the import routes from this record, and
   * everything else with `fallback` - a 404 unless the test says otherwise.
   */
  public install(fallback?: {
    get?: (path: string) => HTTPResponse<JSONObject> | HTTPErrorResponse;
    post?: (
      path: string,
      body: JSONObject,
    ) => HTTPResponse<JSONObject> | HTTPErrorResponse;
  }): this {
    this.getSpy = jest
      .spyOn(API, "get")
      .mockImplementation(async (options: unknown): Promise<never> => {
        const path: string = pathOf((options as { url: URL }).url);
        const query: string =
          (options as { url: URL }).url.toString().split("?")[1] || "";

        this.calls.push({
          method: "GET",
          path: path,
          ...(query ? { query: query } : {}),
        });

        if (!path.startsWith(ROUTE_PREFIX)) {
          return (fallback?.get?.(path) ||
            refused(404, `No fake for GET ${path}`)) as never;
        }

        return this.get(path, query) as never;
      });

    this.postSpy = jest
      .spyOn(API, "post")
      .mockImplementation(async (options: unknown): Promise<never> => {
        const path: string = pathOf((options as { url: URL }).url);
        const body: JSONObject =
          ((options as { data?: JSONObject }).data as JSONObject) || {};

        this.calls.push({ method: "POST", path: path, body: body });

        if (!path.startsWith(ROUTE_PREFIX)) {
          return (fallback?.post?.(path, body) ||
            refused(404, `No fake for POST ${path}`)) as never;
        }

        return this.post(path, body) as never;
      });

    return this;
  }

  // The bodies the dialog started imports with, in order.
  public get startBodies(): Array<JSONObject> {
    return this.calls
      .filter((call: FakeServerCall): boolean => {
        return call.method === "POST" && START_ROUTE.test(call.path);
      })
      .map((call: FakeServerCall): JSONObject => {
        return call.body || {};
      });
  }

  public countCalls(method: "GET" | "POST", route: RegExp): number {
    return this.calls.filter((call: FakeServerCall): boolean => {
      return call.method === method && route.test(call.path);
    }).length;
  }

  // An import recorded as if someone had started it before the test.
  public seed(
    record: Partial<FakeImportRecord> & { scanId: string },
  ): FakeImportRecord {
    const seeded: FakeImportRecord = {
      id: record.id || nextId(),
      status: DiscoveryImportStatus.Queued,
      settings: readDiscoveryImportSettings({}),
      results: [],
      createdAt: new Date().toISOString(),
      isMine: true,
      ...record,
    };

    this.imports.set(seeded.id, seeded);
    return seeded;
  }

  public latestFor(scanId: string): FakeImportRecord | null {
    const records: Array<FakeImportRecord> = Array.from(
      this.imports.values(),
    ).filter((record: FakeImportRecord): boolean => {
      return record.scanId === scanId;
    });

    return records[records.length - 1] || null;
  }

  public view(record: FakeImportRecord, allResults: boolean): JSONObject {
    const listed: Array<DiscoveryImportHostResult> = allResults
      ? record.results
      : record.results.filter(isWorthListing);

    return {
      id: record.id,
      scanId: record.scanId,
      status: record.status,
      settings: record.settings as unknown as JSONObject,
      progress: summarizeDiscoveryImportResults(
        record.results,
      ) as unknown as JSONObject,
      createdAt: record.createdAt,
      isMine: record.isMine,
      results: listed as unknown as Array<JSONObject>,
      ...(record.monitorTemplateName
        ? { monitorTemplateName: record.monitorTemplateName }
        : {}),
      ...(record.completedAt ? { completedAt: record.completedAt } : {}),
      ...(record.retryOfImportId
        ? { retryOfImportId: record.retryOfImportId }
        : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.isStopRequested && isDiscoveryImportActive(record.status)
        ? { isStopRequested: true }
        : {}),
    };
  }

  private get(
    path: string,
    query: string,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    if (this.control.refuseReads) {
      return refused(400, this.control.refuseReads);
    }

    if (ACTIVE_ROUTE.test(path)) {
      return ok({
        imports: Array.from(this.imports.values())
          .filter((record: FakeImportRecord): boolean => {
            return isDiscoveryImportActive(record.status);
          })
          .map((record: FakeImportRecord): JSONObject => {
            return this.view(record, false);
          }),
      });
    }

    const latest: RegExpMatchArray | null = path.match(LATEST_ROUTE);

    if (latest) {
      const record: FakeImportRecord | null = this.latestFor(
        decodeURIComponent(latest[1]!),
      );

      return ok({ import: record ? this.view(record, false) : null });
    }

    const read: RegExpMatchArray | null = path.match(IMPORT_ROUTE);

    if (read) {
      const record: FakeImportRecord | undefined = this.imports.get(
        decodeURIComponent(read[1]!),
      );

      if (!record) {
        return refused(404, "This import could not be found.");
      }

      this.settle(record);

      return ok({ import: this.view(record, query.includes("results=all")) });
    }

    return refused(404, `No fake for GET ${path}`);
  }

  private post(
    path: string,
    body: JSONObject,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    if (START_ROUTE.test(path)) {
      if (this.control.refuseStart) {
        return refused(400, this.control.refuseStart);
      }

      const settings: DiscoveryImportSettings = readDiscoveryImportSettings(
        body["settings"],
      );
      const wantsMonitors: boolean =
        settings.alerting === DiscoveryImportAlerting.MonitorTemplate;
      const addresses: Array<string> =
        (body["ipAddresses"] as Array<string>) || [];

      const record: FakeImportRecord = this.seed({
        scanId: String(body["scanId"]),
        settings: settings,
        monitorTemplateName: wantsMonitors
          ? this.control.monitorTemplateNames.get(
              settings.monitorTemplateId || "",
            ) || "Network device alert pack"
          : undefined,
        results: addresses.map(
          (ipAddress: string): DiscoveryImportHostResult => {
            return {
              ipAddress: ipAddress,
              name: this.control.names.get(ipAddress) || ipAddress,
              isPingOnly: this.control.pingOnly.has(ipAddress),
              device: DiscoveryImportDeviceOutcome.Pending,
              monitor: wantsMonitors
                ? DiscoveryImportMonitorOutcome.Pending
                : DiscoveryImportMonitorOutcome.NotRequested,
            };
          },
        ),
      });

      this.readsBeforeStart.set(record.id, this.control.queuedReads);

      return ok({ import: this.view(record, false) });
    }

    const stop: RegExpMatchArray | null = path.match(STOP_ROUTE);

    if (stop) {
      const record: FakeImportRecord | undefined = this.imports.get(
        decodeURIComponent(stop[1]!),
      );

      if (!record) {
        return refused(404, "This import could not be found.");
      }

      if (record.status === DiscoveryImportStatus.Queued) {
        this.finishStopped(record);
      } else if (record.status === DiscoveryImportStatus.Running) {
        record.isStopRequested = true;
      }

      return ok({ import: this.view(record, false) });
    }

    const retry: RegExpMatchArray | null = path.match(RETRY_ROUTE);

    if (retry) {
      const original: FakeImportRecord | undefined = this.imports.get(
        decodeURIComponent(retry[1]!),
      );

      if (!original) {
        return refused(404, "This import could not be found.");
      }

      const retryable: Array<DiscoveryImportHostResult> =
        getRetryableHostResults(original.results);

      if (isDiscoveryImportActive(original.status) || retryable.length === 0) {
        return refused(400, "There is nothing in this import to try again.");
      }

      const record: FakeImportRecord = this.seed({
        scanId: original.scanId,
        settings: original.settings,
        monitorTemplateName: original.monitorTemplateName,
        retryOfImportId: original.id,
        results: retryable.map(
          (result: DiscoveryImportHostResult): DiscoveryImportHostResult => {
            return {
              ipAddress: result.ipAddress,
              name: result.name,
              isPingOnly: result.isPingOnly,
              device: DiscoveryImportDeviceOutcome.Pending,
              monitor:
                result.monitor === DiscoveryImportMonitorOutcome.NotRequested
                  ? DiscoveryImportMonitorOutcome.NotRequested
                  : DiscoveryImportMonitorOutcome.Pending,
            };
          },
        ),
      });

      this.readsBeforeStart.set(record.id, this.control.queuedReads);

      return ok({ import: this.view(record, false) });
    }

    return refused(404, `No fake for POST ${path}`);
  }

  // One read's worth of work: the next few hosts, as the server would do them.
  private settle(record: FakeImportRecord): void {
    if (this.control.hold || !isDiscoveryImportActive(record.status)) {
      return;
    }

    const waits: number = this.readsBeforeStart.get(record.id) || 0;

    if (waits > 0) {
      this.readsBeforeStart.set(record.id, waits - 1);
      return;
    }

    if (record.isStopRequested) {
      this.finishStopped(record);
      return;
    }

    record.status = DiscoveryImportStatus.Running;

    let budget: number = this.control.hostsPerRead;

    for (const result of record.results) {
      if (budget <= 0) {
        break;
      }

      if (result.device !== DiscoveryImportDeviceOutcome.Pending) {
        continue;
      }

      budget -= 1;
      this.importHost(result);
    }

    const isDone: boolean = record.results.every(
      (result: DiscoveryImportHostResult): boolean => {
        return (
          result.device !== DiscoveryImportDeviceOutcome.Pending &&
          result.monitor !== DiscoveryImportMonitorOutcome.Pending
        );
      },
    );

    if (isDone) {
      record.status = DiscoveryImportStatus.Completed;
      record.completedAt = new Date().toISOString();
    }
  }

  private importHost(result: DiscoveryImportHostResult): void {
    const deviceFailure: string | undefined = this.control.failDevices.get(
      result.ipAddress,
    );

    if (deviceFailure) {
      result.device = DiscoveryImportDeviceOutcome.Failed;
      result.deviceError = deviceFailure;

      if (result.monitor === DiscoveryImportMonitorOutcome.Pending) {
        result.monitor = DiscoveryImportMonitorOutcome.Skipped;
        result.monitorError = DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON;
      }

      return;
    }

    result.device = this.control.alreadyAdded.has(result.ipAddress)
      ? DiscoveryImportDeviceOutcome.AlreadyAdded
      : DiscoveryImportDeviceOutcome.Created;
    result.deviceId = `device-${result.ipAddress}`;

    if (result.monitor !== DiscoveryImportMonitorOutcome.Pending) {
      return;
    }

    const monitorFailure: string | undefined = this.control.failMonitors.get(
      result.ipAddress,
    );

    if (monitorFailure) {
      result.monitor = DiscoveryImportMonitorOutcome.Failed;
      result.monitorError = monitorFailure;
      return;
    }

    result.monitor = this.control.monitorsAlreadyThere.has(result.ipAddress)
      ? DiscoveryImportMonitorOutcome.AlreadyThere
      : DiscoveryImportMonitorOutcome.Created;
    result.monitorId = `monitor-${result.ipAddress}`;
  }

  private finishStopped(record: FakeImportRecord): void {
    for (const result of record.results) {
      if (result.device === DiscoveryImportDeviceOutcome.Pending) {
        result.device = DiscoveryImportDeviceOutcome.NotReached;
        result.deviceError = DISCOVERY_IMPORT_STOPPED_REASON;
      }

      if (result.monitor === DiscoveryImportMonitorOutcome.Pending) {
        result.monitor = DiscoveryImportMonitorOutcome.Skipped;
        result.monitorError = DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON;
      }
    }

    record.status = DiscoveryImportStatus.Stopped;
    record.isStopRequested = false;
    record.completedAt = new Date().toISOString();
  }
}

export const FAKE_IMPORT_ROUTES: {
  start: RegExp;
  active: RegExp;
  latest: RegExp;
  import: RegExp;
  stop: RegExp;
  retry: RegExp;
} = {
  start: START_ROUTE,
  active: ACTIVE_ROUTE,
  latest: LATEST_ROUTE,
  import: IMPORT_ROUTE,
  stop: STOP_ROUTE,
  retry: RETRY_ROUTE,
};
