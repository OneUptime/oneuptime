import { Renderer, marked } from "marked";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export type MarkdownRenderer = Renderer;

export enum MarkdownContentType {
  Docs,
  Blog,
  Email,
}

export default class Markdown {
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
      return `<pre class="language-${language}"><code class="language-${language}">${code}</code></pre>`;
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

      // --- Enhanced overrides for Docs Renderer (improved styling & missing elements) ---
      // Slugify helper for generating unique heading IDs
      const __docsUsedSlugs: Set<string> = new Set();
      const __slugify = (value: string): string => {
        let slug: string = value
          .toLowerCase()
          .replace(/<[^>]+>/g, "")
          .replace(/[`*_~]/g, "")
          .replace(/[^a-z0-9\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-");
        const base: string = slug;
        let i: number = 1;
        while (__docsUsedSlugs.has(slug)) {
          slug = `${base}-${i++}`;
        }
        __docsUsedSlugs.add(slug);
        return slug;
      };

      // Paragraph (override)
      renderer.paragraph = function (text) {
        return `<p class="my-4 leading-7 text-gray-700 dark:text-gray-300">${text}</p>`;
      };

      // Blockquote (override)
      renderer.blockquote = function (quote) {
        return `<blockquote class="relative my-6 border-s-4 border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 dark:border-indigo-400 p-4 ps-5 rounded-md"><div class="text-gray-700 dark:text-gray-300 leading-7">${quote}</div></blockquote>`;
      };

      // Images -> figure w/ caption
      renderer.image = function (href, _title, text) {
        const alt: string = text || "";
        return `<figure class="my-8 flex flex-col items-center"><img src="${href}" alt="${alt}" loading="lazy" class="max-w-full rounded-lg shadow-sm ring-1 ring-gray-200 dark:ring-gray-700" />${alt ? `<figcaption class=\"mt-2 text-sm text-gray-500 dark:text-gray-400\">${alt}</figcaption>` : ""}</figure>`;
      };

      // Code block (override)
      renderer.code = function (code, language) {
        const langClass = language ? `language-${language}` : "";
        return `<div class="my-6 group relative"><pre class="${langClass}"><code class="${langClass}">${code}</code></pre></div>`;
      };

      // Inline code
      renderer.codespan = function (code) {

        return `<code class="mx-0.5 rounded-md bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[0.85em] font-medium text-pink-600 dark:text-pink-400">${code}</code>`;
      };

      // Strong / Emphasis / Del
      renderer.strong = function (text) {
        return `<strong class="font-semibold text-gray-800 dark:text-gray-100">${text}</strong>`;
      };
      renderer.em = function (text) {
        return `<em class="italic text-gray-700 dark:text-gray-200">${text}</em>`;
      };
      renderer.del = function (text) {
        return `<del class="line-through text-gray-400 dark:text-gray-500">${text}</del>`;
      };

      // Horizontal rule
      renderer.hr = function () {
        return '<hr class="my-12 border-t border-gray-200 dark:border-gray-700" />';
      };

      // Links
      renderer.link = function (href, _title, text) {
        const isAnchor: boolean = !!href && href.startsWith('#');
        const target: string = isAnchor ? "" : ' target="_blank" rel="noopener noreferrer"';
        return `<a href="${href}"${target} class="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">${text}</a>`;
      };

      // Lists
      renderer.list = function (body, ordered, start) {
        const listTag = ordered ? 'ol' : 'ul';
        const startAttr = ordered && start && start > 1 ? ` start="${start}"` : '';
        const classes = ordered ? 'list-decimal' : 'list-disc';
        return `<${listTag}${startAttr} class="${classes} ms-6 my-4 space-y-1 text-gray-700 dark:text-gray-300">${body}</${listTag}>`;
      };
      renderer.listitem = function (text) {
        return `<li class="marker:text-gray-400 leading-6">${text}</li>`;
      };
      renderer.checkbox = function (checked) {
        return `<input type="checkbox" disabled class="me-2 align-middle h-4 w-4 rounded border-gray-300 text-indigo-600" ${checked ? 'checked' : ''}/>`;
      };

      // Tables
      renderer.table = function (header, body) {
        return `<div class="my-8 overflow-x-auto"><table class="w-full border-collapse text-sm"><thead class="bg-gray-50 dark:bg-gray-800/60">${header}</thead><tbody class="divide-y divide-gray-200 dark:divide-gray-700">${body}</tbody></table></div>`;
      };
      renderer.tablerow = function (content) {
        return `<tr class="border-b border-gray-200 dark:border-gray-700">${content}</tr>`;
      };
      renderer.tablecell = function (content, flags) {
        const Tag = flags.header ? 'th' : 'td';
        const align = flags.align ? ` text-${flags.align}` : '';
        const base = 'px-4 py-2 align-top';
        const headerCls = flags.header ? ' font-semibold text-gray-900 dark:text-gray-100' : ' text-gray-700 dark:text-gray-300';
        return `<${Tag} class="${base}${align}${headerCls}">${content}</${Tag}>`;
      };

      // Heading override with anchors
      renderer.heading = function (text, level) {
        const id = __slugify(text);
        const base = 'group scroll-mt-24';
        const anchor = `<a href=\"#${id}\" class=\"absolute -ms-6 ps-2 inset-y-0 start-0 flex items-center opacity-0 group-hover:opacity-100 transition\" aria-label=\"Anchor\">#</a>`;
        if (level === 1) {
          return `<h1 id="${id}" class="${base} relative mt-12 mb-6 text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">${anchor}${text}</h1>`;
        } else if (level === 2) {
          return `<h2 id="${id}" class="${base} relative mt-12 mb-4 text-3xl font-bold tracking-tight text-gray-800 dark:text-gray-100">${anchor}${text}</h2>`;
        } else if (level === 3) {
          return `<h3 id="${id}" class="${base} relative mt-10 mb-3 text-2xl font-bold tracking-tight text-gray-800 dark:text-gray-100">${anchor}${text}</h3>`;
        } else if (level === 4) {
          return `<h4 id="${id}" class="${base} relative mt-8 mb-2 text-xl font-semibold tracking-tight text-gray-800 dark:text-gray-100">${anchor}${text}</h4>`;
        } else if (level === 5) {
          return `<h5 id="${id}" class="${base} relative mt-6 mb-2 text-lg font-semibold tracking-tight text-gray-800 dark:text-gray-100">${anchor}${text}</h5>`;
        }
        return `<h6 id="${id}" class="${base} relative mt-6 mb-2 text-base font-semibold tracking-tight text-gray-800 dark:text-gray-100">${anchor}${text}</h6>`;
      };

      // Line break
      renderer.br = function () { return '<br />'; };
      // --- End enhanced overrides ---

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
      let cleaned: string = code
        .replace(/&#96;|&grave;/g, "`")
        .trim();
      while (
        cleaned.length > 1 &&
        cleaned.startsWith("`") &&
        cleaned.endsWith("`") &&
        !cleaned.slice(1, -1).includes("`")
      ) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      return `<code class="rounded-md bg-gray-100 px-1.5 py-0.5 text-sm text-pink-600">${cleaned}</code>`;
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

    this.blogRenderer = renderer;

    return renderer;
  }
}
