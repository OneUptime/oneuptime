import {
  CONTAINER_COMMAND_KNOWN_WORDS,
  ContainerCommandRole,
  classifyContainerCommand,
  containerCommandProjectionSql,
  isNonServerCommand,
  reduceContainerCommand,
} from "../../../Types/DatabaseServer/DatabaseContainerCommand";
import {
  ALL_COMMANDS,
  CLIENT_COMMANDS,
  COMPANION_COMMANDS,
  ContainerCommandCase,
  KEEP_ALIVE_COMMANDS,
  SERVER_COMMANDS,
  argvOf,
} from "./DatabaseContainerCommandCorpus";
import { describe, expect, test } from "@jest/globals";

const SECRET: string = "hunter2-do-not-leak";

function label(entry: ContainerCommandCase): string {
  return entry.name;
}

describe("classifyContainerCommand — real-world entrypoints", () => {
  test.each(SERVER_COMMANDS.map(label))(
    "%s is a possible server",
    (name: string) => {
      const entry: ContainerCommandCase = SERVER_COMMANDS.find(
        (candidate: ContainerCommandCase): boolean => {
          return candidate.name === name;
        },
      )!;
      expect(classifyContainerCommand(entry)).toBe("server");
      expect(isNonServerCommand(entry)).toBe(false);
    },
  );

  test.each(CLIENT_COMMANDS.map(label))(
    "%s is a client run",
    (name: string) => {
      const entry: ContainerCommandCase = CLIENT_COMMANDS.find(
        (candidate: ContainerCommandCase): boolean => {
          return candidate.name === name;
        },
      )!;
      expect(classifyContainerCommand(entry)).toBe("client");
      expect(isNonServerCommand(entry)).toBe(true);
    },
  );

  test.each(KEEP_ALIVE_COMMANDS.map(label))(
    "%s is a keep-alive",
    (name: string) => {
      const entry: ContainerCommandCase = KEEP_ALIVE_COMMANDS.find(
        (candidate: ContainerCommandCase): boolean => {
          return candidate.name === name;
        },
      )!;
      expect(classifyContainerCommand(entry)).toBe("keep-alive");
      expect(isNonServerCommand(entry)).toBe(true);
    },
  );

  test.each(COMPANION_COMMANDS.map(label))(
    "%s is a Sentinel, not the database",
    (name: string) => {
      const entry: ContainerCommandCase = COMPANION_COMMANDS.find(
        (candidate: ContainerCommandCase): boolean => {
          return candidate.name === name;
        },
      )!;
      expect(classifyContainerCommand(entry)).toBe("companion");
      expect(isNonServerCommand(entry)).toBe(true);
    },
  );

  test("the projected form classifies exactly like the spec it came from", () => {
    for (const entry of ALL_COMMANDS) {
      const projected: Array<string | null> = reduceContainerCommand(
        argvOf(entry),
      );
      expect({
        name: entry.name,
        role: classifyContainerCommand({ command: projected }),
      }).toEqual({ name: entry.name, role: entry.role });
      // Reducing what Postgres already reduced changes nothing.
      expect(reduceContainerCommand(projected)).toEqual(projected);
    }
  });
});

