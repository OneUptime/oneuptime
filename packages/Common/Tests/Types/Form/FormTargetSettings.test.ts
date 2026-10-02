import {
  FORM_INCIDENT_TITLE_MAX_LENGTH,
  FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
} from "../../../Types/Form/FormTargetCatalog";
import {
  FORM_TARGET_SETTING_MAX_IDS,
  FormTargetSettingReference,
  FormTargetSettingReferenceModel,
  getFormTargetSettingKeys,
  getFormTargetSettingReferences,
  readFormTargetSettings,
  validateFormTargetSettings,
} from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Form.targetSettings: what every submission starts with, beyond the
 * answers - the On Submit page's settings. One shape per target.
 *
 * Pinned here:
 *
 *   - the server refuses a key the target does not have, a value of the
 *     wrong kind, or a list longer than it allows, naming the setting;
 *   - the lenient reader keeps only what it can use - ids lowercased and
 *     each once, booleans only when true, titles trimmed and cut;
 *   - the references the server checks against the form's project are
 *     every id a setting names, by the kind of record it is.
 */

const A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type ValidateFunction = (
  value: unknown,
  targetType?: FormTargetType,
) => string | null;

const validate: ValidateFunction = (
  value: unknown,
  targetType: FormTargetType = FormTargetType.Incident,
): string | null => {
  return validateFormTargetSettings({ targetType, value });
};

type ManyIdsFunction = (count: number) => Array<string>;

const manyIds: ManyIdsFunction = (count: number): Array<string> => {
  const ids: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    ids.push(`00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`);
  }

  return ids;
};

describe("the settings each target has", () => {
  test("an incident form: a default title and severity, a template, records to attach and owners", () => {
    expect(getFormTargetSettingKeys(FormTargetType.Incident)).toEqual([
      "defaultTitle",
      "incidentSeverityId",
      "incidentTemplateId",
      "monitorIds",
      "labelIds",
      "onCallDutyPolicyIds",
      "ownerUserIds",
      "ownerTeamIds",
    ]);
  });

  test("a maintenance form: a default title, records to attach, owners and publishing", () => {
    expect(getFormTargetSettingKeys(FormTargetType.ScheduledMaintenance)).toEqual(
      [
        "defaultTitle",
        "monitorIds",
        "statusPageIds",
        "labelIds",
        "ownerUserIds",
        "ownerTeamIds",
        "showOnStatusPages",
        "notifySubscribers",
      ],
    );
  });

  test("an unknown target has none", () => {
    expect(getFormTargetSettingKeys("Alert" as FormTargetType)).toEqual([]);
  });
});

