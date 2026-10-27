import { describe, expect, test } from "@jest/globals";
import {
  MarkupReference,
  addressHost,
  emailTemplateProblems,
  isAbsoluteWebAddress,
  pageLoadProblems,
  readCssReferences,
  readMarkupReferences,
  readTextAddresses,
  withoutTemplateComments,
} from "./MarkupReferences";
import { fastestRun, FastestRun } from "./FastestRun";

/*
 * The reader behind the guards that keep pages and emails from loading
 * anything from another host (OfflineAssetHygiene.test.ts, and the App's
 * EmailsLoadNothingFromOutside.test.ts). A guard is only as good as what it
 * reads, so each way an element can load an address is read here once:
 * the guard would pass a template it could not read.
 */

// The one line of issue #5124: every email's header logo.
const CLOUDINARY_LOGO: string =
  '<img src="https://res.cloudinary.com/deityhub/image/upload/v1637736803/1png.png" width="32" height="32" alt="OneUptime">';

const loaded: (markup: string) => Array<string> = (
  markup: string,
): Array<string> => {
  return readMarkupReferences(markup)
    .filter((reference: MarkupReference): boolean => {
      return reference.loads;
    })
    .map((reference: MarkupReference): string => {
      return reference.value;
    });
};

describe("readMarkupReferences - what an element loads", () => {
  test.each([
    ["an image", CLOUDINARY_LOGO, "img", "src"],
    [
      "an image in upper case, single-quoted",
      "<IMG SRC='https://cdn.example/a.png'>",
      "img",
      "src",
    ],
    [
      "an image, unquoted",
      "<img alt=x src=https://cdn.example/a.png>",
      "img",
      "src",
    ],
    [
      "an image with a > in a quoted value before its src",
      '<img alt="a > b" src="https://cdn.example/a.png">',
      "img",
      "src",
    ],
    [
      "a script",
      '<script src="https://cdn.example/a.js"></script>',
      "script",
      "src",
    ],
    [
      "a frame",
      '<iframe src="https://cdn.example/a.html"></iframe>',
      "iframe",
      "src",
    ],
    [
      "an image button",
      '<input type="image" src="https://cdn.example/a.png">',
      "input",
      "src",
    ],
    [
      "a table cell's background",
      '<td background="https://cdn.example/bg.png">',
      "td",
      "background",
    ],
    [
      "a video's poster",
      '<video poster="https://cdn.example/a.png"></video>',
      "video",
      "poster",
    ],
    [
      "an object's data",
      '<object data="https://cdn.example/a.swf"></object>',
      "object",
      "data",
    ],
    [
      "a stylesheet",
      '<link rel="stylesheet" href="https://cdn.example/a.css">',
      "link",
      "href",
    ],
    [
      "an icon",
      '<link rel="icon" href="https://cdn.example/a.ico">',
      "link",
      "href",
    ],
    [
      "a connection made ahead",
      '<link rel="preconnect" href="https://fonts.gstatic.com">',
      "link",
      "href",
    ],
    [
      "an SVG image",
      '<svg><image href="https://cdn.example/a.png"/></svg>',
      "image",
      "href",
    ],
    [
      "an SVG image by xlink",
      '<svg><image xlink:href="https://cdn.example/a.png"/></svg>',
      "image",
      "xlink:href",
    ],
    [
      "a CSS background in a style attribute",
      "<div style=\"background-image: url('https://cdn.example/bg.png')\">",
      "div",
      "url()",
    ],
  ])(
    "%s",
    (_label: string, markup: string, element: string, attribute: string) => {
      const references: Array<MarkupReference> = readMarkupReferences(markup);

      expect(references).toHaveLength(1);
      expect(references[0]!.element).toBe(element);
      expect(references[0]!.attribute).toBe(attribute);
      expect(references[0]!.loads).toBe(true);
      expect(addressHost(references[0]!.value)).not.toBeNull();
    },
  );

  test("every candidate of a srcset", () => {
    expect(
      loaded(
        '<img srcset="https://cdn.example/a.png 1x, //cdn.example/b.png 2x">',
      ),
    ).toEqual(["https://cdn.example/a.png", "//cdn.example/b.png"]);
  });

  test("url() and @import in a <style> element, not in its comments", () => {
    const style: string =
      "<style>/* url(https://comment.example/x.png) */@import url(\"https://fonts.googleapis.com/css2?family=Inter\");@import 'https://cdn.example/b.css';.x{background:url(https://cdn.example/a.png)}</style>";

    expect(loaded(style)).toEqual([
      "https://fonts.googleapis.com/css2?family=Inter",
      "https://cdn.example/a.png",
      "https://cdn.example/b.css",
    ]);
  });

  test("what Outlook shows inside a conditional comment", () => {
    expect(
      loaded(
        '<!--[if mso]><v:rect><v:fill type="frame" src="https://cdn.example/bg.png"/></v:rect><![endif]-->',
      ),
    ).toEqual(["https://cdn.example/bg.png"]);
  });

  test("a template's value, as it is written", () => {
    expect(
      loaded(
        '<img src="{{logoUrl}}"><img src="{{{@root.oneUptimeLogoUrl}}}"><img src="<%= logoUrl %>">',
      ),
    ).toEqual([
      "{{logoUrl}}",
      "{{{@root.oneUptimeLogoUrl}}}",
      "<%= logoUrl %>",
    ]);
  });
});

