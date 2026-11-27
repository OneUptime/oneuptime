import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN OPENSTACK CLOUD'S CONTROL PLANE MAP: THE SERVICES ITS SPANS NAME, PAST
 * THE PROJECT'S FIRST 10,000 (#10921).
 *
 * The map of the services a cloud's newest traces crossed named each one
 * from the project's first 10,000 services by name, read beside the spans:
 * a service past them was drawn as its bare id. The services are read by
 * the ids the spans are attributed to now, once the spans are in, in pages
 * of 500. ModelAPI answers from a project faked whole (CappedListServer);
 * the spans are stood in for.
 */

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import { fetchOpenStackControlPlaneSpans } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackTraceReads";
import Span from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const NOVA_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const KEYSTONE_ID: string = "a1000000-0000-4000-8000-0000000000ab";
const DELETED_ID: string = "a1000000-0000-4000-8000-0000000000dd";

let server: CappedListServer;

function span(spanId: string, primaryEntityId: string): Span {
  return Object.assign(new Span(), {
    spanId: spanId,
    traceId: "trace-1",
    name: `call ${spanId}`,
    primaryEntityId: primaryEntityId,
  });
}

beforeEach(() => {
  server = new CappedListServer();
  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: NOVA_ID, name: "WB cloud nova-api", serviceColor: "#22c55e" },
    { _id: KEYSTONE_ID, name: "WB cloud keystone", serviceColor: "#6366f1" },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

describe("OpenStack control plane map: the services its spans name", () => {
  test("names the services past the project's first 10,000, read by the spans' ids", async () => {
    getJestSpyOn(AnalyticsModelAPI, "getList").mockResolvedValue({
      data: [
        span("1", NOVA_ID),
        span("2", KEYSTONE_ID),
        span("3", NOVA_ID),
        span("4", DELETED_ID),
        span("5", PROJECT_ID),
      ],
      count: 5,
      skip: 0,
      limit: 5000,
    } as AnalyticsListResult<Span> as never);

    const read: { spans: Array<Span>; services: Array<Service> } =
      await fetchOpenStackControlPlaneSpans(["trace-1"]);

    expect(read.spans).toHaveLength(5);
    expect(
      read.services
        .map((service: Service): string => {
          return service.name || "";
        })
        .sort(),
    ).toEqual(["WB cloud keystone", "WB cloud nova-api"]);

    // By the spans' ids, each once: never the first 10,000 by name.
    expect(serviceReads()).toHaveLength(1);
    expect(serviceReads()[0]!.query["_id"]).toBeInstanceOf(Includes);
    expect(serviceReads()[0]!.limit).toBeLessThan(LIMIT_PER_PROJECT);
    expect(
      (serviceReads()[0]!.query["_id"] as Includes).values
        .map((value: unknown): string => {
          return String(value).toLowerCase();
        })
        .sort(),
    ).toEqual([NOVA_ID, KEYSTONE_ID, DELETED_ID, PROJECT_ID].sort());
  });

  test("no traces, no reads", async () => {
    const spansRead: jest.SpyInstance = getJestSpyOn(
      AnalyticsModelAPI,
      "getList",
    );

    expect(await fetchOpenStackControlPlaneSpans([])).toEqual({
      spans: [],
      services: [],
    });
    expect(spansRead).not.toHaveBeenCalled();
    expect(serviceReads()).toHaveLength(0);
  });

  test("spans attributed to no service read no services", async () => {
    getJestSpyOn(AnalyticsModelAPI, "getList").mockResolvedValue({
      data: [span("1", "")],
      count: 1,
      skip: 0,
      limit: 5000,
    } as AnalyticsListResult<Span> as never);

    const read: { spans: Array<Span>; services: Array<Service> } =
      await fetchOpenStackControlPlaneSpans(["trace-1"]);

    expect(read.services).toEqual([]);
    expect(serviceReads()).toHaveLength(0);
  });
});
