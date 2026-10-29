import BadDataException from "../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { NetworkControllerTransport } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";

/*
 * The Meraki dashboard API in a test, answering the way the real one does
 * (developer.cisco.com/meraki/api-v1, spec v1.75):
 *
 *   - the key in "Authorization: Bearer <key>", else 401
 *     {"errors": ["Invalid API key"]};
 *   - lists paged with perPage and an RFC 5988 Link header
 *     (`<...startingAfter=...>; rel=next`), the next page's link built on
 *     the host that answered;
 *   - GET /organizations, /organizations/{id}, its /networks and its
 *     /devices (productTypes[] filters), the organization-wide uplink usage
 *     (/appliance/uplinks/usage/byNetwork, t0 and t1, in bytes), each
 *     network's traffic analytics (/networks/{id}/traffic, t0, "kb" - in
 *     kibibytes) and clients (/networks/{id}/clients, t0, perPage, usage in
 *     kibibytes);
 *   - a network with traffic analysis off answers its traffic analytics 400
 *     {"errors": ["Traffic Analysis with Hostname Visibility must be
 *     enabled on the network"]}.
 *
 * Usage is a RATE (bytes a second) times the window asked for, so a window
 * read twice, or two windows that overlap, show up in the sums.
 *
 * Faults are scripted per path: answers to give first (429 with a
 * Retry-After, 500, a redirect), a transport that throws. The production
 * transport answers every status only when asked (acceptAnyStatus); asked
 * without it, this one throws for anything but 2xx the way
 * DataSourceHttpFetch does - so a client that forgot the flag fails here
 * as it would in production.
 *
 * Every request is recorded with the clock's time, for assertions on
 * pacing, on where the key went, and on what was asked.
 */

export const FAKE_API_KEY: string = "0123456789abcdef0123456789abcdef01234567";

export interface FakeMerakiNetwork {
  id: string;
  name: string;
  productTypes?: Array<string> | undefined;
  // Traffic analysis off: its traffic analytics answer 400.
  isTrafficAnalysisOff?: boolean | undefined;
  // Bytes a second of each application row, per direction.
  applications?:
    | Array<{
        application: string;
        destination: string;
        protocol: string;
        port: number;
        sentPerSecond: number;
        receivedPerSecond: number;
        flowsPerHour?: number | undefined;
        numClients?: number | undefined;
      }>
    | undefined;
  clients?:
    | Array<{
        id: string;
        description?: string | undefined;
        ip?: string | undefined;
        mac?: string | undefined;
        manufacturer?: string | undefined;
        sentPerSecond: number;
        receivedPerSecond: number;
      }>
    | undefined;
}

export interface FakeMerakiAppliance {
  serial: string;
  name: string;
  model: string;
  mac: string;
  networkId: string;
  // Bytes a second on each uplink.
  uplinks: Array<{
    interface: string;
    sentPerSecond: number;
    receivedPerSecond: number;
  }>;
}

/*
 * A device of any other product type - a switch, an access point, a camera
 * - as the organization's device list answers it. It carries no uplinks.
 */
export interface FakeMerakiDevice {
  serial: string;
  name: string;
  model: string;
  mac: string;
  networkId: string;
  productType: string;
  lanIp?: string | null | undefined;
  firmware?: string | undefined;
  address?: string | undefined;
}

export interface FakeMerakiOrganization {
  id: string;
  name: string;
  isApiEnabled?: boolean | undefined;
  networks: Array<FakeMerakiNetwork>;
  appliances: Array<FakeMerakiAppliance>;
  // Its other devices: switches, access points and the rest.
  devices?: Array<FakeMerakiDevice> | undefined;
}

export interface FakeMerakiResponse {
  status: number;
  body?: unknown;
  headers?: Dictionary<string> | undefined;
}

export interface FakeMerakiRequest {
  url: URL;
  request: DataSourceHttpRequest;
  atMs: number;
}

export interface FakeMerakiOptions {
  organizations: Array<FakeMerakiOrganization>;
  apiKey?: string | undefined;
  // The host the API answers on.
  apiHost?: string | undefined;
  // Shard hosts the API also answers on (where a redirect points).
  shardHosts?: Array<string> | undefined;
  now: () => Date;
  /*
   * Answers to give a path (matched on the URL's pathname) first, in turn,
   * before it answers normally: a 429, a 500, a redirect.
   */
  scripted?: Record<string, Array<FakeMerakiResponse>> | undefined;
  // Paths whose next request the transport fails to send, in turn.
  dropped?: Record<string, number> | undefined;
  // Answer every page of a list with this many items at most.
  maxPerPage?: number | undefined;
}

