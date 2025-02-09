export default class HTML {
  private _html: string = "";
  public get html(): string {
    return this._html;
  }
  public set html(v: string) {
    this._html = v;
  }

  public constructor(html: string) {
    this.html = html;
  }

  public toString(): string {
    return this.html;
  }

  public static isHtml(text: string): boolean {
    // Check if the text is HTML

    // Example usage const htmlString = '<div>Hello, World!</div>'; const notHtmlString = 'Just a regular string'
    // console.log(HTML.isHtml(htmlString)); // true
    // console.log(HTML.isHtml(notHtmlString)); // false

    const htmlPattern: RegExp = /<\/?[a-z][\s\S]*>/i;
    return htmlPattern.test(text);
  }
}
