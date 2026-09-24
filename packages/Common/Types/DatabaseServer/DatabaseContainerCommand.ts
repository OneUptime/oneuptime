/*
 * "Does this container run the database server, or something else that
 * happens to use a database image?" — read from the program a Kubernetes
 * container starts (`command` followed by `args`).
 *
 * It fails OPEN: a container is a possible server unless its command line
 * proves otherwise. Proof is
 *   - a client, dump or admin tool as the program itself (`psql`,
 *     `redis-cli`, `pg_dump`, `mongosh`) — "client";
 *   - a keep-alive as the program itself (`sleep infinity`, `tail -f
 *     /dev/null`, `cat`), or a shell with no script to run (`bash`,
 *     `sh -i`) — "keep-alive";
 *   - a Redis-family Sentinel (`redis-sentinel`, `redis-server … --sentinel`)
 *     — "companion";
 *   - a `sh -c` script EVERY command of which is one of those, a shell
 *     keyword or builtin, or a plain utility (`echo`, `set -x`, `until …; do
 *     sleep 1; done`, `cp`) — so a script that starts anything else
 *     (`exec postgres`, a start script, `"$@"`, a nested shell) is a possible
 *     server however it begins.
 * Whatever cannot be read — a script FILE (`bash /start.sh`), a wrapper
 * (`tini --`, `gosu`), a heredoc, a script longer than
 * MAX_SCRIPT_CHARACTERS, a script the projection lost — is a possible
 * server: a false positive auto-archives later, a server that is
 * never discovered is never seen at all.
 *
 * The rules read a REDUCED command line, which Postgres computes before a
 * pod spec leaves the database (containerCommandProjectionSql) and
 * reduceContainerCommand, its JavaScript twin, computes from a full spec:
 * the program's first word; for a shell, each of its first
 * MAX_SHELL_ARGUMENTS arguments as either a flag or the set of command names
 * it would run — each one on CONTAINER_COMMAND_KNOWN_WORDS or replaced by
 * "?". Argument values, environment variables and every other word stay in
 * Postgres. classifyContainerCommand always reduces first, and reducing a
 * reduction changes nothing, so a full spec and a projected one classify
 * alike by construction. Both twins are built from the same regular
 * expression sources, written in the subset JavaScript and Postgres ARE
 * read the same way (no `\s`, `.` or POSIX classes; whitespace spelled out),
 * and DatabaseContainerCommandPostgres.test.ts holds them together.
 */

export type ContainerCommandRole =
  // The image's own entrypoint, or anything not proven to be something else.
  | "server"
  // A client, dump, restore or admin tool — or a script that runs only those.
  | "client"
  // A sleep / tail / cat, an interactive shell, or a script that only waits.
  | "keep-alive"
  // Part of the deployment but never the database (Redis-family Sentinel).
  | "companion";

export interface ContainerCommandLike {
  command?: Array<string | null> | undefined;
  args?: Array<string | null> | undefined;
}

// The engines' clients, dump / restore / admin tools and benchmarks.
const CLIENT_PROGRAMS: ReadonlySet<string> = new Set<string>([
  "arangodump",
  "arangoexport",
  "arangoimport",
  "arangorestore",
  "arangosh",
  "bsondump",
  "cassandra-stress",
  "cbq",
  "clickhouse-benchmark",
  "clickhouse-client",
  "clusterdb",
  "cqlsh",
  "createdb",
  "createuser",
  "cypher-shell",
  "dropdb",
  "dropuser",
  "etcdctl",
  "influx",
  "keydb-benchmark",
  "keydb-cli",
  "mariabackup",
  "mariadb",
  "mariadb-admin",
  "mariadb-backup",
  "mariadb-binlog",
  "mariadb-check",
  "mariadb-dump",
  "mariadb-import",
  "mariadb-slap",
  "memtier_benchmark",
  "mongo",
  "mongodump",
  "mongoexport",
  "mongofiles",
  "mongoimport",
  "mongorestore",
  "mongosh",
  "mongostat",
  "mongotop",
  "mysql",
  "mysqladmin",
  "mysqlbinlog",
  "mysqlcheck",
  "mysqldump",
  "mysqlimport",
  "mysqlpump",
  "mysqlsh",
  "mysqlslap",
  "nodetool",
  "pg_amcheck",
  "pg_basebackup",
  "pg_dump",
  "pg_dumpall",
  "pg_isready",
  "pg_receivewal",
  "pg_restore",
  "pg_verifybackup",
  "pgbench",
  "psql",
  "redis-benchmark",
  "redis-check-aof",
  "redis-check-rdb",
  "redis-cli",
  "reindexdb",
  "sqlcmd",
  "sqlplus",
  "vacuumdb",
  "valkey-benchmark",
  "valkey-check-aof",
  "valkey-check-rdb",
  "valkey-cli",
  "xtrabackup",
  "ycqlsh",
  "ysqlsh",
]);

