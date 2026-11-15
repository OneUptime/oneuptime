import { describe, expect, test } from "@jest/globals";
import { readStoredAddress } from "../../../Utils/Rum/UserFlow";
import UrlScrubber from "../../../Utils/Rum/UrlScrubber";
import { pathOf } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable";
import { replayUserSessionPathOf } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions";
import { sessionReplayEntryPath } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAuditSummary";

/*
 * #8384: the React Native recorder names a screen "app://<app id>/<route>",
 * and the scrubber stored it as "null/<route>" until then (URL.origin is
 * "null" for a scheme with no origin). The session list drew that as the
 * entry and exit page. A session recorded since keeps its app's address and
 * is drawn by its route; one recorded before is drawn by its route too, for
 * as long as its recording is kept.
 */

const SCREENS: Array<[string, string]> = [
  ["null/Checkout/42", "/Checkout/42"],
  ["null/", "/"],
  ["app://com.example.shop/Checkout/42", "/Checkout/42"],
  ["https://shop.example.com/checkout?step=2", "/checkout?step=2"],
  ["/relative/route", "/relative/route"],
];

describe("a mobile screen's stored address", () => {
  test("reads a lost origin as the route it was, and nothing else", () => {
    expect(readStoredAddress("null/Checkout")).toBe("/Checkout");
    expect(readStoredAddress("null/")).toBe("/");
    // Only that prefix: an address whose own path starts "/null" is kept.
    expect(readStoredAddress("https://shop.example.com/null/x")).toBe(
      "https://shop.example.com/null/x",
    );
    expect(readStoredAddress("nullish/x")).toBe("nullish/x");
    expect(readStoredAddress("/null/x")).toBe("/null/x");
    expect(readStoredAddress("")).toBe("");
  });

  test.each(SCREENS)(
    "the session list, its user menu and its audit links draw %p as %p",
    (stored: string, drawn: string) => {
      expect(pathOf(stored)).toBe(drawn);
      expect(replayUserSessionPathOf(stored)).toBe(drawn);
      expect(sessionReplayEntryPath(stored)).toBe(drawn);
    },
  );

  test("what the scrubber stores now for a screen draws the same as what it stored before", () => {
    const now: string = UrlScrubber.scrub(
      "app://com.example.shop/Checkout/42",
      [],
    );

    expect(now).toBe("app://com.example.shop/Checkout/42");
    expect(pathOf(now)).toBe(pathOf("null/Checkout/42"));
  });

  test("nothing is drawn for no address", () => {
    expect(pathOf("")).toBe("");
    expect(replayUserSessionPathOf("")).toBe("");
    expect(sessionReplayEntryPath("  ")).toBe("");
  });
});
