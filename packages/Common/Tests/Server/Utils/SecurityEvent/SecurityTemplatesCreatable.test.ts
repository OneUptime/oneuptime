import { beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityPlaybook from "../../../../Models/DatabaseModels/SecurityPlaybook";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import SecurityPlaybookService from "../../../../Server/Services/SecurityPlaybookService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import ObjectID from "../../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  SETUP_TEST_DETECTION_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { DETECTION_RULE_NAME_MAX_LENGTH } from "../../../../Types/SecurityEvent/DetectionRuleName";
import {
  ENRICH_NEW_CASES_TEMPLATE_KEY,
  SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS,
  SecurityPlaybookTemplateDefinition,
  getSecurityPlaybookTemplateDefinition,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookTemplates";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  buildDetectionRuleFromLibrary,
  buildSecurityPlaybookFromTemplate,
  findRuleOfLibraryEntry,
  getSecurityPlaybookTemplateValues,
  isPlaybookFromTemplate,
  isRuleFromLibraryEntry,
} from "../../../../Utils/SecurityEvent/SecurityTemplateRecords";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import {
  TEST_PRIORITY_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * EVERY RULE LIBRARY ENTRY AND EVERY PLAYBOOK TEMPLATE CAN BE CREATED AS IT
 * IS.
 *
 * Turn on recommended failed with "name length cannot be more than 50
 * characters": the library's "Failed sign-ins, then a success from the same
 * address" was 53 characters, the name column 50, and nothing checked one
 * against the other. A library entry or a template is only worth offering
 * if the record OneUptime makes of it - in Turn on recommended, the setup
 * test, the Rule Library's Add buttons and the Playbooks page, all through
 * SecurityTemplateRecords - passes everything a create checks:
 *
 *   - the service's own create hook, as written: the Sigma rule parsed and
 *     compiled (a correlation with every rule it reads), the interval and
 *     threshold in range, the steps parsed, the trigger and conditions held
 *     to their values;
 *   - DatabaseService's checks after it: every required column given, the
 *     record valid, and every value within its column's width - read from
 *     the model, never a number written here, so a column that shrinks or a
 *     title that grows fails this suite and not a customer's click;
 *   - and in every language the Dashboard speaks, the name and description
 *     the Playbooks page gives a template.
 *
 * And each record is one OneUptime knows again, so adding twice adds
 * nothing. No database: the reference check is stubbed (the Postgres suite,
 * TurnOnRecommendedPostgres, creates every entry for real).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43401",
);
const USER_ID: ObjectID = new ObjectID("6ba7b811-9dad-41d1-80b4-00c04fd434aa");

// A Security Admin's create, as the API makes it.
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
} as DatabaseCommonInteractionProps;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

interface CreateChecks<TModel extends DatabaseBaseModel> {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  generateDefaultValues: (data: TModel) => TModel;
  checkRequiredFields: (data: TModel) => TModel;
  isValid: (data: TModel) => boolean;
  checkMaxLengthOfFields: (data: TModel) => TModel;
}

/*
 * What DatabaseService.create checks of a record before it writes it, in
 * its order, on the service's own methods: the hook, the defaults, the
 * required columns, the validity and the widths.
 */
async function passCreateChecks<TModel extends DatabaseBaseModel>(
  service: unknown,
  record: TModel,
): Promise<TModel> {
  const checks: CreateChecks<TModel> = service as CreateChecks<TModel>;
  const onCreate: OnCreate<TModel> = await checks.onBeforeCreate({
    data: record,
    props: PROPS,
  });
  let data: TModel = checks.generateDefaultValues(onCreate.createBy.data);
  data = checks.checkRequiredFields(data);
  expect(checks.isValid(data)).toBe(true);

  return checks.checkMaxLengthOfFields(data);
}

// Every value of a record that has a width, with the width its column has.
function overWide(record: DatabaseBaseModel): Array<string> {
  const over: Array<string> = [];

  for (const column of record.getTableColumns().columns) {
    const metadata: TableColumnMetadata = record.getTableColumnMetadata(column);
    const width: number | undefined = metadata?.type
      ? getMaxLengthFromTableColumnType(metadata.type)
      : undefined;
    const value: unknown = (record as unknown as Record<string, unknown>)[
      column
    ];

    if (width !== undefined && value !== undefined && value !== null) {
      const length: number = String(value).length;

      if (length > width) {
        over.push(`${column}: ${length} > ${width}`);
      }
    }
  }

  return over;
}

function widthOf(record: DatabaseBaseModel, column: string): number {
  const width: number | undefined = getMaxLengthFromTableColumnType(
    record.getTableColumnMetadata(column).type,
  );

  expect(width).toBeDefined();

  return width!;
}

function columnArgs(target: unknown, propertyName: string): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === target;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === propertyName;
    });

  expect(args).toBeDefined();

  return args!;
}

function normalized(name: string): string {
  return name.trim().toLowerCase();
}

beforeEach(() => {
  stubProjectDirectory({});
  // The project's priorities and statuses: a new project's.
  stubSecurityCaseValues();
});

