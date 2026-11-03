import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_LINES,
  AI_ACTION_PLURAL_SENTENCES,
  AI_ACTION_PLURAL_TITLES,
  AI_ACTION_RESOURCE_BY_NAME,
  AI_ACTION_RESOURCE_NOUNS,
  AI_ACTION_SENTENCES,
  AI_ACTION_TERM_WORDS,
  AI_ACTION_TERMS,
  AI_ACTION_TITLES,
  AIActionSentence,
  AIActionWords,
  aiActionList,
  aiActionPluralSentence,
  aiActionResourceByName,
  aiActionSentence,
  aiActionTerm,
  describeAIActionSentence,
  describeAIActionWords,
  getAIActionPluralTemplate,
  getAIActionSentenceDirection,
  getAIActionSentenceLanguage,
  getAIActionSentenceSeparator,
  getAIActionSentenceShownValues,
  isKnownAIActionSentence,
  isKnownAIActionWords,
  joinAIActionSentences,
} from "../../../Types/AI/AIActionWords";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKindInfo,
} from "../../../Types/AI/AiAffectedResources";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHAT AN AI ACTION'S CARD SAYS, AS SENTENCES ANY LANGUAGE CAN SAY.
 *
 * The server builds each title and line as a sentence of
 * Types/AI/AIActionWords - an English template and the values that fill
 * it - and keeps its English for the model, the exports and conversations
 * saved before. These hold the English exactly as the server wrote it
 * before the sentences existed, a reader's language words a sentence whole
 * with its data as data, and the Dashboard trusts only the sentences the
 * module knows.
 */

// A German Dashboard, for the sentences a test words.
function german(): Translator {
  const words: Record<string, string> = {
    "Create incident: {{title}}": "Vorfall erstellen: {{title}}",
    "Acknowledge incident {{incident}}": "Vorfall {{incident}} bestätigen",
    "Linked to {{resources}}.": "Verknüpft mit {{resources}}.",
    "Severity: {{severity}}.": "Schweregrad: {{severity}}.",
    "Commit {{count}} files to {{branch}}":
      "{{count}} Dateien in {{branch}} committen",
    "Commit {{count}} files to {{branch}}_one":
      "{{count}} Datei in {{branch}} committen",
    Untitled: "Ohne Titel",
    "a branch": "einen Branch",
    host: "Host",
    "Kubernetes cluster": "Kubernetes-Cluster",
  };

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, "de");
}

// A Persian Dashboard, read right to left.
function persian(): Translator {
  const words: Record<string, string> = {
    "Create incident: {{title}}": "ساخت حادثه: {{title}}",
    "Linked to {{resources}}.": "پیوند به {{resources}}.",
    host: "میزبان",
  };

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, "fa");
}

