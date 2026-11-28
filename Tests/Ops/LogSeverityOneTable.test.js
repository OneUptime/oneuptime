"use strict";

/**
 * ONE TABLE OF LEVEL WORDS, WHEREVER ONEUPTIME TURNS ONE INTO A SEVERITY
 * (issue #11228).
 *
 * The same level word used to be stored at two different severities
 * depending on how the line arrived. The agents' severity chain put
 * `critical` in Error and `alert` and `panic` in Fatal; OneUptime's ingest
 * put `critical` in Fatal and `alert` and `panic` in Error. So a Python
 * CRITICAL line was an Error through the Docker agent and a Fatal through
 * Fluent Bit, and a PSR-3 ALERT the other way round. The copies had been
 * decided separately, with different reasons, and nothing compared them.
 *
 * The table is LOG_SEVERITY_NUMBER_BY_TEXT
 * (packages/Common/Types/Log/LogSeverity.ts), which says why each word is
 * where it is. This suite holds every copy to it, number for number:
 *
 *   - the severity_parser of the agents' chain, in DockerAgent, PodmanAgent,
 *     DockerSwarmAgent and the Kubernetes agent's DaemonSet: every alias of
 *     its mapping block and every text its readers lift;
 *   - the Kubernetes agent's API-mode tailer (severityTextToNumber in
 *     agents/KubernetesLogTailer/OTLPBatcher.ts);
 *   - syslog's eight severities by number, through their keywords (emerg,
 *     alert, crit, err, warning, notice, info, debug: RFC 5424's, the ones
 *     the collector's syslog parser and journald keep as the text):
 *     OneUptime's syslog ingest (SyslogSeverity.ts) and the host collector's
 *     journald priority (HostCollectorDefaultConfig.ts);
 *   - CloudWatch Logs' read of a line's first word and of RDS's databases
 *     (CloudWatchLogSeverity.ts).
 *
 * The table is read from Common itself, so a copy cannot be held to a copy.
 *
 * WHAT IS NOT HERE, ON PURPOSE. A vendor's own vocabulary, where the vendor
 * says what a word means, is read as the vendor says: Datadog's statuses are
 * syslog's, so its `critical` is syslog's Critical (DatadogIntake), and
 * Google Cloud Logging's LogSeverity enum is read as Google's exporter writes
 * it (GcpPubSub/CloudLoggingEntries). Neither is a word a sender chose.
 *
 * READER TOKENS. Some texts the agents' readers lift are no word a sender
 * writes in a level field, only a mark in one format's own position: klog's
 * letter, pino's number, PostgreSQL's LOG (read in capitals only; as a level
 * field's value "log" is console.log's word, which the table leaves unread).
 * They are listed below with the number each one names, and nothing else may
 * be mapped that the table does not know.
 */

const fs = require("fs");
const path = require("path");

const {
  KUBERNETES_SOURCE,
  REPO_ROOT,
  loadCommonModule,
  readChainConfigs,
  readTailerSeverityNumbers,
} = require("./Utils/AgentLogSeverityConfigs.js");
const {
  LOG_SEVERITY_NUMBER_BY_TEXT,
  READER_TOKENS,
  logSeverityFromNumber,
  namedNumber,
} = require("./Utils/LogSeverityTable.js");
const {
  SEVERITY_NUMBER,
  indexOperatorsById,
  resolveSeverityNumber,
  severityKeywordsFromRegex,
} = require("./Utils/StanzaSeverity.js");

const { SYSLOG_TO_OTEL_SEVERITY, mapSyslogSeverity } = loadCommonModule(
  "Utils/Syslog/SyslogSeverity.ts",
);
const { inferCloudWatchLogSeverity } = loadCommonModule(
  "Types/Cloud/CloudWatchLogSeverity.ts",
);

const CONFIGS = readChainConfigs();

/** The chain's severity parser's mapping block, as [alias, number] pairs. */
function mappingAliases(severityParser) {
  return Object.entries(severityParser.mapping || {}).flatMap(
    ([level, aliases]) => {
      const number = SEVERITY_NUMBER[String(level).toLowerCase()];

      if (number === undefined) {
        throw new Error(`the mapping targets an unknown level "${level}"`);
      }

      return (Array.isArray(aliases) ? aliases : [aliases]).map((alias) => {
        return [String(alias), number];
      });
    },
  );
}

