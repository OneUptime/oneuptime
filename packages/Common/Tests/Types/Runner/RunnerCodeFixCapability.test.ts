import RunnerCodeFixCapability, {
  MAX_RUNNER_CODE_FIX_CAPABILITIES,
  RUNNER_CODE_FIX_CAPABILITIES_FIELD,
  RunnerCodeFixCapabilityUtil,
  SERVER_OPENS_PULL_REQUEST_FIELD,
} from "../../../Types/Runner/RunnerCodeFixCapability";
import { describe, expect, test } from "@jest/globals";

/*
 * What a Runner says it can do in a code fix (#8916), as a probe declares
 * its probeCapabilities: read on every code-fix request, so the server hands
 * a Runner only what it understands and an older Runner - which declares
 * none - exactly what it always did. These names are a wire contract with
 * every Runner in the field.
 */

describe("RunnerCodeFixCapability", () => {
  test("the wire names stay as they are", () => {
    expect(RunnerCodeFixCapability.ServerOpensPullRequests).toBe(
      "serverOpensPullRequests",
    );
    expect(RUNNER_CODE_FIX_CAPABILITIES_FIELD).toBe("codeFixCapabilities");
    expect(SERVER_OPENS_PULL_REQUEST_FIELD).toBe("serverOpensPullRequest");
  });

  test("anything that is not a list declares nothing - an older Runner sends none", () => {
    for (const value of [undefined, null, "serverOpensPullRequests", 3, {}]) {
      expect(RunnerCodeFixCapabilityUtil.parse(value)).toEqual([]);
    }
  });

  test("keeps the capabilities this server knows, once each, and drops the rest", () => {
    expect(
      RunnerCodeFixCapabilityUtil.parse([
        "serverOpensPullRequests",
        " serverOpensPullRequests ",
        "somethingANewerRunnerCanDo",
        7,
        null,
        "x".repeat(200),
      ]),
    ).toEqual([RunnerCodeFixCapability.ServerOpensPullRequests]);
  });

  test("reads only so many entries", () => {
    const many: Array<string> = Array.from(
      { length: MAX_RUNNER_CODE_FIX_CAPABILITIES },
      (_unused: unknown, index: number): string => {
        return `unknown-${index}`;
      },
    );

    // Past the bound, even a known one is not read.
    expect(
      RunnerCodeFixCapabilityUtil.parse([...many, "serverOpensPullRequests"]),
    ).toEqual([]);
  });

  test("read from a request's body, and whether it pushes with a token made for its run", () => {
    expect(
      RunnerCodeFixCapabilityUtil.readFromBody({
        [RUNNER_CODE_FIX_CAPABILITIES_FIELD]: ["serverOpensPullRequests"],
      }),
    ).toEqual([RunnerCodeFixCapability.ServerOpensPullRequests]);

    for (const body of [undefined, null, [], "body", {}]) {
      expect(RunnerCodeFixCapabilityUtil.readFromBody(body)).toEqual([]);
      expect(RunnerCodeFixCapabilityUtil.pushesWithRunTokens(body)).toBe(false);
    }

    expect(
      RunnerCodeFixCapabilityUtil.pushesWithRunTokens({
        [RUNNER_CODE_FIX_CAPABILITIES_FIELD]: ["serverOpensPullRequests"],
      }),
    ).toBe(true);
    expect(
      RunnerCodeFixCapabilityUtil.has(
        undefined,
        RunnerCodeFixCapability.ServerOpensPullRequests,
      ),
    ).toBe(false);
  });
});
