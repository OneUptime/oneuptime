import { describe, expect, test } from "@jest/globals";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import {
  SECURITY_EVENT_ENTITY_FIELDS,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RULE_EXCEPTION_ENTITY_FIELDS,
  DETECTION_RULE_EXCEPTION_ENTITY_TYPES,
  DETECTION_RULE_EXCEPTION_FIELD_MAX_LENGTH,
  DETECTION_RULE_EXCEPTION_KINDS,
  DETECTION_RULE_EXCEPTION_REASON_MAX_LENGTH,
  DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH,
  DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS,
  DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX,
  DetectionRuleExceptionColumns,
  DetectionRuleExceptionFormField,
  DetectionRuleExceptionKind,
  DetectionRuleExceptionProblem,
  DetectionRuleExceptionShape,
  DetectionRuleExceptionStatus,
  doesDetectionRuleExceptionApply,
  getDetectionRuleExceptionColumns,
  getDetectionRuleExceptionFieldProblem,
  getDetectionRuleExceptionProblem,
  getDetectionRuleExceptionProblems,
  getDetectionRuleExceptionStatus,
  isDetectionRuleExceptionCidr,
  isDetectionRuleExceptionEntityType,
  isDetectionRuleExceptionKind,
  normalizeDetectionRuleExceptionField,
  normalizeDetectionRuleExceptionValue,
  readDetectionRuleExceptionDate,
} from "../../../Types/SecurityEvent/DetectionRuleException";

/*
 * DETECTION RULE EXCEPTIONS: WHAT A RULE SKIPS, AND WHEN.
 *
 * The rules the form, the list, the API and a rule's runs share: which
 * kinds and entities there are, how a value is written down, when an
 * exception stands where, whether it takes part in a read of past events,
 * what is wrong with one (field by field, in the words the form shows), and
 * which columns a row of each kind keeps.
 */

const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function at(offsetInMs: number): Date {
  return new Date(NOW.getTime() + offsetInMs);
}

const CREATE: { now: Date; isExpiryNew: boolean } = {
  now: NOW,
  isExpiryNew: true,
};

function entity(
  overrides: Partial<DetectionRuleExceptionShape> = {},
): DetectionRuleExceptionShape {
  return {
    kind: DetectionRuleExceptionKind.Entity,
    entityType: SecurityEntityType.User,
    value: "svc-backup",
    reason: "The nightly backup job signs in from every host.",
    ...overrides,
  };
}

function valueException(
  overrides: Partial<DetectionRuleExceptionShape> = {},
): DetectionRuleExceptionShape {
  return {
    kind: DetectionRuleExceptionKind.Value,
    fieldName: "processName",
    value: "backup.exe",
    reason: "The backup agent.",
    ...overrides,
  };
}

function windowException(
  overrides: Partial<DetectionRuleExceptionShape> = {},
): DetectionRuleExceptionShape {
  return {
    kind: DetectionRuleExceptionKind.TimeWindow,
    startsAt: at(HOUR),
    endsAt: at(3 * HOUR),
    reason: "The planned penetration test.",
    ...overrides,
  };
}

function fieldsWithProblems(
  exception: DetectionRuleExceptionShape,
  options: { now: Date; isExpiryNew: boolean } = CREATE,
): Array<DetectionRuleExceptionFormField> {
  return getDetectionRuleExceptionProblems(exception, options).map(
    (
      problem: DetectionRuleExceptionProblem,
    ): DetectionRuleExceptionFormField => {
      return problem.field;
    },
  );
}