describe("validateFormTargetSettings: what the API accepts", () => {
  test("nothing at all, and an empty object, are fine", () => {
    for (const target of [
      FormTargetType.Incident,
      FormTargetType.ScheduledMaintenance,
    ]) {
      expect(validate(null, target)).toBeNull();
      expect(validate(undefined, target)).toBeNull();
      expect(validate({}, target)).toBeNull();
    }
  });

  test.each([["a list", []], ["text", "settings"], ["a number", 1]])(
    "%s is refused",
    (_label: string, value: unknown) => {
      expect(validate(value)).toBe("Target settings must be an object.");
    },
  );

  test("a full incident form's settings are accepted", () => {
    expect(
      validate({
        defaultTitle: "Reported problem",
        incidentSeverityId: A,
        incidentTemplateId: B.toUpperCase(),
        monitorIds: [A, B],
        labelIds: [C],
        onCallDutyPolicyIds: [A],
        ownerUserIds: [B],
        ownerTeamIds: [C],
      }),
    ).toBeNull();
  });

  test("a full maintenance form's settings are accepted", () => {
    expect(
      validate(
        {
          defaultTitle: "Change request",
          monitorIds: [A],
          statusPageIds: [B],
          labelIds: [C],
          ownerUserIds: [A],
          ownerTeamIds: [B],
          showOnStatusPages: false,
          notifySubscribers: true,
        },
        FormTargetType.ScheduledMaintenance,
      ),
    ).toBeNull();
  });

  test("null and undefined values mean not set", () => {
    expect(
      validate({
        defaultTitle: null,
        incidentSeverityId: undefined,
        monitorIds: null,
      }),
    ).toBeNull();
  });

  test("an empty id clears the setting", () => {
    expect(validate({ incidentSeverityId: "" })).toBeNull();
  });

  test("a key the target does not have is refused, with the ones it has", () => {
    expect(validate({ statusPageIds: [A] })).toBe(
      '"statusPageIds" is not a setting of forms that create an incident. Settings: defaultTitle, incidentSeverityId, incidentTemplateId, monitorIds, labelIds, onCallDutyPolicyIds, ownerUserIds, ownerTeamIds.',
    );
    expect(
      validate({ incidentSeverityId: A }, FormTargetType.ScheduledMaintenance),
    ).toBe(
      '"incidentSeverityId" is not a setting of forms that create a scheduled maintenance event. Settings: defaultTitle, monitorIds, statusPageIds, labelIds, ownerUserIds, ownerTeamIds, showOnStatusPages, notifySubscribers.',
    );
  });

  test("a long unknown key is cut in the message", () => {
    expect(validate({ ["x".repeat(500)]: true })).toContain(
      `"${"x".repeat(60)}" is not a setting`,
    );
  });

  test("the default title is text the record's title column can hold", () => {
    expect(validate({ defaultTitle: 5 })).toBe("Default Title must be text.");
    expect(
      validate({ defaultTitle: "x".repeat(FORM_INCIDENT_TITLE_MAX_LENGTH) }),
    ).toBeNull();
    expect(
      validate({
        defaultTitle: "x".repeat(FORM_INCIDENT_TITLE_MAX_LENGTH + 1),
      }),
    ).toBe("Default Title cannot be more than 500 characters.");
    expect(
      validate(
        {
          defaultTitle: "x".repeat(
            FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH + 1,
          ),
        },
        FormTargetType.ScheduledMaintenance,
      ),
    ).toBe("Default Title cannot be more than 100 characters.");
    // The spaces around it do not count.
    expect(
      validate(
        {
          defaultTitle: `  ${"x".repeat(FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH)}  `,
        },
        FormTargetType.ScheduledMaintenance,
      ),
    ).toBeNull();
  });

  test.each([["severity", 7], ["severity", "critical"], ["severity", [A]]])(
    "a single record is named by its id (%s %p)",
    (_label: string, value: unknown) => {
      expect(validate({ incidentSeverityId: value })).toBe(
        "Severity must be an id.",
      );
    },
  );

  test("a list setting is a list of ids, of at most 100", () => {
    expect(validate({ monitorIds: A })).toBe(
      "Monitors must be a list of ids.",
    );
    expect(validate({ labelIds: [A, "nope"] })).toBe(
      "Labels must be a list of ids.",
    );
    expect(
      validate({ ownerTeamIds: manyIds(FORM_TARGET_SETTING_MAX_IDS) }),
    ).toBeNull();
    expect(
      validate({ ownerTeamIds: manyIds(FORM_TARGET_SETTING_MAX_IDS + 1) }),
    ).toBe("Owner Teams cannot name more than 100 records.");
  });

  test("a switch is true or false", () => {
    expect(
      validate(
        { showOnStatusPages: "yes", notifySubscribers: 1 },
        FormTargetType.ScheduledMaintenance,
      ),
    ).toBe(
      "Show on Status Pages must be true or false. Notify Subscribers must be true or false.",
    );
  });

  test("every problem is named, in the order of the keys", () => {
    expect(
      validate({
        defaultTitle: 1,
        incidentSeverityId: "x",
        bogus: true,
      }),
    ).toBe(
      'Default Title must be text. Severity must be an id. "bogus" is not a setting of forms that create an incident. Settings: defaultTitle, incidentSeverityId, incidentTemplateId, monitorIds, labelIds, onCallDutyPolicyIds, ownerUserIds, ownerTeamIds.',
    );
  });
});

