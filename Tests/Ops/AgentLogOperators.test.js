"use strict";

/**
 * LOG OPERATORS OF YOUR OWN, IN THE CONTAINER AGENTS (issue #11225).
 *
 * The Kubernetes agent takes them as `logs.extraOperators` (its chart's
 * helm-unittest suite, tests/extra-log-operators_test.yaml). The Docker,
 * Podman and Docker Swarm agents are the collector image with its config
 * baked in or mounted, and their collector expands an environment variable
 * that is a whole list item into one operator, so they take five:
 * ONEUPTIME_LOG_OPERATOR_1 to ONEUPTIME_LOG_OPERATOR_5, each one stanza
 * operator as JSON. This suite holds:
 *
 *   - each config's five slots: in order, after the line is put back
 *     together and its stream read, before the severity router; each, left
 *     unset, a noop;
 *   - each Compose file: the five named without a value, so an unset one is
 *     not passed (an empty one stops the collector), and a config check, the
 *     collector's own validate over the same config and settings, which the
 *     agent waits on, so a bad operator stops `docker compose up` rather than
 *     leaving a collector that restarts forever.
 *
 * The installers' own check is ContainerAgentInstallers.test.js's, and what
 * the operators do to real lines is agent-log-severity-behaviour.sh's.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const {
  AGENTS,
  REPO_ROOT,
  readAgentOperators,
} = require("./Utils/AgentLogSeverityConfigs.js");

const SLOTS = [1, 2, 3, 4, 5].map((n) => {
  return `\${env:ONEUPTIME_LOG_OPERATOR_${n}:-type: noop}`;
});

const COMPOSE = {
  DockerAgent: {
    collector: "oneuptime-docker-agent",
    check: "oneuptime-docker-agent-config-check",
    aiAgent: "oneuptime-docker-ai-agent",
  },
  PodmanAgent: {
    collector: "oneuptime-podman-agent",
    check: "oneuptime-podman-agent-config-check",
    aiAgent: "oneuptime-podman-ai-agent",
  },
  DockerSwarmAgent: {
    collector: "oneuptime-docker-swarm-agent",
    check: "oneuptime-docker-swarm-agent-config-check",
    aiAgent: "oneuptime-docker-swarm-ai-agent",
  },
};

function readCompose(agent) {
  return yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, "agents", agent, "docker-compose.yml"),
      "utf8",
    ),
  );
}

describe.each(AGENTS)("%s's log operators of your own", (agent) => {
  const operators = readAgentOperators(agent);
  const at = (matches) => {
    return operators.findIndex(matches);
  };

  test("five slots, in order, after the line is put back together and before its level is read", () => {
    const first = operators.indexOf(SLOTS[0]);

    expect(first).toBeGreaterThan(-1);
    expect(operators.slice(first, first + 5)).toEqual(SLOTS);
    expect(first).toBeGreaterThan(
      at((operator) => {
        return operator.id === "recombine-multiline";
      }),
    );
    expect(first).toBeGreaterThan(
      at((operator) => {
        return (
          operator.type === "move" &&
          operator.to === 'attributes["log.iostream"]'
        );
      }),
    );
    expect(first + 5).toBe(
      at((operator) => {
        return operator.id === "severity-router";
      }),
    );
  });

  test("a slot left unset is a noop, and nothing else in the config names one", () => {
    for (const slot of SLOTS) {
      const fallback = /^\$\{env:ONEUPTIME_LOG_OPERATOR_\d:-(.*)\}$/.exec(
        slot,
      )[1];

      expect(yaml.load(fallback)).toEqual({ type: "noop" });
    }

    const text = fs.readFileSync(
      path.join(REPO_ROOT, "agents", agent, "otel-collector-config.yaml"),
      "utf8",
    );

    expect(text.match(/"\$\{env:ONEUPTIME_LOG_OPERATOR_\d/g)).toHaveLength(5);
  });

  test("a slot is quoted: unquoted, YAML would read its fallback's colon as a map", () => {
    const text = fs.readFileSync(
      path.join(REPO_ROOT, "agents", agent, "otel-collector-config.yaml"),
      "utf8",
    );

    for (const slot of SLOTS) {
      expect(text).toContain(`- "${slot}"`);
    }
  });

  describe("its Compose file", () => {
    const compose = readCompose(agent);
    const { collector, check, aiAgent } = COMPOSE[agent];
    const service = (name) => {
      return compose.services[name];
    };

    test("passes the five to the collector named without a value, so an unset one is not passed", () => {
      for (const n of [1, 2, 3, 4, 5]) {
        expect(service(collector).environment).toContain(
          `ONEUPTIME_LOG_OPERATOR_${n}`,
        );
      }

      expect(
        service(collector).environment.filter((entry) => {
          return /^ONEUPTIME_LOG_OPERATOR_\d=/.test(entry);
        }),
      ).toEqual([]);
    });

    test("checks the config with the collector's own validate before the agent starts", () => {
      expect(service(check).command).toEqual([
        "validate",
        "--config=/etc/otelcol-contrib/config.yaml",
      ]);
      expect(service(check).image).toBe(service(collector).image);
      // The same settings the agent gets, its operators among them.
      expect(service(check).environment).toEqual(
        service(collector).environment,
      );
      expect(service(check).restart).toBe("no");
      expect(service(collector).depends_on).toEqual({
        [check]: { condition: "service_completed_successfully" },
      });
    });

    test("checks the config the agent runs", () => {
      const configMount = (name) => {
        return (service(name).volumes || []).filter((volume) => {
          return volume.endsWith(":/etc/otelcol-contrib/config.yaml:ro");
        });
      };

      // The Swarm agent mounts its config; the other two bake it in.
      expect(configMount(check)).toEqual(configMount(collector));
    });

    test("gives the AI agent none of them", () => {
      expect(
        (service(aiAgent).environment || []).filter((entry) => {
          return entry.startsWith("ONEUPTIME_LOG_OPERATOR_");
        }),
      ).toEqual([]);
    });
  });
});

/*
 * The Kubernetes agent's logs.extraOperators: what its chart's check
 * (kubernetes-agent.validateExtraLogOperators, run by
 * templates/extra-log-operators-check.yaml) knows of the agent's own config,
 * held to that config, and the example its values.yaml gives, held to the one
 * its suites render and validate.
 */