describe("classifyContainerCommand — fail open", () => {
  test("regression: a script the projection could not read is a possible server, not an interactive shell", () => {
    // What the old projection returned for a newline-led `sh -c` script.
    expect(classifyContainerCommand({ command: ["/bin/sh", "-c", null] })).toBe(
      "server",
    );
    expect(classifyContainerCommand({ command: ["bash", "-ec"] })).toBe(
      "server",
    );
  });

  test("regression: any single-dash flag cluster containing c runs a script", () => {
    for (const flag of ["-c", "-ec", "-ce", "-cex", "-ecx", "-euxc", "-lc"]) {
      expect(
        classifyContainerCommand({ command: ["bash", flag, "exec postgres"] }),
      ).toBe("server");
      expect(
        classifyContainerCommand({ command: ["bash", flag, "sleep infinity"] }),
      ).toBe("keep-alive");
    }
    // -C is noclobber, not a script: the next word is a script FILE.
    expect(
      classifyContainerCommand({ command: ["sh", "-C", "sleep infinity"] }),
    ).toBe("server");
  });

  test("regression: a shell running a script file is a possible server", () => {
    expect(
      classifyContainerCommand({ command: ["/bin/bash", "/scripts/start.sh"] }),
    ).toBe("server");
    expect(
      classifyContainerCommand({ command: ["sh"], args: ["/entrypoint.sh"] }),
    ).toBe("server");
    expect(
      classifyContainerCommand({
        command: ["sh", "-e", "--", "/entrypoint.sh"],
      }),
    ).toBe("server");
  });

  test("regression: a keep-alive or utility FIRST does not hide the server started after it", () => {
    for (const script of [
      "sleep 5 && exec redis-server",
      "cat /tmpl > /etc/redis.conf; exec redis-server",
      "tail -n 0 /etc/hosts; postgres",
      "true\nexec mongod",
      "#!/bin/sh\nexec postgres",
      "\n\n# start\n\texec postgres",
    ]) {
      expect(classifyContainerCommand({ command: ["sh", "-c", script] })).toBe(
        "server",
      );
    }
  });

  test("a client alone is rejected only when nothing else in the script runs", () => {
    expect(
      classifyContainerCommand({ command: ["sh", "-c", "psql -f /x.sql"] }),
    ).toBe("client");
    expect(
      classifyContainerCommand({
        command: ["sh", "-c", "psql -f /x.sql; ./serve"],
      }),
    ).toBe("server");
  });

  test("an empty or missing command is the image's own entrypoint", () => {
    expect(classifyContainerCommand({})).toBe("server");
    expect(classifyContainerCommand({ command: [], args: [] })).toBe("server");
    expect(classifyContainerCommand({ command: [null, "x"] })).toBe("server");
    expect(classifyContainerCommand({ command: ["   "] })).toBe("server");
  });

  test("program names are matched case-insensitively and without their path", () => {
    expect(classifyContainerCommand({ command: ["/usr/bin/PSQL"] })).toBe(
      "client",
    );
    expect(
      classifyContainerCommand({ command: ["/BIN/SH", "-c", "SLEEP 1"] }),
    ).toBe("keep-alive");
  });
});

