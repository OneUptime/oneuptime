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

  private static getEmailRenderer(): Renderer {
    if (this.emailRenderer !== null) {
      return this.emailRenderer;
    }

    const renderer: Renderer = new Renderer();

    this.emailRenderer = renderer;

    return renderer;
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
      return `<blockquote class="p-4 pt-1 pb-1 my-4 border-s-4 border-indigo-500">
            <div class="leading-8 text-gray-600">${quote}</div>
        </blockquote>`;
    };

    renderer.image = function (href, _title, text) {
      return `<img src="${href}" alt="${text}" class="rounded-md shadow-md" />`;
    };

    renderer.code = function (code, language) {
      return `<pre><code class="language-${language}">${code}</code></pre>`;
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

    // Inline code
    renderer.codespan = function (code) {
      return `<code class="rounded-md bg-slate-100 px-1.5 py-0.5 text-sm text-slate-700 font-mono">${code}</code>`;
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
      return `<pre class="language-${language} rounded-md"><code class="language-${language} rounded-md">${code}</code></pre>`;
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
      return `<code class="rounded-md bg-gray-100 px-1.5 py-0.5 text-sm text-pink-600">${code}</code>`;
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
