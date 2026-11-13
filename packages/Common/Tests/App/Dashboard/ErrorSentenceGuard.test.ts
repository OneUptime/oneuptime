// UX rule: Docs/ux/README.md#errors
import {
  ALLOWED_USES,
  ERROR_SENTENCE_EXCEPTIONS,
  ErrorSentenceFinding,
  ErrorSentenceSource,
  ErrorSentenceUse,
  REPOSITORY_ROOT,
  disallowedErrorSentences,
  errorSentenceExceptionKey,
  findErrorSentences,
  findErrorSentencesInSources,
  formatErrorSentenceFindings,
  listErrorSentenceScanFiles,
} from "../../ErrorSentenceScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #7307: cards say what failed in a sentence of their own and put the
 * error's message in it - "Couldn't work out who is told. {{error}}". The
 * message is API.getFriendlyMessage's answer: for a gateway's 502 or 504
 * that is SERVER_DOWN_MESSAGE, no key in any language, and a server
 * failure's sentence comes with its reference filled in. So a German or a
 * Persian card read half in English, and the reference had no copy button.
 *
 * A sentence puts an error in one way now: drawn with ErrorSentence, or
 * filled with errorInSentence(message) where it has to be text
 * (Common/UI/Utils/ErrorInSentence). This guard reads every browser module
 * (each feature set's src, Common/UI, and ee/ when the checkout has it) and
 * fails on any sentence with {{error}} or {{message}} that is filled another
 * way, naming the file and the line. The detector
 * (Common/Tests/ErrorSentenceScan.ts) is pinned on snippets first - each way
 * a sentence was filled before, and each way it may be now - and then run
 * over the tree, with checks that the walk really read it and negative
 * controls that put the old code back.
 */

type Judged = Array<string>;

// Each finding as "<use> @<file>:<line>".
function judged(findings: Array<ErrorSentenceFinding>): Judged {
  return findings.map((finding: ErrorSentenceFinding): string => {
    return `${finding.use} @${finding.file}:${finding.line}`;
  });
}

function judge(
  source: Array<string>,
  fileName: string = "Fixture.tsx",
): Judged {
  return judged(
    findErrorSentencesInSources([
      { file: fileName, source: source.join("\n") },
    ]),
  );
}

describe("the detector judges each way a sentence puts an error in", () => {
  test("the who-is-told card as it was: the message as the value", () => {
    expect(
      judge([
        "const Card = () => (",
        "  <p>",
        "    {translator.translateTemplate(",
        '      "Couldn\'t work out who is told. {{error}}",',
        "      { error: state.message },",
        "    )}",
        "  </p>",
        ");",
      ]),
    ).toEqual(["plain value @Fixture.tsx:4"]);
  });

  test("a message looked up first is still the message: translateText(message) || message", () => {
    expect(
      judge([
        "translator.translateTemplate(",
        '  "Couldn\'t load incidents. {{error}}",',
        "  { error: translator.translateText(message) || message },",
        ");",
      ]),
    ).toEqual(["plain value @Fixture.tsx:2"]);
  });

  test("a shorthand value is the message as it came", () => {
    expect(
      judge([
        'translator.translateTemplate("Could not load the AI logs: {{error}}", { error });',
      ]),
    ).toEqual(["plain value @Fixture.tsx:1"]);
  });

  test("the card drawn with ErrorSentence", () => {
    expect(
      judge([
        "const Card = () => (",
        '  <p><ErrorSentence template="Couldn\'t work out who is told. {{error}}" error={state.message} /></p>',
        ");",
      ]),
    ).toEqual(["ErrorSentence @Fixture.tsx:2"]);
  });

  test("an ErrorSentence's template written in braces, or chosen by a condition", () => {
    expect(
      judge([
        'const A = () => <ErrorSentence template={"Couldn\'t load. {{error}}"} error={e} />;',
        "const B = () => (",
        "  <ErrorSentence",
        "    template={",
        '      isQuery ? "Columns ({{error}}). The query is JSON." : "Columns ({{error}}). Fields are JSON."',
        "    }",
        "    error={e}",
        "  />",
        ");",
      ]),
    ).toEqual([
      "ErrorSentence @Fixture.tsx:1",
      "ErrorSentence @Fixture.tsx:5",
      "ErrorSentence @Fixture.tsx:5",
    ]);
  });

  test('{{message}} needs errorPlaceholder="message": the error goes where the sentence puts it', () => {
    expect(
      judge([
        'const A = () => <ErrorSentence template="Server said: {{message}}" error={e} errorPlaceholder="message" />;',
        'const B = () => <ErrorSentence template="Server said: {{message}}" error={e} />;',
        'const C = () => <ErrorSentence template="Line {{line}}: {{error}}" error={e} errorPlaceholder="line" />;',
      ]),
    ).toEqual([
      "ErrorSentence @Fixture.tsx:1",
      "wrong placeholder @Fixture.tsx:2",
      "wrong placeholder @Fixture.tsx:3",
    ]);
  });

  test("a TranslatedSentence (or any other element) drawing an error sentence is a finding", () => {
    expect(
      judge([
        "const A = () => (",
        '  <TranslatedSentence template="Couldn\'t refresh. Showing what loaded at {{time}}. {{error}}" values={{ error: e }} slots={{ time: t }} />',
        ");",
      ]),
    ).toEqual(["other element @Fixture.tsx:2"]);
  });

  test("errorInSentence(message) as the value: in a call, through translationKey, in a plural", () => {
    expect(
      judge([
        'translator.translateTemplate("Couldn\'t load incidents. {{error}}", { error: errorInSentence(message) });',
        'translateTemplate(translationKey("Lookup for {{host}} failed — {{error}}"), { host: h, error: errorInSentence(e) as string });',
        "translator.translatePlural(",
        '  { one: "{{count}} part failed: {{error}}", other: "{{count}} parts failed: {{error}}" },',
        "  count,",
        "  { error: errorInSentence(e) },",
        ");",
        "translator.translatePlural(",
        '  { one: "{{count}} part failed: {{error}}", other: "{{count}} parts failed: {{error}}" },',
        "  count,",
        "  { error: e },",
        ");",
      ]),
    ).toEqual([
      "errorInSentence value @Fixture.tsx:1",
      "errorInSentence value @Fixture.tsx:2",
      "errorInSentence value @Fixture.tsx:4",
      "errorInSentence value @Fixture.tsx:4",
      "plain value @Fixture.tsx:9",
      "plain value @Fixture.tsx:9",
    ]);
  });

  test("{{message}} filled with errorInSentence, and a template both arms of a condition hold", () => {
    expect(
      judge([
        'translateTemplate("Loading {{noun}} failed: {{message}}. Retry.", { noun: n, message: errorInSentence(m) });',
        "translator.translateTemplate(",
        '  hasTime ? "{{error}} Showing {{time}}." : "{{error}} Showing the last.",',
        "  { error: e, time: t },",
        ");",
      ]),
    ).toEqual([
      "errorInSentence value @Fixture.tsx:1",
      "plain value @Fixture.tsx:3",
      "plain value @Fixture.tsx:3",
    ]);
  });

  test("a spread before the error's value is read past; one after it, or values kept elsewhere, are not read", () => {
    expect(
      judge([
        'translateTemplate("The {{agent}} could not reach it: {{error}}", { ...nouns(d), error: errorInSentence(e) });',
        'translateTemplate("The {{agent}} could not reach it: {{error}}", { error: errorInSentence(e), ...nouns(d) });',
        'translateTemplate("The {{agent}} could not reach it: {{error}}", values);',
        'translateTemplate("The {{agent}} could not reach it: {{error}}");',
      ]),
    ).toEqual([
      "errorInSentence value @Fixture.tsx:1",
      "values not written out @Fixture.tsx:2",
      "values not written out @Fixture.tsx:3",
      "values not written out @Fixture.tsx:4",
    ]);
  });

  test("a template filled by hand is a finding: the replay card's .replace", () => {
    expect(
      judge([
        'const message = COPY.replace("{{error}}", friendly);',
        "const other = COPY.replaceAll('{{message}}', friendly);",
      ]),
    ).toEqual([
      "filled by hand @Fixture.tsx:1",
      "filled by hand @Fixture.tsx:2",
    ]);
  });

  test("a stored template is judged where its name is read: a constant, a copy object, an alias", () => {
    expect(
      judge([
        'export const LAST_RUN_FAILED: string = translationKey("Last run failed: {{error}}");',
        "const COPY = {",
        '  couldNotRead: translationKey("Could not read who is in this channel. {{error}}"),',
        '  logsCouldNotLoad: "Could not load the AI activity: {{error}}",',
        "};",
        "const couldNotLoad = copy.logsCouldNotLoad || FALLBACK;",
        "const A = () => <ErrorSentence template={LAST_RUN_FAILED} error={e} />;",
        "const B = () => translator.translateTemplate(COPY.couldNotRead, { error: e });",
        "const C = () => <ErrorSentence template={couldNotLoad} error={e} />;",
      ]),
    ).toEqual([
      "stored @Fixture.tsx:1",
      "ErrorSentence @Fixture.tsx:7",
      "stored @Fixture.tsx:3",
      "plain value @Fixture.tsx:8",
      "stored @Fixture.tsx:4",
      "ErrorSentence @Fixture.tsx:9",
    ]);
  });

  test("a stored template is read in the modules that import its module, and nowhere else", () => {
    const sources: Array<ErrorSentenceSource> = [
      {
        file: "Hunts/HuntsCopy.ts",
        source:
          'export const LAST_RUN_FAILED: string = translationKey("Last run failed: {{error}}");',
      },
      {
        file: "Hunts/HuntHeader.tsx",
        source: [
          'import { LAST_RUN_FAILED } from "./HuntsCopy";',
          "const A = () => translator.translateTemplate(LAST_RUN_FAILED, { error: e });",
        ].join("\n"),
      },
      {
        file: "Other/Unrelated.tsx",
        source:
          "const B = () => translator.translateTemplate(LAST_RUN_FAILED, { error: e });",
      },
    ];

    expect(judged(findErrorSentencesInSources(sources))).toEqual([
      "stored @Hunts/HuntsCopy.ts:1",
      "plain value @Hunts/HuntHeader.tsx:2",
    ]);
  });

  test("a stored template nothing reads is a finding: nothing shows how it is filled", () => {
    expect(
      judge([
        "const NOTES = {",
        '  [NoteCode.PartNotAdded]: translationKey("{{name}} could not be added: {{error}}"),',
        "};",
        "const fill = (code) => translator.translateTemplate(NOTES[code], values);",
      ]),
    ).toEqual([
      "stored @Fixture.tsx:2",
      "filled nowhere the guard sees @Fixture.tsx:2",
    ]);
  });

  test("a friendly message given straight to a placeholder of any name - {{reason}} too - is a finding", () => {
    expect(
      judge([
        'translator.translateTemplate("Could not add {{list}}: {{reason}}", { list: l, reason: API.getFriendlyMessage(err) });',
        'translator.translateTemplate("Could not add {{list}}: {{reason}}", { list: l, reason: errorInSentence(API.getFriendlyMessage(err)) });',
        'const A = () => <TranslatedSentence template="Saved. {{detail}}" values={{ detail: BaseAPI.getFriendlyErrorMessage(e as Exception) }} />;',
        'const B = () => <ErrorSentence template="The preview could not be loaded: {{reason}}" error={API.getFriendlyMessage(e)} errorPlaceholder="reason" />;',
      ]),
    ).toEqual([
      "friendly message as the value @Fixture.tsx:1",
      "friendly message as the value @Fixture.tsx:3",
    ]);
  });

  test("a comment that quotes a sentence, and a sentence with no error in it, are not sites", () => {
    expect(
      judge([
        '// "Couldn\'t work out who is told. {{error}}"',
        '/* translateTemplate("Couldn\'t load. {{error}}", { error: e }) */',
        'translator.translateTemplate("Couldn\'t load {{count}} rows: {{reason}}", { count: c, reason: r });',
        'translator.translateTemplate("Last run at {{time}}", { time: t });',
      ]),
    ).toEqual([]);
  });

  test("only the two ways in, and a stored template's own line, are allowed", () => {
    expect(Array.from(ALLOWED_USES).sort()).toEqual(
      [
        ErrorSentenceUse.ErrorSentence,
        ErrorSentenceUse.ErrorValue,
        ErrorSentenceUse.Stored,
      ].sort(),
    );
  });
});

describe("every sentence of the product puts an error in one way", () => {
  const files: Array<string> = listErrorSentenceScanFiles(REPOSITORY_ROOT);
  const findings: Array<ErrorSentenceFinding> = findErrorSentences(
    REPOSITORY_ROOT,
    files,
  );

  test("the walk reads the Dashboard, Common/UI and the cards #7307 names", () => {
    const relative: Set<string> = new Set<string>(
      files.map((file: string): string => {
        return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
      }),
    );

    expect(files.length).toBeGreaterThan(3000);

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorWhoIsToldCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOpenWorkCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewHero.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Metrics/MetricView.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Metrics/ChartRefetchFrame.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeHeader.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembersCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProbeStatusMonitor/ProbeStatusMonitorStepForm.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversation.tsx",
      "packages/Common/UI/Components/StatusTimeline/ModelStatusTimeline.tsx",
    ]) {
      expect(relative.has(file)).toBe(true);
    }
  });

  test("the walk finds the sentences: the who-is-told card's is drawn with ErrorSentence", () => {
    const whoIsTold: Array<ErrorSentenceFinding> = findings.filter(
      (finding: ErrorSentenceFinding): boolean => {
        return finding.text === "Couldn't work out who is told. {{error}}";
      },
    );

    expect(
      whoIsTold.map((finding: ErrorSentenceFinding): string => {
        return `${finding.use} @${finding.file}`;
      }),
    ).toEqual([
      "ErrorSentence @packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorWhoIsToldCard.tsx",
    ]);

    // Dozens of sentences, both ways in, and stored ones read where they are filled.
    const count: (use: ErrorSentenceUse) => number = (
      use: ErrorSentenceUse,
    ): number => {
      return findings.filter((finding: ErrorSentenceFinding): boolean => {
        return finding.use === use;
      }).length;
    };

    expect(count(ErrorSentenceUse.ErrorSentence)).toBeGreaterThan(60);
    expect(count(ErrorSentenceUse.ErrorValue)).toBeGreaterThan(10);
    expect(count(ErrorSentenceUse.Stored)).toBeGreaterThan(8);
  });

  test("no sentence puts an error in another way", () => {
    const disallowed: Array<ErrorSentenceFinding> =
      disallowedErrorSentences(findings);

    expect(formatErrorSentenceFindings(disallowed)).toBe("");
  });

  test("each exception names a sentence the walk still finds, and says why", () => {
    const keys: Set<string> = new Set<string>(
      findings
        .filter((finding: ErrorSentenceFinding): boolean => {
          return !ALLOWED_USES.has(finding.use);
        })
        .map(errorSentenceExceptionKey),
    );

    for (const [key, reason] of Object.entries(ERROR_SENTENCE_EXCEPTIONS)) {
      expect(keys.has(key)).toBe(true);
      expect(reason.length).toBeGreaterThan(80);
    }
  });
});

