import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MAX_COVERAGE_FINGERPRINTS_PER_QUESTION,
  MAX_COVERAGE_KEY_LENGTH,
  MAX_COVERAGE_QUESTIONS,
  MonitorRecommendationCoverageMatcher,
  MonitorRecommendationCoverageQuestion,
  getCoverageQuestions,
  getCoverageSearchText,
  parseSerializedFingerprint,
  readCoverageQuestions,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import MonitorRecommendationUtil, {
  MonitorRecommendationFingerprint,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { getRepresentativeRecommendations } from "./RepresentativeRecommendations";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH RECOMMENDED MONITORS A PROJECT HAS ALREADY, ASKED OF THE SERVER
 * (#11074).
 *
 * The pages that say which recommendations are created read the project's
 * first 10,000 monitors of each type and fingerprinted them in the browser.
 * They ask the server now, with the recommendations' fingerprints, and the
 * server reads only the monitors whose steps mention what each fingerprint
 * is about (getCoverageSearchText), then fingerprints those as the browser
 * did (MonitorRecommendationCoverageMatcher). Held here:
 *
 *   - the questions a page sends are its recommendations' own fingerprints;
 *   - for EVERY recommendation of the catalog, the steps of a monitor made
 *     from it, as the database stores them, hold its search text - so the
 *     narrowing never leaves out a monitor that covers it;
 *   - the matcher answers as getCoveredRecommendationMonitorIds did, over
 *     the same monitors in the same order;
 *   - and a request is read strictly.
 */

const RESOURCE_IDENTIFIER: string = ObjectID.generate().toString();

function argsOf(
  overrides?: Partial<MonitorRecommendationArgs>,
): MonitorRecommendationArgs {
  return {
    resourceIdentifier: RESOURCE_IDENTIFIER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "checkout",
    ...overrides,
  };
}

// The step a monitor made from the recommendation carries, named as the create flow names it.
function stepOf(
  recommendation: MonitorRecommendation,
  args: MonitorRecommendationArgs,
): MonitorStep {
  return recommendation.getMonitorStep({
    ...args,
    monitorName: MonitorRecommendationUtil.getTemplateMonitorName({
      recommendation,
      resourceDisplayName: args.monitorName,
    }),
  });
}

// A monitor's steps as the database stores them, as text.
function storedTextOf(steps: Array<MonitorStep>): string {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: ObjectID.getZeroObjectID(),
  };

  return JSON.stringify(MonitorSteps.toDatabaseJSON(monitorSteps.toJSON()));
}

const ALL_RESOURCE_TYPES: Array<MonitorRecommendationResourceTypeDefinition> =
  MonitorRecommendationCatalog.getResourceTypeDefinitions();

describe("the questions a page asks", () => {
  test("one per recommendation, named by its id, with its monitor's type and its own fingerprint first", () => {
    const recommendations: Array<MonitorRecommendation> =
      getRepresentativeRecommendations(ALL_RESOURCE_TYPES[0]!.resourceType);
    const args: MonitorRecommendationArgs = argsOf();

    const questions: Array<MonitorRecommendationCoverageQuestion> =
      getCoverageQuestions({ recommendations, args });

    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      const recommendation: MonitorRecommendation = recommendations.find(
        (candidate: MonitorRecommendation): boolean => {
          return candidate.recommendationId === question.key;
        },
      )!;

      expect(question.monitorType).toBe(recommendation.monitorType);
      expect(question.fingerprints[0]).toBe(
        MonitorRecommendationUtil.serializeFingerprint(
          MonitorRecommendationUtil.getFingerprintFromMonitorStep(
            stepOf(recommendation, args),
          )!,
        ),
      );
      expect(question.fingerprints.length).toBeLessThanOrEqual(
        MAX_COVERAGE_FINGERPRINTS_PER_QUESTION,
      );
    }
  });

  test("a page may name each question its own way: a resource and a recommendation", () => {
    const recommendations: Array<MonitorRecommendation> =
      getRepresentativeRecommendations(ALL_RESOURCE_TYPES[0]!.resourceType);

    const questions: Array<MonitorRecommendationCoverageQuestion> =
      getCoverageQuestions({
        recommendations,
        args: argsOf(),
        keyOf: (recommendation: MonitorRecommendation): string => {
          return `resource-1|${recommendation.recommendationId}`;
        },
      });

    for (const question of questions) {
      expect(question.key.startsWith("resource-1|")).toBe(true);
    }
  });

  test("no recommendation, no question", () => {
    expect(
      getCoverageQuestions({ recommendations: [], args: argsOf() }),
    ).toEqual([]);
  });
});