describe("the server's English is the English it always wrote", () => {
  test.each<[string, AIActionSentence, string]>([
    [
      "a new incident by its title",
      aiActionSentence(AI_ACTION_TITLES.createIncident, {
        title: "Checkout down",
      }),
      "Create incident: Checkout down",
    ],
    [
      "a new incident the call gave no title",
      aiActionSentence(AI_ACTION_TITLES.createIncident, {
        title: aiActionTerm(AI_ACTION_TERMS.untitled),
      }),
      "Create incident: Untitled",
    ],
    [
      "an alert",
      aiActionSentence(AI_ACTION_TITLES.createAlert, {
        title: "High memory usage on test01",
      }),
      "Create alert: High memory usage on test01",
    ],
    [
      "an acknowledge by number",
      aiActionSentence(AI_ACTION_TITLES.acknowledgeIncident, {
        incident: "INC-42",
      }),
      "Acknowledge incident INC-42",
    ],
    [
      "an acknowledge with no incident named",
      aiActionSentence(AI_ACTION_TITLES.acknowledgeIncidentUnnamed),
      "Acknowledge incident",
    ],
    [
      "a link of the conversation's incident",
      aiActionSentence(AI_ACTION_TITLES.linkThisIncident),
      "Link this incident to affected resources",
    ],
    [
      "a link by number",
      aiActionSentence(AI_ACTION_TITLES.linkAlert, { alert: "ALR-7" }),
      "Link alert ALR-7 to affected resources",
    ],
    [
      "a severity change",
      aiActionSentence(AI_ACTION_TITLES.changeIncidentSeverity, {
        incident: "#12",
        severity: "SEV1",
      }),
      "Change incident #12 severity to SEV1",
    ],
    [
      // A name as the server writes it, in quotes (RecordNamesForPerson).
      "a playbook on a case",
      aiActionSentence(AI_ACTION_TITLES.runSecurityPlaybook, {
        playbook: '"Contain host"',
        securityCase: "CASE-3",
      }),
      'Run playbook "Contain host" on security case CASE-3',
    ],
    [
      "a page for an incident",
      aiActionSentence(AI_ACTION_TITLES.pageOnCallPolicyForIncident, {
        policy: '"Checkout on-call"',
        incident: "INC-42",
      }),
      'Page on-call policy "Checkout on-call" for incident INC-42',
    ],
    [
      "a run for an incident",
      aiActionSentence(AI_ACTION_TITLES.runRunbookForIncident, {
        runbook: '"Restart checkout"',
        incident: "INC-42",
      }),
      'Run runbook "Restart checkout" for incident INC-42',
    ],
    [
      "a pull request",
      aiActionSentence(AI_ACTION_TITLES.openPullRequest, {
        title: "Fix charge bug",
      }),
      "Open pull request: Fix charge bug",
    ],
  ])("%s", (_name: string, sentence: AIActionSentence, english: string) => {
    expect(describeAIActionSentence(sentence)).toBe(english);
  });

  test("a commit counts its files, one or many, onto a branch or 'a branch'", () => {
    expect(
      describeAIActionSentence(
        aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 1, {
          branch: "fix/charge",
        }),
      ),
    ).toBe("Commit 1 file to fix/charge");
    expect(
      describeAIActionSentence(
        aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 3, {
          branch: aiActionTerm(AI_ACTION_TERMS.aBranch),
        }),
      ),
    ).toBe("Commit 3 files to a branch");
    expect(
      describeAIActionSentence(
        aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 0, {
          branch: "main",
        }),
      ),
    ).toBe("Commit 0 files to main");
  });

  test("what a new incident is linked to, each resource by its kind and its quoted name", () => {
    const linked: AIActionSentence = aiActionSentence(
      AI_ACTION_LINES.linkedTo,
      {
        resources: aiActionList([
          aiActionResourceByName({ noun: "host", name: "test01" }),
          aiActionResourceByName({
            noun: "Kubernetes cluster",
            name: "prod-east",
          }),
        ]),
      },
    );

    expect(describeAIActionSentence(linked)).toBe(
      'Linked to host "test01", Kubernetes cluster "prod-east".',
    );
  });

  test("a name with quotes in it stays one name: it can never read as two resources", () => {
    expect(
      describeAIActionSentence(
        aiActionResourceByName({ noun: "host", name: 'a" and host "b' }),
      ),
    ).toBe('host "a\\" and host \\"b"');
  });

  test("a card's line is its sentences one after another", () => {
    const words: AIActionWords = {
      title: aiActionSentence(AI_ACTION_TITLES.createAlert, {
        title: "High memory",
      }),
      description: [
        aiActionSentence(AI_ACTION_LINES.severity, { severity: "High" }),
        aiActionSentence(AI_ACTION_LINES.someNotLinked),
      ],
    };

    expect(describeAIActionWords(words)).toEqual({
      title: "Create alert: High memory",
      description:
        "Severity: High. Some of the other resources named will not be linked.",
    });
    expect(
      describeAIActionWords({ title: words.title, description: [] }),
    ).toEqual({ title: "Create alert: High memory" });
  });
});

describe("a reader's language words the sentence whole, its data as data", () => {
  test("the title the model wrote goes in as written; the sentence and its terms are German", () => {
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_ACTION_TITLES.createIncident, {
          title: "Checkout down",
        }),
        german(),
      ),
    ).toBe("Vorfall erstellen: Checkout down");
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_ACTION_TITLES.createIncident, {
          title: aiActionTerm(AI_ACTION_TERMS.untitled),
        }),
        german(),
      ),
    ).toBe("Vorfall erstellen: Ohne Titel");
  });

  test("a number is data: never translated, never a sentence of its own", () => {
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_ACTION_TITLES.acknowledgeIncident, {
          incident: "INC-42",
        }),
        german(),
      ),
    ).toBe("Vorfall INC-42 bestätigen");
  });

  test("the kinds of resource are the reader's words, the names stay as written", () => {
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_ACTION_LINES.linkedTo, {
          resources: aiActionList([
            aiActionResourceByName({ noun: "host", name: "test01" }),
            aiActionResourceByName({
              noun: "Kubernetes cluster",
              name: "prod",
            }),
          ]),
        }),
        german(),
      ),
    ).toBe('Verknüpft mit Host "test01", Kubernetes-Cluster "prod".');
  });

  test("a count takes the language's form for it", () => {
    expect(
      describeAIActionSentence(
        aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 1, {
          branch: aiActionTerm(AI_ACTION_TERMS.aBranch),
        }),
        german(),
      ),
    ).toBe("1 Datei in einen Branch committen");
    expect(
      describeAIActionSentence(
        aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 1200, {
          branch: "main",
        }),
        german(),
      ),
    ).toBe("1.200 Dateien in main committen");
  });

  test("a sentence the language has not worded reads wholly in English, its terms too", () => {
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_ACTION_TITLES.resolveAlert, { alert: "ALR-1" }),
        german(),
      ),
    ).toBe("Resolve alert ALR-1");
    expect(
      getAIActionSentenceLanguage(
        aiActionSentence(AI_ACTION_TITLES.resolveAlert, { alert: "ALR-1" }),
        german(),
      ),
    ).toBe("en");
    expect(
      getAIActionSentenceLanguage(
        aiActionSentence(AI_ACTION_TITLES.createIncident, { title: "x" }),
        german(),
      ),
    ).toBe("de");
  });

  test("a template that is not one of the module's is filled as written, never looked up", () => {
    const tampered: AIActionSentence = { template: "Delete everything" };
    const looksUpEverything: Translator = createTranslator(
      (): string | undefined => {
        return "Alles gelöscht";
      },
      "de",
    );

    expect(describeAIActionSentence(tampered, looksUpEverything)).toBe(
      "Delete everything",
    );
  });
});