describe("what a rule can skip", () => {
  test("an entity, a value or a time window, in the order the form offers them", () => {
    expect(DETECTION_RULE_EXCEPTION_KINDS).toEqual([
      DetectionRuleExceptionKind.Entity,
      DetectionRuleExceptionKind.Value,
      DetectionRuleExceptionKind.TimeWindow,
    ]);
    expect(DetectionRuleExceptionKind.TimeWindow).toBe("Time Window");
  });

  test("an entity is a user, a host or an IP address: what a detection is about", () => {
    expect(DETECTION_RULE_EXCEPTION_ENTITY_TYPES).toEqual([
      SecurityEntityType.User,
      SecurityEntityType.Host,
      SecurityEntityType.IpAddress,
    ]);
  });

  test("an entity is read from who acted and who was acted on, each a typed column of its own kind", () => {
    expect(DETECTION_RULE_EXCEPTION_ENTITY_FIELDS).toEqual({
      [SecurityEntityType.User]: ["principalUser", "targetUser"],
      [SecurityEntityType.Host]: ["principalHost", "targetHost"],
      [SecurityEntityType.IpAddress]: ["principalIp", "targetIp"],
    });

    // Each field is the security event's own column of that entity kind.
    for (const type of DETECTION_RULE_EXCEPTION_ENTITY_TYPES) {
      for (const field of DETECTION_RULE_EXCEPTION_ENTITY_FIELDS[type]!) {
        expect(SECURITY_EVENT_ENTITY_FIELDS[field]).toBe(type);
      }
    }
  });

  test("the kind and entity type checks accept only the shared values", () => {
    for (const kind of DETECTION_RULE_EXCEPTION_KINDS) {
      expect(isDetectionRuleExceptionKind(kind)).toBe(true);
    }

    expect(isDetectionRuleExceptionKind("entity")).toBe(false);
    expect(isDetectionRuleExceptionKind("")).toBe(false);
    expect(isDetectionRuleExceptionKind(undefined)).toBe(false);
    expect(isDetectionRuleExceptionKind(3)).toBe(false);

    expect(isDetectionRuleExceptionEntityType(SecurityEntityType.Host)).toBe(
      true,
    );
    expect(isDetectionRuleExceptionEntityType(SecurityEntityType.Domain)).toBe(
      false,
    );
    expect(isDetectionRuleExceptionEntityType("Process")).toBe(false);
    expect(isDetectionRuleExceptionEntityType(null)).toBe(false);
  });

  test("the limits are the columns' own widths, so a value that passes the check is one the row holds", () => {
    const model: DetectionRuleException = new DetectionRuleException();

    expect(
      getMaxLengthFromTableColumnType(
        model.getTableColumnMetadata("value").type,
      ),
    ).toBe(DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH);
    expect(
      getMaxLengthFromTableColumnType(
        model.getTableColumnMetadata("reason").type,
      ),
    ).toBe(DETECTION_RULE_EXCEPTION_REASON_MAX_LENGTH);
    expect(
      getMaxLengthFromTableColumnType(
        model.getTableColumnMetadata("fieldName").type,
      ),
    ).toBe(DETECTION_RULE_EXCEPTION_FIELD_MAX_LENGTH);
  });

  test("a rule keeps at most 100 exceptions, and a window lasts at most 30 days", () => {
    expect(DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX).toBe(100);
    expect(DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS).toBe(30);
  });
});

describe("how a value is written down", () => {
  test("a value is trimmed, and a run of wildcards is one", () => {
    expect(normalizeDetectionRuleExceptionValue("  svc-backup  ")).toBe(
      "svc-backup",
    );
    expect(normalizeDetectionRuleExceptionValue("svc-***")).toBe("svc-*");
    expect(normalizeDetectionRuleExceptionValue("**.corp.example.com")).toBe(
      "*.corp.example.com",
    );
    expect(normalizeDetectionRuleExceptionValue("a**b***c")).toBe("a*b*c");
  });

  test("anything but text is no value", () => {
    expect(normalizeDetectionRuleExceptionValue(undefined)).toBe("");
    expect(normalizeDetectionRuleExceptionValue(null)).toBe("");
    expect(normalizeDetectionRuleExceptionValue(42)).toBe("");
    expect(normalizeDetectionRuleExceptionField(" processName ")).toBe(
      "processName",
    );
    expect(normalizeDetectionRuleExceptionField({})).toBe("");
  });

  test("a Windows path keeps its backslashes", () => {
    expect(
      normalizeDetectionRuleExceptionValue("C:\\Program Files\\Backup\\*"),
    ).toBe("C:\\Program Files\\Backup\\*");
  });

  test("a date is a Date or text one parses from; anything else is none", () => {
    expect(readDetectionRuleExceptionDate(NOW)).toBe(NOW);
    expect(
      readDetectionRuleExceptionDate("2026-10-27T12:00:00.000Z")?.getTime(),
    ).toBe(NOW.getTime());
    expect(readDetectionRuleExceptionDate("not a date")).toBeNull();
    expect(readDetectionRuleExceptionDate(new Date("nope"))).toBeNull();
    expect(readDetectionRuleExceptionDate("   ")).toBeNull();
    expect(readDetectionRuleExceptionDate(1730000000000)).toBeNull();
    expect(readDetectionRuleExceptionDate(undefined)).toBeNull();
  });
});

