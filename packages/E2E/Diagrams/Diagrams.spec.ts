import {
  ConsoleMessage,
  Locator,
  Page,
  Response,
  Route,
  expect,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Diagrams in a real browser, the three ways OneUptime draws them: the
 * Dashboard's MarkdownViewer, the docs and the blog. Each runs mermaid built
 * from its ES module source, with the katex npm installed for Common - none
 * of mermaid's prebuilt bundles, which carry their own copies. jsdom draws
 * nothing (mermaid measures text with the browser's layout), so this is the
 * one place a diagram, and a $$...$$ label set by KaTeX, is seen being drawn.
 */

const INSTALLED_KATEX_VERSION: string = (
  JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../Common/node_modules/katex/package.json"),
      "utf8",
    ),
  ) as { version: string }
).version;

// KaTeX's own error prefix: in every copy of katex, minified or not.
const KATEX_MARKER: string = "KaTeX parse error";

/*
 * mermaid's prebuilt bundles by name, and the shim that used to inline
 * dist/mermaid.min.js into the frontends' bundles.
 */
const PREBUILT_MERMAID: RegExp =
  /mermaid(?:\.(?:esm|min|core))+\.m?js|\/mermaid\.js|mermaid-wrapper/;

const KATEX_CHUNK: RegExp = /\/katex-[A-Z0-9]+\.m?js$/;

// Any file of mermaid's or KaTeX's, by name.
const DIAGRAM_CODE: RegExp = /mermaid|katex/;

// mermaid's "dark" and "default" themes, as their stylesheets set them.
const DARK_THEME_FILL: RegExp = /#1f2020/i;
const DEFAULT_THEME_FILL: RegExp = /#ececff/i;

type ResponsesFunction = (page: Page) => Array<Response>;

// Every response the page gets, from before it navigates.
const recordResponses: ResponsesFunction = (page: Page): Array<Response> => {
  const responses: Array<Response> = [];

  page.on("response", (response: Response) => {
    responses.push(response);
  });

  return responses;
};

type PathOfFunction = (response: Response) => string;

const pathOf: PathOfFunction = (response: Response): string => {
  return new URL(response.url()).pathname;
};

type ExpectSourceBuildFunction = (
  responses: Array<Response>,
  options: { katex: boolean },
) => Promise<void>;

/*
 * Nothing prebuilt was asked for, and KaTeX - when the page needed it - came
 * as one chunk of its own holding the installed version.
 */
const expectSourceBuild: ExpectSourceBuildFunction = async (
  responses: Array<Response>,
  options: { katex: boolean },
): Promise<void> => {
  expect(
    responses.map(pathOf).filter((urlPath: string): boolean => {
      return PREBUILT_MERMAID.test(urlPath);
    }),
  ).toEqual([]);

  const katex: Array<Response> = responses.filter(
    (response: Response): boolean => {
      return KATEX_CHUNK.test(pathOf(response));
    },
  );

  if (!options.katex) {
    expect(katex.map(pathOf)).toEqual([]);
    return;
  }

  expect(katex).toHaveLength(1);

  const chunk: Response = katex[0] as Response;
  const text: string = await chunk.text();

  expect(chunk.status()).toBe(200);
  expect(text).toContain(KATEX_MARKER);
  expect(text).toContain(`"${INSTALLED_KATEX_VERSION}"`);
};

type ConsoleErrorsFunction = (page: Page) => Array<string>;

// Every console error the page logs, from before it navigates.
const recordConsoleErrors: ConsoleErrorsFunction = (
  page: Page,
): Array<string> => {
  const errors: Array<string> = [];

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  return errors;
};

// What mermaid draws in place of a diagram that does not parse.
const MERMAID_SYNTAX_ERROR: string = "Syntax error in text";

type StyleOfFunction = (svg: Locator) => Promise<string>;

// The stylesheet mermaid writes into each diagram, which names its theme.
const styleOf: StyleOfFunction = async (svg: Locator): Promise<string> => {
  return (await svg.locator("style").first().textContent()) || "";
};

type LeftoversFunction = (page: Page) => Promise<Array<string>>;

/*
 * What mermaid leaves where a page did not ask for it: the working element
 * it draws in (<div id="d{diagram id}">), and its "Syntax error in text"
 * graphic anywhere at all.
 */
