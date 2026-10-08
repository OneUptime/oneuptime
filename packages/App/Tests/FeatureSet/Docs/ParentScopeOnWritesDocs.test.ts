import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A RECORD'S PARENTS AND THE RECORDS IT LISTS FOLLOW ITS EDITOR'S READ ON A
 * CHANGE TOO, AND A CREATE STAYS WITHIN ITS CREATE PERMISSION.
 *
 * Common/Server/Types/Database/Permissions/UpdatePermission
 * .checkParentPermission holds a change that moves a record read through
 * another one to the parent rule a create follows; RelationListPermission
 * holds the records a create or a change lists to the caller's read of
 * them; CreateScopePermission holds a create to the labels, the Owned scope
 * and the blocks with labels of the caller's permission to create.
 *
 * Users, Teams & Permissions says so in every docs language - step 5 for a
 * create's scope, step 6 for a block with labels on a create, step 7 for a
 * change and the records a write lists, each step still one line - the API
 * reference says what a client sees, and the upgrade notes say what
 * changes, at length in English and in one line in every other guide.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// Step 5: a create is scoped like a read.
const CREATE_SCOPE: Record<string, string> = {
  en: "A create is scoped the same way: a permission to create status pages restricted to labels creates only status pages carrying one of its labels, and a permission to create incident notes restricted to labels adds notes only to incidents carrying one, unless another permission for the create reaches the whole project; a create outside them is refused with a message naming the labels it allows.",
  da: "En oprettelse afgrænses på samme måde",
  de: "Ein Anlegen wird genauso eingegrenzt",
  es: "Una creación se acota de la misma forma",
  fa: "ساختن هم به همین شکل تنگ می‌شود",
  fr: "Une création est restreinte de la même façon",
  hi: "बनाना भी इसी तरह संकुचित होता है",
  it: "Una creazione si restringe allo stesso modo",
  ja: "作成も同じように絞り込まれます",
  ko: "만들기도 같은 방식으로 좁혀집니다",
  nl: "Een aanmaak wordt op dezelfde manier beperkt",
  no: "En oppretting avgrenses på samme måte",
  pt: "Uma criação é restringida da mesma forma",
  ru: "Создание сужается так же",
  sv: "Ett skapande avgränsas på samma sätt",
  "zh-CN": "创建也以同样方式收窄",
  "zh-TW": "建立也以同樣方式收窄",
};

