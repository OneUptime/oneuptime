import { afterAll, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import i18next from "i18next";

/*
 * A LOCK'S NAMES ARE VALUES SET APART, IN EVERY LIST AND EVERY TOOLTIP.
 *
 * A lock says what would allow what it refuses: "You need this permission:
 * Read Runbook Execution." In Persian that sentence reads right to left
 * around the permission's title, which stays English (the permission
 * picker keeps titles in English). The title was placed into the sentence
 * as plain text, so it did not read as the value it is, and a title ending
 * in a bracket or a digit could move. Every lock sentence (PermissionGate:
 * the first sentence, what would allow it, a team's block, the no-access
 * state of every list) now sets its values apart in an isolate (FSI ...
 * PDI), as a drawn sentence's values are. A Persian name (a built-in role,
 * looked up) reads with the sentence, without a mark, and an English or
 * German sentence is the one it always was.
 */

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import PermissionGate, {
  ModelAction,
  NEEDS_ONE_OF_PERMISSIONS_TEMPLATE,
  NEEDS_ONE_OF_ROLES_TEMPLATE,
  NEEDS_PERMISSION_TEMPLATE,
} from "../../../UI/Utils/PermissionGate";
import { buildNoAccessState } from "../../../UI/Components/ModelTable/ModelTableEmptyState";
import { TableEmptyStateProps } from "../../../UI/Components/Table/TableEmptyState";
import { createTranslator, Translator } from "../../../Types/Translator";
import Permission from "../../../Types/Permission";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

type Locale = Record<string, string>;

const LOCALES: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (code: string) => Locale = (code: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf-8"),
  ) as Locale;
};

const PERSIAN: Locale = readLocale("fa");
const GERMAN: Locale = readLocale("de");

const translatorOf: (locale: Locale, language: string) => Translator = (
  locale: Locale,
  language: string,
): Translator => {
  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
};

const persian: Translator = translatorOf(PERSIAN, "fa");
const german: Translator = translatorOf(GERMAN, "de");

// The Persian sentence of a template, its one placeholder filled with `value`.
const persianSentence: (
  template: string,
  placeholder: string,
  value: string,
) => string = (
  template: string,
  placeholder: string,
  value: string,
): string => {
  return (PERSIAN[template] as string).replace(placeholder, value);
};

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("what would allow it, in Persian", () => {
  test("a permission's English title is set apart from the sentence", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new IncidentOwnerTeam().getCreatePermissions(),
        persian,
      ),
    ).toBe(
      persianSentence(
        NEEDS_PERMISSION_TEMPLATE,
        "{{permission}}",
        isolated("Create Incident Team Owner"),
      ),
    );
  });

  test("English titles listed are one value, set apart, their English comma kept", () => {
    const sentence: string = PermissionGate.getNeededPermissionsSentence(
      new Project().getUpdatePermissions(),
      persian,
    );

    expect(sentence).toBe(
      persianSentence(
        NEEDS_ONE_OF_PERMISSIONS_TEMPLATE,
        "{{permissions}}",
        isolated("Manage Billing, Edit Project"),
      ),
    );
    // Without its marks, the sentence the reader always read.
    expect(withoutIsolateMarks(sentence)).toBe(
      persianSentence(
        NEEDS_ONE_OF_PERMISSIONS_TEMPLATE,
        "{{permissions}}",
        "Manage Billing, Edit Project",
      ),
    );
  });

  test("Persian role names read with the sentence, with no mark", () => {
    const sentence: string = PermissionGate.getNeededPermissionsSentence(
      new ExternalMcpServer().getCreatePermissions(),
      persian,
    );

    expect(sentence).toBe(withoutIsolateMarks(sentence));
    expect(sentence).toBe(
      persianSentence(
        NEEDS_ONE_OF_ROLES_TEMPLATE,
        "{{roles}}",
        [PERSIAN["Project Owner"], PERSIAN["Project Admin"]].join("، "),
      ),
    );
  });

  test("a list's no-access state carries the title set apart", () => {
    const state: TableEmptyStateProps = buildNoAccessState({
      neededPermissions: PermissionGate.getNeededPermissionsSentence(
        PermissionGate.getReadPermissionsOfItsKind(new Monitor()),
        persian,
      ),
      translate: (text: string): string => {
        return persian.translateText(text) || text;
      },
    });

    expect(String(state.description)).toContain(isolated("Read Monitor"));
  });
});

