import LlmSpanDisplayUtil, {
  LlmSpanDisplay,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LlmSpanDisplay";
import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../Server/Utils/Telemetry/LlmSpan";
import { AttributeType } from "../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  LlmEndUserAttributeKeys,
  LlmTeamAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmUserIdAttributeKeys,
} from "../../../Types/Telemetry/LlmConventions";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The client half of the LLM convention pair
 * ---------------------------------------------------------------------------
 *
 * LlmSpanDisplay.ts and Common/Server/Utils/Telemetry/LlmSpan.ts read the SAME
 * key lists out of Common/Types/Telemetry/LlmConventions.ts, and that shared
 * import is the only thing keeping the span panel and the denormalized
 * columns naming the same person for the same span. Nothing about that
 * arrangement is enforced by the type system: dropping a list from the
 * client's import, or re-declaring a key inline, compiles perfectly and shows
 * a blank "User" on exactly the emitters whose rows the table can filter.
 *
 * So the highest-value test in this file is the drift guard at the bottom,
 * which walks every recognized key and asserts the two parsers agree on it.
 * The rest pin the behaviours a reader of the panel depends on: preference
 * order, the employee / downstream-customer separation, and the empty cases.
 */

// A span whose attributes reach the client as a plain JSON map.
type Attributes = JSONObject;

// The server extractor's flattened attribute dictionary.
type ServerAttributes = Dictionary<AttributeType | Array<AttributeType>>;

/*
 * Every case below carries an LLM marker. Both parsers gate identity on the
 * span being an LLM span at all, so identity keys on their own would prove
 * nothing about the key lists — see the gating test further down, which pins
 * that gate on purpose.
 */
const LLM_MARKER: Attributes = { "gen_ai.system": "openai" };

type ParseFunction = (attributes: Attributes) => LlmSpanDisplay;

const parse: ParseFunction = (attributes: Attributes): LlmSpanDisplay => {
  return LlmSpanDisplayUtil.parse({ attributes: attributes });
};

type WithMarkerFunction = (attributes: Attributes) => Attributes;

const withMarker: WithMarkerFunction = (attributes: Attributes): Attributes => {
  return { ...LLM_MARKER, ...attributes };
};

describe("LlmSpanDisplayUtil.parse — employee identity keys", () => {
  /*
   * Each list is ordered preferred-first and the parser returns the first key
   * present. A key that is listed but never read is worse than one that is
   * missing: the list is the documentation, and both the ingest extractor and
   * this parser are read as the answer to "does OneUptime understand my
   * instrumentation?".
   */
  test.each(LlmUserIdAttributeKeys)(
    "user id key %s is recognized on its own",
    (key: string) => {
      expect(parse(withMarker({ [key]: "employee-42" })).userId).toBe(
        "employee-42",
      );
    },
  );

  test.each(LlmUserEmailAttributeKeys)(
    "user email key %s is recognized on its own",
    (key: string) => {
      expect(parse(withMarker({ [key]: "ada@example.com" })).userEmail).toBe(
        "ada@example.com",
      );
    },
  );

  test.each(LlmTeamAttributeKeys)(
    "team key %s is recognized on its own",
    (key: string) => {
      expect(parse(withMarker({ [key]: "platform" })).team).toBe("platform");
    },
  );

  test("the whole preference order is honoured, most-preferred first", () => {
    /*
     * A single span carrying EVERY recognized spelling: a gateway that stamps
     * its own metadata onto a span an SDK already annotated produces exactly
     * this. Walking the list from the back and removing one key at a time
     * asserts the full ordering rather than only its first element.
     */
    const attributes: Attributes = withMarker({});

    for (const key of LlmUserIdAttributeKeys) {
      attributes[key] = `value-of-${key}`;
    }

    for (
      let index: number = 0;
      index < LlmUserIdAttributeKeys.length;
      index++
    ) {
      const expectedKey: string = LlmUserIdAttributeKeys[index]!;

      expect(parse(attributes).userId).toBe(`value-of-${expectedKey}`);

      delete attributes[expectedKey];
    }

    // Every key removed: nothing is left to resolve.
    expect(parse(attributes).userId).toBe("");
  });

  test("user.id and user.email are read from nested attribute objects", () => {
    /*
     * The API returns attributes as they were stored, and OTLP producers that
     * send `user: { id, email }` as a nested object arrive that way. The
     * server extractor sees an already-flattened dictionary; the client has
     * to flatten first, so this path is client-only and would otherwise be
     * untested.
     */
    const display: LlmSpanDisplay = parse(
      withMarker({
        user: { id: "acct-9f2", email: "grace@example.com" },
      }),
    );

    expect(display.userId).toBe("acct-9f2");
    expect(display.userEmail).toBe("grace@example.com");
  });
});

