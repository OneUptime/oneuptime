import Markdown, { MarkdownContentType } from "CommonServer/Types/Markdown";

export default class DocsRender {
  public static async render(markdownContent: string): Promise<string> {
    return Markdown.convertToHTML(markdownContent, MarkdownContentType.Docs);
  }
}