// Step 6: a block with labels on a create.
const CREATE_BLOCK: Record<string, string> = {
  en: "A block with labels on a permission to create keeps you from creating a record that carries one of its labels or, for a record with no labels of its own, that belongs to a record carrying one.",
  da: "En blokering med labels på en tilladelse til at oprette afviser en ny post, der bærer et af dens labels eller, for en post uden egne labels, hører til en post, der bærer et",
  de: "Eine Sperre mit Labels auf einer Berechtigung zum Anlegen weist einen neuen Datensatz ab, der eines ihrer Labels trägt oder, wenn er keine eigenen Labels hat, zu einem Datensatz gehört, der eines davon trägt",
  es: "Un bloqueo con etiquetas sobre un permiso para crear rechaza un registro nuevo que lleva una de sus etiquetas o, si no tiene etiquetas propias, que pertenece a un registro que lleva una",
  fa: "مسدودی با برچسب روی مجوز ساختن، رکورد تازه‌ای را رد می‌کند که یکی از آن برچسب‌ها را دارد یا، اگر برچسب‌های خودش را ندارد، به رکوردی تعلق دارد که یکی از آن‌ها را دارد",
  fr: "Un blocage avec étiquettes sur une autorisation de créer refuse un nouvel enregistrement qui porte l'une de ses étiquettes ou, s'il n'a pas d'étiquettes propres, qui appartient à un enregistrement qui en porte une",
  hi: "बनाने की अनुमति पर लेबल वाला अवरोध ऐसे नए रिकॉर्ड को अस्वीकार करता है जिस पर उसका कोई लेबल हो या, यदि उसके अपने लेबल न हों, जो ऐसे रिकॉर्ड से जुड़ा हो जिस पर उनमें से कोई लेबल हो",
  it: "Un blocco con etichette su un'autorizzazione a creare rifiuta un nuovo record che porta una delle sue etichette o, se non ha etichette proprie, che appartiene a un record che ne porta una",
  ja: "作成権限に対するラベル付きのブロックは、そのラベルのいずれかが付いた新しいレコードを拒否し、自身のラベルを持たないレコードの場合は、そのラベルのいずれかが付いたレコードに属する新しいレコードを拒否します",
  ko: "만들기 권한에 대한 라벨 차단은 그 라벨 중 하나가 붙은 새 레코드를 거부하며, 자체 라벨이 없는 레코드라면 그 라벨 중 하나가 붙은 레코드에 속한 새 레코드를 거부합니다",
  nl: "Een blokkade met labels op een toestemming om aan te maken weigert een nieuw record dat een van haar labels draagt of, als het geen eigen labels heeft, hoort bij een record dat er een draagt",
  no: "En blokkering med etiketter på en tillatelse til å opprette avviser en ny post som bærer en av etikettene dens eller, for en post uten egne etiketter, hører til en post som bærer en av dem",
  pt: "Um bloqueio com rótulos sobre uma permissão para criar recusa um registro novo que carrega um dos seus rótulos ou, se não tiver rótulos próprios, que pertence a um registro que carrega um deles",
  ru: "Блокировка с метками на разрешение на создание отклоняет новую запись, которая несёт одну из этих меток или, если у неё нет собственных меток, относится к записи, несущей одну из них",
  sv: "En blockering med etiketter på en behörighet att skapa avvisar en ny post som bär någon av dess etiketter eller, för en post utan egna etiketter, hör till en post som bär någon av dem",
  "zh-CN":
    "对创建权限的带标签阻止，会拒绝带有其中某个标签的新记录；对于自身没有标签的记录，则拒绝所属记录带有其中某个标签的新记录",
  "zh-TW":
    "對建立權限的帶標籤封鎖，會拒絕帶有其中某個標籤的新記錄；對於本身沒有標籤的記錄，則拒絕所屬記錄帶有其中某個標籤的新記錄",
};

