import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of the service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveFeed, {
  ServiceLevelObjectiveFeedEventType,
} from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import logger from "../../../Server/Utils/Logger";
import { Blue500, Red500 } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";

/*
 * Contract under test: ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem
 * is the single write path every SLO feed event goes through - the SLO
 * service hooks, the burn-rate and monitor-rule services, and the evaluation
 * worker on every status transition. Its promises are what let all of those
 * call it without a try/catch of their own:
 *
 *   - it writes the item it was given, as root (callers are system code, and
 *     the Create permission gates only the public API),
 *   - postedAt is stamped, and an explicit one wins so the worker's tick time
 *     orders a status change before the alert it caused,
 *   - it never throws: a missing field or a failed insert is logged and
 *     swallowed, because the feed describes a write that already happened.
 *
 * Plus the wiring the retention job and API depend on.
 */

const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

interface CreateCall {
  data: ServiceLevelObjectiveFeed;
  props: { isRoot?: boolean };
}

describe("ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem", () => {
  let calls: Array<CreateCall> = [];

  beforeEach(() => {
    calls = [];

    jest
      .spyOn(ServiceLevelObjectiveFeedService, "create")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(
        (createBy: any): Promise<ServiceLevelObjectiveFeed> => {
          calls.push(createBy as CreateCall);
          return Promise.resolve(createBy.data as ServiceLevelObjectiveFeed);
        },
      );

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes every field it was given", async () => {
    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.StatusChanged,
      feedInfoInMarkdown: "status changed",
      moreInformationInMarkdown: "**SLI:** 99.1%",
      displayColor: Red500,
      userId: USER_ID,
    });

    expect(calls).toHaveLength(1);

    const item: ServiceLevelObjectiveFeed = calls[0]!.data;

    expect(item).toBeInstanceOf(ServiceLevelObjectiveFeed);
    expect(item.serviceLevelObjectiveId).toBe(SLO_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.StatusChanged,
    );
    expect(item.feedInfoInMarkdown).toBe("status changed");
    expect(item.moreInformationInMarkdown).toBe("**SLI:** 99.1%");
    expect(item.displayColor).toBe(Red500);
    expect(item.userId).toBe(USER_ID);
  });

  test("writes as root, since its callers are hooks and the worker", async () => {
    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised,
      feedInfoInMarkdown: "alert raised",
    });

    expect(calls[0]!.props).toEqual({ isRoot: true });
  });

  test("stamps postedAt when none is given, so the feed can sort on it", async () => {
    const before: number = Date.now();

    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveCreated,
      feedInfoInMarkdown: "created",
    });

    const postedAt: Date | undefined = calls[0]!.data.postedAt;

    expect(postedAt).toBeInstanceOf(Date);
    expect(postedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test("honours an explicit postedAt (the worker passes its tick time)", async () => {
    const postedAt: Date = new Date("2026-09-15T10:30:00.000Z");

    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.StatusChanged,
      feedInfoInMarkdown: "status changed",
      postedAt: postedAt,
    });

    expect(calls[0]!.data.postedAt).toBe(postedAt);
  });

  test("defaults the colour so the timeline never renders a colourless dot", async () => {
    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.OwnerUserAdded,
      feedInfoInMarkdown: "owner added",
    });

    expect(calls[0]!.data.displayColor).toBe(Blue500);
  });

  test("leaves optional fields unset rather than writing empty values", async () => {
    await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveFeedEventType:
        ServiceLevelObjectiveFeedEventType.MonitorsAttached,
      feedInfoInMarkdown: "monitors attached",
      moreInformationInMarkdown: "",
    });

    const item: ServiceLevelObjectiveFeed = calls[0]!.data;

    // No user means the feed shows the event icon instead of an avatar.
    expect(item.userId).toBeUndefined();
    expect(item.moreInformationInMarkdown).toBeUndefined();
  });

  test.each([
    ["serviceLevelObjectiveId", { serviceLevelObjectiveId: undefined }],
    ["projectId", { projectId: undefined }],
    ["feedInfoInMarkdown", { feedInfoInMarkdown: "" }],
    [
      "serviceLevelObjectiveFeedEventType",
      { serviceLevelObjectiveFeedEventType: undefined },
    ],
  ])(
    "writes nothing, logs, and does not throw when %s is missing",
    async (_name: string, override: Record<string, unknown>) => {
      await expect(
        ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
          serviceLevelObjectiveId: SLO_ID,
          projectId: PROJECT_ID,
          serviceLevelObjectiveFeedEventType:
            ServiceLevelObjectiveFeedEventType.StatusChanged,
          feedInfoInMarkdown: "status changed",
          ...override,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      ).resolves.toBeUndefined();

      expect(calls).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    },
  );

  test("swallows a failing insert rather than failing the evaluation that caused it", async () => {
    jest
      .spyOn(ServiceLevelObjectiveFeedService, "create")
      .mockImplementation((): Promise<ServiceLevelObjectiveFeed> => {
        return Promise.reject(new Error("postgres is down"));
      });

    await expect(
      ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem({
        serviceLevelObjectiveId: SLO_ID,
        projectId: PROJECT_ID,
        serviceLevelObjectiveFeedEventType:
          ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared,
        feedInfoInMarkdown: "incident declared",
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveFeedService wiring", () => {
  const SERVICE_SOURCE: string = fs.readFileSync(
    path.join(SERVICES_DIRECTORY, "ServiceLevelObjectiveFeedService.ts"),
    "utf8",
  );

  const SERVICES_INDEX: string = fs.readFileSync(
    path.join(SERVICES_DIRECTORY, "Index.ts"),
    "utf8",
  );

  const BASE_API_INDEX: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "BaseAPI",
      "Index.ts",
    ),
    "utf8",
  );

  type SquashFunction = (source: string) => string;

  const squash: SquashFunction = (source: string): string => {
    return source.replace(/\s+/g, " ");
  };

  test("serves the model's own table", () => {
    expect(ServiceLevelObjectiveFeedService.getModel().tableName).toBe(
      "ServiceLevelObjectiveFeed",
    );
  });

  test("declares the common three year retention window", () => {
    expect(SERVICE_SOURCE).toContain(
      'this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);',
    );
  });

  test("is registered, so its table is created and retention actually runs", () => {
    expect(SERVICES_INDEX).toContain(
      'import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";',
    );
    expect(SERVICES_INDEX).toMatch(/^\s{2}ServiceLevelObjectiveFeedService,$/m);
  });

  test("is served over the API, so the feed page can read it", () => {
    /*
     * Whitespace-insensitive on purpose: the type arguments are too long for
     * one line, so the formatter splits `new BaseAPI<...>(` across lines.
     */
    expect(BASE_API_INDEX).toContain(
      'import ServiceLevelObjectiveFeedService, {\n  Service as ServiceLevelObjectiveFeedServiceType,\n} from "Common/Server/Services/ServiceLevelObjectiveFeedService";',
    );
    expect(squash(BASE_API_INDEX)).toContain(
      "new BaseAPI< ServiceLevelObjectiveFeed, ServiceLevelObjectiveFeedServiceType >( ServiceLevelObjectiveFeed, ServiceLevelObjectiveFeedService, ).getRouter()",
    );
  });
});
