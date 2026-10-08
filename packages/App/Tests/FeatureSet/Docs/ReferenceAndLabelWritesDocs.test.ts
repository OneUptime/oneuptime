import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE ONE RECORD A WRITE NAMES, AND A CHANGE OF A RECORD'S LABELS, FOLLOW
 * THE CALLER'S PERMISSIONS.
 *
 * Common/Server/Types/Database/Permissions/RelationListPermission holds the
 * one record a create or a change names in a field of its own to the
 * caller's read, as it holds the records a write lists - and so the records
 * a service fills in from a template, asked again after the hooks run;
 * UpdateScopePermission holds a change of the labels a record carries to
 * the caller's permission to change it; DatabaseService makes a creator
 * whose permission to create reaches only what they own the owner right
 * after the save, or removes the record again.
 *
 * Users, Teams & Permissions says so in every docs language - step 5 for a
 * change of labels and the owner made first, step 6 for a block with labels
 * on a change, step 7 for the record a write names, each step still one
 * line - the API reference says what a client sees, and the upgrade notes
 * say what changes, at length in English and in one line in every other
 * guide.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// Step 5: a change of labels is scoped like a create, and the owner comes first.
const LABEL_CHANGE: Record<string, string> = {
  en: "A change of the labels a record carries is scoped the same way: with a permission to change it restricted to labels, the record keeps at least one of them, unless another permission to change it reaches the whole project, and a change that takes the last of them away is refused with a message naming the labels. When your permission to create a kind of record reaches only what you own, you are made the owner of what you create before anything else happens to it, and the create is refused, with nothing left behind, if you cannot be.",
  da: "En ændring af de labels, en post bærer, afgrænses på samme måde",
  de: "Eine Änderung der Labels, die ein Datensatz trägt, wird genauso eingegrenzt",
  es: "Un cambio de las etiquetas que lleva un registro se acota de la misma forma",
  fa: "تغییر برچسب‌هایی که یک رکورد دارد هم به همین شکل تنگ می‌شود",
  fr: "Une modification des étiquettes que porte un enregistrement est restreinte de la même façon",
  hi: "किसी रिकॉर्ड पर लगे लेबलों का बदलाव भी इसी तरह संकुचित होता है",
  it: "Una modifica delle etichette che porta un record si restringe allo stesso modo",
  ja: "レコードに付いているラベルの変更も同じように絞り込まれます",
  ko: "레코드에 붙은 라벨의 변경도 같은 방식으로 좁혀집니다",
  nl: "Een wijziging van de labels die een record draagt, wordt op dezelfde manier beperkt",
  no: "En endring av etikettene en post bærer, avgrenses på samme måte",
  pt: "Uma alteração dos rótulos que um registro carrega é restringida da mesma forma",
  ru: "Изменение меток, которые несёт запись, сужается так же",
  sv: "En ändring av de etiketter en post bär avgränsas på samma sätt",
  "zh-CN": "修改记录所带的标签也以同样方式收窄",
  "zh-TW": "修改記錄所帶的標籤也以同樣方式收窄",
};

// Step 6: a block with labels on a change.
const CHANGE_BLOCK: Record<string, string> = {
  en: "A block with labels on a permission to change keeps you from giving a record one of its labels or, for a record with no labels of its own, from pointing it at a record that carries one.",
  da: "En blokering med labels på en tilladelse til at ændre forhindrer dig i",
  de: "Eine Sperre mit Labels auf einer Berechtigung zum Ändern hindert Sie daran",
  es: "Un bloqueo con etiquetas sobre un permiso para cambiar le impide",
  fa: "مسدودی با برچسب روی مجوز تغییر نمی‌گذارد",
  fr: "Un blocage avec étiquettes sur une autorisation de modifier vous empêche",
  hi: "बदलने की अनुमति पर लेबल वाला अवरोध",
  it: "Un blocco con etichette su un'autorizzazione a modificare vi impedisce",
  ja: "変更する権限に対するラベル付きのブロックがあると",
  ko: "변경 권한에 대한 라벨 차단은",
  nl: "Een blokkade met labels op een toestemming om te wijzigen voorkomt",
  no: "En blokkering med etiketter på en tillatelse til å endre hindrer deg i",
  pt: "Um bloqueio com rótulos sobre uma permissão para alterar impede",
  ru: "Блокировка с метками на разрешение на изменение не даёт вам",
  sv: "En blockering med etiketter på en behörighet att ändra hindrar dig",
  "zh-CN": "对修改权限的带标签阻止",
  "zh-TW": "對修改權限的帶標籤封鎖",
};

