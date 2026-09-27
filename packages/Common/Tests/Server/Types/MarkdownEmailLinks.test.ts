import Markdown, {
  EMAIL_IMAGE_SCHEMES,
  EMAIL_LINK_SCHEMES,
  MarkdownContentType,
} from "../../../Server/Types/Markdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Links and images in EMAIL Markdown.
 *
 * Public notes, incident and maintenance descriptions and announcement text
 * are Markdown that project members write, and they are rendered with the
 * email renderer into subscriber emails. marked emits whatever destination it
 * is given, so `[Update your details](javascript:...)` or a data: URL became
 * a live link in an email the recipient trusts. The email renderer now keeps
 * only http, https and mailto links (http and https images), plus relative
 * ones, and renders anything else as its text.
 */

type RenderFunction = (markdown: string) => Promise<string>;

const render: RenderFunction = (markdown: string): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Email);
};

// Every href and src in the output, as the mail client will decode them.
function urlsIn(html: string): Array<string> {
  return Array.from(
    html.matchAll(/\s(?:href|src)="([^"]*)"/g),
    (match: RegExpMatchArray): string => {
      return match[1]!
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    },
  );
}

describe("Markdown email renderer - links", () => {
  test.each([
    [
      "http",
      "[Status](http://status.example.com)",
      "http://status.example.com",
    ],
    [
      "https",
      "[Status](https://status.example.com/incidents/1)",
      "https://status.example.com/incidents/1",
    ],
    [
      "mailto",
      "[Support](mailto:support@example.com)",
      "mailto:support@example.com",
    ],
    [
      "upper-case scheme",
      "[Status](HTTPS://status.example.com)",
      "HTTPS://status.example.com",
    ],
    ["a GFM bare URL", "See www.example.com", "http://www.example.com"],
    [
      "an autolink",
      "<https://status.example.com>",
      "https://status.example.com",
    ],
    [
      "an email autolink",
      "<support@example.com>",
      "mailto:support@example.com",
    ],
    ["a relative path", "[Docs](/docs/status)", "/docs/status"],
    ["an in-page anchor", "[Top](#top)", "#top"],
    [
      "a reference link",
      "[Status][s]\n\n[s]: https://status.example.com",
      "https://status.example.com",
    ],
  ])(
    "keeps %s links",
    async (_label: string, markdown: string, href: string) => {
      const html: string = await render(markdown);

      expect(html).toContain("<a ");
      expect(urlsIn(html)).toEqual([href]);
    },
  );

  test.each([
    ["javascript:", "[Update your details](javascript:alert(document.cookie))"],
    ["mixed-case javascript:", "[Update](JaVaScRiPt:alert(1))"],
    [
      "javascript: in a reference link",
      "[Update][x]\n\n[x]: javascript:alert(1)",
    ],
    ["javascript: in an autolink", "<javascript:alert(1)>"],
    [
      "data:",
      "[Open](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    ],
    ["vbscript:", "[Open](vbscript:msgbox(1))"],
    ["file:", "[Open](file:///etc/passwd)"],
    ["an app scheme", "[Open](slack://open)"],
    ["a hex character reference", "[Update](&#x6A;avascript:alert(1))"],
    ["a decimal character reference", "[Update](&#106;avascript:alert(1))"],
    ["a reference for the colon", "[Update](javascript&#58;alert(1))"],
  ])(
    "drops the link for %s and keeps its text",
    async (_label: string, markdown: string) => {
      const html: string = await render(markdown);

      expect(html).not.toContain("<a ");
      expect(html.toLowerCase()).not.toContain("href=");
      expect(html).toMatch(/Update|Open|javascript:alert\(1\)/);
    },
  );

  /*
   * A reference the decoder does not know stays as literal text in the
   * attribute ("&amp;colon;"), so the mail client reads "&colon;" rather
   * than a ":" - the scheme it sees is not javascript.
   */
  test("a named reference it does not decode cannot smuggle a scheme in", async () => {
    const html: string = await render("[Update](javascript&colon;alert(1))");

    expect(html).toContain('href="javascript&amp;colon;alert(1)"');
    expect(urlsIn(html)).toEqual(["javascript&colon;alert(1)"]);
    for (const url of urlsIn(html)) {
      expect(url.toLowerCase()).not.toMatch(/^[a-z][a-z0-9+.-]*:/);
    }
  });

  test("the text of a dropped link keeps its formatting and is still escaped", async () => {
    const html: string = await render(
      "[**Update** <img src=x onerror=alert(1)>](javascript:alert(1))",
    );

    expect(html).toContain("<strong>Update</strong>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
  });

  test("an ampersand in a URL is escaped in the attribute and still points at the same URL", async () => {
    const html: string = await render(
      "[Details](https://status.example.com/incidents?id=1&view=full)",
    );

    expect(html).toContain(
      'href="https://status.example.com/incidents?id=1&amp;view=full"',
    );
    expect(urlsIn(html)).toEqual([
      "https://status.example.com/incidents?id=1&view=full",
    ]);
  });

  test("a URL written with &amp; still reaches the reader as one ampersand", async () => {
    const html: string = await render(
      "[Details](https://status.example.com/incidents?id=1&amp;view=full)",
    );

    expect(urlsIn(html)).toEqual([
      "https://status.example.com/incidents?id=1&view=full",
    ]);
  });

  test("a quote cannot break out of the href", async () => {
    const html: string = await render(
      '[Details](<https://status.example.com/" onmouseover="alert(1)>)',
    );

    expect(html).not.toContain('" onmouseover');
    expect(html).not.toMatch(/\sonmouseover=/);
  });

  test("a title keeps its escaping", async () => {
    const html: string = await render(
      '[Details](https://status.example.com "Open <the> \\"status\\" page")',
    );

    expect(html).toContain('title="Open &lt;the&gt; &quot;status&quot; page"');
  });

  test("a link inside a table cell and a list item is filtered too", async () => {
    const html: string = await render(
      [
        "| Step | Link |",
        "| --- | --- |",
        "| 1 | [Bad](javascript:alert(1)) |",
        "| 2 | [Good](https://status.example.com) |",
        "",
        "- [Bad](data:text/html,x)",
        "- [Good](mailto:ops@example.com)",
      ].join("\n"),
    );

    expect(urlsIn(html)).toEqual([
      "https://status.example.com",
      "mailto:ops@example.com",
    ]);
  });

  test("links still render the same way outside the email renderer", async () => {
    const html: string = await Markdown.convertToHTML(
      "[Docs](/docs/status)",
      MarkdownContentType.Docs,
    );

    expect(html).toContain('href="/docs/status"');
  });
});

describe("Markdown email renderer - images", () => {
  test("keeps an https image, such as one uploaded through the Markdown editor", async () => {
    const src: string =
      "https://oneuptime.example.com/file/image/access-token/0123456789abcdef";
    const html: string = await render(`![Graph of errors](${src})`);

    expect(html).toContain("<img ");
    expect(html).toContain('alt="Graph of errors"');
    expect(urlsIn(html)).toEqual([src]);
  });

  test("keeps an http image and its title", async () => {
    const html: string = await render(
      '![Graph](http://cdn.example.com/g.png "Errors <today>")',
    );

    expect(urlsIn(html)).toEqual(["http://cdn.example.com/g.png"]);
    expect(html).toContain('title="Errors &lt;today&gt;"');
  });

  test.each([
    ["javascript:", "![Graph](javascript:alert(1))"],
    ["data:", "![Graph](data:image/svg+xml;base64,PHN2Zy8+)"],
    ["mailto:", "![Graph](mailto:ops@example.com)"],
    ["a character reference", "![Graph](&#x6A;avascript:alert(1))"],
  ])(
    "renders the alt text instead of an image for %s",
    async (_label: string, markdown: string) => {
      const html: string = await render(markdown);

      expect(html).not.toContain("<img");
      expect(html).toContain("Graph");
    },
  );

  test("the alt text of a dropped image is still escaped", async () => {
    const html: string = await render(
      '![<img src=x onerror="alert(1)">](data:image/png;base64,AAAA)',
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("Markdown.getEmailUrl", () => {
  test("allows only the schemes it is given, case-insensitively", () => {
    expect(
      Markdown.getEmailUrl("MailTo:a@example.com", EMAIL_LINK_SCHEMES),
    ).toBe("MailTo:a@example.com");
    expect(
      Markdown.getEmailUrl("mailto:a@example.com", EMAIL_IMAGE_SCHEMES),
    ).toBeNull();
    expect(
      Markdown.getEmailUrl("ftp://a.example.com", EMAIL_LINK_SCHEMES),
    ).toBe(null);
  });

  test("keeps a destination with no scheme", () => {
    expect(Markdown.getEmailUrl("/status", EMAIL_LINK_SCHEMES)).toBe("/status");
    expect(Markdown.getEmailUrl("status/page", EMAIL_LINK_SCHEMES)).toBe(
      "status/page",
    );
    expect(
      Markdown.getEmailUrl("//status.example.com", EMAIL_LINK_SCHEMES),
    ).toBe("//status.example.com");
  });

  test("a colon after a slash is not a scheme", () => {
    expect(
      Markdown.getEmailUrl("status/javascript:alert(1)", EMAIL_LINK_SCHEMES),
    ).toBe("status/javascript:alert(1)");
  });

  test("returns nothing for an empty destination", () => {
    expect(Markdown.getEmailUrl("", EMAIL_LINK_SCHEMES)).toBeNull();
    expect(Markdown.getEmailUrl(undefined, EMAIL_LINK_SCHEMES)).toBeNull();
    expect(Markdown.getEmailUrl(null, EMAIL_LINK_SCHEMES)).toBeNull();
  });

  test("percent-encodes spaces and control characters, so none can hide inside a scheme", () => {
    expect(
      Markdown.getEmailUrl("java\tscript:alert(1)", EMAIL_LINK_SCHEMES),
    ).toBe("java%09script:alert(1)");
    expect(
      Markdown.getEmailUrl(" javascript:alert(1)", EMAIL_LINK_SCHEMES),
    ).toBe("%20javascript:alert(1)");
    expect(
      Markdown.getEmailUrl("java&#x0A;script:alert(1)", EMAIL_LINK_SCHEMES),
    ).toBe("java%0Ascript:alert(1)");
  });

  test("keeps existing percent-escapes as they are", () => {
    expect(
      Markdown.getEmailUrl(
        "https://status.example.com/a%20b?q=%26",
        EMAIL_LINK_SCHEMES,
      ),
    ).toBe("https://status.example.com/a%20b?q=%26");
  });

  test("a URL encodeURI cannot encode is dropped", () => {
    expect(
      Markdown.getEmailUrl("https://example.com/\uD800", EMAIL_LINK_SCHEMES),
    ).toBeNull();
  });
});