describe("readMarkupReferences - what nothing loads", () => {
  test.each([
    ["a comment", '<!-- <img src="https://cdn.example/a.png"> -->'],
    [
      "a namespace",
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    ],
    [
      "a link that only says where something is",
      '<link rel="canonical" href="https://oneuptime.com/docs">',
    ],
    [
      "escaped markup, as text",
      "<p>&lt;img src=&quot;https://cdn.example/a.png&quot;&gt;</p>",
    ],
  ])("%s", (_label: string, markup: string) => {
    expect(loaded(markup)).toEqual([]);
  });

  test("a link and an address in text are read, as loading nothing", () => {
    expect(
      readMarkupReferences(
        '<a href="https://oneuptime.com">OneUptime</a><p>See https://docs.example/page.</p>',
      ),
    ).toEqual([
      {
        element: "a",
        attribute: "href",
        value: "https://oneuptime.com",
        loads: false,
      },
      {
        element: "#text",
        attribute: "",
        value: "https://docs.example/page",
        loads: false,
      },
    ]);
  });
});

describe("addressHost", () => {
  test.each([
    ["https://Res.Cloudinary.com/x.png", "res.cloudinary.com"],
    ["http://cdn.example:8080/a", "cdn.example:8080"],
    ["//cdn.example/a.png", "cdn.example"],
    ["  https://cdn.example/a.png  ", "cdn.example"],
    ["https://{{host}}/logo.png", "{{host}}"],
  ])("%s names %s", (address: string, host: string) => {
    expect(addressHost(address)).toBe(host);
  });

  test.each([
    "/oneuptime-assets/brand/oneuptime-logo.svg",
    "data:image/png;base64,iVBORw0KGgo=",
    "cid:6b1f@oneuptime",
    "mailto:support@oneuptime.com",
    "{{logoUrl}}",
    "",
  ])("%j names no host", (address: string) => {
    expect(addressHost(address)).toBeNull();
    expect(isAbsoluteWebAddress(address)).toBe(false);
  });

  test("an address written out whose host cannot be read is never taken for none", () => {
    expect(addressHost("https://")).toBe("(unreadable)");
    expect(addressHost("https://exa mple.com/x")).toBe("(unreadable)");
  });
});