// Step 7: the one record a write names, and the records a template fills in.
const NAMED_RECORD: Record<string, string> = {
  en: "The one record a create or a change names in a field of its own, such as the monitor of an alert or the monitor a status page shows, keeps to the same rule, and so do the records a template fills in, such as the monitors and status pages an incident template adds to an incident declared from it; OneUptime's global probes and AI agents stay open to every project.",
  da: "Den ene post, som en oprettelse eller en ændring angiver i et felt for sig",
  de: "Der eine Datensatz, den ein Anlegen oder eine Änderung in einem eigenen Feld nennt",
  es: "El único registro que una creación o un cambio nombra en un campo propio",
  fa: "تنها رکوردی که یک ساختن یا تغییر در فیلدی جداگانه نام می‌برد",
  fr: "L'unique enregistrement qu'une création ou une modification nomme dans un champ à part",
  hi: "कोई बनाना या बदलाव जिस एक रिकॉर्ड को अपने अलग फ़ील्ड में बताता है",
  it: "L'unico record che una creazione o una modifica nomina in un campo a sé",
  ja: "作成や変更が専用のフィールドで指定する 1 件のレコード",
  ko: "만들기나 변경이 별도의 필드에서 지정하는 레코드 하나",
  nl: "Het ene record dat een aanmaak of een wijziging in een eigen veld noemt",
  no: "Den ene posten en oppretting eller en endring angir i et eget felt",
  pt: "O único registro que uma criação ou uma alteração nomeia em um campo próprio",
  ru: "Одна запись, которую создание или изменение указывает в отдельном поле",
  sv: "Den enda post som ett skapande eller en ändring anger i ett eget fält",
  "zh-CN": "创建或修改在单独字段中指定的那一条记录",
  "zh-TW": "建立或修改在單獨欄位中指定的那一筆記錄",
};

// Step 7's change rule (ParentScopeOnWritesDocs): the new words come after it.
const CHANGE_RULE: Record<string, string> = {
  en: "A change keeps to the same rule",
  da: "En ændring følger samme regel",
  de: "Eine Änderung folgt derselben Regel",
  es: "Un cambio sigue la misma regla",
  fa: "تغییر هم از همین قاعده پیروی می‌کند",
  fr: "Une modification suit la même règle",
  hi: "बदलाव भी इसी नियम का पालन करता है",
  it: "Una modifica segue la stessa regola",
  ja: "変更も同じ規則に従います",
  ko: "변경도 같은 규칙을 따릅니다",
  nl: "Een wijziging volgt dezelfde regel",
  no: "En endring følger samme regel",
  pt: "Uma alteração segue a mesma regra",
  ru: "Изменение следует тому же правилу",
  sv: "En ändring följer samma regel",
  "zh-CN": "修改也遵循同一规则",
  "zh-TW": "修改也遵循同一規則",
};