/**
 * Every text the chain can hand its severity parser, by the operator that
 * produces it: the texts each regex reader's severity_text group can
 * capture, and the level each `add` writes.
 */
function chainTexts(operators) {
  const byId = indexOperatorsById(operators);
  const router = byId.get("severity-router");
  const texts = [];

  for (const route of router.routes) {
    const operator = byId.get(route.output);

    if (operator.type === "regex_parser") {
      for (const text of severityKeywordsFromRegex(operator.regex)) {
        texts.push({ reader: operator.id, text });
      }
    } else if (operator.type === "add") {
      texts.push({ reader: operator.id, text: String(operator.value) });
    }
  }

  return texts;
}

describe.each([...CONFIGS.keys()])(
  "%s reads every level word as the one table does",
  (source) => {
    const operators = CONFIGS.get(source);
    const severityParser = indexOperatorsById(operators).get("severity-parser");

    test("every alias of its mapping block is stored at the table's number", () => {
      const aliases = mappingAliases(severityParser);

      expect(aliases.length).toBeGreaterThan(30);
      expect(
        aliases.filter(([alias, number]) => {
          return namedNumber(alias) !== number;
        }),
      ).toEqual([]);
    });

    test("every text its readers lift is stored at the table's number", () => {
      const texts = chainTexts(operators);

      expect(texts.length).toBeGreaterThan(40);
      expect(
        texts
          .map(({ reader, text }) => {
            return {
              reader,
              text,
              chain: resolveSeverityNumber(text, severityParser),
              table: namedNumber(text),
            };
          })
          .filter((entry) => {
            return entry.chain !== entry.table;
          }),
      ).toEqual([]);
    });

    test("it maps nothing the table does not know but its readers' own tokens", () => {
      const lifted = new Set(
        chainTexts(operators).map(({ text }) => {
          return text.toUpperCase();
        }),
      );

      expect(
        mappingAliases(severityParser)
          .map(([alias]) => {
            return alias.toUpperCase();
          })
          .filter((alias) => {
            return (
              !LOG_SEVERITY_NUMBER_BY_TEXT.has(alias) &&
              !(READER_TOKENS.has(alias) && lifted.has(alias))
            );
          }),
      ).toEqual([]);
    });
  },
);

describe("the reader tokens", () => {
  test("are no word of the table, and each is lifted by the reader it names", () => {
    const lifted = chainTexts(CONFIGS.get(KUBERNETES_SOURCE));

    for (const [token, { number, reader }] of READER_TOKENS) {
      expect([token, LOG_SEVERITY_NUMBER_BY_TEXT.has(token)]).toEqual([
        token,
        false,
      ]);
      expect([token, Number.isInteger(number) && number >= 1]).toEqual([
        token,
        true,
      ]);
      expect(
        lifted.some((entry) => {
          return entry.reader === reader && entry.text.toUpperCase() === token;
        }),
      ).toBe(true);
    }
  });
});

describe("the Kubernetes agent's API-mode tailer reads every level word as the one table does", () => {
  const tailer = readTailerSeverityNumbers();

  test("every text it numbers is stored at the table's number", () => {
    expect(Object.keys(tailer).length).toBeGreaterThan(40);
    expect(
      Object.entries(tailer).filter(([text, number]) => {
        return namedNumber(text) !== number;
      }),
    ).toEqual([]);
  });

  test("it numbers every text the DaemonSet's readers lift, and nothing else", () => {
    const lifted = new Set(
      chainTexts(CONFIGS.get(KUBERNETES_SOURCE)).map(({ text }) => {
        return text.toUpperCase();
      }),
    );

    expect([...lifted].sort()).toEqual(Object.keys(tailer).sort());
  });
});

/**
 * Syslog's eight severities, 0 to 7, by the keyword RFC 5424 gives each and
 * the collector's syslog parser and journald keep as the text.
 */
