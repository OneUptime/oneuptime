import { describe, expect, test } from "@jest/globals";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import OnCallRuleKind, {
  DEFAULT_ON_CALL_RULE_KIND,
  MOVED_ON_CALL_RULES_PATHS,
  ON_CALL_RULE_KINDS,
  ON_CALL_RULE_KIND_QUERY_PARAM,
  ON_CALL_RULES_PAGE_PATH,
  getOnCallRuleKindForRuleType,
  getOnCallRuleKindQuery,
  getOnCallRuleKindQueryForRuleType,
  getRuleTypeForOnCallRuleKind,
  readOnCallRuleKind,
} from "../../../Types/NotificationRule/OnCallRuleKind";

/*
 * A person's on-call rules are one On-Call Rules page with a tab per kind,
 * and the open tab is in the address. These names are in links the server
 * has already mailed and in bookmarks, so they are pinned here as literals:
 * renaming one is a breaking change to every link that carries it.
 */

describe("the four kinds", () => {
  test("are the tabs, in order, with the values the address carries", () => {
    expect([...ON_CALL_RULE_KINDS]).toEqual([
      "incidents",
      "incident-episodes",
      "alerts",
      "alert-episodes",
    ]);
  });

  test("a bare address opens the first one, Incidents", () => {
    expect(DEFAULT_ON_CALL_RULE_KIND).toBe(OnCallRuleKind.Incidents);
    expect(ON_CALL_RULE_KINDS[0]).toBe(DEFAULT_ON_CALL_RULE_KIND);
  });

  test("the page and the parameter are spelled the way links spell them", () => {
    expect(ON_CALL_RULES_PAGE_PATH).toBe("on-call-rules");
    expect(ON_CALL_RULE_KIND_QUERY_PARAM).toBe("type");
  });
});

describe("rule types and kinds", () => {
  const PAIRS: Array<[OnCallRuleKind, NotificationRuleType]> = [
    [OnCallRuleKind.Incidents, NotificationRuleType.ON_CALL_EXECUTED_INCIDENT],
    [
      OnCallRuleKind.IncidentEpisodes,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    ],
    [OnCallRuleKind.Alerts, NotificationRuleType.ON_CALL_EXECUTED_ALERT],
    [
      OnCallRuleKind.AlertEpisodes,
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    ],
  ];

  test.each(PAIRS)(
    "the %s tab holds rules of type %s, and back",
    (kind: OnCallRuleKind, ruleType: NotificationRuleType) => {
      expect(getRuleTypeForOnCallRuleKind(kind)).toBe(ruleType);
      expect(getOnCallRuleKindForRuleType(ruleType)).toBe(kind);
    },
  );

  test("every kind has its own rule type", () => {
    const ruleTypes: Array<NotificationRuleType> = ON_CALL_RULE_KINDS.map(
      (kind: OnCallRuleKind): NotificationRuleType => {
        return getRuleTypeForOnCallRuleKind(kind);
      },
    );

    expect(new Set(ruleTypes).size).toBe(ON_CALL_RULE_KINDS.length);
  });

  /*
   * "When I go on call" and "when I go off call" are not paged for an event
   * and have no tab; a link about one opens the page as its bare address
   * does.
   */
  test.each([
    NotificationRuleType.WHEN_USER_GOES_ON_CALL,
    NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
  ])("a %s rule opens the first tab", (ruleType: NotificationRuleType) => {
    expect(getOnCallRuleKindForRuleType(ruleType)).toBe(
      OnCallRuleKind.Incidents,
    );
  });

  test("a rule type this build does not know opens the first tab too", () => {
    expect(
      getOnCallRuleKindForRuleType("Something new" as NotificationRuleType),
    ).toBe(OnCallRuleKind.Incidents);
  });
});

describe("reading the address", () => {
  test.each([
    ["incidents", OnCallRuleKind.Incidents],
    ["incident-episodes", OnCallRuleKind.IncidentEpisodes],
    ["alerts", OnCallRuleKind.Alerts],
    ["alert-episodes", OnCallRuleKind.AlertEpisodes],
  ])("?type=%s opens its tab", (value: string, kind: OnCallRuleKind) => {
    expect(readOnCallRuleKind(value)).toBe(kind);
  });

  test("case and surrounding spaces are forgiven", () => {
    expect(readOnCallRuleKind("Alerts")).toBe(OnCallRuleKind.Alerts);
    expect(readOnCallRuleKind("  ALERT-EPISODES ")).toBe(
      OnCallRuleKind.AlertEpisodes,
    );
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["alert"],
    ["incident"],
    ["episodes"],
    ["alerts,incidents"],
    ["When alert on-call policy is executed"],
  ])("%p asks for no tab we have", (value: string | null | undefined) => {
    expect(readOnCallRuleKind(value)).toBeNull();
  });

  test("a value that is not a string asks for nothing", () => {
    expect(readOnCallRuleKind(42 as unknown as string)).toBeNull();
    expect(readOnCallRuleKind({} as unknown as string)).toBeNull();
  });
});

describe("the query that opens a tab", () => {
  test("names the kind under `type`", () => {
    expect(getOnCallRuleKindQuery(OnCallRuleKind.AlertEpisodes)).toEqual({
      type: "alert-episodes",
    });
  });

  test("for a rule type, names the tab that holds it", () => {
    expect(
      getOnCallRuleKindQueryForRuleType(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      ),
    ).toEqual({ type: "incident-episodes" });
    expect(
      getOnCallRuleKindQueryForRuleType(
        NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
      ),
    ).toEqual({ type: "incidents" });
  });

  test("reads back as the same kind", () => {
    for (const kind of ON_CALL_RULE_KINDS) {
      const query: Record<string, string> = getOnCallRuleKindQuery(kind);

      expect(readOnCallRuleKind(query[ON_CALL_RULE_KIND_QUERY_PARAM])).toBe(
        kind,
      );
    }
  });
});

describe("the four pages the tabs replaced", () => {
  test("each old address forwards to the tab it was", () => {
    expect(MOVED_ON_CALL_RULES_PATHS).toEqual({
      "incident-on-call-rules": OnCallRuleKind.Incidents,
      "incident-episode-on-call-rules": OnCallRuleKind.IncidentEpisodes,
      "alert-on-call-rules": OnCallRuleKind.Alerts,
      "alert-episode-on-call-rules": OnCallRuleKind.AlertEpisodes,
    });
  });

  test("every tab had exactly one page", () => {
    const kinds: Array<OnCallRuleKind> = Object.values(
      MOVED_ON_CALL_RULES_PATHS,
    );

    expect([...kinds].sort()).toEqual([...ON_CALL_RULE_KINDS].sort());
  });

  test("no old address is the new page's own", () => {
    expect(Object.keys(MOVED_ON_CALL_RULES_PATHS)).not.toContain(
      ON_CALL_RULES_PAGE_PATH,
    );
  });
});