// Step 7: a change follows the parent rule, and the records a write lists.
const CHANGE_RULE: Record<string, string> = {
  en: "A change keeps to the same rule: a record moved under another one, such as an announcement put on another status page, goes only under one you may read, and what it is under already stays as it is. The records a create or a change lists, such as the monitors of an incident or the services of an alert, keep to your permission to read them when you have one, and to a block with labels on reading them either way: one outside them is refused as if it did not exist, while one the record lists already stays.",
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
  en: "A record moved under another one, or given more records in a list",
  da: "En post, der flyttes under en anden eller får flere poster i en liste, får kun poster, som den, der ændrer den, må læse, og en tilladelse til at oprette begrænset til labels eller til omfanget Ejede gælder også den post, den opretter",
  de: 'Ein Datensatz, der unter einen anderen verschoben wird oder weitere Datensätze in einer Liste bekommt, bekommt nur Datensätze, die sein Bearbeiter lesen darf, und eine auf Labels oder auf „Eigene" beschränkte Berechtigung zum Anlegen gilt auch für den Datensatz, den sie anlegt',
  es: "Un registro que se mueve bajo otro, o que recibe más registros en una lista, solo recibe registros que quien lo cambia puede leer, y un permiso para crear restringido a etiquetas o al alcance Propios rige también el registro que crea",
  fa: "رکوردی که زیر رکورد دیگری برده می‌شود یا رکوردهای بیشتری در یک فهرست می‌گیرد، فقط رکوردهایی می‌گیرد که ویرایشگرش اجازهٔ خواندنشان را دارد، و مجوز ساختنی که به برچسب‌ها یا دامنه Owned محدود است، رکوردی را که می‌سازد هم در بر می‌گیرد",
  fr: "Un enregistrement déplacé sous un autre, ou à qui l'on ajoute des enregistrements dans une liste, ne reçoit que des enregistrements que son auteur peut lire, et une autorisation de créer restreinte à des étiquettes ou à la portée Possédées vaut aussi pour l'enregistrement qu'elle crée",
  hi: "किसी दूसरे रिकॉर्ड के अंतर्गत ले जाया गया या किसी सूची में और रिकॉर्ड पाने वाला रिकॉर्ड केवल वही रिकॉर्ड पाता है जिन्हें उसे बदलने वाला पढ़ सकता है, और लेबलों या स्वामित्व दायरे तक सीमित बनाने की अनुमति उस रिकॉर्ड पर भी लागू होती है जिसे वह बनाती है",
  it: "Un record spostato sotto un altro, o a cui si aggiungono record in un elenco, riceve solo record che chi lo modifica può leggere, e un'autorizzazione a creare limitata a etichette o all'ambito Possedute vale anche per il record che crea",
  ja: "別のレコードの下に移したり一覧にレコードを追加したりするときは、変更する人が読み取れるレコードだけが対象になり、ラベルや所有スコープに限定した作成権限は作成するレコードにも適用されます",
  ko: "다른 레코드 아래로 옮기거나 목록에 레코드를 더할 때는 변경하는 사람이 읽을 수 있는 레코드만 대상이 되며, 라벨이나 소유 범위로 제한된 만들기 권한은 만드는 레코드에도 적용됩니다",
  nl: "Een record dat onder een ander wordt verplaatst of meer records in een lijst krijgt, krijgt alleen records die de bewerker mag lezen, en een tot labels of tot het bereik Eigen beperkte toestemming om aan te maken geldt ook voor het record dat ze aanmaakt",
  no: "En post som flyttes under en annen eller får flere poster i en liste, får bare poster den som endrer den, har lov til å lese, og en tillatelse til å opprette begrenset til etiketter eller til omfanget Eide gjelder også posten den oppretter",
  pt: "Um registro movido para baixo de outro, ou que recebe mais registros em uma lista, só recebe registros que quem o altera pode ler, e uma permissão para criar restrita a rótulos ou ao escopo Próprios vale também para o registro que cria",
  ru: "Запись, которую перемещают под другую или которой добавляют записи в список, получает только записи, которые может читать тот, кто её изменяет, а разрешение на создание, ограниченное метками или областью «Свои», распространяется и на создаваемую запись",
  sv: "En post som flyttas under en annan eller får fler poster i en lista får bara poster som den som ändrar den får läsa, och en behörighet att skapa som är begränsad till etiketter eller till omfattningen Ägda gäller också posten den skapar",
  "zh-CN":
    '把记录移到另一条记录之下或向列表中添加记录时，只能使用修改者能读取的记录；限定到标签或"拥有"范围的创建权限也约束它所创建的记录',
  "zh-TW":
    "把記錄移到另一筆記錄之下或在清單中新增記錄時，只能使用修改者能讀取的記錄；限定到標籤或「擁有」範圍的建立權限也約束它所建立的記錄",
};

/*
 * The upgrade line's last words: the picks of a create form are added for
 * their creator past their own read of the new record only, and a pick their
 * permission to add does not reach refuses the create.
 */