const mermaidLeftovers: LeftoversFunction = async (
  page: Page,
): Promise<Array<string>> => {
  return page.evaluate(() => {
    const found: Array<string> = [];

    for (const element of Array.from(
      document.querySelectorAll('[id^="dmermaid-"], [id^="ddocs-diagram-"]'),
    )) {
      found.push("working element #" + element.id);
    }

    for (const svg of Array.from(document.querySelectorAll("svg"))) {
      if ((svg.textContent || "").includes("Syntax error in text")) {
        found.push(
          "syntax error graphic in " +
            String(svg.parentElement?.tagName) +
            " #" +
            String(svg.parentElement?.id),
        );
      }
    }

    return found;
  });
};

type PageErrorsFunction = (page: Page) => Array<string>;

// Every uncaught error and unhandled rejection, from before it navigates.
const recordPageErrors: PageErrorsFunction = (page: Page): Array<string> => {
  const errors: Array<string> = [];

  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  return errors;
};

test.describe("the Dashboard's markdown viewer", () => {
  const diagramsIn: (page: Page) => Locator = (page: Page): Locator => {
    return page.getByTestId("markdown").locator('svg[id^="mermaid-"]');
  };

  test("draws each diagram, the one with a $$...$$ label included", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/dashboard");

    await expect(diagramsIn(page)).toHaveCount(2);
    await expect(diagramsIn(page).first()).toContainText("Plain label");
    await expect(diagramsIn(page).nth(1)).toContainText("Hello Bob");
    await expect(page.getByText("Error rendering diagram")).toHaveCount(0);

    /*
     * KaTeX set the label, and the viewer's sanitizer let its MathML
     * through: x^2 + y^2 = z^2, three superscripts, drawn in the label.
     */
    const math: Locator = diagramsIn(page)
      .first()
      .locator("foreignObject math");

    await expect(math).toHaveCount(1);
    await expect(math.locator("msup")).toHaveCount(3);
    await expect(math).toBeVisible();

    const box: { width: number; height: number } | null =
      await math.boundingBox();

    expect(box?.width || 0).toBeGreaterThan(20);
    expect(box?.height || 0).toBeGreaterThan(8);

    await expectSourceBuild(responses, { katex: true });
  });

  test("keeps the $$...$$ label drawn when the theme changes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard");
    await expect(diagramsIn(page)).toHaveCount(2);
    await expect(diagramsIn(page).first().locator("math")).toHaveCount(1);

    await page.getByRole("button", { name: "Toggle theme" }).click();

    await expect
      .poll(async () => {
        return styleOf(diagramsIn(page).first());
      })
      .toMatch(DARK_THEME_FILL);
    await expect(diagramsIn(page)).toHaveCount(2);
    await expect(
      diagramsIn(page).first().locator("foreignObject math msup"),
    ).toHaveCount(3);
    expect(await mermaidLeftovers(page)).toEqual([]);
  });

  test("keeps only KaTeX's MathML in the label, and no HTML", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard");
    await expect(diagramsIn(page)).toHaveCount(2);

    const inDiagram: Array<{ tag: string; namespace: string | null }> =
      await diagramsIn(page)
        .first()
        .evaluate((svg: SVGSVGElement) => {
          return Array.from(svg.querySelectorAll("*")).map(
            (element: Element) => {
              return {
                tag: element.localName,
                namespace: element.namespaceURI,
              };
            },
          );
        });

    const mathml: Array<string> = inDiagram
      .filter((element: { namespace: string | null }): boolean => {
        return element.namespace === "http://www.w3.org/1998/Math/MathML";
      })
      .map((element: { tag: string }): string => {
        return element.tag;
      });

    expect([...new Set(mathml)].sort()).toEqual([
      "math",
      "mi",
      "mn",
      "mo",
      "mrow",
      "msup",
    ]);
    expect(
      inDiagram.filter((element: { namespace: string | null }): boolean => {
        return element.namespace === "http://www.w3.org/1999/xhtml";
      }),
    ).toEqual([]);
  });

  test("fetches KaTeX only for a diagram with a $$...$$ label", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/dashboard?diagrams=plain");

    await expect(diagramsIn(page)).toHaveCount(1);
    await expect(diagramsIn(page).first()).toContainText("Hello Alice");
    await expectSourceBuild(responses, { katex: false });
  });

  test("fetches no diagram code for markdown without a diagram", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/dashboard?diagrams=none");

    await expect(page.getByText("Just text, and")).toBeVisible();
    // Give a stray lazy import the time it would take to start.
    await page.waitForTimeout(500);

    expect(
      responses.map(pathOf).filter((urlPath: string): boolean => {
        return DIAGRAM_CODE.test(urlPath);
      }),
    ).toEqual([]);
  });

  test("redraws a diagram when the theme changes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard?diagrams=plain");
    await expect(diagramsIn(page)).toHaveCount(1);

    /*
     * mermaid's default theme, with the line colour the viewer sets for
     * light mode (MarkdownViewer's themeVariables)...
     */
    await expect
      .poll(async () => {
        return styleOf(diagramsIn(page).first());
      })
      .toMatch(/\.marker\{fill:#64748b/i);
    expect(await styleOf(diagramsIn(page).first())).toMatch(DEFAULT_THEME_FILL);

    await page.getByRole("button", { name: "Toggle theme" }).click();

    // ...then its dark theme, with the viewer's dark line colour.
    await expect
      .poll(async () => {
        return styleOf(diagramsIn(page).first());
      })
      .toMatch(/\.marker\{fill:#94a3b8/i);
    expect(await styleOf(diagramsIn(page).first())).toMatch(DARK_THEME_FILL);
    await expect(diagramsIn(page).first()).toContainText("Hello Bob");
  });

  test("says so when a diagram does not parse, rather than drawing nothing", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard?diagrams=broken");

    await expect(page.getByText(/Error rendering diagram/)).toBeVisible();
  });

  test("a diagram that does not parse leaves nothing of mermaid's in the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard?diagrams=broken");

    await expect(
      page.getByTestId("markdown").getByText(/Error rendering diagram/),
    ).toBeVisible();
    // Mermaid used to leave its error graphic at the end of the page body.
    expect(await mermaidLeftovers(page)).toEqual([]);
  });

  test("draws the diagrams that parse next to one that does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard?diagrams=mixed");

    await expect(diagramsIn(page)).toHaveCount(2);
    await expect(diagramsIn(page).first().locator("math")).toHaveCount(1);
    await expect(diagramsIn(page).nth(1)).toContainText("Hello Bob");
    await expect(
      page.getByTestId("markdown").getByText(/Error rendering diagram/),
    ).toHaveCount(1);
    expect(await mermaidLeftovers(page)).toEqual([]);
  });

  test("redrawing a diagram that does not parse adds nothing to the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/dashboard?diagrams=broken");
    await expect(page.getByText(/Error rendering diagram/)).toBeVisible();

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.getByText(/Error rendering diagram/)).toBeVisible();
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.getByText(/Error rendering diagram/)).toBeVisible();
    // Let the last redraw settle.
    await page.waitForTimeout(300);

    await expect(page.getByText(/Error rendering diagram/)).toHaveCount(1);
    expect(await mermaidLeftovers(page)).toEqual([]);
  });
});

