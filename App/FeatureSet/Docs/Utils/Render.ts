import { Renderer, marked } from 'marked';

export default class DocsRender {
    public static async render(markdownContent: string): Promise<string> {
        const renderer: Renderer = this.getBlogRenderer();

        return await marked(markdownContent, {
            renderer: renderer,
        });
    }

    private static getBlogRenderer(): Renderer {
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

        return renderer;
    }
}
