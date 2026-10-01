/*
 * What MarkdownViewer renders for a copy to come back as markdown (issue
 * #4114): a code block names itself and its language and marks its header
 * as chrome, and nested bullet lists step through disc, circle and square.
 *
 * react-markdown is ESM and does not run under Common's jest, so it is
 * replaced by a stand-in that renders a tree built by each test through the
 * `components` map MarkdownViewer passes it -- the viewer's real renderers,
 * without the real parser (the pattern of MarkdownInlineReferences.test.tsx).
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("react-markdown", () => {
  return {
    __esModule: true,
    default: (props: { components?: MockComponents }): React.ReactElement => {
      return mockRenderTree(props.components || {});
    },
    defaultUrlTransform: (url: string): string => {
      return url;
    },
  };
});

/*
 * The shared react-syntax-highlighter mock renders a bare <pre> and drops
 * every prop. This stand-in keeps react-syntax-highlighter 16's contract,
 * which the code block's copy hints rely on: props it does not know go on
 * the PreTag element, codeTagProps on the CodeTag. (Every deep import of the
 * package maps to one mock module, so this also serves the style and
 * language imports.)
 */
jest.mock("react-syntax-highlighter/dist/esm/prism-light", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const Highlighter: {
    (props: Record<string, unknown>): React.ReactElement;
    registerLanguage: () => void;
  } = Object.assign(
    (props: Record<string, unknown>): React.ReactElement => {
      const rest: Record<string, unknown> = { ...props };
      for (const known of [
        "PreTag",
        "CodeTag",
        "codeTagProps",
        "children",
        "language",
        "style",
        "customStyle",
      ]) {
        delete rest[known];
      }
      return react.createElement(
        (props["PreTag"] as string | undefined) || "pre",
        rest,
        react.createElement(
          (props["CodeTag"] as string | undefined) || "code",
          props["codeTagProps"] as Record<string, unknown>,
          props["children"] as React.ReactNode,
        ),
      );
    },
    {
      registerLanguage: (): void => {},
    },
  );
  return { __esModule: true, default: Highlighter, vscDarkPlus: {} };
});

import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";
import {
  clipboardToMarkdown,
  pastedHtmlToMarkdown,
} from "../../../UI/Components/Markdown.tsx/MarkdownPaste";

type MockComponents = Record<string, React.ElementType>;

type TreeBuilder = (components: MockComponents) => React.ReactElement;

const mockTreeState: { build: TreeBuilder | null } = { build: null };

function mockRenderTree(components: MockComponents): React.ReactElement {
  if (!mockTreeState.build) {
    return <div />;
  }
  return mockTreeState.build(components);
}

// Renders the viewer with the stand-in drawing `build`'s tree.
const renderViewer: (build: TreeBuilder) => HTMLElement = (
  build: TreeBuilder,
): HTMLElement => {
  mockTreeState.build = build;
  const { container } = render(<MarkdownViewer text="(stand-in)" />);
  return container;
};

afterEach(() => {
  cleanup();
  mockTreeState.build = null;
});

// A code fence as react-markdown hands it over: <pre><code class="language-x">.
const codeFence: (
  components: MockComponents,
  language: string | null,
  source: string,
) => React.ReactElement = (
  components: MockComponents,
  language: string | null,
  source: string,
): React.ReactElement => {
  const Pre: React.ElementType = components["pre"] as React.ElementType;
  const Code: React.ElementType = components["code"] as React.ElementType;
  return (
    <Pre>
      <Code className={language ? `language-${language}` : undefined}>
        {source}
      </Code>
    </Pre>
  );
};