describe("the Kubernetes agent's logs.extraOperators", () => {
  const CHART = path.join(REPO_ROOT, "HelmChart", "Public", "kubernetes-agent");
  const read = (file) => {
    return fs.readFileSync(path.join(CHART, file), "utf8");
  };
  const helpers = read("templates/_helpers.tpl");
  const configMap = read("templates/configmap-daemonset.yaml");
  const schema = JSON.parse(read("values.schema.json"));
  const {
    DOCUMENTED_EXAMPLE,
    NEWER_THAN_0_96_0,
  } = require("./Utils/ExtraLogOperatorExamples.js");

  // The quoted names of a helper that is one `list "a" "b" ... | toJson`,
  // found by its define line as text, the line after it, and its end.
  function helperList(name) {
    const lines = helpers.split("\n");
    const start = lines.indexOf(`{{- define "${name}" -}}`);
    const list = /^\{\{- list ((?:"[^"]+" ?)+)\| toJson -\}\}$/.exec(
      lines[start + 1] || "",
    );

    if (start === -1 || !list || lines[start + 2] !== "{{- end -}}") {
      throw new Error(`_helpers.tpl: no ${name} that is one list`);
    }

    return [...list[1].matchAll(/"([^"]+)"/g)].map((match) => {
      return match[1];
    });
  }

  // The pod log receiver's lines, from `{{ $fileLog }}:` to the processors.
  function podLogReceiver() {
    const lines = configMap.split("\n");
    const start = lines.indexOf("      {{ $fileLog }}:");
    const end = lines.indexOf("    processors:", start);

    if (start === -1 || end === -1) {
      throw new Error("configmap-daemonset.yaml: no pod log receiver found");
    }

    return lines.slice(start, end);
  }

  // Its operators, each by the line of its type and the id on the next line.
  function receiverOperators() {
    const lines = podLogReceiver();

    return lines
      .map((line, index) => {
        const type = /^\s*- type: ([a-z_]+)\s*$/.exec(line);
        const id = /^\s*id: ([a-z0-9-]+)\s*$/.exec(lines[index + 1] || "");

        return type ? { type: type[1], id: id ? id[1] : null } : null;
      })
      .filter(Boolean);
  }

  test("the check keeps every id the agent's pod log receiver has, and none it has not", () => {
    const ids = receiverOperators()
      .map((operator) => {
        return operator.id;
      })
      .filter(Boolean);

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      [...helperList("kubernetes-agent.agentLogOperatorIds")].sort(),
    ).toEqual([...ids].sort());
  });

  test("the check knows the types of the agent's operators that have no id, whose bare names the collector gives them", () => {
    const unnamed = receiverOperators()
      .filter((operator) => {
        return operator.id === null;
      })
      .map((operator) => {
        return operator.type;
      });

    expect(unnamed.length).toBeGreaterThan(0);
    expect(helperList("kubernetes-agent.agentUnnamedLogOperatorTypes")).toEqual(
      [...new Set(unnamed)],
    );
  });

  test("the check takes the types the schema does", () => {
    const entry = schema.properties.logs.properties.extraOperators;

    expect(entry.type).toBe("array");
    expect(entry.items.required).toEqual(["type"]);
    expect(entry.items.properties.type.enum).toEqual(
      helperList("kubernetes-agent.extraLogOperatorTypes"),
    );
    // logs takes no key it does not list, so the setting is listed.
    expect(schema.properties.logs.additionalProperties).toBe(false);
  });

  test("the types newer than collector 0.96.0 are those the check refuses on it", () => {
    const since = /\{\{- \$since := dict ((?:"[^"]+" "[^"]+" ?)+)-\}\}/.exec(
      helpers,
    );
    const pairs = [...since[1].matchAll(/"([^"]+)" "([^"]+)"/g)].map(
      (match) => {
        return [match[1], match[2]];
      },
    );
    const types = helperList("kubernetes-agent.extraLogOperatorTypes");

    for (const [type, version] of pairs) {
      expect({ type, known: types.includes(type) }).toEqual({
        type,
        known: true,
      });
      expect(version).toMatch(/^0\.\d+\.0$/);
    }
    expect(
      pairs
        .filter(([, version]) => {
          return Number(version.split(".")[1]) > 96;
        })
        .map(([type]) => {
          return type;
        })
        .sort(),
    ).toEqual([...NEWER_THAN_0_96_0].sort());
  });

  test("the operators render right after the agent moves the pod's uid, before its severity router", () => {
    const lines = podLogReceiver();
    const uid = lines.indexOf('            to: resource["k8s.pod.uid"]');
    const block = lines.indexOf(
      "          {{- with (.Values.logs).extraOperators }}",
    );
    const router = lines.findIndex((line, index) => {
      return (
        line === "          - type: router" &&
        lines[index + 1] === "            id: severity-router"
      );
    });

    expect(uid).toBeGreaterThan(-1);
    expect(block).toBe(uid + 1);
    expect(
      lines.slice(block + 1, router).filter((line) => {
        return !/^\s*#/.test(line);
      }),
    ).toEqual([
      "          {{- toYaml . | nindent 10 }}",
      "          {{- end }}",
    ]);
  });

  test("the check runs in a template of its own, which nothing else includes", () => {
    const including = fs
      .readdirSync(path.join(CHART, "templates"))
      .filter((file) => {
        return read(`templates/${file}`).includes(
          'include "kubernetes-agent.validateExtraLogOperators"',
        );
      });

    expect(including).toEqual(["extra-log-operators-check.yaml"]);
    expect(
      read("templates/extra-log-operators-check.yaml").replace(
        /^\{\{- \/\*[\s\S]*?\*\/ -\}\}\n/,
        "",
      ),
    ).toBe('{{- include "kubernetes-agent.validateExtraLogOperators" . -}}\n');
  });

  test("values.yaml gives the example the suites render and the collector validates", () => {
    const lines = read("values.yaml").split("\n");
    const start = lines.indexOf("  # extraOperators:");
    const end = lines.indexOf("  extraOperators: []");

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const example = yaml.load(
      lines
        .slice(start, end)
        .map((line) => {
          return line.replace(/^ {2}# ?/, "");
        })
        .join("\n"),
    );

    expect(example.extraOperators).toEqual(DOCUMENTED_EXAMPLE);
  });

  test("the chart's suite renders that example", () => {
    const suite = yaml.load(read("tests/extra-log-operators_test.yaml"));
    const rendered = suite.tests.find((test) => {
      return test.it.startsWith("runs the documented example");
    });

    expect(rendered.set["logs.extraOperators"]).toEqual(DOCUMENTED_EXAMPLE);
  });

  test("the chart's suite reads every refusal of the check's at its template, by its whole message, as helm-unittest 0.5.1 has no errorPattern", () => {
    const suite = yaml.load(read("tests/extra-log-operators_test.yaml"));
    const refusals = suite.tests.flatMap((test) => {
      return test.asserts.filter((assert) => {
        return "failedTemplate" in assert;
      });
    });

    expect(refusals.length).toBeGreaterThan(50);
    for (const assert of refusals) {
      expect(assert.template).toBe("templates/extra-log-operators-check.yaml");
      expect(Object.keys(assert.failedTemplate || {})).not.toContain(
        "errorPattern",
      );
    }
  });
});

