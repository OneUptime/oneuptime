import {
  ParsedSessionTraceState,
  SESSION_TRACE_STATE_KEY,
  buildSessionTraceStateMember,
  parseSessionTraceState,
} from "../../../Utils/Rum/SessionTraceState";

const SESSION_ID: string = "0123456789abcdef0123456789abcdef";
const PARENT_ID: string = "fedcba9876543210";

/*
 * The W3C / OpenTelemetry validation rules for a tracestate member, copied
 * from @opentelemetry/core's validators. A member that fails them is
 * dropped by the backend's propagator before any span sees it.
 */
const W3C_KEY_PATTERN: RegExp =
  /^(?:[a-z][_0-9a-z\-*/]{0,255}|[a-z0-9][_0-9a-z\-*/]{0,240}@[a-z][_0-9a-z\-*/]{0,13})$/;
const W3C_VALUE_PATTERN: RegExp = /^[ -~]{0,255}[!-~]$/;
const W3C_VALUE_FORBIDDEN: RegExp = /,|=/;

describe("SessionTraceState", () => {
  describe("buildSessionTraceStateMember", () => {
    it("writes the session id under the oneuptime key", () => {
      expect(buildSessionTraceStateMember(SESSION_ID)).toBe(
        `oneuptime=sid:${SESSION_ID}`,
      );
      expect(SESSION_TRACE_STATE_KEY).toBe("oneuptime");
    });

    it("adds the synthetic parent id only when one is given", () => {
      expect(buildSessionTraceStateMember(SESSION_ID, PARENT_ID)).toBe(
        `oneuptime=sid:${SESSION_ID};p:${PARENT_ID}`,
      );
      expect(buildSessionTraceStateMember(SESSION_ID, null)).toBe(
        `oneuptime=sid:${SESSION_ID}`,
      );
      expect(buildSessionTraceStateMember(SESSION_ID, "")).toBe(
        `oneuptime=sid:${SESSION_ID}`,
      );
    });

    it("produces a member every W3C tracestate parser accepts", () => {
      for (const member of [
        buildSessionTraceStateMember(SESSION_ID),
        buildSessionTraceStateMember(SESSION_ID, PARENT_ID),
      ]) {
        const [key, value] = member.split("=") as [string, string];

        expect(W3C_KEY_PATTERN.test(key)).toBe(true);
        expect(W3C_VALUE_PATTERN.test(value)).toBe(true);
        expect(W3C_VALUE_FORBIDDEN.test(value)).toBe(false);
        expect(member.length).toBeLessThanOrEqual(512);
      }
    });
  });

  describe("parseSessionTraceState", () => {
    it("round-trips what the recorder writes", () => {
      expect(
        parseSessionTraceState(buildSessionTraceStateMember(SESSION_ID)),
      ).toEqual({
        sessionTraceState: {
          sessionId: SESSION_ID,
          syntheticParentSpanId: null,
        },
        remainingTraceState: "",
      });

      expect(
        parseSessionTraceState(
          buildSessionTraceStateMember(SESSION_ID, PARENT_ID),
        ),
      ).toEqual({
        sessionTraceState: {
          sessionId: SESSION_ID,
          syntheticParentSpanId: PARENT_ID,
        },
        remainingTraceState: "",
      });
    });

    it("finds the member among other vendors' members and strips only ours", () => {
      const parsed: ParsedSessionTraceState = parseSessionTraceState(
        `dd=s:1;o:rum, oneuptime=sid:${SESSION_ID} ,congo=t61rcWkgMzE,tenant@vendor=x`,
      );

      expect(parsed.sessionTraceState?.sessionId).toBe(SESSION_ID);
      expect(parsed.remainingTraceState).toBe(
        "dd=s:1;o:rum,congo=t61rcWkgMzE,tenant@vendor=x",
      );
    });

    it("tolerates optional whitespace and tabs around members and fields", () => {
      const parsed: ParsedSessionTraceState = parseSessionTraceState(
        `\toneuptime = sid:${SESSION_ID} ; p:${PARENT_ID}\t`,
      );

      expect(parsed.sessionTraceState).toEqual({
        sessionId: SESSION_ID,
        syntheticParentSpanId: PARENT_ID,
      });
    });

    it("reads fields in any order and ignores unknown ones", () => {
      expect(
        parseSessionTraceState(
          `oneuptime=v:2;p:${PARENT_ID};x:y;sid:${SESSION_ID}`,
        ).sessionTraceState,
      ).toEqual({
        sessionId: SESSION_ID,
        syntheticParentSpanId: PARENT_ID,
      });
    });

    it("lowercases hex ids", () => {
      expect(
        parseSessionTraceState(
          `oneuptime=sid:${SESSION_ID.toUpperCase()};p:${PARENT_ID.toUpperCase()}`,
        ).sessionTraceState,
      ).toEqual({
        sessionId: SESSION_ID,
        syntheticParentSpanId: PARENT_ID,
      });
    });

    it("takes the first oneuptime member and strips every one", () => {
      const other: string = "ffffffffffffffffffffffffffffffff";
      const parsed: ParsedSessionTraceState = parseSessionTraceState(
        `oneuptime=sid:${SESSION_ID},a=b,oneuptime=sid:${other}`,
      );

      expect(parsed.sessionTraceState?.sessionId).toBe(SESSION_ID);
      expect(parsed.remainingTraceState).toBe("a=b");
    });

    it("strips a malformed member of ours but yields no session", () => {
      for (const member of [
        "oneuptime=sid:not-hex",
        "oneuptime=sid:0123",
        `oneuptime=sid:${SESSION_ID}00`,
        "oneuptime=sid:00000000000000000000000000000000",
        "oneuptime=p:fedcba9876543210",
        "oneuptime=",
        "oneuptime",
        `oneuptime=${SESSION_ID}`,
      ]) {
        const parsed: ParsedSessionTraceState = parseSessionTraceState(
          `${member},keep=me`,
        );

        expect(parsed.sessionTraceState).toBeNull();
        expect(parsed.remainingTraceState).toBe("keep=me");
      }
    });

    it("keeps the session when only the parent id is malformed", () => {
      for (const parent of ["xyz", "0000000000000000", "fedcba98765432", ""]) {
        expect(
          parseSessionTraceState(`oneuptime=sid:${SESSION_ID};p:${parent}`)
            .sessionTraceState,
        ).toEqual({ sessionId: SESSION_ID, syntheticParentSpanId: null });
      }
    });

    it("does not match keys that only contain the word", () => {
      const value: string = `acme@oneuptime=sid:${SESSION_ID},oneuptimex=sid:${SESSION_ID}`;
      const parsed: ParsedSessionTraceState = parseSessionTraceState(value);

      expect(parsed.sessionTraceState).toBeNull();
      expect(parsed.remainingTraceState).toBe(value);
    });

    it("returns the value untouched when there is no member of ours", () => {
      expect(parseSessionTraceState("rojo=00f067aa0ba902b7")).toEqual({
        sessionTraceState: null,
        remainingTraceState: "rojo=00f067aa0ba902b7",
      });
      expect(parseSessionTraceState("")).toEqual({
        sessionTraceState: null,
        remainingTraceState: "",
      });
    });

    it("never throws on non-string input", () => {
      for (const value of [
        undefined,
        null,
        42,
        true,
        {},
        [`oneuptime=sid:${SESSION_ID}`],
      ]) {
        expect(parseSessionTraceState(value)).toEqual({
          sessionTraceState: null,
          remainingTraceState: "",
        });
      }
    });

    it("does no parsing work on oversized or over-long lists", () => {
      const huge: string = `oneuptime=sid:${SESSION_ID},${"a=b,".repeat(3000)}`;
      expect(parseSessionTraceState(huge)).toEqual({
        sessionTraceState: null,
        remainingTraceState: huge,
      });

      const many: string = `${"k=v,".repeat(80)}oneuptime=sid:${SESSION_ID}`;
      expect(parseSessionTraceState(many).sessionTraceState).toBeNull();
    });

    it("accepts a long but legitimate list that ends with our member", () => {
      const others: Array<string> = [];

      for (let i: number = 0; i < 20; i++) {
        others.push(`vendor${i}=${"x".repeat(30)}`);
      }

      const value: string = `${others.join(",")},oneuptime=sid:${SESSION_ID}`;
      expect(value.length).toBeGreaterThan(600);

      const parsed: ParsedSessionTraceState = parseSessionTraceState(value);
      expect(parsed.sessionTraceState?.sessionId).toBe(SESSION_ID);
      expect(parsed.remainingTraceState).toBe(others.join(","));
    });
  });
});
