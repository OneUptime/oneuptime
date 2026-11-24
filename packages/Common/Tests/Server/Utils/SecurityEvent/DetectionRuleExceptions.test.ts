import DetectionRuleExceptions, {
  DETECTION_RULE_EXCEPTION_SELECT,
  DetectionRuleExceptionRead,
  LoadedDetectionRuleException,
  MAX_API_KEY_PRINCIPALS_PER_EXCEPTION,
  andRestrictions,
  buildDetectionRuleExceptionMatch,
  buildDetectionRuleExceptionsFilter,
  buildDetectionRuleExceptionsMatch,
  doesDetectionRuleExceptionNameUsers,
  doesDetectionRuleExceptionValueMatchText,
  getApiKeyPrincipalsNamedBy,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleExceptions";
import ApiKeyService from "../../../../Server/Services/ApiKeyService";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import DetectionRuleException from "../../../../Models/DatabaseModels/DetectionRuleException";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
} from "../../../../Types/SecurityEvent/DetectionRuleException";
import { getApiKeyPrincipal } from "../../../../Types/SecurityEvent/OneUptimeActorPrincipal";
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

function match(exception: DetectionRuleExceptionRead): Statement {
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
    // The project has no API keys unless a test says so (#10630).
    getJestSpyOn(ApiKeyService, "findAllBy").mockResolvedValue([] as never);

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
      Array<LoadedDetectionRuleException>
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
      Array<LoadedDetectionRuleException>
    > = await DetectionRuleExceptions.loadForProject({
      projectId: PROJECT_ID,
      ruleIds: [RULE_A, RULE_B],
      from: new Date(NOW.getTime() - 3 * HOUR),
      until: NOW,
      now: NOW,
    });

    expect(
      (byRule.get(RULE_A.toString()) || []).map(
        (exception: LoadedDetectionRuleException): string => {
          return exception.id!.toString();
        },
      ),
    ).toEqual(["cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd01"]);
    expect(
      (byRule.get(RULE_B.toString()) || []).map(
        (exception: LoadedDetectionRuleException): string => {
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

    const exceptions: Array<LoadedDetectionRuleException> =
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

/*
 * AN EXCEPTION THAT NAMES A PROJECT API KEY BY ITS NAME (#10630). A key's
 * events name it "api-key:<id>" now, not by its name, so the exceptions
 * written for "terraform" - an entity exception for that user, or the
 * value principalUser terraform - are matched against the project's keys'
 * names when they are loaded, and skip the principals of the keys they
 * name as well. The comparison stays on principalUser.
 */
describe("an exception that names an API key by its name", () => {
  const TERRAFORM_ID: string = "0192f1a0-0000-7000-8000-00000000c001";
  const TERRAFORM_TWIN_ID: string = "0192f1a0-0000-7000-8000-00000000c002";
  const DEPLOY_BOT_ID: string = "0192f1a0-0000-7000-8000-00000000c003";

  const KEYS: Array<{ id: string; name: string }> = [
    { id: TERRAFORM_ID, name: "terraform" },
    // Two keys of one name are two actors; a name names them both.
    { id: TERRAFORM_TWIN_ID, name: "Terraform" },
    { id: DEPLOY_BOT_ID, name: "deploy-bot" },
  ];

  test("a value matches a key's name as the SQL does: whatever the case, * for any run", () => {
    expect(
      doesDetectionRuleExceptionValueMatchText("terraform", "Terraform"),
    ).toBe(true);
    expect(
      doesDetectionRuleExceptionValueMatchText("deploy-*", "deploy-bot"),
    ).toBe(true);
    expect(
      doesDetectionRuleExceptionValueMatchText("*-BOT", "deploy-bot"),
    ).toBe(true);
    expect(doesDetectionRuleExceptionValueMatchText("terra", "terraform")).toBe(
      false,
    );
    expect(
      doesDetectionRuleExceptionValueMatchText("terraform", "terraform2"),
    ).toBe(false);
    // Nothing but * is a wildcard: a regular expression's and LIKE's own are text.
    expect(doesDetectionRuleExceptionValueMatchText("ci.key", "ci-key")).toBe(
      false,
    );
    expect(doesDetectionRuleExceptionValueMatchText("ci.key", "ci.key")).toBe(
      true,
    );
    expect(
      doesDetectionRuleExceptionValueMatchText("ci_%(key)", "ci_%(key)"),
    ).toBe(true);
    expect(doesDetectionRuleExceptionValueMatchText("ci_key", "cixkey")).toBe(
      false,
    );
    expect(doesDetectionRuleExceptionValueMatchText("a+b", "aab")).toBe(false);
    // A run of stars is one star; a lone star, or nothing, names nothing.
    expect(doesDetectionRuleExceptionValueMatchText("ci**", "ci-key")).toBe(
      true,
    );
    expect(doesDetectionRuleExceptionValueMatchText("*", "terraform")).toBe(
      false,
    );
    expect(doesDetectionRuleExceptionValueMatchText("  ", "terraform")).toBe(
      false,
    );
    expect(doesDetectionRuleExceptionValueMatchText("terraform", "")).toBe(
      false,
    );
    expect(
      doesDetectionRuleExceptionValueMatchText(undefined, "terraform"),
    ).toBe(false);
  });

  test("only an exception that names users can name a key", () => {
    expect(
      doesDetectionRuleExceptionNameUsers(
        entity(SecurityEntityType.User, "terraform"),
      ),
    ).toBe(true);
    expect(
      doesDetectionRuleExceptionNameUsers(value("principalUser", "x")),
    ).toBe(true);
    // Sigma's spellings of principalUser, whatever their case.
    expect(doesDetectionRuleExceptionNameUsers(value("User", "x"))).toBe(true);
    expect(doesDetectionRuleExceptionNameUsers(value("user.name", "x"))).toBe(
      true,
    );
    expect(
      doesDetectionRuleExceptionNameUsers(
        entity(SecurityEntityType.Host, "terraform"),
      ),
    ).toBe(false);
    expect(
      doesDetectionRuleExceptionNameUsers(
        entity(SecurityEntityType.IpAddress, "10.0.0.1"),
      ),
    ).toBe(false);
    expect(doesDetectionRuleExceptionNameUsers(value("targetUser", "x"))).toBe(
      false,
    );
    expect(doesDetectionRuleExceptionNameUsers(value("processName", "x"))).toBe(
      false,
    );
    expect(
      doesDetectionRuleExceptionNameUsers(value("audit.api_key_name", "x")),
    ).toBe(false);
    expect(
      doesDetectionRuleExceptionNameUsers({
        kind: DetectionRuleExceptionKind.TimeWindow,
      }),
    ).toBe(false);
  });

  test("an exception names every key of its name, each as its own principal", () => {
    expect(
      getApiKeyPrincipalsNamedBy(
        entity(SecurityEntityType.User, "terraform"),
        KEYS,
      ),
    ).toEqual([`api-key:${TERRAFORM_ID}`, `api-key:${TERRAFORM_TWIN_ID}`]);
    expect(
      getApiKeyPrincipalsNamedBy(value("principalUser", "deploy-*"), KEYS),
    ).toEqual([`api-key:${DEPLOY_BOT_ID}`]);
    // A person's name names no key; nor does a host, an address or another field.
    expect(
      getApiKeyPrincipalsNamedBy(
        entity(SecurityEntityType.User, "jane@example.com"),
        KEYS,
      ),
    ).toEqual([]);
    expect(
      getApiKeyPrincipalsNamedBy(
        entity(SecurityEntityType.Host, "terraform"),
        KEYS,
      ),
    ).toEqual([]);
    expect(
      getApiKeyPrincipalsNamedBy(value("processName", "terraform"), KEYS),
    ).toEqual([]);
    // A key with no id of its own is no principal.
    expect(
      getApiKeyPrincipalsNamedBy(entity(SecurityEntityType.User, "terraform"), [
        { id: "not-an-id", name: "terraform" },
      ]),
    ).toEqual([]);
  });

  test("at most a hundred keys a name, however many share it", () => {
    const many: Array<{ id: string; name: string }> = [];

    for (let index: number = 0; index < 150; index++) {
      many.push({
        id: `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
        name: "ci",
      });
    }

    expect(
      getApiKeyPrincipalsNamedBy(entity(SecurityEntityType.User, "ci"), many),
    ).toHaveLength(MAX_API_KEY_PRINCIPALS_PER_EXCEPTION);
  });

  test("a user exception skips the keys it names as who acted, beside the name", () => {
    const statement: Statement = match({
      ...entity(SecurityEntityType.User, "terraform"),
      apiKeyPrincipals: [
        getApiKeyPrincipal(TERRAFORM_ID),
        getApiKeyPrincipal(TERRAFORM_TWIN_ID),
      ],
    });

    expect(statement.query).toBe(
      "((lowerUTF8(principalUser) = {p0:String}) OR (lowerUTF8(targetUser) = {p1:String}) OR (arrayExists(__exception_element -> lowerUTF8(__exception_element) = {p2:String}, observables)) OR (lowerUTF8(principalUser) IN {p3:Array(String)}))",
    );
    expect(params(statement)).toEqual([
      "terraform",
      "terraform",
      "terraform",
      [`api-key:${TERRAFORM_ID}`, `api-key:${TERRAFORM_TWIN_ID}`],
    ]);
  });

  test("a principalUser value skips the keys it names too, by its Sigma spelling as well", () => {
    for (const field of ["principalUser", "User", "username"]) {
      const statement: Statement = match({
        ...value(field, "terraform"),
        apiKeyPrincipals: [getApiKeyPrincipal(TERRAFORM_ID)],
      });

      expect(statement.query).toBe(
        "((lowerUTF8(principalUser) = {p0:String}) OR (lowerUTF8(principalUser) IN {p1:Array(String)}))",
      );
      expect(params(statement)).toEqual([
        "terraform",
        [`api-key:${TERRAFORM_ID}`],
      ]);
    }
  });

  test("an exception that names no key reads as it always did", () => {
    expect(
      match({
        ...entity(SecurityEntityType.User, "terraform"),
        apiKeyPrincipals: [],
      }).query,
    ).toBe(match(entity(SecurityEntityType.User, "terraform")).query);
    expect(
      match({ ...value("principalUser", "terraform"), apiKeyPrincipals: [] })
        .query,
    ).toBe("lowerUTF8(principalUser) = {p0:String}");
    // Principals on an exception that cannot name a key are never read.
    expect(
      match({
        ...entity(SecurityEntityType.Host, "terraform"),
        apiKeyPrincipals: [getApiKeyPrincipal(TERRAFORM_ID)],
      }).query,
    ).not.toContain("IN {");
    expect(
      match({
        ...value("processName", "terraform"),
        apiKeyPrincipals: [getApiKeyPrincipal(TERRAFORM_ID)],
      }).query,
    ).toBe("lowerUTF8(processName) = {p0:String}");
  });

  test("an exception for one key's principal skips that key alone", () => {
    const statement: Statement = match(
      entity(SecurityEntityType.User, `api-key:${TERRAFORM_ID}`),
    );

    expect(params(statement)[0]).toBe(`api-key:${TERRAFORM_ID}`);
    expect(statement.query).not.toContain("IN {");
  });

  describe("when a rule's exceptions are loaded", () => {
    function exceptionRow(data: {
      id: string;
      kind: DetectionRuleExceptionKind;
      entityType?: SecurityEntityType;
      fieldName?: string;
      value?: string;
      ruleId?: ObjectID;
      startsAt?: Date;
      endsAt?: Date;
    }): DetectionRuleException {
      const exception: DetectionRuleException = new DetectionRuleException();
      exception._id = data.id;
      exception.detectionRuleId = data.ruleId || RULE_A;
      exception.kind = data.kind;

      if (data.entityType) {
        exception.entityType = data.entityType;
      }

      if (data.fieldName) {
        exception.fieldName = data.fieldName;
      }

      if (data.value) {
        exception.value = data.value;
      }

      if (data.startsAt) {
        exception.startsAt = data.startsAt;
      }

      if (data.endsAt) {
        exception.endsAt = data.endsAt;
      }

      return exception;
    }

    function apiKey(id: string, name: string | undefined): ApiKey {
      const key: ApiKey = new ApiKey();
      key._id = id;

      if (name !== undefined) {
        key.name = name;
      }

      return key;
    }

    function stubKeys(keys: Array<ApiKey>): Spy {
      return getJestSpyOn(ApiKeyService, "findAllBy").mockResolvedValue(
        keys as never,
      );
    }

    function stubExceptions(rows: Array<DetectionRuleException>): void {
      getJestSpyOn(
        DetectionRuleExceptionService,
        "findAllBy",
      ).mockResolvedValue(rows as never);
    }

    test("the keys an exception names ride with it, read once for every rule, as root", async () => {
      stubExceptions([
        exceptionRow({
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd11",
          kind: DetectionRuleExceptionKind.Entity,
          entityType: SecurityEntityType.User,
          value: "terraform",
        }),
        exceptionRow({
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd12",
          ruleId: RULE_B,
          kind: DetectionRuleExceptionKind.Value,
          fieldName: "principalUser",
          value: "deploy-*",
        }),
        exceptionRow({
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd13",
          ruleId: RULE_B,
          kind: DetectionRuleExceptionKind.Entity,
          entityType: SecurityEntityType.Host,
          value: "terraform",
        }),
      ]);
      const findKeys: Spy = stubKeys([
        apiKey(TERRAFORM_ID, "terraform"),
        apiKey(TERRAFORM_TWIN_ID, "Terraform"),
        apiKey(DEPLOY_BOT_ID, "deploy-bot"),
        // A key with no name is never named.
        apiKey("0192f1a0-0000-7000-8000-00000000c004", undefined),
      ]);

      const byRule: Map<
        string,
        Array<LoadedDetectionRuleException>
      > = await DetectionRuleExceptions.loadForProject({
        projectId: PROJECT_ID,
        ruleIds: [RULE_A, RULE_B],
        from: new Date(NOW.getTime() - HOUR),
        until: NOW,
        now: NOW,
      });

      expect(findKeys).toHaveBeenCalledTimes(1);
      expect(findKeys.mock.calls[0]![0]).toEqual({
        query: { projectId: PROJECT_ID },
        select: { _id: true, name: true },
        sort: { _id: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

      const [terraform] = byRule.get(RULE_A.toString()) || [];
      expect(terraform!.apiKeyPrincipals).toEqual([
        `api-key:${TERRAFORM_ID}`,
        `api-key:${TERRAFORM_TWIN_ID}`,
      ]);
      expect(terraform!.id!.toString()).toBe(
        "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd11",
      );
      expect(terraform!.value).toBe("terraform");

      const [deployBots, host] = byRule.get(RULE_B.toString()) || [];
      expect(deployBots!.apiKeyPrincipals).toEqual([
        `api-key:${DEPLOY_BOT_ID}`,
      ]);
      // A host exception names no key, however it is spelt.
      expect(host!.apiKeyPrincipals).toBeUndefined();

      // What the rule's run reads: the key's principal beside its name.
      const filter: Statement | null = buildDetectionRuleExceptionsFilter(
        byRule.get(RULE_A.toString()) || [],
      );
      expect(filter!.query).toContain("lowerUTF8(principalUser) IN {");
      expect(params(filter!)).toContainEqual([
        `api-key:${TERRAFORM_ID}`,
        `api-key:${TERRAFORM_TWIN_ID}`,
      ]);
    });

    test("no exception that names users, no read of the keys", async () => {
      stubExceptions([
        exceptionRow({
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd21",
          kind: DetectionRuleExceptionKind.Entity,
          entityType: SecurityEntityType.Host,
          value: "web-*",
        }),
        exceptionRow({
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd22",
          kind: DetectionRuleExceptionKind.TimeWindow,
          startsAt: new Date(NOW.getTime() - HOUR),
          endsAt: NOW,
        }),
      ]);
      const findKeys: Spy = stubKeys([apiKey(TERRAFORM_ID, "terraform")]);

      const exceptions: Array<LoadedDetectionRuleException> =
        await DetectionRuleExceptions.loadForRule({
          projectId: PROJECT_ID,
          ruleId: RULE_A,
          from: new Date(NOW.getTime() - 2 * HOUR),
          until: NOW,
          now: NOW,
        });

      expect(exceptions).toHaveLength(2);
      expect(findKeys).not.toHaveBeenCalled();
    });

    test("a read of the keys that fails is not swallowed: no rule runs past an exception it cannot honor", async () => {
      stubExceptions([
        exceptionRow({
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcd31",
          kind: DetectionRuleExceptionKind.Entity,
          entityType: SecurityEntityType.User,
          value: "terraform",
        }),
      ]);
      getJestSpyOn(ApiKeyService, "findAllBy").mockRejectedValue(
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
});