const PICKS_ON_CREATE: Record<string, string> = {
  en: "  even when the creator's own read does not reach the new record. A pick",
  da: "også når vedkommendes egen læseadgang ikke når den nye post; et valg, som vedkommendes tilladelse til at tilføje det ikke når, afviser oprettelsen.",
  de: "auch wenn seine eigene Leseberechtigung den neuen Datensatz nicht erreicht; eine Auswahl, die seine Berechtigung zum Hinzufügen nicht erreicht, lehnt das Anlegen ab.",
  es: "aunque su propio permiso de lectura no alcance el registro nuevo; una elección que su permiso para añadirla no alcanza rechaza la creación.",
  fa: "حتی اگر مجوز خواندن خود او به رکورد تازه نرسد؛ انتخابی که مجوز افزودنش به آن نمی‌رسد، ساختن را رد می‌کند.",
  fr: "même quand sa propre autorisation de lecture n'atteint pas le nouvel enregistrement ; un choix que son autorisation d'ajouter n'atteint pas fait refuser la création.",
  hi: "भले ही उसकी अपनी पढ़ने की अनुमति नए रिकॉर्ड तक न पहुँचे; जिस चुनाव तक उसकी जोड़ने की अनुमति नहीं पहुँचती, वह बनाना अस्वीकार करा देता है।",
  it: "anche quando la sua autorizzazione a leggere non raggiunge il nuovo record; una scelta che la sua autorizzazione ad aggiungerla non raggiunge fa rifiutare la creazione.",
  ja: "作成者自身の読み取り権限が新しいレコードに届かなくても、作成者のために追加されます。追加する権限が届かない選択があると、作成は拒否されます。",
  ko: "만든 사람 자신의 읽기 권한이 새 레코드에 닿지 않아도 만든 사람을 위해 추가되며, 추가할 권한이 닿지 않는 선택이 있으면 만들기가 거부됩니다.",
  nl: "ook als diens eigen leestoestemming het nieuwe record niet bereikt; een keuze die diens toestemming om haar toe te voegen niet bereikt, weigert de aanmaak.",
  no: "også når egen lesetillatelse ikke når den nye posten; et valg som tillatelsen til å legge det til ikke når, avviser opprettingen.",
  pt: "mesmo quando a sua própria permissão de leitura não alcança o registro novo; uma escolha que a sua permissão para adicioná-la não alcança recusa a criação.",
  ru: "даже если его собственное разрешение на чтение не достаёт до новой записи; выбор, до которого не достаёт его разрешение на добавление, отклоняет создание.",
  sv: "även när dennes egen läsbehörighet inte når den nya posten; ett val som dennes behörighet att lägga till det inte når avvisar skapandet.",
  "zh-CN":
    "即使创建者自己的读取权限不及新记录；创建者添加权限不及的选择会使创建被拒绝。",
  "zh-TW":
    "即使建立者自己的讀取權限不及新記錄；建立者新增權限不及的選擇會使建立被拒絕。",
};

