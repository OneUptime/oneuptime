/**
 * A deliberately small nginx-config reader, shared by the tests in this
 * directory.
 *
 * It is not a general nginx parser and does not try to be one. It knows just
 * enough to answer the questions the tests ask: which server blocks exist,
 * which location blocks live inside each one, and which directives a given
 * block contains. That is enough to assert on default.conf.template and
 * nginx.conf without a running nginx, which matters because the ingress config
 * is one of the few things in this repo that has no unit-testable code path.
 */

const fs = require("node:fs");
const path = require("node:path");

const NGINX_DIRECTORY = path.resolve(__dirname, "..");

const TEMPLATE_PATH = path.join(NGINX_DIRECTORY, "default.conf.template");
const NGINX_CONF_PATH = path.join(NGINX_DIRECTORY, "nginx.conf");

/**
 * Drop `#` comments so brace counting and directive matching never trip over
 * prose. Comments in these files never appear inside a quoted string, so the
 * naive "cut at the first #" rule is safe here.
 */
function stripComments(source) {
  return source
    .split("\n")
    .map((line) => {
      const commentStart = line.indexOf("#");
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join("\n");
}

/**
 * Walk forward from an opening brace and return the index just past its
 * matching closing brace.
 *
 * `{8,}` inside a location regex is balanced, so plain counting is correct
 * for these files, but callers must hand in the index of the brace that opens
 * the block (see findBlocks, which takes the LAST brace on the header line).
 */
function findMatchingBrace(source, openBraceIndex) {
  let depth = 0;

  for (let index = openBraceIndex; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error(`Unbalanced braces starting at index ${openBraceIndex}`);
}

/**
 * Find every block whose header line matches `headerPattern`.
 *
 * The pattern must capture the header text and end at the line's final `{`,
 * which is what lets a regex location such as
 *   location ~ ^/x/.+-[A-Z0-9]{8,}\.js$ {
 * be read correctly instead of stopping at the `{` of `{8,}`.
 */
function findBlocks(source, headerPattern) {
  const pattern = new RegExp(headerPattern.source, "gm");
  const blocks = [];
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const headerEnd = match.index + match[0].length;
    const openBraceIndex = source.lastIndexOf("{", headerEnd);
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);

    blocks.push({
      header: match[0].trim(),
      spec: (match[1] || "").trim(),
      body: source.slice(openBraceIndex + 1, closeBraceIndex),
      startIndex: match.index,
    });

    pattern.lastIndex = closeBraceIndex;
  }

  return blocks;
}

function getServerBlocks(source) {
  return findBlocks(stripComments(source), /^server\s*\{[^\S\n]*$/);
}

function getLocationBlocks(source) {
  return findBlocks(
    stripComments(source),
    /^[^\S\n]*location[^\S\n]+(.*)\{[^\S\n]*$/,
  );
}

/**
 * Collect every occurrence of a directive in a chunk of config, as
 * whitespace-normalised single lines ("gzip_proxied    any;" -> "gzip_proxied any;").
 * Nested blocks are included, which is what the tests want: they ask "does this
 * server block set X anywhere inside it".
 */
function getDirectives(source, directiveName) {
  const pattern = new RegExp(
    `^[^\\S\\n]*${directiveName}(?:[^\\S\\n]+[^;\\n]*)?;`,
    "gm",
  );

  return (stripComments(source).match(pattern) || []).map((line) => {
    return line.trim().replace(/\s+/g, " ");
  });
}

function hasDirective(source, directiveName) {
  return getDirectives(source, directiveName).length > 0;
}

/**
 * Pull the regular expression out of a `~` / `~*` location spec.
 *
 * nginx's config tokeniser ends a word at an unquoted `{`, so any regex using
 * a repetition quantifier such as `{8,}` has to be written in double quotes.
 * Both spellings are unwrapped here.
 */
function locationRegexSource(spec) {
  const withoutOperator = spec.replace(/^~\*?/, "").trim();

  const quoted = withoutOperator.match(/^"(.*)"$/);

  return quoted ? quoted[1] : withoutOperator;
}

/**
 * nginx picks a location for a URI by: longest matching `^~` or plain prefix
 * first, but a matching regex location (`~` / `~*`, tried in file order) wins
 * over any plain prefix match. This mirrors that well enough to assert which
 * of our own blocks a given request path lands in.
 */
function resolveLocation(locations, uri) {
  for (const location of locations) {
    const caseInsensitive = location.spec.startsWith("~*");
    const caseSensitive = !caseInsensitive && location.spec.startsWith("~");

    if (!caseInsensitive && !caseSensitive) {
      continue;
    }

    const expression = locationRegexSource(location.spec);

    if (new RegExp(expression, caseInsensitive ? "i" : "").test(uri)) {
      return location;
    }
  }

  let best = null;
  let bestPrefixLength = -1;

  for (const location of locations) {
    if (location.spec.startsWith("~")) {
      continue;
    }

    const prefix = location.spec.replace(/^\^~\s*/, "").trim();

    if (!uri.startsWith(prefix)) {
      continue;
    }

    if (prefix.length > bestPrefixLength) {
      best = location;
      bestPrefixLength = prefix.length;
    }
  }

  return best;
}

function readTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, "utf8");
}

function readNginxConf() {
  return fs.readFileSync(NGINX_CONF_PATH, "utf8");
}

module.exports = {
  NGINX_DIRECTORY,
  TEMPLATE_PATH,
  NGINX_CONF_PATH,
  readTemplate,
  readNginxConf,
  stripComments,
  findBlocks,
  getServerBlocks,
  getLocationBlocks,
  getDirectives,
  hasDirective,
  locationRegexSource,
  resolveLocation,
};