describe("reduceContainerCommand — what may leave Postgres", () => {
  test("a non-shell program keeps only its first word (and a --sentinel flag)", () => {
    expect(
      reduceContainerCommand(["postgres", "-c", `password=${SECRET}`]),
    ).toEqual(["postgres"]);
    expect(
      reduceContainerCommand(["  \n\tredis-server", "/conf", "--sentinel"]),
    ).toEqual(["redis-server", "--sentinel"]);
    expect(reduceContainerCommand([])).toEqual([]);
    expect(reduceContainerCommand([null, "x"])).toEqual([]);
  });

  test("a shell keeps its flags and, per argument, only the known command names it runs", () => {
    expect(
      reduceContainerCommand([
        "/bin/bash",
        "-ecx",
        "set -x\nuntil pg_isready; do sleep 1; done\nexec postgres",
      ]),
    ).toEqual(["/bin/bash", "-ecx", "?\ndone\npg_isready\nset\nsleep"]);
    expect(
      reduceContainerCommand(["sh", "-c", "  \n  # nothing to do\n"]),
    ).toEqual(["sh", "-c", ""]);
    expect(reduceContainerCommand(["sh", "-c", null])).toEqual([
      "sh",
      "-c",
      null,
    ]);
  });

  test("only the first eight shell arguments are read; more are marked unreadable", () => {
    const argv: Array<string> = ["sh", ...Array(12).fill("-e"), "-c", "psql"];
    const reduced: Array<string | null> = reduceContainerCommand(argv);
    expect(reduced).toHaveLength(10);
    expect(reduced[9]).toBe("?");
  });

  test("a script too long to read is unreadable, so a possible server", () => {
    const long: string = "psql -c 'select 1'\n".repeat(1000);
    expect(reduceContainerCommand(["sh", "-c", long])).toEqual([
      "sh",
      "-c",
      "?",
    ]);
    expect(classifyContainerCommand({ command: ["sh", "-c", long] })).toBe(
      "server",
    );
    // Counted in characters, as Postgres counts: an emoji is two UTF-16 units.
    expect(
      reduceContainerCommand(["sh", "-c", `psql ${"\u{1F600}".repeat(16379)}`]),
    ).toEqual(["sh", "-c", "psql"]);
    expect(
      reduceContainerCommand(["sh", "-c", `psql ${"\u{1F600}".repeat(16380)}`]),
    ).toEqual(["sh", "-c", "?"]);
  });

  test("secrets in arguments, scripts and heredocs never survive the reduction", () => {
    for (const argv of [
      ["postgres", "-c", `password=${SECRET}`],
      ["redis-server", "--requirepass", SECRET],
      ["mysql", `-p${SECRET}`],
      ["sh", "-c", `redis-server --requirepass ${SECRET}`],
      ["sh", "-c", `PGPASSWORD=${SECRET} psql -h db`],
      ["sh", "-c", `cat > /etc/secret <<EOF\n${SECRET}\nEOF\nexec postgres`],
      ["sh", "-c", `echo '${SECRET}'; "${SECRET}"`],
      ["bash", "-o", SECRET, "-c", "exec postgres"],
      ["sh", SECRET],
    ]) {
      expect(JSON.stringify(reduceContainerCommand(argv))).not.toContain(
        "hunter2",
      );
    }
  });

  test("the known words are plain lowercase command names that never start a server", () => {
    expect(CONTAINER_COMMAND_KNOWN_WORDS.length).toBeGreaterThan(50);
    expect([...CONTAINER_COMMAND_KNOWN_WORDS].sort()).toEqual([
      ...CONTAINER_COMMAND_KNOWN_WORDS,
    ]);
    expect(new Set(CONTAINER_COMMAND_KNOWN_WORDS).size).toBe(
      CONTAINER_COMMAND_KNOWN_WORDS.length,
    );
    for (const word of CONTAINER_COMMAND_KNOWN_WORDS) {
      expect(word).toMatch(/^[a-z0-9_.:!{}[\]-]+$/);
      expect(word).not.toBe("?");
    }
    for (const server of [
      "postgres",
      "postmaster",
      "mongod",
      "mongos",
      "mysqld",
      "mariadbd",
      "redis-server",
      "valkey-server",
      "cockroach",
      "clickhouse",
      "clickhouse-server",
      "neo4j-admin",
      "sh",
      "bash",
      "env",
      "exec",
      "eval",
      "source",
      ".",
      "timeout",
      "nohup",
      "gosu",
      "su",
      "sudo",
      "xargs",
      "find",
      "docker-entrypoint.sh",
    ]) {
      expect(CONTAINER_COMMAND_KNOWN_WORDS).not.toContain(server);
    }
  });
});

describe("containerCommandProjectionSql", () => {
  test("reads the given argv expression and known-word array, and nothing else of the spec", () => {
    const sql: string = containerCommandProjectionSql({
      argv: "v.argv",
      knownWords: "$8::text[]",
    });
    expect(sql).toContain("v.argv ->> 0");
    expect(sql).toContain("jsonb_array_elements_text(v.argv)");
    expect(sql).toContain("= ANY($8::text[])");
    expect(sql).not.toMatch(/\benv\b/);
    expect(sql).not.toMatch(/"spec"/);
  });
});

describe("the corpus itself", () => {
  test("covers every role and has unique names", () => {
    const roles: Set<ContainerCommandRole> = new Set<ContainerCommandRole>(
      ALL_COMMANDS.map((entry: ContainerCommandCase): ContainerCommandRole => {
        return entry.role;
      }),
    );
    expect(Array.from(roles).sort()).toEqual([
      "client",
      "companion",
      "keep-alive",
      "server",
    ]);
    expect(
      new Set(
        ALL_COMMANDS.map((entry: ContainerCommandCase): string => {
          return entry.name;
        }),
      ).size,
    ).toBe(ALL_COMMANDS.length);
  });
});