// Commands that only hold a debug pod open.
const KEEP_ALIVE_PROGRAMS: ReadonlySet<string> = new Set<string>([
  "cat",
  "sleep",
  "tail",
  "true",
]);

const COMPANION_PROGRAMS: ReadonlySet<string> = new Set<string>([
  "keydb-sentinel",
  "redis-sentinel",
  "valkey-sentinel",
]);

// Servers that run as a Sentinel when given this flag.
const SENTINEL_FLAG: string = "--sentinel";
const SENTINEL_CAPABLE_SERVERS: ReadonlySet<string> = new Set<string>([
  "keydb-server",
  "redis-server",
  "valkey-server",
]);

/*
 * Shell keywords, builtins and utilities that never start a server. Nothing
 * here may run another program: `env`, `exec`, `eval`, `source` / `.`,
 * `xargs`, `find`, `timeout`, `nohup`, `su`, `gosu` and the shells
 * themselves are absent on purpose.
 */
const SCRIPT_UTILITIES: ReadonlySet<string> = new Set<string>([
  "!",
  ":",
  "[",
  "[[",
  "{",
  "}",
  "awk",
  "base64",
  "basename",
  "break",
  "case",
  "cd",
  "chmod",
  "chown",
  "continue",
  "cp",
  "curl",
  "cut",
  "date",
  "declare",
  "dirname",
  "do",
  "done",
  "echo",
  "elif",
  "else",
  "envsubst",
  "esac",
  "exit",
  "export",
  "expr",
  "false",
  "fi",
  "for",
  "getent",
  "grep",
  "gzip",
  "head",
  "hostname",
  "id",
  "if",
  "in",
  "install",
  "jq",
  "kill",
  "ln",
  "local",
  "ls",
  "mkdir",
  "mktemp",
  "mv",
  "nslookup",
  "printf",
  "pwd",
  "read",
  "readonly",
  "return",
  "rm",
  "sed",
  "seq",
  "set",
  "shift",
  "shopt",
  "sort",
  "tee",
  "test",
  "then",
  "touch",
  "tr",
  "trap",
  "typeset",
  "ulimit",
  "umask",
  "uniq",
  "unset",
  "until",
  "wait",
  "wc",
  "wget",
  "while",
]);

const SHELL_PROGRAMS: ReadonlySet<string> = new Set<string>([
  "ash",
  "bash",
  "dash",
  "sh",
  "zsh",
]);

/*
 * The command names that may leave Postgres as themselves; any other
 * command name leaves it as UNKNOWN_WORD. None of them can start a server.
 */
export const CONTAINER_COMMAND_KNOWN_WORDS: ReadonlyArray<string> = Array.from(
  new Set<string>([
    ...Array.from(CLIENT_PROGRAMS),
    ...Array.from(KEEP_ALIVE_PROGRAMS),
    ...Array.from(COMPANION_PROGRAMS),
    ...Array.from(SCRIPT_UTILITIES),
  ]),
).sort();

const KNOWN_WORDS: ReadonlySet<string> = new Set<string>(
  CONTAINER_COMMAND_KNOWN_WORDS,
);

// A command name that is not a known word (or text that cannot be read).
const UNKNOWN_WORD: string = "?";

// A shell's arguments read after its program; more are marked UNKNOWN_WORD.
const MAX_SHELL_ARGUMENTS: number = 8;

/*
 * A longer shell argument is not read (it reduces to "?"): it bounds what
 * the candidate-pod query spends per container on a pathological inline
 * script. Counted in characters (code points), as Postgres length() counts.
 */
const MAX_SCRIPT_CHARACTERS: number = 16384;

// ---- the shared regular expressions ----------------------------------------

// Whitespace, spelled out: `\s` and [[:space:]] do not agree.
const WS: string = " \\t\\n\\r\\f\\v";

// The first word of argv[0], after any leading whitespace.
const PROGRAM_SOURCE: string = `^[${WS}]*([^${WS};&|=]+)`;

const SHELL_PROGRAM_SOURCE: string = "(^|/)(sh|bash|ash|dash|zsh)$";

