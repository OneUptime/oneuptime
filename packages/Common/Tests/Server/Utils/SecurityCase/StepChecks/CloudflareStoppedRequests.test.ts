import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  CloudflareStoppedReading,
  buildCloudflareStoppedStatement,
  getCloudflareStoppedFact,
  getCloudflareVendorName,
  readCloudflareStoppedFacts,
  readCloudflareStoppedRow,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/CloudflareStoppedRequests";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { CLOUDFLARE_BLOCK_RULE_REFS } from "../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import { SecurityBlockAction } from "../../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityCaseStepCheckSentence } from "../../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import {
  CHECK_BLOCK_CLOUDFLARE_CHALLENGED,
  CHECK_BLOCK_CLOUDFLARE_CHALLENGED_ABOUT,
  CHECK_BLOCK_CLOUDFLARE_STOPPED,
  CHECK_BLOCK_CLOUDFLARE_STOPPED_ABOUT,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT CLOUDFLARE STOPPED OF AN ADDRESS SINCE ITS BLOCK (#10343): the fact
 * a Cloudflare destination adds to a block it holds, for the case's block
 * step, counted from the firewall events the connection imports.
 *
 * Pinned: the count reads only the address's events from Cloudflare since
 * the block, that OneUptime's rule for the action stopped at the edge (or
 * the access rule the block was written as), each the requests of its
 * sample interval; a sampled count says about; a challenge says
 * challenged; a count of none adds nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADDRESS: string = "35.205.11.131";
const APPLIED_AT: Date = new Date("2026-11-21T10:42:00.000Z");
const NOW: Date = new Date("2026-11-21T11:42:00.000Z");

function statementFor(
  values: Partial<Parameters<typeof buildCloudflareStoppedStatement>[0]> = {},
): Statement {
  return buildCloudflareStoppedStatement({
    projectId: PROJECT_ID,
    address: ADDRESS,
    action: SecurityBlockAction.Block,
    accessRuleId: null,
    since: APPLIED_AT,
    until: NOW,
    ...values,
  });
}

function paramsOf(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function queryResult(rows: Array<JSONObject>): never {
  return {
    json: async (): Promise<JSONObject> => {
      return { data: rows } as unknown as JSONObject;
    },
  } as never;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the count's query", () => {
  test("reads the address's events from Cloudflare since the block, stopped at the edge, each the requests of its sample interval", () => {
    const statement: Statement = statementFor();
    const params: Array<unknown> = paramsOf(statement);
    const asText: string = JSON.stringify(statement.query_params);

    expect(statement.query).toContain(
      "sum(greatest(toUInt64(1), toUInt64OrZero(attributes[",
    );
    expect(statement.query).toContain("AS maxSampleInterval");
    expect(statement.query).toContain("principalIp IN ");
    expect(statement.query).toContain("vendorName = ");
    // The address and the same address as a dual-stack server maps it (#10744).
    expect(params).toContainEqual([ADDRESS, `::ffff:${ADDRESS}`]);
    expect(params).toContain(getCloudflareVendorName());
    expect(asText).toContain("oneuptime.edge.sample_interval");
    expect(asText).toContain("oneuptime.edge.action");
    expect(asText).toContain("blocked");
    expect(asText).toContain("challenged");
    // The window: since the block was applied, up to now.
    expect(asText).toContain("2026-11-21");
  });

  test("names OneUptime's rule for the action by its ref: the block rule for a block, the challenge rule for a challenge", () => {
    expect(paramsOf(statementFor())).toContain(
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
    );
    expect(paramsOf(statementFor())).not.toContain(
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Challenge],
    );
    expect(
      paramsOf(statementFor({ action: SecurityBlockAction.Challenge })),
    ).toContain(CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Challenge]);
  });

  test("on a plan that took IP Access Rules, also the access rule the block was written as", () => {
    const statement: Statement = statementFor({
      accessRuleId: "92f17202ed8bd63d69a66b86a49a8f6b",
    });

    expect(statement.query).toContain(" OR attributes[");
    expect(paramsOf(statement)).toContain("92f17202ed8bd63d69a66b86a49a8f6b");
    expect(JSON.stringify(statement.query_params)).toContain(
      "cloudflare.rule.id",
    );

    // Without one, only OneUptime's rule.
    expect(statementFor().query).not.toContain(" OR attributes[");
  });

  test("never writes a value into the query itself", () => {
    const statement: Statement = statementFor({
      address: "35.205.11.131'); DROP TABLE x; --",
      accessRuleId: "x' OR 1=1 --",
    });

    expect(statement.query).not.toContain("DROP TABLE");
    expect(statement.query).not.toContain("1=1");
  });

  /*
   * Cloudflare writes an IPv6 client compressed (2001:db8::7), and a case
   * keeps the address its block step is about written out
   * (2001:db8:0:0:0:0:0:7): the count read only the case's spelling, so
   * it found nothing Cloudflare stopped of an IPv6 address (#10744).
   */
  test.each([
    "2001:db8:0:0:0:0:0:7",
    "2001:db8::7",
    "2001:0DB8:0000:0000:0000:0000:0000:0007",
  ])(
    "an IPv6 address the case writes %s is read in every spelling an event may hold it in",
    (address: string) => {
      const statement: Statement = statementFor({ address });
      const spellings: Array<string> | undefined = paramsOf(statement).find(
        (value: unknown): boolean => {
          return Array.isArray(value) && value.includes("2001:db8::7");
        },
      ) as Array<string> | undefined;

      expect(statement.query).toContain("principalIp IN ");
      expect(statement.query).not.toContain("2001:");
      expect(spellings).toEqual(
        expect.arrayContaining([
          "2001:db8::7",
          "2001:db8:0:0:0:0:0:7",
          "2001:DB8::7",
        ]),
      );
    },
  );
});