describe("an address range", () => {
  test.each([
    ["10.20.0.0/16", true],
    ["10.20.0.0/0", true],
    ["10.20.0.0/32", true],
    ["2001:db8::/32", true],
    ["fe80::/128", true],
    [" 10.0.0.0/8 ", true],
  ])("%s is a range", (value: string, isRange: boolean) => {
    expect(isDetectionRuleExceptionCidr(value)).toBe(isRange);
  });

  test.each([
    ["10.20.0.0/33"],
    ["2001:db8::/129"],
    ["10.20.0.0"],
    ["10.20.0.0/"],
    ["/16"],
    ["10.20.0.0/16/2"],
    ["10.20.0.0/1a"],
    ["10.20.0.0/1234"],
    ["web-01/16"],
    [""],
  ])("%s is not", (value: string) => {
    expect(isDetectionRuleExceptionCidr(value)).toBe(false);
  });
});

describe("where an exception stands", () => {
  test("an entity or a value with no expiry is active for good", () => {
    expect(getDetectionRuleExceptionStatus(entity(), NOW)).toBe(
      DetectionRuleExceptionStatus.Active,
    );
    expect(
      getDetectionRuleExceptionStatus(valueException(), at(400 * DAY)),
    ).toBe(DetectionRuleExceptionStatus.Active);
  });

  test("one with an expiry is active until it, and expired from it on", () => {
    const expiring: DetectionRuleExceptionShape = entity({
      expiresAt: at(DAY),
    });

    expect(getDetectionRuleExceptionStatus(expiring, NOW)).toBe(
      DetectionRuleExceptionStatus.Active,
    );
    expect(getDetectionRuleExceptionStatus(expiring, at(DAY - 1))).toBe(
      DetectionRuleExceptionStatus.Active,
    );
    expect(getDetectionRuleExceptionStatus(expiring, at(DAY))).toBe(
      DetectionRuleExceptionStatus.Expired,
    );
  });

  test("a window is upcoming before it starts, active while it runs and ended after", () => {
    const window: DetectionRuleExceptionShape = windowException();

    expect(getDetectionRuleExceptionStatus(window, NOW)).toBe(
      DetectionRuleExceptionStatus.Upcoming,
    );
    expect(getDetectionRuleExceptionStatus(window, at(HOUR))).toBe(
      DetectionRuleExceptionStatus.Active,
    );
    expect(getDetectionRuleExceptionStatus(window, at(3 * HOUR - 1))).toBe(
      DetectionRuleExceptionStatus.Active,
    );
    expect(getDetectionRuleExceptionStatus(window, at(3 * HOUR))).toBe(
      DetectionRuleExceptionStatus.Ended,
    );
  });

  test("a window's own expiry is never read: it ends by itself", () => {
    expect(
      getDetectionRuleExceptionStatus(
        windowException({ expiresAt: at(-DAY) }),
        at(2 * HOUR),
      ),
    ).toBe(DetectionRuleExceptionStatus.Active);
  });

  test("dates stored as text read the same", () => {
    expect(
      getDetectionRuleExceptionStatus(
        entity({ expiresAt: at(-HOUR).toISOString() }),
        NOW,
      ),
    ).toBe(DetectionRuleExceptionStatus.Expired);
  });
});

