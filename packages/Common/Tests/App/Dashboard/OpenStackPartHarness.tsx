import { jest } from "@jest/globals";
import { act, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  OpenStackBlastRadius,
  buildOpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "../../../Types/OpenStack/OpenStackBlastRadius";
import { OpenStackCountRow } from "../../../Types/OpenStack/OpenStackCounts";
import {
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OpenStackResourceKind,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getOpenStackShortHostName } from "../../../Types/OpenStack/OpenStackHealthRules";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * An OpenStack cloud's pages, rendered for real over the real tables and part cards, with
 * only the network replaced. The stand-in answers a list the way the server does: it holds
 * the whole cloud's rows and applies the query it was sent, the same JSON filters included,
 * so a filter that never reaches the server finds nothing and a page that reads a kind
 * whole is seen doing it. Not a test file itself, so jest does not run it.
 */

export const CLOUD_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
export const CLOUD_NAME: string = "prod-eu";
export const CLOUD_PATH: string = `/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}`;

export type Row = {
  [Key in keyof OpenStackResource]?: OpenStackResource[Key] | undefined;
};

export interface ListCall {
  model: string;
  kind: unknown;
  query: JSONObject;
  limit: number;
  skip: number;
  sort: JSONObject;
}

export interface OpenStackTestServer {
  rows: Array<Row>;
  // Which projects each domain holds, as Keystone says.
  domainProjects: Record<string, Array<string>>;
  // Whole records of the other tables a page's cards read, by model name.
  records: Record<string, Array<Record<string, unknown>>>;
  // Latest metric readings, by metric name, as a group's label and value.
  metrics: Record<string, Array<{ group: string; value: number }>>;
  // Each metric's history, oldest first.
  history: Record<string, Array<{ time: number; value: number }>>;
  cloud: OpenStackCloud | null;
  // Reads of a kind that fail, as a server that is down does.
  failKinds: Set<string>;
  failPosts: Set<string>;
  listCalls: Array<ListCall>;
  countCalls: Array<ListCall>;
  postCalls: Array<{ path: string; body: JSONObject }>;
}

export const server: OpenStackTestServer = {
  rows: [],
  domainProjects: {},
  records: {},
  metrics: {},
  history: {},
  cloud: null,
  failKinds: new Set<string>(),
  failPosts: new Set<string>(),
  listCalls: [],
  countCalls: [],
  postCalls: [],
};

export const READ_FAILED: string = "Server is not available. Please try again.";

const ENDPOINT_OF_URL: RegExp = /openstack-resource\/([a-z-]+)\//;

function factMatches(value: JSONValue | undefined, wanted: unknown): boolean {
  const isEmpty: boolean =
    value === undefined || value === null || value === "";
  if (wanted instanceof IsNull) {
    return isEmpty;
  }
  if (wanted instanceof NotNull) {
    return !isEmpty;
  }
  const asText: string =
    value !== null && typeof value === "object"
      ? JSON.stringify(value)
      : String(value ?? "");
  if (wanted instanceof NotEqual) {
    // A row missing the key satisfies a negative filter, as JSONColumnQuery has it.
    return isEmpty || asText !== String(wanted.value);
  }
  if (wanted instanceof Search) {
    return !isEmpty && asText.includes(String(wanted.value));
  }
  if (wanted instanceof Includes) {
    return wanted.values
      .map((one: unknown): string => {
        return String(one);
      })
      .includes(asText);
  }
  return !isEmpty && asText === String(wanted);
}

export function matchesQuery(row: Row, query: JSONObject): boolean {
  for (const key of Object.keys(query)) {
    const wanted: unknown = query[key];
    if (wanted === undefined) {
      continue;
    }
    if (key === "_multiFieldSearch") {
      const search: MultiSearch = wanted as MultiSearch;
      const needle: string = search.value.toLowerCase();
      const found: boolean = search.fields.some((field: string): boolean => {
        return String((row as Record<string, unknown>)[field] || "")
          .toLowerCase()
          .includes(needle);
      });
      if (!found) {
        return false;
      }
      continue;
    }
    // Every row here is this cloud's, so a read of any other cloud finds nothing.
    if (key === "openStackCloudId") {
      if (String(wanted) !== CLOUD_ID) {
        return false;
      }
      continue;
    }
    const value: unknown = (row as Record<string, unknown>)[key];
    if (key === "facts") {
      const facts: JSONObject = (row.facts as JSONObject) || {};
      for (const name of Object.keys(wanted as JSONObject)) {
        if (!factMatches(facts[name], (wanted as JSONObject)[name])) {
          return false;
        }
      }
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed: Array<string> = wanted.values.map((one: unknown) => {
        return String(one);
      });
      if (!allowed.includes(String(value))) {
        return false;
      }
      continue;
    }
    if (wanted instanceof Search) {
      if (
        !String(value || "")
          .toLowerCase()
          .includes(String(wanted.value).toLowerCase())
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof LessThanOrEqual) {
      if (
        !value ||
        new Date(value as Date).getTime() >
          new Date(wanted.value as Date).getTime()
      ) {
        return false;
      }
      continue;
    }
    if (wanted instanceof NotEqual) {
      if (String(value ?? "") === String(wanted.value)) {
        return false;
      }
      continue;
    }
    if (String(value ?? "") !== String(wanted)) {
      return false;
    }
  }
  return true;
}

function kindOf(row: Row): string {
  return row.kind || "";
}

function blastRadiusOf(body: JSONObject): OpenStackBlastRadius {
  const part: Row | undefined = server.rows.find((row: Row): boolean => {
    return row.kind === body["kind"] && row.externalId === body["externalId"];
  });
  if (!part) {
    return getEmptyOpenStackBlastRadius(false);
  }
  const byProject: (
    rows: Array<Row>,
  ) => Array<{ projectId: string | null; count: number }> = (
    rows: Array<Row>,
  ): Array<{ projectId: string | null; count: number }> => {
    const counts: Map<string | null, number> = new Map();
    for (const row of rows) {
      const projectId: string | null = row.openStackProjectId || null;
      counts.set(projectId, (counts.get(projectId) || 0) + 1);
    }
    return Array.from(counts.entries()).map(
      ([projectId, count]: [string | null, number]) => {
        return { projectId, count };
      },
    );
  };
  const projectNames: Record<string, string> = {};
  for (const row of server.rows) {
    if (
      row.kind === OpenStackResourceKind.Project &&
      row.externalId &&
      row.name
    ) {
      projectNames[row.externalId] = row.name;
    }
  }
  if (part.kind === OpenStackResourceKind.Hypervisor) {
    return buildOpenStackBlastRadius({
      counts: [
        {
          count: "instanceCount",
          byProject: byProject(
            server.rows.filter((row: Row): boolean => {
              return (
                row.kind === OpenStackResourceKind.Instance &&
                row.hypervisorName === part.hypervisorName
              );
            }),
          ),
        },
      ],
      projectNames,
    });
  }
  if (part.kind === OpenStackResourceKind.Router) {
    return buildOpenStackBlastRadius({
      counts: [
        {
          count: "floatingIpCount",
          byProject: byProject(
            server.rows.filter((row: Row): boolean => {
              return (
                row.kind === OpenStackResourceKind.FloatingIp &&
                (row.facts as JSONObject | undefined)?.["routerId"] ===
                  part.externalId
              );
            }),
          ),
        },
      ],
      projectNames,
    });
  }
  return getEmptyOpenStackBlastRadius(false);
}

// What may need someone, chosen by the same lines as the server's statement.
function attentionRows(): Array<Row> {
  return server.rows.filter((row: Row): boolean => {
    switch (row.kind) {
      case OpenStackResourceKind.Hypervisor:
      case OpenStackResourceKind.Service:
        return true;
      case OpenStackResourceKind.Instance:
        return (
          row.status === "ERROR" ||
          OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES.has(row.status || "")
        );
      case OpenStackResourceKind.Volume:
        return (
          OPENSTACK_VOLUME_ERROR_STATUSES.has(row.status || "") ||
          OPENSTACK_VOLUME_TRANSITIONAL_STATUSES.has(row.status || "")
        );
      case OpenStackResourceKind.Image:
        return OPENSTACK_IMAGE_TRANSITIONAL_STATUSES.has(row.status || "");
      default:
        return false;
    }
  });
}

function countsOf(body: JSONObject): Array<OpenStackCountRow> {
  const groups: Map<string, OpenStackCountRow> = new Map();
  for (const row of server.rows) {
    if (row.kind !== body["kind"]) {
      continue;
    }
    const facts: JSONObject = (row.facts as JSONObject) || {};
    const value: string | null =
      body["by"] === "flavor"
        ? (facts["flavorId"] as string) ?? null
        : body["by"] === "volumeType"
          ? (facts["volumeType"] as string) ?? null
          : row.openStackProjectId ?? null;
    const key: string = `${row.regionName || ""}/${value || ""}`;
    const group: OpenStackCountRow = groups.get(key) || {
      value,
      regionName: row.regionName || null,
      count: 0,
      sizeBytes: 0,
    };
    group.count += 1;
    group.sizeBytes += row.diskCapacityBytes || 0;
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

/*
 * One open state of each record, whichever test is running: the states are read through a
 * cache that outlives a test, so a test can't choose its own.
 */
const OPEN_STATE: Record<string, unknown> = {
  _id: "50000000-0000-4000-8000-000000000001",
  name: "Created",
  isResolvedState: false,
  order: 1,
};

export function resetServer(): void {
  server.rows = [];
  server.domainProjects = {};
  server.records = { IncidentState: [OPEN_STATE], AlertState: [OPEN_STATE] };
  server.metrics = {};
  server.history = {};
  server.cloud = Object.assign(new OpenStackCloud(), { name: CLOUD_NAME });
  server.failKinds = new Set<string>();
  server.failPosts = new Set<string>();
  server.listCalls = [];
  server.countCalls = [];
  server.postCalls = [];

  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(ModelAPI, "count").mockImplementation((async (options: any) => {
    server.countCalls.push({
      model: new options.modelType().tableName || "",
      kind: options.query?.kind,
      query: options.query || {},
      limit: 0,
      skip: 0,
      sort: {},
    });
    if (options.modelType !== OpenStackResource) {
      return 0;
    }
    if (server.failKinds.has(String(options.query?.kind))) {
      throw new Error(READ_FAILED);
    }
    let count: number = 0;
    for (const row of server.rows) {
      if (matchesQuery(row, options.query || {})) {
        count += 1;
      }
    }
    return count;
  }) as never);

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (options: any): Promise<ListResult<any>> => {
      const Model: { new (): BaseModel } = options.modelType;
      const model: string = new Model().tableName || "";
      server.listCalls.push({
        model,
        kind: options.query?.kind,
        query: options.query || {},
        limit: options.limit,
        skip: options.skip,
        sort: options.sort || {},
      });

      let matching: Array<Record<string, unknown>> = [];

      if (Model === OpenStackResource) {
        if (server.failKinds.has(String(options.query?.kind))) {
          throw new Error(READ_FAILED);
        }
        matching = server.rows.filter((row: Row): boolean => {
          return matchesQuery(row, options.query || {});
        }) as Array<Record<string, unknown>>;
        const sortKey: string | undefined = Object.keys(options.sort || {})[0];
        if (sortKey) {
          const direction: number =
            options.sort[sortKey] === "Descending" ? -1 : 1;
          matching = [...matching].sort(
            (
              first: Record<string, unknown>,
              second: Record<string, unknown>,
            ): number => {
              return (
                String(first[sortKey] ?? "").localeCompare(
                  String(second[sortKey] ?? ""),
                  undefined,
                  { numeric: true },
                ) * direction
              );
            },
          );
        }
      } else {
        matching = server.records[model] || [];
      }

      const page: Array<Record<string, unknown>> = matching.slice(
        options.skip || 0,
        (options.skip || 0) + (options.limit || 10),
      );

      return {
        data: page.map((record: Record<string, unknown>) => {
          return Object.assign(new Model(), record);
        }),
        count: matching.length,
        skip: options.skip || 0,
        limit: options.limit || 10,
      } as ListResult<any>;
    });

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return server.cloud;
  }) as never);

  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);

  jest.spyOn(API, "post").mockImplementation((async (options: any) => {
    const url: string = options.url.toString();
    const body: JSONObject = options.data || {};
    server.postCalls.push({ path: url, body });
    const endpoint: string = ENDPOINT_OF_URL.exec(url)?.[1] || "";
    if (server.failPosts.has(endpoint)) {
      return new HTTPErrorResponse(500, { message: READ_FAILED }, {});
    }
    switch (endpoint) {
      case "needs-attention":
        return {
          data: {
            rows: attentionRows().filter((row: Row): boolean => {
              return (
                !body["regionName"] || row.regionName === body["regionName"]
              );
            }),
            totalsByKind: {},
          },
        };
      case "blast-radius":
        return { data: blastRadiusOf(body) };
      case "counts":
        return { data: { rows: countsOf(body) } };
      case "domain-projects":
        return {
          data: {
            projectIds: server.domainProjects[String(body["domainId"])] || [],
          },
        };
      case "host-of-machine": {
        // The server's rule, which OpenStackAcrossProducts.test.ts holds: one host or none.
        const hosts: Array<Record<string, unknown>> =
          server.records["Host"] || [];
        return { data: { host: hosts.length === 1 ? hosts[0] : null } };
      }
      default:
        return { data: {} };
    }
  }) as never);

  jest.spyOn(AnalyticsModelAPI, "aggregate").mockImplementation((async (
    options: any,
  ) => {
    const aggregateBy: JSONObject = options.aggregateBy;
    const query: JSONObject = aggregateBy["query"] as JSONObject;
    const name: string = query["name"] as string;
    const groupKeys: Array<string> | undefined = aggregateBy[
      "groupByAttributeKeys"
    ] as Array<string> | undefined;
    if (groupKeys) {
      const regionLabel: string = "openstack.region.name";
      const region: unknown = (query["attributes"] as JSONObject | undefined)?.[
        regionLabel
      ];
      return {
        data: (server.metrics[name] || [])
          .filter((reading: { group: string; value: number }) => {
            // A count kept per region answers for the region it was asked about.
            return (
              !region ||
              groupKeys[0] !== regionLabel ||
              reading.group === region
            );
          })
          .map((reading: { group: string; value: number }) => {
            return {
              value: reading.value,
              timestamp: new Date(),
              attributes: { [groupKeys[0] as string]: reading.group },
            };
          }),
      };
    }
    return {
      data: (server.history[name] || []).map(
        (point: { time: number; value: number }) => {
          return { timestamp: new Date(point.time), value: point.value };
        },
      ),
    };
  }) as never);
}

