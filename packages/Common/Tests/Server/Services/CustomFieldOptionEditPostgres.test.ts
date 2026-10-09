import Entities from "../../../Models/DatabaseModels/Index";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertCustomFieldService from "../../../Server/Services/AlertCustomFieldService";
import AlertService from "../../../Server/Services/AlertService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FormService from "../../../Server/Services/FormService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import MonitorCustomFieldService from "../../../Server/Services/MonitorCustomFieldService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import ScheduledMaintenanceCustomFieldService from "../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import TableViewService from "../../../Server/Services/TableViewService";
import TeamCustomFieldService from "../../../Server/Services/TeamCustomFieldService";
import TeamService from "../../../Server/Services/TeamService";
import {
  countCustomFieldOptionValues,
  moveCustomFieldOptionValues,
} from "../../../Server/Utils/CustomField/CustomFieldOptionRename";
import { getCustomFieldOptionUsage } from "../../../Server/Utils/CustomField/CustomFieldOptionEditHooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CustomFieldOptionRenameMap,
  CustomFieldOptionUsage,
  CustomFieldOptionUsageValue,
  renameCustomFieldOptionValue,
  toCustomFieldOptionRenameMap,
} from "../../../Types/CustomField/CustomFieldOptionEdit";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { FormFieldSource } from "../../../Types/Form/FormField";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { SpyInstance } from "jest-mock";
import { DataSource } from "typeorm";

