"use strict";

/**
 * A small, strict XML parser.
 *
 * These tests need to compare ClickHouse config XML that lives in two places
 * (Clickhouse/config.d/*.xml on disk, and a YAML block scalar inside
 * HelmChart/Public/oneuptime/values.yaml). Comparing them with regexes would
 * pass on malformed input and would be fooled by whitespace/attribute-order
 * differences, so we actually parse both sides with the same parser and
 * compare the resulting trees.
 *
 * No XML parser is installed in the repo root node_modules, and these tests
 * deliberately do not add a dependency (they must run with nothing but what a
 * plain install at the repo root already provides). This scanner is
 * intentionally small but strict: unbalanced tags, unterminated comments,
 * unquoted or duplicated attributes and trailing junk all throw. The
 * "rejects malformed XML" case in ClickhouseSystemLogTtl.test.js covers that,
 * and xmllint cross-checks it wherever xmllint is on PATH.
 *
 * Not supported (and not needed by ClickHouse config files): DTD internal
 * subsets, namespaces-as-semantics, numeric character references.
 */

class XmlParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "XmlParseError";
  }
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-]/;

const ENTITIES = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeEntities(text) {
  return text.replace(/&[a-zA-Z]+;/g, (match) => {
    if (Object.prototype.hasOwnProperty.call(ENTITIES, match)) {
      return ENTITIES[match];
    }
    throw new XmlParseError(`Unknown entity ${match}`);
  });
}

class Scanner {
  constructor(source, sourceName) {
    this.source = source;
    this.sourceName = sourceName || "<xml>";
    this.pos = 0;
  }

  fail(message) {
    const consumed = this.source.slice(0, this.pos);
    const line = consumed.split("\n").length;
    throw new XmlParseError(`${this.sourceName}:${line}: ${message}`);
  }

  eof() {
    return this.pos >= this.source.length;
  }

  startsWith(token) {
    return this.source.startsWith(token, this.pos);
  }

  expect(token) {
    if (!this.startsWith(token)) {
      this.fail(
        `expected "${token}" but found "${this.source.slice(this.pos, this.pos + 20)}"`,
      );
    }
    this.pos += token.length;
  }

  skipWhitespace() {
    while (!this.eof() && /\s/.test(this.source[this.pos])) {
      this.pos += 1;
    }
  }

  /** Skips one comment / processing instruction / doctype. Returns true if it skipped one. */
  skipMisc() {
    if (this.startsWith("<!--")) {
      const end = this.source.indexOf("-->", this.pos + 4);
      if (end === -1) {
        this.fail("unterminated comment");
      }
      this.pos = end + 3;
      return true;
    }
    if (this.startsWith("<?")) {
      const end = this.source.indexOf("?>", this.pos + 2);
      if (end === -1) {
        this.fail("unterminated processing instruction");
      }
      this.pos = end + 2;
      return true;
    }
    if (this.startsWith("<!DOCTYPE")) {
      const end = this.source.indexOf(">", this.pos);
      if (end === -1) {
        this.fail("unterminated doctype");
      }
      this.pos = end + 1;
      return true;
    }
    return false;
  }

  skipMiscAndWhitespace() {
    for (;;) {
      this.skipWhitespace();
      if (!this.skipMisc()) {
        return;
      }
    }
  }

  readName() {
    if (this.eof() || !NAME_START.test(this.source[this.pos])) {
      this.fail(
        `expected an element or attribute name, found "${this.source.slice(this.pos, this.pos + 20)}"`,
      );
    }
    const start = this.pos;
    this.pos += 1;
    while (!this.eof() && NAME_CHAR.test(this.source[this.pos])) {
      this.pos += 1;
    }
    return this.source.slice(start, this.pos);
  }

  readElement() {
    this.expect("<");
    const name = this.readName();
    const attributes = {};

    for (;;) {
      const hadWhitespace = /\s/.test(this.source[this.pos] || "");
      this.skipWhitespace();

      if (this.startsWith("/>")) {
        this.pos += 2;
        return { name, attributes, children: [], text: "" };
      }
      if (this.startsWith(">")) {
        this.pos += 1;
        break;
      }
      if (this.eof()) {
        this.fail(`unclosed start tag <${name}>`);
      }
      if (!hadWhitespace) {
        this.fail(`missing whitespace before attribute in <${name}>`);
      }

      const attributeName = this.readName();
      if (Object.prototype.hasOwnProperty.call(attributes, attributeName)) {
        this.fail(`duplicate attribute "${attributeName}" on <${name}>`);
      }
      this.skipWhitespace();
      this.expect("=");
      this.skipWhitespace();
      const quote = this.source[this.pos];
      if (quote !== '"' && quote !== "'") {
        this.fail(`attribute "${attributeName}" on <${name}> is not quoted`);
      }
      this.pos += 1;
      const valueEnd = this.source.indexOf(quote, this.pos);
      if (valueEnd === -1) {
        this.fail(`unterminated value for attribute "${attributeName}"`);
      }
      attributes[attributeName] = decodeEntities(
        this.source.slice(this.pos, valueEnd),
      );
      this.pos = valueEnd + 1;
    }

    const children = [];
    let text = "";

    for (;;) {
      if (this.eof()) {
        this.fail(`unclosed element <${name}>`);
      }
      if (this.startsWith("</")) {
        this.pos += 2;
        const closingName = this.readName();
        if (closingName !== name) {
          this.fail(`</${closingName}> does not close <${name}>`);
        }
        this.skipWhitespace();
        this.expect(">");
        return { name, attributes, children, text: text.trim() };
      }
      if (this.startsWith("<![CDATA[")) {
        const end = this.source.indexOf("]]>", this.pos + 9);
        if (end === -1) {
          this.fail("unterminated CDATA section");
        }
        text += this.source.slice(this.pos + 9, end);
        this.pos = end + 3;
        continue;
      }
      if (this.skipMisc()) {
        continue;
      }
      if (this.startsWith("<")) {
        children.push(this.readElement());
        continue;
      }
      const next = this.source.indexOf("<", this.pos);
      const chunk =
        next === -1
          ? this.source.slice(this.pos)
          : this.source.slice(this.pos, next);
      text += decodeEntities(chunk);
      this.pos = next === -1 ? this.source.length : next;
    }
  }
}

/**
 * Parses an XML document and returns its root element as
 * `{ name, attributes, children, text }`.
 *
 * @param {string} source raw XML
 * @param {string} [sourceName] used in error messages
 */
function parseXml(source, sourceName) {
  const scanner = new Scanner(source, sourceName);
  scanner.skipMiscAndWhitespace();
  if (scanner.eof()) {
    scanner.fail("document has no root element");
  }
  const root = scanner.readElement();
  scanner.skipMiscAndWhitespace();
  if (!scanner.eof()) {
    scanner.fail("trailing content after the root element");
  }
  return root;
}

/** Direct children of `node` with the given tag name. */
function childrenNamed(node, name) {
  return node.children.filter((child) => {
    return child.name === name;
  });
}

/** Text of the single direct child named `name`, or undefined when absent. */
function childText(node, name) {
  const matches = childrenNamed(node, name);
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length > 1) {
    throw new XmlParseError(
      `<${node.name}> has ${matches.length} <${name}> children; expected at most one`,
    );
  }
  return matches[0].text;
}

module.exports = { parseXml, childrenNamed, childText, XmlParseError };