test.describe("the docs", () => {
  const diagramsIn: (page: Page) => Locator = (page: Page): Locator => {
    return page.locator(".docs-diagram .mermaid svg");
  };

  test("draws each diagram, a $$...$$ label as KaTeX's MathML", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/docs");

    await expect(diagramsIn(page)).toHaveCount(2);
    await expect(diagramsIn(page).first()).toContainText("Plain label");
    await expect(diagramsIn(page).nth(1)).toContainText("Hello Bob");

    const math: Locator = diagramsIn(page).first().locator("math");

    await expect(math).toHaveCount(1);
    await expect(math.locator("msup")).toHaveCount(3);

    await expectSourceBuild(responses, { katex: true });
  });

  test("imports the build from /oneuptime-assets/mermaid/, every file found", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/docs");
    await expect(diagramsIn(page)).toHaveCount(2);

    const mermaid: Array<Response> = responses.filter(
      (response: Response): boolean => {
        return pathOf(response).startsWith("/oneuptime-assets/mermaid/");
      },
    );

    expect(mermaid.map(pathOf)).toContain(
      "/oneuptime-assets/mermaid/mermaid.mjs",
    );
    expect(
      mermaid
        .filter((response: Response): boolean => {
          return response.status() !== 200;
        })
        .map(pathOf),
    ).toEqual([]);
  });

  test("draws the diagrams that parse when one on the page does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = recordConsoleErrors(page);

    await page.goto("/docs?diagrams=broken");

    const blocks: Locator = page.locator(".docs-diagram .mermaid");

    await expect(blocks).toHaveCount(3);
    await expect(blocks.nth(1).locator("svg")).toContainText("Plain label");
    await expect(blocks.nth(2).locator("svg")).toContainText("Hello Bob");
    // The one that does not parse keeps its source.
    await expect(blocks.first()).toHaveText(/graph LR\s+A -->/);
    await expect(blocks.first().locator("svg")).toHaveCount(0);

    await expect
      .poll(() => {
        return errors.filter((text: string): boolean => {
          return text.includes("Mermaid could not render a diagram");
        }).length;
      })
      .toBe(1);
  });

  test("says in place that a diagram could not be drawn, shows its source as written, and leaves nothing else", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/docs?diagrams=broken");

    const broken: Locator = page.locator(".docs-diagram").first();

    await expect(page.locator(".docs-diagram .mermaid svg")).toHaveCount(2);

    // One short note, in the broken diagram's own box, above its source.
    const note: Locator = broken.locator(".docs-diagram__note");

    await expect(note).toHaveText("This diagram could not be drawn.");
    await expect(page.locator(".docs-diagram__note")).toHaveCount(1);

    // The source as it was written: line breaks and indentation kept.
    const source: Locator = broken.locator(".mermaid");

    expect(await source.textContent()).toBe("graph LR\n  A -->");
    expect(
      await source.evaluate((element: Element) => {
        return getComputedStyle(element).whiteSpace;
      }),
    ).toBe("pre");

    const noteBox: { y: number } | null = await note.boundingBox();
    const sourceBox: { y: number } | null = await source.boundingBox();

    expect(noteBox?.y || 0).toBeLessThan(sourceBox?.y || 0);

    // Mermaid used to leave its error graphic at the end of the page body.
    expect(await mermaidLeftovers(page)).toEqual([]);
  });

  test("ends in the last theme, every label drawn, when the theme is switched twice in a row", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = recordConsoleErrors(page);

    await page.goto("/docs");
    await expect(diagramsIn(page)).toHaveCount(2);

    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      window.dispatchEvent(new Event("docs:themechange"));
      document.documentElement.classList.remove("dark");
      window.dispatchEvent(new Event("docs:themechange"));
    });

    // The third draw (the page's own, then two switches) is the one shown.
    await expect(
      page.locator('.docs-diagram .mermaid svg[id^="docs-diagram-3-"]'),
    ).toHaveCount(2);
    await page.waitForTimeout(300);
    await expect(diagramsIn(page)).toHaveCount(2);

    expect(await styleOf(diagramsIn(page).first())).toMatch(DEFAULT_THEME_FILL);
    await expect(diagramsIn(page).first().locator("math")).toHaveCount(1);
    await expect(diagramsIn(page).first()).toContainText("Plain label");
    await expect(diagramsIn(page).nth(1)).toContainText("Hello Bob");
    expect(await mermaidLeftovers(page)).toEqual([]);
    expect(
      errors.filter((text: string): boolean => {
        return text.includes("Mermaid");
      }),
    ).toEqual([]);
  });

  test("keeps a diagram it could not draw as it is when the theme changes", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = recordConsoleErrors(page);

    await page.goto("/docs?diagrams=broken");
    await expect(page.locator(".docs-diagram .mermaid svg")).toHaveCount(2);
    await expect(page.locator(".docs-diagram__note")).toHaveCount(1);

    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      window.dispatchEvent(new Event("docs:themechange"));
    });

    await expect
      .poll(async () => {
        return styleOf(page.locator(".docs-diagram .mermaid svg").first());
      })
      .toMatch(DARK_THEME_FILL);

    await expect(page.locator(".docs-diagram__note")).toHaveCount(1);
    expect(
      await page.locator(".docs-diagram .mermaid").first().textContent(),
    ).toBe("graph LR\n  A -->");
    expect(await mermaidLeftovers(page)).toEqual([]);
    // It was reported once, when the page was drawn.
    expect(
      errors.filter((text: string): boolean => {
        return text.includes("Mermaid could not render a diagram");
      }),
    ).toHaveLength(1);
  });

  test("shows every diagram's source when mermaid cannot be loaded, and says so once", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = recordConsoleErrors(page);
    const pageErrors: Array<string> = recordPageErrors(page);

    // A server whose image did not build mermaid answers 404 here.
    await page.route("**/oneuptime-assets/mermaid/**", (route: Route) => {
      return route.fulfill({ status: 404, body: "" });
    });

    await page.goto("/docs");

    // The failed import is reported, as a console error and nothing else.
    await expect
      .poll(() => {
        return (
          pageErrors.length +
          errors.filter((text: string): boolean => {
            return text.includes("Mermaid could not be loaded");
          }).length
        );
      })
      .toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);

    const blocks: Locator = page.locator(".docs-diagram .mermaid");

    await expect(page.locator(".docs-diagram__note")).toHaveCount(2);
    await expect(blocks).toHaveCount(2);
    await expect(blocks.locator("svg")).toHaveCount(0);
    expect(await blocks.first().textContent()).toContain(
      'A["$$x^2 + y^2 = z^2$$"] --> B[Plain label]',
    );
    expect(await blocks.nth(1).textContent()).toContain(
      "Alice->>Bob: Hello Bob",
    );

    await expect
      .poll(() => {
        return errors.filter((text: string): boolean => {
          return text.includes("Mermaid could not be loaded");
        }).length;
      })
      .toBe(1);
    // No unhandled rejection, and nothing per diagram.
    expect(pageErrors).toEqual([]);
    expect(
      errors.filter((text: string): boolean => {
        return text.includes("Mermaid could not render a diagram");
      }),
    ).toEqual([]);
  });

  test("fetches no mermaid on a page without a diagram", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/docs?diagrams=none");
    await expect(page.getByText("Text after them.")).toBeVisible();
    await page.waitForTimeout(500);

    expect(
      responses.map(pathOf).filter((urlPath: string): boolean => {
        return urlPath.includes("mermaid");
      }),
    ).toEqual([]);
  });

  test("draws in the reader's dark theme, and redraws when it changes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("oneuptime-docs-theme", "dark");
    });
    await page.goto("/docs");
    await expect(diagramsIn(page)).toHaveCount(2);

    await expect
      .poll(async () => {
        return styleOf(diagramsIn(page).first());
      })
      .toMatch(DARK_THEME_FILL);

    // What the docs' theme switch does (Docs/Views/Partials/Scripts.ejs).
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      window.dispatchEvent(new Event("docs:themechange"));
    });

    await expect
      .poll(async () => {
        return styleOf(diagramsIn(page).first());
      })
      .toMatch(DEFAULT_THEME_FILL);
    await expect(diagramsIn(page).first().locator("math")).toHaveCount(1);
  });
});