/*
 * The narrowing's whole promise: a monitor that covers a recommendation is
 * among the monitors read. Every recommendation of every resource type of
 * the catalog is built, stored as the database stores a monitor's steps, and
 * searched for its own text - with an identifier that holds the characters
 * JSON writes as escapes too.
 */
describe("every covering monitor is among those read", () => {
  test.each(
    ALL_RESOURCE_TYPES.map(
      (definition: MonitorRecommendationResourceTypeDefinition) => {
        return [definition.resourceType];
      },
    ),
  )(
    "%s: each recommendation's search text is in the stored steps of a monitor made from it",
    (resourceType: string) => {
      const recommendations: Array<MonitorRecommendation> =
        getRepresentativeRecommendations(
          resourceType as MonitorRecommendationResourceTypeDefinition["resourceType"],
        );

      // How many fingerprints narrowed the read, of all asked about.
      let narrowed: number = 0;
      let asked: number = 0;

      for (const identifier of [
        RESOURCE_IDENTIFIER,
        "prod-eu-1",
        'cluster "blue" \\ west',
      ]) {
        const args: MonitorRecommendationArgs = argsOf({
          resourceIdentifier: identifier,
        });

        for (const question of getCoverageQuestions({
          recommendations,
          args,
        })) {
          const recommendation: MonitorRecommendation = recommendations.find(
            (candidate: MonitorRecommendation): boolean => {
              return candidate.recommendationId === question.key;
            },
          )!;
          const stored: string = storedTextOf([
            stepOf(recommendation, args),
          ]).toLowerCase();

          for (const fingerprint of question.fingerprints.slice(0, 1)) {
            const text: string | null = getCoverageSearchText(fingerprint);
            asked++;

            /*
             * A fingerprint that names nothing to narrow by reads every
             * monitor of the type: nothing is left out then either.
             */
            if (text !== null) {
              narrowed++;
              expect({
                recommendation: question.key,
                found: stored.includes(text.toLowerCase()),
              }).toEqual({ recommendation: question.key, found: true });
            }
          }
        }
      }

      // Every recommendation of the type narrows the read by its resource.
      expect(asked).toBeGreaterThan(0);
      expect(narrowed).toBe(asked);
    },
  );

  test("an identifier with quotes and a backslash is searched for as the stored JSON writes it", () => {
    const fingerprint: MonitorRecommendationFingerprint = {
      resourceIdentifier: 'cluster "blue" \\ west',
      configKind: "kubernetesMonitor",
      metricNames: [],
      formulas: [],
      metricAliases: [],
      queryAttributes: [],
      criteriaFilters: [],
      configValues: [],
    };

    expect(
      getCoverageSearchText(
        MonitorRecommendationUtil.serializeFingerprint(fingerprint),
      ),
    ).toBe('cluster \\"blue\\" \\\\ west');
  });

  test("of a resource made of several parts, the longest part; with no resource, the longest metric; with neither, none", () => {
    const base: MonitorRecommendationFingerprint = {
      resourceIdentifier: "",
      configKind: "metricMonitor",
      metricNames: [],
      formulas: [],
      metricAliases: [],
      queryAttributes: [],
      criteriaFilters: [],
      configValues: [],
    };

    expect(
      getCoverageSearchText(
        MonitorRecommendationUtil.serializeFingerprint({
          ...base,
          resourceIdentifier: "abc, abcdef ,ab",
        }),
      ),
    ).toBe("abcdef");
    expect(
      getCoverageSearchText(
        MonitorRecommendationUtil.serializeFingerprint({
          ...base,
          metricNames: ["cpu", "system.cpu.utilization"],
        }),
      ),
    ).toBe("system.cpu.utilization");
    expect(
      getCoverageSearchText(
        MonitorRecommendationUtil.serializeFingerprint(base),
      ),
    ).toBeNull();
    expect(getCoverageSearchText("not a fingerprint")).toBeNull();
  });

  /*
   * A cloud app or a serverless function is told apart by its telemetry
   * filters, not by a resource of its own: the longest of their values,
   * which its steps' JSON holds, narrows the read - before a metric name,
   * which every app's latency monitor shares.
   */
  test("a resource told apart by its attribute filters is searched for by their longest value", () => {
    const base: MonitorRecommendationFingerprint = {
      resourceIdentifier: "",
      configKind: "metricMonitor",
      metricNames: ["http.server.request.duration"],
      formulas: [],
      metricAliases: [],
      queryAttributes: [
        "resource.aws.ecs.task.family=checkout-api,resource.cloud.platform=aws_ecs",
      ],
      criteriaFilters: [],
      configValues: [],
    };

    expect(
      getCoverageSearchText(
        MonitorRecommendationUtil.serializeFingerprint(base),
      ),
    ).toBe("checkout-api");

    // A trace's or a log's filter, as its config values write it.
    expect(
      getCoverageSearchText(
        MonitorRecommendationUtil.serializeFingerprint({
          ...base,
          configKind: "traceMonitor",
          metricNames: [],
          queryAttributes: [],
          configValues: [
            "attributes=resource.faas.name=orders-worker",
            "spanStatuses=2",
          ],
        }),
      ),
    ).toBe("orders-worker");

    // A value that held an object, or nothing, is never searched for.
    expect(
      getCoverageSearchText(
        MonitorRecommendationUtil.serializeFingerprint({
          ...base,
          queryAttributes: ["shape=[object Object],gone=undefined"],
        }),
      ),
    ).toBe("http.server.request.duration");
  });
});