describe("whether an exception takes part in a read of events", () => {
  const read: { from: Date; until: Date; now: Date } = {
    from: at(-DAY),
    until: NOW,
    now: NOW,
  };

  test("an entity or a value takes part while it has not expired", () => {
    expect(doesDetectionRuleExceptionApply(entity(), read)).toBe(true);
    expect(
      doesDetectionRuleExceptionApply(entity({ expiresAt: at(HOUR) }), read),
    ).toBe(true);
    expect(
      doesDetectionRuleExceptionApply(entity({ expiresAt: at(-HOUR) }), read),
    ).toBe(false);
  });

  test("an expiry is read at the time of the read, not at the events' time", () => {
    // Expired an hour ago: last week's events are seen again too.
    expect(
      doesDetectionRuleExceptionApply(entity({ expiresAt: at(-HOUR) }), {
        from: at(-7 * DAY),
        until: at(-6 * DAY),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a window takes part when it overlaps the read, whenever the read is made", () => {
    const lastWeek: DetectionRuleExceptionShape = windowException({
      startsAt: at(-7 * DAY),
      endsAt: at(-7 * DAY + 2 * HOUR),
    });

    // A run on last week's events skips last week's planned test...
    expect(
      doesDetectionRuleExceptionApply(lastWeek, {
        from: at(-8 * DAY),
        until: NOW,
        now: NOW,
      }),
    ).toBe(true);

    // ...and a read of yesterday does not.
    expect(doesDetectionRuleExceptionApply(lastWeek, read)).toBe(false);
  });

  test("a window touching the read at one end only does not overlap it", () => {
    expect(
      doesDetectionRuleExceptionApply(
        windowException({ startsAt: at(-2 * DAY), endsAt: at(-DAY) }),
        read,
      ),
    ).toBe(false);
    expect(
      doesDetectionRuleExceptionApply(
        windowException({ startsAt: NOW, endsAt: at(HOUR) }),
        read,
      ),
    ).toBe(false);
    expect(
      doesDetectionRuleExceptionApply(
        windowException({ startsAt: at(-DAY - HOUR), endsAt: at(-DAY + 1) }),
        read,
      ),
    ).toBe(true);
  });

  test("a row no check would let through takes part in nothing", () => {
    expect(
      doesDetectionRuleExceptionApply({ kind: "Something else" }, read),
    ).toBe(false);
    expect(
      doesDetectionRuleExceptionApply(
        windowException({ startsAt: undefined }),
        read,
      ),
    ).toBe(false);
    expect(
      doesDetectionRuleExceptionApply(
        windowException({ startsAt: at(-HOUR), endsAt: at(-2 * HOUR) }),
        read,
      ),
    ).toBe(false);
  });
});

describe("what is wrong with an exception, field by field", () => {
  test("a complete one of every kind has no problem", () => {
    expect(getDetectionRuleExceptionProblems(entity(), CREATE)).toEqual([]);
    expect(getDetectionRuleExceptionProblems(valueException(), CREATE)).toEqual(
      [],
    );
    expect(
      getDetectionRuleExceptionProblems(windowException(), CREATE),
    ).toEqual([]);
    expect(
      getDetectionRuleExceptionProblem(
        entity({
          entityType: SecurityEntityType.IpAddress,
          value: "10.0.0.0/8",
        }),
        CREATE,
      ),
    ).toBeNull();
    expect(
      getDetectionRuleExceptionProblem(
        entity({ expiresAt: at(30 * DAY) }),
        CREATE,
      ),
    ).toBeNull();
  });

  test("no kind: choose one, and the reason is still asked for", () => {
    expect(getDetectionRuleExceptionProblems({ kind: "Nope" }, CREATE)).toEqual(
      [
        {
          field: "kind",
          message:
            "Choose what the rule skips: an entity, a value or a time window.",
        },
        {
          field: "reason",
          message: "Say why it is safe for the rule to skip this.",
        },
      ],
    );
  });

  test("an entity needs its type and its value", () => {
    expect(
      getDetectionRuleExceptionProblems(
        entity({ entityType: SecurityEntityType.Domain, value: "  " }),
        CREATE,
      ),
    ).toEqual([
      {
        field: "entityType",
        message: "Choose the kind of entity: a user, a host or an IP address.",
      },
      {
        field: "value",
        message: "Enter the user, host or address the rule skips.",
      },
    ]);
  });

  test("a lone * would skip everything: that is turning the rule off", () => {
    for (const value of ["*", " ** ", "***"]) {
      expect(
        getDetectionRuleExceptionFieldProblem(
          entity({ value }),
          "value",
          CREATE,
        ),
      ).toBe(
        "A value of only * would skip everything. To stop the rule, turn it off.",
      );
      expect(
        getDetectionRuleExceptionFieldProblem(
          valueException({ value }),
          "value",
          CREATE,
        ),
      ).toBe(
        "A value of only * would skip everything. To stop the rule, turn it off.",
      );
    }

    // A pattern with something besides the star is fine.
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ value: "svc-*" }),
        "value",
        CREATE,
      ),
    ).toBeNull();
  });

  test("a value is at most 500 characters, and the message says the number it checks", () => {
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({
          value: "a".repeat(DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH),
        }),
        "value",
        CREATE,
      ),
    ).toBeNull();

    const message: string | null = getDetectionRuleExceptionFieldProblem(
      entity({
        value: "a".repeat(DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH + 1),
      }),
      "value",
      CREATE,
    );

    expect(message).toBe(
      `A value is at most ${DETECTION_RULE_EXCEPTION_VALUE_MAX_LENGTH} characters.`,
    );
  });

  test("an address with a slash must be a range", () => {
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({
          entityType: SecurityEntityType.IpAddress,
          value: "10.0.0.0/40",
        }),
        "value",
        CREATE,
      ),
    ).toBe(
      "Enter an address, a range such as 10.20.0.0/16, or a pattern with *.",
    );

    // A slash in a user or a host is just a character.
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ value: "corp/alice" }),
        "value",
        CREATE,
      ),
    ).toBeNull();

    // An address pattern without a slash is fine.
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ entityType: SecurityEntityType.IpAddress, value: "10.20.*" }),
        "value",
        CREATE,
      ),
    ).toBeNull();
  });

  test("a value needs its field: named, short and with no spaces", () => {
    expect(
      getDetectionRuleExceptionFieldProblem(
        valueException({ fieldName: " " }),
        "fieldName",
        CREATE,
      ),
    ).toBe("Enter the event field to match, such as processName.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        valueException({
          fieldName: "f".repeat(DETECTION_RULE_EXCEPTION_FIELD_MAX_LENGTH + 1),
        }),
        "fieldName",
        CREATE,
      ),
    ).toBe(
      `A field name is at most ${DETECTION_RULE_EXCEPTION_FIELD_MAX_LENGTH} characters.`,
    );
    expect(
      getDetectionRuleExceptionFieldProblem(
        valueException({ fieldName: "process name" }),
        "fieldName",
        CREATE,
      ),
    ).toBe(
      "A field name has no spaces: principalUser, processName or an attribute key such as http.user_agent.",
    );
    expect(
      getDetectionRuleExceptionFieldProblem(
        valueException({ fieldName: "user.name" }),
        "fieldName",
        CREATE,
      ),
    ).toBeNull();
    expect(
      getDetectionRuleExceptionFieldProblem(
        valueException({ value: "" }),
        "value",
        CREATE,
      ),
    ).toBe("Enter the value the rule skips.");
  });

  test("a window needs both its times, in order, at most 30 days apart", () => {
    expect(
      fieldsWithProblems(
        windowException({ startsAt: undefined, endsAt: undefined }),
      ),
    ).toEqual(["startsAt", "endsAt"]);
    expect(
      getDetectionRuleExceptionFieldProblem(
        windowException({ startsAt: undefined }),
        "startsAt",
        CREATE,
      ),
    ).toBe("Enter when the window starts.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        windowException({ endsAt: "nope" }),
        "endsAt",
        CREATE,
      ),
    ).toBe("Enter when the window ends.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        windowException({ startsAt: at(HOUR), endsAt: at(HOUR) }),
        "endsAt",
        CREATE,
      ),
    ).toBe("The window must end after it starts.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        windowException({
          startsAt: NOW,
          endsAt: at(DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS * DAY),
        }),
        "endsAt",
        CREATE,
      ),
    ).toBeNull();
    expect(
      getDetectionRuleExceptionFieldProblem(
        windowException({
          startsAt: NOW,
          endsAt: at(DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS * DAY + 1),
        }),
        "endsAt",
        CREATE,
      ),
    ).toBe(
      `A window is at most ${DETECTION_RULE_EXCEPTION_WINDOW_MAX_IN_DAYS} days. To stop a rule for longer, turn it off.`,
    );
  });

  test("a window in the past is fine: it documents what was skipped", () => {
    expect(
      getDetectionRuleExceptionProblems(
        windowException({ startsAt: at(-3 * DAY), endsAt: at(-2 * DAY) }),
        CREATE,
      ),
    ).toEqual([]);
  });

  test("a new exception's expiry must be ahead", () => {
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ expiresAt: at(-1) }),
        "expiresAt",
        CREATE,
      ),
    ).toBe("An exception expires in the future. To stop one now, delete it.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ expiresAt: NOW }),
        "expiresAt",
        CREATE,
      ),
    ).toBe("An exception expires in the future. To stop one now, delete it.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ expiresAt: "tomorrow-ish" }),
        "expiresAt",
        CREATE,
      ),
    ).toBe("Enter when the exception expires, or leave it empty.");
  });

  test("an expiry that is not new is not checked: an expired exception's reason can still be edited", () => {
    expect(
      getDetectionRuleExceptionProblems(entity({ expiresAt: at(-DAY) }), {
        now: NOW,
        isExpiryNew: false,
      }),
    ).toEqual([]);
  });

  test("a window has no expiry to check", () => {
    expect(
      getDetectionRuleExceptionProblems(
        windowException({ expiresAt: at(-DAY) }),
        CREATE,
      ),
    ).toEqual([]);
  });

  test("every exception says why it is safe to skip, in at most 500 characters", () => {
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ reason: "   " }),
        "reason",
        CREATE,
      ),
    ).toBe("Say why it is safe for the rule to skip this.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        windowException({ reason: undefined }),
        "reason",
        CREATE,
      ),
    ).toBe("Say why it is safe for the rule to skip this.");
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({
          reason: "r".repeat(DETECTION_RULE_EXCEPTION_REASON_MAX_LENGTH + 1),
        }),
        "reason",
        CREATE,
      ),
    ).toBe(
      `A reason is at most ${DETECTION_RULE_EXCEPTION_REASON_MAX_LENGTH} characters.`,
    );
  });

  test("the API's answer is the first problem in the form's order", () => {
    expect(
      getDetectionRuleExceptionProblem(
        entity({ value: "", reason: "", expiresAt: at(-DAY) }),
        CREATE,
      ),
    ).toBe("Enter the user, host or address the rule skips.");
    expect(
      fieldsWithProblems(
        entity({ value: "", reason: "", expiresAt: at(-DAY) }),
      ),
    ).toEqual(["value", "expiresAt", "reason"]);
  });

  test("a field asked about with no problem answers null", () => {
    expect(
      getDetectionRuleExceptionFieldProblem(entity(), "value", CREATE),
    ).toBeNull();
    expect(
      getDetectionRuleExceptionFieldProblem(
        entity({ value: "" }),
        "reason",
        CREATE,
      ),
    ).toBeNull();
  });
});