const SYSLOG_KEYWORDS = [
  "EMERG",
  "ALERT",
  "CRIT",
  "ERR",
  "WARNING",
  "NOTICE",
  "INFO",
  "DEBUG",
];

/** The journal priority -> level mapping of the host collector's default config. */
function journaldPriorityMapping() {
  const file = path.join(
    REPO_ROOT,
    "packages",
    "Common",
    "Utils",
    "HostCollector",
    "HostCollectorDefaultConfig.ts",
  );
  const source = fs.readFileSync(file, "utf8");
  const parser =
    /- type: severity_parser\n\s+if: 'body\.PRIORITY != nil'\n\s+parse_from: body\.PRIORITY\n[\s\S]*?mapping:\n((?:\s+[a-z0-9]+: "\d"\n)+)/.exec(
      source,
    );

  if (!parser) {
    throw new Error(`${file}: no journald PRIORITY severity_parser`);
  }

  const byPriority = {};

  for (const line of parser[1].split("\n").filter(Boolean)) {
    const [, level, priority] = /^\s+([a-z0-9]+): "(\d)"$/.exec(line);

    byPriority[priority] = SEVERITY_NUMBER[level];
  }

  return byPriority;
}

describe("syslog's eight severities are stored as their keywords are", () => {
  test.each(SYSLOG_KEYWORDS.map((keyword, priority) => [priority, keyword]))(
    "OneUptime's syslog ingest stores priority %i as the table stores %s",
    (priority, keyword) => {
      const table = LOG_SEVERITY_NUMBER_BY_TEXT.get(keyword);

      expect(SYSLOG_TO_OTEL_SEVERITY[String(priority)]).toEqual({
        number: table,
        text: logSeverityFromNumber(table),
      });
      expect(mapSyslogSeverity(priority)).toEqual({
        number: table,
        text: logSeverityFromNumber(table),
      });
    },
  );

  test.each(SYSLOG_KEYWORDS.map((keyword, priority) => [priority, keyword]))(
    "the host collector stores journal priority %i as the table stores %s",
    (priority, keyword) => {
      expect(journaldPriorityMapping()[String(priority)]).toBe(
        LOG_SEVERITY_NUMBER_BY_TEXT.get(keyword),
      );
    },
  );
});

describe("CloudWatch Logs reads a level word as the one table does", () => {
  test("every word of the table it reads at the start of a line", () => {
    const read = [...LOG_SEVERITY_NUMBER_BY_TEXT.keys()]
      .map((word) => {
        return { word, read: inferCloudWatchLogSeverity(`${word} message`) };
      })
      .filter((entry) => {
        return entry.read !== null;
      });

    // It reads ten of them at least: trace, debug, info, notice, warn,
    // warning, error, err, fatal, critical.
    expect(read.length).toBeGreaterThanOrEqual(10);
    expect(
      read.filter((entry) => {
        return (
          entry.read.number !== LOG_SEVERITY_NUMBER_BY_TEXT.get(entry.word)
        );
      }),
    ).toEqual([]);
  });

  test.each([
    [
      "PANIC",
      "2026-11-04 09:59:01 UTC:10.0.0.7(5432):app@orders:[812]:PANIC:  could not write to file",
    ],
    [
      "FATAL",
      "2026-11-04 09:59:01 UTC:10.0.0.7(5432):app@orders:[812]:FATAL:  terminating connection",
    ],
    [
      "NOTICE",
      "2026-11-04 09:59:01 UTC:10.0.0.7(5432):app@orders:[812]:NOTICE:  table does not exist, skipping",
    ],
    [
      "WARNING",
      "2026-11-04 09:59:01 UTC:10.0.0.7(5432):app@orders:[812]:WARNING:  there is no transaction in progress",
    ],
  ])(
    "RDS for PostgreSQL's %s is stored at the table's number",
    (word, line) => {
      expect(inferCloudWatchLogSeverity(line).number).toBe(
        LOG_SEVERITY_NUMBER_BY_TEXT.get(word),
      );
    },
  );
});