/*
 * The documented example on each chain, in the JavaScript model of it
 * (Utils/StanzaSeverity.js): the in-house lines the behaviour runs use
 * (EXTRA_OPERATOR_CASES) are read by no reader of the agent's own, so a run
 * that leaves them at their levels got those from the example; and the
 * example's operators, run as the collector runs them, write the level that
 * the chain's first route then reads, at the level each case names.
 */
describe("the documented logs.extraOperators example on each chain", () => {
  const {
    classify,
    compileRe2AsJs,
    extractMatchesPattern,
  } = require("./Utils/StanzaSeverity.js");
  const { readChainConfigs } = require("./Utils/AgentLogSeverityConfigs.js");
  const {
    DOCUMENTED_EXAMPLE,
    EXTRA_OPERATOR_CASES,
  } = require("./Utils/ExtraLogOperatorExamples.js");
  const chains = [...readChainConfigs()];

  const matches = (expression, body) => {
    return compileRe2AsJs(extractMatchesPattern(expression)).test(body);
  };

  // The example's operators as the collector runs them, from the first: an
  // `if` that does not match passes the line on, a regex_parser writes its
  // groups to attributes, a router hands on to its first matching route, an
  // add writes its value, and each goes to its output or the next operator,
  // up to the agent's severity-router. What reaches it is the attributes.
  function runExample(body) {
    const attributes = {};
    let index = 0;

    while (index < DOCUMENTED_EXAMPLE.length) {
      const operator = DOCUMENTED_EXAMPLE[index];
      let next = operator.output;

      if (operator.if && !matches(operator.if, body)) {
        next = undefined;
      } else if (operator.type === "regex_parser") {
        const match = compileRe2AsJs(operator.regex).exec(body);

        Object.assign(attributes, match ? match.groups : {});
      } else if (operator.type === "router") {
        const route = operator.routes.find((candidate) => {
          return matches(candidate.expr, body);
        });

        next = route ? route.output : operator.default;
      } else if (operator.type === "add") {
        attributes[operator.field.replace(/^attributes\./, "")] =
          operator.value;
      } else {
        throw new Error(
          `the example has a ${operator.type}, which this runs not`,
        );
      }

      if (next === "severity-router") {
        return attributes;
      }

      index =
        next === undefined
          ? index + 1
          : DOCUMENTED_EXAMPLE.findIndex((candidate) => {
              return candidate.id === next;
            });
    }

    return attributes;
  }

  describe.each(chains)("%s", (_source, operators) => {
    test.each(
      EXTRA_OPERATOR_CASES.map((entry) => {
        return [entry.name, entry];
      }),
    )(
      "without the example, %s is read by no reader of the agent's own",
      (_name, entry) => {
        const { reader } = classify(operators, entry.body, entry.stream);

        expect(reader).toBe(
          entry.stream === "stdout"
            ? "add-fallback-severity"
            : "severity-unspecified",
        );
      },
    );

    test.each(
      EXTRA_OPERATOR_CASES.map((entry) => {
        return [entry.name, entry];
      }),
    )("with it, %s leaves at the level the example names", (_name, entry) => {
      const attributes = runExample(entry.body);
      const result = classify(operators, entry.body, entry.stream, attributes);

      expect({ case: entry.name, severity: result.severity }).toEqual({
        case: entry.name,
        severity: entry.severity,
      });
      if (entry.severity !== "Unspecified") {
        expect(result.reader).toBe("severity-parser");
      }
    });
  });

  test("the cases name every level the example writes, on both streams", () => {
    const levels = new Set(
      EXTRA_OPERATOR_CASES.map((entry) => {
        return entry.severity;
      }),
    );

    expect([...levels].sort()).toEqual(
      [
        "Debug",
        "Error",
        "Fatal",
        "Information",
        "Unspecified",
        "Warning",
      ].sort(),
    );
    expect(
      new Set(
        EXTRA_OPERATOR_CASES.map((entry) => {
          return entry.stream;
        }),
      ),
    ).toEqual(new Set(["stdout", "stderr"]));
  });
});