describe("negative controls: the old code back in a real card fails the guard", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
  };

  const disallowedIn: (file: string, source: string) => Judged = (
    file: string,
    source: string,
  ): Judged => {
    return judged(
      disallowedErrorSentences(
        findErrorSentencesInSources([{ file: file, source: source }]),
      ),
    );
  };

  test("the who-is-told card filling {{error}} with the message, as before #7307", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorWhoIsToldCard.tsx";
    const source: string = read(file);
    const now: string =
      '<ErrorSentence\n              template="Couldn\'t work out who is told. {{error}}"\n              error={state.message}\n            />';

    expect(source).toContain(now);
    expect(disallowedIn(file, source)).toEqual([]);

    const before: string = source.replace(
      now,
      '{translator.translateTemplate("Couldn\'t work out who is told. {{error}}", { error: state.message })}',
    );

    expect(disallowedIn(file, before)).toHaveLength(1);
    expect(disallowedIn(file, before)[0]).toMatch(/^plain value @/);
  });

  test("a value that drops errorInSentence", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorProvisioning.ts";
    const source: string = read(file);

    expect(source).toContain("errorInSentence(");
    expect(disallowedIn(file, source)).toEqual([]);
    expect(
      disallowedIn(file, source.split("errorInSentence(").join("(")).length,
    ).toBeGreaterThan(0);
  });

  test("Billing's {{reason}} given the friendly message as it came", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Pages/Settings/Billing.tsx";
    const source: string = read(file);
    const now: string =
      "reason: errorInSentence(BaseAPI.getFriendlyMessage(err))";

    expect(source).toContain(now);
    expect(disallowedIn(file, source)).toEqual([]);
    expect(
      disallowedIn(
        file,
        source.replace(now, "reason: BaseAPI.getFriendlyMessage(err)"),
      ),
    ).toEqual([expect.stringMatching(/^friendly message as the value @/)]);
  });

  test("the replay card filling its sentence by hand again", () => {
    const file: string =
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCard.tsx";
    const source: string = read(file);
    const now: string =
      "message: REPLAY_CARD_ERROR_COPY,\n        detail: friendly,";

    expect(source).toContain(now);
    expect(disallowedIn(file, source)).toEqual([]);
    expect(
      disallowedIn(
        file,
        source.replace(
          now,
          'message: REPLAY_CARD_ERROR_DETAIL_COPY.replace("{{error}}", friendly),\n        detail: friendly,',
        ),
      ),
    ).toEqual([expect.stringMatching(/^filled by hand @/)]);
  });
});
