import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import ColumnPermissions from "Common/Server/Types/Database/Permissions/ColumnPermission";
import CreateScopeException from "Common/Server/Types/Database/Permissions/CreateScopeException";
import CreateScopePermission from "Common/Server/Types/Database/Permissions/CreateScopePermission";
import OwnedScopePermission from "Common/Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "Common/Server/Types/Database/Permissions/OwnerTableRegistry";
import WorkflowPrincipal from "Common/Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import Dictionary from "Common/Types/Dictionary";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ADDING AND REMOVING OWNERS KEEPS TO THE OWNED SCOPE.
 *
 * An owner row is owned through its resource
 * (OwnedScopePermission.getOwnedThrough): a permission to add and remove
 * owners scoped to Owned does so only on the resources its people or their
 * teams own, however many more they may read. Users, Teams & Permissions
 * says so where it says who owns a resource is read through the resource
 * (the Owners section's closing paragraph), the API reference where it says
 * how owner records answer, and the upgrade guide says what changes - in
 * every docs language. What they claim is held to the product here too.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

// An owner table, by its name: MonitorOwnerUser, MonitorOwnerTeam.
const OWNER_TABLE_NAME: RegExp = /Owner(User|Team)$/;

// Line breaks and runs of spaces, read as one space.
const WHITESPACE: RegExp = /\s+/g;

// What the Owners section's closing paragraph says now, in its own words.
const OWNERS_SCOPE: Record<string, string> = {
  en: "Adding and removing owners keeps to the scope of the permission that does it, too: scoped to `Owned`, it reaches only the resources you or one of your teams already own, however many more you may read, so reading a monitor does not let you make yourself its owner. An owner is added or removed, never moved to another resource.",
  da: "Tilføjelse og fjernelse af ejere holder sig også til omfanget af den tilladelse, der giver lov til det: med omfanget `Owned` når den kun de ressourcer, som du eller et af dine teams allerede ejer,",
  de: "Auch das Hinzufügen und Entfernen von Eigentümern hält sich an den Geltungsbereich der Berechtigung, die es erlaubt: Mit Geltungsbereich `Owned` erreicht sie nur die Ressourcen, die Ihnen oder einem Ihrer Teams bereits gehören,",
  es: "Añadir y eliminar propietarios también se ajusta al alcance del permiso que lo permite: con el alcance `Owned`, solo llega a los recursos de los que usted o uno de sus equipos ya son propietarios,",
  fa: "افزودن و حذف مالکان هم تابع دامنه دسترسی‌ای است که آن را مجاز می‌کند: با دامنه `Owned` فقط به منابعی می‌رسد",
  fr: "L'ajout et le retrait de propriétaires suivent aussi la portée de l'autorisation qui les permet : avec la portée `Owned`, elle n'atteint que les ressources dont vous ou l'une de vos équipes êtes déjà propriétaires,",
  hi: "स्वामियों को जोड़ना और हटाना भी उस अनुमति के दायरे में रहता है जो इसकी अनुमति देती है: `Owned` दायरे वाली अनुमति केवल उन्हीं संसाधनों तक पहुँचती है",
  it: "Anche l'aggiunta e la rimozione dei proprietari seguono l'ambito dell'autorizzazione che le consente: con l'ambito `Owned` raggiunge solo le risorse di cui voi o uno dei vostri team siete già proprietari,",
  ja: "オーナーの追加と削除も、それを許可する権限のスコープに従います。`Owned` スコープの権限が届くのは、",
  ko: "소유자를 추가하고 제거하는 것도 그것을 허용하는 권한의 범위를 따릅니다. `Owned` 범위의 권한은",
  nl: "Ook het toevoegen en verwijderen van eigenaren houdt zich aan het bereik van de machtiging die het toestaat: met het bereik `Owned` bereikt die alleen de resources waarvan u of een van uw teams al eigenaar is,",
  no: "Å legge til og fjerne eiere holder seg også til omfanget av tillatelsen som gir lov til det: med omfanget `Owned` når den bare ressursene som du eller et av teamene dine allerede eier,",
  pt: "Adicionar e remover proprietários também segue o escopo da permissão que o permite: com o escopo `Owned`, ela só alcança os recursos dos quais você ou uma das suas equipes já são proprietários,",
  ru: "Добавление и удаление владельцев тоже подчиняется области разрешения, которое это позволяет: с областью `Owned` оно достигает только тех ресурсов, которыми вы или одна из ваших команд уже владеете,",
  sv: "Att lägga till och ta bort ägare håller sig också till omfattningen av den behörighet som tillåter det: med omfattningen `Owned` når den bara de resurser som du eller något av dina team redan äger,",
  "zh-CN":
    "添加和移除所有者同样遵循允许此操作的权限的范围：`Owned` 范围的权限只触及你或你的某个团队已经拥有的资源，",
  "zh-TW":
    "新增和移除擁有者同樣遵循允許此操作的權限的範圍：`Owned` 範圍的權限只觸及你或你的某個團隊已經擁有的資源，",
};

// How the paragraph opens: who owns a resource is read through the resource.
const OWNERS_OPENING: Record<string, string> = {
  en: "Who owns a resource is read through the resource.",
  da: "Hvem der ejer en ressource, læses gennem ressourcen.",
  de: "Wer eine Ressource besitzt, wird über die Ressource gelesen.",
  es: "Quién es propietario de un recurso se lee a través del recurso.",
  fa: "اینکه چه کسی مالک یک منبع است از طریق خودِ آن منبع خوانده می‌شود.",
  fr: "Les propriétaires d'une ressource se lisent à travers la ressource.",
  hi: "किसी संसाधन का स्वामी कौन है, यह उसी संसाधन के माध्यम से पढ़ा जाता है।",
  it: "Chi possiede una risorsa si legge attraverso la risorsa.",
  ja: "リソースのオーナーは、そのリソースを通じて読み取られます。",
  ko: "리소스의 소유자는 그 리소스를 통해 읽습니다.",
  nl: "Wie eigenaar is van een resource, wordt gelezen via die resource.",
  no: "Hvem som eier en ressurs, leses gjennom ressursen.",
  pt: "Quem é proprietário de um recurso é lido por meio do recurso.",
  ru: "Владельцы ресурса читаются через сам ресурс.",
  sv: "Vem som äger en resurs läses genom resursen.",
  "zh-CN": "资源的所有者通过该资源来读取。",
  "zh-TW": "資源的擁有者透過該資源來讀取。",
};

// What the API reference's Owners paragraph says now, in its own words.
const API_REFERENCE_SCOPE: Record<string, string> = {
  en: "Adding and removing them keeps to the scope of the permission that does it, too: one scoped to `Owned` reaches only the owners of resources you or one of your teams own, and adding an owner to any other resource is refused with a `422` that says so.",
  da: "At tilføje og fjerne dem holder sig også til omfanget af den tilladelse, der giver lov til det: en med omfanget `Owned`",
  de: "Auch das Hinzufügen und Entfernen hält sich an den Geltungsbereich der Berechtigung, die es erlaubt: Eine mit Geltungsbereich `Owned`",
  es: "Añadirlos y quitarlos también se ajusta al alcance del permiso que lo permite: uno con el alcance `Owned`",
  fa: "افزودن و برداشتن آن‌ها هم تابع دامنه مجوزی است که اجازه‌اش را می‌دهد: مجوزی با دامنه `Owned`",
  fr: "Les ajouter et les retirer suit aussi la portée de l'autorisation qui le permet : une autorisation de portée `Owned`",
  hi: "उन्हें जोड़ना और हटाना भी उस अनुमति के दायरे में रहता है जो इसकी अनुमति देती है: `Owned` दायरे वाली अनुमति",
  it: "Anche aggiungerli e rimuoverli segue l'ambito dell'autorizzazione che lo consente: una con l'ambito `Owned`",
  ja: "それらの追加と削除も、それを許可する権限のスコープに従います。`Owned` スコープの権限が届くのは、",
  ko: "소유자를 추가하고 제거하는 것도 그것을 허용하는 권한의 범위를 따릅니다. `Owned` 범위의 권한은",
  nl: "Ook het toevoegen en verwijderen ervan houdt zich aan het bereik van de machtiging die het toestaat: een met het bereik `Owned`",
  no: "Å legge dem til og fjerne dem holder seg også til omfanget av tillatelsen som gir lov til det: en med omfanget `Owned`",
  pt: "Adicioná-los e removê-los também segue o escopo da permissão que o permite: uma com o escopo `Owned`",
  ru: "Добавление и удаление тоже подчиняются области разрешения, которое это позволяет: разрешение с областью `Owned`",
  sv: "Att lägga till och ta bort dem håller sig också till omfattningen av den behörighet som tillåter det: en med omfattningen `Owned`",
  "zh-CN":
    "添加和移除它们同样遵循允许此操作的权限的范围：`Owned` 范围的权限只触及",
  "zh-TW":
    "新增和移除它們同樣遵循允許此操作的權限的範圍：`Owned` 範圍的權限只觸及",
};

// The upgrade note's bold lead.
const UPGRADE_LEAD: Record<string, string> = {
  en: "Adding and removing owners keeps to the `Owned` scope.",
  da: "Tilføjelse og fjernelse af ejere holder sig til omfanget `Owned`.",
  de: "Das Hinzufügen und Entfernen von Eigentümern hält sich an den Geltungsbereich `Owned`.",
  es: "Añadir y eliminar propietarios se ajusta al alcance `Owned`.",
  fa: "افزودن و حذف مالکان تابع دامنه `Owned` است.",
  fr: "L'ajout et le retrait de propriétaires suivent la portée `Owned`.",
  hi: "स्वामियों को जोड़ना और हटाना `Owned` दायरे में रहता है।",
  it: "L'aggiunta e la rimozione dei proprietari seguono l'ambito `Owned`.",
  ja: "オーナーの追加と削除は `Owned` スコープに従います。",
  ko: "소유자 추가와 제거는 `Owned` 범위를 따릅니다.",
  nl: "Eigenaren toevoegen en verwijderen houdt zich aan het bereik `Owned`.",
  no: "Å legge til og fjerne eiere holder seg til omfanget `Owned`.",
  pt: "Adicionar e remover proprietários segue o escopo `Owned`.",
  ru: "Добавление и удаление владельцев подчиняется области `Owned`.",
  sv: "Att lägga till och ta bort ägare håller sig till omfattningen `Owned`.",
  "zh-CN": "添加和移除所有者遵循 `Owned` 范围。",
  "zh-TW": "新增和移除擁有者遵循 `Owned` 範圍。",
};

// The upgrade note the new one follows: who owns a resource is read through it.
const PREVIOUS_NOTE_LEAD: string =
  "Who owns a resource, and a setting that holds credentials, are named";

// The inline code the upgrade note names, in every language.
const UPGRADE_CODE: Array<string> = [
  "`Owned`",
  "`MonitorAdmin`",
  "`MonitorMember`",
  "`ProjectMember`",
];

function read(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// The paragraphs of the section under a heading, up to the next heading.
function paragraphsUnder(markdown: string, heading: number): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const end: number = lines.findIndex((line: string, at: number): boolean => {
    return at > heading && line.startsWith("#");
  });

  return lines
    .slice(heading + 1, end < 0 ? lines.length : end)
    .join("\n")
    .split("\n\n")
    .map((paragraph: string): string => {
      return paragraph.trim();
    })
    .filter((paragraph: string): boolean => {
      return paragraph.length > 0;
    });
}

// The line of the English page's heading, which every translation shares.
function englishHeadingLine(page: string, heading: string): number {
  const line: number = read("en", page)
    .split("\n")
    .findIndex((each: string): boolean => {
      return each === heading;
    });

  expect([page, heading, line >= 0]).toEqual([page, heading, true]);

  return line;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Docs: adding and removing owners keeps to the Owned scope", () => {
  test("every docs language is checked, each in its own words", () => {
    expect(LANGUAGES).toHaveLength(17);

    for (const words of [
      OWNERS_SCOPE,
      OWNERS_OPENING,
      API_REFERENCE_SCOPE,
      UPGRADE_LEAD,
    ]) {
      expect(Object.keys(words).sort()).toEqual([...LANGUAGES].sort());
    }
  });

  test.each(LANGUAGES)(
    "%s: Users, Teams & Permissions closes the Owners section saying so, after who owns a resource is read through it",
    (language: string) => {
      const page: string = read(language, "permissions/index.md");
      const owners: Array<string> = paragraphsUnder(
        page,
        englishHeadingLine("permissions/index.md", "## Owners"),
      );
      const closing: string = owners[owners.length - 1]!;

      expect([language, closing.startsWith(OWNERS_OPENING[language]!)]).toEqual(
        [language, true],
      );
      expect([
        language,
        closing.indexOf(OWNERS_SCOPE[language]!) >
          OWNERS_OPENING[language]!.length,
      ]).toEqual([language, true]);
      expect([language, countOf(page, OWNERS_SCOPE[language]!)]).toEqual([
        language,
        1,
      ]);
      expect([language, countOf(closing, "`Owned`")]).toEqual([language, 1]);

      if (language !== "en") {
        expect([language, page.includes(OWNERS_SCOPE["en"]!)]).toEqual([
          language,
          false,
        ]);
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the API reference says how adding an owner answers, in its Owners paragraph",
    (language: string) => {
      const page: string = read(language, "api-reference/api-reference.md");
      const owners: Array<string> = paragraphsUnder(
        page,
        englishHeadingLine("api-reference/api-reference.md", "#### Owners"),
      );

      expect([language, owners.length]).toEqual([language, 1]);

      const paragraph: string = owners[0]!;

      expect([
        language,
        paragraph.includes(API_REFERENCE_SCOPE[language]!),
      ]).toEqual([language, true]);

      for (const code of ["`Owned`", "`422`"]) {
        expect([language, code, countOf(paragraph, code)]).toEqual([
          language,
          code,
          1,
        ]);
      }
    },
  );

  test("in English the upgrade note says what changes, after the note on who owns a resource", () => {
    const items: Array<string> = otherChangesItems("en");
    const note: string = otherChangesItemAtEnglishPlace(
      "en",
      UPGRADE_LEAD["en"]!,
    );
    const previous: string = otherChangesItemAtEnglishPlace(
      "en",
      PREVIOUS_NOTE_LEAD,
    );

    expect(items.indexOf(note)).toBe(items.indexOf(previous) + 1);

    const flat: string = note.replace(WHITESPACE, " ");

    for (const sentence of [
      "A permission to add and remove a resource's owners - such as `MonitorAdmin`, `MonitorMember` or `ProjectMember`, given to a team directly or through a custom role - that is scoped to `Owned` now adds and removes them only on the resources its people or their teams own, however many more they may read.",
      "It used to reach the owners of every resource they could read.",
      "Owners are still read through the resource, and permissions over the whole project, API keys and workflow steps add and remove any owner.",
      "Give someone who manages the owners of resources they do not own that permission over the whole project, or restricted to labels.",
      "See [Users, Teams & Permissions](/docs/permissions/index).",
    ]) {
      expect([sentence, flat.includes(sentence)]).toEqual([sentence, true]);
    }
  });

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "the %s upgrade guide has the note in the English note's place, under its own lead",
    (language: string) => {
      const items: Array<string> = otherChangesItems(language);
      const note: string = otherChangesItemAtEnglishPlace(
        language,
        UPGRADE_LEAD["en"]!,
      );
      const previous: string = otherChangesItemAtEnglishPlace(
        language,
        PREVIOUS_NOTE_LEAD,
      );

      expect([language, items.indexOf(note)]).toEqual([
        language,
        items.indexOf(previous) + 1,
      ]);
      expect([
        language,
        note.startsWith(`- **${UPGRADE_LEAD[language]!}** `),
      ]).toEqual([language, true]);
      expect([language, note.includes(UPGRADE_LEAD["en"]!)]).toEqual([
        language,
        false,
      ]);

      // The same code, as often as the English note names it.
      const english: string = otherChangesItemAtEnglishPlace(
        "en",
        UPGRADE_LEAD["en"]!,
      );

      for (const code of UPGRADE_CODE) {
        expect([language, code, countOf(note, code)]).toEqual([
          language,
          code,
          countOf(english, code),
        ]);
      }

      expect([language, note.includes("](/docs/permissions/index)")]).toEqual([
        language,
        true,
      ]);
    },
  );
});

/*
 * What the pages claim, held to the product: the owners of every kind the
 * Owned scope narrows are owned through their resource; an owner added to a
 * resource the member does not own is refused with a 422 saying so; an
 * owner is never moved; grants no scope narrows - a workflow step's Project
 * Admin among them - add and remove any owner; and the roles the upgrade
 * note names add and remove a monitor's owners.
 */
describe("what the docs say holds in the product", () => {
  type ModelType = { new (): BaseModel };

  const PROJECT_ID: ObjectID = new ObjectID(
    "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  );
  const OWNED_ID: string = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
  const OTHER_ID: string = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";

  // A member whose team holds Monitor Admin scoped to Owned beside Monitor Viewer.
  const member: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: [ObjectID.generate()],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.MonitorAdmin,
            labelIds: [],
            isBlockPermission: false,
            scope: PermissionScope.Owned,
          },
          {
            _type: "UserPermission",
            permission: Permission.MonitorViewer,
            labelIds: [],
            isBlockPermission: false,
            scope: PermissionScope.All,
          },
        ],
      },
    },
  } as DatabaseCommonInteractionProps;

  const ownerOn: (resourceId: string) => MonitorOwnerUser = (
    resourceId: string,
  ): MonitorOwnerUser => {
    const owner: MonitorOwnerUser = new MonitorOwnerUser();
    owner.projectId = PROJECT_ID;
    owner.monitorId = new ObjectID(resourceId);
    owner.userId = member.userId!;
    return owner;
  };

  const checkOn: (resourceId: string) => Promise<void> = async (
    resourceId: string,
  ): Promise<void> => {
    await CreateScopePermission.checkCreateScope({
      modelType: MonitorOwnerUser,
      data: ownerOn(resourceId),
      props: member,
      findRecordLabels: async (): Promise<Dictionary<Array<string>>> => {
        return {};
      },
      findLabelNames: async (): Promise<Array<string>> => {
        return [];
      },
    });
  };

  test("the owners of every kind the Owned scope narrows are owned through their resource", () => {
    expect(OwnerTableRegistry.size).toBeGreaterThanOrEqual(27);

    for (const [kind, pair] of OwnerTableRegistry.entries() as Iterable<
      [string, OwnerTablePair]
    >) {
      for (const service of [pair.ownerUserService, pair.ownerTeamService]) {
        const resource: ModelType | undefined =
          OwnedScopePermission.getOwnedThrough(service.modelType)
            ?.parentModels[0] as ModelType | undefined;

        expect([service.modelType.name, resource?.name]).toEqual([
          service.modelType.name,
          kind,
        ]);
      }
    }
  });

  test("an owner added to a monitor the member does not own is refused with a 422 that says so; one they own is not", async () => {
    jest
      .spyOn(OwnedScopePermission, "getOwnedIds")
      .mockResolvedValue([new ObjectID(OWNED_ID)]);

    await expect(checkOn(OWNED_ID)).resolves.toBeUndefined();

    let refusal: unknown = undefined;

    try {
      await checkOn(OTHER_ID);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect((refusal as CreateScopeException).code).toBe(
      ExceptionCode.NotAuthorizedException,
    );
    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    expect((refusal as Error).message).toBe(
      "Your access lets you add owners only to the Monitors you or your teams own.",
    );
  });

  test("an owner is added or removed, never moved: no column of an owner table can be changed", () => {
    const excluded: Array<string> = ColumnPermissions.getExcludedColumnNames();

    const ownerTables: Array<ModelType> = (
      AllModelTypes as Array<ModelType>
    ).filter((modelType: ModelType): boolean => {
      return OWNER_TABLE_NAME.test(new modelType().tableName || "");
    });

    expect(ownerTables.length).toBeGreaterThanOrEqual(74);

    for (const modelType of ownerTables) {
      const model: BaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        if (excluded.includes(column)) {
          continue;
        }

        expect([
          modelType.name,
          column,
          model.getColumnAccessControlFor(column)?.update || [],
        ]).toEqual([modelType.name, column, []]);
      }
    }
  });

  test("a workflow step acts as a Project Admin, which no scope narrows", () => {
    expect(WorkflowPrincipal.PERMISSION).toBe(Permission.ProjectAdmin);
    expect(
      PermissionHelper.isScopeApplicable(WorkflowPrincipal.PERMISSION),
    ).toBe(false);
  });

  test("the roles the upgrade note names add and remove a monitor's owners", () => {
    for (const modelType of [
      MonitorOwnerUser,
      MonitorOwnerTeam,
    ] as Array<ModelType>) {
      const model: BaseModel = new modelType();

      for (const role of [
        Permission.MonitorAdmin,
        Permission.MonitorMember,
        Permission.ProjectMember,
      ]) {
        expect([
          modelType.name,
          role,
          model.createRecordPermissions.includes(role) &&
            model.deleteRecordPermissions.includes(role),
          PermissionHelper.isScopeApplicable(role),
        ]).toEqual([modelType.name, role, true, true]);
      }
    }
  });
});
