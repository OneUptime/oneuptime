import { marked, Renderer } from 'marked';

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

    public static async convertToHTML(
        markdown: string,
        contentType: MarkdownContentType
    ): Promise<string> {
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

        this.docsRenderer = renderer;

        return renderer;
    }

    private static getBlogRenderer(): Renderer {
        if (this.blogRenderer !== null) {
            return this.blogRenderer;
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

        this.blogRenderer = renderer;

        return renderer;
    }
}
