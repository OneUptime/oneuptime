import SpanUtil, {
  SpanAttributes,
} from "../../../../Server/Utils/Telemetry/SpanUtil";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * SpanUtil.addAttributesToSpan copies telemetry attributes onto a span, but it
 * must drop undefined/null values - OpenTelemetry rejects those and throwing
 * mid-request would break the traced operation. This pins the filtering so a
 * partially-populated SpanAttributes object stays safe to pass in.
 */

// A stand-in Span that just records what setAttribute was called with.
function fakeSpan(): {
  span: { setAttribute: (key: string, value: unknown) => void };
  calls: Array<[string, unknown]>;
} {
  const calls: Array<[string, unknown]> = [];
  const setAttribute: (key: string, value: unknown) => void = jest.fn(
    (key: string, value: unknown): void => {
      calls.push([key, value]);
    },
  );
  return { span: { setAttribute }, calls };
}

describe("SpanUtil.addAttributesToSpan", () => {
  it("sets every defined attribute on the span", () => {
    const { span, calls } = fakeSpan();

    const attributes: SpanAttributes = {
      userId: "user-1",
      projectId: "project-1",
    };

    SpanUtil.addAttributesToSpan({
      span: span as never,
      attributes,
    });

    expect(calls).toContainEqual(["userId", "user-1"]);
    expect(calls).toContainEqual(["projectId", "project-1"]);
    expect(calls).toHaveLength(2);
  });

  it("skips undefined and null values (OpenTelemetry rejects them)", () => {
    const { span, calls } = fakeSpan();

    const attributes: SpanAttributes = {
      userId: "user-1",
      projectId: undefined,
      // null is not part of the typed surface but can arrive at runtime.
      monitorId: null as unknown as string,
    };

    SpanUtil.addAttributesToSpan({
      span: span as never,
      attributes,
    });

    expect(calls).toEqual([["userId", "user-1"]]);
  });

  it("preserves falsy-but-defined values like empty string, 0 and false", () => {
    const { span, calls } = fakeSpan();

    const attributes: SpanAttributes = {
      channelId: "",
      retryCount: 0,
      isRetry: false,
    };

    SpanUtil.addAttributesToSpan({
      span: span as never,
      attributes,
    });

    expect(calls).toContainEqual(["channelId", ""]);
    expect(calls).toContainEqual(["retryCount", 0]);
    expect(calls).toContainEqual(["isRetry", false]);
    expect(calls).toHaveLength(3);
  });

  it("does nothing for an empty attribute object", () => {
    const { span, calls } = fakeSpan();

    SpanUtil.addAttributesToSpan({
      span: span as never,
      attributes: {},
    });

    expect(calls).toHaveLength(0);
  });
});