describe("the matcher answers as the browser's comparison did", () => {
  test.each(
    ALL_RESOURCE_TYPES.map(
      (definition: MonitorRecommendationResourceTypeDefinition) => {
        return [definition.resourceType];
      },
    ),
  )(
    "%s: the same monitor for each covered recommendation, over the same monitors in the same order",
    (resourceType: string) => {
      const recommendations: Array<MonitorRecommendation> =
        getRepresentativeRecommendations(
          resourceType as MonitorRecommendationResourceTypeDefinition["resourceType"],
        );
      const args: MonitorRecommendationArgs = argsOf();
      const otherArgs: MonitorRecommendationArgs = argsOf({
        resourceIdentifier: "another-resource",
      });

      /*
       * Every other recommendation made for this resource, each once, two
       * duplicates of the first (the first by order wins), and one made for
       * another resource.
       */
      const monitors: Array<{
        monitorId: ObjectID;
        monitorSteps: Array<MonitorStep>;
      }> = [];

      recommendations.forEach(
        (recommendation: MonitorRecommendation, index: number) => {
          if (index % 2 === 0) {
            monitors.push({
              monitorId: ObjectID.generate(),
              monitorSteps: [stepOf(recommendation, args)],
            });
          }
        },
      );

      if (recommendations[0]) {
        monitors.push({
          monitorId: ObjectID.generate(),
          monitorSteps: [stepOf(recommendations[0], args)],
        });
        monitors.push({
          monitorId: ObjectID.generate(),
          monitorSteps: [stepOf(recommendations[0], otherArgs)],
        });
      }

      const expected: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations,
          existingMonitors: monitors,
          args,
        });

      const questions: Array<MonitorRecommendationCoverageQuestion> =
        getCoverageQuestions({ recommendations, args });
      const answer: Map<string, string> = new Map<string, string>();

      for (const monitorType of new Set<MonitorType>(
        questions.map((question: MonitorRecommendationCoverageQuestion) => {
          return question.monitorType;
        }),
      )) {
        const matcher: MonitorRecommendationCoverageMatcher =
          new MonitorRecommendationCoverageMatcher(
            questions.filter(
              (question: MonitorRecommendationCoverageQuestion): boolean => {
                return question.monitorType === monitorType;
              },
            ),
          );

        for (const monitor of monitors) {
          matcher.addMonitor(
            monitor.monitorId.toString(),
            monitor.monitorSteps,
          );
        }

        for (const [key, monitorId] of matcher.getAnswer()) {
          answer.set(key, monitorId);
        }
      }

      expect(
        Object.fromEntries(
          Array.from(expected.entries()).map(
            ([key, monitorId]: [string, ObjectID]): [string, string] => {
              return [key, monitorId.toString()];
            },
          ),
        ),
      ).toEqual(Object.fromEntries(answer.entries()));
    },
  );

  test("complete once every fingerprint asked about has its monitor - and not before", () => {
    const recommendations: Array<MonitorRecommendation> =
      getRepresentativeRecommendations(ALL_RESOURCE_TYPES[0]!.resourceType);
    const args: MonitorRecommendationArgs = argsOf();
    const [first]: Array<MonitorRecommendationCoverageQuestion> =
      getCoverageQuestions({
        recommendations: recommendations.slice(0, 1),
        args,
      });
    const matcher: MonitorRecommendationCoverageMatcher =
      new MonitorRecommendationCoverageMatcher([
        { ...first!, fingerprints: first!.fingerprints.slice(0, 1) },
      ]);

    expect(matcher.isComplete()).toBe(false);

    matcher.addMonitor(ObjectID.generate().toString(), [
      stepOf(recommendations[0]!, args),
    ]);

    expect(matcher.isComplete()).toBe(true);
  });

  test("the texts it narrows by, each once - or none when one fingerprint names nothing", () => {
    const recommendations: Array<MonitorRecommendation> =
      getRepresentativeRecommendations(ALL_RESOURCE_TYPES[0]!.resourceType);
    const questions: Array<MonitorRecommendationCoverageQuestion> =
      getCoverageQuestions({ recommendations, args: argsOf() });

    expect(
      new MonitorRecommendationCoverageMatcher(questions).getSearchTexts(),
    ).toEqual([RESOURCE_IDENTIFIER]);

    const nameless: string = MonitorRecommendationUtil.serializeFingerprint({
      resourceIdentifier: "",
      configKind: "metricMonitor",
      metricNames: [],
      formulas: [],
      metricAliases: [],
      queryAttributes: [],
      criteriaFilters: [],
      configValues: [],
    });

    expect(
      new MonitorRecommendationCoverageMatcher([
        ...questions,
        {
          key: "x",
          monitorType: MonitorType.Metrics,
          fingerprints: [nameless],
        },
      ]).getSearchTexts(),
    ).toBeNull();
  });
});