test.describe("the blog", () => {
  const diagramsIn: (page: Page) => Locator = (page: Page): Locator => {
    return page.locator(".blog-body .mermaid svg");
  };

  test("turns each mermaid block into a diagram, in a post with no h2 heading", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/blog");

    await expect(diagramsIn(page)).toHaveCount(2);
    await expect(diagramsIn(page).first()).toContainText("Plain label");
    await expect(diagramsIn(page).nth(1)).toContainText("Hello Bob");
    await expect(diagramsIn(page).first().locator("math")).toHaveCount(1);

    // No mermaid source is left showing as code; other code blocks stay.
    await expect(page.locator(".blog-body pre")).toHaveCount(1);
    await expect(page.locator(".blog-body pre")).toContainText(
      "const answer = 42;",
    );

    await expectSourceBuild(responses, { katex: true });
  });

  test("imports the build from /oneuptime-assets/mermaid/, every file found", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/blog");
    await expect(diagramsIn(page)).toHaveCount(2);

    const mermaid: Array<Response> = responses.filter(
      (response: Response): boolean => {
        return pathOf(response).startsWith("/oneuptime-assets/mermaid/");
      },
    );

    expect(mermaid.map(pathOf)).toContain(
      "/oneuptime-assets/mermaid/mermaid.mjs",
    );
    expect(
      mermaid
        .filter((response: Response): boolean => {
          return response.status() !== 200;
        })
        .map(pathOf),
    ).toEqual([]);
  });

  test("draws the diagrams that parse when one in the post does not", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = recordConsoleErrors(page);

    await page.goto("/blog?diagrams=broken");

    const blocks: Locator = page.locator(".blog-body .mermaid");

    await expect(blocks).toHaveCount(3);
    await expect(blocks.nth(1).locator("svg")).toContainText("Plain label");
    await expect(blocks.nth(2).locator("svg")).toContainText("Hello Bob");
    // mermaid draws its syntax error in place of the one that does not parse.
    await expect(blocks.first()).toContainText(MERMAID_SYNTAX_ERROR);

    await expect
      .poll(() => {
        return errors.filter((text: string): boolean => {
          return text.includes(
            "Mermaid could not render the diagrams in this post",
          );
        }).length;
      })
      .toBe(1);
  });

  test("draws in mermaid's strict mode: no page function runs from a click, no javascript: link", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { diagramCallback: () => void }).diagramCallback =
        (): void => {
          (
            window as unknown as { diagramCallbackRan: boolean }
          ).diagramCallbackRan = true;
        };
    });

    await page.goto("/blog?diagrams=interactive");
    await expect(diagramsIn(page)).toHaveCount(1);

    const diagram: Locator = diagramsIn(page).first();

    // The HTML mermaid allows in a label either way is still drawn.
    await expect(diagram.locator("b")).toHaveText("Bold");
    await expect(diagram).toContainText("Line one");
    await expect(diagram).toContainText("Line two");

    // 'loose' bound the click to window.diagramCallback; 'strict' does not.
    await diagram.locator("g.node", { hasText: "Bold start" }).click();
    await page.waitForTimeout(300);

    expect(
      await page.evaluate(() => {
        return Boolean(
          (window as unknown as { diagramCallbackRan?: boolean })
            .diagramCallbackRan,
        );
      }),
    ).toBe(false);

    // 'loose' kept the javascript: URL as the node's link; 'strict' drops it.
    const links: Array<string> = await diagram
      .locator("a")
      .evaluateAll((anchors: Array<Element>) => {
        return anchors.map((anchor: Element): string => {
          return (
            anchor.getAttribute("href") ||
            anchor.getAttribute("xlink:href") ||
            ""
          );
        });
      });

    expect(
      links.filter((href: string): boolean => {
        return href.trim().toLowerCase().startsWith("javascript:");
      }),
    ).toEqual([]);
  });

  test("runs the rest of the page script on a post with no h2 heading", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/blog");
    await expect(diagramsIn(page)).toHaveCount(2);

    // Heading links and image hints come after the table of contents.
    const heading: Locator = page.locator(".blog-body h3");

    await expect(heading).toHaveAttribute("id", "how-it-is-drawn");
    await expect(heading.locator("a.heading-anchor")).toHaveAttribute(
      "href",
      "#how-it-is-drawn",
    );
    await expect(page.locator(".blog-body img")).toHaveAttribute(
      "decoding",
      "async",
    );
  });

  test("fetches no mermaid for a post without a diagram", async ({
    page,
  }: {
    page: Page;
  }) => {
    const responses: Array<Response> = recordResponses(page);

    await page.goto("/blog?diagrams=none");
    await expect(page.getByText("The end.")).toBeVisible();
    await page.waitForTimeout(500);

    expect(
      responses.map(pathOf).filter((urlPath: string): boolean => {
        return urlPath.includes("mermaid");
      }),
    ).toEqual([]);
  });

  test.describe("in a dark color scheme", () => {
    test.use({ colorScheme: "dark" });

    test("draws with mermaid's dark theme", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto("/blog");
      await expect(diagramsIn(page)).toHaveCount(2);

      await expect
        .poll(async () => {
          return styleOf(diagramsIn(page).first());
        })
        .toMatch(DARK_THEME_FILL);
    });
  });
});
