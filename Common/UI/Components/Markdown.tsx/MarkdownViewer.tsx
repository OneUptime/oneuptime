import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
// https://github.com/remarkjs/react-markdown
import ReactMarkdown from "react-markdown";
// https://github.com/remarkjs/remark-gfm
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import http from "react-syntax-highlighter/dist/esm/languages/prism/http";

SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("html", markup);
SyntaxHighlighter.registerLanguage("xml", markup);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("docker", docker);
SyntaxHighlighter.registerLanguage("dockerfile", docker);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("c", c);
SyntaxHighlighter.registerLanguage("cpp", cpp);
SyntaxHighlighter.registerLanguage("csharp", csharp);
SyntaxHighlighter.registerLanguage("ruby", ruby);
SyntaxHighlighter.registerLanguage("php", php);
SyntaxHighlighter.registerLanguage("graphql", graphql);
SyntaxHighlighter.registerLanguage("http", http);
import mermaid from "mermaid";
import DOMPurify from "dompurify";

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  fontFamily: "inherit",
  themeVariables: {
    background: "#ffffff",
    primaryColor: "#e0f2fe",
    primaryTextColor: "#1e293b",
    primaryBorderColor: "#0ea5e9",
    lineColor: "#64748b",
    secondaryColor: "#f1f5f9",
    tertiaryColor: "#ffffff",
  },
});

// Mermaid diagram component
const MermaidDiagram: FunctionComponent<{ chart: string }> = ({
  chart,
}: {
  chart: string;
}) => {
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderDiagram: () => Promise<void> = async (): Promise<void> => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
        try {
          const id: string = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await mermaid.render(id, chart);
          if (containerRef.current) {
            containerRef.current.innerHTML = DOMPurify.sanitize(svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
              ADD_TAGS: ["foreignObject"],
            });
          }
        } catch (error) {
          if (containerRef.current) {
            const errorMessage: string = String(error);
            const errorEl: HTMLPreElement = document.createElement("pre");
            errorEl.className = "text-red-500";
            errorEl.textContent = `Error rendering diagram: ${errorMessage}`;
            containerRef.current.innerHTML = "";
            containerRef.current.appendChild(errorEl);
          }
        }
      }
    };
    renderDiagram();
  }, [chart]);

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center bg-white p-4 rounded-lg"
    />
  );
};

export interface ComponentProps {
  text: string;
}

// Language display names
const langDisplayNames: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  go: "Go",
  java: "Java",
  css: "CSS",
  html: "HTML",
  xml: "XML",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  sql: "SQL",
  bash: "Bash",
  shell: "Shell",
  sh: "Shell",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  rust: "Rust",
  cpp: "C++",
  c: "C",
  csharp: "C#",
  php: "PHP",
  graphql: "GraphQL",
  http: "HTTP",
  markdown: "Markdown",
  md: "Markdown",
};