// A new project's priorities and statuses, which a template's steps name by id.
const VALUES: {
  priorities: ReturnType<typeof buildDefaultTestPriorities>;
  statuses: ReturnType<typeof buildDefaultTestStatuses>;
} = {
  priorities: buildDefaultTestPriorities(PROJECT_ID),
  statuses: buildDefaultTestStatuses(PROJECT_ID),
};

const ENTRIES: Array<[string, DetectionRuleLibraryEntry]> =
  DETECTION_RULE_LIBRARY.map(
    (entry: DetectionRuleLibraryEntry): [string, DetectionRuleLibraryEntry] => {
      return [entry.title, entry];
    },
  );

const TEMPLATES: Array<[string, SecurityPlaybookTemplateDefinition]> =
  SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS.map(
    (
      template: SecurityPlaybookTemplateDefinition,
    ): [string, SecurityPlaybookTemplateDefinition] => {
      return [template.title, template];
    },
  );

describe("a detection rule's name holds a Sigma title", () => {
  test("the name is a ShortText column of 100 characters, in the model, in Postgres and to every check", () => {
    const rule: DetectionRule = new DetectionRule();
    const args: ColumnMetadataArgs = columnArgs(DetectionRule, "name");

    expect(widthOf(rule, "name")).toBe(DETECTION_RULE_NAME_MAX_LENGTH);
    expect(args.options.length).toBe(DETECTION_RULE_NAME_MAX_LENGTH);
    expect(DETECTION_RULE_NAME_MAX_LENGTH).toBe(ColumnLength.ShortText);
    expect(DETECTION_RULE_NAME_MAX_LENGTH).toBe(100);
  });

  test("it is wider than the title that broke Turn on recommended", () => {
    const title: string =
      "Failed sign-ins, then a success from the same address";

    expect(title.length).toBe(53);
    expect(title.length).toBeGreaterThan(ColumnLength.Name);
    expect(title.length).toBeLessThanOrEqual(DETECTION_RULE_NAME_MAX_LENGTH);
    expect(
      DETECTION_RULE_LIBRARY.some((entry: DetectionRuleLibraryEntry) => {
        return entry.title === title;
      }),
    ).toBe(true);
  });
});

describe("the Rule Library", () => {
  test("every title is its own, whatever its case or spacing, since a project's rule is known by it", () => {
    const titles: Set<string> = new Set();

    for (const entry of DETECTION_RULE_LIBRARY) {
      expect(titles.has(normalized(entry.title))).toBe(false);
      titles.add(normalized(entry.title));
      expect(entry.title).toBe(entry.title.trim());
    }
  });

  test("every recommended rule, and the setup test's, is a library entry", () => {
    for (const id of RECOMMENDED_DETECTION_RULE_IDS) {
      expect(getDetectionRuleLibraryEntry(id)).toBeDefined();
    }

    expect(getDetectionRuleLibraryEntry(SETUP_TEST_DETECTION_RULE_ID)).toBe(
      getRecommendedDetectionRules().find(
        (entry: DetectionRuleLibraryEntry) => {
          return entry.id === SETUP_TEST_DETECTION_RULE_ID;
        },
      ),
    );
  });

  describe.each(ENTRIES)(
    "%s",
    (_title: string, entry: DetectionRuleLibraryEntry) => {
      test("its title fits a rule's name", () => {
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.title.length).toBeLessThanOrEqual(
          widthOf(new DetectionRule(), "name"),
        );
      });

      test("the rule OneUptime makes of it passes every check a create makes", async () => {
        const record: DetectionRule = buildDetectionRuleFromLibrary({
          projectId: PROJECT_ID,
          entry,
        });

        expect(overWide(record)).toEqual([]);

        const checked: DetectionRule = await passCreateChecks(
          DetectionRuleService,
          record,
        );

        // Created as it is: the library's name, its rule, on, opening cases.
        expect(checked.name).toBe(entry.title);
        expect(checked.sigmaRuleYaml).toBe(entry.sigmaRuleYaml);
        expect(checked.isEnabled).toBe(true);
        expect(checked.shouldCreateCase).toBe(true);
        expect(overWide(checked)).toEqual([]);
      });

      test("the rule it makes is known again as this entry, and as no other", () => {
        const record: DetectionRule = buildDetectionRuleFromLibrary({
          projectId: PROJECT_ID,
          entry,
        });

        expect(isRuleFromLibraryEntry(record, entry)).toBe(true);
        // Renamed by the team, it is still this entry by its Sigma id.
        expect(
          isRuleFromLibraryEntry(
            { name: "Our own name", sigmaRuleYaml: entry.sigmaRuleYaml },
            entry,
          ),
        ).toBe(true);

        for (const other of DETECTION_RULE_LIBRARY) {
          if (other.id !== entry.id) {
            expect(isRuleFromLibraryEntry(record, other)).toBe(false);
          }
        }
      });
    },
  );

  test("a project that has every rule is offered none again", () => {
    const rules: Array<DetectionRule> = DETECTION_RULE_LIBRARY.map(
      (entry: DetectionRuleLibraryEntry): DetectionRule => {
        return buildDetectionRuleFromLibrary({ projectId: PROJECT_ID, entry });
      },
    );

    for (const entry of DETECTION_RULE_LIBRARY) {
      expect(findRuleOfLibraryEntry(rules, entry)?.name).toBe(entry.title);
    }
  });
});

