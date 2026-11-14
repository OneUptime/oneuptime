import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { createTranslator, Translator } from "Common/Types/Translator";
import {
  getSessionReplayIdentityPermissionTitle,
  getSessionReplayPermissionTitle,
  SESSION_REPLAY_IDENTITY_PERMISSION,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPermissionTitle";
import {
  describeSessionReplayFilterHint,
  SESSION_REPLAY_FILTER_FIELDS,
  SessionReplayFilterField,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFilterFields";
import { describeHealthError } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayHealthError";
import { describeSessionReplayListError } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayEmptyReason";

/*
 * SESSION REPLAY NAMES THE PERMISSION THE ROLES SCREEN SHOWS (#6635).
 *
 * Its copy asked a reader to get "the Read Session Replay permission",
 * which no role has ever offered (the roles screen calls it "List Session
 * Replays"), and "the session replay identity permission" (the roles
 * screen's "Watch Session Replays"). Languages translated "Edit RUM
 * Application" in some sentences and kept it in English in others. Each
 * sentence now has a {{permission}} placeholder, filled with the title
 * Common/Types/Permission.ts gives the permission the route asks for, so a
 * project admin finds exactly that name on the roles screen, in every
 * language.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const LOCALES_DIR: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

// The sentences that ask a reader for a permission, by the title they fill in.
const ASKING_SENTENCES: ReadonlyArray<string> = [
  'A recording of this error may exist, but your role cannot list session replays. Ask a project admin for the "{{permission}}" permission.',
  'Arming a recording of a named person is a capture-policy change, so it needs the "{{permission}}" permission (project owners, admins and telemetry admins have it). Ask a project admin to arm the target for you.',
  'Reading recording health needs the "{{permission}}" permission (project owners, admins and telemetry admins have it). Ask a project admin to grant it, or to run this check for you.',
  'Your role cannot read end-user identity, so the server dropped the user filter "{{user}}" and this list is NOT narrowed to that user. Ask a project admin for the "{{permission}}" permission, or filter by URL, tag or device instead.',
  'Your role cannot read end-user identity, so this filter is ignored by the server. Ask a project admin for the "{{permission}}" permission.',
  'Your role lacks the "{{permission}}" permission. Ask a project admin for it.',
];

// What the copy used to call permissions no roles screen lists.
const NAMES_NO_SCREEN_SHOWS: RegExp =
  /Read Session Replay permission|session replay identity permission|session replay read permission|Edit RUM Application permission/i;

describe("the permission a sentence names", () => {
  test("is the roles screen's title for it", () => {
    expect(
      getSessionReplayPermissionTitle(Permission.ReadRumSessionReplay),
    ).toBe("List Session Replays");
    expect(
      getSessionReplayPermissionTitle(Permission.ReadRumSessionReplayPayload),
    ).toBe("Watch Session Replays");
    expect(getSessionReplayPermissionTitle(Permission.EditRumApplication)).toBe(
      "Edit RUM Application",
    );

    for (const permission of [
      Permission.ReadRumSessionReplay,
      Permission.ReadRumSessionReplayPayload,
      Permission.EditRumApplication,
    ]) {
      expect(getSessionReplayPermissionTitle(permission)).toBe(
        PermissionHelper.getTitle(permission),
      );
    }
  });

  test("a permission without a title still names itself", () => {
    expect(
      getSessionReplayPermissionTitle("NoSuchPermission" as Permission),
    ).toBe("NoSuchPermission");
  });

  test("recording health and the session list ask for List Session Replays", () => {
    expect(
      describeHealthError({ kind: "permission", message: "" }).detail,
    ).toBe(
      'Reading recording health needs the "List Session Replays" permission (project owners, admins and telemetry admins have it). Ask a project admin to grant it, or to run this check for you.',
    );
    expect(describeSessionReplayListError("", 403).detail).toBe(
      'Your role lacks the "List Session Replays" permission. Ask a project admin for it.',
    );
  });

  test.each([
    ["German", "de", "„List Session Replays“"],
    ["French", "fr", "« List Session Replays »"],
    ["Japanese", "ja", "「List Session Replays」"],
    ["Chinese", "zh-CN", "“List Session Replays”"],
    ["Arabic", "ar", "«List Session Replays»"],
    ["Persian", "fa", "«List Session Replays»"],
  ])(
    "%s: the title as the roles screen writes it, in the language's quotes",
    (_name: string, language: string, quoted: string) => {
      const translator: Translator = translatorFor(language);
      const health: string = describeHealthError(
        { kind: "permission", message: "" },
        translator,
      ).detail;
      const list: string = describeSessionReplayListError(
        "",
        403,
        translator,
      ).detail;

      for (const detail of [health, list]) {
        expect(detail).toContain(quoted);
        expect(detail).not.toContain("{{permission}}");
      }
    },
  );
});

describe("the locales", () => {
  test("no key names a permission the roles screen does not show", () => {
    const english: Record<string, string> = readLocale("en");

    expect(
      Object.keys(english).filter((key: string): boolean => {
        return NAMES_NO_SCREEN_SHOWS.test(key);
      }),
    ).toEqual([]);

    // The check finds the old wording.
    expect(
      NAMES_NO_SCREEN_SHOWS.test(
        "Ask a project admin for the Read Session Replay permission.",
      ),
    ).toBe(true);
  });

  test("every language asks for the permission by its placeholder, never in its own words", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const sentence of ASKING_SENTENCES) {
        const worded: string = locale[sentence] as string;

        expect({
          language,
          sentence,
          worded: Boolean(worded) && worded !== sentence,
          namesItByPlaceholder: (worded || "").includes("{{permission}}"),
        }).toEqual({
          language,
          sentence,
          worded: true,
          namesItByPlaceholder: true,
        });
      }
    }
  });
});

/*
 * THE LINES THAT SAY THE IDENTITY IS HIDDEN NAME THE GRANT THAT SHOWS IT
 * (#7096).
 *
 * Three lines said "the identity permission": the session details panel's
 * End user row, the header's tooltip on "Identity hidden", and the User
 * filter's hint. No roles screen lists a permission by that name, and the
 * languages carried the made-up name too (German "Identitätsberechtigung"),
 * so a reader who wanted to see who a session belongs to, and the project
 * admin they asked, had no way to find which grant gives it. Each line now
 * names it through "{{permission}}", filled with the roles screen's title
 * for the permission the server asks for: "Watch Session Replays".
 */

const SESSION_REPLAY_DIR: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay",
);

const TELEMETRY_API: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Server/API/TelemetryAPI.ts",
);

