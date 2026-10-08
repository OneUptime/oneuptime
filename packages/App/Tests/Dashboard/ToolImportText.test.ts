import {
  describeToolImportNote,
  describeToolImportSummary,
  formatToolImportDate,
  namesValue,
  TOOL_IMPORT_ACTION_LABELS,
  TOOL_IMPORT_FIELD_TYPE_LABELS,
  TOOL_IMPORT_KIND_DESCRIPTIONS,
  TOOL_IMPORT_KIND_TERMS,
  TOOL_IMPORT_KIND_TITLES,
  TOOL_IMPORT_NOTE_TEMPLATES,
  TOOL_IMPORT_OUTCOME_COUNTS,
  TOOL_IMPORT_OUTCOME_LABELS,
  TOOL_IMPORT_PLURALS,
  TOOL_IMPORT_SERVER_MESSAGES,
  TOOL_IMPORT_STATUS_LABELS,
  TOOL_IMPORT_TOOL_COPY,
} from "../../FeatureSet/Dashboard/src/Components/ToolImport/ToolImportText";
import { TOOL_IMPORT_BRANDS } from "../../FeatureSet/Dashboard/src/Components/ToolImport/ToolImportBrand";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  getToolImportSourceDefinition,
  ToolImportCredentialField,
  ToolImportRegion,
} from "Common/Types/ToolImport/ToolImportCatalog";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "Common/Types/ToolImport/ToolImportNote";
import {
  ToolImportAction,
  ToolImportOutcome,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import {
  createTranslator,
  fillTemplate,
  getTemplatePlaceholders,
  PluralTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The import page words what the server says as codes (ToolImportNote) and
 * enums. These hold every code, kind, action, outcome, status and tool to a
 * sentence the page can show, every sentence to a key the locales have, and
 * every placeholder to a value the server actually sends - so a code added
 * on the server without its sentence, or a sentence naming a value nobody
 * fills, fails here rather than showing "{{name}}" to a customer.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const DASHBOARD_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const EN_JSON: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(DASHBOARD_SOURCE, "Locales", "en.json"), "utf8"),
) as Record<string, unknown>;

/*
 * The values the server puts on notes (Common/Types/ToolImport/ToolImportNote
 * documents each), plus {{tool}}, which the page adds.
 */
const NOTE_VALUES: ReadonlyArray<string> = [
  "tool",
  "name",
  "email",
  "rotation",
  "date",
  "count",
  "minutes",
  "plan",
  "kind",
  "limit",
  "level",
  "timezone",
  "state",
  "role",
  "category",
  "condition",
  "error",
];

function valuesOf<T extends string>(record: Record<string, T>): Array<T> {
  return Object.values(record);
}