describe("MarkdownViewer code blocks", () => {
  test("mark their root as a code block, with its language", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, "typescript", "const x = 1;\n");
      },
    );

    const block: HTMLElement | null = container.querySelector(
      "[data-markdown-code-block]",
    );
    expect(block).not.toBeNull();
    expect(block?.getAttribute("data-markdown-code-block")).toBe("true");
    expect(block?.getAttribute("data-language")).toBe("typescript");
  });

  test("mark the header -- language label and Copy button -- as not the document", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, "typescript", "const x = 1;\n");
      },
    );

    const header: HTMLElement = container.querySelector(
      "[data-markdown-ignore]",
    ) as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.getAttribute("data-markdown-ignore")).toBe("true");
    expect(
      within(header).getByRole("button", { name: "Copy code" }),
    ).toBeInTheDocument();
    expect(within(header).getByText("TypeScript")).toBeInTheDocument();
    // The code itself is outside the ignored header.
    expect(header.textContent).not.toContain("const x");
  });

  /*
   * A copy of part of a block -- a drag over some of its lines, a triple
   * click -- carries the <pre> around the selected text in every browser,
   * but not the block's <div>. With the hints only on the <div>, such a copy
   * pasted back as markdown: "# deploy config" became a heading.
   */
  test("put the hints on the <pre> the code is in as well", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, "yaml", "# deploy config\nreplicas: 3\n");
      },
    );

    const pre: HTMLElement = container.querySelector("pre") as HTMLElement;
    expect(pre).not.toBeNull();
    expect(pre.getAttribute("data-markdown-code-block")).toBe("true");
    expect(pre.getAttribute("data-language")).toBe("yaml");
    expect(pre.textContent).toBe("# deploy config\nreplicas: 3");
  });

  test("so a copy of its code alone pastes back as a fenced block", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, "yaml", "# deploy config\nreplicas: 3\n");
      },
    );
    const pre: HTMLElement = container.querySelector("pre") as HTMLElement;

    expect(
      clipboardToMarkdown({
        getData: (format: string): string => {
          if (format === "text/html") {
            return pre.outerHTML;
          }
          return format === "text/plain" ? pre.textContent || "" : "";
        },
      }),
    ).toBe("```yaml\n# deploy config\nreplicas: 3\n```");
  });

  /*
   * A selection that took in the header put its Copy button's label in the
   * copy's plain text -- pasted as a stray "Copy" line.
   */
  test("keep the header -- language label and Copy button -- out of a selection", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, "yaml", "replicas: 3\n");
      },
    );

    expect(container.querySelector("[data-markdown-ignore]")).toHaveClass(
      "select-none",
    );
  });

  test("name a multi-line block without a language as text", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, null, "line 1\nline 2\n");
      },
    );

    expect(
      container
        .querySelector("[data-markdown-code-block]")
        ?.getAttribute("data-language"),
    ).toBe("text");
  });

  test("leave inline code unmarked", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        const Code: React.ElementType = components["code"] as React.ElementType;
        return (
          <p>
            run <Code>npm test</Code>
          </p>
        );
      },
    );

    expect(container.querySelector("[data-markdown-code-block]")).toBeNull();
    expect(screen.getByText("npm test").tagName).toBe("CODE");
  });
});

/*
 * A mermaid diagram fetches the images its nodes name as it is drawn, so
 * only a fence whose language is exactly "mermaid" is drawn as one. The
 * language used to be searched for anywhere in the class remark gives a
 * fence, "language-" followed by the first word of its info string: a fence
 * opened with "```-language-mermaid" drew a diagram too.
 */
describe("MarkdownViewer mermaid fences", () => {
  const DIAGRAM: string = "flowchart TD\n  A --> B\n";

  // The container MermaidDiagram draws into.
  const diagramsIn: (container: HTMLElement) => number = (
    container: HTMLElement,
  ): number => {
    return container.querySelectorAll("div.flex.justify-center").length;
  };

  test("draw a diagram for a fence whose language is mermaid", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, "mermaid", DIAGRAM);
      },
    );

    expect(diagramsIn(container)).toBe(1);
    expect(container.querySelector("[data-markdown-code-block]")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  test.each([
    ["-language-mermaid"],
    [".language-mermaid"],
    ["+language-mermaid"],
    ["mermaid-x"],
    ["Mermaid"],
    ["x-mermaid"],
  ])(
    "show a fence whose info string is %s as code, not a diagram",
    (info: string) => {
      const container: HTMLElement = renderViewer(
        (components: MockComponents): React.ReactElement => {
          return codeFence(components, info, DIAGRAM);
        },
      );

      expect(diagramsIn(container)).toBe(0);
      const block: HTMLElement | null = container.querySelector(
        "pre[data-markdown-code-block]",
      );
      expect(block).not.toBeNull();
      expect(block?.textContent).toBe(DIAGRAM.replace(/\n$/, ""));
    },
  );

  test("still read the language of a fence from the start of its class", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        return codeFence(components, "-language-yaml", "a: 1\nb: 2\n");
      },
    );

    expect(
      container
        .querySelector("[data-markdown-code-block]")
        ?.getAttribute("data-language"),
    ).toBe("text");
  });
});