// What step 7 already said about a create under a record you may read.
const CREATE_UNDER_A_READABLE_RECORD: Record<string, string> = {
  en: "Such a record is also created only under one you may read",
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

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Docs: a record's parents and listed records on a change, and a create's scope", () => {
  const english: string = permissionsPage("en");

  test("every docs language is checked, each with its own words", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const words of [
      CREATE_SCOPE,
      CREATE_BLOCK,
      CHANGE_RULE,
      UPGRADE_HEADING,
      PICKS_ON_CREATE,
    ]) {
      expect(Object.keys(words).sort()).toEqual([...LANGUAGES].sort());
    }
  });

  test("English step 5 says a create is scoped like a read, and what Owned creates", () => {
    const step: string = stepOf(english, 5);

    expect(step).toContain(CREATE_SCOPE["en"]!);
    expect(step).toContain(
      "A permission to create scoped to Owned creates a resource with owners of its own, such as a monitor or a status page, only for a person, who becomes its owner, and a note only on an incident you or one of your teams own.",
    );
  });

  test("English step 6 says a block with labels on a create keeps out a record carrying them", () => {
    expect(stepOf(english, 6)).toContain(CREATE_BLOCK["en"]!);
  });

  test("English step 7 says a change follows the parent rule, and the records a write lists follow the read", () => {
    const step: string = stepOf(english, 7);

    expect(step).toContain(CHANGE_RULE["en"]!);
  });

  test.each(LANGUAGES)(
    "%s says it in steps 5, 6 and 7, translated, each step one line",
    (language: string) => {
      const page: string = permissionsPage(language);
      const five: string = stepOf(page, 5);
      const six: string = stepOf(page, 6);
      const seven: string = stepOf(page, 7);

      expect([language, five.includes(CREATE_SCOPE[language]!)]).toEqual([
        language,
        true,
      ]);
      expect([language, six.includes(CREATE_BLOCK[language]!)]).toEqual([
        language,
        true,
      ]);
      expect([language, seven.includes(CHANGE_RULE[language]!)]).toEqual([
        language,
        true,
      ]);

      // Said once each, on the page.
      for (const words of [CREATE_SCOPE, CREATE_BLOCK, CHANGE_RULE]) {
        expect([language, countOf(page, words[language]!)]).toEqual([
          language,
          1,
        ]);
      }

      // Right after a create under a record you may read, before the reads by ID.
      const created: number = seven.indexOf(
        CREATE_UNDER_A_READABLE_RECORD[language]!,
      );
      const change: number = seven.indexOf(CHANGE_RULE[language]!);

      expect([language, created >= 0 && created < change]).toEqual([
        language,
        true,
      ]);
      expect([language, seven.lastIndexOf("`404`") > change]).toEqual([
        language,
        true,
      ]);

      // Step 7 answers no status code of its own for these: it keeps two.
      expect([language, countOf(seven, "`404`")]).toEqual([language, 2]);
      expect([language, stepOf(page, 8)]).toEqual([language, ""]);

      if (language !== "en") {
        for (const words of [CREATE_SCOPE, CREATE_BLOCK, CHANGE_RULE]) {
          expect([language, page.includes(words["en"]!)]).toEqual([
            language,
            false,
          ]);
        }
      }
    },
  );

  test("the API reference says what a change, a list and a create's scope answer", () => {
    const page: string = read("en", "api-reference/api-reference.md");
    const section: string = page.slice(
      page.indexOf("### Records a request names"),
      page.indexOf("### Switches"),
    );

    for (const sentence of [
      "A change that moves such a record follows the same rule: each record it adds as a parent",
      "The parents a record has already are not checked again",
      "The records a create or a change lists - an incident's monitors and on-call policies, an alert's services",
      "A change checks only the records it adds to a list, so the ones the list holds already stay.",
      "A permission to create restricted to labels creates only records carrying one of its labels",
      "A create outside them is refused with a `422` that names the labels:",
      "Your access lets you create Status Pages only with one of these labels: Production. Add one of them and try again.",
      "A permission to create scoped to **Owned** creates a monitor, a status page or another record with owners of its own only for a person",
    ]) {
      expect([sentence, section.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test("the English upgrade notes say what changes, beside a create under a record you may read", () => {
    const page: string = read("en", "installation/upgrading.md");

    for (const sentence of [
      "- **A record moved under another one, or given more records in a list,",
      "  or the change is refused with the `400` that names the field and the ID,",
      "  is refused with a `422` that names the labels. A create permission scoped",
      "  rule picked when creating an on-call policy, are added for their creator",
      PICKS_ON_CREATE["en"]!,
      "  record does not carry, for one - refuses the create, and nothing is",
      "  [Records a request names](/docs/api-reference/api-reference#records-a-request-names)",
    ]) {
      expect([sentence, page.includes(sentence)]).toEqual([sentence, true]);
    }

    // Past nothing but the creator's read of the new record.
    expect(page).not.toContain(
      "even when the new record is outside what the creator's own permissions",
    );

    const created: number = page.indexOf(
      "- **A record read through another one is created only under a record its",
    );
    const moved: number = page.indexOf(
      "- **A record moved under another one, or given more records in a list,",
    );
    const readById: number = page.indexOf(
      "- **Every grant and scope narrows what it reaches, and a read by ID of a",
    );

    expect(created).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(created);
    expect(readById).toBeGreaterThan(moved);
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "the %s upgrade guide has the line, between a create under a readable record and the reads by ID",
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
      const moved: Array<number> = lines
        .map((line: string, index: number): number => {
          return line.startsWith("- **") &&
            line.includes(UPGRADE_HEADING[language]!)
            ? index
            : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect([language, moved.length]).toEqual([language, 1]);

      // Before it, a create under a record you may read; after it, the reads by ID.
      expect([
        language,
        lines[moved[0]! - 1]!.includes("`CreateIncidentInternalNote`"),
      ]).toEqual([language, true]);
      expect([language, moved[0]! + 2]).toEqual([language, anchor]);
      expect([language, lines[moved[0]!]!.includes("`422`")]).toEqual([
        language,
        true,
      ]);

      // It ends with the picks of a create form, which it may refuse.
      expect([
        language,
        lines[moved[0]!]!.endsWith(PICKS_ON_CREATE[language]!),
      ]).toEqual([language, true]);
    },
  );
});