// `-ecx`, `+o`, `--`, `--noprofile`: a shell argument kept verbatim.
const SHELL_OPTION_SOURCE: string =
  "^([-+][A-Za-z]{0,8}|--|--[A-Za-z][A-Za-z-]{0,23})$";

/*
 * A script is cleaned in this order, then its command names are read:
 * line continuations → a space; backslash escapes → "?"; comments (outside
 * quotes) dropped; quoted strings and `$( )` / `${ }` / backquote
 * substitutions → "?"; redirections → a space; `NAME=value` words dropped.
 */
const LINE_CONTINUATION_SOURCE: string = "\\\\\\r?\\n";
const ESCAPED_CHARACTER_SOURCE: string = "\\\\[^\\n]";
const COMMENT_SOURCE: string = `('[^']*'|"[^"]*")|(^|[${WS};&|()])#[^\\n]*`;
const QUOTED_SOURCE: string =
  "'[^']*'|\"[^\"]*\"|`[^`]*`|\\$\\([^()]*\\)|\\$\\{[^}]*\\}";
const REDIRECTION_SOURCE: string = "&?[0-9]*[<>]+&?[0-9]*-?";
const ASSIGNMENT_SOURCE: string = `(^|[${WS};&|()])[A-Za-z_][A-Za-z0-9_]*=[^${WS};&|()]*`;

/*
 * A command name: the first word after the start, a newline or one of
 * `; & | ( )`, past any keyword that is followed by a command (`then`, `do`,
 * `!`, `exec` …).
 */
const COMMAND_WORD_SOURCE: string = `(?:^|[;&|()\\n])[${WS}]*(?:(?:if|then|else|elif|do|while|until|exec|time|!|\\{)[${WS}]+)*([^${WS};&|()]+)`;

const PROGRAM_REGEX: RegExp = new RegExp(PROGRAM_SOURCE);
const SHELL_PROGRAM_REGEX: RegExp = new RegExp(SHELL_PROGRAM_SOURCE, "i");
const SHELL_OPTION_REGEX: RegExp = new RegExp(SHELL_OPTION_SOURCE);
const LINE_CONTINUATION_REGEX: RegExp = new RegExp(
  LINE_CONTINUATION_SOURCE,
  "g",
);
const ESCAPED_CHARACTER_REGEX: RegExp = new RegExp(
  ESCAPED_CHARACTER_SOURCE,
  "g",
);
const COMMENT_REGEX: RegExp = new RegExp(COMMENT_SOURCE, "g");
const QUOTED_REGEX: RegExp = new RegExp(QUOTED_SOURCE, "g");
const REDIRECTION_REGEX: RegExp = new RegExp(REDIRECTION_SOURCE, "g");
const ASSIGNMENT_REGEX: RegExp = new RegExp(ASSIGNMENT_SOURCE, "g");

// A single-dash flag cluster with `c`: the shell runs its operand as a script.
const SCRIPT_FLAG_REGEX: RegExp = /^-[A-Za-z]*c/;
// `-o` / `+o` / `-O` / `+O` last in a cluster: the next argument is its value.
const VALUED_FLAG_REGEX: RegExp = /^[-+][A-Za-z]*[oO]$/;

// ---- the JavaScript twin -----------------------------------------------------

// A JSON array element as Postgres `->>` reads it.
function toText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function isLongerThan(value: string, characters: number): boolean {
  // UTF-16 length is an upper bound on the code point count.
  return value.length > characters && Array.from(value).length > characters;
}

function baseName(value: string): string {
  return value.substring(value.lastIndexOf("/") + 1).toLowerCase();
}

// The command names a script runs, as a sorted "\n"-joined set.
function reduceScript(script: string): string {
  const cleaned: string = script
    .replace(LINE_CONTINUATION_REGEX, " ")
    .replace(ESCAPED_CHARACTER_REGEX, "?")
    .replace(COMMENT_REGEX, "$1$2")
    .replace(QUOTED_REGEX, "?")
    .replace(REDIRECTION_REGEX, " ")
    .replace(ASSIGNMENT_REGEX, "$1");

  const names: Set<string> = new Set<string>();
  const commandWords: RegExp = new RegExp(COMMAND_WORD_SOURCE, "g");
  let match: RegExpExecArray | null = commandWords.exec(cleaned);
  while (match) {
    const name: string = baseName(match[1]!);
    names.add(KNOWN_WORDS.has(name) ? name : UNKNOWN_WORD);
    match = commandWords.exec(cleaned);
  }

  return Array.from(names).sort().join("\n");
}