describe("every code and enum the import sends has words", () => {
  test("every note code has a whole sentence", () => {
    for (const code of Object.values(ToolImportNoteCode)) {
      expect({
        code,
        template: TOOL_IMPORT_NOTE_TEMPLATES[code]?.length || 0,
      }).toEqual({ code, template: expect.any(Number) });
      expect(TOOL_IMPORT_NOTE_TEMPLATES[code]!.length).toBeGreaterThan(10);
    }
  });

  test("a note's sentence names only values the server sends", () => {
    for (const [code, template] of Object.entries(TOOL_IMPORT_NOTE_TEMPLATES)) {
      for (const placeholder of getTemplatePlaceholders(template)) {
        expect({
          code,
          placeholder,
          known: NOTE_VALUES.includes(placeholder),
        }).toEqual({ code, placeholder, known: true });
      }
    }
  });

  test("every kind has a title, a term for the middle of a sentence and a line saying what it becomes", () => {
    for (const kind of Object.values(ToolImportResourceKind)) {
      expect(TOOL_IMPORT_KIND_TITLES[kind]).toBeTruthy();
      expect(TOOL_IMPORT_KIND_TERMS[kind]).toBeTruthy();
      expect(TOOL_IMPORT_KIND_DESCRIPTIONS[kind]).toBeTruthy();
      // The term is the title in lower case, as a sentence carries it.
      expect(TOOL_IMPORT_KIND_TERMS[kind]).toBe(
        TOOL_IMPORT_KIND_TITLES[kind].toLowerCase(),
      );
    }
  });

  test("every action, outcome and status has a label, and every outcome a count", () => {
    for (const action of Object.values(ToolImportAction)) {
      expect(TOOL_IMPORT_ACTION_LABELS[action]).toBeTruthy();
    }

    for (const outcome of Object.values(ToolImportOutcome)) {
      expect(TOOL_IMPORT_OUTCOME_LABELS[outcome]).toBeTruthy();
      expect(TOOL_IMPORT_OUTCOME_COUNTS[outcome].other).toContain("{{count}}");
    }

    for (const status of Object.values(ToolImportRunStatus)) {
      expect(TOOL_IMPORT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  test("the custom field types an adapter maps to all have a name", () => {
    for (const type of [
      CustomFieldType.Text,
      CustomFieldType.Number,
      CustomFieldType.Dropdown,
      CustomFieldType.MultiSelectDropdown,
    ]) {
      expect(TOOL_IMPORT_FIELD_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});

describe("every tool says how to make its key", () => {
  test.each(AllToolImportSources)(
    "%s has a description, numbered steps, a key label and a tile",
    (source: ToolImportSource) => {
      const copy: (typeof TOOL_IMPORT_TOOL_COPY)[ToolImportSource] =
        TOOL_IMPORT_TOOL_COPY[source];

      expect(copy.description).toBeTruthy();
      expect(copy.keySteps.length).toBeGreaterThanOrEqual(2);
      expect(copy.keyLabel).toContain(
        getToolImportSourceDefinition(source).title,
      );
      expect(TOOL_IMPORT_BRANDS[source].initial).toBeTruthy();
      expect(TOOL_IMPORT_BRANDS[source].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    },
  );

  test.each(AllToolImportSources)(
    "%s asks where the account is exactly when it has regions, and names each one",
    (source: ToolImportSource) => {
      const regions: Array<ToolImportRegion> =
        getToolImportSourceDefinition(source).regions;
      const copy: (typeof TOOL_IMPORT_TOOL_COPY)[ToolImportSource] =
        TOOL_IMPORT_TOOL_COPY[source];

      expect(Boolean(copy.regionQuestion)).toBe(regions.length > 0);

      for (const region of regions) {
        expect(copy.regions?.[region.value]?.title).toBeTruthy();
        expect(copy.regions?.[region.value]?.description).toBeTruthy();
      }
    },
  );

  test("the import never asks for a key that can change the tool", () => {
    // Opsgenie: Read and Configuration access; incident.io: view only.
    expect(
      TOOL_IMPORT_TOOL_COPY[ToolImportSource.OpsGenie].keySteps.join(" "),
    ).toContain("Read and Configuration access only");
    expect(
      TOOL_IMPORT_TOOL_COPY[ToolImportSource.IncidentIo].keySteps.join(" "),
    ).toContain("none that create, edit or manage");
    // PagerDuty and Splunk On-Call have a read-only key; Grafana OnCall's token reads.
    expect(
      TOOL_IMPORT_TOOL_COPY[ToolImportSource.PagerDuty].keySteps.join(" "),
    ).toContain("tick Read-only API Key");
    expect(
      TOOL_IMPORT_TOOL_COPY[ToolImportSource.SplunkOnCall].keySteps.join(" "),
    ).toContain("with Read-only ticked");

    for (const source of AllToolImportSources) {
      expect({
        source,
        promise: TOOL_IMPORT_TOOL_COPY[source].keySteps.some(
          (step: string): boolean => {
            return step.includes(
              `The import never changes anything in ${getToolImportSourceDefinition(source).title}.`,
            );
          },
        ),
      }).toEqual({ source, promise: true });
    }
  });

  test.each(AllToolImportSources)(
    "%s has a label for each thing it asks for besides the key, and only those",
    (source: ToolImportSource) => {
      const fields: Array<ToolImportCredentialField> =
        getToolImportSourceDefinition(source).credentialFields;
      const copy: (typeof TOOL_IMPORT_TOOL_COPY)[ToolImportSource] =
        TOOL_IMPORT_TOOL_COPY[source];
      const title: string = getToolImportSourceDefinition(source).title;

      expect(Boolean(copy.keyIdLabel)).toBe(
        fields.includes(ToolImportCredentialField.ApiKeyId),
      );
      expect(Boolean(copy.apiUrlLabel)).toBe(
        fields.includes(ToolImportCredentialField.ApiUrl),
      );

      // Each label names the tool, as the key's does.
      for (const label of [copy.keyIdLabel, copy.apiUrlLabel]) {
        if (label) {
          expect(label).toContain(title);
        }
      }
    },
  );

  test("Splunk On-Call's steps say where the API ID is; Grafana OnCall's where the API URL and tokens are", () => {
    expect(
      TOOL_IMPORT_TOOL_COPY[ToolImportSource.SplunkOnCall].keySteps.join(" "),
    ).toContain("Your API ID is shown above your API keys.");
    expect(
      TOOL_IMPORT_TOOL_COPY[ToolImportSource.GrafanaOnCall].keySteps.join(" "),
    ).toContain("Copy the OnCall API URL shown there");
    expect(
      TOOL_IMPORT_TOOL_COPY[ToolImportSource.GrafanaOnCall].keySteps.join(" "),
    ).toContain("Under API tokens, create a token");
  });
});

describe("every sentence is a key the locales have", () => {
  const sentences: Array<string> = [
    ...valuesOf(TOOL_IMPORT_NOTE_TEMPLATES),
    ...valuesOf(TOOL_IMPORT_KIND_TITLES),
    ...valuesOf(TOOL_IMPORT_KIND_TERMS),
    ...valuesOf(TOOL_IMPORT_KIND_DESCRIPTIONS),
    ...valuesOf(TOOL_IMPORT_ACTION_LABELS),
    ...valuesOf(TOOL_IMPORT_OUTCOME_LABELS),
    ...valuesOf(TOOL_IMPORT_STATUS_LABELS),
    ...(Object.values(TOOL_IMPORT_FIELD_TYPE_LABELS) as Array<string>),
    ...TOOL_IMPORT_SERVER_MESSAGES,
    ...AllToolImportSources.flatMap((source: ToolImportSource) => {
      const copy: (typeof TOOL_IMPORT_TOOL_COPY)[ToolImportSource] =
        TOOL_IMPORT_TOOL_COPY[source];

      return [
        copy.description,
        copy.keyLabel,
        ...(copy.keyIdLabel ? [copy.keyIdLabel] : []),
        ...(copy.apiUrlLabel ? [copy.apiUrlLabel] : []),
        ...copy.keySteps,
        ...(copy.regionQuestion ? [copy.regionQuestion] : []),
        ...Object.values(copy.regions || {}).flatMap(
          (region: { title: string; description: string }) => {
            return [region.title, region.description];
          },
        ),
      ];
    }),
  ];

  test("each is in en.json", () => {
    const missing: Array<string> = sentences.filter((sentence: string) => {
      return EN_JSON[sentence] !== sentence;
    });

    expect(missing).toEqual([]);
  });

  test("each plural has both forms in en.json", () => {
    const plurals: Array<PluralTemplate> = [
      ...Object.values(TOOL_IMPORT_PLURALS),
      ...Object.values(TOOL_IMPORT_OUTCOME_COUNTS),
    ];

    for (const plural of plurals) {
      expect(EN_JSON[plural.other]).toBe(plural.other);
      expect(EN_JSON[`${plural.other}_one`]).toBe(plural.one);
    }
  });
});

describe("the server's own messages are the ones the page translates", () => {
  const SERVER_SOURCES: Array<string> = [
    path.join("Server", "API", "ToolImportAPI.ts"),
    path.join("Server", "Utils", "ToolImport", "ToolImportRunExecutor.ts"),
    path.join("Types", "ToolImport", "ToolImportPlan.ts"),
  ];

  const serverText: string = SERVER_SOURCES.map((file: string): string => {
    return fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "Common", file),
      "utf8",
    );
  })
    .join("\n")
    // Long strings are wrapped by the formatter; compare them whole.
    .replace(/"\s*\+\s*"/g, "");

  test.each([...TOOL_IMPORT_SERVER_MESSAGES])(
    "the server says %j word for word",
    (message: string) => {
      expect(serverText).toContain(`"${message}"`);
    },
  );
});

describe("a note reads as a sentence", () => {
  test("the notes PagerDuty, Splunk On-Call and Grafana OnCall add read whole, with their values", () => {
    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.RotationTimezoneConverted, {
          rotation: "Office hours",
          timezone: "UTC",
        }),
        ENGLISH,
        "Grafana OnCall",
      ),
    ).toBe(
      "Office hours keeps UTC time. Its hours come over in the schedule's time zone as they are today, so they can move by an hour when daylight saving time changes.",
    );
    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.ShiftBasedSchedulesNotRead),
        ENGLISH,
        "PagerDuty",
      ),
    ).toBe(
      "PagerDuty's shift-based schedules cannot be read yet, so they are not shown. Create them in OneUptime.",
    );
    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.RotationApproximated, {
          rotation: "Weekday days",
        }),
        ENGLISH,
        "Splunk On-Call",
      ),
    ).toContain("Weekday days hands over in a way a OneUptime layer cannot");

    for (const code of [
      ToolImportNoteCode.RotationOneOff,
      ToolImportNoteCode.ScheduleFromCalendarLink,
      ToolImportNoteCode.PolicyWebhookStep,
      ToolImportNoteCode.PolicyRunsAnotherPolicy,
      ToolImportNoteCode.PolicyResolvesAlert,
      ToolImportNoteCode.PolicyEmailAddress,
      ToolImportNoteCode.PolicyUserGroup,
      ToolImportNoteCode.PolicyDeclaresIncident,
      ToolImportNoteCode.PolicyConditionalStep,
      ToolImportNoteCode.PolicyScheduleNotRead,
    ]) {
      const sentence: string = describeToolImportNote(
        makeToolImportNote(code, { rotation: "Launch day" }),
        ENGLISH,
        "Grafana OnCall",
      );

      expect({ code, filled: !sentence.includes("{{") }).toEqual({
        code,
        filled: true,
      });
    }
  });

  test("values go in as they are, with the tool's name", () => {
    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.PersonNoEmail),
        ENGLISH,
        "Opsgenie",
      ),
    ).toBe(
      "They have no email address in Opsgenie, so they cannot be invited.",
    );

    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.NameExists, { name: "Platform" }),
        ENGLISH,
        "Opsgenie",
      ),
    ).toBe("OneUptime already has Platform, so it is used as it is.");
  });

  test("a kind is said the way the middle of a sentence says it", () => {
    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
          kind: ToolImportResourceKind.OnCallSchedule,
        }),
        ENGLISH,
        "Opsgenie",
      ),
    ).toBe("The API key cannot read on-call schedules, so none are shown.");
  });

  test("a date is written the reader's way, and a number too", () => {
    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.RotationEnded, {
          rotation: "Weekend",
          date: "2026-12-31T00:00:00.000Z",
        }),
        ENGLISH,
        "Opsgenie",
      ),
    ).toBe(
      `Weekend ended on ${formatToolImportDate("2026-12-31T00:00:00.000Z", "en")}, so it is left out.`,
    );
    expect(formatToolImportDate("2026-12-31T00:00:00.000Z", "en")).toMatch(
      /2026/,
    );
    // Not a date: shown as it came, never as "Invalid Date".
    expect(formatToolImportDate("soon", "en")).toBe("soon");

    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.OverLimit, { limit: 2000 }),
        ENGLISH,
        "Opsgenie",
      ),
    ).toBe(
      "One import brings over at most 2,000 of these. Run the import again for the rest.",
    );
  });

  test("a value cannot replace the tool's name", () => {
    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.PersonDeactivated, {
          tool: "Evil",
        }),
        ENGLISH,
        "incident.io",
      ),
    ).toBe("They are deactivated in incident.io.");
  });

  test("a code this build does not know says nothing", () => {
    expect(
      describeToolImportNote(
        { code: "SomethingNew" as ToolImportNoteCode },
        ENGLISH,
        "Opsgenie",
      ),
    ).toBe("");
  });

  test("a translated sentence carries the kind in the reader's words", () => {
    const german: Translator = createTranslator((text: string) => {
      return (
        {
          "The API key cannot read {{kind}}, so none are shown.":
            "Der API-Schlüssel kann {{kind}} nicht lesen, daher werden keine angezeigt.",
          "on-call schedules": "Bereitschaftspläne",
        } as Record<string, string>
      )[text];
    }, "de");

    expect(
      describeToolImportNote(
        makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
          kind: ToolImportResourceKind.OnCallSchedule,
        }),
        german,
        "Opsgenie",
      ),
    ).toBe(
      "Der API-Schlüssel kann Bereitschaftspläne nicht lesen, daher werden keine angezeigt.",
    );
  });
});