describe("right to left", () => {
  test("a Persian sentence reads right to left, its English title set apart", () => {
    const sentence: AIActionSentence = aiActionSentence(
      AI_ACTION_TITLES.createIncident,
      { title: "Checkout down" },
    );
    const drawn: string = describeAIActionSentence(sentence, persian(), {
      setsValuesApart: true,
    });

    expect(drawn).toBe(`ساخت حادثه: ${isolated("Checkout down")}`);
    expect(getAIActionSentenceDirection(sentence, persian())).toBe("rtl");
  });

  test("each name in a Persian list keeps its quotes and its place", () => {
    const drawn: string = describeAIActionSentence(
      aiActionSentence(AI_ACTION_LINES.linkedTo, {
        resources: aiActionList([
          aiActionResourceByName({ noun: "host", name: "test01" }),
          aiActionResourceByName({ noun: "host", name: "test02" }),
        ]),
      }),
      persian(),
      { setsValuesApart: true },
    );

    expect(drawn).toContain(isolated('"test01"'));
    expect(drawn).toContain(isolated('"test02"'));
    expect(withoutIsolateMarks(drawn)).toBe(
      'پیوند به میزبان "test01"، میزبان "test02".',
    );
  });

  test("an English sentence on a Persian page reads left to right, as English", () => {
    const sentence: AIActionSentence = aiActionSentence(
      AI_ACTION_TITLES.resolveIncident,
      { incident: "INC-1" },
    );

    expect(getAIActionSentenceDirection(sentence, persian())).toBe("ltr");
    // A value of the sentence's own direction needs no isolate.
    expect(
      describeAIActionSentence(sentence, persian(), { setsValuesApart: true }),
    ).toBe("Resolve incident INC-1");
  });

  test("without setsValuesApart (a name, an export) no isolate mark goes in", () => {
    const drawn: string = describeAIActionSentence(
      aiActionSentence(AI_ACTION_TITLES.createIncident, {
        title: "Checkout down",
      }),
      persian(),
    );

    expect(drawn).not.toContain(FIRST_STRONG_ISOLATE);
    expect(drawn).not.toContain(POP_DIRECTIONAL_ISOLATE);
  });
});