/**
 * The reduced command line containerCommandProjectionSql computes in
 * Postgres, from a full `command ++ args`: [] when there is no program;
 * `[program]` (plus "--sentinel" when present) for anything but a shell;
 * for a shell, `[program, …]` with each of its first MAX_SHELL_ARGUMENTS
 * arguments kept when it is a flag and reduced to the command names it runs
 * otherwise ("?" when longer than MAX_SCRIPT_CHARACTERS), and "?" appended
 * when there are more.
 */
export function reduceContainerCommand(
  argv: ReadonlyArray<unknown>,
): Array<string | null> {
  const first: string | null = toText(argv[0]);
  const program: RegExpExecArray | null =
    first === null ? null : PROGRAM_REGEX.exec(first);
  if (!program) {
    return [];
  }
  const name: string = program[1]!;

  if (!SHELL_PROGRAM_REGEX.test(name)) {
    return argv.includes(SENTINEL_FLAG) ? [name, SENTINEL_FLAG] : [name];
  }

  const reduced: Array<string | null> = [name];
  const last: number = Math.min(argv.length - 1, MAX_SHELL_ARGUMENTS);
  for (let index: number = 1; index <= last; index++) {
    const word: string | null = toText(argv[index]);
    if (word === null) {
      reduced.push(null);
    } else if (SHELL_OPTION_REGEX.test(word)) {
      reduced.push(word);
    } else if (isLongerThan(word, MAX_SCRIPT_CHARACTERS)) {
      reduced.push(UNKNOWN_WORD);
    } else {
      reduced.push(reduceScript(word));
    }
  }
  if (argv.length > MAX_SHELL_ARGUMENTS + 1) {
    reduced.push(UNKNOWN_WORD);
  }
  return reduced;
}

// ---- the rules ----------------------------------------------------------------

function roleOfScript(script: string): ContainerCommandRole {
  let runsClient: boolean = false;
  let runsCompanion: boolean = false;

  for (const name of reduceScript(script).split("\n")) {
    if (!name) {
      continue;
    }
    if (COMPANION_PROGRAMS.has(name)) {
      runsCompanion = true;
    } else if (CLIENT_PROGRAMS.has(name)) {
      runsClient = true;
    } else if (!KEEP_ALIVE_PROGRAMS.has(name) && !SCRIPT_UTILITIES.has(name)) {
      // Anything else, a nested shell or an unreadable word included.
      return "server";
    }
  }

  if (runsCompanion) {
    return "companion";
  }
  return runsClient ? "client" : "keep-alive";
}

function roleOfReducedCommand(
  reduced: ReadonlyArray<string | null>,
): ContainerCommandRole {
  // A gap (null) ends what can be trusted about the command line.
  const words: Array<string> = [];
  for (const word of reduced) {
    if (typeof word !== "string") {
      break;
    }
    words.push(word);
  }

  if (words.length === 0) {
    // Neither command nor args: the image's entrypoint, i.e. the server.
    return "server";
  }

  const program: string = baseName(words[0]!);

  if (!SHELL_PROGRAMS.has(program)) {
    if (
      COMPANION_PROGRAMS.has(program) ||
      (SENTINEL_CAPABLE_SERVERS.has(program) && words.includes(SENTINEL_FLAG))
    ) {
      return "companion";
    }
    if (CLIENT_PROGRAMS.has(program)) {
      return "client";
    }
    if (KEEP_ALIVE_PROGRAMS.has(program) || SCRIPT_UTILITIES.has(program)) {
      return "keep-alive";
    }
    return "server";
  }

  // A shell: walk its flags to its operand.
  let runsScript: boolean = false;
  let index: number = 1;
  while (index < words.length) {
    const word: string = words[index]!;
    if (word === "--" || word === "-") {
      index++;
      break;
    }
    if (!SHELL_OPTION_REGEX.test(word)) {
      break;
    }
    if (SCRIPT_FLAG_REGEX.test(word)) {
      runsScript = true;
    }
    index += VALUED_FLAG_REGEX.test(word) ? 2 : 1;
  }

  const operand: string | undefined = words[index];
  if (operand === undefined) {
    // `bash`, `sh -i` are interactive; `sh -c` with its script lost is unreadable.
    return runsScript ? "server" : "keep-alive";
  }
  if (!runsScript) {
    // A script FILE: whatever it starts cannot be read here.
    return "server";
  }
  return roleOfScript(operand);
}

