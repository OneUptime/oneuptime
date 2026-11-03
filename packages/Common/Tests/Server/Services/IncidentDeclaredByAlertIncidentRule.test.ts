import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentService from "../../../Server/Services/IncidentService";
import { getDeclaredFromAlertsMarkdown } from "../../../Server/Services/IncidentAlertService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import {
  ALERT_INCIDENT_RULE_KIND,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY,
} from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * AN INCIDENT AN ALERT INCIDENT RULE DECLARED SAYS WHICH RULE DID.
 *
 * The rule's engine creates the incident with the alert to link and the
 * rule's name in misc data (INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY).
 * IncidentService reads the name only off a root create that links alerts -
 * OneUptime's own engine - so an API request that sends it puts nothing on
 * the incident, and the incident's one "Declared from 1 alert" entry, the
 * one posted to its Slack and Microsoft Teams channels, is headed with the
 * rule.
 */

interface DeclaringRuleName {
  getDeclaringAlertIncidentRuleName: (data: {
    createBy: CreateBy<Incident>;
    alertIdsToLink: Array<ObjectID>;
  }) => string | null;
}

const service: DeclaringRuleName = IncidentService as unknown as DeclaringRuleName;

const ALERT_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-0000000000a1");

function createBy(data: {
  isRoot: boolean;
  miscDataProps?: JSONObject;
}): CreateBy<Incident> {
  return {
    data: new Incident(),
    miscDataProps: data.miscDataProps,
    props: data.isRoot
      ? { isRoot: true }
      : { userId: ObjectID.generate(), tenantId: ObjectID.generate() },
  } as CreateBy<Incident>;
}

const MENTION: {
  label: string;
  link: string;
  title: string;
  isPrivate: boolean;
} = {
  label: "Alert ALT-12",
  link: "https://oneuptime.example/dashboard/p/alerts/a",
  title: "Database CPU high",
  isPrivate: false,
};

describe("the rule an incident is declared by", () => {
  test("is read off OneUptime's own create that links alerts", () => {
    expect(
      service.getDeclaringAlertIncidentRuleName({
        createBy: createBy({
          isRoot: true,
          miscDataProps: {
            [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID.toString()],
            [INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY]: "  Critical alerts ",
          },
        }),
        alertIdsToLink: [ALERT_ID],
      }),
    ).toBe("Critical alerts");
  });

  test("is never read off a person's or an API key's request", () => {
    expect(
      service.getDeclaringAlertIncidentRuleName({
        createBy: createBy({
          isRoot: false,
          miscDataProps: {
            [INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY]: "Critical alerts",
          },
        }),
        alertIdsToLink: [ALERT_ID],
      }),
    ).toBeNull();
  });

  test("is nothing for an incident declared from no alert", () => {
    expect(
      service.getDeclaringAlertIncidentRuleName({
        createBy: createBy({
          isRoot: true,
          miscDataProps: {
            [INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY]: "Critical alerts",
          },
        }),
        alertIdsToLink: [],
      }),
    ).toBeNull();
  });

  test.each([
    ["no name", undefined],
    ["a blank name", "   "],
    ["a name that is not text", 42],
    ["a name that is an object", { name: "Critical alerts" }],
  ] as Array<[string, unknown]>)("is nothing for %s", (_name: string, value: unknown) => {
    expect(
      service.getDeclaringAlertIncidentRuleName({
        createBy: createBy({
          isRoot: true,
          miscDataProps:
            value === undefined
              ? {}
              : {
                  [INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY]:
                    value as never,
                },
        }),
        alertIdsToLink: [ALERT_ID],
      }),
    ).toBeNull();
  });
});

describe("the incident's Declared from 1 alert entry", () => {
  test("is headed with the rule that declared it", () => {
    const markdown: string = getDeclaredFromAlertsMarkdown([MENTION], {
      ruleName: "Critical alerts",
    });

    expect(markdown.split("\n\n")[0]).toBe(
      `🚨 **${ALERT_INCIDENT_RULE_KIND} executed:** **Critical alerts**`,
    );
    expect(markdown).toContain("🔗 Declared from 1 alert:");
    expect(markdown).toContain(
      "**[Alert ALT-12](https://oneuptime.example/dashboard/p/alerts/a)**: Database CPU high",
    );
  });

  test("reads as it always did for an incident a person declared", () => {
    const markdown: string = getDeclaredFromAlertsMarkdown([MENTION]);

    expect(markdown.startsWith("🔗 Declared from 1 alert:")).toBe(true);
    expect(markdown).not.toContain(ALERT_INCIDENT_RULE_KIND);
    expect(getDeclaredFromAlertsMarkdown([MENTION], { ruleName: "  " })).toBe(
      markdown,
    );
  });

  test("writes the rule's name as the text it is", () => {
    const markdown: string = getDeclaredFromAlertsMarkdown([MENTION], {
      ruleName: "<!here> [click](https://evil.example)",
    });

    expect(markdown).not.toContain("[click](https://evil.example)");
    expect(markdown).not.toContain("<!here>");
  });

  test("still leaves out a private alert's title", () => {
    const markdown: string = getDeclaredFromAlertsMarkdown(
      [{ ...MENTION, isPrivate: true }],
      { ruleName: "Critical alerts" },
    );

    expect(markdown).not.toContain("Database CPU high");
    expect(markdown).toContain("(private alert)");
  });
});