// The three lines, as en.json keys them.
const IDENTITY_HIDDEN_SENTENCES: ReadonlyArray<string> = [
  'Hidden - your role needs the "{{permission}}" permission',
  'Your role cannot read end-user identity. Ask a project admin for the "{{permission}}" permission.',
  'The exact reference your page passed to identify(). Needs the "{{permission}}" permission; never written to the URL.',
];

// The lines they replace, which named a permission no roles screen lists.
const RETIRED_SENTENCES: ReadonlyArray<string> = [
  "Not shown - viewing identity needs the identity permission",
  "The end user's identity needs the identity permission to view.",
  "The exact reference your page passed to identify(). Needs the end-user identity permission; never written to the URL.",
];

// "Identity permission" as English wrote it, in a sentence or a key.
const IDENTITY_PERMISSION_WORDS: RegExp = /identity permission/i;

/*
 * The same made-up name, as each language worded it. None of these is on a
 * roles screen in any language: the roles screen draws "Watch Session
 * Replays" as written.
 */
const RETIRED_NAMES_BY_LANGUAGE: Record<string, ReadonlyArray<string>> = {
  ar: ["إذن الهوية", "إذن هوية المستخدم النهائي"],
  da: ["identitetstilladelse", "tilladelsen til slutbrugeridentitet"],
  de: ["Identitätsberechtigung", "Berechtigung für Endbenutzeridentitäten"],
  es: ["permiso de identidad"],
  fa: ["دسترسی هویت"],
  fr: ["autorisation d'identité"],
  hi: ["पहचान अनुमति", "पहचान की अनुमति"],
  it: ["autorizzazione per l'identità", "autorizzazione all'identità"],
  ja: ["身元に関する権限"],
  ko: ["신원 권한"],
  nl: [
    "machtiging voor identiteit",
    "machtiging voor eindgebruikersidentiteit",
  ],
  no: ["identitetstillatelse", "tillatelsen for sluttbrukeridentitet"],
  pt: ["permissão de identidade"],
  ru: ["право на просмотр личности"],
  sv: ["identitetsbehörighet", "behörigheten för slutanvändaridentitet"],
  "zh-CN": ["身份权限"],
  "zh-TW": ["身分權限"],
};

