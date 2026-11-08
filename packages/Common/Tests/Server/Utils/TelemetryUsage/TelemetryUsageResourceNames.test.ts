import HostService from "../../../../Server/Services/HostService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TelemetryUsageResourceNames, {
  TELEMETRY_USAGE_RESOURCE_NAME_SOURCES,
} from "../../../../Server/Utils/TelemetryUsage/TelemetryUsageResourceNames";
import { TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES } from "../../../../Server/Services/TelemetryUsageBillingService";
import Host from "../../../../Models/DatabaseModels/Host";
import Service from "../../../../Models/DatabaseModels/Service";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { TELEMETRY_ENTITY_TYPES } from "../../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Naming the resources of the usage pages (issue #5916): each usage row's id
 * is a Service, a host, a cluster or another resource, by its type, and is
 * named from its own table - read as the reader may read it, so a kind the
 * reader may not read stays unnamed rather than failing the page.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_HOST_ID: string = "44444444-4444-4444-8444-444444444444";

let serviceFind: jest.SpyInstance;
let hostFind: jest.SpyInstance;

beforeEach(() => {
  serviceFind = jest
    .spyOn(ServiceService, "findBy")
    .mockResolvedValue([
      Object.assign(new Service(), {
        _id: SERVICE_ID,
        id: new ObjectID(SERVICE_ID),
        name: "checkout",
      }),
    ] as never);

  hostFind = jest.spyOn(HostService, "findBy").mockResolvedValue([
    Object.assign(new Host(), {
      _id: HOST_ID,
      id: new ObjectID(HOST_ID),
      name: "",
      hostIdentifier: "ip-10-0-0-12",
    }),
    Object.assign(new Host(), {
      _id: OTHER_HOST_ID,
      id: new ObjectID(OTHER_HOST_ID),
      name: "db-01",
    }),
  ] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("naming usage's resources", () => {
  test("reads each kind from its own table, the project's rows only, with the reader's props", async () => {
    const props: { tenantId: ObjectID } = { tenantId: PROJECT_ID };

    const names: Map<string, string> = await TelemetryUsageResourceNames.resolve(
      {
        projectId: PROJECT_ID,
        resources: [
          {
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
          },
          { primaryEntityId: HOST_ID, primaryEntityType: ServiceType.Host },
          {
            primaryEntityId: OTHER_HOST_ID,
            primaryEntityType: ServiceType.Host,
          },
        ],
        props: props as never,
      },
    );

    expect(Array.from(names.entries()).sort()).toEqual(
      [
        [SERVICE_ID, "checkout"],
        // A host with no name is named by its identifier.
        [HOST_ID, "ip-10-0-0-12"],
        [OTHER_HOST_ID, "db-01"],
      ].sort(),
    );

    expect(serviceFind).toHaveBeenCalledTimes(1);
    expect(hostFind).toHaveBeenCalledTimes(1);
    expect(hostFind.mock.calls[0]![0].props).toBe(props);
    expect(hostFind.mock.calls[0]![0].query.projectId).toBe(PROJECT_ID);
    expect(hostFind.mock.calls[0]![0].select).toEqual({
      _id: true,
      name: true,
      hostIdentifier: true,
    });
  });

  test("names a row of no type from the Services, as legacy rows are", async () => {
    const names: Map<string, string> = await TelemetryUsageResourceNames.resolve(
      {
        projectId: PROJECT_ID,
        resources: [{ primaryEntityId: SERVICE_ID, primaryEntityType: null }],
        props: { isRoot: true },
      },
    );

    expect(names.get(SERVICE_ID)).toBe("checkout");
    expect(hostFind).not.toHaveBeenCalled();
  });

  test("leaves the unattributed bucket, and anything that is not an id, unnamed without a read", async () => {
    const names: Map<string, string> = await TelemetryUsageResourceNames.resolve(
      {
        projectId: PROJECT_ID,
        resources: [
          {
            primaryEntityId: PROJECT_ID.toString(),
            primaryEntityType: ServiceType.Unknown,
          },
          {
            primaryEntityId: PROJECT_ID.toString(),
            primaryEntityType: ServiceType.OpenTelemetry,
          },
          {
            primaryEntityId: "not-an-id'; DROP TABLE",
            primaryEntityType: ServiceType.Host,
          },
        ],
        props: { isRoot: true },
      },
    );

    expect(names.size).toBe(0);
    expect(serviceFind).not.toHaveBeenCalled();
    expect(hostFind).not.toHaveBeenCalled();
  });

  test("leaves a kind the reader may not read unnamed, and still names the rest", async () => {
    hostFind.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read Host."),
    );

    const names: Map<string, string> = await TelemetryUsageResourceNames.resolve(
      {
        projectId: PROJECT_ID,
        resources: [
          {
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
          },
          { primaryEntityId: HOST_ID, primaryEntityType: ServiceType.Host },
        ],
        props: { tenantId: PROJECT_ID } as never,
      },
    );

    expect(Array.from(names.entries())).toEqual([[SERVICE_ID, "checkout"]]);
  });

  test("names every kind usage is counted for, from the table the explorers name it from", () => {
    const counted: Array<ServiceType> = (
      Object.values(ServiceType) as Array<ServiceType>
    ).filter((type: ServiceType): boolean => {
      return (
        !TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES.includes(type) &&
        type !== ServiceType.Unknown
      );
    });

    for (const type of counted) {
      expect({
        type,
        named: Boolean(TELEMETRY_USAGE_RESOURCE_NAME_SOURCES[type]),
      }).toEqual({ type, named: true });

      // The same columns the Dashboard's telemetry explorers name it by.
      expect({
        type,
        fields: TELEMETRY_USAGE_RESOURCE_NAME_SOURCES[type]!.nameFields,
      }).toEqual({ type, fields: TELEMETRY_ENTITY_TYPES[type].nameFields });
    }
  });
});