describe("LlmSpanDisplayUtil.parse — employee vs downstream customer", () => {
  /*
   * The load-bearing separation. gen_ai.user / llm.user carry OpenAI's `user`
   * REQUEST parameter and litellm.metadata.user_api_key_end_user_id is
   * LiteLLM's end-user id: on a SaaS product's spans all three name the
   * product's OWN CUSTOMER. Reading one of them as the employee would
   * manufacture a phantom employee per customer and leave the engineer who
   * actually owns the spend looking like they spent nothing.
   */
  test.each(LlmEndUserAttributeKeys)(
    "end-user key %s yields no employee",
    (key: string) => {
      const display: LlmSpanDisplay = parse(
        withMarker({ [key]: "customer-1234" }),
      );

      expect(display.userId).toBe("");
      expect(display.userEmail).toBe("");
      expect(display.endUser).toBe("customer-1234");
    },
  );

  test("a span carrying ONLY end-user keys has no employee at all", () => {
    const attributes: Attributes = withMarker({});

    for (const key of LlmEndUserAttributeKeys) {
      attributes[key] = "customer-1234";
    }

    const display: LlmSpanDisplay = parse(attributes);

    expect(display.userId).toBe("");
    expect(display.userEmail).toBe("");
    expect(display.team).toBe("");
    expect(display.endUser).toBe("customer-1234");
  });

  test("employee and end user are both surfaced, separately, on one span", () => {
    // The realistic LiteLLM shape: key owner is staff, end user is a customer.
    const display: LlmSpanDisplay = parse(
      withMarker({
        "litellm.metadata.user_api_key_user_id": "employee-7",
        "litellm.metadata.user_api_key_end_user_id": "customer-1234",
      }),
    );

    expect(display.userId).toBe("employee-7");
    expect(display.endUser).toBe("customer-1234");
  });

  test("no end-user key is also an employee key", () => {
    /*
     * The exclusion pinned as a set relation rather than through parse(), so
     * appending an end-user spelling to an employee list fails here even if
     * the parser's own behaviour is unchanged.
     */
    for (const key of LlmEndUserAttributeKeys) {
      expect(LlmUserIdAttributeKeys).not.toContain(key);
      expect(LlmUserEmailAttributeKeys).not.toContain(key);
      expect(LlmTeamAttributeKeys).not.toContain(key);
    }
  });
});

describe("LlmSpanDisplayUtil.parse — absent and empty identity", () => {
  test("an LLM span with no identity attributes reports none", () => {
    const display: LlmSpanDisplay = parse(
      withMarker({ "gen_ai.request.model": "gpt-4o" }),
    );

    expect(display.isLlmSpan).toBe(true);
    expect(display.userId).toBe("");
    expect(display.userEmail).toBe("");
    expect(display.team).toBe("");
    expect(display.endUser).toBe("");
  });

  test("whitespace-only values are treated as absent, not as a person", () => {
    /*
     * An emitter that sets the attribute from an unset environment variable
     * sends "" or " ". Rendering that as the employee would produce a blank
     * chip and a blank table cell that read as a real, nameless person.
     */
    const display: LlmSpanDisplay = parse(
      withMarker({
        "user.id": "   ",
        "user.email": "\t\n",
        "team.id": " ",
      }),
    );

    expect(display.userId).toBe("");
    expect(display.userEmail).toBe("");
    expect(display.team).toBe("");
  });

  test("a whitespace-only preferred key falls through to the next one", () => {
    const display: LlmSpanDisplay = parse(
      withMarker({ "user.id": "  ", "enduser.id": "employee-42" }),
    );

    expect(display.userId).toBe("employee-42");
  });

  test("values are trimmed before display", () => {
    expect(
      parse(withMarker({ "user.email": "  ada@example.com  " })).userEmail,
    ).toBe("ada@example.com");
  });

  test("identity alone does not make a span an LLM span", () => {
    /*
     * user.id / user.email / team.id are GENERIC OTel general-semconv keys
     * that RUM browser spans and ordinary HTTP spans carry. If they counted
     * as LLM evidence, the AI / LLM panel would open on a plain page-load
     * span; and because the ingest extractor gates the llmUser* columns the
     * same way, the panel would be claiming an employee the stored row does
     * not have.
     */
    const display: LlmSpanDisplay = parse({
      "http.method": "GET",
      "user.id": "acct-9f2",
      "user.email": "ada@example.com",
      "team.id": "platform",
    });

    expect(display.isLlmSpan).toBe(false);
    expect(display.userId).toBe("");
    expect(display.userEmail).toBe("");
    expect(display.team).toBe("");
  });
});

