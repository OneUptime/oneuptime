import { describe, expect, test } from "@jest/globals";
import { getOpenableJoinUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallJoinLink";

/*
 * What a call's Join link opens. Every page that opens a call's link - the
 * Video Call card's Join and Join huddle links, the header's Join call
 * button, a connection's test meeting - opens what this gives, so it is
 * where an address that is not http or https is kept from ever being
 * opened. A call's link is checked to be https when the call is added;
 * these pin that the page holds every link it opens to that as well.
 */

describe("a call's link that opens", () => {
  test.each([
    "https://example.zoom.us/j/81234567890?pwd=abc",
    "https://meet.google.com/abc-defg-hij",
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc",
    "https://app.slack.com/huddle/T0123ABCD/C0456EFGH",
    "https://bridge.example.com:8443/room/7#lobby",
    "http://bridge.internal.example.com/room/7",
  ])("%s opens as it is written", (link: string) => {
    expect(getOpenableJoinUrl(link)).toBe(link);
  });

  test("spaces around the link are left out", () => {
    expect(
      getOpenableJoinUrl("  https://meet.google.com/abc-defg-hij \n"),
    ).toBe("https://meet.google.com/abc-defg-hij");
  });

  test("an address opens as the browser reads it", () => {
    // The scheme and host in lower case, an empty path as "/".
    expect(getOpenableJoinUrl("HTTPS://Bridge.Example.com")).toBe(
      "https://bridge.example.com/",
    );
    // Spaces and letters beyond ASCII encoded, the host in punycode.
    expect(getOpenableJoinUrl("https://bücher.example/räume/raum 7")).toBe(
      "https://xn--bcher-kva.example/r%C3%A4ume/raum%207",
    );
    // Tabs and line breaks inside a link are dropped, as the browser does.
    expect(getOpenableJoinUrl("https://exam\tple.com/ro\nom")).toBe(
      "https://example.com/room",
    );
  });
});

describe("a call's link that does not open", () => {
  test.each([
    ["a javascript: link", "javascript:alert(document.domain)"],
    ["one in mixed case", "JaVaScRiPt:alert(document.domain)"],
    ["one after spaces", "   javascript:alert(document.domain)"],
    ["one after a control character", "\u0001javascript:alert(1)"],
    ["one with a line break in its scheme", "java\nscript:alert(1)"],
    ["one with a tab in its scheme", "java\tscript:alert(1)"],
    ["an encoded one", "javascript:%61lert(1)"],
    ["a data: page", "data:text/html,<script>alert(1)</script>"],
    ["a data: page in base64", "data:text/html;base64,PHNjcmlwdD4="],
    ["a vbscript: link", "vbscript:msgbox(1)"],
    ["a file", "file:///etc/passwd"],
    ["an ftp address", "ftp://files.example.com/room"],
    ["an email address", "mailto:oncall@example.com"],
    ["a blob", "blob:https://example.com/0f9e8d7c"],
    ["a link without its scheme", "//evil.example.com/room"],
    ["a path on this site", "/dashboard/settings"],
    ["a host without a scheme", "example.zoom.us/j/1"],
    ["an https: with nothing after it", "https:"],
    ["https:// with no host", "https://"],
  ])("%s", (_name: string, link: string) => {
    expect(getOpenableJoinUrl(link)).toBeUndefined();
  });

  test("nothing at all", () => {
    expect(getOpenableJoinUrl(undefined)).toBeUndefined();
    expect(getOpenableJoinUrl(null)).toBeUndefined();
    expect(getOpenableJoinUrl("")).toBeUndefined();
    expect(getOpenableJoinUrl("   ")).toBeUndefined();
  });

  test("whatever is not an http or https address, whatever its case or spacing", () => {
    for (const scheme of [
      "javascript",
      "JAVASCRIPT",
      "data",
      "vbscript",
      "file",
      "about",
    ]) {
      for (const before of ["", " ", "\t", "\n", "\u0000", "\u001f"]) {
        expect(
          getOpenableJoinUrl(`${before}${scheme}:void(0)`),
        ).toBeUndefined();
      }
    }
  });
});
