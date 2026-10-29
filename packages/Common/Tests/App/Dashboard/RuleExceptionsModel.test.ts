import { describe, expect, test } from "@jest/globals";
import {
  RuleExceptionLine,
  RuleExceptionSkipsView,
  countActiveExceptionsByRule,
  getDetectionExceptionEntity,
  getRuleExceptionInitialValues,
  getRuleExceptionSkipsView,
  getRuleExceptionStatusColor,
  getRuleExceptionStatusLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsModel";
import {
  ADDRESS_RANGE_LABEL,
  STATUS_ENDS_AT,
  STATUS_EXPIRES,
  STATUS_NO_EXPIRY,
  STATUS_STARTS_AT,
  TIME_WINDOW_LABEL,
  VALUE_IN_FIELD,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import {
  RULE_EXCEPTIONS_RULE_FILTER_KEY,
  RULE_EXCEPTIONS_TABLE_ID,
  getRuleExceptionsFilterParams,
  getRuleExceptionsFilteredRuleId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsRoute";
import { Gray500, Green, Indigo500 } from "../../../Types/BrandColors";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEntity,
  SecurityEntityType,
  getSecurityEntityIcon,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
  DetectionRuleExceptionStatus,
} from "../../../Types/SecurityEvent/DetectionRuleException";

/*
 * WHAT THE RULE EXCEPTIONS LIST AND THE ADD EXCEPTION DIALOG SHOW OF AN
 * EXCEPTION: what a row skips and what kind of thing that is, where it
 * stands and until when, the count under a rule's name, what the dialog
 * starts with from a rule's row or a case's detection, and the address a
 * rule's View Exceptions lands on.
 */

const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function at(offset: number): Date {
  return new Date(NOW.getTime() + offset);
}

const RULE_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const RULE_B: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

describe("what a row skips", () => {
  test("a user: its value, with its kind's icon, over its kind", () => {
    const view: RuleExceptionSkipsView = getRuleExceptionSkipsView({
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
      value: "  svc-* ",
    });

    expect(view).toEqual({
      icon: getSecurityEntityIcon(SecurityEntityType.User),
      value: "svc-*",
      window: null,
      kind: { key: SecurityEntityType.User },
    });
  });

  test("an address range says it is a range; a single address is an IP Address", () => {
    expect(
      getRuleExceptionSkipsView({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.IpAddress,
        value: "10.20.0.0/16",
      }).kind,
    ).toEqual({ key: ADDRESS_RANGE_LABEL });
    expect(
      getRuleExceptionSkipsView({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.IpAddress,
        value: "10.20.0.5",
      }).kind,
    ).toEqual({ key: SecurityEntityType.IpAddress });
  });

  test("a host keeps a slash as a character, never a range", () => {
    expect(
      getRuleExceptionSkipsView({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.Host,
        value: "web/01",
      }).kind,
    ).toEqual({ key: SecurityEntityType.Host });
  });

  test("a value: its value over the field it is the value of", () => {
    const view: RuleExceptionSkipsView = getRuleExceptionSkipsView({
      kind: DetectionRuleExceptionKind.Value,
      fieldName: " processName ",
      value: "backup.exe",
    });

    expect(view.icon).toBe(IconProp.Filter);
    expect(view.value).toBe("backup.exe");
    expect(view.window).toBeNull();
    expect(view.kind).toEqual({ key: VALUE_IN_FIELD, field: "processName" });
  });

  test("a window: its times in place of a value, over Time window", () => {
    const view: RuleExceptionSkipsView = getRuleExceptionSkipsView({
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt: at(HOUR).toISOString(),
      endsAt: at(3 * HOUR),
    });

    expect(view).toEqual({
      icon: IconProp.Clock,
      value: null,
      window: { from: at(HOUR), until: at(3 * HOUR) },
      kind: { key: TIME_WINDOW_LABEL },
    });
  });

  test("a row of an entity type no exception names reads as Other", () => {
    expect(
      getRuleExceptionSkipsView({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: "Spaceship",
        value: "x",
      }).kind,
    ).toEqual({ key: SecurityEntityType.Other });
  });
});

describe("where an exception stands, under its pill", () => {
  test("green while it skips, indigo before a window starts, grey once it skips nothing", () => {
    expect(
      getRuleExceptionStatusColor(DetectionRuleExceptionStatus.Active),
    ).toBe(Green);
    expect(
      getRuleExceptionStatusColor(DetectionRuleExceptionStatus.Upcoming),
    ).toBe(Indigo500);
    expect(
      getRuleExceptionStatusColor(DetectionRuleExceptionStatus.Expired),
    ).toBe(Gray500);
    expect(
      getRuleExceptionStatusColor(DetectionRuleExceptionStatus.Ended),
    ).toBe(Gray500);
  });

  function line(exception: DetectionRuleExceptionShape): RuleExceptionLine {
    return getRuleExceptionStatusLine(exception, NOW);
  }

  /*
   * How far off, not a date: "Expires in 30 days", "2 days ago". The date
   * itself is under the pointer, and the pill already says Expired or
   * Ended, so a line under one is only how long ago.
   */
  test("an entity or a value: no expiry, how soon it expires, or how long ago it did", () => {
    const entity: DetectionRuleExceptionShape = {
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
      value: "alice",
    };

    expect(line(entity)).toEqual({ key: STATUS_NO_EXPIRY });
    expect(line({ ...entity, expiresAt: at(DAY) })).toEqual({
      key: STATUS_EXPIRES,
      time: at(DAY),
      isTimeRelative: true,
    });
    expect(line({ ...entity, expiresAt: at(-DAY) })).toEqual({
      time: at(-DAY),
      isTimeRelative: true,
    });
  });

  test("a window: how soon it starts or ends, or how long ago it ended", () => {
    const window: DetectionRuleExceptionShape = {
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt: at(HOUR),
      endsAt: at(2 * HOUR),
    };

    expect(line(window)).toEqual({
      key: STATUS_STARTS_AT,
      time: at(HOUR),
      isTimeRelative: true,
    });
    expect(getRuleExceptionStatusLine(window, at(HOUR + 1))).toEqual({
      key: STATUS_ENDS_AT,
      time: at(2 * HOUR),
      isTimeRelative: true,
    });
    expect(getRuleExceptionStatusLine(window, at(3 * HOUR))).toEqual({
      time: at(2 * HOUR),
      isTimeRelative: true,
    });
  });

  test("a line under Expired or Ended never repeats its pill's word", () => {
    const expired: RuleExceptionLine = line({
      kind: DetectionRuleExceptionKind.Value,
      fieldName: "processName",
      value: "backup.exe",
      expiresAt: at(-HOUR),
    });
    const ended: RuleExceptionLine = line({
      kind: DetectionRuleExceptionKind.TimeWindow,
      startsAt: at(-3 * HOUR),
      endsAt: at(-HOUR),
    });

    expect(expired.key).toBeUndefined();
    expect(ended.key).toBeUndefined();
  });
});

describe("the count under a rule's name", () => {
  test("counts only the exceptions that skip something now, by rule", () => {
    const counts: Map<string, number> = countActiveExceptionsByRule(
      [
        {
          detectionRuleId: RULE_A,
          kind: DetectionRuleExceptionKind.Entity,
          value: "alice",
        },
        {
          detectionRuleId: RULE_A,
          kind: DetectionRuleExceptionKind.Value,
          value: "backup.exe",
          expiresAt: at(DAY),
        },
        // Expired: kept on the list, not counted.
        {
          detectionRuleId: RULE_A,
          kind: DetectionRuleExceptionKind.Entity,
          value: "bob",
          expiresAt: at(-DAY),
        },
        // A window under way, and one not started.
        {
          detectionRuleId: RULE_B,
          kind: DetectionRuleExceptionKind.TimeWindow,
          startsAt: at(-HOUR),
          endsAt: at(HOUR),
        },
        {
          detectionRuleId: RULE_B,
          kind: DetectionRuleExceptionKind.TimeWindow,
          startsAt: at(HOUR),
          endsAt: at(2 * HOUR),
        },
        // No rule: nothing to count it under.
        { kind: DetectionRuleExceptionKind.Entity, value: "carol" },
      ],
      NOW,
    );

    expect(Array.from(counts.entries())).toEqual([
      [RULE_A, 2],
      [RULE_B, 1],
    ]);
  });

  test("an id read from a model counts under its text", () => {
    const counts: Map<string, number> = countActiveExceptionsByRule(
      [
        {
          detectionRuleId: {
            toString: (): string => {
              return RULE_A;
            },
          },
          kind: DetectionRuleExceptionKind.Entity,
          value: "alice",
        },
      ],
      NOW,
    );

    expect(counts.get(RULE_A)).toBe(1);
  });
});

describe("the entity a case's detection is about", () => {
  const entities: Array<SecurityEntity> = [
    { type: SecurityEntityType.Domain, value: "evil.example" },
    { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    { type: SecurityEntityType.User, value: "Alice" },
  ];

  test("the one the rule grouped it by, whatever the case", () => {
    expect(
      getDetectionExceptionEntity({ groupValue: " alice ", entities }),
    ).toEqual({ type: SecurityEntityType.User, value: "Alice" });
  });

  test("else the first user, host or address it names", () => {
    expect(
      getDetectionExceptionEntity({ groupValue: "nothing-named", entities }),
    ).toEqual({ type: SecurityEntityType.IpAddress, value: "203.0.113.7" });
    expect(getDetectionExceptionEntity({ groupValue: null, entities })).toEqual(
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    );
  });

  test("none when it names none an exception can skip", () => {
    expect(
      getDetectionExceptionEntity({
        groupValue: "evil.example",
        entities: [
          { type: SecurityEntityType.Domain, value: "evil.example" },
          { type: SecurityEntityType.User, value: "  " },
        ],
      }),
    ).toBeNull();
  });
});

describe("what Add Exception starts with", () => {
  test("from Rule Exceptions: an entity of the first kind, to fill in", () => {
    expect(getRuleExceptionInitialValues({})).toEqual({
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
    });
  });

  test("from a rule's row: the rule, in the form's rule dropdown", () => {
    expect(getRuleExceptionInitialValues({ detectionRuleId: RULE_A })).toEqual({
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
      detectionRule: RULE_A,
    });
  });

  test("from a case's detection: the rule and the entity it is about", () => {
    expect(
      getRuleExceptionInitialValues({
        detectionRuleId: RULE_A,
        entity: { type: SecurityEntityType.Host, value: " web-01 " },
      }),
    ).toEqual({
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.Host,
      detectionRule: RULE_A,
      value: "web-01",
    });
  });
});

describe("where a rule's View Exceptions lands", () => {
  test("the list's own Rule filter, in the address its table reads", () => {
    const params: Dictionary<string> = getRuleExceptionsFilterParams(RULE_A);
    const name: string = `${RULE_EXCEPTIONS_TABLE_ID}-filter`;

    expect(Object.keys(params)).toEqual([name]);
    expect(
      JSONFunctions.deserialize(
        JSONFunctions.parseJSONObject(decodeURIComponent(params[name]!)),
      ),
    ).toEqual({ [RULE_EXCEPTIONS_RULE_FILTER_KEY]: RULE_A });
  });

  test("the filter is on the exception's rule id, and the table is the page's", () => {
    expect(RULE_EXCEPTIONS_RULE_FILTER_KEY).toBe("detectionRuleId");
    expect(RULE_EXCEPTIONS_TABLE_ID).toBe("rule-exceptions-table");
  });
});

describe("the one rule the list is narrowed to", () => {
  test("its Rule filter set to one rule, from View Exceptions or by hand", () => {
    expect(
      getRuleExceptionsFilteredRuleId({
        projectId: "p",
        [RULE_EXCEPTIONS_RULE_FILTER_KEY]: RULE_A,
      }),
    ).toBe(RULE_A);
    expect(
      getRuleExceptionsFilteredRuleId({
        [RULE_EXCEPTIONS_RULE_FILTER_KEY]: new ObjectID(RULE_B),
      }),
    ).toBe(RULE_B);
  });

  test("no one rule: no filter, another rule's absence, or none at all", () => {
    expect(getRuleExceptionsFilteredRuleId(null)).toBeNull();
    expect(getRuleExceptionsFilteredRuleId({ projectId: "p" })).toBeNull();
    expect(
      getRuleExceptionsFilteredRuleId({
        [RULE_EXCEPTIONS_RULE_FILTER_KEY]: "  ",
      }),
    ).toBeNull();
    expect(
      getRuleExceptionsFilteredRuleId({
        [RULE_EXCEPTIONS_RULE_FILTER_KEY]: new IncludesNone([RULE_A]),
      }),
    ).toBeNull();
    expect(
      getRuleExceptionsFilteredRuleId({
        [RULE_EXCEPTIONS_RULE_FILTER_KEY]: new IsNull(),
      }),
    ).toBeNull();
    expect(
      getRuleExceptionsFilteredRuleId({
        [RULE_EXCEPTIONS_RULE_FILTER_KEY]: [RULE_A, RULE_B],
      }),
    ).toBeNull();
  });
});
