import { Renderer, marked } from "marked";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export type MarkdownRenderer = Renderer;

export enum MarkdownContentType {
  Docs,
  Blog,
  Email,
}

export default class Markdown {
  @CaptureSpan()
  public static convertToPlainText(markdown: string): string {
    if (!markdown) {
      return "";
    }

    let text: string = markdown;

    // Remove HTML tags
    text = text.replace(/<[^>]*>/g, "");

    // Convert markdown links [text](url) to just text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Convert markdown images ![alt](url) to just alt text
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

    // Remove markdown bold/italic markers
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1"); // **bold**
    text = text.replace(/\*([^*]+)\*/g, "$1"); // *italic*
    text = text.replace(/__([^_]+)__/g, "$1"); // __bold__
    text = text.replace(/_([^_]+)_/g, "$1"); // _italic_

    // Remove markdown strikethrough
    text = text.replace(/~~([^~]+)~~/g, "$1");

    // Remove markdown code blocks
    text = text.replace(/```[\s\S]*?```/g, "");
    text = text.replace(/`([^`]+)`/g, "$1");

    // Remove markdown headers
    text = text.replace(/^#{1,6}\s+/gm, "");

    // Remove markdown blockquotes
    text = text.replace(/^>\s+/gm, "");

    // Remove markdown horizontal rules
    text = text.replace(/^[-*_]{3,}$/gm, "");

    // Remove markdown list markers
    text = text.replace(/^[\s]*[-*+]\s+/gm, "");
    text = text.replace(/^[\s]*\d+\.\s+/gm, "");

    // Decode HTML entities
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, " ");

    // Normalize whitespace - collapse multiple spaces/newlines
    text = text.replace(/\n\s*\n/g, "\n");
    text = text.replace(/[ \t]+/g, " ");

    // Trim whitespace
    text = text.trim();

    return text;
  }
  private static blogRenderer: Renderer | null = null;
  private static docsRenderer: Renderer | null = null;
  private static emailRenderer: Renderer | null = null;

  @CaptureSpan()
  public static async convertToHTML(
    markdown: string,
    contentType: MarkdownContentType,
  ): Promise<string> {
    // Basic sanitization: neutralize script tags but preserve markdown syntax like '>' for blockquotes.
    markdown = markdown.replace(/<script/gi, "&lt;script");

    let renderer: Renderer | null = null;

    if (contentType === MarkdownContentType.Blog) {
      renderer = this.getBlogRenderer();
    }

    if (contentType === MarkdownContentType.Docs) {
      renderer = this.getDocsRenderer();
    }

    if (contentType === MarkdownContentType.Email) {
      renderer = this.getEmailRenderer();
    }

    const htmlBody: string = await marked(markdown, {
      renderer: renderer,
    });

    return htmlBody;
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private static getEmailRenderer(): Renderer {
    if (this.emailRenderer !== null) {
      return this.emailRenderer;
    }

    const renderer: Renderer = new Renderer();

    this.emailRenderer = renderer;

    return renderer;
  }

  private static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/&[^;]+;/g, "")
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private static getDocsRenderer(): Renderer {
    if (this.docsRenderer !== null) {
      return this.docsRenderer;
    }

    const renderer: Renderer = new Renderer();

    renderer.paragraph = function (text) {
      return `<p class="mt-2 mb-2 leading-8 text-gray-600">${text}</p>`;
    };

    renderer.blockquote = function (quote) {
      const calloutMatch: RegExpMatchArray | null = quote.match(
        /<p[^>]*>\s*<strong>(Note|Warning|Tip|Danger|Info|Caution):?<\/strong>/i,
      );

      if (calloutMatch) {
        const type: string = calloutMatch[1]!.toLowerCase();
        const configMap: Record<
          string,
          { border: string; bg: string; icon: string; label: string }
        > = {
          note: {
            border: "border-blue-400",
            bg: "bg-blue-50",
            icon: `<svg class="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
            label: "Note",
          },
          info: {
            border: "border-blue-400",
            bg: "bg-blue-50",
            icon: `<svg class="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
            label: "Info",
          },
          tip: {
            border: "border-green-400",
            bg: "bg-green-50",
            icon: `<svg class="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>`,
            label: "Tip",
          },
          warning: {
            border: "border-yellow-400",
            bg: "bg-yellow-50",
            icon: `<svg class="h-5 w-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>`,
            label: "Warning",
          },
          caution: {
            border: "border-yellow-400",
            bg: "bg-yellow-50",
            icon: `<svg class="h-5 w-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>`,
            label: "Caution",
          },
          danger: {
            border: "border-red-400",
            bg: "bg-red-50",
            icon: `<svg class="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
            label: "Danger",
          },
        };

        const config: { border: string; bg: string; icon: string; label: string } =
          configMap[type] || configMap["note"]!;

        const content: string = quote.replace(
          /<p[^>]*>\s*<strong>(Note|Warning|Tip|Danger|Info|Caution):?<\/strong>\s*/i,
          '<p class="mt-2 mb-2 leading-8 text-gray-600">',
        );

        return `<div class="callout callout-${type} my-4 rounded-r-lg border-l-4 ${config.border} ${config.bg} p-4">
          <div class="flex items-center gap-2 mb-1">
            ${config.icon}
            <span class="text-sm font-semibold text-gray-700">${config.label}</span>
          </div>
          <div class="leading-7 text-gray-600 text-sm">${content}</div>
        </div>`;
      }

      return `<blockquote class="p-4 pt-1 pb-1 my-4 border-s-4 border-indigo-500">
            <div class="leading-8 text-gray-600">${quote}</div>
        </blockquote>`;
    };

    renderer.image = function (href, _title, text) {
      return `<img src="${href}" alt="${text}" class="rounded-md shadow-md" />`;
    };

    renderer.code = function (code, language) {
      if (language === "mermaid") {
        return `<div class="mermaid">${code}</div>`;
      }
      const escaped: string = Markdown.escapeHtml(code);
      return `<pre><code class="language-${language}">${escaped}</code></pre>`;
    };

    renderer.heading = function (text, level) {
      const slug: string = Markdown.slugify(text);
      const anchor: string =
        level === 2 || level === 3
          ? `<a href="#${slug}" class="anchor-link" aria-hidden="true">#</a>`
          : "";

      if (level === 1) {
        return `<h1 id="${slug}" class="my-5 mt-8 text-4xl font-bold tracking-tight text-gray-800">${text}</h1>`;
      } else if (level === 2) {
        return `<h2 id="${slug}" class="group my-5 mt-8 text-3xl font-bold tracking-tight text-gray-800">${text} ${anchor}</h2>`;
      } else if (level === 3) {
        return `<h3 id="${slug}" class="group my-5 mt-8 text-2xl font-bold tracking-tight text-gray-800">${text} ${anchor}</h3>`;
      } else if (level === 4) {
        return `<h4 id="${slug}" class="my-5 mt-8 text-xl font-bold tracking-tight text-gray-800">${text}</h4>`;
      } else if (level === 5) {
        return `<h5 id="${slug}" class="my-5 mt-8 text-lg font-bold tracking-tight text-gray-800">${text}</h5>`;
      }
      return `<h6 id="${slug}" class="my-5 tracking-tight font-bold text-gray-800">${text}</h6>`;
    };

    renderer.table = function (header, body) {
      return `<div class="docs-table-wrapper overflow-x-auto my-6 rounded-lg border border-slate-200">
        <table class="min-w-full text-sm text-left">${header}${body}</table>
      </div>`;
    };

    renderer.tablerow = function (content) {
      return `<tr class="border-b border-slate-200 last:border-b-0 hover:bg-slate-50/50 transition-colors">${content}</tr>`;
    };

    renderer.tablecell = function (content, flags) {
      const tag: string = flags.header ? "th" : "td";
      const align: string = flags.align ? ` text-${flags.align}` : "";
      const headerClass: string = flags.header
        ? " font-semibold text-slate-900 bg-slate-50"
        : " text-slate-600";
      return `<${tag} class="px-4 py-2.5${align}${headerClass}">${content}</${tag}>`;
    };

    // Inline code
    renderer.codespan = function (code) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<code class="rounded-md bg-slate-100 px-1.5 py-0.5 text-sm text-slate-700 font-mono">${escaped}</code>`;
    };

    this.docsRenderer = renderer;

    return renderer;
  }

  private static getBlogRenderer(): Renderer {
    if (this.blogRenderer !== null) {
      return this.blogRenderer;
    }

    const renderer: Renderer = new Renderer();

    renderer.paragraph = function (text) {
      return `<p class="mt-5 mb-2 leading-8 text-gray-600 text-lg">${text}</p>`;
    };

    renderer.blockquote = function (quote) {
      return `<blockquote class="p-4 pt-1 pb-1 my-4 border-s-4 border-indigo-500">
            <div class="leading-8 text-gray-600">${quote}</div>
        </blockquote>`;
    };

    renderer.code = function (code, language) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<pre class="language-${language} rounded-md"><code class="language-${language} rounded-md">${escaped}</code></pre>`;
    };

    renderer.heading = function (text, level) {
      if (level === 1) {
        return `<h1 class="my-5 mt-8 text-4xl font-bold tracking-tight text-gray-800">${text}</h1>`;
      } else if (level === 2) {
        return `<h2 class="my-5  mt-8 text-3xl font-bold tracking-tight text-gray-800">${text}</h2>`;
      } else if (level === 3) {
        return `<h3 class="my-5  mt-8 text-2xl font-bold tracking-tight text-gray-800">${text}</h3>`;
      } else if (level === 4) {
        return `<h4 class="my-5  mt-8 text-xl font-bold tracking-tight text-gray-800">${text}</h4>`;
      } else if (level === 5) {
        return `<h5 class="my-5  mt-8 text-lg font-bold tracking-tight text-gray-800">${text}</h5>`;
      }
      return `<h6 class="my-5 tracking-tight font-bold text-gray-800">${text}</h6>`;
    };

    // Lists
    renderer.list = function (body, ordered, start) {
      const tag: string = ordered ? "ol" : "ul";
      const cls: string = ordered
        ? "list-decimal pl-6 my-6 space-y-2 text-gray-700"
        : "list-disc pl-6 my-6 space-y-2 text-gray-700";
      const startAttr: string =
        ordered && start !== 1 ? ` start="${start}"` : "";
      return `<${tag}${startAttr} class="${cls}">${body}</${tag}>`;
    };
    renderer.listitem = function (text) {
      return `<li class="leading-7">${text}</li>`;
    };

    // Tables
    renderer.table = function (header, body) {
      return `<div class="overflow-x-auto my-8"><table class="min-w-full border border-gray-200 text-sm text-left">
        ${header}${body}
      </table></div>`;
    };
    renderer.tablerow = function (content) {
      return `<tr class="border-b last:border-b-0">${content}</tr>`;
    };
    renderer.tablecell = function (content, flags) {
      const type: string = flags.header ? "th" : "td";
      const base: string = "px-4 py-2 border-r last:border-r-0 border-gray-200";
      const align: string = flags.align ? ` text-${flags.align}` : "";
      const weight: string = flags.header ? " font-semibold bg-gray-50" : "";
      return `<${type} class="${base}${align}${weight}">${content}</${type}>`;
    };

    // Inline code
    renderer.codespan = function (code) {
      const escaped: string = Markdown.escapeHtml(code);
      return `<code class="rounded-md bg-gray-100 px-1.5 py-0.5 text-sm text-pink-600">${escaped}</code>`;
    };

    // Horizontal rule
    renderer.hr = function () {
      return '<hr class="my-12 border-t border-gray-200" />';
    };

    // Emphasis / Strong / Strikethrough
    renderer.strong = function (text) {
      return `<strong class="font-semibold text-gray-800">${text}</strong>`;
    };
    renderer.em = function (text) {
      return `<em class="italic text-gray-700">${text}</em>`;
    };
    renderer.del = function (text) {
      return `<del class="line-through text-gray-400">${text}</del>`;
    };

    // Images
    renderer.image = function (href, _title, text) {
      return `<figure class="my-8"><img src="${href}" alt="${text}" class="rounded-xl shadow-sm border border-gray-200" loading="lazy"/><figcaption class="mt-2 text-center text-sm text-gray-500">${text || ""}</figcaption></figure>`;
    };

    /*
     * Links
     * We explicitly add underline + color classes because Tailwind Typography (prose-*)
     * styles may get overridden by surrounding utility classes or global resets.
     * External links open in a new tab with proper rel attributes; internal links stay in-page.
     */
    renderer.link = function (href, title, text) {
      // Guard: if no href, just return the text.
      if (!href) {
        return text as string;
      }

      const isHash: boolean = href.startsWith("#");
      const isMailTo: boolean = href.startsWith("mailto:");
      const isTel: boolean = href.startsWith("tel:");
      const isInternal: boolean =
        href.startsWith("/") ||
        href.includes("oneuptime.com") ||
        isHash ||
        isMailTo ||
        isTel;

      const baseClasses: string = [
        "font-semibold",
        "text-indigo-600",
        "underline",
        "underline-offset-2",
        "decoration-indigo-300",
        "hover:decoration-indigo-500",
        "hover:text-indigo-500",
        "transition-colors",
      ].join(" ");

      const titleAttr: string = title ? ` title="${title}"` : "";
      const externalAttrs: string = isInternal
        ? ""
        : ' target="_blank" rel="noopener noreferrer"';

      return `<a href="${href}"${titleAttr} class="${baseClasses}"${externalAttrs}>${text}</a>`;
    };

    this.blogRenderer = renderer;

    return renderer;
  }
}
