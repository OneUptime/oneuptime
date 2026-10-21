import { describe, expect, jest, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";
import { markdownUrlTransform } from "../../../UI/Components/Markdown.tsx/MarkdownUrlTransform";

/*
 * Which URLs the dashboard's Markdown viewer keeps. react-markdown's default
 * blanks every data: URL, so a synthetic monitor's screenshot in an incident
 * description showed as an empty image on the incident page and the status
 * page, while the same description's email showed it (issue #4532). An
 * image's src may now be an inline raster image; everything else is left to
 * the default.
 */

jest.mock("react-markdown", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
    defaultUrlTransform: (url: string): string => {
      return `default(${url})`;
    },
  };
});

// Real 1x1 images, as Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

type TransformNode = Parameters<typeof markdownUrlTransform>[2];

function element(tagName: string): TransformNode {
  return {
    type: "element",
    tagName: tagName,
    properties: {},
    children: [],
  } as TransformNode;
}

describe("markdownUrlTransform", () => {
  test("keeps an inline PNG as an image's src", () => {
    expect(
      markdownUrlTransform(
        `data:image/png;base64,${PNG}`,
        "src",
        element("img"),
      ),
    ).toBe(`data:image/png;base64,${PNG}`);
  });

  test("keeps an inline JPEG in an image/png URL, as the JPEG it is", () => {
    expect(
      markdownUrlTransform(
        `data:image/png;base64,${JPEG}`,
        "src",
        element("img"),
      ),
    ).toBe(`data:image/jpeg;base64,${JPEG}`);
  });

  test.each([
    ["an SVG", "data:image/svg+xml;base64,PHN2Zy8+"],
    ["HTML", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["a PNG whose bytes are not a PNG", "data:image/png;base64,AAAA"],
    ["an https URL", "https://example.com/a.png"],
    ["a relative URL", "/image/access-token/abc"],
  ])(
    "leaves an image's src that is %s to react-markdown's default",
    (_label: string, url: string) => {
      expect(markdownUrlTransform(url, "src", element("img"))).toBe(
        `default(${url})`,
      );
    },
  );

  test("never keeps a data: link, even one that carries an image", () => {
    const url: string = `data:image/png;base64,${PNG}`;

    expect(markdownUrlTransform(url, "href", element("a"))).toBe(
      `default(${url})`,
    );
  });

  test("keeps an inline image only for an <img>", () => {
    const url: string = `data:image/png;base64,${PNG}`;

    expect(markdownUrlTransform(url, "src", element("video"))).toBe(
      `default(${url})`,
    );
    expect(markdownUrlTransform(url, "cite", element("blockquote"))).toBe(
      `default(${url})`,
    );
  });
});

/*
 * The same transform with the real react-markdown and remark-gfm the
 * dashboard renders with. Jest stubs both (they are ES modules), so they are
 * bundled with the transform by esbuild and rendered to HTML in a node
 * subprocess - esbuild refuses to load under the jsdom environment Common's
 * jest uses (see EsbuildConfig.test.ts).
 */
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const RENDER_SCRIPT: string = String.raw`
  const esbuild = require("esbuild");
  const Module = require("module");
  const path = require("path");

  const entry = [
    'import React from "react";',
    'import { renderToStaticMarkup } from "react-dom/server";',
    'import ReactMarkdown from "react-markdown";',
    'import remarkGfm from "remark-gfm";',
    'import { markdownUrlTransform } from "./UI/Components/Markdown.tsx/MarkdownUrlTransform";',
    "const texts = JSON.parse(process.env.MARKDOWN_TEXTS);",
    "const render = (urlTransform) => texts.map((text) => renderToStaticMarkup(",
    "  React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], urlTransform }, text),",
    "));",
    "process.stdout.write(JSON.stringify({",
    "  viewer: render(markdownUrlTransform),",
    "  defaults: render(undefined),",
    "}));",
  ].join("\n");

  esbuild
    .build({
      stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts", sourcefile: "render.ts" },
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    })
    .then((result) => {
      const file = path.join(process.cwd(), "render.js");
      const compiled = new Module(file);
      compiled.filename = file;
      compiled.paths = Module._nodeModulePaths(process.cwd());
      compiled._compile(result.outputFiles[0].text, file);
    })
    .catch((error) => {
      process.stderr.write(String(error && error.stack ? error.stack : error));
      process.exit(1);
    });
`;

interface Rendered {
  viewer: Array<string>;
  defaults: Array<string>;
}

function renderWithReactMarkdown(texts: Array<string>): Rendered {
  return JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", RENDER_SCRIPT], {
      cwd: COMMON_ROOT,
      env: { ...process.env, MARKDOWN_TEXTS: JSON.stringify(texts) },
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as Rendered;
}

describe("the Markdown viewer's URLs, with the real react-markdown", () => {
  const texts: Array<string> = [
    // 0: the template from the issue
    `Timeout 30000ms exceeded\n![](data:image/png;base64,${PNG})`,
    // 1: a JPEG labelled image/png
    `![Checkout](data:image/png;base64,${JPEG})`,
    // 2: a reference-style image
    `![Shot][shot]\n\n[shot]: data:image/png;base64,${PNG}`,
    // 3: an SVG
    "![Graph](data:image/svg+xml;base64,PHN2Zy8+)",
    // 4: a PNG URL whose bytes are not a PNG
    "![Graph](data:image/png;base64,AAAA)",
    // 5: a data: link
    `[Open](data:image/png;base64,${PNG})`,
    // 6: a data: HTML link
    "[Open](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    // 7: a javascript: link
    "[Open](javascript:alert(1))",
    // 8: an https image and link
    "[![Graph](https://cdn.example.com/g.png)](https://example.com/x)",
    // 9: raw HTML
    `<img src="data:image/png;base64,${PNG}">`,
  ];

  const rendered: Rendered = renderWithReactMarkdown(texts);

  test("react-markdown's default blanks the screenshot - the empty image the incident page showed", () => {
    expect(rendered.defaults[0]).toContain('<img src="" alt=""/>');
  });

  test("the viewer shows the screenshot", () => {
    expect(rendered.viewer[0]).toBe(
      `<p>Timeout 30000ms exceeded\n<img src="data:image/png;base64,${PNG}" alt=""/></p>`,
    );
  });

  test("the viewer shows a JPEG labelled image/png, as a JPEG", () => {
    expect(rendered.viewer[1]).toContain(
      `<img src="data:image/jpeg;base64,${JPEG}" alt="Checkout"/>`,
    );
  });

  test("the viewer shows a reference-style inline image", () => {
    expect(rendered.viewer[2]).toContain(
      `<img src="data:image/png;base64,${PNG}" alt="Shot"/>`,
    );
  });

  test("the viewer still blanks every other data: image", () => {
    expect(rendered.viewer[3]).toContain('<img src="" alt="Graph"/>');
    expect(rendered.viewer[4]).toContain('<img src="" alt="Graph"/>');
  });

  test("the viewer still blanks every data: and javascript: link", () => {
    expect(rendered.viewer[5]).toBe('<p><a href="">Open</a></p>');
    expect(rendered.viewer[6]).toBe('<p><a href="">Open</a></p>');
    expect(rendered.viewer[7]).toBe('<p><a href="">Open</a></p>');
  });

  test("the viewer keeps https images and links as before", () => {
    expect(rendered.viewer[8]).toBe(rendered.defaults[8]);
    expect(rendered.viewer[8]).toContain(
      '<a href="https://example.com/x"><img src="https://cdn.example.com/g.png" alt="Graph"/></a>',
    );
  });

  test("raw HTML is still shown as text, never as an image", () => {
    expect(rendered.viewer[9]).not.toContain("<img");
    expect(rendered.viewer[9]).toBe(rendered.defaults[9]);
  });
});