describe("the playbook templates", () => {
  test("Enrich New Cases, which Turn on recommended adds, is one of them", () => {
    expect(
      getSecurityPlaybookTemplateDefinition(ENRICH_NEW_CASES_TEMPLATE_KEY)
        ?.title,
    ).toBe("Enrich New Cases");
  });

  test("a template's checklist is the case's own tasks, one a line, never a note of ticks", () => {
    for (const key of [ENRICH_NEW_CASES_TEMPLATE_KEY, "attack-evidence"]) {
      const steps: Array<SecurityPlaybookStep> =
        getSecurityPlaybookTemplateDefinition(key)!.getSteps(
          getSecurityPlaybookTemplateValues(VALUES),
        );
      const taskSteps: Array<SecurityPlaybookStep> = steps.filter(
        (candidate: SecurityPlaybookStep): boolean => {
          return candidate.action === SecurityPlaybookActionType.AddCaseTasks;
        },
      );

      expect({ key, taskSteps: taskSteps.length }).toEqual({
        key,
        taskSteps: 1,
      });

      const tasks: Array<string> = taskSteps[0]!.config[
        "tasks"
      ] as Array<string>;

      expect(tasks.length).toBeGreaterThanOrEqual(3);

      for (const task of tasks) {
        expect(task).not.toContain("\n");
        expect(task).not.toContain("[ ]");
      }

      // No step writes the checklist as a note any more.
      for (const candidate of steps) {
        expect(String(candidate.config["note"] || "")).not.toContain("- [ ]");
      }
    }
  });

  test("every key and every name is its own", () => {
    const keys: Set<string> = new Set();
    const names: Set<string> = new Set();

    for (const template of SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS) {
      expect(keys.has(template.key)).toBe(false);
      expect(names.has(normalized(template.title))).toBe(false);
      keys.add(template.key);
      names.add(normalized(template.title));
    }
  });

  describe.each(TEMPLATES)(
    "%s",
    (_title: string, template: SecurityPlaybookTemplateDefinition) => {
      test("the playbook OneUptime makes of it passes every check a create makes", async () => {
        const record: SecurityPlaybook = buildSecurityPlaybookFromTemplate({
          projectId: PROJECT_ID,
          template,
          ...VALUES,
        });

        expect(overWide(record)).toEqual([]);

        const checked: SecurityPlaybook = await passCreateChecks(
          SecurityPlaybookService,
          record,
        );

        expect(checked.name).toBe(template.title);
        expect(checked.isEnabled).toBe(true);
        expect(checked.trigger).toBe(template.trigger);
        expect((checked.steps as Array<unknown>).length).toBe(
          template.getSteps(getSecurityPlaybookTemplateValues(VALUES)).length,
        );
        // The minimum is the project's priority of the template's level.
        expect(checked.minimumSecurityCasePriorityId?.toString()).toBe(
          template.minimumPriorityLevel
            ? TEST_PRIORITY_IDS[template.minimumPriorityLevel]
            : undefined,
        );
        expect(checked.detectionSource).toBe(template.detectionSource);
        expect(overWide(checked)).toEqual([]);
        expect(isPlaybookFromTemplate(checked, template)).toBe(true);
      });

      test("in every language the Dashboard speaks, its name and description fit", async () => {
        const playbook: SecurityPlaybook = new SecurityPlaybook();
        const nameWidth: number = widthOf(playbook, "name");
        const descriptionWidth: number = widthOf(playbook, "description");
        const languages: Array<string> = fs
          .readdirSync(LOCALES_DIR)
          .filter((file: string): boolean => {
            return file.endsWith(".json");
          });

        // The Dashboard's seventeen: English and its sixteen translations.
        expect(languages.length).toBeGreaterThanOrEqual(17);

        for (const language of languages) {
          const locale: Record<string, unknown> = JSON.parse(
            fs.readFileSync(path.join(LOCALES_DIR, language), "utf8"),
          ) as Record<string, unknown>;
          const name: unknown = locale[template.title];
          const description: unknown = locale[template.description];

          // Every locale has the template's words: the extractor reads them.
          expect({ language, name: typeof name }).toEqual({
            language,
            name: "string",
          });
          expect({ language, description: typeof description }).toEqual({
            language,
            description: "string",
          });

          /*
           * The Playbooks page names the playbook as the reader's language
           * words the template: the very record, checked as the server
           * would.
           */
          const record: SecurityPlaybook = buildSecurityPlaybookFromTemplate({
            projectId: PROJECT_ID,
            template,
            ...VALUES,
            name: name as string,
            description: description as string,
          });

          expect({ language, over: overWide(record) }).toEqual({
            language,
            over: [],
          });
          expect((name as string).trim().length).toBeGreaterThan(0);
          expect((name as string).length).toBeLessThanOrEqual(nameWidth);
          expect((description as string).length).toBeLessThanOrEqual(
            descriptionWidth,
          );
        }
      });
    },
  );
});
