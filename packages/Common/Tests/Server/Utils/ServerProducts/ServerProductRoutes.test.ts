import ServerProductRoutes from "../../../../Server/Utils/ServerProducts/ServerProductRoutes";
import ProductsOfRequest, {
  PRODUCT_OF_AI_RESOURCE_TYPE,
  PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE,
} from "../../../../Server/Utils/ServerProducts/ProductsOfRequest";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "../../../../Server/Utils/Express";
import ProductSwitchedOffException from "../../../../Types/Exception/ProductSwitchedOffException";
import ProductKey, { PRODUCT_KEYS } from "../../../../Types/Product/ProductKey";
import { getProductsOfRecordTable } from "../../../../Types/Product/ProductRecordTables";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import { RuleRunType } from "../../../../Types/Rules/RuleRun";
import { WorkspaceChannelRecordType } from "../../../../Types/Workspace/WorkspaceChannelLink";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A ROUTE NAMES THE PRODUCTS IT ACTS ON, AND IS REFUSED WHILE ONE IS OFF
 * (#7479, #9489).
 *
 * One product, several (refuseWhileOff), the products the request names
 * (refuseWhileOffFor, read from the request alone by ProductsOfRequest), or
 * the products of the record table it names (refuseWhileRecordTableIsOff,
 * as BaseAPI refuses a record's write). Refused with the words and the
 * status PR #9484's refusals have; handed on to the handler otherwise.
 */

let getOff: SpyInstance<typeof ServerProducts.getOff>;

const switchOff: (products: Array<ProductKey>) => void = (
  products: Array<ProductKey>,
): void => {
  getOff.mockResolvedValue(
    Object.fromEntries(
      products.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
  );
};

beforeEach(() => {
  getOff = jest.spyOn(ServerProducts, "getOff").mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What the middleware handed next: [undefined] when it went on.
const run: (
  middleware: RequestHandler,
  req?: Partial<ExpressRequest>,
) => Promise<Array<unknown>> = async (
  middleware: RequestHandler,
  req: Partial<ExpressRequest> = {},
): Promise<Array<unknown>> => {
  const calledWith: Array<unknown> = [];
  // An Express handler is typed as returning nothing; these are async.
  const handler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> = middleware as unknown as (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;

  await handler(
    { body: {}, params: {}, ...req } as ExpressRequest,
    {} as ExpressResponse,
    ((err?: unknown): void => {
      calledWith.push(err);
    }) as NextFunction,
  );

  return calledWith;
};

const expectRefusedFor: (
  calledWith: Array<unknown>,
  product: ProductKey,
  title: string,
) => void = (
  calledWith: Array<unknown>,
  product: ProductKey,
  title: string,
): void => {
  expect(calledWith).toHaveLength(1);
  expect(calledWith[0]).toBeInstanceOf(ProductSwitchedOffException);
  expect((calledWith[0] as ProductSwitchedOffException).product).toBe(product);
  expect((calledWith[0] as ProductSwitchedOffException).message).toBe(
    `${title} is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.`,
  );
};

describe("ServerProductRoutes.refuseWhileOff, of several products", () => {
  test("is refused while any of them is off, naming that one", async () => {
    switchOff([ProductKey.Incidents]);

    expectRefusedFor(
      await run(
        ServerProductRoutes.refuseWhileOff(
          ProductKey.OnCall,
          ProductKey.Incidents,
        ),
      ),
      ProductKey.Incidents,
      "Incidents",
    );
  });

  test("names the first of them that is off", async () => {
    switchOff([ProductKey.Incidents, ProductKey.OnCall]);

    expectRefusedFor(
      await run(
        ServerProductRoutes.refuseWhileOff(
          ProductKey.OnCall,
          ProductKey.Incidents,
        ),
      ),
      ProductKey.OnCall,
      "On-Call",
    );
  });

  test("goes on while every one of them is on", async () => {
    switchOff([ProductKey.Logs]);

    expect(
      await run(
        ServerProductRoutes.refuseWhileOff(
          ProductKey.OnCall,
          ProductKey.Incidents,
        ),
      ),
    ).toEqual([undefined]);
  });

  test("a 403, as every refusal of a switched-off product is", async () => {
    switchOff([ProductKey.Runbooks]);

    const [refusal] = await run(
      ServerProductRoutes.refuseWhileOff(ProductKey.Runbooks),
    );

    expect((refusal as ProductSwitchedOffException).code).toBe(403);
  });
});

describe("ServerProductRoutes.refuseWhileOffFor", () => {
  test("is refused while a product the request names is off", async () => {
    switchOff([ProductKey.Alerts]);

    expectRefusedFor(
      await run(
        ServerProductRoutes.refuseWhileOffFor(
          ProductsOfRequest.incidentOrAlert,
        ),
        { body: { subjectType: "alert", subjectId: "x" } },
      ),
      ProductKey.Alerts,
      "Alerts",
    );
  });

  test("goes on when the request names a product that is on", async () => {
    switchOff([ProductKey.Alerts]);

    expect(
      await run(
        ServerProductRoutes.refuseWhileOffFor(
          ProductsOfRequest.incidentOrAlert,
        ),
        { body: { subjectType: "incident", subjectId: "x" } },
      ),
    ).toEqual([undefined]);
  });

  test("goes on to its handler when the request names nothing it knows", async () => {
    switchOff([ProductKey.Incidents, ProductKey.Alerts]);

    expect(
      await run(
        ServerProductRoutes.refuseWhileOffFor(
          ProductsOfRequest.incidentOrAlert,
        ),
        { body: { subjectType: "monitor" } },
      ),
    ).toEqual([undefined]);
  });

  test("a reader that throws names nothing: the handler answers the request", async () => {
    switchOff([ProductKey.Incidents]);

    expect(
      await run(
        ServerProductRoutes.refuseWhileOffFor((): Array<ProductKey> => {
          throw new Error("not a request this reads");
        }),
      ),
    ).toEqual([undefined]);
  });

  test("reads only the request: what is off is asked once a product is named", async () => {
    await run(
      ServerProductRoutes.refuseWhileOffFor((): Array<ProductKey> => {
        return [];
      }),
    );

    expect(getOff).not.toHaveBeenCalled();
  });
});

describe("ServerProductRoutes.refuseWhileRecordTableIsOff", () => {
  test("is refused while the table's product is off, as a write of its record is", async () => {
    switchOff([ProductKey.Incidents]);

    expectRefusedFor(
      await run(
        ServerProductRoutes.refuseWhileRecordTableIsOff(
          ProductsOfRequest.ruleTable,
        ),
        { params: { ruleType: RuleRunType.IncidentLabelRule } },
      ),
      ProductKey.Incidents,
      "Incidents",
    );
  });

  test("a table two products share is refused only while both are off", async () => {
    switchOff([ProductKey.Cloud]);

    const middleware: RequestHandler =
      ServerProductRoutes.refuseWhileRecordTableIsOff(
        ProductsOfRequest.ruleTable,
      );
    const req: Partial<ExpressRequest> = {
      params: { ruleType: RuleRunType.CloudResourceLabelRule },
    };

    // A cloud's resources: App Platforms draws its environments from them.
    expect(await run(middleware, req)).toEqual([undefined]);

    switchOff([ProductKey.Cloud, ProductKey.AppPlatforms]);

    expectRefusedFor(await run(middleware, req), ProductKey.Cloud, "Cloud");
  });

  test("goes on for a table of no product, or a request that names none", async () => {
    switchOff([ProductKey.Incidents]);

    const middleware: RequestHandler =
      ServerProductRoutes.refuseWhileRecordTableIsOff(
        ProductsOfRequest.ruleTable,
      );

    expect(await run(middleware, { params: { ruleType: "Label" } })).toEqual([
      undefined,
    ]);
    expect(await run(middleware, { params: {} })).toEqual([undefined]);
  });
});

describe("ServerProductRoutes.isRefusal", () => {
  test("tells each refusal from any other middleware", () => {
    expect(
      ServerProductRoutes.isRefusal(
        ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
      ),
    ).toBe(true);
    expect(
      ServerProductRoutes.isRefusal(
        ServerProductRoutes.refuseWhileOffFor(ProductsOfRequest.aiResource),
      ),
    ).toBe(true);
    expect(
      ServerProductRoutes.isRefusal(
        ServerProductRoutes.refuseWhileRecordTableIsOff(
          ProductsOfRequest.ruleTable,
        ),
      ),
    ).toBe(true);

    expect(
      ServerProductRoutes.isRefusal((): void => {
        return undefined;
      }),
    ).toBe(false);
    expect(ServerProductRoutes.isRefusal(undefined)).toBe(false);
    expect(ServerProductRoutes.isRefusal("refuseWhileOff")).toBe(false);
  });
});

describe("ProductsOfRequest", () => {
  test("incidentOrAlert: by the subject type, or by the id the body names", () => {
    expect(
      ProductsOfRequest.incidentOrAlert({
        body: { subjectType: "incident" },
        params: {},
      }),
    ).toEqual([ProductKey.Incidents]);
    expect(
      ProductsOfRequest.incidentOrAlert({
        body: { subjectType: " alert " },
        params: {},
      }),
    ).toEqual([ProductKey.Alerts]);
    expect(
      ProductsOfRequest.incidentOrAlert({
        body: { incidentId: "c9489000-0000-4000-8000-000000000001" },
        params: {},
      }),
    ).toEqual([ProductKey.Incidents]);
    expect(
      ProductsOfRequest.incidentOrAlert({
        body: { alertId: "c9489000-0000-4000-8000-000000000002" },
        params: {},
      }),
    ).toEqual([ProductKey.Alerts]);
  });

  test("incidentOrAlert: both ids name both, and the handler refuses the request", () => {
    expect(
      ProductsOfRequest.incidentOrAlert({
        body: { incidentId: "a", alertId: "b" },
        params: {},
      }),
    ).toEqual([ProductKey.Incidents, ProductKey.Alerts]);
  });

  test("incidentOrAlert: nothing it knows names no product", () => {
    for (const body of [
      undefined,
      null,
      "incident",
      [],
      {},
      { subjectType: "monitor" },
      { incidentId: "" },
      { alertId: 7 },
    ]) {
      expect(
        ProductsOfRequest.incidentOrAlert({ body: body, params: {} }),
      ).toEqual([]);
    }
  });

  test("workspaceChannelRecord: every record type a channel is for has its product", () => {
    expect(
      Object.values(WorkspaceChannelRecordType).map(
        (recordType: WorkspaceChannelRecordType): Array<ProductKey> => {
          return ProductsOfRequest.workspaceChannelRecord({
            body: {},
            params: { recordType: recordType },
          });
        },
      ),
    ).toEqual([
      [ProductKey.Incidents],
      [ProductKey.Alerts],
      [ProductKey.Incidents],
      [ProductKey.Alerts],
      [ProductKey.ScheduledMaintenance],
    ]);
    expect(
      ProductsOfRequest.workspaceChannelRecord({
        body: {},
        params: { recordType: "monitor" },
      }),
    ).toEqual([]);
    expect(
      Object.keys(PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE).sort(),
    ).toEqual(Object.values(WorkspaceChannelRecordType).sort());
  });

  test("aiResource: every resource type an AI agent serves has its product", () => {
    expect(Object.keys(PRODUCT_OF_AI_RESOURCE_TYPE).sort()).toEqual(
      [...ALL_AI_RESOURCE_TYPES].sort(),
    );

    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      const products: Array<ProductKey> = ProductsOfRequest.aiResource({
        body: { resourceType: resourceType },
        params: {},
      });

      expect(products).toHaveLength(1);
      expect(PRODUCT_KEYS).toContain(products[0]);
    }

    expect(
      ProductsOfRequest.aiResource({
        body: { resourceType: AiResourceType.AwsAccount },
        params: {},
      }),
    ).toEqual([ProductKey.Cloud]);
    expect(
      ProductsOfRequest.aiResource({
        body: { resourceType: AiResourceType.DatabaseServer },
        params: {},
      }),
    ).toEqual([ProductKey.Databases]);
    expect(
      ProductsOfRequest.aiResource({
        body: { resourceType: "KubernetesCluster" },
        params: {},
      }),
    ).toEqual([]);
  });

  test("aiResource: each resource's product is the product of its records", () => {
    // The table each resource type's records are in (ResourceAiAccessAPI).
    const tableOf: Record<AiResourceType, string> = {
      [AiResourceType.DockerHost]: "DockerHost",
      [AiResourceType.PodmanHost]: "PodmanHost",
      [AiResourceType.DockerSwarmCluster]: "DockerSwarmCluster",
      [AiResourceType.ProxmoxCluster]: "ProxmoxCluster",
      [AiResourceType.VMwareVCenter]: "VMwareVCenter",
      [AiResourceType.CephCluster]: "CephCluster",
      [AiResourceType.DatabaseServer]: "DatabaseServer",
      [AiResourceType.Host]: "Host",
      [AiResourceType.AwsAccount]: "CloudAccount",
      [AiResourceType.AzureSubscription]: "CloudAccount",
      [AiResourceType.GoogleCloudProject]: "CloudAccount",
      [AiResourceType.OpenStackCloud]: "OpenStackCloud",
    };

    for (const resourceType of ALL_AI_RESOURCE_TYPES) {
      expect({
        resourceType,
        products: getProductsOfRecordTable(tableOf[resourceType]),
      }).toEqual({
        resourceType,
        products: [PRODUCT_OF_AI_RESOURCE_TYPE[resourceType]],
      });
    }
  });

  test("ruleTable: every rule that can be run is a table of a product", () => {
    const ofNoProduct: Array<string> = Object.values(RuleRunType).filter(
      (ruleType: string): boolean => {
        return getProductsOfRecordTable(ruleType).length === 0;
      },
    );

    expect(ofNoProduct).toEqual([]);
    expect(
      ProductsOfRequest.ruleTable({
        body: {},
        params: { ruleType: RuleRunType.MonitorOwnerRule },
      }),
    ).toBe("MonitorOwnerRule");
    expect(ProductsOfRequest.ruleTable({ body: {}, params: {} })).toBeNull();
  });
});