describe("LlmSpanDisplay and the ingest extractor cannot drift", () => {
  /*
   * The guard this file exists for.
   *
   * The span panel parses attributes in the browser; the LLM calls table
   * filters and sorts the columns the ingest extractor wrote. Both are
   * supposed to be reading the identical key lists. Every way of breaking
   * that — dropping a list from one side's import, re-declaring the strings
   * inline, adding a key to only one parser — type-checks and renders, and
   * shows up in production as a panel and a table row that disagree about who
   * made a call.
   *
   * So each case below feeds ONE recognized key to BOTH parsers and requires
   * the same answer. Adding a key to LlmConventions.ts extends this suite for
   * free; wiring it into only one parser fails it.
   */
  type ExtractFunction = (attributes: Attributes) => LlmSpanFields;

  const extract: ExtractFunction = (attributes: Attributes): LlmSpanFields => {
    return LlmSpanUtil.extract(attributes as ServerAttributes);
  };

  test.each(LlmUserIdAttributeKeys)(
    "client and server resolve the same employee id from %s",
    (key: string) => {
      const attributes: Attributes = withMarker({ [key]: "employee-42" });

      expect(parse(attributes).userId).toBe(extract(attributes).llmUserId);
      expect(parse(attributes).userId).toBe("employee-42");
    },
  );

  test.each(LlmUserEmailAttributeKeys)(
    "client and server resolve the same employee email from %s",
    (key: string) => {
      const attributes: Attributes = withMarker({ [key]: "ada@example.com" });

      expect(parse(attributes).userEmail).toBe(
        extract(attributes).llmUserEmail,
      );
      expect(parse(attributes).userEmail).toBe("ada@example.com");
    },
  );

  test.each(LlmTeamAttributeKeys)(
    "client and server resolve the same team from %s",
    (key: string) => {
      const attributes: Attributes = withMarker({ [key]: "platform" });

      expect(parse(attributes).team).toBe(extract(attributes).llmTeam);
      expect(parse(attributes).team).toBe("platform");
    },
  );

  test.each(LlmEndUserAttributeKeys)(
    "neither client nor server reads %s as the employee",
    (key: string) => {
      const attributes: Attributes = withMarker({ [key]: "customer-1234" });

      const display: LlmSpanDisplay = parse(attributes);
      const fields: LlmSpanFields = extract(attributes);

      expect(display.userId).toBe("");
      expect(display.userEmail).toBe("");
      expect(fields.llmUserId).toBe("");
      expect(fields.llmUserEmail).toBe("");

      /*
       * The client alone surfaces the end user, under its own label. That
       * asymmetry is deliberate — the value has no column — so it is asserted
       * rather than left to look like an oversight.
       */
      expect(display.endUser).toBe("customer-1234");
    },
  );

  test("both parsers agree on a fully-populated coding-agent span", () => {
    // The shape Claude Code / Codex / Gemini CLI actually export.
    const attributes: Attributes = withMarker({
      "gen_ai.request.model": "claude-opus-4",
      "user.id": "acct-9f2",
      "user.email": "ada@example.com",
      "team.id": "platform",
      cost_center: "RD-114",
    });

    const display: LlmSpanDisplay = parse(attributes);
    const fields: LlmSpanFields = extract(attributes);

    expect(display.userId).toBe(fields.llmUserId);
    expect(display.userEmail).toBe(fields.llmUserEmail);
    expect(display.team).toBe(fields.llmTeam);

    // team.id outranks cost_center in the shared list, on both sides.
    expect(display.team).toBe("platform");
  });

  test("both parsers gate identity on the span being an LLM span", () => {
    const attributes: Attributes = {
      "http.method": "GET",
      "user.id": "acct-9f2",
      "user.email": "ada@example.com",
      "team.id": "platform",
    };

    const display: LlmSpanDisplay = parse(attributes);
    const fields: LlmSpanFields = extract(attributes);

    expect(display.isLlmSpan).toBe(fields.isLlmSpan);
    expect(display.isLlmSpan).toBe(false);
    expect(display.userId).toBe(fields.llmUserId);
    expect(display.userEmail).toBe(fields.llmUserEmail);
    expect(display.team).toBe(fields.llmTeam);
  });
});
