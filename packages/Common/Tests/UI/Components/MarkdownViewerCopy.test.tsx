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

import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";
import { pastedHtmlToMarkdown } from "../../../UI/Components/Markdown.tsx/MarkdownPaste";

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
