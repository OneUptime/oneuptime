import { mockRouter } from "Common/Tests/Server/API/Helpers";
import ServiceService from "Common/Server/Services/ServiceService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import Service from "Common/Models/DatabaseModels/Service";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import BadDataException from "Common/Types/Exception/BadDataException";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The Service Map sends the name of every service it draws and colours each
 * node from the answer. The endpoint used to keep only the first 500 names,
 * so in a project with more services every node past the 500th silently lost
 * its incident and alert state — and with it the "Need attention" count and
 * the attention-first ordering (issue #3973: counts must cover everything).
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertStateService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

import ServiceOperationalStatusAPI, {
  MAX_SERVICE_NAMES,
} from "../../FeatureSet/BaseAPI/API/ServiceOperationalStatus";

new ServiceOperationalStatusAPI().getRouter();

const ROUTE: string = "/telemetry/service-operational-status";
const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const serviceService: { findBy: jest.Mock } = ServiceService as unknown as {
  findBy: jest.Mock;
};
const incidentService: { findBy: jest.Mock } = IncidentService as unknown as {
  findBy: jest.Mock;
};
const incidentStateService: { findOneBy: jest.Mock } =
  IncidentStateService as unknown as { findOneBy: jest.Mock };
const alertService: { findBy: jest.Mock } = AlertService as unknown as {
  findBy: jest.Mock;
};
const alertStateService: { findOneBy: jest.Mock } =
  AlertStateService as unknown as { findOneBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

type CallFunction = (body: JSONObject) => Promise<jest.Mock>;

const callStatus: CallFunction = async (
  body: JSONObject,
): Promise<jest.Mock> => {
  const next: jest.Mock = jest.fn();
  const req: ExpressRequest = { body: body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );
  return next;
};

function makeService(name: string): Service {
  const service: Service = new Service(ObjectID.generate());
  service.name = name;
  return service;
}

function makeServices(count: number): Array<Service> {
  const services: Array<Service> = [];
  for (let index: number = 0; index < count; index++) {
    services.push(makeService(`svc-${String(index).padStart(5, "0")}`));
  }
  return services;
}

function makeIncident(
  title: string,
  services: Array<Service>,
  severity: { name: string; color: string; order: number },
): Incident {
  const incident: Incident = new Incident(ObjectID.generate());
  incident.title = title;
  const incidentSeverity: IncidentSeverity = new IncidentSeverity();
  incidentSeverity.name = severity.name;
  incidentSeverity.color = new Color(severity.color);
  incidentSeverity.order = severity.order;
  incident.incidentSeverity = incidentSeverity;
  incident.services = services;
  return incident;
}

function makeAlert(title: string, services: Array<Service>): Alert {
  const alert: Alert = new Alert(ObjectID.generate());
  alert.title = title;
  const alertSeverity: AlertSeverity = new AlertSeverity();
  alertSeverity.name = "Warning";
  alertSeverity.color = new Color("#f59e0b");
  alertSeverity.order = 2;
  alert.alertSeverity = alertSeverity;
  alert.services = services;
  return alert;
}

function responseServices(): JSONArray {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  const body: JSONObject = responseUtil.sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;
  return body["services"] as JSONArray;
}

describe("POST /telemetry/service-operational-status", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      tenantId: projectId,
    } as never);
    serviceService.findBy.mockResolvedValue([] as never);
    incidentService.findBy.mockResolvedValue([] as never);
    alertService.findBy.mockResolvedValue([] as never);
    incidentStateService.findOneBy.mockResolvedValue({
      _id: ObjectID.generate(),
      order: 5,
    } as never);
    alertStateService.findOneBy.mockResolvedValue({
      _id: ObjectID.generate(),
      order: 5,
    } as never);
  });

  test("admits as many service names as a project can hold services", () => {
    expect(MAX_SERVICE_NAMES).toBe(LIMIT_PER_PROJECT);
  });

  test("answers for every requested service, not just the first 500", async () => {
    const services: Array<Service> = makeServices(750);
    serviceService.findBy.mockResolvedValue(services as never);
    const last: Service = services[749]!;
    incidentService.findBy.mockResolvedValue([
      makeIncident("Checkout is down", [last], {
        name: "Critical",
        color: "#dc2626",
        order: 1,
      }),
    ] as never);

    const next: jest.Mock = await callStatus({
      serviceNames: services.map((service: Service): string => {
        return service.name!;
      }),
    });

    expect(next).not.toHaveBeenCalled();
    const rows: JSONArray = responseServices();
    expect(rows).toHaveLength(750);
    const lastRow: JSONObject = rows[749] as JSONObject;
    expect(lastRow["serviceName"]).toBe(last.name);
    expect(lastRow["activeIncidentCount"]).toBe(1);
    expect(lastRow["worstIncidentSeverityName"]).toBe("Critical");
  });

  test("ignores names past the cap instead of failing the overlay", async () => {
    const services: Array<Service> = makeServices(MAX_SERVICE_NAMES + 5);
    serviceService.findBy.mockResolvedValue(services as never);

    await callStatus({
      serviceNames: services.map((service: Service): string => {
        return service.name!;
      }),
    });

    expect(responseServices()).toHaveLength(MAX_SERVICE_NAMES);
  });

  test("matches names case-insensitively and skips unknown names", async () => {
    serviceService.findBy.mockResolvedValue([makeService("Checkout")] as never);

    await callStatus({ serviceNames: ["checkout", "does-not-exist"] });

    const rows: JSONArray = responseServices();
    expect(rows).toHaveLength(1);
    expect((rows[0] as JSONObject)["serviceName"]).toBe("checkout");
  });

  test("summarizes incidents and alerts per service with the worst severity first", async () => {
    const checkout: Service = makeService("checkout");
    serviceService.findBy.mockResolvedValue([checkout] as never);
    incidentService.findBy.mockResolvedValue([
      makeIncident("Latency", [checkout], {
        name: "Minor",
        color: "#fbbf24",
        order: 3,
      }),
      makeIncident("Outage", [checkout], {
        name: "Critical",
        color: "#dc2626",
        order: 1,
      }),
    ] as never);
    alertService.findBy.mockResolvedValue([
      makeAlert("Error budget burn", [checkout]),
    ] as never);

    await callStatus({ serviceNames: ["checkout"] });

    const row: JSONObject = responseServices()[0] as JSONObject;
    expect(row["activeIncidentCount"]).toBe(2);
    expect(row["worstIncidentSeverityName"]).toBe("Critical");
    expect(row["activeAlertCount"]).toBe(1);
    expect((row["incidents"] as JSONArray).length).toBe(2);
  });

  test("lists at most five items per service but counts them all", async () => {
    const checkout: Service = makeService("checkout");
    serviceService.findBy.mockResolvedValue([checkout] as never);
    const incidents: Array<Incident> = [];
    for (let index: number = 0; index < 8; index++) {
      incidents.push(
        makeIncident(`Incident ${index}`, [checkout], {
          name: "Major",
          color: "#f97316",
          order: 2,
        }),
      );
    }
    incidentService.findBy.mockResolvedValue(incidents as never);

    await callStatus({ serviceNames: ["checkout"] });

    const row: JSONObject = responseServices()[0] as JSONObject;
    expect(row["activeIncidentCount"]).toBe(8);
    expect((row["incidents"] as JSONArray).length).toBe(5);
  });

  test("reports zero incidents when the project has no resolved incident state", async () => {
    serviceService.findBy.mockResolvedValue([makeService("checkout")] as never);
    incidentStateService.findOneBy.mockResolvedValue(null as never);

    await callStatus({ serviceNames: ["checkout"] });

    expect(incidentService.findBy).not.toHaveBeenCalled();
    const row: JSONObject = responseServices()[0] as JSONObject;
    expect(row["activeIncidentCount"]).toBe(0);
  });

  test("rejects a request without service names", async () => {
    const next: jest.Mock = await callStatus({ serviceNames: [] });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("rejects a request that carries no project", async () => {
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({} as never);

    const next: jest.Mock = await callStatus({ serviceNames: ["checkout"] });

    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(serviceService.findBy).not.toHaveBeenCalled();
  });
});
