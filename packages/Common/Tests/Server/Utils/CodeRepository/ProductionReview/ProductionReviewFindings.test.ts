import ProductionReviewFindings, {
  ExceptionFrameMatch,
  ProductionReviewFindingsResult,
  isFileAndOffsetOnly,
  lastNameSegment,
  maskOperationName,
  matchExceptionFrames,
  operationServesRoute,
  readFrameLine,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewFindings";
import {
  ChangedCode,
  readChangedCode,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewDiff";
import { RepositoryProductionProfile } from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewRepositoryProfile";
import { CodeAgentScopedService } from "../../../../../Server/Utils/AI/CodeFix/CodeAgentTelemetryScope";
import ExceptionInstanceService from "../../../../../Server/Services/ExceptionInstanceService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../../Server/Services/IncidentStateService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import {
  ProductionReviewOperationJSON,
  ProductionReviewOperationMatch,
  ProductionReviewSection,
  ProductionReviewWhere,
} from "../../../../../Types/CodeRepository/ProductionReview";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * What production says about the code a pull request changes - matched from
 * the change's files, base lines and functions to what production reports of
 * the same code. The pure matchers first (stack frames, routes, names, code
 * attributes, profiles), then the reads, whose services are stubbed: what
 * they ask the database for (the project, the repository's services only,
 * never a private incident) and what they keep (aggregates and the names of
 * code, never a message or an incident's text).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1a2b3c4d-1111-4222-8333-444455556666",
);
const CHECKOUT: string = "1a2b3c4d-aaaa-4222-8333-444455556666";

// The project's incident states: one counts as resolved, one does not.
const RESOLVED_STATE_ID: string = "5e6f7a8b-0000-4000-8000-0000000000aa";
const INVESTIGATING_STATE_ID: string = "5e6f7a8b-0000-4000-8000-0000000000bb";
const WORKER: string = "1a2b3c4d-bbbb-4222-8333-444455556666";
const NOW: Date = new Date("2026-10-22T10:00:00.000Z");

const CHARGE_PATCH: string = [
  "@@ -40,5 +40,8 @@ export function chargeCard(card) {",
  "   const amount = card.amount;",
  "-  const id = card.id;",
  "+  if (!card) {",
  "+    throw new Error('no card');",
  "+  }",
  "+  const id = card.id;",
  "   return pay(id, amount);",
  "@@ -90,2 +93,3 @@ export function refundCard(order) {",
  "   const total = order.total;",
  "+  audit(order);",
].join("\n");

const ROUTES_PATCH: string = [
  "@@ -1,2 +1,2 @@",
  '-router.get("/api/orders/:id", show);',
  '+router.get("/api/orders/:id", showOrder);',
].join("\n");

function changed(): ChangedCode {
  return readChangedCode({
    files: [
      {
        filename: "services/checkout/src/billing/charge.ts",
        status: "modified",
        patch: CHARGE_PATCH,
      },
      {
        filename: "services/checkout/src/routes/orders.ts",
        status: "modified",
        patch: ROUTES_PATCH,
      },
    ],
  });
}

function services(): Array<CodeAgentScopedService> {
  return [
    {
      id: CHECKOUT,
      name: "checkout-api",
      method: "stack-trace",
      evidence: "",
      pathInRepository: "services/checkout",
    },
    {
      id: WORKER,
      name: "billing-worker",
      method: "name-match",
      evidence: "",
      pathInRepository: null,
    },
  ];
}

function servicesById(): Map<string, CodeAgentScopedService> {
  return new Map<string, CodeAgentScopedService>(
    services().map(
      (service: CodeAgentScopedService): [string, CodeAgentScopedService] => {
        return [service.id, service];
      },
    ),
  );
}

function profile(
  change: Partial<RepositoryProductionProfile> = {},
): RepositoryProductionProfile {
  return {
    readAt: NOW.toISOString(),
    traffic: [{ serviceId: CHECKOUT, count: 12431, p99Ms: 840 }],
    operations: [
      {
        serviceId: CHECKOUT,
        name: "GET /api/orders/:id",
        count: 3200,
        errorCount: 13,
        p95Ms: 840,
      },
      {
        serviceId: CHECKOUT,
        name: "POST /charge",
        count: 900,
        errorCount: 2,
        p95Ms: 300,
      },
      {
        serviceId: CHECKOUT,
        name: "BillingService.refundCard",
        count: 120,
        errorCount: 0,
        p95Ms: 40,
      },
      {
        serviceId: CHECKOUT,
        name: "GET /api/orders/:id/items",
        count: 5000,
        errorCount: 0,
        p95Ms: 20,
      },
    ],
    codeLocations: [
      {
        serviceId: CHECKOUT,
        name: "POST /charge",
        filePath: "/app/src/billing/charge.ts",
        functionName: "chargeCard",
        count: 40,
      },
    ],
    functions: [
      {
        serviceId: CHECKOUT,
        functionName: "Billing.chargeCard",
        fileName: "/app/src/billing/charge.ts",
        totalPercent: 12.34,
        selfPercent: 4.06,
        kind: "CPU time",
      },
      {
        serviceId: CHECKOUT,
        functionName: "tinyHelper",
        fileName: "/app/src/billing/charge.ts",
        totalPercent: 0.4,
        selfPercent: 0.4,
        kind: "CPU time",
      },
      {
        serviceId: CHECKOUT,
        functionName: "elsewhere",
        fileName: "/app/src/other.ts",
        totalPercent: 30,
        selfPercent: 30,
        kind: "CPU time",
      },
    ],
    suspectDeploys: [
      {
        serviceId: CHECKOUT,
        at: "2026-10-22T08:00:00.000Z",
        version: "v1.4.2",
        impact: "error rate rose from 0.2% to 2.1%",
      },
      {
        serviceId: "1a2b3c4d-cccc-4222-8333-444455556666",
        at: "2026-10-22T08:00:00.000Z",
        impact: "not this repository's",
      },
    ],
    unread: [],
    ...change,
  };
}

describe("matchExceptionFrames", () => {
  test("a V8 frame at a base line the change touches is thrown right where it is", () => {
    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace: [
        "TypeError: Cannot read properties of undefined (reading 'id')",
        "    at chargeCard (/app/src/billing/charge.ts:41:20)",
        "    at handler (/app/src/server.ts:10:3)",
      ].join("\n"),
      changed: changed(),
    });

    expect(match?.path).toBe("services/checkout/src/billing/charge.ts");
    expect(match?.line).toBe(41);
    expect(match?.where).toBe(ProductionReviewWhere.ChangedLine);
    expect(match?.functionName).toBe("chargeCard");
  });

  test("a frame in a function the change touches, away from its lines", () => {
    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace:
        "Error: x\n    at refundCard (/app/src/billing/charge.ts:120:5)",
      changed: changed(),
    });

    expect(match?.where).toBe(ProductionReviewWhere.ChangedFunction);
    expect(match?.functionName).toBe("refundCard");
  });

  test("a frame anywhere else in a changed file", () => {
    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace: "Error: x\n    at other (/app/src/billing/charge.ts:7:5)",
      changed: changed(),
    });

    expect(match?.where).toBe(ProductionReviewWhere.ChangedFile);
    expect(match?.functionName).toBeUndefined();
  });

  test("the closest frame wins, even below another of a changed file", () => {
    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace: [
        "Error: x",
        "    at other (/app/src/billing/charge.ts:7:5)",
        "    at chargeCard (/app/src/billing/charge.ts:41:5)",
      ].join("\n"),
      changed: changed(),
    });

    expect(match?.where).toBe(ProductionReviewWhere.ChangedLine);
  });

  test("Python frames: the quoted file, its line and its function", () => {
    const pythonChanged: ChangedCode = readChangedCode({
      files: [
        {
          filename: "app/billing.py",
          status: "modified",
          patch:
            "@@ -10,1 +10,2 @@ def charge_card(card):\n-    x = card.id\n+    x = card and card.id",
        },
      ],
    });

    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace: [
        "Traceback (most recent call last):",
        '  File "/usr/src/app/app/billing.py", line 10, in charge_card',
        "    x = card.id",
        "AttributeError: 'NoneType' object has no attribute 'id'",
      ].join("\n"),
      changed: pythonChanged,
    });

    expect(match?.line).toBe(10);
    expect(match?.where).toBe(ProductionReviewWhere.ChangedLine);
    expect(match?.functionName).toBe("charge_card");
  });

  test("Go frames: the function on the line before the file's", () => {
    const goChanged: ChangedCode = readChangedCode({
      files: [
        {
          filename: "pkg/server/server.go",
          status: "modified",
          patch:
            "@@ -1,1 +1,1 @@\n-func (s *Server) Charge(ctx context.Context) error {\n+func (s *Server) Charge(ctx context.Context, id string) error {",
        },
      ],
    });

    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace: [
        "goroutine 1 [running]:",
        "main.(*Server).Charge(0xc000010000)",
        "\t/app/pkg/server/server.go:80 +0x1b",
      ].join("\n"),
      changed: goChanged,
    });

    expect(match?.where).toBe(ProductionReviewWhere.ChangedFunction);
    expect(match?.functionName).toBe("Charge");
  });

  /*
   * Go writes a frame's function on one line and its file on the next,
   * as ":80 +0x1b" after the path; every other runtime names the function
   * on the file's own line, where the line before is another frame's.
   */
  test.each([
    [":80 +0x1b", true],
    [":80", true],
    ["", true],
    ["   ", true],
    [" +0x1b", true],
    [":80 +0x1b extra", true],
    [":12:5)", false],
    [", line 10, in charge_card", false],
    [":20)", false],
    [":80 in Charge", false],
    ["Charge", false],
  ])(
    "%p is a file's line and offset only: %p",
    (rest: string, expected: boolean) => {
      expect(isFileAndOffsetOnly(rest)).toBe(expected);
    },
  );

  test("Go frames: a file line at the top of the trace is still read, at its line", () => {
    const goChanged: ChangedCode = readChangedCode({
      files: [
        {
          filename: "pkg/server/server.go",
          status: "modified",
          patch:
            "@@ -80,1 +80,1 @@\n-\treturn s.charge(ctx)\n+\treturn s.chargeOnce(ctx)",
        },
      ],
    });

    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace: "\t/app/pkg/server/server.go:80 +0x1b",
      changed: goChanged,
    });

    expect(match?.line).toBe(80);
    expect(match?.where).toBe(ProductionReviewWhere.ChangedLine);
  });

  test("Java frames: the file name alone matches the one changed file of that name", () => {
    const javaChanged: ChangedCode = readChangedCode({
      files: [
        {
          filename: "src/main/java/com/acme/Billing.java",
          status: "modified",
          patch:
            "@@ -20,1 +20,1 @@\n-  public Receipt charge(Card card) {\n+  public Receipt charge(Card card, Money m) {",
        },
      ],
    });

    const match: ExceptionFrameMatch | null = matchExceptionFrames({
      stackTrace:
        "java.lang.NullPointerException\n\tat com.acme.Billing.charge(Billing.java:20)\n\tat com.acme.Api.post(Api.java:9)",
      changed: javaChanged,
    });

    expect(match?.where).toBe(ProductionReviewWhere.ChangedLine);
    expect(match?.functionName).toBe("charge");
  });

  test("a trace through no changed file, or a dependency's copy of one, matches nothing", () => {
    expect(
      matchExceptionFrames({
        stackTrace: "Error\n    at x (/app/src/server.ts:1:1)",
        changed: changed(),
      }),
    ).toBeNull();

    expect(
      matchExceptionFrames({
        stackTrace:
          "Error\n    at x (/app/node_modules/lib/src/billing/charge.ts:41:1)",
        changed: changed(),
      }),
    ).toBeNull();
  });

  test("reads a few hundred lines of a huge trace, in time in line with it", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const huge: string = `${"    at x (/app/src/a.ts:1:1)\n".repeat(100000)}${"(".repeat(400000)}`;

        expect(
          matchExceptionFrames({ stackTrace: huge, changed: changed() }),
        ).toBeNull();
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("readFrameLine", () => {
  test("path:line and Python's line", () => {
    expect(readFrameLine("at f (/app/a.ts:42:7)", "/app/a.ts")).toBe(42);
    expect(readFrameLine('File "/app/a.py", line 7, in f', "/app/a.py")).toBe(
      7,
    );
    expect(readFrameLine("at f (/app/a.ts)", "/app/a.ts")).toBeUndefined();
    expect(readFrameLine("at f (/app/a.ts:0)", "/app/a.ts")).toBeUndefined();
    expect(readFrameLine("nothing here", "/app/a.ts")).toBeUndefined();
  });
});

describe("operationServesRoute", () => {
  test("the route as a whole path in the operation's name", () => {
    expect(operationServesRoute("GET /api/orders/:id", "/api/orders/:id")).toBe(
      true,
    );
    expect(operationServesRoute("/api/orders/:id", "/api/orders/:id")).toBe(
      true,
    );
    expect(
      operationServesRoute("GET /api/orders/:id?x=1", "/api/orders/:id"),
    ).toBe(true);
    expect(
      operationServesRoute("GET /api/orders/:id/items", "/api/orders/:id"),
    ).toBe(false);
    expect(
      operationServesRoute("GET /v2/api/orders/:id", "/api/orders/:id"),
    ).toBe(false);
    expect(operationServesRoute("POST /charge", "/api/orders/:id")).toBe(false);
  });
});

describe("lastNameSegment and maskOperationName", () => {
  test("the function a qualified name ends in", () => {
    expect(lastNameSegment("Billing.chargeCard")).toBe("chargeCard");
    expect(lastNameSegment("com.acme.Billing::charge()")).toBe("charge");
    expect(lastNameSegment("chargeCard")).toBe("chargeCard");
    expect(lastNameSegment("GET /x")).toBe("x");
    expect(lastNameSegment("")).toBe("");
  });

  test("an operation's name keeps its shape, without ids, addresses or emails", () => {
    expect(
      maskOperationName(
        "SELECT * FROM users WHERE email = 'bob@example.com' AND id = 550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBe("SELECT * FROM users WHERE email = '<EMAIL>' AND id = <UUID>");
    expect(
      maskOperationName(`GET /x\n${"y".repeat(500)}`).length,
    ).toBeLessThanOrEqual(120);
  });
});

describe("ProductionReviewFindings.matchOperations", () => {
  const operations: Array<ProductionReviewOperationJSON> =
    ProductionReviewFindings.matchOperations({
      changed: changed(),
      profile: profile(),
      servicesById: servicesById(),
    });

  test("finds the operations that run the change, busiest first, each once", () => {
    expect(
      operations.map((operation: ProductionReviewOperationJSON) => {
        return [operation.name, operation.matchedBy];
      }),
    ).toEqual([
      ["GET /api/orders/:id", ProductionReviewOperationMatch.Route],
      ["POST /charge", ProductionReviewOperationMatch.CodeAttribute],
      [
        "BillingService.refundCard",
        ProductionReviewOperationMatch.FunctionName,
      ],
    ]);
  });

  test("a code attribute names the changed file and function, with the operation's numbers", () => {
    const charge: ProductionReviewOperationJSON | undefined = operations.find(
      (operation: ProductionReviewOperationJSON) => {
        return operation.name === "POST /charge";
      },
    );

    expect(charge).toEqual({
      name: "POST /charge",
      serviceId: CHECKOUT,
      serviceName: "checkout-api",
      matchedBy: ProductionReviewOperationMatch.CodeAttribute,
      path: "services/checkout/src/billing/charge.ts",
      functionName: "chargeCard",
      requestCount: 900,
      errorCount: 2,
      p95Ms: 300,
    });
  });

  test("a route the change edits is not a longer one that starts with it", () => {
    expect(
      operations.some((operation: ProductionReviewOperationJSON) => {
        return operation.name === "GET /api/orders/:id/items";
      }),
    ).toBe(false);
  });

  test("an operation of a service outside the repository's is never shown", () => {
    expect(
      ProductionReviewFindings.matchOperations({
        changed: changed(),
        profile: profile({
          operations: [
            {
              serviceId: "1a2b3c4d-dddd-4222-8333-444455556666",
              name: "GET /api/orders/:id",
              count: 1,
              errorCount: 0,
              p95Ms: 1,
            },
          ],
          codeLocations: [],
        }),
        servicesById: servicesById(),
      }),
    ).toEqual([]);
  });

  test("a function name too short to mean one function matches no operation by name", () => {
    const short: ChangedCode = readChangedCode({
      files: [
        {
          filename: "src/a.ts",
          status: "modified",
          patch: "@@ -1,1 +1,1 @@\n-function run() {\n+function run(x) {",
        },
      ],
    });

    expect(
      ProductionReviewFindings.matchOperations({
        changed: short,
        profile: profile({
          operations: [
            {
              serviceId: CHECKOUT,
              name: "run",
              count: 9,
              errorCount: 0,
              p95Ms: 1,
            },
          ],
          codeLocations: [],
        }),
        servicesById: servicesById(),
      }),
    ).toEqual([]);
  });
});

describe("ProductionReviewFindings.matchHotFunctions", () => {
  test("the changed file's functions that take at least the minimum share, rounded, the changed one marked", () => {
    expect(
      ProductionReviewFindings.matchHotFunctions({
        changed: changed(),
        profile: profile(),
        servicesById: servicesById(),
      }),
    ).toEqual([
      {
        functionName: "Billing.chargeCard",
        path: "services/checkout/src/billing/charge.ts",
        serviceId: CHECKOUT,
        serviceName: "checkout-api",
        totalPercent: 12.3,
        selfPercent: 4.1,
        isChangedFunction: true,
        profileKind: "CPU time",
      },
    ]);
  });
});

describe("ProductionReviewFindings.pickDeploys", () => {
  test("only the services the change runs in", () => {
    expect(
      ProductionReviewFindings.pickDeploys({
        deploys: profile().suspectDeploys,
        serviceIds: [CHECKOUT],
        servicesById: servicesById(),
      }),
    ).toEqual([
      {
        serviceId: CHECKOUT,
        serviceName: "checkout-api",
        at: "2026-10-22T08:00:00.000Z",
        version: "v1.4.2",
        impact: "error rate rose from 0.2% to 2.1%",
      },
    ]);
  });
});

describe("ProductionReviewFindings.findMention", () => {
  test("a changed file by its path, or by a name long enough to mean it", () => {
    expect(
      ProductionReviewFindings.findMention({
        texts: [
          null,
          "Root cause: a null card in services/checkout/src/billing/charge.ts",
        ],
        changed: changed(),
      }),
    ).toBe("services/checkout/src/billing/charge.ts");

    expect(
      ProductionReviewFindings.findMention({
        texts: ["The bug was in CHARGE.TS, line 41"],
        changed: changed(),
      }),
    ).toBe("services/checkout/src/billing/charge.ts");
  });

  test("a changed function, as a whole word", () => {
    expect(
      ProductionReviewFindings.findMention({
        texts: ["refundCard double-refunded orders"],
        changed: changed(),
      }),
    ).toBe("refundCard()");

    expect(
      ProductionReviewFindings.findMention({
        texts: ["refundCards were late"],
        changed: changed(),
      }),
    ).toBeNull();
  });

  test("nothing, when nothing names the change", () => {
    expect(
      ProductionReviewFindings.findMention({
        texts: ["A DNS outage", "", undefined],
        changed: changed(),
      }),
    ).toBeNull();
  });
});

describe("ProductionReviewFindings reads", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function exceptionGroup(
    change: Partial<TelemetryException> = {},
  ): TelemetryException {
    const group: TelemetryException = new TelemetryException();
    group._id = "2b3c4d5e-0000-4000-8000-000000000001";
    group.primaryEntityId = new ObjectID(CHECKOUT);
    group.exceptionType = "TypeError";
    group.message =
      "Cannot read properties of undefined (reading 'id') for bob@example.com";
    group.stackTrace =
      "TypeError: Cannot read properties of undefined (reading 'id') for bob@example.com\n    at chargeCard (/app/src/billing/charge.ts:41:20)";
    group.fingerprint = "fp-1";
    group.occuranceCount = 52000;
    group.firstSeenAt = new Date("2026-10-20T10:00:00.000Z");
    group.lastSeenAt = new Date("2026-10-22T08:00:00.000Z");
    group.unhandled = true;
    Object.assign(group, change);
    return group;
  }

  test("exceptions: searched by each changed file's name in the repository's services, the closest and busiest kept, with the week's count", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        exceptionGroup(),
        exceptionGroup({
          _id: "2b3c4d5e-0000-4000-8000-000000000002",
          exceptionType: "RangeError",
          stackTrace: "RangeError\n    at x (/app/src/server.ts:1:1)",
        }),
        exceptionGroup({
          _id: "2b3c4d5e-0000-4000-8000-000000000003",
          isArchived: true,
        }),
      ] as never);

    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValue(new PositiveNumber(1240));

    const exceptions: Awaited<
      ReturnType<typeof ProductionReviewFindings.readExceptions>
    > = await ProductionReviewFindings.readExceptions({
      projectId: PROJECT_ID,
      changed: changed(),
      servicesById: servicesById(),
      now: NOW,
    });

    expect(exceptions).toEqual([
      {
        exceptionId: "2b3c4d5e-0000-4000-8000-000000000001",
        type: "TypeError",
        serviceId: CHECKOUT,
        serviceName: "checkout-api",
        path: "services/checkout/src/billing/charge.ts",
        line: 41,
        functionName: "chargeCard",
        where: ProductionReviewWhere.ChangedLine,
        occurrences: 1240,
        isWindowCount: true,
        isUnhandled: true,
        isNew: true,
        firstSeenAt: "2026-10-20T10:00:00.000Z",
        lastSeenAt: "2026-10-22T08:00:00.000Z",
      },
    ]);

    // One read per changed file's name, held to the project's last week.
    expect(findBy).toHaveBeenCalledTimes(2);

    const query: JSONObject = (
      findBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(JSON.stringify(exceptions)).not.toContain("bob@example.com");
    expect(JSON.stringify(exceptions)).not.toContain("Cannot read");
  });

  /*
   * The occurrences of the exceptions merged into a group count on it
   * (TelemetryExceptionMerge): the week's count takes them in, by its own
   * fingerprint and theirs (TelemetryExceptionService.getGroupFingerprints).
   */
  test("exceptions: the week's count takes in the exceptions merged into the group", async () => {
    TelemetryExceptionService.clearGroupFingerprints();
    const memberReads: Array<Array<unknown>> = [];

    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([exceptionGroup()] as never);
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string, params: Array<unknown>) => {
          memberReads.push(params);
          return sql.includes("ROW_NUMBER()")
            ? [
                {
                  survivorId: "2b3c4d5e-0000-4000-8000-000000000001",
                  fingerprint: "fp-merged",
                },
              ]
            : [];
        },
      },
    } as never);
    // 7 of its own this week, 1240 with the merged one's.
    const countBy: jest.SpyInstance = jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        return new PositiveNumber(
          data.query["fingerprint"] instanceof Includes ? 1240 : 7,
        );
      }) as never);

    const exceptions: Awaited<
      ReturnType<typeof ProductionReviewFindings.readExceptions>
    > = await ProductionReviewFindings.readExceptions({
      projectId: PROJECT_ID,
      changed: changed(),
      servicesById: servicesById(),
      now: NOW,
    });

    expect(exceptions![0]!.occurrences).toBe(1240);
    expect(exceptions![0]!.isWindowCount).toBe(true);

    expect(memberReads).toEqual([
      [
        PROJECT_ID.toString(),
        ["2b3c4d5e-0000-4000-8000-000000000001"],
        100,
        10000,
      ],
    ]);
    const query: JSONObject = (
      countBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;
    expect((query["fingerprint"] as unknown as Includes).values).toEqual([
      "fp-1",
      "fp-merged",
    ]);
    // Still the group's service, in the project, as the system.
    expect(String(query["primaryEntityId"])).toBe(CHECKOUT);
    expect((countBy.mock.calls[0]![0] as { props: JSONObject }).props).toEqual({
      isRoot: true,
      tenantId: PROJECT_ID,
    });
    TelemetryExceptionService.clearGroupFingerprints();
  });

  test("exceptions: nothing merged into the group, its count asks for its own fingerprint alone", async () => {
    TelemetryExceptionService.clearGroupFingerprints();
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([exceptionGroup()] as never);
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async () => {
          return [];
        },
      },
    } as never);
    const countBy: jest.SpyInstance = jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValue(new PositiveNumber(1240));

    await ProductionReviewFindings.readExceptions({
      projectId: PROJECT_ID,
      changed: changed(),
      servicesById: servicesById(),
      now: NOW,
    });

    expect(
      (countBy.mock.calls[0]![0] as { query: JSONObject }).query["fingerprint"],
    ).toBe("fp-1");
    TelemetryExceptionService.clearGroupFingerprints();
  });

  test("exceptions: a count that cannot be read shows the group's total, saying so", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([exceptionGroup()] as never);
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockRejectedValue(new Error("ClickHouse is down"));

    const exceptions: Awaited<
      ReturnType<typeof ProductionReviewFindings.readExceptions>
    > = await ProductionReviewFindings.readExceptions({
      projectId: PROJECT_ID,
      changed: changed(),
      servicesById: servicesById(),
      now: NOW,
    });

    expect(exceptions![0]!.occurrences).toBe(52000);
    expect(exceptions![0]!.isWindowCount).toBe(false);
  });

  test("exceptions: a read that fails is no list at all, not an empty one", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockRejectedValue(new Error("Postgres is down"));

    expect(
      await ProductionReviewFindings.readExceptions({
        projectId: PROJECT_ID,
        changed: changed(),
        servicesById: servicesById(),
        now: NOW,
      }),
    ).toBeNull();
  });

  function incident(change: {
    id: string;
    number: number;
    isResolved: boolean;
    rootCause?: string;
  }): Incident {
    const record: Incident = new Incident();
    record._id = change.id;
    record.incidentNumber = change.number;
    record.incidentNumberWithPrefix = `INC-${change.number}`;
    record.createdAt = new Date("2026-10-20T10:00:00.000Z");
    record.title = "Checkout down for Acme Corp";

    if (change.rootCause) {
      record.rootCause = change.rootCause;
    }

    const state: IncidentState = new IncidentState();
    state.name = change.isResolved ? "Resolved" : "Investigating";
    record.currentIncidentState = state;
    record.currentIncidentStateId = new ObjectID(
      change.isResolved ? RESOLVED_STATE_ID : INVESTIGATING_STATE_ID,
    );

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Critical";
    record.incidentSeverity = severity;

    return record;
  }

  test("incidents: on the services the change runs in, never private, open ones and those that name the change kept - never their text", async () => {
    // Resolved by the project's states, as every part of OneUptime reads it.
    jest
      .spyOn(IncidentStateService, "getResolvedIncidentStateIds")
      .mockResolvedValue([new ObjectID(RESOLVED_STATE_ID)]);
    const findBy: jest.SpyInstance = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([
        incident({
          id: "3c4d5e6f-0000-4000-8000-000000000001",
          number: 45,
          isResolved: false,
        }),
        incident({
          id: "3c4d5e6f-0000-4000-8000-000000000002",
          number: 31,
          isResolved: true,
          rootCause: "A null card reached refundCard.",
        }),
        incident({
          id: "3c4d5e6f-0000-4000-8000-000000000003",
          number: 12,
          isResolved: true,
          rootCause: "DNS",
        }),
      ] as never);

    const incidents: Awaited<
      ReturnType<typeof ProductionReviewFindings.readIncidents>
    > = await ProductionReviewFindings.readIncidents({
      projectId: PROJECT_ID,
      serviceIds: [CHECKOUT],
      changed: changed(),
      now: NOW,
    });

    expect(incidents).toEqual({
      total: 3,
      open: 1,
      items: [
        {
          incidentId: "3c4d5e6f-0000-4000-8000-000000000001",
          label: "INC-45",
          severity: "Critical",
          state: "Investigating",
          isOpen: true,
          declaredAt: "2026-10-20T10:00:00.000Z",
        },
        {
          incidentId: "3c4d5e6f-0000-4000-8000-000000000002",
          label: "INC-31",
          severity: "Critical",
          state: "Resolved",
          isOpen: false,
          declaredAt: "2026-10-20T10:00:00.000Z",
          mentions: "refundCard()",
        },
      ],
    });

    const query: JSONObject = (
      findBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    // The clause that leaves private incidents out, whoever reads.
    expect(query["isPrivate"]).toBeDefined();
    expect(JSON.stringify(incidents)).not.toContain("Acme Corp");
    expect(JSON.stringify(incidents)).not.toContain("null card");
  });

  /*
   * Whether an incident is open is the project's one rule (Common/Utils/
   * ResolvedState): a state of the project's own placed after Resolved -
   * "Closed" - counts as resolved, though it carries no resolved flag.
   */
  test("incidents: a state placed after Resolved counts as resolved, and the project's states that cannot be read leave incidents unread", async () => {
    const closed: Incident = incident({
      id: "3c4d5e6f-0000-4000-8000-000000000004",
      number: 50,
      isResolved: false,
    });
    closed.currentIncidentState!.name = "Closed";
    closed.currentIncidentStateId = new ObjectID(
      "5e6f7a8b-0000-4000-8000-0000000000cc",
    );

    jest
      .spyOn(IncidentStateService, "getResolvedIncidentStateIds")
      .mockResolvedValue([
        new ObjectID(RESOLVED_STATE_ID),
        new ObjectID("5e6f7a8b-0000-4000-8000-0000000000cc"),
      ]);
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([closed] as never);

    expect(
      await ProductionReviewFindings.readIncidents({
        projectId: PROJECT_ID,
        serviceIds: [CHECKOUT],
        changed: changed(),
        now: NOW,
      }),
    ).toEqual({ total: 1, open: 0, items: [] });

    jest.restoreAllMocks();
    jest
      .spyOn(IncidentStateService, "getResolvedIncidentStateIds")
      .mockRejectedValue(new Error("Postgres is down"));
    const findBy: jest.SpyInstance = jest.spyOn(IncidentService, "findBy");

    expect(
      await ProductionReviewFindings.readIncidents({
        projectId: PROJECT_ID,
        serviceIds: [CHECKOUT],
        changed: changed(),
        now: NOW,
      }),
    ).toBeNull();
    expect(findBy).not.toHaveBeenCalled();
  });

  test("find: everything together, the services from the files and the findings, the unread parts said", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([exceptionGroup()] as never);
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValue(new PositiveNumber(1240));
    jest.spyOn(IncidentService, "findBy").mockRejectedValue(new Error("down"));

    const result: ProductionReviewFindingsResult =
      await ProductionReviewFindings.find({
        projectId: PROJECT_ID,
        changed: changed(),
        services: services(),
        touched: [services()[0]!],
        profile: profile({ unread: [ProductionReviewSection.Profiles] }),
        now: NOW,
      });

    expect(result.services).toEqual([
      { id: CHECKOUT, name: "checkout-api", requestCount: 12431, p99Ms: 840 },
    ]);
    expect(result.exceptions).toHaveLength(1);
    expect(result.operations).toHaveLength(3);
    expect(result.hotFunctions).toHaveLength(1);
    expect(result.suspectDeploys).toHaveLength(1);
    expect(result.incidents).toEqual({ total: 0, open: 0, items: [] });
    expect(result.unreadSections).toEqual([
      ProductionReviewSection.Profiles,
      ProductionReviewSection.Incidents,
    ]);
  });

  test("find: a repository no service serves reads nothing", async () => {
    const exceptions: jest.SpyInstance = jest.spyOn(
      TelemetryExceptionService,
      "findBy",
    );
    const incidents: jest.SpyInstance = jest.spyOn(IncidentService, "findBy");

    const result: ProductionReviewFindingsResult =
      await ProductionReviewFindings.find({
        projectId: PROJECT_ID,
        changed: changed(),
        services: [],
        touched: [],
        profile: profile({
          operations: [],
          codeLocations: [],
          functions: [],
          suspectDeploys: [],
          traffic: [],
        }),
        now: NOW,
      });

    expect(exceptions).not.toHaveBeenCalled();
    expect(incidents).not.toHaveBeenCalled();
    expect(result.services).toEqual([]);
    expect(result.exceptions).toEqual([]);
  });
});
