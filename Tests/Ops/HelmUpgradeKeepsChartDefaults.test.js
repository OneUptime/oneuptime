"use strict";

/**
 * No upgrade OneUptime tells anyone to run is a `helm upgrade --reuse-values`.
 *
 * --reuse-values renders the new chart with the previous release's values,
 * and those include the defaults of the chart the release came from: Helm
 * puts them in place of the new chart's values.yaml (pkg/action/upgrade.go,
 * reuseValues: `chart.Values = oldVals`). A test cluster upgraded that way
 * from kubernetes-agent 14.0.10 to 14.0.14 kept OBI v0.9.0 and the old eBPF
 * exclusion list, so every fix since was silently not deployed. The commands
 * use --reset-then-reuse-values (Helm 3.14+), which keeps only the values
 * the release was given, or `helm get values` (without --all) into -f on an
 * older Helm.
 *
 * Saying why not is allowed and expected: "Don't upgrade with
 * `--reuse-values`" is not a command. So this reads the commands themselves,
 * the way each file holds them:
 *
 *  - Markdown (the chart README, every docs page in every language): the
 *    lines of fenced code blocks, and inline code that names a chart;
 *  - NOTES.txt: the indented lines it prints as commands, and the commands
 *    it builds with printf;
 *  - shell scripts (troubleshoot.sh, the VM install script): every
 *    `helm upgrade` outside a comment, to the end of its command;
 *  - values.yaml: the example commands in its comments;
 *  - the dashboard and server code that prints upgrade commands: string
 *    lines that hold a command or a command's flag line. The Jest suites
 *    (AgentUpgradeGuides, KubernetesClusterAiAccessSettings, the docs
 *    suites) hold the rendered commands to the same rule.
 *
 * The dashboard's copy says which flag keeps the values, in 17 languages: a
 * translation names the flags its English names. And the upgrade for an
 * older Helm saves what `helm get values` prints, which is only the values
 * the release was given unless --all asks for every value, the old chart's
 * defaults included: the saved values never ask for all of them.
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const os = require("os");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHART_DIR = "HelmChart/Public/kubernetes-agent";
const CHART_README = `${CHART_DIR}/README.md`;
const CHART_NOTES = `${CHART_DIR}/templates/NOTES.txt`;
const CHART_VALUES = `${CHART_DIR}/values.yaml`;
const TROUBLESHOOT = `${CHART_DIR}/troubleshoot.sh`;
const INSTALL_SCRIPT = "HelmChart/Public/install.sh";
const DOCS_CONTENT = "packages/App/FeatureSet/Docs/Content";
const DASHBOARD_LOCALES = "packages/App/FeatureSet/Dashboard/src/Locales";
const CODE_SOURCES = [
  "packages/App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentUpgradeGuides.ts",
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown.ts",
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAccessSetup.ts",
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAiAgentSettings.ts",
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesMetricsSetup.ts",
  "packages/Common/Server/Services/KubernetesClusterAiAccessService.ts",
  "packages/Runner/Services/KubectlExecutor.ts",
  "packages/Runner/Services/RegisterRunner.ts",
];

// The flag itself, not --reset-then-reuse-values.
const REUSE_VALUES = /(^|[^\w-])--reuse-values(?![\w-])/;
const KEEP_VALUES = "--reset-then-reuse-values";
// The flags that say which values an upgrade starts from.
const VALUES_FLAGS = ["--reuse-values", KEEP_VALUES, "--reset-values"];
/*
 * A flag in prose. ASCII only (JavaScript's \w is), so a word a language
 * writes onto it (Korean `--reuse-values는`) is not part of it.
 */
const FLAG = /(?<![\w-])--[a-z][a-z0-9-]*/g;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function markdownFiles(relativeDir) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir), {
      withFileTypes: true,
    })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.name.endsWith(".md")) {
        found.push(child);
      }
    }
  };
  walk(relativeDir);
  return found.sort();
}

/**
 * Each `helm upgrade` in a command line, up to the end of its command: the
 * next `&&`, `;` or `|`. Its quoted arguments ("$release") stay in it, so a
 * message that prints a command keeps the rest of the line with it.
 * @param {string} line - one logical line, continuations already joined
 * @returns {Array<string>}
 */
