"use strict";

/**
 * What a Dockerfile's instructions can take from the Enterprise Edition (ee/).
 *
 * Every image in this repository is built with the repository root as its
 * context (release.yml: `--context .`), so ee/ is in every build context and
 * the Dockerfile alone decides whether an image picks it up. Only the App's
 * enterprise target may. This finds every other way in, per stage:
 *
 *   - COPY / ADD from the context (shell or JSON form, any flags, several
 *     sources, ONBUILD too) whose source is the whole context (".", "./", "/",
 *     "packages/.."), has an "ee" path segment, starts with a pattern that
 *     matches "ee" ("*", "e?") or uses a variable, which cannot be checked;
 *   - COPY --from=<stage> of a stage that holds ee/ (a --from copy reads that
 *     stage or image, never the context, so its source paths are not checked);
 *   - FROM a stage that holds ee/;
 *   - RUN --mount: a bind mount without `from` mounts the context (the whole
 *     of it by default), and any mount `from` a stage that holds ee/.
 *
 * The stages that hold ee/ are exactly the allowed ones the caller names.
 */

const path = require("path");
const { instructions } = require("./DockerfileTemplate");

const COPY_OR_ADD = /^(?:ONBUILD\s+)?(COPY|ADD)\s+([\s\S]*)$/i;
const RUN = /^(?:ONBUILD\s+)?RUN\s+([\s\S]*)$/i;
const FLAG = /^--([A-Za-z-]+)(?:=(\S*))?(?:\s+|$)/;
const REMOTE_SOURCE = /^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i;
const QUOTED = /^(["'])([\s\S]*)\1$/;
const GLOB_CHARACTERS = /[*?[\\]/;

/**
 * Whether a Go filepath.Match pattern (Docker's COPY wildcards) matches a
 * name. `*`, `?`, `[...]` (ranges, `^`/`!` negation) and `\` escapes.
 * @param {string} pattern
 * @param {string} name
 * @returns {boolean}
 */
function globMatches(pattern, name) {
  if (pattern.length === 0) {
    return name.length === 0;
  }

  const head = pattern[0];

  if (head === "*") {
    for (let taken = 0; taken <= name.length; taken++) {
      if (globMatches(pattern.slice(1), name.slice(taken))) {
        return true;
      }
    }
    return false;
  }

  if (name.length === 0) {
    return false;
  }

  if (head === "?") {
    return globMatches(pattern.slice(1), name.slice(1));
  }

  if (head === "\\" && pattern.length > 1) {
    return (
      pattern[1] === name[0] && globMatches(pattern.slice(2), name.slice(1))
    );
  }

  if (head === "[") {
    const close = pattern.indexOf("]", 2);

    if (close !== -1) {
      let body = pattern.slice(1, close);
      const negated = body[0] === "^" || body[0] === "!";

      if (negated) {
        body = body.slice(1);
      }

      let matched = false;

      for (let index = 0; index < body.length; index++) {
        if (body[index + 1] === "-" && index + 2 < body.length) {
          if (name[0] >= body[index] && name[0] <= body[index + 2]) {
            matched = true;
          }
          index += 2;
        } else if (body[index] === name[0]) {
          matched = true;
        }
      }

      return (
        matched !== negated &&
        globMatches(pattern.slice(close + 1), name.slice(1))
      );
    }
  }

  return head === name[0] && globMatches(pattern.slice(1), name.slice(1));
}

function unquote(token) {
  const quoted = QUOTED.exec(token);
  return quoted ? quoted[2] : token;
}

/**
 * Reads the leading `--flag` / `--flag=value` options of an instruction's
 * arguments. A flag given twice keeps every value.
 * @param {string} text
 * @returns {{flags: Array<{name: string, value: (string|true)}>, rest: string}}
 */
function readFlags(text) {
  const flags = [];
  let rest = text.trim();
  let match = FLAG.exec(rest);

  while (match) {
    flags.push({
      name: match[1].toLowerCase(),
      value: match[2] === undefined ? true : unquote(match[2]),
    });
    rest = rest.slice(match[0].length);
    match = FLAG.exec(rest);
  }

  return { flags, rest: rest.trim() };
}

/**
 * Parses a COPY or ADD instruction (continuations already joined).
 * @param {string} line
 * @returns {null | {instruction: string, from: (string|true|undefined), sources: Array<string>, destination: string}}
 */
function parseCopy(line) {
  const match = COPY_OR_ADD.exec(line.trim());

  if (!match) {
    return null;
  }

  const { flags, rest } = readFlags(match[2]);
  let paths = null;
  let jsonLikePaths = null;

  if (rest.startsWith("[")) {
    try {
      const parsed = JSON.parse(rest);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => {
          return typeof item === "string";
        })
      ) {
        paths = parsed;
      }
    } catch (error) {
      // Not valid JSON: Docker reads it as the shell form, and so does this.
      paths = null;
    }
  }

  if (!paths) {
    const words = rest.split(/\s+/).filter((token) => {
      return token.length > 0;
    });

    paths = words.map(unquote);

    if (rest.startsWith("[")) {
      /*
       * Docker reads malformed JSON as the shell form (so `[e]e` is a
       * pattern), but the words may still have been meant as JSON: check
       * `["./ee",` as ./ee too.
       */
      jsonLikePaths = words.map((token) => {
        return unquote(token.replace(/^\[/, "").replace(/[\],]+$/, ""));
      });
    }
  }

  const fromFlag = flags.find((flag) => {
    return flag.name === "from";
  });
  // A heredoc (COPY <<EOF /dest) is inline content, not the context.
  const sourcesOf = (list) => {
    return list.slice(0, -1).filter((source) => {
      return !source.startsWith("<<");
    });
  };

  return {
    instruction: match[1].toUpperCase(),
    from: fromFlag ? fromFlag.value : undefined,
    sources: sourcesOf(paths),
    alternativeSources: jsonLikePaths ? sourcesOf(jsonLikePaths) : undefined,
    destination: paths[paths.length - 1] || "",
  };
}

/**
 * The `--mount` options of a RUN instruction, as key/value maps.
 * @param {string} line
 * @returns {Array<Object<string, string>>}
 */
function parseRunMounts(line) {
  const match = RUN.exec(line.trim());

  if (!match) {
    return [];
  }

  return readFlags(match[1])
    .flags.filter((flag) => {
      return flag.name === "mount" && typeof flag.value === "string";
    })
    .map((flag) => {
      const options = {};

      for (const pair of flag.value.split(",")) {
        const separator = pair.indexOf("=");
        const key = (separator === -1 ? pair : pair.slice(0, separator))
          .trim()
          .toLowerCase();
        options[key] = separator === -1 ? "" : pair.slice(separator + 1);
      }

      return options;
    });
}

/**
 * Why a source path read from the build context can reach ee/, or null when
 * it cannot.
 * @param {string} source
 * @returns {string|null}
 */
function contextSourceProblem(source) {
  if (REMOTE_SOURCE.test(source)) {
    return null;
  }

  if (source.includes("$")) {
    return "uses a variable, so what it copies cannot be checked";
  }

  /*
   * Context paths are rooted at the context: a leading "/" is the context
   * root, and ".." cannot climb above it. normalize() of the rooted path
   * leaves one leading "/" and at most one trailing "/".
   */
  let normalized = path.posix.normalize(`/${source}`).slice(1);

  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized === "") {
    return "copies the whole build context, which includes ee/";
  }

  const segments = normalized.split("/");

  if (segments.includes("ee") || segments[0].toLowerCase() === "ee") {
    return "has an ee path segment";
  }

  if (GLOB_CHARACTERS.test(segments[0]) && globMatches(segments[0], "ee")) {
    return `its pattern ${segments[0]} matches ee/`;
  }

  return null;
}