export function kindCalls(kind: OpenStackResourceKind): Array<ListCall> {
  return server.listCalls.filter((call: ListCall): boolean => {
    return call.kind === kind;
  });
}

export async function settle(rounds: number = 25): Promise<void> {
  for (let i: number = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(CLOUD_PATH),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

export async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  path: string,
): Promise<void> {
  goTo(`${CLOUD_PATH}${path}`);
  await act(async () => {
    render(
      <MemoryRouter>
        <Page {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
  await settle();
}

export function partPath(section: string, externalId: string): string {
  return `/${section}/${encodeURIComponent(externalId)}`;
}

export function attentionRowsOf(testId: string): Array<string> {
  return screen
    .queryAllByTestId(`${testId}-item`)
    .map((item: HTMLElement): string => {
      const reasons: Array<string> = within(item)
        .queryAllByTestId(`${testId}-reason`)
        .map((reason: HTMLElement): string => {
          return reason.textContent || "";
        });
      const name: string =
        within(item).getByTestId(`${testId}-name`).textContent || "";
      return `${name}: ${reasons.join(", ")}`;
    });
}

export function tile(tilesTestId: string, title: string): HTMLElement {
  const label: HTMLElement = within(
    screen.getByTestId(tilesTestId),
  ).getAllByText(title)[0]!;
  return label.closest("div.rounded-xl") as HTMLElement;
}

export function tableRow(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

export const HYPERVISOR_NAME: string = "compute-07.example.internal";
export const HYPERVISOR_ID: string = `RegionOne/${HYPERVISOR_NAME}`;

export function hypervisorRow(fields: Row = {}): Row {
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000001",
    kind: OpenStackResourceKind.Hypervisor,
    name: HYPERVISOR_NAME,
    externalId: HYPERVISOR_ID,
    hypervisorName: HYPERVISOR_NAME,
    regionName: "RegionOne",
    availabilityZone: "az1",
    status: "up",
    adminState: "enabled",
    vcpuAllocated: 12,
    vcpuCapacity: 64,
    memoryAllocatedBytes: 16 * 1024 * 1024 * 1024,
    memoryCapacityBytes: 128 * 1024 * 1024 * 1024,
    diskAllocatedBytes: 100 * 1024 * 1024 * 1024,
    diskCapacityBytes: 1000 * 1024 * 1024 * 1024,
    instanceCount: 5,
    facts: { allocationRatios: { VCPU: 16, MEMORY_MB: 1.5, DISK_GB: 1 } },
    lastSeenAt: new Date(),
    ...fields,
  };
}

export function computeServiceRow(fields: Row = {}): Row {
  const host: string = getOpenStackShortHostName(HYPERVISOR_NAME);
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000002",
    kind: OpenStackResourceKind.Service,
    name: "nova-compute",
    externalId: `RegionOne/compute/${host}/nova-compute`,
    hypervisorName: host,
    regionName: "RegionOne",
    availabilityZone: "az1",
    status: "up",
    adminState: "enabled",
    facts: { family: "compute", host },
    lastSeenAt: new Date(),
    ...fields,
  };
}

export { kindOf };