function helmUpgradesIn(line) {
  const upgrades = [];
  const pattern = /helm\s+upgrade\b/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const rest = line.slice(match.index);
    const end = rest.search(/&&|;|\|/);
    upgrades.push(end < 0 ? rest : rest.slice(0, end));
  }
  return upgrades;
}

/**
 * Whether inline code is a command to run rather than a flag being talked
 * about: it names a chart, or `helm upgrade` is followed by a release (or a
 * placeholder for one) rather than straight by a flag. `helm upgrade
 * --reuse-values` and `helm upgrade --version <older> --reuse-values` are
 * the flag being talked about.
 * @param {string} code - the span's text, without its backticks
 * @returns {boolean}
 */
function isInlineCommand(code) {
  if (/oneuptime\/|HelmChart|<chart>/.test(code)) {
    return true;
  }
  return helmUpgradesIn(code).some((upgrade) => {
    const next = upgrade.replace(/^helm\s+upgrade\s*/, "").split(/\s+/)[0];
    return Boolean(next) && !next.startsWith("-");
  });
}

// Joins backslash-newline continuations, as the shell reads them.
function joinContinuations(text) {
  return text.replace(/\\\r?\n/g, " ");
}

/**
 * The code in a markdown file: every logical line of a fenced code block
 * (inside a blockquote too), and every inline code span, marked `inline`.
 * @returns {Array<{ where: string, command: string, inline: boolean }>}
 */
function markdownCode(relativePath) {
  const commands = [];
  const lines = read(relativePath).split("\n");
  let block = null;
  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/^\s*(?:>\s?)*/, "");
    if (line.trimStart().startsWith("```")) {
      if (block === null) {
        block = { start: index + 1, lines: [] };
      } else {
        for (const logical of joinContinuations(block.lines.join("\n")).split(
          "\n",
        )) {
          commands.push({
            where: `${relativePath}:${block.start} (code block)`,
            command: logical,
            inline: false,
          });
        }
        block = null;
      }
      return;
    }
    if (block !== null) {
      block.lines.push(line);
      return;
    }
    for (const span of rawLine.match(/`[^`]+`/g) || []) {
      commands.push({
        where: `${relativePath}:${index + 1} (inline)`,
        command: span.slice(1, -1),
        inline: true,
      });
    }
  });
  return commands;
}

/**
 * The commands in a markdown file: every logical line of a fenced code
 * block, and every inline code span that is a `helm upgrade` naming a
 * chart. An inline span without one (`helm upgrade --reuse-values`) is a
 * flag being talked about, not a command.
 * @returns {Array<{ where: string, command: string }>}
 */
function markdownCommands(relativePath) {
  return markdownCode(relativePath)
    .filter((entry) => {
      return (
        !entry.inline ||
        (/helm\s+upgrade/.test(entry.command) && isInlineCommand(entry.command))
      );
    })
    .map((entry) => {
      return { where: entry.where, command: entry.command };
    });
}

/**
 * The commands NOTES.txt prints: the indented lines that run helm (or one of
 * the commands it builds), and those builds — `printf "helm upgrade ..."`.
 */
function notesCommands() {
  const commands = [];
  read(CHART_NOTES)
    .split("\n")
    .forEach((line, index) => {
      if (/^\s+(helm|\{\{\s*\$helm\w*\s*\}\})\s/.test(line)) {
        commands.push({
          where: `${CHART_NOTES}:${index + 1}`,
          command: line.trim(),
        });
      }
      for (const built of line.match(/printf\s+"helm [^"]*"/g) || []) {
        commands.push({ where: `${CHART_NOTES}:${index + 1}`, command: built });
      }
    });
  return commands;
}

// A shell script's logical lines, comments left out.
function shellLines(relativePath) {
  const lines = [];
  joinContinuations(read(relativePath))
    .split("\n")
    .forEach((line, index) => {
      if (!line.trim().startsWith("#")) {
        lines.push({
          where: `${relativePath} (logical line ${index + 1})`,
          command: line,
        });
      }
    });
  return lines;
}

// Every `helm upgrade` a shell script runs or prints, comments left out.
function shellCommands(relativePath) {
  return shellLines(relativePath).flatMap((line) => {
    return helmUpgradesIn(line.command).map((upgrade) => {
      return { where: line.where, command: upgrade };
    });
  });
}

/*
 * The example commands in values.yaml's comments. Inline code that only
 * talks about a flag (`helm upgrade --reuse-values` does ...) is left out.
 */
function valuesCommentCommands() {
  const comments = read(CHART_VALUES)
    .split("\n")
    .filter((line) => {
      return line.trim().startsWith("#");
    })
    .map((line) => {
      return line
        .replace(/^\s*#\s?/, "")
        .replace(/`([^`]+)`/g, (span, code) => {
          return isInlineCommand(code) ? code : "";
        });
    })
    .join("\n");
  const commands = [];
  for (const line of joinContinuations(comments).split("\n")) {
    for (const upgrade of helmUpgradesIn(line)) {
      commands.push({ where: CHART_VALUES, command: upgrade });
    }
  }
  return commands;
}