const SOURCE_FILE_NAME: RegExp = /\.tsx?$/;

// Every .ts and .tsx file under `dir`.
function sourceFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesUnder(full));
    } else if (SOURCE_FILE_NAME.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

/*
 * The text a file can put on a screen: its string and template literals and
 * its JSX text - never its comments, which may well say "identity
 * permission" about the code.
 */
function stringsInSource(fileName: string, text: string): Array<string> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const strings: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node)
    ) {
      strings.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      strings.push(
        node.head.text +
          node.templateSpans
            .map((span: ts.TemplateSpan): string => {
              return `{value}${span.literal.text}`;
            })
            .join(""),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return strings;
}

function hintOf(fieldName: string): SessionReplayFilterField {
  const field: SessionReplayFilterField | undefined =
    SESSION_REPLAY_FILTER_FIELDS.find(
      (candidate: SessionReplayFilterField): boolean => {
        return candidate.field === fieldName;
      },
    );

  expect(field).toBeDefined();

  return field as SessionReplayFilterField;
}

describe("the grant that shows who a session's end user is", () => {
  test("is Watch Session Replays, the roles screen's title for the payload read", () => {
    expect(SESSION_REPLAY_IDENTITY_PERMISSION).toBe(
      Permission.ReadRumSessionReplayPayload,
    );
    expect(getSessionReplayIdentityPermissionTitle()).toBe(
      "Watch Session Replays",
    );
    expect(getSessionReplayIdentityPermissionTitle()).toBe(
      PermissionHelper.getTitle(Permission.ReadRumSessionReplayPayload),
    );
  });

  test("is the one the server serves the identity behind", () => {
    const source: string = fs.readFileSync(TELEMETRY_API, "utf8");
    const start: number = source.indexOf(
      "const SESSION_REPLAY_IDENTITY_PERMISSIONS: Array<Permission> = [",
    );

    expect(start).toBeGreaterThanOrEqual(0);

    const list: string = source.slice(start, source.indexOf("];", start));

    /*
     * Owners and admins hold every grant; the one a role is given to see
     * identity is the one the sentences name.
     */
    expect(list).toContain(`Permission.${SESSION_REPLAY_IDENTITY_PERMISSION}`);
    expect(list).toContain("Permission.ProjectOwner");
    expect(list).toContain("Permission.ProjectAdmin");
  });

  test("the User filter's hint names it in English, the rest of its words as they were", () => {
    expect(describeSessionReplayFilterHint(hintOf("identifiedUserRef"))).toBe(
      'The exact reference your page passed to identify(). Needs the "Watch Session Replays" permission; never written to the URL.',
    );
    expect(hintOf("identifiedUserRef").hintPermission).toBe(
      Permission.ReadRumSessionReplayPayload,
    );
  });

  test.each([
    ["German", "de", "„Watch Session Replays“"],
    ["French", "fr", "« Watch Session Replays »"],
    ["Japanese", "ja", "「Watch Session Replays」"],
    ["Chinese", "zh-CN", "“Watch Session Replays”"],
    ["Arabic", "ar", "«Watch Session Replays»"],
    ["Persian", "fa", "«Watch Session Replays»"],
  ])(
    "%s: the User filter's hint names it as the roles screen writes it, in the language's quotes",
    (_name: string, language: string, quoted: string) => {
      const hint: string | null = describeSessionReplayFilterHint(
        hintOf("identifiedUserRef"),
        translatorFor(language),
      );

      expect(hint).toContain(quoted);
      expect(hint).toContain("identify()");
      expect(hint).not.toContain("{{permission}}");
      expect(hint).not.toBe(
        describeSessionReplayFilterHint(hintOf("identifiedUserRef")),
      );
    },
  );

  test("a hint that names no grant is looked up as it is, and a field without one has none", () => {
    const german: Translator = translatorFor("de");
    const urlPrefix: SessionReplayFilterField = hintOf("urlPrefix");

    expect(urlPrefix.hintPermission).toBeUndefined();
    expect(describeSessionReplayFilterHint(urlPrefix, german)).toBe(
      readLocale("de")[urlPrefix.hint as string],
    );
    expect(describeSessionReplayFilterHint(urlPrefix)).toBe(urlPrefix.hint);
    expect(describeSessionReplayFilterHint(hintOf("osName"))).toBeNull();

    // Only the User filter's hint names a grant.
    expect(
      SESSION_REPLAY_FILTER_FIELDS.filter(
        (field: SessionReplayFilterField): boolean => {
          return Boolean(field.hintPermission);
        },
      ).map((field: SessionReplayFilterField): string => {
        return field.field;
      }),
    ).toEqual(["identifiedUserRef"]);
  });
});

describe("no Session Replay line names the identity permission", () => {
  test("in the source: no string a Session Replay file draws says it", () => {
    const offenders: Array<string> = [];

    for (const file of sourceFilesUnder(SESSION_REPLAY_DIR)) {
      for (const text of stringsInSource(file, fs.readFileSync(file, "utf8"))) {
        if (IDENTITY_PERMISSION_WORDS.test(text)) {
          offenders.push(`${path.relative(SESSION_REPLAY_DIR, file)}: ${text}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the source check finds the old line, and reads past a comment that names it", () => {
    const strings: Array<string> = stringsInSource(
      "Example.tsx",
      [
        "/* Present only for roles with the identity permission. */",
        'const a: string = tx("Not shown - viewing identity needs the identity permission");',
        "const b: ReactElement = <span>Needs the end-user identity permission</span>;",
      ].join("\n"),
    );

    expect(
      strings.filter((text: string): boolean => {
        return IDENTITY_PERMISSION_WORDS.test(text);
      }),
    ).toEqual([
      "Not shown - viewing identity needs the identity permission",
      "Needs the end-user identity permission",
    ]);
  });

  test("in English: no key says it, and the three old lines are gone", () => {
    const english: Record<string, string> = readLocale("en");

    expect(
      Object.keys(english).filter((key: string): boolean => {
        return IDENTITY_PERMISSION_WORDS.test(key);
      }),
    ).toEqual([]);

    for (const sentence of RETIRED_SENTENCES) {
      expect(english[sentence]).toBeUndefined();
    }

    for (const sentence of IDENTITY_HIDDEN_SENTENCES) {
      expect(english[sentence]).toBe(sentence);
    }
  });

  test("in every other language: the old lines are gone, and so is the name each one made up", () => {
    expect(Object.keys(RETIRED_NAMES_BY_LANGUAGE).sort()).toEqual(LANGUAGES);

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const sentence of RETIRED_SENTENCES) {
        expect({ language, sentence, kept: sentence in locale }).toEqual({
          language,
          sentence,
          kept: false,
        });
      }

      const madeUp: Array<string> = [];

      // The flat keys: a few older ones are nested objects, none of them Session Replay's.
      for (const [key, value] of Object.entries(locale)) {
        for (const name of RETIRED_NAMES_BY_LANGUAGE[language] || []) {
          if (typeof value === "string" && value.includes(name)) {
            madeUp.push(`${key} => ${value}`);
          }
        }
      }

      expect({ language, madeUp }).toEqual({ language, madeUp: [] });
    }
  });

  test("the language check would find a made-up name", () => {
    expect(
      "Zum Anzeigen der Identität des Endbenutzers ist die Identitätsberechtigung erforderlich.".includes(
        (RETIRED_NAMES_BY_LANGUAGE["de"] as ReadonlyArray<string>)[0] as string,
      ),
    ).toBe(true);
  });

  test("every language words the three lines, naming the grant by its placeholder", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const sentence of IDENTITY_HIDDEN_SENTENCES) {
        const worded: string = locale[sentence] as string;

        expect({
          language,
          sentence,
          worded: Boolean(worded) && worded !== sentence,
          namesItByPlaceholder:
            (worded || "").split("{{permission}}").length === 2,
          keepsTheCode: !sentence.includes("identify()")
            ? true
            : (worded || "").includes("identify()"),
        }).toEqual({
          language,
          sentence,
          worded: true,
          namesItByPlaceholder: true,
          keepsTheCode: true,
        });
      }
    }
  });

  /*
   * The header's tooltip says why and what to do, in the words the filter
   * dialog already uses when the same role types a user: it ends with that
   * dialog's request to a project admin, word for word, in every language,
   * so the two never ask for the grant two different ways.
   */
  test("the header's tooltip asks a project admin for the grant exactly as the filter dialog does", () => {
    const tooltip: string = IDENTITY_HIDDEN_SENTENCES[1] as string;
    const filterLine: string =
      'Your role cannot read end-user identity, so this filter is ignored by the server. Ask a project admin for the "{{permission}}" permission.';
    const ask: string =
      'Ask a project admin for the "{{permission}}" permission.';

    expect(tooltip.endsWith(` ${ask}`)).toBe(true);
    expect(filterLine.endsWith(` ${ask}`)).toBe(true);

    for (const language of ["en", ...LANGUAGES]) {
      const locale: Record<string, string> = readLocale(language);
      const wordedTooltip: string = locale[tooltip] || "";
      const wordedFilterLine: string = locale[filterLine] || "";

      // The longest ending the two share.
      let shared: number = 0;

      while (
        shared < Math.min(wordedTooltip.length, wordedFilterLine.length) &&
        wordedTooltip[wordedTooltip.length - 1 - shared] ===
          wordedFilterLine[wordedFilterLine.length - 1 - shared]
      ) {
        shared += 1;
      }

      const sharedEnding: string = wordedTooltip.slice(
        wordedTooltip.length - shared,
      );

      expect({
        language,
        asksForTheGrant: sharedEnding.includes("{{permission}}"),
        // More than the placeholder and its quotes: the request itself.
        isTheWholeRequest:
          sharedEnding.replace("{{permission}}", "").trim().length >= 8,
      }).toEqual({ language, asksForTheGrant: true, isTheWholeRequest: true });
    }
  });

  test.each([
    [
      "German",
      "de",
      [
        "Ausgeblendet - Ihrer Rolle fehlt die Berechtigung „Watch Session Replays“",
        "Ihre Rolle kann keine Endbenutzeridentitäten lesen. Bitten Sie einen Projektadministrator um die Berechtigung „Watch Session Replays“.",
      ],
    ],
    [
      "English",
      "en",
      [
        'Hidden - your role needs the "Watch Session Replays" permission',
        'Your role cannot read end-user identity. Ask a project admin for the "Watch Session Replays" permission.',
      ],
    ],
  ])(
    "%s: the details panel's row and the header's tooltip, filled with the roles screen's title",
    (_name: string, language: string, expected: Array<string>) => {
      const translator: Translator =
        language === "en"
          ? createTranslator(undefined, "en")
          : translatorFor(language);

      expect(
        IDENTITY_HIDDEN_SENTENCES.slice(0, 2).map(
          (sentence: string): string => {
            return translator.translateTemplate(sentence, {
              permission: getSessionReplayIdentityPermissionTitle(),
            });
          },
        ),
      ).toEqual(expected);
    },
  );
});
