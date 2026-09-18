import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";

// This class is responsible for rendering markdown content to HTML
export default class DocsRender {
  // Render markdown content to HTML and return the result as a promise
  public static async render(markdownContent: string): Promise<string> {
    // Use the Markdown library to convert markdown content to HTML
    return Markdown.convertToHTML(markdownContent, MarkdownContentType.Docs);
  }
}