describe("a stored sentence is trusted only when it is one of the module's", () => {
  test("every title, line and plural the module declares is known", () => {
    for (const template of AI_ACTION_SENTENCES) {
      expect(isKnownAIActionSentence({ template })).toBe(true);
    }

    for (const plural of AI_ACTION_PLURAL_SENTENCES) {
      expect(
        isKnownAIActionSentence({ template: plural.other, count: 2 }),
      ).toBe(true);
      expect(getAIActionPluralTemplate(plural.other)).toBe(plural);
    }
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["a string", "Create incident: x"],
    ["an array", []],
    ["another template", { template: "Drop database {{name}}" }],
    ["no template", { values: {} }],
    [
      "a plural with no count",
      { template: AI_ACTION_PLURAL_TITLES.commitFiles.other },
    ],
    [
      "a plural whose count is no number",
      { template: AI_ACTION_PLURAL_TITLES.commitFiles.other, count: "3" },
    ],
    [
      "a plural whose count is not finite",
      { template: AI_ACTION_PLURAL_TITLES.commitFiles.other, count: Infinity },
    ],
    [
      "a count on a sentence that does not count",
      { template: AI_ACTION_TITLES.createIncident, count: 1 },
    ],
    [
      "values that are no object",
      { template: AI_ACTION_TITLES.createIncident, values: ["x"] },
    ],
    [
      "a value of another shape",
      { template: AI_ACTION_TITLES.createIncident, values: { title: true } },
    ],
    [
      "a term the module does not have",
      {
        template: AI_ACTION_TITLES.createIncident,
        values: { title: { term: "Delete" } },
      },
    ],
    [
      "a term whose case is no boolean",
      {
        template: AI_ACTION_TITLES.createIncident,
        values: {
          title: { term: AI_ACTION_TERMS.untitled, inSentence: "yes" },
        },
      },
    ],
    [
      "a list holding a sentence of another template",
      {
        template: AI_ACTION_LINES.linkedTo,
        values: { resources: { list: [{ template: "x {{y}}" }] } },
      },
    ],
    [
      "lists nested past the module's depth",
      {
        template: AI_ACTION_LINES.linkedTo,
        values: {
          resources: {
            list: [
              {
                template: AI_ACTION_LINES.linkedTo,
                values: {
                  resources: {
                    list: [
                      {
                        template: AI_ACTION_LINES.linkedTo,
                        values: {
                          resources: {
                            list: [
                              {
                                template: AI_ACTION_LINES.linkedTo,
                                values: { resources: { list: [] } },
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    ],
    [
      "a list longer than any card",
      {
        template: AI_ACTION_LINES.linkedTo,
        values: {
          resources: {
            list: Array.from({ length: 101 }, () => {
              return { template: AI_ACTION_RESOURCE_BY_NAME };
            }),
          },
        },
      },
    ],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(isKnownAIActionSentence(value)).toBe(false);
  });

  test("a card's words: a known title, known lines and argument names", () => {
    const title: AIActionSentence = aiActionSentence(
      AI_ACTION_TITLES.linkIncident,
      { incident: "INC-1" },
    );

    expect(isKnownAIActionWords({ title })).toBe(true);
    expect(
      isKnownAIActionWords({
        title,
        description: [aiActionSentence(AI_ACTION_LINES.noneLinked)],
        namedArguments: ["incidentId"],
      }),
    ).toBe(true);
    expect(isKnownAIActionWords({ title, description: "x" })).toBe(false);
    expect(
      isKnownAIActionWords({ title, description: [{ template: "x" }] }),
    ).toBe(false);
    expect(isKnownAIActionWords({ title, namedArguments: [1] })).toBe(false);
    expect(isKnownAIActionWords({ title, namedArguments: "incidentId" })).toBe(
      false,
    );
    expect(isKnownAIActionWords({ description: [] })).toBe(false);
    expect(isKnownAIActionWords(null)).toBe(false);
  });
});

describe("the pieces a card reads besides its words", () => {
  test("the data a title shows itself, for the argument line to leave out", () => {
    expect(
      getAIActionSentenceShownValues(
        aiActionSentence(AI_ACTION_TITLES.createIncident, {
          title: "  Checkout down ",
        }),
      ),
    ).toEqual(["Checkout down"]);
    expect(
      getAIActionSentenceShownValues(
        aiActionSentence(AI_ACTION_TITLES.createIncident, {
          title: aiActionTerm(AI_ACTION_TERMS.untitled),
        }),
      ),
    ).toEqual([]);
    expect(
      getAIActionSentenceShownValues(
        aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 2, {
          branch: "main",
        }),
      ),
    ).toEqual(["main"]);
  });

  test("sentences are joined by a space, and by nothing after a Chinese or Japanese full stop", () => {
    expect(getAIActionSentenceSeparator("")).toBe("");
    expect(getAIActionSentenceSeparator("Severity: High.")).toBe(" ");
    expect(getAIActionSentenceSeparator("重大度: 高。")).toBe("");
    expect(getAIActionSentenceSeparator("真的吗？")).toBe("");
    expect(
      joinAIActionSentences(["重大度: 高。", "ホストにリンクします。"]),
    ).toBe("重大度: 高。ホストにリンクします。");
    expect(joinAIActionSentences(["A.", "", "B."])).toBe("A. B.");
  });

  test("the kinds of resource are the affected resources' own nouns, and terms of the module", () => {
    expect(AI_ACTION_RESOURCE_NOUNS).toEqual(
      AI_AFFECTED_RESOURCE_KINDS.map(
        (info: AiAffectedResourceKindInfo): string => {
          return info.noun;
        },
      ),
    );

    for (const noun of AI_ACTION_RESOURCE_NOUNS) {
      expect(AI_ACTION_TERM_WORDS).toContain(noun);
    }
  });

  test("builders leave out what they are not given", () => {
    expect(aiActionSentence(AI_ACTION_TITLES.startInvestigation)).toEqual({
      template: AI_ACTION_TITLES.startInvestigation,
    });
    expect(aiActionTerm("Untitled")).toEqual({ term: "Untitled" });
    expect(aiActionTerm("host", { inSentence: true })).toEqual({
      term: "host",
      inSentence: true,
    });
    expect(
      aiActionPluralSentence(AI_ACTION_PLURAL_TITLES.commitFiles, 2),
    ).toEqual({
      template: AI_ACTION_PLURAL_TITLES.commitFiles.other,
      count: 2,
    });
  });
});