/*
 * THE COPIES AS THEY WERE, kept so the suite shows what issue #11228 was:
 * the agents' mapping block as it shipped through #11220, the tailer's
 * numbers, OneUptime's syslog ingest, and the one word of the table this
 * change moved (PANIC, 19 then).
 */
const AS_THEY_WERE = {
  agentsMapping: {
    trace: ["trce", "trc", "10"],
    debug: ["dbug", "dbg", "vrb", "20"],
    info: ["notice", "note", "log", "inf", "information", "i", "30"],
    warn: ["warning", "wrn", "w", "40"],
    error: [
      "err",
      "eror",
      "fail",
      "severe",
      "dpanic",
      "crit",
      "critical",
      "e",
      "50",
    ],
    fatal: ["panic", "pnc", "ftl", "alert", "emerg", "emergency", "f", "60"],
  },
  tailer: {
    NOTICE: 9,
    CRITICAL: 17,
    CRIT: 17,
    DPANIC: 17,
    ALERT: 21,
    PANIC: 21,
    EMERG: 21,
  },
  syslogNumbers: [23, 23, 19, 19, 13, 9, 9, 5],
  tablePanic: 19,
};

describe("issue #11228: the copies as they were", () => {
  const tableAsItWas = (word) => {
    return word === "PANIC"
      ? AS_THEY_WERE.tablePanic
      : LOG_SEVERITY_NUMBER_BY_TEXT.get(word);
  };

  test("put critical, alert and panic in different levels, and crit and notice at different numbers", () => {
    const disagreements = ["CRITICAL", "ALERT", "PANIC", "CRIT", "NOTICE"].map(
      (word) => {
        const agents = resolveSeverityNumber(word, {
          mapping: AS_THEY_WERE.agentsMapping,
        });

        return {
          word,
          agents: `${logSeverityFromNumber(agents)} (${agents})`,
          ingest: `${logSeverityFromNumber(tableAsItWas(word))} (${tableAsItWas(word)})`,
        };
      },
    );

    expect(disagreements).toEqual([
      { word: "CRITICAL", agents: "Error (17)", ingest: "Fatal (21)" },
      { word: "ALERT", agents: "Fatal (21)", ingest: "Error (19)" },
      { word: "PANIC", agents: "Fatal (21)", ingest: "Error (19)" },
      { word: "CRIT", agents: "Error (17)", ingest: "Error (18)" },
      { word: "NOTICE", agents: "Information (9)", ingest: "Information (10)" },
    ]);

    // The tailer numbered them as the chain did.
    for (const [word, number] of Object.entries(AS_THEY_WERE.tailer)) {
      expect([
        word,
        resolveSeverityNumber(word, { mapping: AS_THEY_WERE.agentsMapping }),
      ]).toEqual([word, number]);
    }
  });

  test("and OneUptime's syslog ingest put an alert, as its keyword is stored, in Fatal", () => {
    expect(
      SYSLOG_KEYWORDS.map((keyword, priority) => {
        return [
          keyword,
          AS_THEY_WERE.syslogNumbers[priority],
          tableAsItWas(keyword),
        ];
      }).filter(([, syslog, table]) => {
        return logSeverityFromNumber(syslog) !== logSeverityFromNumber(table);
      }),
    ).toEqual([["ALERT", 23, 19]]);
  });

  test("now every copy agrees with the table on those words", () => {
    const kubernetesParser = indexOperatorsById(
      CONFIGS.get(KUBERNETES_SOURCE),
    ).get("severity-parser");
    const tailer = readTailerSeverityNumbers();

    for (const word of ["CRITICAL", "ALERT", "PANIC", "CRIT", "NOTICE"]) {
      expect([word, resolveSeverityNumber(word, kubernetesParser)]).toEqual([
        word,
        LOG_SEVERITY_NUMBER_BY_TEXT.get(word),
      ]);
      expect([word, tailer[word]]).toEqual([
        word,
        LOG_SEVERITY_NUMBER_BY_TEXT.get(word),
      ]);
    }

    expect(mapSyslogSeverity(1).number).toBe(
      LOG_SEVERITY_NUMBER_BY_TEXT.get("ALERT"),
    );
  });
});
