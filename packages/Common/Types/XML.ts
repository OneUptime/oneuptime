import BadDataException from "./Exception/BadDataException";

/*
 * Everything XML 1.0 cannot carry, escaped or not: the C0 controls other
 * than tab, newline and carriage return, lone surrogates, U+FFFE and U+FFFF.
 */
const INVALID_XML_CHARACTERS: RegExp =
  /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export default class XML {
  /*
   * Plain text, made safe to write between two tags or inside a quoted
   * attribute value, so that a parser reads back exactly what was written.
   *
   * The ampersand goes first, so the entities the other four become are not
   * escaped a second time. Characters XML cannot carry at all are dropped:
   * no escape makes them legal, and a single one makes a parser reject the
   * whole document.
   */
  public static escape(text: string): string {
    return String(text)
      .replace(INVALID_XML_CHARACTERS, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private _xml: string = "";
  public get xml(): string {
    return this._xml;
  }
  public set xml(v: string) {
    if (!v) {
      throw new BadDataException("XML is not in valid format.");
    }
    this._xml = v;
  }

  public constructor(xml: string) {
    this.xml = xml;
  }

  public toString(): string {
    return this.xml;
  }
}
