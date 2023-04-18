import MarkdownIT from 'markdown-it';

export default class Markdown {
    public static convertToHTMML(markdown: string): string {
        const md = new MarkdownIT();
        return md.render(markdown);
    }
}