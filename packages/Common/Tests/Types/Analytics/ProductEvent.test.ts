import {
  ALLOWED_PROPERTY_NAMES_WITH_FORBIDDEN_WORDS,
  COMMON_PRODUCT_EVENT_PROPERTIES,
  PRODUCT_EVENTS,
  PRODUCT_EVENT_TOKEN_MAX_LENGTH,
  ProductEventDefinition,
  ProductEventName,
  ProductEventPropertySpec,
  SEARCH_QUERY_MAX_LENGTH,
  getProductEventDefinition,
  getPropertyNameWords,
  isForbiddenPropertyName,
  toProductEventProperties,
  toProductEventToken,
} from "../../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The catalog of the Dashboard's behaviour events (issue #6830) and the
 * one function every event's properties pass through on the way out
 * (toProductEventProperties). What these pin is privacy: a property the
 * catalog does not list is never sent, the words of a search leave only
 * from Cloud and only cut short, and no listed property is named after
 * something personal.
 */

const EVENT_NAME_RULE: RegExp = /^[a-z]+(_[a-z]+)*\/[a-z]+(_[a-z]+)*$/;

describe("the product event catalog", () => {
  test("every event follows area/thing_happened, once", () => {
    const names: Array<string> = PRODUCT_EVENTS.map(
      (event: ProductEventDefinition): string => {
        return event.name;
      },
    );

    expect([...names].sort()).toEqual(
      [...Object.values(ProductEventName)].sort(),
    );
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect(name).toMatch(EVENT_NAME_RULE);
    }
  });

  test("every event says when it is sent, and lists its properties once", () => {
    for (const event of PRODUCT_EVENTS) {
      expect(event.description.trim().length).toBeGreaterThan(0);

      const propertyNames: Array<string> = event.properties.map(
        (spec: ProductEventPropertySpec): string => {
          return spec.name;
        },
      );

      expect(new Set(propertyNames).size).toBe(propertyNames.length);

      for (const name of propertyNames) {
        expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
        // The common properties are added by ProductEvents.send, not listed.
        expect(COMMON_PRODUCT_EVENT_PROPERTIES).not.toContain(name);
      }
    }
  });

  test("no event lists a property named after something personal, save the reviewed exceptions", () => {
    const offenders: Array<string> = [];

    for (const event of PRODUCT_EVENTS) {
      for (const spec of event.properties) {
        if (isForbiddenPropertyName(spec.name)) {
          offenders.push(`${event.name}: ${spec.name}`);
        }
      }
    }

    for (const name of COMMON_PRODUCT_EVENT_PROPERTIES) {
      if (isForbiddenPropertyName(name)) {
        offenders.push(`common: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the one property that carries typed words is the search's, Cloud-only and cut to 40 characters", () => {
    const wordsCarriers: Array<string> = [];

    for (const event of PRODUCT_EVENTS) {
      for (const spec of event.properties) {
        if (spec.name === "query") {
          wordsCarriers.push(event.name);
          expect(spec.isCloudOnly).toBe(true);
          expect(spec.maxLength).toBe(SEARCH_QUERY_MAX_LENGTH);
          expect(SEARCH_QUERY_MAX_LENGTH).toBeLessThanOrEqual(40);
        }
      }
    }

    expect(wordsCarriers).toEqual([ProductEventName.SearchFoundNothing]);
  });

  test("only the events no page sends yet are reserved, each for its issue", () => {
    const reserved: Array<string> = PRODUCT_EVENTS.filter(
      (event: ProductEventDefinition): boolean => {
        return Boolean(event.reservedFor);
      },
    ).map((event: ProductEventDefinition): string => {
      return event.name;
    });

    /*
     * The guided setups' events are sent since #6804 (GuidedSetupFrame),
     * and "Was this page helpful?" since #6822 (the docs server's
     * DocsFeedback): nothing waits for a later issue now.
     */
    expect(reserved.sort()).toEqual([]);

    for (const event of PRODUCT_EVENTS) {
      if (event.reservedFor) {
        expect(event.reservedFor).toMatch(/^#\d+$/);
      }
    }
  });

  test("getProductEventDefinition finds each event, and nothing for a name not in the catalog", () => {
    for (const event of PRODUCT_EVENTS) {
      expect(getProductEventDefinition(event.name)).toBe(event);
    }

    expect(
      getProductEventDefinition("search/opened" as ProductEventName),
    ).toBeNull();
  });
});

describe("property names no event may carry", () => {
  test("a name is split into words at underscores and capitals", () => {
    expect(getPropertyNameWords("project_name")).toEqual(["project", "name"]);
    expect(getPropertyNameWords("toEmail")).toEqual(["to", "email"]);
    expect(getPropertyNameWords("monitorType")).toEqual(["monitor", "type"]);
    expect(getPropertyNameWords("utm_url")).toEqual(["utm", "url"]);
  });

  test("names, emails, addresses, phones and written text are refused", () => {
    for (const name of [
      "project_name",
      "name",
      "userName",
      "email",
      "toEmail",
      "owner_email",
      "address",
      "ip_address",
      "phone",
      "subscriberPhone",
      "message",
      "message_text",
      "text",
      "body",
      "title",
      "incident_title",
      "description",
      "content",
      "note",
      "question",
      "answer",
      "password",
      "token",
      "ip",
    ]) {
      expect(isForbiddenPropertyName(name)).toBe(true);
    }
  });

  test("the properties events carry today are allowed", () => {
    for (const name of [
      "project_id",
      "projectId",
      "plan",
      "edition",
      "language",
      "is_project_creator",
      "monitor_type",
      "milestone",
      "seconds_since_project_created",
      "step",
      "step_number",
      "from",
      "rating",
      "query_length",
      "utm_source",
      "utm_url",
      "click_ids",
      "first_touch",
      "has_accepted_invitation",
      "funnel_stage",
    ]) {
      expect(isForbiddenPropertyName(name)).toBe(false);
    }
  });

  test("each reviewed exception says why it is allowed", () => {
    for (const [name, why] of Object.entries(
      ALLOWED_PROPERTY_NAMES_WITH_FORBIDDEN_WORDS,
    )) {
      expect(why.trim().length).toBeGreaterThan(20);
      expect(isForbiddenPropertyName(name)).toBe(false);
    }

    expect(
      Object.keys(ALLOWED_PROPERTY_NAMES_WITH_FORBIDDEN_WORDS).sort(),
    ).toEqual(["has_password", "query", "utmContent", "utm_content"].sort());
  });
});

describe("toProductEventProperties", () => {
  test("keeps only what the event lists, as plain values", () => {
    const sent: JSONObject = toProductEventProperties({
      name: ProductEventName.AskAiQuestionAsked,
      properties: {
        is_new_conversation: true,
        permission_mode: "AskForApproval",
        question: "Why is my website down?",
        content: "secret",
        project_name: "Acme",
      },
      isCloud: true,
    });

    expect(sent).toEqual({
      is_new_conversation: true,
      permission_mode: "askforapproval",
    });
  });

  test("drops objects, arrays, null and numbers that are not finite", () => {
    const sent: JSONObject = toProductEventProperties({
      name: ProductEventName.SearchFoundNothing,
      properties: {
        source: { nested: "x" } as unknown as string,
        query_length: Number.NaN,
        query: ["a"] as unknown as string,
      },
      isCloud: true,
    });

    expect(sent).toEqual({});

    expect(
      toProductEventProperties({
        name: ProductEventName.ChecklistFinished,
        properties: { step_count: Number.POSITIVE_INFINITY },
        isCloud: true,
      }),
    ).toEqual({});
  });

  test("the words of a search leave only from Cloud, cut to their length", () => {
    const longQuery: string =
      "how do I page the person on call by phone at night";

    const onCloud: JSONObject = toProductEventProperties({
      name: ProductEventName.SearchFoundNothing,
      properties: {
        source: "command_palette",
        query_length: longQuery.length,
        query: longQuery,
      },
      isCloud: true,
    });

    expect(onCloud["query"]).toBe(longQuery.slice(0, SEARCH_QUERY_MAX_LENGTH));
    expect((onCloud["query"] as string).length).toBe(SEARCH_QUERY_MAX_LENGTH);
    expect(onCloud["query_length"]).toBe(longQuery.length);
    expect(onCloud["source"]).toBe("command_palette");

    const selfHosted: JSONObject = toProductEventProperties({
      name: ProductEventName.SearchFoundNothing,
      properties: {
        source: "command_palette",
        query_length: longQuery.length,
        query: longQuery,
      },
      isCloud: false,
    });

    expect(selfHosted).toEqual({
      source: "command_palette",
      query_length: longQuery.length,
    });
    expect("query" in selfHosted).toBe(false);
  });

  test("a token is lower-cased, made safe and cut short, so typed words cannot pass as one", () => {
    expect(toProductEventToken("Home")).toBe("home");
    expect(toProductEventToken("from somebody@example.com!")).toBe(
      "from_somebody_example.com_",
    );
    expect(toProductEventToken("monitor/website-monitor")).toBe(
      "monitor/website-monitor",
    );
    expect(toProductEventToken("x".repeat(500)).length).toBe(
      PRODUCT_EVENT_TOKEN_MAX_LENGTH,
    );

    expect(
      toProductEventProperties({
        name: ProductEventName.ImporterOpened,
        properties: { from: "Somebody <a@b.c>" },
        isCloud: true,
      }),
    ).toEqual({ from: "somebody__a_b.c_" });
  });

  test("an event outside the catalog, or one with no properties, carries nothing", () => {
    expect(
      toProductEventProperties({
        name: "search/opened" as ProductEventName,
        properties: { source: "x" },
        isCloud: true,
      }),
    ).toEqual({});

    expect(
      toProductEventProperties({
        name: ProductEventName.ChecklistFinished,
        isCloud: true,
      }),
    ).toEqual({});
  });
});