// The upgrade note's opening words.
const UPGRADE_HEADING: Record<string, string> = {
  en: "The one record a write names, and a change of a record's labels, keep to",
  da: "Den ene post, en skrivning angiver, og en ændring af en posts labels",
  de: "Der eine Datensatz, den ein Schreibvorgang nennt",
  es: "El único registro que nombra una escritura",
  fa: "تنها رکوردی که یک نوشتن نام می‌برد",
  fr: "L'unique enregistrement qu'une écriture nomme",
  hi: "कोई लिखना जिस एक रिकॉर्ड को बताता है",
  it: "L'unico record che una scrittura nomina",
  ja: "書き込みが指定する 1 件のレコードと",
  ko: "쓰기가 지정하는 레코드 하나와",
  nl: "Het ene record dat een schrijfactie noemt",
  no: "Den ene posten en skriving angir",
  pt: "O único registro que uma escrita nomeia",
  ru: "Одна запись, которую указывает операция записи",
  sv: "Den enda post som en skrivning anger",
  "zh-CN": "写入所指定的单条记录",
  "zh-TW": "寫入所指定的單筆記錄",
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

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Docs: the one record a write names, and a change of a record's labels", () => {
  test("every docs language is checked, each with its own words", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const words of [
      LABEL_CHANGE,
      CHANGE_BLOCK,
      NAMED_RECORD,
      CHANGE_RULE,
      UPGRADE_HEADING,
    ]) {
      expect(Object.keys(words).sort()).toEqual([...LANGUAGES].sort());
    }
  });

  test.each(LANGUAGES)(
    "%s says it in steps 5, 6 and 7, translated, each step one line",
    (language: string) => {
      const page: string = permissionsPage(language);
      const five: string = stepOf(page, 5);
      const six: string = stepOf(page, 6);
      const seven: string = stepOf(page, 7);

      expect([language, five.includes(LABEL_CHANGE[language]!)]).toEqual([
        language,
        true,
      ]);
      expect([language, six.includes(CHANGE_BLOCK[language]!)]).toEqual([
        language,
        true,
      ]);
      expect([language, seven.includes(NAMED_RECORD[language]!)]).toEqual([
        language,
        true,
      ]);

      // Said once each, on the page.
      for (const words of [LABEL_CHANGE, CHANGE_BLOCK, NAMED_RECORD]) {
        expect([language, countOf(page, words[language]!)]).toEqual([
          language,
          1,
        ]);
      }

      // After the change rule and the records a write lists, before the reads by ID.
      const change: number = seven.indexOf(CHANGE_RULE[language]!);
      const named: number = seven.indexOf(NAMED_RECORD[language]!);

      expect([language, change >= 0 && named > change]).toEqual([
        language,
        true,
      ]);
      expect([language, seven.lastIndexOf("`404`") > named]).toEqual([
        language,
        true,
      ]);
      expect([language, countOf(seven, "`404`")]).toEqual([language, 2]);
      expect([language, stepOf(page, 8)]).toEqual([language, ""]);

      if (language !== "en") {
        for (const words of [LABEL_CHANGE, CHANGE_BLOCK, NAMED_RECORD]) {
          expect([language, page.includes(words["en"]!)]).toEqual([
            language,
            false,
          ]);
        }
      }
    },
  );

  test("the API reference says what the one record a write names, a change of labels and an owner made first answer", () => {
    const page: string = read("en", "api-reference/api-reference.md");
    const section: string = page.slice(
      page.indexOf("### Records a request names"),
      page.indexOf("### Switches"),
    );

    for (const sentence of [
      "The one record a create or a change names in a field of its own - an alert's monitor, the monitor a status page resource shows, a cost budget's service, the incident a runbook run is linked to - keeps to the same rule, under either of its names",
      "A change checks it only when it names another record than the one the field holds already.",
      "OneUptime's global probes and AI agents, which every project can use, stay open to every project.",
      "the monitors, status pages and on-call policies an incident template adds to an incident declared from it must be ones you may read, as if you had picked them.",
      "The creator is made an owner right after the record is saved, before anything else happens to it.",
      "the record is removed again and the create is refused with a `500`",
      "A change of the labels a record carries - its own labels, or for a record with no labels of its own the records it names - keeps to your permission to change that kind of record the same way",
      "Your access lets you change Monitors only with one of these labels: Production. Keep one of them and try again.",
    ]) {
      expect([sentence, section.includes(sentence)]).toEqual([sentence, true]);
    }

    // After the records a write lists, and after an Owned create.
    expect(
      section.indexOf("The one record a create or a change names"),
    ).toBeGreaterThan(
      section.indexOf("The records a create or a change lists"),
    );
    expect(
      section.indexOf("A change of the labels a record carries"),
    ).toBeGreaterThan(
      section.indexOf("A permission to create scoped to **Owned**"),
    );
  });

  test("the English upgrade notes say what changes, after a record moved or given more records", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      `- **${UPGRADE_HEADING["en"]!}`,
      "  with the `400` that names the field and the ID, and nothing is written. A",
      "  the same way, before anything is saved and before the incident takes its",
      "  of its labels; either is refused with a `422` that names the labels. A",
      "  and when that fails the record is removed again and the create is refused",
      "  maintenance events and their templates are now read through the record",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }

    const moved: number = page.indexOf(
      "- **A record moved under another one, or given more records in a list,",
    );
    const named: number = page.indexOf(`- **${UPGRADE_HEADING["en"]!}`);
    const readById: number = page.indexOf(
      "- **Every grant and scope narrows what it reaches, and a read by ID of a",
    );

    expect(moved).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(moved);
    expect(readById).toBeGreaterThan(named);
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "the %s upgrade guide has the line, before a create under a readable record",
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
      const named: Array<number> = lines
        .map((line: string, index: number): number => {
          return line.startsWith("- **") &&
            line.includes(UPGRADE_HEADING[language]!)
            ? index
            : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect([language, named.length]).toEqual([language, 1]);

      const line: string = lines[named[0]!]!;

      // Right before the line on a create under a record its creator may read.
      expect([
        language,
        lines[named[0]! + 1]!.includes("`CreateIncidentInternalNote`"),
      ]).toEqual([language, true]);
      expect([language, named[0]! < anchor]).toEqual([language, true]);

      for (const status of ["`400`", "`422`"]) {
        expect([language, status, line.includes(status)]).toEqual([
          language,
          status,
          true,
        ]);
      }

      expect([language, line.includes(UPGRADE_HEADING["en"]!)]).toEqual([
        language,
        false,
      ]);
    },
  );
});
