import { maskKeepingEnds } from "../../../Utils/Telemetry/ScrubMask";
import { hasLoneSurrogate } from "./JsonTextCases";
import { describe, expect, test } from "@jest/globals";

/*
 * A custom match or a secret under a sensitive key, masked: its first and
 * last characters kept, whole. The log, trace and session replay scrubbers
 * share it; it used to keep the first and last code units, which split an
 * emoji and stored half of it.
 */
describe("maskKeepingEnds", () => {
  test("keeps the first and last characters, with at least three stars between", () => {
    expect(maskKeepingEnds("abcdef")).toBe("a****f");
    expect(maskKeepingEnds("abc")).toBe("a***c");
    expect(maskKeepingEnds("hunter2")).toBe("h*****2");
  });

  test("two characters or fewer are all stars", () => {
    expect(maskKeepingEnds("")).toBe("***");
    expect(maskKeepingEnds("a")).toBe("***");
    expect(maskKeepingEnds("ab")).toBe("***");
    // One emoji is one character, written as two code units.
    expect(maskKeepingEnds("😀")).toBe("***");
    expect(maskKeepingEnds("a😀")).toBe("***");
    expect(maskKeepingEnds("😀😀")).toBe("***");
  });

  test("never splits a surrogate pair at either end", () => {
    expect(maskKeepingEnds("😀secret😀")).toBe("😀******😀");
    expect(maskKeepingEnds("😀abc")).toBe("😀***c");
    expect(maskKeepingEnds("abc😀")).toBe("a***😀");

    for (const value of [
      "😀secret",
      "secret😀",
      "😀x😀",
      "𝄞 music 𝄞",
      "中文😀日本語",
      "😀😀😀😀",
    ]) {
      expect({
        value,
        split: hasLoneSurrogate(maskKeepingEnds(value)),
      }).toEqual({ value, split: false });
    }
  });

  test("a half pair the value already had stays as it was given", () => {
    // Not made whole, not made worse: the end is what the value ends with.
    expect(maskKeepingEnds("abc\ud800")).toBe("a***\ud800");
  });
});