describe("an item's facts read as one line", () => {
  test("a team says how many members it has", () => {
    expect(
      describeToolImportSummary(
        ToolImportResourceKind.Team,
        { memberCount: 1 },
        ENGLISH,
      ),
    ).toBe("1 member");
    expect(
      describeToolImportSummary(
        ToolImportResourceKind.Team,
        { memberCount: 3 },
        ENGLISH,
      ),
    ).toBe("3 members");
  });

  test("a schedule says its rotations, how many schedules it becomes and its time zone", () => {
    expect(
      describeToolImportSummary(
        ToolImportResourceKind.OnCallSchedule,
        { layerCount: 2, scheduleCount: 2, timezone: "Europe/Berlin" },
        ENGLISH,
      ),
    ).toBe("2 rotations · becomes 2 schedules · Europe/Berlin");
    // One schedule is not worth saying.
    expect(
      describeToolImportSummary(
        ToolImportResourceKind.OnCallSchedule,
        { layerCount: 1, scheduleCount: 1 },
        ENGLISH,
      ),
    ).toBe("1 rotation");
  });

  test("a policy says its steps and repeats, a field its type and options, a person their email", () => {
    expect(
      describeToolImportSummary(
        ToolImportResourceKind.OnCallPolicy,
        { levelCount: 3, repeatTimes: 2 },
        ENGLISH,
      ),
    ).toBe("3 steps · repeats 2 times");
    expect(
      describeToolImportSummary(
        ToolImportResourceKind.IncidentCustomField,
        { fieldType: CustomFieldType.Dropdown, optionCount: 4 },
        ENGLISH,
      ),
    ).toBe("Dropdown · 4 options");
    expect(
      describeToolImportSummary(
        ToolImportResourceKind.Person,
        { email: "alice@example.com" },
        ENGLISH,
      ),
    ).toBe("alice@example.com");
  });
});

describe("names in a sentence", () => {
  function names(list: Array<string>): string {
    return fillTemplate("{{names}}", { names: namesValue(list) });
  }

  test("are joined the way a sentence joins them, and a long list is shortened", () => {
    expect(names(["Alice"])).toBe("Alice");
    expect(names(["Alice", "Bob"])).toBe("Alice and Bob");
    expect(names(["Alice", "Bob", "Carol"])).toBe("Alice, Bob and Carol");
    expect(names(["Alice", "Bob", "Carol", "Dan", "Eve"])).toBe(
      "Alice, Bob and 3 others",
    );
    expect(names(["Alice", "Bob", "Carol", "Dan"])).toBe(
      "Alice, Bob and 2 others",
    );
  });
});