describe("what would allow it, in a language read from the left", () => {
  test("English: no mark, the sentence as it always was", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new Project().getUpdatePermissions(),
        createTranslator(undefined, "en"),
      ),
    ).toBe("You need one of these permissions: Manage Billing, Edit Project.");
  });

  test("German: no mark, the sentence as it always was", () => {
    expect(
      PermissionGate.getNeededPermissionsSentence(
        new IncidentOwnerTeam().getCreatePermissions(),
        german,
      ),
    ).toBe("Sie benötigen diese Berechtigung: Create Incident Team Owner.");
  });
});

/*
 * The first sentence and a team's block go through the page's own
 * translator (i18next), as every tooltip's do.
 */
describe("a whole refusal on a Persian page", () => {
  test("a team's block names the blocked permission set apart", async () => {
    await i18next.init({
      lng: "fa",
      resources: { fa: { translation: PERSIAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    const reason: string = PermissionGate.getRefusalReason({
      sentence: "You do not have permission to change these settings.",
      permissions: [Permission.ProjectAdmin, Permission.EditProject],
      options: {
        held: {
          allowed: [],
          allowedProjectWide: [],
          blocked: [Permission.EditProject],
          blockedForSomeLabels: [],
        },
      },
    });

    expect(reason).toContain(isolated("Edit Project"));
    expect(withoutIsolateMarks(reason)).toContain("Edit Project");
  });

  test("a model's refusal sets its permission apart, and its first sentence reads as before", async () => {
    await i18next.init({
      lng: "fa",
      resources: { fa: { translation: PERSIAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    const message: string = PermissionGate.getMissingPermissionMessage(
      new IncidentOwnerTeam(),
      ModelAction.Create,
    );

    expect(message).toContain(isolated("Create Incident Team Owner"));
    // The record's Persian name reads with its sentence, with no mark.
    expect(
      message.startsWith("مجوز ساخت این مورد (تیم مالک حادثه) را ندارید."),
    ).toBe(true);
  });

  test("a record's English name keeps its place between the sentence's brackets", async () => {
    await i18next.init({
      lng: "fa",
      resources: { fa: { translation: PERSIAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    const message: string = PermissionGate.getMissingPermissionMessage(
      new IncidentOwnerTeam(),
      ModelAction.Create,
      { singularName: "Probe Group (EU)" },
    );

    expect(
      message.startsWith(
        `مجوز ساخت این مورد (${isolated("Probe Group (EU)")}) را ندارید.`,
      ),
    ).toBe(true);
  });
});

/*
 * Every sentence PermissionGate fills is a lock's, drawn and never stored:
 * each is filled with the lock's options, so a new one cannot forget to set
 * its names apart.
 */
describe("PermissionGate.ts", () => {
  const source: string = fs.readFileSync(
    path.join(__dirname, "../../../UI/Utils/PermissionGate.ts"),
    "utf-8",
  );

  test("fills every lock sentence with LOCK_SENTENCE_OPTIONS", () => {
    const calls: Array<string> = source.split(".translateTemplate(").slice(1);

    expect(calls.length).toBeGreaterThanOrEqual(7);

    for (const call of calls) {
      // The call's own arguments: up to the parenthesis that closes it.
      let depth: number = 1;
      let end: number = 0;

      while (end < call.length && depth > 0) {
        const character: string = call.charAt(end);

        if (character === "(") {
          depth++;
        }

        if (character === ")") {
          depth--;
        }

        end++;
      }

      expect(call.slice(0, end)).toContain("LOCK_SENTENCE_OPTIONS");
    }
  });
});
