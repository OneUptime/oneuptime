import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import i18next from "i18next";

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
  PermissionCheckableModel,
} from "../../../UI/Utils/PermissionGate";
import Validation from "../../../UI/Components/Forms/Validation";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { translateUnnamedDeleteSentence } from "../../../UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import {
  getGlobalTranslator,
  translatableTerm,
  translatePlural,
  translateTemplate,
  translateText,
} from "../../../UI/Utils/TranslateTemplate";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

/*
 * Code outside React - form validation, the permission gate's tooltip, the
 * delete dialog's sentence - translates through the global i18next instance
 * the front end sets up (the Dashboard's Utils/i18n.ts). Before that, and in
 * a front end that never sets one up, every helper answers in English.
 *
 * The first block runs before the instance is set up; the second sets it up
 * in German.
 */

const GERMAN: Record<string, string> = {
  Save: "Speichern",
  "{{count}} rows": "{{count}} Zeilen",
  "{{count}} rows_one": "{{count}} Zeile",
  "Create {{itemName}}": "{{itemName}} erstellen",
  Monitor: "Monitor",
  "Status Page": "Statusseite",
  "You do not have permission to create this {{itemName}}.":
    "Sie haben keine Berechtigung, {{itemName}} zu erstellen.",
  "{{field}} cannot be less than {{minLength}} characters.":
    "{{field}} darf nicht kürzer als {{minLength}} Zeichen sein.",
  Name: "Name",
  "Are you sure you want to delete this monitor?":
    "Möchten Sie diesen Monitor wirklich löschen?",
  "Are you sure you want to delete this {{itemName}}?":
    "Möchten Sie dieses Objekt ({{itemName}}) wirklich löschen?",
};

const ROWS: { one: string; other: string } = {
  one: "{{count}} row",
  other: "{{count}} rows",
};

const model: (singularName: string) => PermissionCheckableModel = (
  singularName: string,
): PermissionCheckableModel => {
  const none: () => Array<Permission> = (): Array<Permission> => {
    return [];
  };
  const no: () => boolean = (): boolean => {
    return false;
  };

  return {
    singularName: singularName,
    hasCreatePermissions: no,
    hasReadPermissions: no,
    hasUpdatePermissions: no,
    hasDeletePermissions: no,
    getCreatePermissions: none,
    getReadPermissions: none,
    getUpdatePermissions: none,
    getDeletePermissions: none,
  };
};

const NAME_FIELD: Field<JSONObject> = {
  title: "Name",
  field: { name: true },
  fieldType: FormFieldSchemaType.Text,
  validation: { minLength: 3 },
};

describe("before i18next is set up", () => {
  test("the helpers answer in English", () => {
    expect(getGlobalTranslator().language).toBe("en");
    expect(translateText("Save")).toBe("Save");
    expect(translatePlural(ROWS, 1)).toBe("1 row");
    expect(translatePlural(ROWS, 1234)).toBe("1,234 rows");
    expect(
      translateTemplate("Create {{itemName}}", {
        itemName: translatableTerm("Status Page"),
      }),
    ).toBe("Create Status Page");
  });

  test("validation, the permission tooltip and the delete question are English", () => {
    expect(Validation.validateLength("ab", NAME_FIELD)).toBe(
      "Name cannot be less than 3 characters.",
    );
    expect(
      PermissionGate.getMissingPermissionMessage(
        model("Monitor"),
        ModelAction.Create,
      ),
    ).toBe("You do not have permission to create this Monitor.");
    expect(
      translateUnnamedDeleteSentence({
        typeLabel: "Monitor",
        kind: "question",
      }),
    ).toBe("Are you sure you want to delete this monitor?");
  });
});

describe("in German", () => {
  beforeAll(async () => {
    await i18next.init({
      lng: "de",
      resources: { de: { translation: GERMAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  test("the helpers follow the global instance", () => {
    expect(getGlobalTranslator().language).toBe("de");
    expect(translateText("Save")).toBe("Speichern");
    expect(translatePlural(ROWS, 1)).toBe("1 Zeile");
    expect(translatePlural(ROWS, 1234)).toBe("1.234 Zeilen");
    expect(
      translateTemplate("Create {{itemName}}", {
        itemName: translatableTerm("Status Page"),
      }),
    ).toBe("Statusseite erstellen");
  });

  test("a validation message names the field in the sentence", () => {
    expect(Validation.validateLength("ab", NAME_FIELD)).toBe(
      "Name darf nicht kürzer als 3 Zeichen sein.",
    );
  });

  test("the permission tooltip is a German sentence with the model's name", () => {
    expect(
      PermissionGate.getMissingPermissionMessage(
        model("Status Page"),
        ModelAction.Create,
      ),
    ).toBe("Sie haben keine Berechtigung, Statusseite zu erstellen.");
  });

  test("a sentence the locale lacks stays wholly English", () => {
    expect(
      PermissionGate.getMissingPermissionMessage(
        model("Status Page"),
        ModelAction.Delete,
      ),
    ).toBe("You do not have permission to delete this Status Page.");
  });

  test("the delete question: the whole sentence first, then the template", () => {
    expect(
      translateUnnamedDeleteSentence({
        typeLabel: "Monitor",
        kind: "question",
      }),
    ).toBe("Möchten Sie diesen Monitor wirklich löschen?");
    expect(
      translateUnnamedDeleteSentence({
        typeLabel: "Status Page",
        kind: "question",
      }),
    ).toBe("Möchten Sie dieses Objekt (Statusseite) wirklich löschen?");
  });

  test("switching the language back to English switches every helper", async () => {
    await i18next.changeLanguage("en");

    expect(translateText("Save")).toBe("Save");
    expect(Validation.validateLength("ab", NAME_FIELD)).toBe(
      "Name cannot be less than 3 characters.",
    );

    await i18next.changeLanguage("de");

    expect(translateText("Save")).toBe("Speichern");
  });
});
