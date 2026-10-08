import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A RECORD READ THROUGH ANOTHER ONE IS CREATED ONLY UNDER ONE ITS CREATOR MAY
 * READ (Common/Server/Types/Database/Permissions/CreatePermission
 * .checkParentPermission, asked by DatabaseService.create): the parent a
 * create names - an incident for a note, the status pages of an
 * announcement - must be one a read of it finds for the caller, or the create
 * is refused like one naming a record that does not exist.
 *
 * Users, Teams & Permissions says so in every docs language - in step 7 of
 * how a request is decided, beside how such a record is read, and in the
 * paragraph under Granular permissions that tells a custom role which read
 * permission to give with a note's permissions - the API reference says what
 * a create answers, and the upgrade notes say what changes, at length in
 * English and in one line in every other guide.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const CREATE_NOTE: string = "`CreateIncidentInternalNote`";
const READ_INCIDENT: string = "`ReadProjectIncident`";

/*
 * The words of step 7's sentence on creating such a record, in each
 * language: the sentence is there, translated.
 */
const CREATED_UNDER_A_READABLE_RECORD: Record<string, string> = {
  en: "Such a record is also created only under one you may read: a note goes only on an incident you may read, and an announcement only on status pages you may read, each of them; naming one you may not read is refused as if it did not exist.",
  da: "oprettes også kun under en post, du må læse",
  de: "wird auch nur unter einem Datensatz angelegt, den Sie lesen dürfen",
  es: "también se crea solo bajo un registro que puede leer",
  fa: "فقط زیر رکوردی ساخته می‌شود که اجازهٔ خواندنش را دارید",
  fr: "n'est aussi créé que sous un enregistrement que vous pouvez lire",
  hi: "केवल उसी रिकॉर्ड के अंतर्गत बनाया जाता है जिसे आप पढ़ सकते हैं",
  it: "si crea anche solo sotto un record che potete leggere",
  ja: "こうしたレコードの作成も、読み取れるレコードの下に限られます",
  ko: "만들 때도 읽을 수 있는 레코드 아래에만 만들어집니다",
  nl: "wordt ook alleen aangemaakt onder een record dat u mag lezen",
  no: "opprettes også bare under en post du har lov til å lese",
  pt: "também só é criado sob um registro que você pode ler",
  ru: "Создаётся такая запись тоже только под записью, которую вы можете читать",
  sv: "skapas också bara under en post du får läsa",
  "zh-CN": "这类记录也只能在你能读取的记录之下创建",
  "zh-TW": "這類記錄也只能在你能讀取的記錄之下建立",
};

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function permissionsPage(language: string): string {
  return read(language, "permissions/index.md");
}

// The one line of a numbered step on the permissions page.
function stepOf(markdown: string, number: number): string {
  return (
    markdown.split("\n").find((line: string): boolean => {
      return line.startsWith(`${number}. `);
    }) || ""
  );
}

// The paragraph right after the one naming every granular permission.
function granularParagraph(markdown: string): string {
  const lines: Array<string> = markdown.split("\n");
  const index: number = lines.findIndex((line: string): boolean => {
    return line.includes("{{PERMISSION_TOTAL_COUNT}}");
  });

  expect(index).toBeGreaterThanOrEqual(0);
  expect(lines[index + 1]).toBe("");

  return lines[index + 2] || "";
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Docs: a record read through another one is created only under one you may read", () => {
  const english: string = permissionsPage("en");

  test("every docs language is checked, each with its own words", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(Object.keys(CREATED_UNDER_A_READABLE_RECORD).sort()).toEqual(
      [...LANGUAGES].sort(),
    );
  });

  test("English step 7 says it right after how such a record is read", () => {
    const step: string = stepOf(english, 7);

    expect(step).toContain(
      "a permission on notes reaches only the notes of the incidents you or one of your teams own. Such a record is also created only under one you may read:",
    );
  });

  test.each(LANGUAGES)(
    "%s says it in step 7 and in the granular paragraph, translated",
    (language: string) => {
      const page: string = permissionsPage(language);
      const step: string = stepOf(page, 7);
      const paragraph: string = granularParagraph(page);

      expect([
        language,
        step.includes(CREATED_UNDER_A_READABLE_RECORD[language]!),
      ]).toEqual([language, true]);

      // The sentence answers no status code of its own: step 7 keeps two.
      expect([language, countOf(step, "`404`")]).toEqual([language, 2]);

      // Said once, in step 7.
      expect([
        language,
        countOf(page, CREATED_UNDER_A_READABLE_RECORD[language]!),
      ]).toEqual([language, 1]);

      expect([language, paragraph.includes(CREATE_NOTE)]).toEqual([
        language,
        true,
      ]);

      if (language !== "en") {
        expect([
          language,
          paragraph.includes(CREATED_UNDER_A_READABLE_RECORD["en"]!),
        ]).toEqual([language, false]);
      }
    },
  );

  test("the granular paragraph says a note's create permission reaches the incidents you may read", () => {
    expect(granularParagraph(english)).toContain(
      "`ReadIncidentInternalNote` reaches no note without one to read incidents, and `CreateIncidentInternalNote` adds a note only to an incident you may read. The roles hold both already.",
    );
  });

  test("the API reference says what a create under a record you may not read answers", () => {
    const page: string = read("en", "api-reference/api-reference.md");
    const section: string = page.slice(
      page.indexOf("### Records a request names"),
      page.indexOf("### Switches"),
    );

    expect(section).toContain(
      "A record read through another one - an incident's or an alert's notes and state timeline, a status page's announcements, domains and groups - must also name one you may read",
    );
    expect(section).toContain("is refused with the same `400`");
    expect(section).toContain(
      "Each status page an announcement names must be one you may read",
    );
    expect(section).toContain(
      "You do not have permissions to create Incident Internal Note. It is read through its Incident, and you need one of these permissions to read Incidents: …",
    );
  });

  test("the English upgrade notes say what changes for custom roles and API keys", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      "- **A record read through another one is created only under a record its",
      "  is refused as if it did not exist, with the `400` that names the field",
      "  `CreateIncidentInternalNote` without a permission to read incidents now",
      "  `ReadProjectIncident` limited to some labels or to **Owned** scope it",
      "  [Records a request names](/docs/api-reference/api-reference#records-a-request-names)",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }

    // Beside the other permission changes, before the reads by ID.
    expect(
      page.indexOf(
        "- **A record read through another one is created only under a record its",
      ),
    ).toBeLessThan(
      page.indexOf(
        "- **Every grant and scope narrows what it reaches, and a read by ID of a",
      ),
    );
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "the %s upgrade guide has the line, among the other changes before the endpoint changes",
    (language: string) => {
      const lines: Array<string> = read(
        language,
        "installation/upgrading.md",
      ).split("\n");
      const anchor: number = lines.findIndex((line: string): boolean => {
        return (
          line.startsWith("- ") && line.includes("(#api-and-endpoint-changes)")
        );
      });
      const created: Array<number> = lines
        .map((line: string, index: number): number => {
          return line.startsWith("- **") &&
            line.includes(CREATE_NOTE) &&
            line.includes(READ_INCIDENT)
            ? index
            : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect([language, created.length]).toEqual([language, 1]);
      expect([language, created[0]! < anchor]).toEqual([language, true]);

      // In the same list: only list items between the line and the anchor.
      for (const line of lines.slice(created[0]!, anchor)) {
        expect([language, line.startsWith("- **")]).toEqual([language, true]);
      }
    },
  );
});
