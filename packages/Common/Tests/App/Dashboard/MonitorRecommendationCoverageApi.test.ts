import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import MonitorRecommendationCoverageApi from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  MAX_COVERAGE_QUESTIONS,
  MonitorRecommendationCoverageQuestion,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * WHICH RECOMMENDED MONITORS A RESOURCE HAS ALREADY, ASKED OF THE SERVER
 * (#11074): the Dashboard's side of POST /monitor/recommendation-coverage.
 * A page's questions are sent in requests the server takes - a cloud
 * account's thousands of resources in several - and a refusal fails the
 * whole answer, so a page never offers again what it could not tell.
 */

const FINGERPRINT: string = JSON.stringify([
  "web-1",
  "hostMonitor",
  [],
  [],
  [],
  [],
  [],
  [],
]);

function questions(
  count: number,
): Array<MonitorRecommendationCoverageQuestion> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return {
      key: `q-${index}`,
      monitorType: MonitorType.Host,
      fingerprints: [FINGERPRINT],
    };
  });
}

let postSpy: SpyInstance<typeof API.post>;
let answer: (asked: Array<MonitorRecommendationCoverageQuestion>) => unknown;

beforeEach(() => {
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  answer = () => {
    return { covered: {} };
  };
  postSpy = jest.spyOn(API, "post").mockImplementation((async (request: {
    data: { questions: Array<MonitorRecommendationCoverageQuestion> };
  }): Promise<unknown> => {
    const body: unknown = answer(request.data.questions);

    return body instanceof HTTPErrorResponse
      ? body
      : new HTTPResponse<JSONObject>(200, body as JSONObject, {});
  }) as never) as unknown as SpyInstance<typeof API.post>;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("asking which monitors cover a page's recommendations", () => {
  test("posts the questions to the monitors' coverage route", async () => {
    await MonitorRecommendationCoverageApi.findCoveringMonitors(questions(2));

    expect(postSpy).toHaveBeenCalledTimes(1);
    const request: { url: unknown; data: unknown } = postSpy.mock
      .calls[0]![0] as unknown as { url: unknown; data: unknown };
    expect(String(request.url)).toMatch(/\/monitor\/recommendation-coverage$/);
    expect(request.data).toEqual({ questions: questions(2) });
  });

  test("many questions go in requests the server takes, one after another, and every answer is kept", async () => {
    answer = (asked: Array<MonitorRecommendationCoverageQuestion>) => {
      return {
        covered: Object.fromEntries(
          asked.map(
            (
              question: MonitorRecommendationCoverageQuestion,
              index: number,
            ) => {
              return [
                question.key,
                `11074000-0000-4000-8000-${String(index).padStart(12, "0")}`,
              ];
            },
          ),
        ),
      };
    };

    const covered: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.findCoveringMonitors(
        questions(1200),
      );

    expect(
      postSpy.mock.calls.map((call: Array<unknown>): number => {
        return (
          call[0] as {
            data: { questions: Array<MonitorRecommendationCoverageQuestion> };
          }
        ).data.questions.length;
      }),
    ).toEqual([
      MAX_COVERAGE_QUESTIONS,
      MAX_COVERAGE_QUESTIONS,
      1200 - 2 * MAX_COVERAGE_QUESTIONS,
    ]);
    expect(covered.size).toBe(1200);
    expect(covered.get("q-1199")).toBeInstanceOf(ObjectID);
  });

  test("no question, no request", async () => {
    expect(
      (await MonitorRecommendationCoverageApi.findCoveringMonitors([])).size,
    ).toBe(0);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a refusal fails the answer: nothing is said to be missing that the server could not tell", async () => {
    answer = () => {
      return new HTTPErrorResponse(
        403,
        {
          message:
            "You do not have permission to read this project's monitors.",
        },
        {},
      );
    };

    await expect(
      MonitorRecommendationCoverageApi.findCoveringMonitors(questions(1)),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("an answer that is not a monitor's id is left out", async () => {
    answer = () => {
      return {
        covered: {
          "q-0": "11074000-0000-4000-8000-000000000001",
          "q-1": "not-an-id",
          "q-2": 7,
        },
      };
    };

    const covered: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.findCoveringMonitors(questions(3));

    expect(Array.from(covered.keys())).toEqual(["q-0"]);
  });

  test("a resource's recommendations are asked by their ids, with their monitors' types", async () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getAllPossibleRecommendations(
        MonitorRecommendationResourceType.Host,
      );

    await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds({
      recommendations,
      args: {
        resourceIdentifier: "web-1",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "web-1",
      },
    });

    const asked: Array<MonitorRecommendationCoverageQuestion> = (
      postSpy.mock.calls[0]![0] as unknown as {
        data: { questions: Array<MonitorRecommendationCoverageQuestion> };
      }
    ).data.questions;

    expect(
      asked.map((question: MonitorRecommendationCoverageQuestion) => {
        return [question.key, question.monitorType];
      }),
    ).toEqual(
      recommendations.map((recommendation: MonitorRecommendation) => {
        return [recommendation.recommendationId, recommendation.monitorType];
      }),
    );
  });
});
