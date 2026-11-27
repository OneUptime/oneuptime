import { mockRouter } from "./Helpers";
import PostgresListRouteHarness from "./PostgresListRouteHarness";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import MonitorService from "../../../Server/Services/MonitorService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendationCoverageQuestion,
  getCoverageQuestions,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * RECOMMENDED MONITORS' COVERAGE, DECIDED WITH A QUERY, THROUGH THE REAL
 * SERVER (#11074).
 *
 * Which recommended monitors a resource has already was worked out in the
 * browser from the project's first 10,000 monitors of each type, by name:
 * a monitor past them that covered a recommendation was never seen, the
 * recommendation read as missing, and the guided setup offered to make it a
 * second time. The page asks the server now (POST
 * /monitor/recommendation-coverage), which reads only the monitors whose
 * stored steps mention what each recommendation is about, under the
 * member's own permissions, and fingerprints those.
 *
 * On migrated Postgres, with 10,050 Host monitors of other hosts named to
 * sort first, and, past them, the ones that cover a host's recommendations -
 * asked as two members: one who reads every monitor, and one whose team
 * reads only the monitors with a label - through MonitorAPI's route and the
 * user middleware that builds each member's permissions from the tables.
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (PostgresListRouteHarness).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PICKER_SEARCH_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source is the harness's; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// More Host monitors than the pages ever read, every one named to sort first.
const OTHER_HOSTS: number = 10050;
const HOST: string = "db-host-7";
// Written with the characters JSON escapes.
const QUOTED_HOST: string = 'pve "blue" \\ west';

describePostgres(
  "Recommended monitors' coverage, decided with a query, through the real server (#11074)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "recommendation_coverage",
      tables: ["Monitor", "MonitorLabel"],
    });

    // The routes, as the app registers them.
    new MonitorAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    // Reads every monitor.
    const memberId: ObjectID = ObjectID.generate();
    // Reads only the monitors with the label.
    const labelReaderId: ObjectID = ObjectID.generate();
    // Reads no monitor at all.
    const strangerId: ObjectID = ObjectID.generate();
    const labelId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getAllPossibleRecommendations(
        MonitorRecommendationResourceType.Host,
      );

    // The monitors that matter, by what each covers.
    const coversFirstId: ObjectID = ObjectID.generate();
    const coversSecondLabelledId: ObjectID = ObjectID.generate();
    const otherProjectCoversThirdId: ObjectID = ObjectID.generate();
    const coversQuotedHostId: ObjectID = ObjectID.generate();

    const argsOf: (resourceIdentifier: string) => MonitorRecommendationArgs = (
      resourceIdentifier: string,
    ): MonitorRecommendationArgs => {
      return {
        resourceIdentifier,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: resourceIdentifier,
      };
    };

    // A monitor's steps as the database stores them: made from the recommendation, for the host.
    const storedStepsOf: (
      recommendation: MonitorRecommendation,
      resourceIdentifier: string,
    ) => string = (
      recommendation: MonitorRecommendation,
      resourceIdentifier: string,
    ): string => {
      const args: MonitorRecommendationArgs = argsOf(resourceIdentifier);
      const step: MonitorStep = recommendation.getMonitorStep({
        ...args,
        monitorName: MonitorRecommendationUtil.getTemplateMonitorName({
          recommendation,
          resourceDisplayName: args.monitorName,
        }),
      });
      const monitorSteps: MonitorSteps = new MonitorSteps();
      monitorSteps.data = {
        monitorStepsInstanceArray: [step],
        defaultMonitorStatusId: monitorStatusId,
      };

      return JSON.stringify(MonitorSteps.toDatabaseJSON(monitorSteps.toJSON()));
    };

    const insertMonitor: (data: {
      id: ObjectID;
      name: string;
      steps: string;
      inProject?: ObjectID | undefined;
      isLabelled?: boolean | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      steps: string;
      inProject?: ObjectID | undefined;
      isLabelled?: boolean | undefined;
    }): Promise<void> => {
      await harness.query(
        `INSERT INTO "${harness.schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "monitorSteps")
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          data.id.toString(),
          (data.inProject || projectId).toString(),
          data.name,
          `${data.name.toLowerCase()}-${data.id.toString()}`,
          MonitorType.Host,
          monitorStatusId.toString(),
          data.steps,
        ],
      );

      if (data.isLabelled) {
        await harness.insert("MonitorLabel", {
          monitorId: data.id,
          labelId: labelId,
        });
      }
    };

    const requestAs: (userId: ObjectID, body: JSONObject) => ExpressRequest = (
      userId: ObjectID,
      body: JSONObject,
    ): ExpressRequest => {
      return {
        method: "POST",
        params: {},
        query: {},
        cookies: {},
        headers: {
          authorization: `Bearer ${userId.toString()}`,
          tenantid: projectId.toString(),
        },
        body: body,
      } as unknown as ExpressRequest;
    };

    // The route, as the member: its middleware, then its handler.
    const askAs: (
      userId: ObjectID,
      questions: Array<MonitorRecommendationCoverageQuestion> | unknown,
    ) => Promise<Record<string, string>> = async (
      userId: ObjectID,
      questions: Array<MonitorRecommendationCoverageQuestion> | unknown,
    ): Promise<Record<string, string>> => {
      jest.mocked(Response.sendJsonObjectResponse).mockClear();

      const req: ExpressRequest = requestAs(userId, {
        questions: questions as JSONObject,
      } as JSONObject);
      const res: ExpressResponse = {
        set: jest.fn(),
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;
      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        "post",
        "/monitor/recommendation-coverage",
      );

      for (const middleware of route.middlewares) {
        let isPassed: boolean = false;

        await middleware(req, res, ((error?: unknown) => {
          if (!error) {
            isPassed = true;
          }
        }) as NextFunction);

        if (!isPassed) {
          throw new Error("The question was refused before it was read.");
        }
      }

      let forwardedError: unknown = undefined;

      await route.handlerFunction(req, res, ((error: unknown) => {
        forwardedError = error;
      }) as NextFunction);

      if (forwardedError) {
        throw forwardedError;
      }

      const call: Array<unknown> | undefined = jest.mocked(
        Response.sendJsonObjectResponse,
      ).mock.calls[0];

      if (!call) {
        throw new Error("The route answered nothing.");
      }

      return (
        JSON.parse(JSON.stringify(call[2])) as {
          covered: Record<string, string>;
        }
      ).covered;
    };

    const questionsFor: (
      resourceIdentifier: string,
    ) => Array<MonitorRecommendationCoverageQuestion> = (
      resourceIdentifier: string,
    ): Array<MonitorRecommendationCoverageQuestion> => {
      return getCoverageQuestions({
        recommendations,
        args: argsOf(resourceIdentifier),
      });
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Harbour logistics");
      await harness.insertProject(otherProjectId, "Another project");

      await harness.insertLabel({
        id: labelId,
        projectId: projectId,
        name: "Database team",
      });

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
      });
      await harness.insertMember({
        userId: labelReaderId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ReadProjectMonitor,
        labelIds: [labelId],
      });
      await harness.insertMember({
        userId: strangerId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ReadProjectIncident,
      });

      /*
       * 10,050 Host monitors of other hosts, each made from the first
       * recommendation for its own host, named to sort before any other -
       * in one statement, the host written into each one's steps.
       */
      await harness.query(
        `INSERT INTO "${harness.schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "monitorSteps")
         SELECT gen_random_uuid(), 1, $1, 'a-' || lpad(i::text, 6, '0'), 'a-' || i || '-' || gen_random_uuid(), $2, $3, replace($4, '__HOST__', 'other-host-' || i)::jsonb
         FROM generate_series(1, $5) AS i`,
        [
          projectId.toString(),
          MonitorType.Host,
          monitorStatusId.toString(),
          storedStepsOf(recommendations[0]!, "__HOST__"),
          OTHER_HOSTS,
        ],
      );

      // Past them: the host's own.
      await insertMonitor({
        id: coversFirstId,
        name: "zz-db-host-7-first",
        steps: storedStepsOf(recommendations[0]!, HOST),
      });
      await insertMonitor({
        id: coversSecondLabelledId,
        name: "zz-db-host-7-second",
        steps: storedStepsOf(recommendations[1]!, HOST),
        isLabelled: true,
      });
      // Another project's covers nothing here, whatever it watches.
      await insertMonitor({
        id: otherProjectCoversThirdId,
        name: "zz-db-host-7-third",
        steps: storedStepsOf(recommendations[2]!, HOST),
        inProject: otherProjectId,
      });
      await insertMonitor({
        id: coversQuotedHostId,
        name: "zz-quoted",
        steps: storedStepsOf(recommendations[0]!, QUOTED_HOST),
      });

      await harness.analyze("Monitor");
    }, 240000);

    afterAll(async () => {
      await harness.tearDown();
    });

    test("a monitor past the project's first 10,000 that covers a recommendation is found, as a member", async () => {
      const covered: Record<string, string> = await askAs(
        memberId,
        questionsFor(HOST),
      );

      expect(covered[recommendations[0]!.recommendationId]).toBe(
        coversFirstId.toString(),
      );
      expect(covered[recommendations[1]!.recommendationId]).toBe(
        coversSecondLabelledId.toString(),
      );
      // Another project's monitor covers nothing here.
      expect(covered[recommendations[2]!.recommendationId]).toBeUndefined();
      expect(Object.keys(covered).sort()).toEqual(
        [
          recommendations[0]!.recommendationId,
          recommendations[1]!.recommendationId,
        ].sort(),
      );
    });

    test("only the monitors whose stored steps mention the host are read - never the 10,050 others", async () => {
      const findBy: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
        MonitorService,
        "findBy",
      );

      try {
        await askAs(memberId, questionsFor(HOST));

        const read: Array<Monitor> = [];

        for (const result of findBy.mock.results) {
          read.push(...((await result.value) as Array<Monitor>));
        }

        expect(
          read
            .map((monitor: Monitor): string => {
              return monitor.id!.toString();
            })
            .sort(),
        ).toEqual(
          [coversFirstId.toString(), coversSecondLabelledId.toString()].sort(),
        );
      } finally {
        findBy.mockRestore();
      }
    });

    test("a member whose team reads only the labelled monitors is answered from those alone", async () => {
      const covered: Record<string, string> = await askAs(
        labelReaderId,
        questionsFor(HOST),
      );

      expect(covered).toEqual({
        [recommendations[1]!.recommendationId]:
          coversSecondLabelledId.toString(),
      });
    });

    test("a host written with quotes and a backslash is found as Postgres writes the JSON out", async () => {
      const covered: Record<string, string> = await askAs(
        memberId,
        questionsFor(QUOTED_HOST),
      );

      expect(covered[recommendations[0]!.recommendationId]).toBe(
        coversQuotedHostId.toString(),
      );
    });

    test("a host no monitor watches has nothing covered", async () => {
      expect(await askAs(memberId, questionsFor("no-such-host"))).toEqual({});
    });

    test("a question that is not one is refused, saying what is wrong", async () => {
      await expect(
        askAs(memberId, [
          { key: "k", monitorType: MonitorType.Host, fingerprints: ["{}"] },
        ]),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("a member who may not read monitors is refused", async () => {
      await expect(askAs(strangerId, questionsFor(HOST))).rejects.toThrow(
        "You do not have permission to read this project's monitors.",
      );
    });
  },
);