describe("the count's row", () => {
  test("none matched: no requests, and no estimate", () => {
    expect(readCloudflareStoppedRow(undefined)).toEqual({
      requests: 0,
      isEstimate: false,
    });
    expect(
      readCloudflareStoppedRow({ requests: "0", maxSampleInterval: "0" }),
    ).toEqual({ requests: 0, isEstimate: false });
  });

  test("events Cloudflare did not sample: an exact count", () => {
    expect(
      readCloudflareStoppedRow({ requests: "312", maxSampleInterval: "1" }),
    ).toEqual({ requests: 312, isEstimate: false });
  });

  test("any sampled event: an estimate", () => {
    expect(
      readCloudflareStoppedRow({ requests: "3120", maxSampleInterval: "10" }),
    ).toEqual({ requests: 3120, isEstimate: true });
  });
});

describe("the step's fact", () => {
  function factOf(
    reading: CloudflareStoppedReading,
    action: SecurityBlockAction = SecurityBlockAction.Block,
  ): SecurityCaseStepCheckSentence | null {
    return getCloudflareStoppedFact({
      address: ADDRESS,
      action,
      appliedAt: APPLIED_AT,
      reading,
    });
  }

  test("a block: Cloudflare has stopped so many requests from the address since the block, at its time", () => {
    expect(factOf({ requests: 312, isEstimate: false })).toEqual({
      template: CHECK_BLOCK_CLOUDFLARE_STOPPED,
      values: { address: ADDRESS },
      times: { time: APPLIED_AT.toISOString() },
      count: 312,
    });
  });

  test("a sampled count says about", () => {
    expect(factOf({ requests: 3120, isEstimate: true })?.template).toBe(
      CHECK_BLOCK_CLOUDFLARE_STOPPED_ABOUT,
    );
  });

  test("a challenge says challenged, exact or about", () => {
    expect(
      factOf({ requests: 4, isEstimate: false }, SecurityBlockAction.Challenge)
        ?.template,
    ).toBe(CHECK_BLOCK_CLOUDFLARE_CHALLENGED);
    expect(
      factOf({ requests: 40, isEstimate: true }, SecurityBlockAction.Challenge)
        ?.template,
    ).toBe(CHECK_BLOCK_CLOUDFLARE_CHALLENGED_ABOUT);
  });

  test("none stopped: no fact, since the app's requests going quiet already says it", () => {
    expect(factOf({ requests: 0, isEstimate: false })).toBeNull();
  });
});

describe("reading the facts", () => {
  test("asks the event store once, for the block's window, and words what it answers", async () => {
    const query: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockResolvedValue(
        queryResult([{ requests: "312", maxSampleInterval: "1" }]),
      );

    const facts: Array<SecurityCaseStepCheckSentence> =
      await readCloudflareStoppedFacts({
        projectId: PROJECT_ID,
        address: ADDRESS,
        action: SecurityBlockAction.Block,
        row: { providerRef: "item-1" },
        appliedAt: APPLIED_AT,
        now: NOW,
      });

    expect(query).toHaveBeenCalledTimes(1);
    expect(
      Object.values((query.mock.calls[0]![0] as Statement).query_params),
    ).toContain("item-1");
    expect(facts).toEqual([
      {
        template: CHECK_BLOCK_CLOUDFLARE_STOPPED,
        values: { address: ADDRESS },
        times: { time: APPLIED_AT.toISOString() },
        count: 312,
      },
    ]);
  });

  test("nothing stopped: no facts", async () => {
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockResolvedValue(queryResult([]));

    await expect(
      readCloudflareStoppedFacts({
        projectId: PROJECT_ID,
        address: ADDRESS,
        action: SecurityBlockAction.Block,
        row: {},
        appliedAt: APPLIED_AT,
        now: NOW,
      }),
    ).resolves.toEqual([]);
  });

  test("a store that cannot be read throws, for the source to leave the fact out", async () => {
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockRejectedValue(new Error("ClickHouse is down"));

    await expect(
      readCloudflareStoppedFacts({
        projectId: PROJECT_ID,
        address: ADDRESS,
        action: SecurityBlockAction.Block,
        row: {},
        appliedAt: APPLIED_AT,
        now: NOW,
      }),
    ).rejects.toThrow("ClickHouse is down");
  });
});
