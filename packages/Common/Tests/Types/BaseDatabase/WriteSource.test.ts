import WriteSource, {
  WRITE_SOURCES,
  isWriteSource,
} from "../../../Types/BaseDatabase/WriteSource";
import { describe, expect, test } from "@jest/globals";

/*
 * Where a write came from when it was not the person's own hand (issue
 * #6258): carried in the interaction props for attribution only, and
 * stored on a workflow version as it is.
 */

describe("where a write came from", () => {
  test("Ask AI is one, stored as written", () => {
    expect(WriteSource.AskAi).toBe("AskAi");
    expect(WRITE_SOURCES).toEqual([WriteSource.AskAi]);
    expect(isWriteSource(WriteSource.AskAi)).toBe(true);
  });

  test("nothing else is: not another word, not its case, not a value of another kind", () => {
    for (const value of [
      "askai",
      "ASKAI",
      "Ask AI",
      " AskAi",
      "",
      "Api",
      null,
      undefined,
      0,
      true,
      {},
      ["AskAi"],
    ]) {
      expect({ value, isWriteSource: isWriteSource(value) }).toEqual({
        value,
        isWriteSource: false,
      });
    }
  });

  test("every source fits the version column it is stored in", () => {
    for (const source of WRITE_SOURCES) {
      expect(source.length).toBeLessThanOrEqual(100);
    }
  });
});
