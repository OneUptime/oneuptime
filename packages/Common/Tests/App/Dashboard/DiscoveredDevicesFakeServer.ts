import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  DiscoveredDeviceCounts,
  DiscoveredDeviceRow,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
  isShownBy,
} from "../../../Types/NetworkDevice/DiscoveredDevice";

/*
 * The Discovered Devices list's API (issue #5775), in memory, for the
 * rendered Dashboard suites: the rows a project's switches, routers and
 * network controllers saw, answered the way NetworkDiscoveredDeviceAPI
 * answers them - the search, the counts, the paging and the sort are the
 * server's; Hide from map and Show on map say, row by row, what they did and
 * why they left a row alone; a monitored row is never hidden. Paired with
 * DiscoveryImportFakeServer (the import a selection is added through) as its
 * `fallback.post`.
 */

const LIST_ROUTE: RegExp = /\/network-discovered-device\/list$/;
const IDS_ROUTE: RegExp = /\/network-discovered-device\/ids$/;
const HIDE_ROUTE: RegExp = /\/network-discovered-device\/hide-from-map$/;
const SHOW_ROUTE: RegExp = /\/network-discovered-device\/show-on-map$/;
const SHOW_EVERYTHING_ROUTE: RegExp =
  /\/network-discovered-device\/show-everything-on-map$/;

export const FAKE_DISCOVERED_DEVICE_ROUTES: {
  list: RegExp;
  ids: RegExp;
  hide: RegExp;
  show: RegExp;
  showEverything: RegExp;
} = {
  list: LIST_ROUTE,
  ids: IDS_ROUTE,
  hide: HIDE_ROUTE,
  show: SHOW_ROUTE,
  showEverything: SHOW_EVERYTHING_ROUTE,
};

export interface FakeDiscoveredDevice extends DiscoveredDeviceRow {
  siteId?: string | undefined;
}

export interface FakeDiscoveredDeviceCall {
  path: string;
  body: JSONObject;
}

const MAC_SEPARATORS: RegExp = /[:.-]/g;

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

function refused(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: message }, {});
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ids(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.map((id: unknown): string => {
        return text(id).toLowerCase();
      })
    : [];
}

export default class DiscoveredDevicesFakeServer {
  public readonly devices: Map<string, FakeDiscoveredDevice> = new Map<
    string,
    FakeDiscoveredDevice
  >();

  public readonly calls: Array<FakeDiscoveredDeviceCall> = [];

  // The next request to these routes is refused with these words.
  public refuseNext: { route: RegExp; message: string } | null = null;

  public constructor(devices: Array<FakeDiscoveredDevice> = []) {
    for (const device of devices) {
      this.devices.set(device.id.toLowerCase(), { ...device });
    }
  }

  public bodiesOf(route: RegExp): Array<JSONObject> {
    return this.calls
      .filter((call: FakeDiscoveredDeviceCall): boolean => {
        return route.test(call.path);
      })
      .map((call: FakeDiscoveredDeviceCall): JSONObject => {
        return call.body;
      });
  }

  public lastBodyOf(route: RegExp): JSONObject | undefined {
    const bodies: Array<JSONObject> = this.bodiesOf(route);

    return bodies[bodies.length - 1];
  }

