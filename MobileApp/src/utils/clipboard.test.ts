import { Clipboard } from "react-native";
import { copyToClipboard } from "./clipboard";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * React Native's jest preset stubs the core Clipboard module, which is
 * exactly the seam this wrapper exists for: the module is deprecated and a
 * build without it must degrade to "could not copy", never to a crash in a
 * button handler.
 */

function setStringSpy(): jest.SpyInstance {
  return Clipboard.setString as unknown as jest.SpyInstance;
}

describe("copyToClipboard", () => {
  beforeEach(() => {
    setStringSpy().mockReset();
  });

  test("writes the text and reports success", () => {
    expect(copyToClipboard("https://example.com/feed.ics")).toBe(true);
    expect(setStringSpy()).toHaveBeenCalledWith("https://example.com/feed.ics");
  });

  test("reports failure instead of throwing when the module is unavailable", () => {
    setStringSpy().mockImplementation(() => {
      throw new Error("Clipboard native module is not available");
    });

    expect(copyToClipboard("x")).toBe(false);
  });
});