describe("MarkdownViewer nested lists", () => {
  // ul > li > ul > li > ul > li > ul, built from the viewer's own renderers.
  const nestedBullets: TreeBuilder = (
    components: MockComponents,
  ): React.ReactElement => {
    const Ul: React.ElementType = components["ul"] as React.ElementType;
    const Li: React.ElementType = components["li"] as React.ElementType;
    return (
      <Ul data-testid="level-1">
        <Li>
          one
          <Ul data-testid="level-2">
            <Li>
              two
              <Ul data-testid="level-3">
                <Li>
                  three
                  <Ul data-testid="level-4">
                    <Li>four</Li>
                  </Ul>
                </Li>
              </Ul>
            </Li>
          </Ul>
        </Li>
      </Ul>
    );
  };

  test("step through disc, circle and square, and stay square below that", () => {
    renderViewer(nestedBullets);

    expect(screen.getByTestId("level-1")).toHaveClass("list-disc");
    expect(screen.getByTestId("level-2")).toHaveClass("list-[circle]");
    expect(screen.getByTestId("level-3")).toHaveClass("list-[square]");
    expect(screen.getByTestId("level-4")).toHaveClass("list-[square]");
    expect(screen.getByTestId("level-2")).not.toHaveClass("list-disc");
  });

  test("keep the list spacing classes at every level", () => {
    renderViewer(nestedBullets);

    for (const level of ["level-1", "level-2", "level-3", "level-4"]) {
      expect(screen.getByTestId(level)).toHaveClass("pl-6", "mt-0", "mb-1");
    }
  });

  test("count a numbered list as a level, as the browser's own styles do", () => {
    renderViewer((components: MockComponents): React.ReactElement => {
      const Ul: React.ElementType = components["ul"] as React.ElementType;
      const Ol: React.ElementType = components["ol"] as React.ElementType;
      const Li: React.ElementType = components["li"] as React.ElementType;
      return (
        <Ol data-testid="numbered">
          <Li>
            step
            <Ul data-testid="bullets-in-numbered">
              <Li>detail</Li>
            </Ul>
          </Li>
        </Ol>
      );
    });

    expect(screen.getByTestId("numbered")).toHaveClass("list-decimal");
    expect(screen.getByTestId("bullets-in-numbered")).toHaveClass(
      "list-[circle]",
    );
  });

  test("start again at disc for a list that is not nested", () => {
    renderViewer((components: MockComponents): React.ReactElement => {
      const Ul: React.ElementType = components["ul"] as React.ElementType;
      const Li: React.ElementType = components["li"] as React.ElementType;
      return (
        <div>
          <Ul data-testid="first">
            <Li>a</Li>
          </Ul>
          <Ul data-testid="second">
            <Li>b</Li>
          </Ul>
        </div>
      );
    });

    expect(screen.getByTestId("first")).toHaveClass("list-disc");
    expect(screen.getByTestId("second")).toHaveClass("list-disc");
  });

  /*
   * remark-gfm gives a task list its own class, which replaces the bullet
   * class -- a checkbox list shows no bullets, at any depth.
   */
  test("leave a task list without bullets", () => {
    renderViewer((components: MockComponents): React.ReactElement => {
      const Ul: React.ElementType = components["ul"] as React.ElementType;
      const Li: React.ElementType = components["li"] as React.ElementType;
      return (
        <Ul>
          <Li>
            parent
            <Ul className="contains-task-list" data-testid="tasks">
              <Li className="task-list-item">
                <input type="checkbox" disabled /> task
              </Li>
            </Ul>
          </Li>
        </Ul>
      );
    });

    expect(screen.getByTestId("tasks").className).toBe("contains-task-list");
  });
});

/*
 * The point of the attributes: the rendered note, copied and pasted, comes
 * back as the markdown it was written in.
 */
describe("a copy of MarkdownViewer's output", () => {
  test("pastes back as the markdown it was rendered from", () => {
    const container: HTMLElement = renderViewer(
      (components: MockComponents): React.ReactElement => {
        const Ul: React.ElementType = components["ul"] as React.ElementType;
        const Li: React.ElementType = components["li"] as React.ElementType;
        const P: React.ElementType = components["p"] as React.ElementType;
        return (
          <>
            <P>Steps:</P>
            <Ul>
              <Li>
                Service down
                <Ul>
                  <Li>Users cannot log in</Li>
                </Ul>
              </Li>
            </Ul>
            {codeFence(components, "bash", "npm run restart\n")}
          </>
        );
      },
    );

    expect(pastedHtmlToMarkdown(container.innerHTML)).toBe(
      "Steps:\n\n- Service down\n  - Users cannot log in\n\n```bash\nnpm run restart\n```",
    );
  });
});