describe("readFormTargetSettings: what is stored, as a submission reads it", () => {
  test.each([[undefined], [null], ["x"], [[]], [7]])(
    "reads %p as no settings",
    (value: unknown) => {
      expect(
        readFormTargetSettings({ targetType: FormTargetType.Incident, value }),
      ).toEqual({});
    },
  );

  test("keeps an incident form's settings, ids lowercased", () => {
    expect(
      readFormTargetSettings({
        targetType: FormTargetType.Incident,
        value: {
          defaultTitle: "  Reported problem  ",
          incidentSeverityId: A.toUpperCase(),
          incidentTemplateId: new ObjectID(B),
          monitorIds: [A, A.toUpperCase(), "junk", 7, B],
          labelIds: [],
          onCallDutyPolicyIds: "not a list",
          ownerUserIds: [` ${C} `],
          ownerTeamIds: null,
        },
      }),
    ).toEqual({
      defaultTitle: "Reported problem",
      incidentSeverityId: A,
      incidentTemplateId: B,
      monitorIds: [A, B],
      ownerUserIds: [C],
    });
  });

  test("leaves out settings of the other target, and anything unknown", () => {
    expect(
      readFormTargetSettings({
        targetType: FormTargetType.ScheduledMaintenance,
        value: {
          incidentSeverityId: A,
          onCallDutyPolicyIds: [B],
          statusPageIds: [C],
          whatever: true,
        },
      }),
    ).toEqual({ statusPageIds: [C] });
  });

  test("a switch is on only when it is exactly true", () => {
    expect(
      readFormTargetSettings({
        targetType: FormTargetType.ScheduledMaintenance,
        value: { showOnStatusPages: "true", notifySubscribers: true },
      }),
    ).toEqual({ notifySubscribers: true });
  });

  test("an empty or blank title, and an invalid id, are not set", () => {
    expect(
      readFormTargetSettings({
        targetType: FormTargetType.Incident,
        value: { defaultTitle: "   ", incidentSeverityId: "critical" },
      }),
    ).toEqual({});
  });

  test("a title too long for the record is cut to fit", () => {
    expect(
      (
        readFormTargetSettings({
          targetType: FormTargetType.ScheduledMaintenance,
          value: { defaultTitle: "x".repeat(300) },
        }) as { defaultTitle: string }
      ).defaultTitle,
    ).toHaveLength(FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH);
  });

  test("a list too long is cut to the first 100", () => {
    const ids: Array<string> = manyIds(FORM_TARGET_SETTING_MAX_IDS + 20);

    expect(
      (
        readFormTargetSettings({
          targetType: FormTargetType.Incident,
          value: { labelIds: ids },
        }) as { labelIds: Array<string> }
      ).labelIds,
    ).toEqual(ids.slice(0, FORM_TARGET_SETTING_MAX_IDS));
  });

  test("never changes what it reads", () => {
    const value: Record<string, unknown> = Object.freeze({
      monitorIds: Object.freeze([A.toUpperCase()]),
    });

    readFormTargetSettings({ targetType: FormTargetType.Incident, value });

    expect(value["monitorIds"]).toEqual([A.toUpperCase()]);
  });
});

describe("getFormTargetSettingReferences: what the server checks against the project", () => {
  test("every id an incident form's settings name, by the record it is", () => {
    expect(
      getFormTargetSettingReferences({
        targetType: FormTargetType.Incident,
        settings: {
          defaultTitle: "Not a reference",
          incidentSeverityId: A,
          incidentTemplateId: B,
          monitorIds: [A, B],
          labelIds: [C],
          onCallDutyPolicyIds: [A],
          ownerUserIds: [B],
          ownerTeamIds: [C],
        },
      }),
    ).toEqual([
      {
        title: "Severity",
        model: FormTargetSettingReferenceModel.IncidentSeverity,
        ids: [A],
      },
      {
        title: "Incident Template",
        model: FormTargetSettingReferenceModel.IncidentTemplate,
        ids: [B],
      },
      {
        title: "Monitors",
        model: FormTargetSettingReferenceModel.Monitor,
        ids: [A, B],
      },
      {
        title: "Labels",
        model: FormTargetSettingReferenceModel.Label,
        ids: [C],
      },
      {
        title: "On-Call Policies",
        model: FormTargetSettingReferenceModel.OnCallDutyPolicy,
        ids: [A],
      },
      {
        title: "Owner Users",
        model: FormTargetSettingReferenceModel.User,
        ids: [B],
      },
      {
        title: "Owner Teams",
        model: FormTargetSettingReferenceModel.Team,
        ids: [C],
      },
    ]);
  });

  test("a maintenance form's status pages are checked too, its switches are not records", () => {
    const references: Array<FormTargetSettingReference> =
      getFormTargetSettingReferences({
        targetType: FormTargetType.ScheduledMaintenance,
        settings: {
          statusPageIds: [A],
          showOnStatusPages: true,
          notifySubscribers: true,
        },
      });

    expect(references).toEqual([
      {
        title: "Status Pages",
        model: FormTargetSettingReferenceModel.StatusPage,
        ids: [A],
      },
    ]);
  });

  test("settings that name nothing reference nothing", () => {
    expect(
      getFormTargetSettingReferences({
        targetType: FormTargetType.Incident,
        settings: { defaultTitle: "x", monitorIds: [] },
      }),
    ).toEqual([]);
  });
});

describe("the module stays pure", () => {
  test("imports only other pure modules of Common", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Form/FormTargetSettings.ts"),
      "utf8",
    );

    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      expect(match[1]).toMatch(/^\.\.?\//);
      expect(match[1]).not.toMatch(/Server|UI\/|Models|react/);
    }
  });
});
