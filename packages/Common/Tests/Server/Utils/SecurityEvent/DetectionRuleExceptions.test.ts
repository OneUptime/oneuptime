import DetectionRuleExceptions, {
  DETECTION_RULE_EXCEPTION_SELECT,
  andRestrictions,
  buildDetectionRuleExceptionMatch,
  buildDetectionRuleExceptionsFilter,
  buildDetectionRuleExceptionsMatch,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleExceptions";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import DetectionRuleException from "../../../../Models/DatabaseModels/DetectionRuleException";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
} from "../../../../Types/SecurityEvent/DetectionRuleException";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A DETECTION RULE'S EXCEPTIONS AS SQL: the condition an event meets when
 * one of them skips it, over the SecurityEvent table. Every value is bound
 * as a parameter; the columns come from fixed lists, never from what a
 * person typed. Real ClickHouse reads them in App's
 * DetectionRuleExceptionsClickhouse suite; here, the statements' shape.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const RULE_A: ObjectID = new ObjectID("abababab-abab-4bab-8bab-abababababa1");
const RULE_B: ObjectID = new ObjectID("abababab-abab-4bab-8bab-abababababa2");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

function match(exception: DetectionRuleExceptionShape): Statement {
  const statement: Statement | null =
    buildDetectionRuleExceptionMatch(exception);

  expect(statement).not.toBeNull();

  return statement!;
}

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function entity(
  entityType: SecurityEntityType,
  value: string,
): DetectionRuleExceptionShape {
  return {
    kind: DetectionRuleExceptionKind.Entity,
    entityType,
    value,
  };
}

function value(fieldName: string, text: string): DetectionRuleExceptionShape {
  return {
    kind: DetectionRuleExceptionKind.Value,
    fieldName,
    value: text,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an entity", () => {
  test("a user is matched as who acted, who was acted on, and among the observables", () => {
    const statement: Statement = match(
      entity(SecurityEntityType.User, "Alice@Example.com"),
    );

    expect(statement.query).toBe(
      "((lowerUTF8(principalUser) = {p0:String}) OR (lowerUTF8(targetUser) = {p1:String}) OR (arrayExists(__exception_element -> lowerUTF8(__exception_element) = {p2:String}, observables)))",
    );
    // Whatever the case: the value is lowered once, and so is each column.
    expect(params(statement)).toEqual([
      "alice@example.com",
      "alice@example.com",
      "alice@example.com",
    ]);
  });

  test("a host and an address read their own columns", () => {
    expect(match(entity(SecurityEntityType.Host, "web-01")).query).toContain(
      "lowerUTF8(principalHost) = {p0:String}) OR (lowerUTF8(targetHost) = {p1:String})",
    );
    expect(
      match(entity(SecurityEntityType.IpAddress, "10.0.0.5")).query,
    ).toContain(
      "lowerUTF8(principalIp) = {p0:String}) OR (lowerUTF8(targetIp) = {p1:String})",
    );
  });

  test("* is any run of characters; LIKE's own % _ and \\ are taken literally", () => {
    const statement: Statement = match(
      entity(SecurityEntityType.User, "svc_back%up\\*"),
    );

    expect(statement.query).toContain(
      "lowerUTF8(principalUser) LIKE {p0:String}",
    );
    expect(statement.query).not.toContain(" = ");
    // svc\_back\%up\\ then %: the star alone is a wildcard.
    expect(params(statement)[0]).toBe("svc\\_back\\%up\\\\%");
  });

  test("a pattern of a domain's hosts", () => {
    expect(
      params(match(entity(SecurityEntityType.Host, "*.Corp.Example.com"))),
    ).toEqual([
      "%.corp.example.com",
      "%.corp.example.com",
      "%.corp.example.com",
    ]);
  });

  test("an address range is matched as one, on text that is an address", () => {
    const statement: Statement = match(
      entity(SecurityEntityType.IpAddress, "10.20.0.0/16"),
    );

    expect(statement.query).toContain(
      "((isIPv4String(principalIp) OR isIPv6String(principalIp)) AND isIPAddressInRange(if((isIPv4String(principalIp) OR isIPv6String(principalIp)), principalIp, '::'), {p0:String}))",
    );
    expect(statement.query).toContain(
      "arrayExists(__exception_element -> ((isIPv4String(__exception_element) OR isIPv6String(__exception_element)) AND isIPAddressInRange(",
    );
    expect(statement.query).not.toContain("lowerUTF8");
    expect(params(statement)).toEqual([
      "10.20.0.0/16",
      "10.20.0.0/16",
      "10.20.0.0/16",
    ]);
  });

  test("a slash in a user is just a character, never a range", () => {
    const statement: Statement = match(
      entity(SecurityEntityType.User, "corp/alice"),
    );

    expect(statement.query).not.toContain("isIPAddressInRange");
    expect(params(statement)[0]).toBe("corp/alice");
  });

  test("a type no entity exception names, or no value, matches nothing", () => {
    expect(
      buildDetectionRuleExceptionMatch(
        entity(SecurityEntityType.Domain, "example.com"),
      ),
    ).toBeNull();
    expect(
      buildDetectionRuleExceptionMatch(entity(SecurityEntityType.User, "  ")),
    ).toBeNull();
    // A lone * would skip everything: a row like that skips nothing.
    expect(
      buildDetectionRuleExceptionMatch(entity(SecurityEntityType.User, "**")),
    ).toBeNull();
  });
});