// Code with its comments blanked out, line numbers kept.
function withoutCodeComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => {
      return comment.replace(/[^\n]/g, " ");
    })
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * The lines of code that print a command: outside comments, a line that
 * names `helm upgrade`, or is a command's flag line (it carries --namespace
 * or a line continuation, or is nothing but the flag in quotes).
 */
function codeCommandLines(relativePath) {
  const commands = [];
  withoutCodeComments(read(relativePath))
    .split("\n")
    .forEach((line, index) => {
      if (
        /helm\s+upgrade/.test(line) ||
        /--namespace/.test(line) ||
        /\\\\\s*["'`,]*\s*$/.test(line) ||
        /^\s*["'`]\s*--[\w-]+\s*["'`][,;]?\s*$/.test(line)
      ) {
        commands.push({ where: `${relativePath}:${index + 1}`, command: line });
      }
    });
  return commands;
}

function expectNoReuseValues(commands) {
  const offending = commands.filter((entry) => {
    return REUSE_VALUES.test(entry.command);
  });
  expect(offending).toEqual([]);
}

// The flags a text names, sorted, each as often as it names it.
function flagsIn(text) {
  return (text.match(FLAG) || []).sort();
}

/**
 * Each `helm get values` in a line that saves what it prints to a file
 * (`> file`, not the `>` of a `<release>` placeholder), up to the end of its
 * command: the values an upgrade then takes with -f. One piped into grep
 * only shows them.
 * @param {string} line - one logical line, continuations already joined
 * @returns {Array<string>}
 */
function savedValuesIn(line) {
  const saved = [];
  const pattern = /helm\s+get\s+values\b/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const rest = line.slice(match.index);
    const end = rest.search(/&&|;|\|/);
    const command = end < 0 ? rest : rest.slice(0, end);
    if (/(^|\s)>/.test(command)) {
      saved.push(command);
    }
  }
  return saved;
}

/*
 * Whether `helm get values` is asked for every value (--all, or -a alone or
 * with other short flags), the chart's defaults included.
 */
function asksForAllValues(command) {
  return command.split(/\s+/).some((word) => {
    return (
      word === "--all" ||
      word.startsWith("--all=") ||
      /^-[A-Za-z]*a[A-Za-z]*$/.test(word)
    );
  });
}

// Whether it prints YAML, which -f reads (the default is a table).
function printsYaml(command) {
  return /(^|\s)(-o|--output)(\s+|=)yaml(\s|$)/.test(command);
}

describe("recommended helm upgrades never use --reuse-values", () => {
  test("the chart README's commands", () => {
    const commands = markdownCommands(CHART_README);
    // Harness guard: the README's upgrades were read, with the flag that replaces it.
    expect(
      commands.filter((entry) => {
        return entry.command.includes(KEEP_VALUES);
      }).length,
    ).toBeGreaterThan(5);
    expectNoReuseValues(commands);
  });

  test("the README still says why not, and shows the upgrade for Helm before 3.14", () => {
    const readme = read(CHART_README);
    expect(readme).toContain("Don't upgrade with `--reuse-values`.");
    expect(readme).toMatch(
      /helm get values oneuptime-agent -n oneuptime-kubernetes-agent -o yaml > values\.yaml && \\\n {2}helm upgrade oneuptime-agent oneuptime\/kubernetes-agent \\\n {2}--namespace oneuptime-kubernetes-agent -f values\.yaml\n/,
    );
  });

  test("every docs page, in every language", () => {
    const files = markdownFiles(DOCS_CONTENT);
    const commands = files.flatMap(markdownCommands);
    const upgrades = commands.filter((entry) => {
      return /helm\s+upgrade/.test(entry.command);
    });
    // Harness guard: 17 languages of Kubernetes pages were read.
    expect(
      new Set(
        upgrades
          .filter((entry) => {
            return entry.command.includes(KEEP_VALUES);
          })
          .map((entry) => {
            return entry.where.split("/")[5];
          }),
      ).size,
    ).toBe(17);
    expectNoReuseValues(commands);
  });

  test("the chart's NOTES.txt", () => {
    const commands = notesCommands();
    expect(
      commands.filter((entry) => {
        return entry.command.includes(KEEP_VALUES);
      }).length,
    ).toBeGreaterThan(3);
    expectNoReuseValues(commands);
  });

  test("troubleshoot.sh and the VM install script", () => {
    for (const script of [TROUBLESHOOT, INSTALL_SCRIPT]) {
      const commands = shellCommands(script);
      expect({ script, found: commands.length > 0 }).toEqual({
        script,
        found: true,
      });
      expectNoReuseValues(commands);
    }
    expect(
      shellCommands(TROUBLESHOOT).every((entry) => {
        return entry.command.includes(KEEP_VALUES);
      }),
    ).toBe(true);
  });

  test("the example commands in values.yaml", () => {
    const commands = valuesCommentCommands();
    expect(commands.length).toBeGreaterThan(0);
    expectNoReuseValues(commands);
  });

  test("the dashboard's upgrade guide and every other command the product prints", () => {
    const commands = CODE_SOURCES.flatMap(codeCommandLines);
    expect(
      commands.filter((entry) => {
        return entry.command.includes(KEEP_VALUES);
      }).length,
    ).toBeGreaterThanOrEqual(4);
    expectNoReuseValues(commands);
    expect(
      read(
        "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown.ts",
      ),
    ).toContain(
      `KUBERNETES_AGENT_KEEP_VALUES_FLAG: string =\n  "${KEEP_VALUES}";`,
    );
  });
});

/*
 * The dashboard's copy names the flag that keeps the values ("Run this ...
 * --reset-then-reuse-values keeps the values you set") and the one not to
 * use, and the older-Helm tab says it saves the values to values.yaml, the
 * file its command passes back with -f. A translation that named
 * --reuse-values in place of the flag, or another file, would tell the
 * reader to run something else, and the dialog's commands would still be
 * right.
 */
describe("the dashboard's translations name the flags and the file its English names", () => {
  const english = JSON.parse(read(`${DASHBOARD_LOCALES}/en.json`));
  const keys = Object.keys(english).filter((key) => {
    return (
      key.includes("values.yaml") ||
      flagsIn(key).some((flag) => {
        return VALUES_FLAGS.includes(flag);
      })
    );
  });
  const locales = fs
    .readdirSync(path.join(REPO_ROOT, DASHBOARD_LOCALES))
    .filter((name) => {
      return name.endsWith(".json") && name !== "en.json";
    })
    .sort();

  test("the copy that names them was found, in every language", () => {
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(
      keys.some((key) => {
        return flagsIn(key).includes(KEEP_VALUES);
      }),
    ).toBe(true);
    // The older-Helm tab's step, which saves the values to values.yaml.
    expect(
      keys.some((key) => {
        return key.includes("saves the values you set to values.yaml");
      }),
    ).toBe(true);
    expect(locales).toHaveLength(16);
  });

  test.each(locales)("%s", (locale) => {
    const translations = JSON.parse(read(`${DASHBOARD_LOCALES}/${locale}`));
    const offending = keys
      .filter((key) => {
        const translation = translations[key];
        return (
          typeof translation !== "string" ||
          flagsIn(translation).join(" ") !== flagsIn(key).join(" ") ||
          translation.split("values.yaml").length !==
            key.split("values.yaml").length
        );
      })
      .map((key) => {
        return { key, translation: translations[key] };
      });
    expect(offending).toEqual([]);
  });
});

/*
 * The upgrade for Helm before 3.14 saves `helm get values` and passes it back
 * with -f. Without --all that is only the values the release was given
 * (pkg/action/get_values.go returns rel.Config); with it, every value,
 * the old chart's defaults included, which -f would then pin the way
 * --reuse-values does. And it has to be YAML: the default output is a table
 * -f cannot read.
 */
describe("an upgrade from saved values saves only the values set, as YAML", () => {
  const saved = [
    ...[CHART_README, ...markdownFiles(DOCS_CONTENT)].flatMap((file) => {
      return markdownCode(file);
    }),
    ...notesCommands(),
    ...[TROUBLESHOOT, INSTALL_SCRIPT].flatMap((script) => {
      return shellLines(script);
    }),
    ...CODE_SOURCES.flatMap((file) => {
      return withoutCodeComments(read(file))
        .split("\n")
        .map((line, index) => {
          return { where: `${file}:${index + 1}`, command: line };
        });
    }),
  ].flatMap((entry) => {
    return savedValuesIn(entry.command).map((command) => {
      return { where: entry.where, command };
    });
  });

  test("every place that shows the upgrade was read", () => {
    const files = new Set(
      saved.map((entry) => {
        return entry.where.replace(/:.*$| \(.*$/, "");
      }),
    );
    for (const file of [
      CHART_README,
      CHART_NOTES,
      INSTALL_SCRIPT,
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown.ts",
    ]) {
      expect({ file, read: files.has(file) }).toEqual({ file, read: true });
    }
    // Both Kubernetes agent pages, in each of the 17 languages.
    const docs = [...files].filter((file) => {
      return file.startsWith(DOCS_CONTENT);
    });
    const languages = new Set(
      docs.map((file) => {
        return file.split("/")[5];
      }),
    );
    expect(languages.size).toBe(17);
    expect(docs.sort()).toEqual(
      [...languages].sort().flatMap((language) => {
        return [
          `${DOCS_CONTENT}/${language}/monitor/kubernetes-agent.md`,
          `${DOCS_CONTENT}/${language}/telemetry/kubernetes-agent.md`,
        ];
      }),
    );
  });

  test("none asks for every value, and each prints YAML", () => {
    expect(
      saved.filter((entry) => {
        return asksForAllValues(entry.command) || !printsYaml(entry.command);
      }),
    ).toEqual([]);
  });
});

// The readers above, on inputs whose answer is known.
describe("the command readers", () => {
  test("read the flags prose names, and the values a command saves", () => {
    expect(
      flagsIn(
        "--reuse-values는 사용하지 마세요. --reset-then-reuse-values (Helm 3.14)",
      ),
    ).toEqual(["--reset-then-reuse-values", "--reuse-values"]);
    expect(flagsIn("curl --cert / --key처럼")).toEqual(["--cert", "--key"]);
    expect(flagsIn("var(--ou-link) a--b")).toEqual(["--ou-link"]);

    expect(
      savedValuesIn(
        "helm get values r -n ns -o yaml > v.yaml && helm upgrade r c -f v.yaml",
      ),
    ).toEqual(["helm get values r -n ns -o yaml > v.yaml "]);
    expect(
      savedValuesIn("helm get values <release> -n ns -a | grep -A2 x"),
    ).toEqual([]);
    expect(
      savedValuesIn('sudo helm get values "$release" -o yaml > "$values" &&'),
    ).toEqual(['helm get values "$release" -o yaml > "$values" ']);
    expect(
      savedValuesIn('printf "helm get values %s -n %s -o yaml > values.yaml"'),
    ).toEqual(['helm get values %s -n %s -o yaml > values.yaml"']);

    for (const command of [
      "helm get values r --all -o yaml > v.yaml",
      "helm get values r -a -o yaml > v.yaml",
      "helm get values r -ao yaml > v.yaml",
      "helm get values r --all=true -o yaml > v.yaml",
    ]) {
      expect({ command, all: asksForAllValues(command) }).toEqual({
        command,
        all: true,
      });
    }
    expect(
      asksForAllValues(
        "helm get values oneuptime-agent --namespace oneuptime-agent -o yaml > values.yaml",
      ),
    ).toBe(false);
    expect(printsYaml("helm get values r -o yaml > v.yaml")).toBe(true);
    expect(printsYaml("helm get values r --output=yaml > v.yaml")).toBe(true);
    expect(printsYaml("helm get values r > values.yaml")).toBe(false);
    expect(printsYaml("helm get values r -o json > values.yaml")).toBe(false);
  });

  test("find --reuse-values in a command, but not in talk about it", () => {
    expect(
      helmUpgradesIn(
        "Re-run: helm upgrade <release> oneuptime/kubernetes-agent -n $NS --reuse-values --set cost.enabled=true",
      ),
    ).toEqual([
      "helm upgrade <release> oneuptime/kubernetes-agent -n $NS --reuse-values --set cost.enabled=true",
    ]);
    expect(
      REUSE_VALUES.test("helm upgrade r c --reset-then-reuse-values"),
    ).toBe(false);
    expect(REUSE_VALUES.test("helm upgrade r c --reuse-values")).toBe(true);
    expect(
      helmUpgradesIn(
        "helm get values r -o yaml > v.yaml && helm upgrade r c -f v.yaml",
      ),
    ).toEqual(["helm upgrade r c -f v.yaml"]);
    expect(
      helmUpgradesIn(
        'sudo helm upgrade "$release" "$chart" --reuse-values "$@"',
      ),
    ).toEqual(['helm upgrade "$release" "$chart" --reuse-values "$@"']);
    expect(isInlineCommand("helm upgrade --reuse-values")).toBe(false);
    expect(
      isInlineCommand("helm upgrade --version <older> --reuse-values"),
    ).toBe(false);
    expect(
      isInlineCommand("helm repo update && helm upgrade ... --reuse-values"),
    ).toBe(true);
    expect(
      isInlineCommand(
        "helm upgrade a oneuptime/kubernetes-agent --reuse-values",
      ),
    ).toBe(true);
  });

  test("read a code block's continued command, and an inline command, from markdown", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helm-upgrade-guard-"));
    const relative = path.relative(REPO_ROOT, path.join(dir, "page.md"));
    fs.writeFileSync(
      path.join(dir, "page.md"),
      [
        "Don't upgrade with `--reuse-values`, or `helm upgrade --reuse-values`.",
        "",
        "> ```bash",
        "> helm upgrade a oneuptime/kubernetes-agent \\",
        ">   --reuse-values",
        "> ```",
        "",
        "Use `helm upgrade a oneuptime/kubernetes-agent --reuse-values -f x.yaml`.",
      ].join("\n"),
    );
    try {
      const commands = markdownCommands(relative);
      expect(
        commands
          .filter((entry) => {
            return REUSE_VALUES.test(entry.command);
          })
          .map((entry) => {
            return entry.where.replace(/^.*:/, "");
          }),
      ).toEqual(["3 (code block)", "8 (inline)"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("read a command split across string lines from code", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helm-upgrade-guard-"));
    const relative = path.relative(REPO_ROOT, path.join(dir, "Code.ts"));
    fs.writeFileSync(
      path.join(dir, "Code.ts"),
      [
        "// helm upgrade --reuse-values, in a comment",
        'const NOTE: string = "Not --reuse-values: it keeps the old chart\'s defaults.";',
        "const A: Array<string> = [",
        '  "  --reuse-values",',
        '  "  --namespace ns --reuse-values \\\\",',
        "];",
      ].join("\n"),
    );
    try {
      expect(
        codeCommandLines(relative)
          .filter((entry) => {
            return REUSE_VALUES.test(entry.command);
          })
          .map((entry) => {
            return entry.where.replace(/^.*:/, "");
          }),
      ).toEqual(["4", "5"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/*
 * The VM install script upgrades the OneUptime chart itself. Its helper is
 * run here against a stub helm: --reset-then-reuse-values when helm has it,
 * otherwise the release's own values into -f, and never an upgrade after a
 * failed `helm get values`.
 */
describe("install.sh upgrades keep the values set and take the new chart's defaults", () => {
  const helper = (() => {
    const script = read(INSTALL_SCRIPT);
    const start = script.indexOf("function upgradeKeepingValues {");
    const end = script.indexOf("\n}\n", start);
    return script.slice(start, end + 3);
  })();

  function runHelper({ helmHasResetThenReuse, getValuesFails }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-sh-helm-"));
    const log = path.join(dir, "calls.log");
    const helm = path.join(dir, "helm");
    fs.writeFileSync(
      helm,
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> "${log}"`,
        'if [ "$1" = "upgrade" ] && [ "$2" = "--help" ]; then',
        helmHasResetThenReuse
          ? '  echo "      --reset-then-reuse-values   when upgrading, reset the values to the ones built into the chart, apply the last release\'s values"'
          : "  :",
        '  echo "      --reuse-values               when upgrading, reuse the last release\'s values"',
        "  exit 0",
        "fi",
        'if [ "$1" = "get" ]; then',
        getValuesFails ? "  exit 1" : '  echo "clusterName: prod"',
        "  exit 0",
        "fi",
        'if [ "$1" = "upgrade" ]; then',
        '  for arg in "$@"; do',
        '    if [ "$prev" = "-f" ]; then echo "values: $(cat "$arg")" >> "' +
          log +
          '"; fi',
        '    prev="$arg"',
        "  done",
        "fi",
      ].join("\n"),
    );
    fs.chmodSync(helm, 0o755);
    /*
     * helm is a function that runs the stub, and the real helm is not on
     * PATH either: nothing here may reach a cluster.
     */
    const result = childProcess.spawnSync(
      "bash",
      [
        "-c",
        `sudo() { "$@"; }\nhelm() { "${helm}" "$@"; }\n${helper}\nupgradeKeepingValues fi oneuptime/OneUptime --set image.tag=9.9.9`,
      ],
      {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: dir,
          KUBECONFIG: "/dev/null",
          TMPDIR: dir,
        },
        encoding: "utf8",
      },
    );
    const calls = fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n")
      : [];
    fs.rmSync(dir, { recursive: true, force: true });
    return { status: result.status, calls };
  }

  test("the helper is found in the script", () => {
    expect(helper.startsWith("function upgradeKeepingValues {")).toBe(true);
    expect(helper.trimEnd().endsWith("}")).toBe(true);
  });

  test("Helm 3.14 or later: --reset-then-reuse-values, with the extra flags", () => {
    const { status, calls } = runHelper({
      helmHasResetThenReuse: true,
      getValuesFails: false,
    });
    expect(status).toBe(0);
    expect(calls).toEqual([
      "upgrade --help",
      "upgrade fi oneuptime/OneUptime --reset-then-reuse-values --set image.tag=9.9.9",
    ]);
  });

  test("older Helm: the release's own values (never --all) into -f", () => {
    const { status, calls } = runHelper({
      helmHasResetThenReuse: false,
      getValuesFails: false,
    });
    expect(status).toBe(0);
    expect(calls[0]).toBe("upgrade --help");
    expect(calls[1]).toBe("get values fi -o yaml");
    expect(calls[2]).toMatch(
      /^upgrade fi oneuptime\/OneUptime -f \S+ --set image\.tag=9\.9\.9$/,
    );
    expect(calls[3]).toBe("values: clusterName: prod");
    expect(calls).toHaveLength(4);
  });

  test("older Helm: no upgrade when the values could not be read", () => {
    const { status, calls } = runHelper({
      helmHasResetThenReuse: false,
      getValuesFails: true,
    });
    expect(status).not.toBe(0);
    expect(calls).toEqual(["upgrade --help", "get values fi -o yaml"]);
  });
});
