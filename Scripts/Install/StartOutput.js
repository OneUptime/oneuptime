// How the steps of `npm start` say what they found: one line each, marked.

/*
 * `npm start` runs a few small scripts before Docker Compose starts anything
 * (Preflight.js, GenerateDatabasePassword.js, ReplacePlaceholderSecrets.js,
 * FollowIngressPort.js, CheckIngressPorts.js). Each says what it found or did
 * in one line, indented under the heading Preflight.js prints, and marked the
 * same way, so a newcomer reads one list rather than five scripts' styles:
 *
 *   ✓  done, or fine as it is
 *   !  worth knowing, or worth fixing; OneUptime starts anyway
 *   ✗  OneUptime cannot start until it is fixed
 *
 * Plain characters only (no colours, no emoji): the output is read in
 * terminals, CI logs and pasted into issues alike.
 */

const MARKS = {
  ok: "✓",
  warn: "!",
  stop: "✗",
};

// The heading the list starts under.
const HEADING = "Checking this server before OneUptime starts:";

// One line of the list.
const line = (level, text) => {
  return `  ${MARKS[level] || MARKS.warn} ${text}`;
};

const ok = (text) => {
  return line("ok", text);
};

const warn = (text) => {
  return line("warn", text);
};

const stop = (text) => {
  return line("stop", text);
};

// "a", "a and b", "a, b and c".
const listed = (items) => {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

module.exports = {
  MARKS,
  HEADING,
  line,
  ok,
  warn,
  stop,
  listed,
};