describe("a value", () => {
  test("a typed column, by its Sigma spelling too", () => {
    expect(match(value("processName", "Backup.EXE")).query).toBe(
      "lowerUTF8(processName) = {p0:String}",
    );
    expect(params(match(value("processName", "Backup.EXE")))).toEqual([
      "backup.exe",
    ]);
    // CommandLine is the process command line, as a Sigma rule reads it.
    expect(match(value("CommandLine", "*--backup*")).query).toBe(
      "lowerUTF8(processCommandLine) LIKE {p0:String}",
    );
  });

  test("an attribute key, bound as a parameter", () => {
    const statement: Statement = match(value("http.user_agent", "Nessus*"));

    expect(statement.query).toBe(
      "lowerUTF8(attributes[{p0:String}]) LIKE {p1:String}",
    );
    expect(params(statement)).toEqual(["http.user_agent", "nessus%"]);
  });

  test("a number column is compared as its text", () => {
    expect(match(value("targetPort", "8443")).query).toBe(
      "lowerUTF8(toString(targetPort)) = {p0:String}",
    );
  });

  test("an array column skips an event when any of its values is the value", () => {
    expect(match(value("mitreTechniques", "T1110")).query).toBe(
      "arrayExists(__exception_element -> lowerUTF8(__exception_element) = {p0:String}, mitreTechniques)",
    );
  });

  test("a field with no name matches nothing", () => {
    expect(buildDetectionRuleExceptionMatch(value("  ", "x"))).toBeNull();
  });
});

describe("a time window", () => {
  test("every event from its start up to its end", () => {
    const startsAt: Date = new Date(NOW.getTime() + HOUR);
    const endsAt: Date = new Date(NOW.getTime() + 3 * HOUR);

    const statement: Statement = match({
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt,
      endsAt,
    });

    expect(statement.query).toBe(
      "(time >= {p0:DateTime64(9)} AND time < {p1:DateTime64(9)})",
    );
    expect(params(statement)).toHaveLength(2);
  });

  test("a window with a missing or backwards time matches nothing", () => {
    expect(
      buildDetectionRuleExceptionMatch({
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: NOW,
      }),
    ).toBeNull();
    expect(
      buildDetectionRuleExceptionMatch({
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: NOW,
        endsAt: NOW,
      }),
    ).toBeNull();
  });

  test("a kind no exception has matches nothing", () => {
    expect(
      buildDetectionRuleExceptionMatch({ kind: "Something", value: "x" }),
    ).toBeNull();
  });
});

describe("a rule's exceptions together", () => {
  test("an event any of them skips is skipped: their matches ORed", () => {
    const statement: Statement | null = buildDetectionRuleExceptionsMatch([
      entity(SecurityEntityType.User, "alice"),
      // Skips nothing: left out.
      entity(SecurityEntityType.User, ""),
      value("processName", "backup.exe"),
    ]);

    expect(statement!.query).toBe(
      "((((lowerUTF8(principalUser) = {p0:String}) OR (lowerUTF8(targetUser) = {p1:String}) OR (arrayExists(__exception_element -> lowerUTF8(__exception_element) = {p2:String}, observables)))) OR (lowerUTF8(processName) = {p3:String}))",
    );
  });

  test("none that skips anything is no condition at all", () => {
    expect(buildDetectionRuleExceptionsMatch([])).toBeNull();
    expect(
      buildDetectionRuleExceptionsMatch([entity(SecurityEntityType.User, "*")]),
    ).toBeNull();
    expect(buildDetectionRuleExceptionsFilter([])).toBeNull();
  });

  test("a run's filter is NOT the match: the events no exception skips", () => {
    const filter: Statement | null = buildDetectionRuleExceptionsFilter([
      value("processName", "backup.exe"),
    ]);

    expect(filter!.query).toBe("NOT ((lowerUTF8(processName) = {p0:String}))");
  });

  test("two restrictions on a read are ANDed, and either may be missing", () => {
    const first: Statement = SQL`a = 1`;
    const second: Statement = SQL`b = 2`;

    expect(andRestrictions(first, second)!.query).toBe("(a = 1) AND (b = 2)");
    expect(andRestrictions(first, null)!.query).toBe("a = 1");
    expect(andRestrictions(undefined, second)!.query).toBe("b = 2");
    expect(andRestrictions(null, undefined)).toBeUndefined();
  });
});