/**
 * Every way the given stages can pick up ee/, except through the allowed
 * stages themselves.
 * @param {Array<{name: (string|null), from: string, body: string, index: number}>} stages
 *   From DockerfileTemplate.parseStages.
 * @param {Array<string>} [allowedStages] - Stage names that may hold ee/
 * @returns {Array<{stage: string, instruction: string, problem: string}>}
 */
function findEnterpriseLeaks(stages, allowedStages) {
  const allowed = new Set(
    (allowedStages || []).map((name) => {
      return name.toLowerCase();
    }),
  );

  const holdsEnterprise = (reference) => {
    if (typeof reference !== "string") {
      return false;
    }

    const byIndex = /^\d+$/.test(reference)
      ? stages[Number(reference)]
      : undefined;
    const name = byIndex ? byIndex.name : reference.toLowerCase();

    return Boolean(name) && allowed.has(name);
  };

  const leaks = [];

  for (const stage of stages) {
    if (stage.name && allowed.has(stage.name)) {
      continue;
    }

    const label = stage.name || `#${stage.index}`;
    const report = (instruction, problem) => {
      leaks.push({ stage: label, instruction, problem });
    };

    if (holdsEnterprise(stage.from)) {
      report(`FROM ${stage.from}`, "is built FROM a stage that holds ee/");
    }

    for (const line of instructions(stage.body)) {
      const copy = parseCopy(line);

      if (copy) {
        if (typeof copy.from === "string") {
          if (holdsEnterprise(copy.from)) {
            report(line, `copies from ${copy.from}, which holds ee/`);
          }
          continue;
        }

        const sources = new Set([
          ...copy.sources,
          ...(copy.alternativeSources || []),
        ]);

        for (const source of sources) {
          const problem = contextSourceProblem(source);

          if (problem) {
            report(line, `${source}: ${problem}`);
          }
        }
        continue;
      }

      for (const mount of parseRunMounts(line)) {
        if (mount.from !== undefined) {
          if (holdsEnterprise(mount.from)) {
            report(line, `mounts from ${mount.from}, which holds ee/`);
          }
          continue;
        }

        if ((mount.type || "bind") !== "bind") {
          continue;
        }

        const source = mount.source || mount.src || ".";
        const problem = contextSourceProblem(source);

        if (problem) {
          report(line, `bind mount of ${source}: ${problem}`);
        }
      }
    }
  }

  return leaks;
}

module.exports = {
  globMatches,
  parseCopy,
  parseRunMounts,
  contextSourceProblem,
  findEnterpriseLeaks,
};
