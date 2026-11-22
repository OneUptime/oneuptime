import { describe, expect, test } from "@jest/globals";
import ScrubAction from "../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../Server/Utils/Telemetry/ScrubHashToken";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  ACTIONABLE_ENTITY_TYPES,
  SecurityEntityType,
  canActOnSecurityEntity,
  entitiesFromObservables,
  getEntityAsActionable,
  mergeSecurityEntities,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  ONEUPTIME_PRINCIPAL,
  getWorkflowPrincipal,
} from "../../../Types/SecurityEvent/OneUptimeActorPrincipal";

/*
 * WHAT A CASE HOLDS AS AN ENTITY (#10435, #10430). An entity is something a
 * response acts on - a user suspended, a host contained, an address
 * blocked - so what a scrub rule left of one is none: "[REDACTED]" and a
 * mask stand for everybody a rule hid at once, and are dropped; a Hash
 * token stands for one value no identity provider knows, and stays as
 * Other. A workflow and OneUptime itself are no person, so as a user they
 * are Other too. Every list of entities is merged through this
 * (mergeSecurityEntities), and every target is checked against it once
 * more (canActOnSecurityEntity).
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-00000000e0a1";
const WORKFLOW: string = getWorkflowPrincipal(
  "0192f1a0-0000-7000-8000-00000000e0a2",
);

function left(
  match: string,
  patternType: LogScrubPatternType,
): {
  redacted: string;
  masked: string;
  hashed: string;
} {
  const apply: (action: LogScrubAction) => string = (
    action: LogScrubAction,
  ): string => {
    return ScrubAction.apply({
      match,
      action,
      patternType,
      projectId: PROJECT_ID,
    });
  };

  return {
    redacted: apply(LogScrubAction.Redact),
    masked: apply(LogScrubAction.Mask),
    hashed: apply(LogScrubAction.Hash),
  };
}

describe("what a scrub rule left of a user, a host or an address", () => {
  const user: { redacted: string; masked: string; hashed: string } = left(
    "jane@example.com",
    LogScrubPatternType.Email,
  );
  const address: { redacted: string; masked: string; hashed: string } = left(
    "203.0.113.7",
    LogScrubPatternType.IPAddress,
  );

  test.each(ACTIONABLE_ENTITY_TYPES)(
    "Redact's and Mask's are no %s at all",
    (type: SecurityEntityType) => {
      for (const value of [
        user.redacted,
        user.masked,
        address.masked,
        "auth0|[REDACTED]",
      ]) {
        expect([value, getEntityAsActionable({ type, value })]).toEqual([
          value,
          null,
        ]);
        expect(canActOnSecurityEntity({ type, value })).toBe(false);
      }
    },
  );

  test.each(ACTIONABLE_ENTITY_TYPES)(
    "a Hash token stays, as an Other no response acts on, not as a %s",
    (type: SecurityEntityType) => {
      for (const value of [user.hashed, address.hashed]) {
        expect(getEntityAsActionable({ type, value })).toEqual({
          type: SecurityEntityType.Other,
          value,
        });
        expect(canActOnSecurityEntity({ type, value })).toBe(false);
      }
    },
  );

  test("merged, the three users of a case read: none, none and one hidden one", () => {
    expect(
      mergeSecurityEntities([
        { type: SecurityEntityType.User, value: user.redacted },
        { type: SecurityEntityType.User, value: user.masked },
        { type: SecurityEntityType.User, value: user.hashed },
        { type: SecurityEntityType.User, value: "jane@example.com" },
      ]),
    ).toEqual([
      { type: SecurityEntityType.Other, value: user.hashed },
      { type: SecurityEntityType.User, value: "jane@example.com" },
    ]);
  });

  test("an observable a rule masked is not taken for an email, and so for a user", () => {
    expect(
      entitiesFromObservables([user.masked, user.redacted, "jane@example.com"]),
    ).toEqual([{ type: SecurityEntityType.User, value: "jane@example.com" }]);
  });

  test("text of other kinds keeps what a rule hid inside it, and loses only a bare [REDACTED]", () => {
    expect(
      mergeSecurityEntities([
        {
          type: SecurityEntityType.Process,
          value: "mysql -u app -p[REDACTED]",
        },
        { type: SecurityEntityType.Url, value: "https://x.test/?t=[REDACTED]" },
        { type: SecurityEntityType.Other, value: "[REDACTED]" },
        { type: SecurityEntityType.Process, value: "[REDACTED]" },
      ]),
    ).toEqual([
      {
        type: SecurityEntityType.Process,
        value: "mysql -u app -p[REDACTED]",
      },
      { type: SecurityEntityType.Url, value: "https://x.test/?t=[REDACTED]" },
    ]);
  });

  test("a token typed again later as a user stays Other", () => {
    const token: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "jane@example.com",
    });

    expect(
      mergeSecurityEntities(
        [{ type: SecurityEntityType.Other, value: token }],
        [{ type: SecurityEntityType.User, value: token }],
      ),
    ).toEqual([{ type: SecurityEntityType.Other, value: token }]);
  });
});

describe("OneUptime's own actors as a user", () => {
  test.each([WORKFLOW, ONEUPTIME_PRINCIPAL, "OneUptime"])(
    "%s is Other: no person to suspend",
    (value: string) => {
      expect(
        getEntityAsActionable({ type: SecurityEntityType.User, value }),
      ).toEqual({ type: SecurityEntityType.Other, value });
      expect(
        canActOnSecurityEntity({ type: SecurityEntityType.User, value }),
      ).toBe(false);
    },
  );

  test("merged after the user it was typed as, it stays Other", () => {
    expect(
      mergeSecurityEntities(
        [{ type: SecurityEntityType.User, value: WORKFLOW }],
        [{ type: SecurityEntityType.User, value: WORKFLOW }],
      ),
    ).toEqual([{ type: SecurityEntityType.Other, value: WORKFLOW }]);
  });

  test("a host named oneuptime is a host: only a user can be one of OneUptime's actors", () => {
    expect(
      canActOnSecurityEntity({
        type: SecurityEntityType.Host,
        value: ONEUPTIME_PRINCIPAL,
      }),
    ).toBe(true);
  });
});

describe("what every response acts on stays as it was", () => {
  test.each([
    [SecurityEntityType.User, "jane@example.com"],
    [SecurityEntityType.User, "CORP\\jane"],
    [SecurityEntityType.Host, "web-03"],
    [SecurityEntityType.IpAddress, "203.0.113.7"],
    [SecurityEntityType.Domain, "evil.example"],
    [
      SecurityEntityType.FileHash,
      "44d88612fea8a8f36de82e1278abb02f44d88612fea8a8f36de82e1278abb02f",
    ],
  ])("a %s %s", (type: SecurityEntityType, value: string) => {
    expect(getEntityAsActionable({ type, value })).toEqual({ type, value });
    expect(canActOnSecurityEntity({ type, value })).toBe(true);
  });

  test("an empty value is no entity", () => {
    expect(
      getEntityAsActionable({ type: SecurityEntityType.User, value: "  " }),
    ).toBeNull();
  });
});
