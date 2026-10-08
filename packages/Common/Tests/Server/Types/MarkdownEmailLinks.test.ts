import Markdown, {
  EMAIL_IMAGE_SCHEMES,
  EMAIL_IMAGE_STYLE,
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
 *
 * The one data: URL an image may have is an inline raster image - a PNG,
 * JPEG, GIF or WebP that carries itself - which is how a synthetic monitor's
 * screenshot reaches a description (issue #4532). Every other data: URL,
 * and every data: link, still renders as its text.
 */

// Real 1x1 images, as Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const GIF: string = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const WEBP: string =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

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
    ["data: SVG", "![Graph](data:image/svg+xml;base64,PHN2Zy8+)"],
    [
      "data: SVG that is not base64",
      "![Graph](data:image/svg+xml,%3Csvg%20onload=alert(1)%3E)",
    ],
    [
      "data: HTML",
      "![Graph](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    ],
    ["data: HTML carrying PNG bytes", `![Graph](data:text/html;base64,${PNG})`],
    [
      "data: PNG whose bytes are not a PNG",
      "![Graph](data:image/png;base64,AAAA)",
    ],
    [
      "data: PNG that is not base64",
      "![Graph](data:image/png,%89PNG%0D%0A%1A%0A)",
    ],
    [
      "data: PNG with a media type parameter",
      `![Graph](data:image/png;charset=utf-8;base64,${PNG})`,
    ],
    [
      "data: PNG written with character references",
      "![Graph](data&#58;image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB)",
    ],
    ["mailto:", "![Graph](mailto:ops@example.com)"],
    ["a character reference", "![Graph](&#x6A;avascript:alert(1))"],
  ])(
    "renders the alt text instead of an image for %s",
    async (_label: string, markdown: string) => {
      const html: string = await render(markdown);

      expect(html).not.toContain("<img");
      expect(html.toLowerCase()).not.toContain("src=");
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

  test("every image is scaled down to the width of the email, never up", async () => {
    const html: string = await render(
      [
        "![Graph](https://cdn.example.com/g.png)",
        "",
        `![Login page](data:image/png;base64,${PNG})`,
      ].join("\n"),
    );

    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html.match(/ style="max-width:100%;height:auto;"/g)).toHaveLength(2);
    expect(EMAIL_IMAGE_STYLE).toBe("max-width:100%;height:auto;");
  });
});

describe("Markdown email renderer - inline images (synthetic monitor screenshots)", () => {
  test.each([
    ["a PNG", "image/png", PNG],
    ["a JPEG", "image/jpeg", JPEG],
    ["a GIF", "image/gif", GIF],
    ["a WebP", "image/webp", WEBP],
  ])(
    "keeps %s carried in a data: URL",
    async (_label: string, mimeType: string, base64: string) => {
      const html: string = await render(
        `![Login page](data:${mimeType};base64,${base64})`,
      );

      expect(html).toContain(
        `<img src="data:${mimeType};base64,${base64}" alt="Login page" style="${EMAIL_IMAGE_STYLE}">`,
      );
    },
  );

  /*
   * The template from the issue: the error text, then the screenshot with no
   * alt text. Since ea611c316 the image rendered as its alt text - nothing at
   * all - so the email said only what the error was.
   */
  test("keeps a screenshot with no alt text, after the error it shows", async () => {
    const html: string = await render(
      `Timeout 30000ms exceeded\n![](data:image/png;base64,${PNG})`,
    );

    expect(html).toBe(
      `<p>Timeout 30000ms exceeded\n<img src="data:image/png;base64,${PNG}" alt="" style="${EMAIL_IMAGE_STYLE}"></p>\n`,
    );
  });

  test("writes a JPEG placed into an image/png template out as the JPEG it is", async () => {
    const html: string = await render(
      `![Checkout](data:image/png;base64,${JPEG})`,
    );

    expect(urlsIn(html)).toEqual([`data:image/jpeg;base64,${JPEG}`]);
  });

  test("writes the URL out from what it checked, in lower case", async () => {
    const html: string = await render(`![Shot](DATA:IMAGE/PNG;BASE64,${PNG})`);

    expect(urlsIn(html)).toEqual([`data:image/png;base64,${PNG}`]);
  });

  test("keeps the alt text and title escaped, as for any other image", async () => {
    const html: string = await render(
      `![Login <page> & "form"](data:image/png;base64,${PNG} "Taken <at> 10:00")`,
    );

    expect(html).toContain('alt="Login &lt;page&gt; &amp; &quot;form&quot;"');
    expect(html).toContain('title="Taken &lt;at&gt; 10:00"');
    expect(urlsIn(html)).toEqual([`data:image/png;base64,${PNG}`]);
  });

  test("keeps an inline image in a reference-style image, a table and a list", async () => {
    const html: string = await render(
      [
        "![Shot][shot]",
        "",
        "| Browser | Screenshot |",
        "| --- | --- |",
        `| Chromium | ![Chromium](data:image/png;base64,${PNG}) |`,
        "",
        `- Firefox: ![Firefox](data:image/jpeg;base64,${JPEG})`,
        "",
        `[shot]: data:image/png;base64,${PNG}`,
      ].join("\n"),
    );

    expect(urlsIn(html)).toEqual([
      `data:image/png;base64,${PNG}`,
      `data:image/png;base64,${PNG}`,
      `data:image/jpeg;base64,${JPEG}`,
    ]);
  });

  test("a data: link is never kept, even when it carries an image", async () => {
    const html: string = await render(
      [
        `[Open the screenshot](data:image/png;base64,${PNG})`,
        "",
        `[![Shot](data:image/png;base64,${PNG})](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)`,
      ].join("\n"),
    );

    expect(html).not.toContain("<a ");
    expect(html.toLowerCase()).not.toContain("href=");
    expect(html).toContain("Open the screenshot");
    // The image inside the dropped link is still an image.
    expect(urlsIn(html)).toEqual([`data:image/png;base64,${PNG}`]);
  });

  test("an inline image inside an https link keeps both", async () => {
    const html: string = await render(
      `[![Shot](data:image/png;base64,${PNG})](https://oneuptime.example.com/incidents/1)`,
    );

    expect(urlsIn(html)).toEqual([
      "https://oneuptime.example.com/incidents/1",
      `data:image/png;base64,${PNG}`,
    ]);
  });

  test("an inline image as raw HTML is still escaped, as all raw HTML is", async () => {
    const html: string = await render(
      `<img src="data:image/png;base64,${PNG}" onerror="alert(1)">`,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("an inline image stays out of the Docs and Blog renderers' business", async () => {
    const markdown: string = `![Shot](data:image/png;base64,${PNG})`;

    expect(
      await Markdown.convertToHTML(markdown, MarkdownContentType.Docs),
    ).toContain(`src="data:image/png;base64,${PNG}"`);
    expect(
      await Markdown.convertToHTML(markdown, MarkdownContentType.Blog),
    ).toContain(`src="data:image/png;base64,${PNG}"`);
  });

  test("renders a screenshot of several megabytes", async () => {
    const base64: string = Buffer.concat([
      Buffer.from(PNG, "base64"),
      Buffer.alloc(3 * 1024 * 1024, 0x5a),
    ]).toString("base64");

    const html: string = await render(
      `Login failed\n\n![Login](data:image/png;base64,${base64})`,
    );

    expect(urlsIn(html)).toEqual([`data:image/png;base64,${base64}`]);
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