// Code block with copy button and language label
const CodeBlock: FunctionComponent<{
  language: string;
  content: string;
  rest: any;
}> = ({
  language,
  content,
  rest,
}: {
  language: string;
  content: string;
  rest: any;
}): ReactElement => {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy: () => void = useCallback((): void => {
    navigator.clipboard
      .writeText(content)
      .then((): void => {
        setCopied(true);
        setTimeout((): void => {
          setCopied(false);
        }, 2000);
      })
      .catch((): void => {
        // Fallback: do nothing
      });
  }, [content]);

  const displayLang: string =
    langDisplayNames[language] ||
    (language ? language.charAt(0).toUpperCase() + language.slice(1) : "");

  return (
    <div className="relative rounded-lg mt-3 mb-3 overflow-hidden border border-gray-200 shadow-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 select-none">
          {displayLang}
        </span>
        <button
          onClick={handleCopy}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all duration-150 border-none cursor-pointer ${
            copied
              ? "text-green-400"
              : "text-gray-400 hover:text-gray-200 hover:bg-white/10"
          }`}
          aria-label="Copy code"
          type="button"
        >
          {copied ? (
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {/* Code content */}
      <SyntaxHighlighter
        {...rest}
        PreTag="div"
        // eslint-disable-next-line react/no-children-prop
        children={content}
        language={language}
        style={vscDarkPlus}
        className="!rounded-none !mt-0 !mb-0 !bg-gray-900 !pt-3 !pb-3 !px-4 text-sm !border-0"
        codeTagProps={{ className: "font-mono" }}
      />
    </div>
  );
};

const MarkdownViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="max-w-none">
      <ReactMarkdown
        components={{
          // because tailwind does not supply <h1 ... /> styles https://tailwindcss.com/docs/preflight#headings-are-unstyled
          h1: ({ ...props }: any) => {
            return (
              <h1
                className="text-lg mt-6 mb-3 text-gray-900 font-bold"
                {...props}
              />
            );
          },
          h2: ({ ...props }: any) => {
            return (
              <h2
                className="text-base mt-6 mb-2 text-gray-900 font-semibold"
                {...props}
              />
            );
          },
          h3: ({ ...props }: any) => {
            return (
              <h3
                className="text-base mt-4 mb-2 text-gray-900 font-semibold"
                {...props}
              />
            );
          },
          h4: ({ ...props }: any) => {
            return (
              <h4
                className="text-sm mt-3 mb-2 text-gray-900 font-semibold"
                {...props}
              />
            );
          },
          h5: ({ ...props }: any) => {
            return (
              <h5
                className="text-sm mt-3 mb-1 text-gray-900 font-medium"
                {...props}
              />
            );
          },
          h6: ({ ...props }: any) => {
            return (
              <h6
                className="text-sm mt-2 mb-1 text-gray-700 font-medium"
                {...props}
              />
            );
          },
          p: ({ ...props }: any) => {
            return (
              <p
                className="text-sm mt-2 mb-1 text-gray-700 leading-relaxed"
                {...props}
              />
            );
          },
          a: ({ ...props }: any) => {
            return (
              <a
                className="underline text-blue-600 hover:text-blue-800 font-medium transition-colors"
                {...props}
              />
            );
          },

          pre: ({ children, ...rest }: any) => {
            // Check if this is a mermaid diagram - don't render pre wrapper for mermaid
            const isMermaid: boolean =
              React.isValidElement(children) &&
              (children as any).props?.className?.includes("language-mermaid");

            if (isMermaid) {
              // For mermaid, just return the children (MermaidDiagram component)
              return <>{children}</>;
            }

            /*
             * If the child is a custom component (CodeBlock, MermaidDiagram, etc.)
             * rather than a plain HTML element like <code>, skip pre styling.
             * Checking typeof type !== "string" is minification-safe unlike checking type.name.
             */
            const isCustomComponent: boolean =
              React.isValidElement(children) &&
              typeof (children as any).type !== "string";

            if (isCustomComponent) {
              return <>{children}</>;
            }

            return (
              <pre
                className="bg-gray-900 text-gray-100 mt-3 mb-3 p-3 rounded-md text-sm overflow-x-auto border border-gray-700"
                {...rest}
              >
                {children}
              </pre>
            );
          },
          strong: ({ ...props }: any) => {
            return (
              <strong
                className="text-sm font-semibold text-gray-900"
                {...props}
              />
            );
          },
          li: ({ ...props }: any) => {
            return (
              <li
                className="text-sm mt-1 mb-1 text-gray-700 leading-relaxed"
                {...props}
              />
            );
          },
          ul: ({ ...props }: any) => {
            return <ul className="list-disc pl-6 mt-0 mb-1" {...props} />;
          },
          ol: ({ ...props }: any) => {
            return <ol className="list-decimal pl-6 mt-0 mb-1" {...props} />;
          },
          blockquote: ({ children, ...props }: any) => {
            return (
              <blockquote
                className="rounded-lg border border-amber-200 bg-amber-50/50 my-4 not-italic overflow-hidden"
                {...props}
              >
                <div className="flex items-start gap-3 px-4 py-3">
                  <svg
                    className="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                    />
                  </svg>
                  <div className="text-sm text-gray-700 leading-relaxed [&>p]:mt-0 [&>p]:mb-0 [&>p>strong:first-child]:text-amber-700 [&>p>strong:first-child]:mr-1">
                    {children}
                  </div>
                </div>
              </blockquote>
            );
          },
          table: ({ ...props }: any) => {
            return (
              <div className="overflow-hidden rounded-lg border border-gray-200 mt-4 mb-4 shadow-sm">
                <table
                  className="min-w-full table-auto border-collapse text-sm"
                  {...props}
                />
              </div>
            );
          },
          thead: ({ ...props }: any) => {
            return <thead className="bg-gray-50" {...props} />;
          },
          tbody: ({ ...props }: any) => {
            return <tbody className="divide-y divide-gray-100" {...props} />;
          },
          tr: ({ ...props }: any) => {
            return (
              <tr className="hover:bg-gray-50 transition-colors" {...props} />
            );
          },
          th: ({ ...props }: any) => {
            return (
              <th
                className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-200"
                {...props}
              />
            );
          },
          td: ({ ...props }: any) => {
            return (
              <td className="px-4 py-2.5 text-sm text-gray-700" {...props} />
            );
          },
          hr: ({ ...props }: any) => {
            return <hr className="border-gray-300 my-6" {...props} />;
          },
          code: (props: any) => {
            const { children, className, ...rest } = props;

            const match: RegExpExecArray | null = new RegExp(
              "language-(\\w+)",
            ).exec(className || "");

            const content: string = String(children as string).replace(
              /\n$/,
              "",
            );

            // Handle mermaid diagrams
            if (match && match[1] === "mermaid") {
              return <MermaidDiagram chart={content} />;
            }

            const isMultiline: boolean = content.includes("\n");
            const hasLanguage: boolean = Boolean(
              match &&
                match?.filter((item: string) => {
                  return item.includes("language-");
                }).length > 0,
            );

            // Multiline code blocks (with or without language) get the full CodeBlock treatment
            if (hasLanguage || isMultiline) {
              return (
                <CodeBlock
                  language={match ? match[1]! : "text"}
                  content={content}
                  rest={rest}
                />
              );
            }

            // Inline code
            return (
              <code
                className="text-xs px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-800 font-mono"
                {...rest}
              >
                {children}
              </code>
            );
          },
        }}
        remarkPlugins={[remarkGfm]}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownViewer;