export interface FakeMerakiApi {
  transport: NetworkControllerTransport;
  requests: Array<FakeMerakiRequest>;
  // Requests to one path (pathname), in order.
  callsTo: (pathname: string) => Array<FakeMerakiRequest>;
  options: FakeMerakiOptions;
}

function json(
  status: number,
  body: unknown,
  headers?: Dictionary<string>,
): FakeMerakiResponse {
  return { status, body, ...(headers ? { headers } : {}) };
}

function errors(
  status: number,
  message: string,
  headers?: Dictionary<string>,
): FakeMerakiResponse {
  return json(status, { errors: [message] }, headers);
}

export function merakiError(
  status: number,
  message: string,
  headers?: Dictionary<string>,
): FakeMerakiResponse {
  return errors(status, message, headers);
}

function windowSeconds(url: URL, now: Date, defaultSeconds: number): number {
  const t0: string | null = url.searchParams.get("t0");
  const t1: string | null = url.searchParams.get("t1");
  const timespan: string | null = url.searchParams.get("timespan");

  if (t0) {
    const start: number = Date.parse(t0);
    const end: number = t1 ? Date.parse(t1) : now.getTime();
    return Math.max(0, (end - start) / 1000);
  }

  if (timespan) {
    return Number(timespan);
  }

  return defaultSeconds;
}

/*
 * One page of a list, and the Link header for the next: startingAfter is
 * the last item's index, as Meraki's opaque tokens stand for a position.
 */
function page(data: {
  url: URL;
  items: Array<unknown>;
  maxPerPage: number | undefined;
}): FakeMerakiResponse {
  const perPage: number = Math.min(
    Number(data.url.searchParams.get("perPage") || "1000"),
    data.maxPerPage || Number.POSITIVE_INFINITY,
  );
  const after: number = Number(
    data.url.searchParams.get("startingAfter") || "-1",
  );
  const start: number = after + 1;
  const items: Array<unknown> = data.items.slice(start, start + perPage);
  const headers: Dictionary<string> = {};

  if (start + perPage < data.items.length) {
    const next: URL = new URL(data.url.toString());
    next.searchParams.set("startingAfter", String(start + perPage - 1));
    headers["link"] =
      `<${next.toString()}>; rel=next, <${data.url.origin}${data.url.pathname}>; rel=first`;
  }

  return json(200, items, headers);
}