describe("what a row of each kind keeps", () => {
  test("an entity keeps its type, value and expiry, normalized; the rest is cleared", () => {
    const columns: DetectionRuleExceptionColumns =
      getDetectionRuleExceptionColumns(
        entity({
          value: "  svc-** ",
          fieldName: "processName",
          startsAt: NOW,
          endsAt: at(HOUR),
          expiresAt: at(DAY).toISOString(),
          reason: "  Backups.  ",
        }),
      );

    expect(columns).toEqual({
      entityType: SecurityEntityType.User,
      fieldName: null,
      value: "svc-*",
      startsAt: null,
      endsAt: null,
      expiresAt: at(DAY),
      reason: "Backups.",
    });
  });

  test("a value keeps its field and value; an entity type it no longer is goes", () => {
    expect(
      getDetectionRuleExceptionColumns(
        valueException({
          entityType: SecurityEntityType.Host,
          fieldName: " processName ",
        }),
      ),
    ).toEqual({
      entityType: null,
      fieldName: "processName",
      value: "backup.exe",
      startsAt: null,
      endsAt: null,
      expiresAt: null,
      reason: "The backup agent.",
    });
  });

  test("a window keeps its times only: no value, and no expiry", () => {
    expect(
      getDetectionRuleExceptionColumns(
        windowException({
          entityType: SecurityEntityType.User,
          value: "alice",
          fieldName: "processName",
          expiresAt: at(DAY),
        }),
      ),
    ).toEqual({
      entityType: null,
      fieldName: null,
      value: null,
      startsAt: at(HOUR),
      endsAt: at(3 * HOUR),
      expiresAt: null,
      reason: "The planned penetration test.",
    });
  });
});