describe("emailTemplateProblems", () => {
  const LINK_HOSTS: ReadonlyArray<string> = ["oneuptime.com"];

  test("catches the logo of issue #5124", () => {
    expect(emailTemplateProblems(CLOUDINARY_LOGO, LINK_HOSTS)).toEqual([
      'img src "https://res.cloudinary.com/deityhub/image/upload/v1637736803/1png.png" loads an address the template writes itself',
    ]);
  });

  test.each([
    ["a path no mail client can find", '<img src="/img/logo.png">'],
    ["a protocol-relative image", '<img src="//cdn.example/logo.png" alt="x">'],
    [
      "a srcset",
      '<img src="{{logoUrl}}" srcset="https://cdn.example/a.png 2x">',
    ],
    [
      "a url() in a style attribute",
      '<td style="background: #000 url(https://cdn.example/a.png)">',
    ],
    [
      "a font @import in the <style> block",
      "<style>@import url('https://fonts.googleapis.com/css2?family=Inter');</style>",
    ],
    [
      "a stylesheet",
      '<link rel="stylesheet" href="https://cdn.example/email.css">',
    ],
    [
      "a tracking pixel",
      '<img src="https://track.example/open.gif" width="1" height="1">',
    ],
    [
      "an Outlook background",
      '<!--[if mso]><v:fill src="https://cdn.example/bg.png"/><![endif]-->',
    ],
    [
      "an EJS image with a host of its own",
      '<img src="https://cdn.example/<%= name %>.png">',
    ],
    ["a link elsewhere", '<a href="https://evil.example/x">Open</a>'],
    [
      "an address handed to a partial",
      '{{> ButtonBlock buttonUrl="https://evil.example/x" buttonText="Open"}}',
    ],
    ["an address in its text", "<p>Read https://docs.example/page</p>"],
  ])("catches %s", (_label: string, source: string) => {
    expect(emailTemplateProblems(source, LINK_HOSTS)).toHaveLength(1);
  });

  test.each([
    ["a value it is given", '<img src="{{logoUrl}}" alt="Logo">'],
    [
      "OneUptime's logo, carried in the email",
      '<img src="{{{@root.oneUptimeLogoUrl}}}" alt="OneUptime">',
    ],
    [
      "an inline image",
      '<img src="cid:6b1f@oneuptime"><img src="data:image/png;base64,iVBORw0KGgo=">',
    ],
    ["an EJS value", '<img src="<%= logoUrl %>">'],
    [
      "a link to an allowed host",
      '<a href="https://oneuptime.com" style="color: #475569;">OneUptime</a>',
    ],
    ["a mail address", '<a href="mailto:support@oneuptime.com">Contact</a>'],
    ["a namespace", '<html xmlns="http://www.w3.org/1999/xhtml" lang="en">'],
    [
      "an address in a comment its language takes out",
      `{{!-- ${CLOUDINARY_LOGO} --}}{{! https://evil.example }}<%# ${CLOUDINARY_LOGO} %>`,
    ],
    ["an address in an HTML comment", `<!-- ${CLOUDINARY_LOGO} -->`],
    ["a background colour", '<td style="background-color: #111111;">'],
  ])("lets %s through", (_label: string, source: string) => {
    expect(emailTemplateProblems(source, LINK_HOSTS)).toEqual([]);
  });
});

describe("pageLoadProblems", () => {
  test("catches what a page loads from a host it does not allow", () => {
    expect(
      pageLoadProblems(
        `<script src="https://cdn.tailwindcss.com"></script>${CLOUDINARY_LOGO}<link rel="stylesheet" href="https://fonts.googleapis.com/css2">`,
        ["fonts.googleapis.com"],
      ),
    ).toEqual([
      'script src "https://cdn.tailwindcss.com" loads from cdn.tailwindcss.com',
      'img src "https://res.cloudinary.com/deityhub/image/upload/v1637736803/1png.png" loads from res.cloudinary.com',
    ]);
  });

  test("lets the installation's own paths, links and metadata through", () => {
    expect(
      pageLoadProblems(
        '<img src="/oneuptime-assets/brand/oneuptime-logo.svg"><a href="https://github.com/OneUptime/oneuptime">GitHub</a><meta property="og:image" content="https://oneuptime.com/img/hou-wb.svg"><link rel="canonical" href="https://oneuptime.com/docs">',
        [],
      ),
    ).toEqual([]);
  });
});

describe("withoutTemplateComments", () => {
  test("takes out what the template's language never renders, and nothing else", () => {
    expect(
      withoutTemplateComments(
        "a{{!-- b }} c --}}d{{! e }}f<%# g %>h<!-- i -->{{j}}<%= k %>",
      ),
    ).toBe("adfh<!-- i -->{{j}}<%= k %>");
  });

  test("an unclosed comment runs to the end, as the language reads it", () => {
    expect(withoutTemplateComments("a{{!-- b")).toBe("a");
  });
});

describe("linear time on text nobody wrote for it", () => {
  /*
   * A guard reads every template and every email the tests render: none
   * may take time that grows with the square of its length.
   */
  test.each([
    ["addresses that never end", "http://".repeat(60000)],
    ["unclosed url(", "url(".repeat(100000)],
    ["unclosed @import", "@import '".repeat(45000)],
    ["unclosed comments", "{{!--".repeat(80000)],
    ["unclosed tags", "<img src=".repeat(45000)],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        readTextAddresses(text);
        readCssReferences(text, "style");
        withoutTemplateComments(text);
        readMarkupReferences(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