describe("a request, read", () => {
  const fingerprint: string = MonitorRecommendationUtil.serializeFingerprint({
    resourceIdentifier: "web-1",
    configKind: "hostMonitor",
    metricNames: ["system.cpu.utilization"],
    formulas: [],
    metricAliases: [],
    queryAttributes: [],
    criteriaFilters: [],
    configValues: [],
  });

  test("its questions, as sent", () => {
    expect(
      readCoverageQuestions({
        questions: [
          {
            key: "Host:high-cpu",
            monitorType: MonitorType.Host,
            fingerprints: [fingerprint],
          },
        ],
      }),
    ).toEqual([
      {
        key: "Host:high-cpu",
        monitorType: MonitorType.Host,
        fingerprints: [fingerprint],
      },
    ]);
    expect(readCoverageQuestions({ questions: [] })).toEqual([]);
  });

  test.each([
    ["no body", undefined],
    ["no list", { questions: "all" }],
    [
      "too many questions",
      {
        questions: Array.from(
          { length: MAX_COVERAGE_QUESTIONS + 1 },
          (_: unknown, index: number) => {
            return {
              key: `k${index}`,
              monitorType: MonitorType.Host,
              fingerprints: [fingerprint],
            };
          },
        ),
      },
    ],
    [
      "a question with no key",
      {
        questions: [
          { monitorType: MonitorType.Host, fingerprints: [fingerprint] },
        ],
      },
    ],
    [
      "a key too long",
      {
        questions: [
          {
            key: "k".repeat(MAX_COVERAGE_KEY_LENGTH + 1),
            monitorType: MonitorType.Host,
            fingerprints: [fingerprint],
          },
        ],
      },
    ],
    [
      "a type that is no monitor's",
      {
        questions: [
          { key: "k", monitorType: "Teleport", fingerprints: [fingerprint] },
        ],
      },
    ],
    [
      "no fingerprint",
      {
        questions: [
          { key: "k", monitorType: MonitorType.Host, fingerprints: [] },
        ],
      },
    ],
    [
      "too many fingerprints",
      {
        questions: [
          {
            key: "k",
            monitorType: MonitorType.Host,
            fingerprints: Array.from(
              { length: MAX_COVERAGE_FINGERPRINTS_PER_QUESTION + 1 },
              () => {
                return fingerprint;
              },
            ),
          },
        ],
      },
    ],
    [
      "a fingerprint that is not one",
      {
        questions: [
          {
            key: "k",
            monitorType: MonitorType.Host,
            fingerprints: ['["web-1"]'],
          },
        ],
      },
    ],
  ])("%s is refused, saying what is wrong", (_name: string, body: unknown) => {
    expect(() => {
      return readCoverageQuestions(body);
    }).toThrow(BadDataException);
  });

  test("a fingerprint reads back as written", () => {
    expect(parseSerializedFingerprint(fingerprint)).toEqual({
      resourceIdentifier: "web-1",
      configKind: "hostMonitor",
      metricNames: ["system.cpu.utilization"],
      formulas: [],
      metricAliases: [],
      queryAttributes: [],
      criteriaFilters: [],
      configValues: [],
    });
    expect(parseSerializedFingerprint("[1,2,3]")).toBeNull();
    expect(parseSerializedFingerprint("{")).toBeNull();
  });
});