describe("reading a project's exceptions", () => {
  function row(data: {
    id: string;
    ruleId?: ObjectID;
    kind: DetectionRuleExceptionKind;
    value?: string;
    startsAt?: Date;
    endsAt?: Date;
    expiresAt?: Date;
  }): DetectionRuleException {
    const exception: DetectionRuleException = new DetectionRuleException();
    exception._id = data.id;

    if (data.ruleId) {
      exception.detectionRuleId = data.ruleId;
    }

    exception.kind = data.kind;
    exception.entityType = SecurityEntityType.User;

    if (data.value) {
      exception.value = data.value;
    }

    if (data.startsAt) {
      exception.startsAt = data.startsAt;
    }

    if (data.endsAt) {
      exception.endsAt = data.endsAt;
    }

    if (data.expiresAt) {
      exception.expiresAt = data.expiresAt;
    }

    return exception;
  }

  function stubRows(rows: Array<DetectionRuleException>): Spy {
    return getJestSpyOn(
      DetectionRuleExceptionService,
      "findAllBy",
    ).mockResolvedValue(rows as never);
  }

  test("one read for the rules named, as root, only the columns a run needs", async () => {
    const findAll: Spy = stubRows([]);

    await DetectionRuleExceptions.loadForProject({
      projectId: PROJECT_ID,
      ruleIds: [RULE_A, RULE_B],
      from: new Date(NOW.getTime() - HOUR),
      until: NOW,
      now: NOW,
    });

    expect(findAll).toHaveBeenCalledTimes(1);

    const args: {
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    } = findAll.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    };

    expect(args.query["projectId"]).toBe(PROJECT_ID);
    expect((args.query["detectionRuleId"] as Includes).values).toEqual([
      RULE_A.toString(),
      RULE_B.toString(),
    ]);
    expect(args.select).toEqual(DETECTION_RULE_EXCEPTION_SELECT);
    expect(args.sort).toEqual({ _id: SortOrder.Ascending });
    expect(args.props).toEqual({ isRoot: true });
  });

  test("no rule named is no read", async () => {
    const findAll: Spy = stubRows([]);

    const byRule: Map<
      string,
      Array<DetectionRuleException>
    > = await DetectionRuleExceptions.loadForProject({
      projectId: PROJECT_ID,
      ruleIds: [],
      from: NOW,
      until: NOW,
      now: NOW,
    });

    expect(byRule.size).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
  });

  test("only the exceptions that take part in the read, by rule", async () => {
    stubRows([
      row({
        id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd01",
        ruleId: RULE_A,
        kind: DetectionRuleExceptionKind.Entity,
        value: "alice",
      }),
      // Expired before the read is made.
      row({
        id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd02",
        ruleId: RULE_A,
        kind: DetectionRuleExceptionKind.Entity,
        value: "bob",
        expiresAt: new Date(NOW.getTime() - 1),
      }),
      // A window outside the read.
      row({
        id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd03",
        ruleId: RULE_B,
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: new Date(NOW.getTime() - 10 * HOUR),
        endsAt: new Date(NOW.getTime() - 9 * HOUR),
      }),
      // A window inside it.
      row({
        id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd04",
        ruleId: RULE_B,
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: new Date(NOW.getTime() - 2 * HOUR),
        endsAt: new Date(NOW.getTime() - HOUR / 2),
      }),
      // A row with no rule: skipped.
      row({
        id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd05",
        kind: DetectionRuleExceptionKind.Entity,
        value: "carol",
      }),
    ]);

    const byRule: Map<
      string,
      Array<DetectionRuleException>
    > = await DetectionRuleExceptions.loadForProject({
      projectId: PROJECT_ID,
      ruleIds: [RULE_A, RULE_B],
      from: new Date(NOW.getTime() - 3 * HOUR),
      until: NOW,
      now: NOW,
    });

    expect(
      (byRule.get(RULE_A.toString()) || []).map(
        (exception: DetectionRuleException): string => {
          return exception.id!.toString();
        },
      ),
    ).toEqual(["cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd01"]);
    expect(
      (byRule.get(RULE_B.toString()) || []).map(
        (exception: DetectionRuleException): string => {
          return exception.id!.toString();
        },
      ),
    ).toEqual(["cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd04"]);
  });

  test("one rule's, for a run of that rule", async () => {
    const findAll: Spy = stubRows([
      row({
        id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd01",
        ruleId: RULE_A,
        kind: DetectionRuleExceptionKind.Entity,
        value: "alice",
      }),
    ]);

    const exceptions: Array<DetectionRuleException> =
      await DetectionRuleExceptions.loadForRule({
        projectId: PROJECT_ID,
        ruleId: RULE_A,
        from: new Date(NOW.getTime() - HOUR),
        until: NOW,
        now: NOW,
      });

    expect(exceptions).toHaveLength(1);
    expect(
      (
        (findAll.mock.calls[0]![0] as { query: JSONObject }).query[
          "detectionRuleId"
        ] as Includes
      ).values,
    ).toEqual([RULE_A.toString()]);
  });

  test("a read that fails is not swallowed: no rule runs blind to its exceptions", async () => {
    getJestSpyOn(DetectionRuleExceptionService, "findAllBy").mockRejectedValue(
      new Error("database not connected") as never,
    );

    await expect(
      DetectionRuleExceptions.loadForRule({
        projectId: PROJECT_ID,
        ruleId: RULE_A,
        from: NOW,
        until: NOW,
        now: NOW,
      }),
    ).rejects.toThrow("database not connected");
  });
});