/*
 * Renaming a dropdown custom field's options (#4564) against a migrated
 * Postgres.
 *
 * Opt in with RUN_POSTGRES_CUSTOM_FIELD_OPTION_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_CUSTOM_FIELD_OPTION_TESTS=true \
 *   CUSTOM_FIELD_OPTION_TEST_DATABASE_HOST=127.0.0.1 \
 *   CUSTOM_FIELD_OPTION_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/CustomFieldOptionEditPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database. It
 * works on structure-only clones (LIKE ... INCLUDING ALL) of the custom field
 * definition and value tables it touches, TableView and Form, in a uniquely
 * named schema dropped afterwards; every row is synthetic.
 *
 * What it pins:
 *   - a project admin renaming options through the definition service moves
 *     the values on the records and templates of that project only - a
 *     single value, the entries of a list (merged ones listed once), numbers
 *     and yes/no matched by their text - without the "On Update" workflow of
 *     any record and without touching their version or updatedAt;
 *   - the SQL agrees with renameCustomFieldOptionValue, the TypeScript every
 *     other store (saved views, form templates, the dashboard) uses, on every
 *     shape of value;
 *   - renames are made all at once, so a swap swaps;
 *   - the saved views and form templates that remember an option follow it;
 *   - options changed without renames move nothing;
 *   - a rename that cannot be made is refused, and changes nothing;
 *   - the stores move together or not at all, and a move that fails puts the
 *     field's options back;
 *   - renaming a monitor field's option renames it on the incident and alert
 *     fields that copy it, adds the options they lack, and moves their values;
 *   - the counts the option editor shows are of the project's live records;
 *   - it is the same for a resource with no templates (teams).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_CUSTOM_FIELD_OPTION_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "IncidentCustomField",
  "Incident",
  "IncidentTemplate",
  "MonitorCustomField",
  "Monitor",
  "MonitorTemplate",
  "AlertCustomField",
  "Alert",
  "ScheduledMaintenanceCustomField",
  "ScheduledMaintenance",
  "ScheduledMaintenanceTemplate",
  "TeamCustomField",
  "Team",
  "TableView",
  "Form",
];

interface Row {
  customFields: unknown;
  version: number;
  updatedAt: Date;
  facets?: unknown;
  templates?: unknown;
  dropdownOptions?: unknown;
}

describePostgres(
  "renaming a dropdown custom field's options against Postgres",
  () => {
    const schema: string = `custom_field_option_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    let database: DataSource;
    let workflows: Array<SpyInstance<(...args: Array<any>) => any>> = [];

    function adminProps(): DatabaseCommonInteractionProps {
      const tenantPermission: UserTenantAccessPermission = {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: [Permission.ProjectAdmin].map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      };

      return {
        tenantId: projectId,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: {
          [projectId.toString()]: tenantPermission,
        },
      };
    }

    async function createField<T extends BaseModel>(data: {
      service: DatabaseService<T>;
      modelType: { new (): T };
      name: string;
      customFieldType?: CustomFieldType;
      dropdownOptions?: string;
      mapFromCustomFieldName?: string;
    }): Promise<T> {
      const field: T = new data.modelType();
      const row: Record<string, unknown> = field as unknown as Record<
        string,
        unknown
      >;

      row["name"] = data.name;
      row["customFieldType"] = data.customFieldType || CustomFieldType.Dropdown;
      row["dropdownOptions"] = data.dropdownOptions;

      if (data.mapFromCustomFieldName) {
        row["mapFromResourceType"] = "Monitor";
        row["mapFromCustomFieldName"] = data.mapFromCustomFieldName;
      }

      return await data.service.create({
        data: field,
        props: adminProps(),
      });
    }

    async function seed(
      table: string,
      customFields: unknown,
      options: { project?: ObjectID; deleted?: boolean } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const bag: string | null =
        customFields === null ? null : JSON.stringify(customFields);
      const project: string = (options.project || projectId).toString();

      const columns: Record<string, string> = {
        Incident: `"title", "slug", "currentIncidentStateId", "incidentSeverityId"`,
        IncidentTemplate: `"title", "templateName", "templateDescription", "slug"`,
        Monitor: `"name", "slug", "monitorType", "currentMonitorStatusId"`,
        MonitorTemplate: `"templateName", "templateDescription", "slug", "monitorType"`,
        Alert: `"title", "currentAlertStateId", "alertSeverityId"`,
        Team: `"name", "slug"`,
      };

      const values: Record<string, Array<string>> = {
        Incident: [
          "Uplink down",
          `incident-${id.toString()}`,
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
        ],
        IncidentTemplate: [
          "Site outage",
          "Site outage",
          "A site is down",
          `template-${id.toString()}`,
        ],
        Monitor: [
          "Uplink",
          `monitor-${id.toString()}`,
          "Manual",
          ObjectID.generate().toString(),
        ],
        MonitorTemplate: [
          "Uplink",
          "Uplink monitor",
          `monitor-template-${id.toString()}`,
          "Manual",
        ],
        Alert: [
          "Uplink down",
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
        ],
        Team: ["Network", `team-${id.toString()}`],
      };

      const extra: Array<string> = values[table]!;
      const placeholders: string = extra
        .map((_value: string, index: number): string => {
          return `$${index + 5}`;
        })
        .join(", ");

      await database.query(
        `INSERT INTO "${schema}"."${table}"
         ("_id", "projectId", "customFields", "deletedAt", ${columns[table]}, "version", "updatedAt")
         VALUES ($1, $2, $3::jsonb, $4, ${placeholders}, 3, '2026-01-01T00:00:00Z')`,
        [
          id.toString(),
          project,
          bag,
          options.deleted ? "2026-02-01T00:00:00Z" : null,
          ...extra,
        ],
      );

      return id;
    }

    async function seedTableView(data: {
      tableId: string;
      facets: JSONObject;
      project?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."TableView"
       ("_id", "projectId", "name", "tableId", "query", "sort", "facets", "version", "updatedAt")
       VALUES ($1, $2, 'My view', $3, '{}'::jsonb, '{}'::jsonb, $4::jsonb, 1, '2026-01-01T00:00:00Z')`,
        [
          id.toString(),
          (data.project || projectId).toString(),
          data.tableId,
          JSON.stringify(data.facets),
        ],
      );
      return id;
    }

    async function seedForm(data: {
      fields: Array<JSONObject>;
      templates: Array<JSONObject>;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Form"
       ("_id", "projectId", "name", "shareKey", "targetType", "fields", "templates", "version", "updatedAt")
       VALUES ($1, $2, 'Report a problem', $3, 'Incident', $4::jsonb, $5::jsonb, 1, '2026-01-01T00:00:00Z')`,
        [
          id.toString(),
          projectId.toString(),
          ObjectID.generate().toString(),
          JSON.stringify(data.fields),
          JSON.stringify(data.templates),
        ],
      );
      return id;
    }

    async function readRow(table: string, id: ObjectID): Promise<Row> {
      const rows: Array<Row> = await database.query(
        `SELECT * FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id.toString()],
      );
      return rows[0]!;
    }

    async function bagOf(table: string, id: ObjectID): Promise<unknown> {
      return (await readRow(table, id)).customFields;
    }

    async function optionsOf(table: string, id: ObjectID): Promise<unknown> {
      return (await readRow(table, id)).dropdownOptions;
    }

    async function renameOptions(data: {
      service: DatabaseService<any>;
      id: ObjectID;
      dropdownOptions: string;
      renames: Array<{ from: string; to: string }>;
    }): Promise<void> {
      await data.service.updateOneById({
        id: data.id,
        data: { dropdownOptions: data.dropdownOptions } as never,
        miscDataProps: { renamedDropdownOptions: data.renames },
        props: adminProps(),
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["CUSTOM_FIELD_OPTION_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["CUSTOM_FIELD_OPTION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CUSTOM_FIELD_OPTION_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const service of [
        IncidentCustomFieldService,
        MonitorCustomFieldService,
        AlertCustomFieldService,
        ScheduledMaintenanceCustomFieldService,
        TeamCustomFieldService,
      ] as Array<DatabaseService<any>>) {
        jest.spyOn(service, "onTriggerRealtime").mockResolvedValue();
        jest.spyOn(service, "onTriggerWorkflow").mockResolvedValue();
      }

      // The mapping backfill after a save has nothing to copy here.
      jest
        .spyOn(CustomFieldMappingService, "backfillProject")
        .mockResolvedValue();
    });

    beforeEach(async () => {
      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        }).join("; "),
      );

      workflows = (
        [
          IncidentService,
          IncidentTemplateService,
          MonitorService,
          MonitorTemplateService,
          AlertService,
          TeamService,
          TableViewService,
          FormService,
        ] as Array<DatabaseService<any>>
      ).map((service: DatabaseService<any>) => {
        return jest
          .spyOn(service, "onTriggerWorkflow")
          .mockResolvedValue() as unknown as SpyInstance<
          (...args: Array<any>) => any
        >;
      });
    });

    afterEach(() => {
      for (const workflow of workflows) {
        expect(workflow).not.toHaveBeenCalled();
        workflow.mockRestore();
      }
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("renaming an option moves it on the project's incidents and templates, and nothing else", async () => {
      const facility: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B\nFacility C",
      });

      const holding: ObjectID = await seed("Incident", {
        Facility: "Facility A",
        Region: "Facility A",
      });
      const holdingAnother: ObjectID = await seed("Incident", {
        Facility: "Facility B",
      });
      const holdingNothing: ObjectID = await seed("Incident", {
        Region: "West",
      });
      const noBag: ObjectID = await seed("Incident", null);
      const arrayBag: ObjectID = await seed("Incident", ["Facility A"]);
      const deleted: ObjectID = await seed(
        "Incident",
        { Facility: "Facility A" },
        { deleted: true },
      );
      const otherProjects: ObjectID = await seed(
        "Incident",
        { Facility: "Facility A" },
        { project: otherProjectId },
      );
      const template: ObjectID = await seed("IncidentTemplate", {
        Facility: "Facility A",
      });

      await renameOptions({
        service: IncidentCustomFieldService,
        id: facility.id!,
        dropdownOptions: "Facility Alpha\nFacility B\nFacility C",
        renames: [{ from: "Facility A", to: "Facility Alpha" }],
      });

      const moved: Row = await readRow("Incident", holding);

      expect(moved.customFields).toEqual({
        Facility: "Facility Alpha",
        // Another field holding the same text is another field.
        Region: "Facility A",
      });
      // Not an edit of the incident: no version bump, updatedAt as it was.
      expect(moved.version).toBe(3);
      expect(new Date(moved.updatedAt).toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );

      expect(await bagOf("Incident", holdingAnother)).toEqual({
        Facility: "Facility B",
      });
      expect(await bagOf("Incident", holdingNothing)).toEqual({
        Region: "West",
      });
      expect(await bagOf("Incident", noBag)).toBeNull();
      expect(await bagOf("Incident", arrayBag)).toEqual(["Facility A"]);
      // A deleted incident is moved too, should it ever be restored.
      expect(await bagOf("Incident", deleted)).toEqual({
        Facility: "Facility Alpha",
      });
      expect(await bagOf("Incident", otherProjects)).toEqual({
        Facility: "Facility A",
      });
      expect(await bagOf("IncidentTemplate", template)).toEqual({
        Facility: "Facility Alpha",
      });

      expect(await optionsOf("IncidentCustomField", facility.id!)).toBe(
        "Facility Alpha\nFacility B\nFacility C",
      );
    });

    test("the SQL renames every shape of value exactly as renameCustomFieldOptionValue does", async () => {
      const renames: CustomFieldOptionRenameMap = toCustomFieldOptionRenameMap([
        { from: "A", to: "Alpha" },
        { from: "B", to: "Alpha" },
        { from: "High", to: "Low" },
        { from: "Low", to: "High" },
        { from: "1", to: "One" },
        { from: "true", to: "Yes" },
        { from: "__proto__", to: "Prototype" },
        { from: "Ünïcödé ✓", to: "Unicode" },
      ]);

      const shapes: Array<unknown> = [
        "A",
        "B",
        "C",
        "",
        "a",
        " A",
        1,
        2,
        1.5,
        true,
        false,
        "High",
        "Low",
        "__proto__",
        "Ünïcödé ✓",
        ["A"],
        ["A", "B"],
        ["B", "A", "C"],
        ["C", "Alpha", "A"],
        ["C", "C"],
        ["A", "A"],
        ["High", "Low"],
        ["Low", "High", "Low"],
        [1, "1"],
        ["1", 2, true],
        [{ x: "A" }, "A", null],
        [null, null],
        [],
        { nested: "A" },
        null,
      ];

      const ids: Array<ObjectID> = [];

      for (const shape of shapes) {
        ids.push(await seed("Incident", { Field: shape, Other: "A" }));
      }

      const missingKey: ObjectID = await seed("Incident", { Other: "A" });

      await moveCustomFieldOptionValues({
        service: IncidentService,
        projectId: projectId,
        fieldName: "Field",
        renames: renames,
      });

      for (let index: number = 0; index < shapes.length; index++) {
        const expected: unknown = renameCustomFieldOptionValue(
          shapes[index],
          renames,
        ).value;

        expect({
          shape: shapes[index],
          stored: (await bagOf("Incident", ids[index]!)) as JSONObject,
        }).toEqual({
          shape: shapes[index],
          stored: { Field: expected, Other: "A" },
        });
      }

      expect(await bagOf("Incident", missingKey)).toEqual({ Other: "A" });
    });

    test("a multi-select field's lists are renamed in place, and an option merged into one already chosen is listed once", async () => {
      const systems: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Affected Systems",
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: "EU-West\nEU-Central\nUS-East",
      });

      const both: ObjectID = await seed("Incident", {
        "Affected Systems": ["US-East", "EU-West", "EU-Central"],
      });
      const untouched: ObjectID = await seed("Incident", {
        "Affected Systems": ["US-East", "US-East"],
      });
      const single: ObjectID = await seed("Incident", {
        "Affected Systems": "EU-Central",
      });

      await renameOptions({
        service: IncidentCustomFieldService,
        id: systems.id!,
        dropdownOptions: "Europe\nUS-East",
        renames: [
          { from: "EU-West", to: "Europe" },
          { from: "EU-Central", to: "Europe" },
        ],
      });

      expect(await bagOf("Incident", both)).toEqual({
        "Affected Systems": ["US-East", "Europe"],
      });
      expect(await bagOf("Incident", untouched)).toEqual({
        "Affected Systems": ["US-East", "US-East"],
      });
      // A field switched from single to multi select still holds bare text.
      expect(await bagOf("Incident", single)).toEqual({
        "Affected Systems": "Europe",
      });
    });

    test("renames are made all at once, so swapping two options' names swaps them", async () => {
      const priority: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Priority",
        dropdownOptions: "High\nLow",
      });

      const high: ObjectID = await seed("Incident", { Priority: "High" });
      const low: ObjectID = await seed("Incident", { Priority: "Low" });

      await renameOptions({
        service: IncidentCustomFieldService,
        id: priority.id!,
        dropdownOptions: "Low\nHigh",
        renames: [
          { from: "High", to: "Low" },
          { from: "Low", to: "High" },
        ],
      });

      expect(await bagOf("Incident", high)).toEqual({ Priority: "Low" });
      expect(await bagOf("Incident", low)).toEqual({ Priority: "High" });
    });

    test("the incidents list's saved views and the incident forms' templates follow the rename", async () => {
      const facility: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B",
      });

      const incidentsView: ObjectID = await seedTableView({
        tableId: "all-incidents-table",
        facets: {
          facetSelections: {
            "customField:Facility": ["Facility A", "Facility B"],
          },
          facetOperators: { "customField:Facility": "is" },
        },
      });
      const monitorsView: ObjectID = await seedTableView({
        tableId: "all-monitors-table",
        facets: {
          facetSelections: { "customField:Facility": ["Facility A"] },
        },
      });
      const otherProjectsView: ObjectID = await seedTableView({
        tableId: "all-incidents-table",
        facets: {
          facetSelections: { "customField:Facility": ["Facility A"] },
        },
        project: otherProjectId,
      });

      const form: ObjectID = await seedForm({
        fields: [
          {
            id: "where",
            source: FormFieldSource.TargetCustomField,
            label: "Where?",
            isRequired: false,
            customFieldId: facility.id!.toString(),
          },
          {
            id: "own",
            source: FormFieldSource.Question,
            label: "Own question",
            isRequired: false,
            type: "Dropdown",
            dropdownOptions: "Facility A\nElse",
          },
        ],
        templates: [
          {
            id: "outage",
            name: "Outage",
            answers: { where: "Facility A", own: "Facility A" },
          },
        ],
      });

      await renameOptions({
        service: IncidentCustomFieldService,
        id: facility.id!,
        dropdownOptions: "Facility Alpha\nFacility B",
        renames: [{ from: "Facility A", to: "Facility Alpha" }],
      });

      const view: Row = await readRow("TableView", incidentsView);

      expect(view.facets).toEqual({
        facetSelections: {
          "customField:Facility": ["Facility Alpha", "Facility B"],
        },
        facetOperators: { "customField:Facility": "is" },
      });
      expect(new Date(view.updatedAt).toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );

      // A monitors list's field of the same name is a different field.
      expect((await readRow("TableView", monitorsView)).facets).toEqual({
        facetSelections: { "customField:Facility": ["Facility A"] },
      });
      expect((await readRow("TableView", otherProjectsView)).facets).toEqual({
        facetSelections: { "customField:Facility": ["Facility A"] },
      });

      expect((await readRow("Form", form)).templates).toEqual([
        {
          id: "outage",
          name: "Outage",
          // The form's own question is not the field.
          answers: { where: "Facility Alpha", own: "Facility A" },
        },
      ]);
    });

    test("options changed without saying which were renamed move nothing", async () => {
      const facility: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B",
      });

      const incident: ObjectID = await seed("Incident", {
        Facility: "Facility A",
      });

      await IncidentCustomFieldService.updateOneById({
        id: facility.id!,
        data: { dropdownOptions: "Facility Alpha\nFacility B" },
        props: adminProps(),
      });

      expect(await optionsOf("IncidentCustomField", facility.id!)).toBe(
        "Facility Alpha\nFacility B",
      );
      // The incident keeps what it holds, no longer an option.
      expect(await bagOf("Incident", incident)).toEqual({
        Facility: "Facility A",
      });
    });

    test("a rename onto text that is not an option is refused, and nothing changes", async () => {
      const facility: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B",
      });

      const incident: ObjectID = await seed("Incident", {
        Facility: "Facility A",
      });

      await expect(
        renameOptions({
          service: IncidentCustomFieldService,
          id: facility.id!,
          dropdownOptions: "Facility B",
          renames: [{ from: "Facility A", to: "Facility Alpha" }],
        }),
      ).rejects.toThrow('"Facility Alpha" is not one of the field\'s options.');

      expect(await optionsOf("IncidentCustomField", facility.id!)).toBe(
        "Facility A\nFacility B",
      );
      expect(await bagOf("Incident", incident)).toEqual({
        Facility: "Facility A",
      });
    });

    test("the stores move together or not at all, and a move that fails puts the options back", async () => {
      const facility: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B",
      });

      const incident: ObjectID = await seed("Incident", {
        Facility: "Facility A",
      });
      const template: ObjectID = await seed("IncidentTemplate", {
        Facility: "Facility A",
      });

      // The second store's statement fails.
      await database.query(
        `ALTER TABLE "${schema}"."IncidentTemplate" RENAME COLUMN "customFields" TO "customFieldsBroken"`,
      );

      try {
        await expect(
          renameOptions({
            service: IncidentCustomFieldService,
            id: facility.id!,
            dropdownOptions: "Facility Alpha\nFacility B",
            renames: [{ from: "Facility A", to: "Facility Alpha" }],
          }),
        ).rejects.toThrow();
      } finally {
        await database.query(
          `ALTER TABLE "${schema}"."IncidentTemplate" RENAME COLUMN "customFieldsBroken" TO "customFields"`,
        );
      }

      // The first store's move was rolled back with the second's.
      expect(await bagOf("Incident", incident)).toEqual({
        Facility: "Facility A",
      });
      expect(await bagOf("IncidentTemplate", template)).toEqual({
        Facility: "Facility A",
      });
      expect(await optionsOf("IncidentCustomField", facility.id!)).toBe(
        "Facility A\nFacility B",
      );

      // And the rename can simply be made again.
      await renameOptions({
        service: IncidentCustomFieldService,
        id: facility.id!,
        dropdownOptions: "Facility Alpha\nFacility B",
        renames: [{ from: "Facility A", to: "Facility Alpha" }],
      });

      expect(await bagOf("Incident", incident)).toEqual({
        Facility: "Facility Alpha",
      });
      expect(await bagOf("IncidentTemplate", template)).toEqual({
        Facility: "Facility Alpha",
      });
    });

    test("renaming a monitor field's option renames it on the incident and alert fields that copy it", async () => {
      const monitorFacility: MonitorCustomField = await createField({
        service: MonitorCustomFieldService,
        modelType: MonitorCustomField,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B",
      });

      const incidentFacility: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B\nFacility Z",
        mapFromCustomFieldName: "Facility",
      });

      const alertSite: AlertCustomField = await createField({
        service: AlertCustomFieldService,
        modelType: AlertCustomField,
        name: "Site",
        dropdownOptions: "Facility A\nFacility B",
        mapFromCustomFieldName: "Facility",
      });

      const monitor: ObjectID = await seed("Monitor", {
        Facility: "Facility A",
      });
      const monitorTemplate: ObjectID = await seed("MonitorTemplate", {
        Facility: "Facility A",
      });
      const incident: ObjectID = await seed("Incident", {
        Facility: "Facility A",
      });
      const alert: ObjectID = await seed("Alert", { Site: "Facility A" });

      await renameOptions({
        service: MonitorCustomFieldService,
        id: monitorFacility.id!,
        dropdownOptions: "Facility Alpha\nFacility B\nFacility D",
        renames: [{ from: "Facility A", to: "Facility Alpha" }],
      });

      expect(await bagOf("Monitor", monitor)).toEqual({
        Facility: "Facility Alpha",
      });
      expect(await bagOf("MonitorTemplate", monitorTemplate)).toEqual({
        Facility: "Facility Alpha",
      });

      // The copying fields offer the renamed option and the new one.
      expect(await optionsOf("IncidentCustomField", incidentFacility.id!)).toBe(
        "Facility Alpha\nFacility B\nFacility Z\nFacility D",
      );
      expect(await optionsOf("AlertCustomField", alertSite.id!)).toBe(
        "Facility Alpha\nFacility B\nFacility D",
      );

      // And their values moved with it.
      expect(await bagOf("Incident", incident)).toEqual({
        Facility: "Facility Alpha",
      });
      expect(await bagOf("Alert", alert)).toEqual({ Site: "Facility Alpha" });
    });

    test("the option editor's counts are of the project's live records, a record counted once per value", async () => {
      const facility: IncidentCustomField = await createField({
        service: IncidentCustomFieldService,
        modelType: IncidentCustomField,
        name: "Facility",
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: "Facility A\nFacility B",
      });

      await seed("Incident", { Facility: "Facility A" });
      await seed("Incident", {
        Facility: ["Facility A", "Facility B", "Facility A"],
      });
      await seed("Incident", { Facility: ["Facility B"] });
      await seed("Incident", { Facility: "Old Site" });
      await seed("Incident", { Facility: 5 });
      await seed("Incident", { Facility: "" });
      await seed("Incident", { Facility: null });
      await seed("Incident", { Facility: { nested: "Facility A" } });
      await seed("Incident", { Facility: [{ nested: "Facility A" }] });
      await seed("Incident", { Other: "Facility A" });
      await seed("Incident", { Facility: "Facility A" }, { deleted: true });
      await seed(
        "Incident",
        { Facility: "Facility A" },
        { project: otherProjectId },
      );
      // Templates are not records.
      await seed("IncidentTemplate", { Facility: "Facility B" });

      const counted: Array<CustomFieldOptionUsageValue> =
        await countCustomFieldOptionValues({
          service: IncidentService,
          projectId: projectId,
          fieldName: "Facility",
        });

      expect(counted).toEqual([
        { value: "Facility A", count: 2 },
        { value: "Facility B", count: 2 },
        { value: "5", count: 1 },
        { value: "Old Site", count: 1 },
      ]);

      // As the API answers it, to an admin of the project.
      const usage: CustomFieldOptionUsage = await getCustomFieldOptionUsage({
        definitionModelType: IncidentCustomField,
        definitionService: IncidentCustomFieldService,
        fieldId: facility.id!,
        props: adminProps(),
      });

      expect(usage).toEqual({ values: counted, copiedBy: [] });
    });

    test("it is the same for a resource with no templates: a team field's options", async () => {
      const tier: TeamCustomField = await createField({
        service: TeamCustomFieldService,
        modelType: TeamCustomField,
        name: "Tier",
        dropdownOptions: "Platinum\nSilver",
      });

      const team: ObjectID = await seed("Team", { Tier: "Platinum" });
      const otherTeam: ObjectID = await seed("Team", { Tier: "Silver" });

      await renameOptions({
        service: TeamCustomFieldService,
        id: tier.id!,
        dropdownOptions: "Gold\nSilver",
        renames: [{ from: "Platinum", to: "Gold" }],
      });

      expect(await bagOf("Team", team)).toEqual({ Tier: "Gold" });
      expect(await bagOf("Team", otherTeam)).toEqual({ Tier: "Silver" });
      expect((await readRow("Team", team)).version).toBe(3);
    });
  },
);