export function createFakeMerakiApi(options: FakeMerakiOptions): FakeMerakiApi {
  const requests: Array<FakeMerakiRequest> = [];
  const scripted: Record<string, Array<FakeMerakiResponse>> = {
    ...(options.scripted || {}),
  };
  const dropped: Record<string, number> = { ...(options.dropped || {}) };
  const apiKey: string = options.apiKey || FAKE_API_KEY;
  const apiHost: string = options.apiHost || "api.meraki.com";
  // The API host and the shards it redirects to, by exact name.
  const merakiHosts: Set<string> = new Set<string>([
    apiHost,
    ...(options.shardHosts || []),
  ]);

  const answer: (url: URL) => FakeMerakiResponse = (
    url: URL,
  ): FakeMerakiResponse => {
    const now: Date = options.now();
    const parts: Array<string> = url.pathname.split("/").filter(Boolean);

    // ["api", "v1", ...]
    if (parts[0] !== "api" || parts[1] !== "v1") {
      return errors(404, "Not found");
    }

    const rest: Array<string> = parts.slice(2).map((part: string): string => {
      return decodeURIComponent(part);
    });

    if (rest.length === 1 && rest[0] === "organizations") {
      return page({
        url,
        items: options.organizations.map(
          (organization: FakeMerakiOrganization): JSONObject => {
            return {
              id: organization.id,
              name: organization.name,
              url: `https://dashboard.meraki.com/o/${organization.id}/manage/organization/overview`,
              api: { enabled: organization.isApiEnabled !== false },
            };
          },
        ),
        maxPerPage: options.maxPerPage,
      });
    }

    if (rest[0] === "organizations") {
      const organization: FakeMerakiOrganization | undefined =
        options.organizations.find(
          (candidate: FakeMerakiOrganization): boolean => {
            return candidate.id === rest[1];
          },
        );

      if (!organization) {
        return errors(404, "Organization not found");
      }

      if (organization.isApiEnabled === false) {
        return errors(403, "API access is not enabled for this organization");
      }

      if (rest.length === 2) {
        return json(200, { id: organization.id, name: organization.name });
      }

      if (rest.length === 3 && rest[2] === "networks") {
        return page({
          url,
          items: organization.networks.map(
            (network: FakeMerakiNetwork): JSONObject => {
              return {
                id: network.id,
                organizationId: organization.id,
                name: network.name,
                productTypes: network.productTypes || [
                  "appliance",
                  "switch",
                  "wireless",
                ],
                timeZone: "America/Los_Angeles",
              };
            },
          ),
          maxPerPage: options.maxPerPage,
        });
      }

      if (rest.length === 3 && rest[2] === "devices") {
        const types: Array<string> = url.searchParams.getAll("productTypes[]");

        /*
         * Every device of the organization, appliances first, filtered by
         * productTypes[] when it is given. An MX has no LAN address in the
         * list (Meraki reports its WAN addresses elsewhere).
         */
        const items: Array<JSONObject> = [
          ...organization.appliances.map(
            (appliance: FakeMerakiAppliance): JSONObject => {
              return {
                name: appliance.name,
                serial: appliance.serial,
                model: appliance.model,
                mac: appliance.mac,
                networkId: appliance.networkId,
                productType: "appliance",
                firmware: "wired-18-211",
                lanIp: null,
              };
            },
          ),
          ...(organization.devices || []).map(
            (device: FakeMerakiDevice): JSONObject => {
              return {
                name: device.name,
                serial: device.serial,
                model: device.model,
                mac: device.mac,
                networkId: device.networkId,
                productType: device.productType,
                firmware: device.firmware || "switch-16-7",
                lanIp: device.lanIp === undefined ? null : device.lanIp,
                address: device.address || "",
                lat: 37.4180951010362,
                lng: -122.098531723022,
                tags: [],
              };
            },
          ),
        ].filter((item: JSONObject): boolean => {
          return (
            types.length === 0 || types.includes(String(item["productType"]))
          );
        });

        return page({
          url,
          items,
          maxPerPage: options.maxPerPage,
        });
      }

      if (rest.slice(2).join("/") === "appliance/uplinks/usage/byNetwork") {
        const seconds: number = windowSeconds(url, now, 86400);
        const byNetwork: Map<string, Array<JSONObject>> = new Map();

        for (const appliance of organization.appliances) {
          const list: Array<JSONObject> =
            byNetwork.get(appliance.networkId) || [];

          for (const uplink of appliance.uplinks) {
            list.push({
              serial: appliance.serial,
              interface: uplink.interface,
              sent: Math.round(uplink.sentPerSecond * seconds),
              received: Math.round(uplink.receivedPerSecond * seconds),
            });
          }

          byNetwork.set(appliance.networkId, list);
        }

        return json(
          200,
          Array.from(byNetwork.entries()).map(
            ([networkId, byUplink]: [
              string,
              Array<JSONObject>,
            ]): JSONObject => {
              return {
                networkId,
                name:
                  organization.networks.find(
                    (network: FakeMerakiNetwork): boolean => {
                      return network.id === networkId;
                    },
                  )?.name || "",
                byUplink,
              };
            },
          ),
        );
      }

      return errors(404, "Not found");
    }

    if (rest[0] === "networks") {
      const network: FakeMerakiNetwork | undefined = options.organizations
        .flatMap(
          (organization: FakeMerakiOrganization): Array<FakeMerakiNetwork> => {
            return organization.networks;
          },
        )
        .find((candidate: FakeMerakiNetwork): boolean => {
          return candidate.id === rest[1];
        });

      if (!network) {
        return errors(404, "Network not found");
      }

      const seconds: number = windowSeconds(url, now, 86400);

      if (rest[2] === "traffic") {
        if (network.isTrafficAnalysisOff) {
          return errors(
            400,
            "Traffic Analysis with Hostname Visibility must be enabled on the network",
          );
        }

        return json(
          200,
          (network.applications || []).map(
            (
              row: NonNullable<FakeMerakiNetwork["applications"]>[number],
            ): JSONObject => {
              return {
                application: row.application,
                destination: row.destination,
                protocol: row.protocol,
                port: row.port,
                sent: (row.sentPerSecond * seconds) / 1024,
                recv: (row.receivedPerSecond * seconds) / 1024,
                numClients: row.numClients || 1,
                activeTime: Math.round(seconds),
                flows: Math.round(((row.flowsPerHour || 0) * seconds) / 3600),
              };
            },
          ),
        );
      }

      if (rest[2] === "clients") {
        return page({
          url,
          items: (network.clients || []).map(
            (
              client: NonNullable<FakeMerakiNetwork["clients"]>[number],
            ): JSONObject => {
              return {
                id: client.id,
                mac: client.mac || "",
                ip: client.ip || "",
                description: client.description || null,
                manufacturer: client.manufacturer || "",
                usage: {
                  sent: (client.sentPerSecond * seconds) / 1024,
                  recv: (client.receivedPerSecond * seconds) / 1024,
                },
              };
            },
          ),
          maxPerPage: options.maxPerPage,
        });
      }
    }

    return errors(404, "Not found");
  };

  const transport: NetworkControllerTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const url: URL = new URL(request.url);
    requests.push({ url, request, atMs: options.now().getTime() });

    if (dropped[url.pathname] && dropped[url.pathname]! > 0) {
      dropped[url.pathname] = dropped[url.pathname]! - 1;
      throw new BadDataException("Could not reach data source: socket hang up");
    }

    let response: FakeMerakiResponse;

    const isMerakiHost: boolean = merakiHosts.has(url.hostname);

    if (!isMerakiHost) {
      response = errors(404, "Not a Meraki host");
    } else if (request.headers?.["Authorization"] !== `Bearer ${apiKey}`) {
      response = errors(401, "Invalid API key");
    } else if (scripted[url.pathname] && scripted[url.pathname]!.length > 0) {
      response = scripted[url.pathname]!.shift()!;
    } else {
      response = answer(url);
    }

    const bodyText: string =
      response.body === undefined ? "" : JSON.stringify(response.body);

    if (
      !request.acceptAnyStatus &&
      (response.status < 200 || response.status >= 300)
    ) {
      throw new BadDataException(
        `Data source responded with HTTP ${response.status}: ${bodyText.substring(0, 500)}`,
      );
    }

    return {
      statusCode: response.status,
      bodyText,
      bodyJson: response.body,
      headers: response.headers || {},
    };
  };

  return {
    transport,
    requests,
    callsTo: (pathname: string): Array<FakeMerakiRequest> => {
      return requests.filter((entry: FakeMerakiRequest): boolean => {
        return entry.url.pathname === pathname;
      });
    },
    options,
  };
}