  /*
   * The answer to a POST, or undefined for a route that is not the list's
   * (DiscoveryImportFakeServer then answers it 404).
   */
  public answer(
    path: string,
    body: JSONObject,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse | undefined {
    const routes: Array<RegExp> = [
      LIST_ROUTE,
      IDS_ROUTE,
      HIDE_ROUTE,
      SHOW_ROUTE,
      SHOW_EVERYTHING_ROUTE,
    ];

    if (
      !routes.some((route: RegExp): boolean => {
        return route.test(path);
      })
    ) {
      return undefined;
    }

    this.calls.push({ path: path, body: body });

    if (this.refuseNext && this.refuseNext.route.test(path)) {
      const message: string = this.refuseNext.message;
      this.refuseNext = null;
      return refused(400, message);
    }

    if (LIST_ROUTE.test(path)) {
      return this.list(body);
    }

    if (IDS_ROUTE.test(path)) {
      return this.selectAll(body);
    }

    if (SHOW_EVERYTHING_ROUTE.test(path)) {
      let changed: number = 0;

      for (const device of this.devices.values()) {
        if (device.isHidden) {
          device.isHidden = false;
          changed += 1;
        }
      }

      return ok({ changed: changed });
    }

    return this.changeMap(body, HIDE_ROUTE.test(path));
  }

  // The rows a request's search and site match, before `show` and paging.
  private searched(body: JSONObject): Array<FakeDiscoveredDevice> {
    const search: string = text(body["search"]).trim().toLowerCase();
    const bareSearch: string = search.replace(MAC_SEPARATORS, "");
    const siteId: string = text(body["siteId"]);

    return Array.from(this.devices.values()).filter(
      (device: FakeDiscoveredDevice): boolean => {
        if (siteId && device.siteId !== siteId) {
          return false;
        }

        if (!search) {
          return true;
        }

        const fields: Array<string> = [
          device.name,
          device.ipAddress || "",
          device.hostname || "",
          device.vendor || "",
          device.macAddress,
        ].map((field: string): string => {
          return field.toLowerCase();
        });

        return (
          fields.some((field: string): boolean => {
            return field.includes(search);
          }) ||
          (bareSearch.length > 0 &&
            device.macAddress
              .toLowerCase()
              .replace(MAC_SEPARATORS, "")
              .includes(bareSearch))
        );
      },
    );
  }

  private sorted(
    rows: Array<FakeDiscoveredDevice>,
    body: JSONObject,
  ): Array<FakeDiscoveredDevice> {
    const sort: string = text(body["sort"]) || DiscoveredDeviceSort.LastSeen;
    const direction: number = text(body["sortOrder"]) === "asc" ? 1 : -1;

    const keyOf: (device: FakeDiscoveredDevice) => string = (
      device: FakeDiscoveredDevice,
    ): string => {
      switch (sort) {
        case DiscoveredDeviceSort.Name:
          return device.name.toLowerCase();
        case DiscoveredDeviceSort.IpAddress:
          return device.ipAddress || "";
        case DiscoveredDeviceSort.Vendor:
          return (device.vendor || "").toLowerCase();
        case DiscoveredDeviceSort.FirstSeen:
          return device.firstSeenAt || "";
        default:
          return device.lastSeenAt || "";
      }
    };

    return [...rows].sort(
      (a: FakeDiscoveredDevice, b: FakeDiscoveredDevice): number => {
        return keyOf(a) < keyOf(b)
          ? -direction
          : keyOf(a) > keyOf(b)
            ? direction
            : 0;
      },
    );
  }

  private counts(rows: Array<FakeDiscoveredDevice>): DiscoveredDeviceCounts {
    const countOf: (show: DiscoveredDeviceShow) => number = (
      show: DiscoveredDeviceShow,
    ): number => {
      return rows.filter((row: FakeDiscoveredDevice): boolean => {
        return isShownBy(row, show);
      }).length;
    };

    return {
      all: rows.length,
      notMonitored: countOf(DiscoveredDeviceShow.NotMonitored),
      monitored: countOf(DiscoveredDeviceShow.Monitored),
      hidden: countOf(DiscoveredDeviceShow.Hidden),
    };
  }

  private shown(body: JSONObject): {
    rows: Array<FakeDiscoveredDevice>;
    counts: DiscoveredDeviceCounts;
  } {
    const searched: Array<FakeDiscoveredDevice> = this.searched(body);
    const show: DiscoveredDeviceShow =
      (text(body["show"]) as DiscoveredDeviceShow) ||
      DiscoveredDeviceShow.NotMonitored;

    return {
      rows: this.sorted(
        searched.filter((row: FakeDiscoveredDevice): boolean => {
          return isShownBy(row, show);
        }),
        body,
      ),
      counts: this.counts(searched),
    };
  }

  private list(body: JSONObject): HTTPResponse<JSONObject> {
    const { rows, counts } = this.shown(body);
    const limit: number = Number(body["limit"]) || 25;
    const skip: number = Number(body["skip"]) || 0;

    return ok({
      rows: rows
        .slice(skip, skip + limit)
        .map((row: FakeDiscoveredDevice): JSONObject => {
          // The site a row is in is what the request filters by, not a field.
          const answer: Record<string, unknown> = { ...row };
          delete answer["siteId"];
          return answer as JSONObject;
        }),
      count: rows.length,
      counts: counts as unknown as JSONObject,
    });
  }

  private selectAll(body: JSONObject): HTTPResponse<JSONObject> {
    const { rows } = this.shown(body);

    return ok({
      devices: rows.map((row: FakeDiscoveredDevice): JSONObject => {
        return {
          id: row.id,
          name: row.name,
          ...(row.ipAddress ? { ipAddress: row.ipAddress } : {}),
          ...(row.monitoredDevice ? { isMonitored: true } : {}),
        };
      }),
      count: rows.length,
    });
  }

  private changeMap(
    body: JSONObject,
    isHiding: boolean,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    const asked: Array<string> = ids(body["endpointIds"]);

    if (asked.length === 0) {
      return refused(400, "Select at least one discovered device.");
    }

    const change: {
      changedIds: Array<string>;
      unchangedIds: Array<string>;
      monitoredIds: Array<string>;
      notFoundIds: Array<string>;
    } = { changedIds: [], unchangedIds: [], monitoredIds: [], notFoundIds: [] };

    for (const id of asked) {
      const device: FakeDiscoveredDevice | undefined = this.devices.get(id);

      if (!device) {
        change.notFoundIds.push(id);
      } else if (device.monitoredDevice) {
        change.monitoredIds.push(id);
      } else if (device.isHidden === isHiding) {
        change.unchangedIds.push(id);
      } else {
        device.isHidden = isHiding;
        change.changedIds.push(id);
      }
    }

    return ok(change as unknown as JSONObject);
  }
}