/**
 * What a Kubernetes container runs, from its `command` and `args` — a full
 * spec's or the reduction CANDIDATE_PODS_SQL projects (pass that as
 * `command`). See the file header for the rules.
 */
export function classifyContainerCommand(
  container: ContainerCommandLike,
): ContainerCommandRole {
  const command: unknown = container?.command;
  const args: unknown = container?.args;
  const argv: Array<unknown> = [
    ...(Array.isArray(command) ? command : []),
    ...(Array.isArray(args) ? args : []),
  ];
  return roleOfReducedCommand(reduceContainerCommand(argv));
}

// True when the container is proven to run a client, keep-alive or Sentinel — not a server.
export function isNonServerCommand(container: ContainerCommandLike): boolean {
  return classifyContainerCommand(container) !== "server";
}

// ---- the Postgres twin ------------------------------------------------------

// A dollar-quoted literal: read verbatim whatever standard_conforming_strings is.
function sqlLiteral(value: string): string {
  if (value.includes("$re$")) {
    throw new Error("a projection literal cannot contain its own quote tag");
  }
  return `$re$${value}$re$`;
}

/**
 * The Postgres expression reduceContainerCommand is the twin of: a jsonb
 * array computed from `argv` (a SQL expression for the jsonb array
 * `command || args`), with `knownWords` (a SQL expression for a text[]
 * holding CONTAINER_COMMAND_KNOWN_WORDS) deciding which command names may
 * leave as themselves.
 */
export function containerCommandProjectionSql(data: {
  argv: string;
  knownWords: string;
}): string {
  const argv: string = data.argv;

  const cleanedScript: string = [
    [LINE_CONTINUATION_SOURCE, " "],
    [ESCAPED_CHARACTER_SOURCE, "?"],
    [COMMENT_SOURCE, "\\1\\2"],
    [QUOTED_SOURCE, "?"],
    [REDIRECTION_SOURCE, " "],
    [ASSIGNMENT_SOURCE, "\\1"],
  ].reduce((expression: string, step: Array<string>): string => {
    return `regexp_replace(${expression}, ${sqlLiteral(step[0]!)}, ${sqlLiteral(step[1]!)}, 'g')`;
  }, "w.word");

  return `(
    SELECT CASE
      WHEN p.program IS NULL THEN '[]'::jsonb
      WHEN p.program !~* ${sqlLiteral(SHELL_PROGRAM_SOURCE)}
        THEN jsonb_build_array(p.program)
          || CASE WHEN ${argv} ? '${SENTINEL_FLAG}'
            THEN '["${SENTINEL_FLAG}"]'::jsonb ELSE '[]'::jsonb END
      ELSE jsonb_build_array(p.program)
        || COALESCE((
          SELECT jsonb_agg(
            CASE
              WHEN w.word IS NULL THEN NULL
              WHEN w.word ~ ${sqlLiteral(SHELL_OPTION_SOURCE)} THEN w.word
              WHEN length(w.word) > ${MAX_SCRIPT_CHARACTERS} THEN '${UNKNOWN_WORD}'
              ELSE COALESCE((
                SELECT string_agg(DISTINCT n.name COLLATE "C", chr(10) ORDER BY n.name COLLATE "C")
                FROM (
                  SELECT CASE
                    WHEN b.name = ANY(${data.knownWords}) THEN b.name
                    ELSE '${UNKNOWN_WORD}'
                  END AS name
                  FROM regexp_matches(
                    ${cleanedScript},
                    ${sqlLiteral(COMMAND_WORD_SOURCE)},
                    'g'
                  ) AS m(parts)
                  CROSS JOIN LATERAL (
                    SELECT lower(regexp_replace(m.parts[1], '^.*/', '')) AS name
                  ) AS b
                ) AS n
              ), '')
            END
            ORDER BY w.position
          )
          FROM jsonb_array_elements_text(${argv}) WITH ORDINALITY AS w(word, position)
          WHERE w.position BETWEEN 2 AND ${MAX_SHELL_ARGUMENTS + 1}
        ), '[]'::jsonb)
        || CASE WHEN jsonb_array_length(${argv}) > ${MAX_SHELL_ARGUMENTS + 1}
          THEN '["${UNKNOWN_WORD}"]'::jsonb ELSE '[]'::jsonb END
    END
    FROM (
      SELECT substring(${argv} ->> 0 from ${sqlLiteral(PROGRAM_SOURCE)}) AS program
    ) AS p
  )`;
}