/*
 * A test clock: `now` reads it, `sleep` moves it - so a client that paces
 * itself or waits a Retry-After takes no real time, and the time it would
 * have taken can be read back.
 */
export interface TestClock {
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  advance: (milliseconds: number) => void;
  sleeps: Array<number>;
}

export function createTestClock(start: Date): TestClock {
  let current: number = start.getTime();
  const sleeps: Array<number> = [];

  return {
    now: (): Date => {
      return new Date(current);
    },
    sleep: async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      current += Math.max(0, milliseconds);
    },
    advance: (milliseconds: number): void => {
      current += milliseconds;
    },
    sleeps,
  };
}

// An organization of `count` branch networks, each with an MX on two uplinks.
export function buildBranchOrganization(data: {
  id: string;
  name: string;
  count: number;
}): FakeMerakiOrganization {
  const networks: Array<FakeMerakiNetwork> = [];
  const appliances: Array<FakeMerakiAppliance> = [];

  for (let index: number = 0; index < data.count; index++) {
    const id: string = `L_${1000 + index}`;
    networks.push({
      id,
      name: `Branch ${index + 1}`,
      applications: [
        {
          application: "Microsoft Teams",
          destination: "teams.microsoft.com",
          protocol: "UDP",
          port: 3478,
          sentPerSecond: 1000,
          receivedPerSecond: 3000,
          flowsPerHour: 60,
          numClients: 12,
        },
      ],
      clients: [
        {
          id: `k${index}`,
          description: `Laptop ${index + 1}`,
          ip: `10.${index % 250}.0.10`,
          mac: `aa:bb:cc:00:${(index % 256).toString(16).padStart(2, "0")}:01`,
          manufacturer: "Dell",
          sentPerSecond: 100,
          receivedPerSecond: 400,
        },
      ],
    });
    appliances.push({
      serial: `Q2XX-AAAA-${String(index).padStart(4, "0")}`,
      name: `MX ${index + 1}`,
      model: "MX68",
      mac: `00:18:0a:00:${(index % 256).toString(16).padStart(2, "0")}:01`,
      networkId: id,
      uplinks: [
        { interface: "wan1", sentPerSecond: 10000, receivedPerSecond: 50000 },
        { interface: "wan2", sentPerSecond: 100, receivedPerSecond: 200 },
      ],
    });
  }

  return {
    id: data.id,
    name: data.name,
    networks,
    appliances,
  };
}
