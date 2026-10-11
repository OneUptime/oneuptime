import { strayMarkers } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * strayMarkers, the check every translation suite runs on every page in
 * every language ("draws every bold and italic span, with no asterisks or
 * underscores left on the page"). The suites shared it by copying it; it is
 * one function in DocsTranslationChecks now, so it is proven once here: on
 * the real renderer, it reports the line a reader sees with "**" or an
 * underscore left over, and nothing that is code, markup, the title or a
 * name written with underscores.
 */

// A page: a title line, then its body.
const page: (...body: Array<string>) => string = (
  ...body: Array<string>
): string => {
  return ["# Title", "", ...body].join("\n");
};

describe("strayMarkers", () => {
  describe("reports what the renderer leaves on the page", () => {
    it("finds the asterisks of a bold span that ends in punctuation and runs into a letter", async () => {
      expect(
        await strayMarkers(
          page("**リクエストタイムアウト（秒）**を設定します。"),
          "ja",
        ),
      ).toEqual(["**リクエストタイムアウト（秒）**を設定します。"]);
      expect(
        await strayMarkers(
          page("**リクエストタイムアウト（秒）** を設定します。"),
          "ja",
        ),
      ).toEqual([]);
    });

    it("finds the underscores of an italic span inside a word", async () => {
      expect(
        await strayMarkers(page("在第一次尝试_之后_的重试。"), "zh-CN"),
      ).toEqual(["在第一次尝试_之后_的重试。"]);
      // An asterisk italic may sit inside a word; an underscore one may not.
      expect(
        await strayMarkers(page("在第一次尝试*之后*的重试。"), "zh-CN"),
      ).toEqual([]);
      expect(
        await strayMarkers(page("Retries _after_ the first one."), "en"),
      ).toEqual([]);
    });

    it("returns the line as text, with the tags around it taken out", async () => {
      expect(
        await strayMarkers(
          page(
            "See [the guide](/docs/monitor/website-monitor): **超时（秒）**脚本 runs.",
          ),
          "zh-CN",
        ),
      ).toEqual(["See the guide: **超时（秒）**脚本 runs."]);
    });

    it("reports every span left open on the page, and the text it found it in", async () => {
      // The renderer draws a page's paragraphs on one line of HTML.
      const text: string = (
        await strayMarkers(
          page(
            "名为_monitor name_的条件。",
            "",
            "A line that draws **every** span.",
            "",
            "**低 (4σ)**を選びます。",
          ),
          "ja",
        )
      ).join("\n");

      expect(text).toContain("名为_monitor name_的条件。");
      expect(text).toContain("**低 (4σ)**を選びます。");
      // The span that was drawn is text now, with its asterisks gone.
      expect(text).toContain("A line that draws every span.");
    });

    it.each([
      ["a callout", "> [!NOTE]\n> **タイムアウト（秒）**を設定します。"],
      [
        "a step",
        ":::steps\n### Open it\n**タイムアウト（秒）**を設定します。\n:::",
      ],
      [
        "a tab",
        ":::tabs\n@tab One\n**タイムアウト（秒）**を設定します。\n@tab Two\nOK.\n:::",
      ],
      [
        "a details block",
        ":::details More\n**タイムアウト（秒）**を設定します。\n:::",
      ],
      [
        "a table cell",
        "| Field | Meaning |\n| --- | --- |\n| A | **タイムアウト（秒）**を設定 |",
      ],
      ["a list item", "- **タイムアウト（秒）**を設定します。"],
      [
        "a card",
        ":::cards\n- [Website](/docs/monitor/website-monitor): **タイムアウト（秒）**を設定します。\n:::",
      ],
    ])("reads the text of %s", async (_component: string, markdown: string) => {
      const lines: Array<string> = await strayMarkers(page(markdown), "ja");

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("**タイムアウト（秒）**を設定");
      expect(lines[0]).not.toContain("<");
    });
  });

  describe("reports nothing that is not a marker left over", () => {
    it("reads no marker in code", async () => {
      expect(
        await strayMarkers(
          page(
            "Set `PROBE_MONITOR_RETRY_LIMIT`, or `a ** b`.",
            "",
            "```bash",
            "export ONEUPTIME_URL=**not_bold**",
            "```",
          ),
          "en",
        ),
      ).toEqual([]);
    });

    it("reads no marker in a tag's attributes: link addresses, image files, tab ids", async () => {
      expect(
        await strayMarkers(
          page(
            "Read [this](/docs/a_b) and see ![a_b](/docs/static/images/a__b.png).",
            "",
            ":::tabs",
            "@tab One",
            "Text.",
            "@tab Two",
            "More.",
            ":::",
          ),
          "en",
        ),
      ).toEqual([]);
    });

    it("reads a name written with underscores as the name", async () => {
      expect(
        await strayMarkers(
          page(
            ":::details pve_network_receive_bytes 只会增长",
            "正文。",
            ":::",
            "",
            "The metric k8s_pod_cpu_usage counts 1_000_000 samples.",
          ),
          "zh-CN",
        ),
      ).toEqual([]);
      // An underscore beside the name is still a marker.
      const beside: Array<string> = await strayMarkers(
        page(
          ":::details pve_network_receive_bytes _只会_增长",
          "正文。",
          ":::",
        ),
        "zh-CN",
      );

      expect(beside).toHaveLength(1);
      expect(beside[0]).toContain("pve_network_receive_bytes _只会_增长");
    });

    it("leaves the title line out, as the docs route does", async () => {
      expect(
        await strayMarkers("# A **broken_title\n\nFine text.", "en"),
      ).toEqual([]);
    });

    it("reports nothing for a page that draws every span", async () => {
      expect(
        await strayMarkers(
          page(
            "**Bold**, *italic*, _italic_ and ***both***.",
            "",
            "- **リクエストタイムアウト（秒）** を設定します。",
          ),
          "ja",
        ),
      ).toEqual([]);
    });
  });
});
