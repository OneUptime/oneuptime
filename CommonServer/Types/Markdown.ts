import MarkdownIT from 'markdown-it';

export default class Markdown {
    public static convertToHTML(markdown: string): string {
        const md: MarkdownIT = new MarkdownIT();
        return md.render(markdown);
    }
}
