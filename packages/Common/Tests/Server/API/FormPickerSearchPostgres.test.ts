import { mockRouter } from "./Helpers";
import PostgresListRouteHarness, {
  ListedPage,
  ListRequest,
  valuesOf,
} from "./PostgresListRouteHarness";
import ArchivableValueAPI from "../../../Server/API/ArchivableValueAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import OnCallDutyPolicyAPI from "../../../Server/API/OnCallDutyPolicyAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import IncidentSeverityService, {
  Service as IncidentSeverityServiceType,
} from "../../../Server/Services/IncidentSeverityService";
import IncidentTemplateService, {
  Service as IncidentTemplateServiceType,
} from "../../../Server/Services/IncidentTemplateService";
import LabelService, {
  Service as LabelServiceType,
} from "../../../Server/Services/LabelService";
import TeamService, {
  Service as TeamServiceType,
} from "../../../Server/Services/TeamService";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Team from "../../../Models/DatabaseModels/Team";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { FormTargetSettingReferenceModel } from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { withSearch } from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import Field from "../../../UI/Components/Forms/Types/Field";
import ArchivedValuePicker from "../../../UI/Utils/ArchivedValuePicker";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import {
  FormReferenceData,
  FormReferenceRecord,
  loadFormReferenceData,
  nameRecords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData";
import { getFormSettingsFields } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormSettingsEditor";
import {
  FORM_RECORD_OPTIONS_SOURCES,
  FormRecordOptionsSource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData";
import {
  FormQuestionData,
  loadFormQuestionData,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Templates/FormQuestionData";
import { FormField, FormFieldSource } from "../../../Types/Form/FormField";
import {
  buildPublicForm,
  PublicFormField,
  PublicFormFieldOption,
} from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A FORM'S ON SUBMIT SETTINGS, READ AND SEARCHED THROUGH THE REAL SERVER
 * (#10646).
 *
 * The On Submit page read every monitor of the project - the first 10,000
 * by name - to name the ones a form always attaches, and its settings
 * dialog kept only the saved monitors it found among them. A monitor whose
 * name sorts past the 10,000th ("WB1500KSK02") read "Deleted", and the next
 * save of the dialog dropped it from the form.
 *
 * Here the page's own read code (loadFormReferenceData) and the dialog's own
 * picker queries (getFormSettingsFields' dropdownModal, as EntityDropdown
 * sends them) go through the list routes the app registers, as a member, on
 * migrated Postgres (PostgresListRouteHarness): the saved monitor past the
 * 10,000th is named by its id, one deleted since is not found, the pickers'
 * searches find what the old read never had, and each keeps its own rules -
 * another project's records never, an archived label never offered, a
 * member limited to a label finds only that label's monitors.
 *
 * A choice question offering monitors had the same shape: the builder, the
 * Templates page and Duplicate Form read the project's monitors whole and
 * looked for the question's among them. They read what a question offers
 * by its ids now, as the server does for the public page, and the
 * builder's Choices Offered searches the server.
 *
 * Opt in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true (see the harness).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PICKER_SEARCH_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source is the harness's; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The page's old read, and how many monitors sort before "WB".
const OLD_CAP: number = LIMIT_PER_PROJECT;
const MONITORS_BEFORE_WB: number = LIMIT_PER_PROJECT + 50;
const PICKER_PAGE_SIZE: number = 50;

describePostgres(
  "a form's On Submit settings and choice questions, read and searched through the real server (#10646)",
  () => {
    const harness: PostgresListRouteHarness = new PostgresListRouteHarness({
      schemaPrefix: "form_on_submit",
      tables: [
        "Monitor",
        "MonitorLabel",
        "IncidentSeverity",
        "IncidentTemplate",
        "OnCallDutyPolicy",
        "StatusPage",
      ],
    });

    // The list routes, as the app registers them.
    new MonitorAPI();
    new ArchivableValueAPI<Label, LabelServiceType>(Label, LabelService);
    new ArchivableValueAPI<IncidentSeverity, IncidentSeverityServiceType>(
      IncidentSeverity,
      IncidentSeverityService,
    );
    new BaseAPI<IncidentTemplate, IncidentTemplateServiceType>(
      IncidentTemplate,
      IncidentTemplateService,
    );
    new OnCallDutyPolicyAPI();
    new StatusPageAPI();
    new BaseAPI<Team, TeamServiceType>(Team, TeamService);
    new TeamMemberAPI();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const memberId: ObjectID = ObjectID.generate();
    const memberTeamId: ObjectID = ObjectID.generate();
    const kioskMemberId: ObjectID = ObjectID.generate();
    const kioskLabelId: ObjectID = ObjectID.generate();
    const monitorStatusId: ObjectID = ObjectID.generate();

    const lateMonitorId: ObjectID = ObjectID.generate();
    const otherLateMonitorId: ObjectID = ObjectID.generate();
    const otherProjectMonitorId: ObjectID = ObjectID.generate();
    // Never inserted: a monitor the settings name, deleted since.
    const deletedMonitorId: ObjectID = ObjectID.generate();
    const liveLabelId: ObjectID = ObjectID.generate();
    const archivedLabelId: ObjectID = ObjectID.generate();
    const severityId: ObjectID = ObjectID.generate();

    const insertMonitor: (data: {
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      inProject?: ObjectID | undefined;
      labelId?: ObjectID | undefined;
    }): Promise<void> => {
      await harness.insert("Monitor", {
        _id: data.id,
        version: 1,
        projectId: data.inProject || projectId,
        name: data.name,
        slug: `monitor-${data.id.toString()}`,
        monitorType: MonitorType.Ping,
        currentMonitorStatusId: monitorStatusId,
        isArchived: false,
      });

      if (data.labelId) {
        await harness.insert("MonitorLabel", {
          monitorId: data.id,
          labelId: data.labelId,
        });
      }
    };

    // A search typed into one of the dialog's pickers, as EntityDropdown sends it.
    const searchField: (data: {
      field: Field<JSONObject>;
      text: string;
      asUserId?: ObjectID | undefined;
    }) => Promise<ListedPage> = async (data: {
      field: Field<JSONObject>;
      text: string;
      asUserId?: ObjectID | undefined;
    }): Promise<ListedPage> => {
      const modal: NonNullable<Field<JSONObject>["dropdownModal"]> =
        data.field.dropdownModal!;

      return await harness.list({
        path: new modal.type().crudApiPath!.toString(),
        query: withSearch(
          ArchivedValuePicker.getPickerQuery(modal.type, modal.query),
          modal.labelField,
          data.text,
        ),
        select: { _id: true, [modal.labelField]: true },
        sort: { [modal.labelField]: SortOrder.Ascending },
        limit: PICKER_PAGE_SIZE,
        userId: data.asUserId || memberId,
        projectId: projectId,
      });
    };

    const fieldFor: (key: string) => Field<JSONObject> = (
      key: string,
    ): Field<JSONObject> => {
      const field: Field<JSONObject> | undefined = getFormSettingsFields({
        targetType: FormTargetType.Incident,
        reference: { lists: {}, templateIdsWithSeverity: [] },
      }).find((candidate: Field<JSONObject>): boolean => {
        return Object.keys(candidate.field || {})[0] === key;
      });

      expect(field?.dropdownModal).toBeDefined();
      return field!;
    };

    beforeAll(async () => {
      await harness.setUp();

      await harness.insertProject(projectId, "Kiosk fleet");
      await harness.insertProject(otherProjectId, "Another project");

      await harness.insertMember({
        userId: memberId,
        projectId: projectId,
        teamId: memberTeamId,
        permission: Permission.ProjectMember,
      });

      await harness.insertLabel({
        id: kioskLabelId,
        projectId: projectId,
        name: "SubCategory: Kiosk",
      });

      await harness.insertMember({
        userId: kioskMemberId,
        projectId: projectId,
        teamId: ObjectID.generate(),
        permission: Permission.ProjectMember,
        labelIds: [kioskLabelId],
      });

      // More monitors than the page ever read, all named before "WB".
      await harness.query(
        `INSERT INTO "${harness.schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "isArchived")
         SELECT gen_random_uuid(), 1, $1, 'AP' || lpad(i::text, 6, '0'), 'monitor-' || gen_random_uuid(), $2, $3, false
         FROM generate_series(1, $4) AS i`,
        [
          projectId.toString(),
          MonitorType.Ping,
          monitorStatusId.toString(),
          MONITORS_BEFORE_WB,
        ],
      );

      await insertMonitor({
        id: lateMonitorId,
        name: "WB1500KSK02",
        labelId: kioskLabelId,
      });
      await insertMonitor({ id: otherLateMonitorId, name: "WB1500KSK03" });
      await insertMonitor({
        id: otherProjectMonitorId,
        name: "WB1500KSK04",
        inProject: otherProjectId,
      });

      await harness.insertLabel({
        id: liveLabelId,
        projectId: projectId,
        name: "customer-report",
      });
      await harness.insertLabel({
        id: archivedLabelId,
        projectId: projectId,
        name: "customer-old",
      });
      await harness.query(
        `UPDATE "${harness.schema}"."Label" SET "isArchived" = true WHERE "_id" = $1`,
        [archivedLabelId.toString()],
      );

      await harness.insert("IncidentSeverity", {
        _id: severityId,
        version: 1,
        projectId: projectId,
        name: "Major",
        slug: `severity-${severityId.toString()}`,
        color: "#ef4444",
        order: 1,
      });

      await harness.analyze("Monitor");
    }, 600000);

    beforeEach(() => {
      getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
        projectId,
      );
    });

    afterAll(async () => {
      await harness.tearDown();
    });

    test("the page's old read never had WB1500KSK02: the first 10,000 by name", async () => {
      const read: ListedPage<Monitor> = await harness.list<Monitor>({
        path: "/monitor",
        query: { projectId: projectId },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: OLD_CAP,
        userId: memberId,
        projectId: projectId,
      });

      expect(read.rows).toHaveLength(OLD_CAP);
      expect(read.count).toBe(MONITORS_BEFORE_WB + 2);
      expect(valuesOf(read, "name")).not.toContain("WB1500KSK02");
    });

    describe("the card's names: the settings' records, read by their ids", () => {
      test("names the saved monitor past the 10,000th, and finds none for one deleted since", async () => {
        const reads: Array<ListRequest> = harness.routeModelAPIReads({
          userId: memberId,
          projectId: projectId,
        });

        const reference: FormReferenceData = await loadFormReferenceData(
          FormTargetType.Incident,
          {
            incidentSeverityId: severityId.toString(),
            monitorIds: [deletedMonitorId.toString(), lateMonitorId.toString()],
            labelIds: [archivedLabelId.toString()],
            ownerUserIds: [memberId.toString()],
            ownerTeamIds: [memberTeamId.toString()],
          },
        );

        expect(
          nameRecords({
            lists: reference.lists,
            model: FormTargetSettingReferenceModel.Monitor,
            ids: [deletedMonitorId.toString(), lateMonitorId.toString()],
          }),
        ).toEqual([
          { name: "", isDeleted: true },
          { name: "WB1500KSK02", isDeleted: false },
        ]);

        // Read by its id, and named so: a held archived label is not gone.
        expect(reference.lists[FormTargetSettingReferenceModel.Label]).toEqual([
          {
            id: archivedLabelId.toString(),
            name: "customer-old",
            color: "#6366f1",
            isArchived: true,
          } as FormReferenceRecord,
        ]);

        // Owners, read through the project's memberships.
        expect(
          nameRecords({
            lists: reference.lists,
            model: FormTargetSettingReferenceModel.User,
            ids: [memberId.toString()],
          }),
        ).toEqual([{ name: "Synthetic Member", isDeleted: false }]);
        expect(
          nameRecords({
            lists: reference.lists,
            model: FormTargetSettingReferenceModel.Team,
            ids: [memberTeamId.toString()],
          }),
        ).toEqual([
          { name: `Team ${memberTeamId.toString()}`, isDeleted: false },
        ]);

        // The severity picker's short list, read whole.
        expect(
          reference.lists[FormTargetSettingReferenceModel.IncidentSeverity],
        ).toEqual([
          { id: severityId.toString(), name: "Major", color: "#ef4444" },
        ]);

        // No read of the project's monitors whole: only the two held.
        const monitorReads: Array<ListRequest> = reads.filter(
          (read: ListRequest): boolean => {
            return read.path === "/monitor";
          },
        );

        expect(monitorReads).toHaveLength(1);
        expect(monitorReads[0]!.limit).toBe(2);
      });

      test("never names another project's monitor, even when the settings name it", async () => {
        harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

        const reference: FormReferenceData = await loadFormReferenceData(
          FormTargetType.Incident,
          { monitorIds: [otherProjectMonitorId.toString()] },
        );

        expect(
          nameRecords({
            lists: reference.lists,
            model: FormTargetSettingReferenceModel.Monitor,
            ids: [otherProjectMonitorId.toString()],
          }),
        ).toEqual([{ name: "", isDeleted: true }]);
      });
    });

    describe("the dialog's pickers: searched on the server", () => {
      test("the Monitors picker finds WB1500KSK02 past the 10,000th", async () => {
        const page: ListedPage = await searchField({
          field: fieldFor("monitorIds"),
          text: "WB1500KSK0",
        });

        expect(valuesOf(page, "name")).toEqual(["WB1500KSK02", "WB1500KSK03"]);
        expect(page.count).toBe(2);
      });

      test("with nothing typed, lists 50 by name and counts every monitor of the project", async () => {
        const page: ListedPage = await searchField({
          field: fieldFor("monitorIds"),
          text: "",
        });

        expect(page.rows).toHaveLength(PICKER_PAGE_SIZE);
        expect(page.count).toBe(MONITORS_BEFORE_WB + 2);
      });

      test("never another project's monitor", async () => {
        expect(
          valuesOf(
            await searchField({
              field: fieldFor("monitorIds"),
              text: "WB1500KSK04",
            }),
            "name",
          ),
        ).toEqual([]);
      });

      test("a member limited to a label finds only that label's monitors", async () => {
        expect(
          valuesOf(
            await searchField({
              field: fieldFor("monitorIds"),
              text: "WB1500",
              asUserId: kioskMemberId,
            }),
            "name",
          ),
        ).toEqual(["WB1500KSK02"]);
      });

      test("the Labels picker never offers an archived label", async () => {
        expect(
          valuesOf(
            await searchField({
              field: fieldFor("labelIds"),
              text: "customer",
            }),
            "name",
          ),
        ).toEqual(["customer-report"]);
      });
    });

    /*
     * A choice question offers the records it names. The builder, the
     * Templates page and Duplicate Form read them by their ids now, as the
     * server reads them for the public page (FormRecordOptions); the
     * builder's Choices Offered searches the server.
     */
    describe("a form's choice questions", () => {
      const offeredBy: (data: {
        question: FormField;
        questionData: FormQuestionData;
      }) => Array<string> = (data: {
        question: FormField;
        questionData: FormQuestionData;
      }): Array<string> => {
        const field: PublicFormField | undefined = buildPublicForm({
          form: {
            name: "Report",
            fields: [data.question] as never,
            targetType: FormTargetType.Incident,
          },
          customFields: data.questionData.customFields,
          recordOptions: data.questionData.recordOptions,
          isCaptchaRequired: false,
        }).allFields.find((candidate: PublicFormField): boolean => {
          return candidate.id === data.question.id;
        });

        return (field?.options || []).map(
          (option: PublicFormFieldOption): string => {
            return option.label;
          },
        );
      };

      test("a question offering the monitor past the 10,000th offers it; one deleted since is not there", async () => {
        const reads: Array<ListRequest> = harness.routeModelAPIReads({
          userId: memberId,
          projectId: projectId,
        });

        const question: FormField = {
          id: "monitors",
          source: FormFieldSource.TargetField,
          targetField: "monitors",
          label: "Affected Monitors",
          isRequired: false,
          allowedOptionIds: [
            lateMonitorId.toString(),
            deletedMonitorId.toString(),
          ],
        };

        expect(
          offeredBy({
            question,
            questionData: await loadFormQuestionData({
              targetType: FormTargetType.Incident,
              fields: [question],
            }),
          }),
        ).toEqual(["WB1500KSK02"]);

        // The two it names, by their ids: never the project's whole.
        expect(
          reads.map((read: ListRequest): [string, number] => {
            return [read.path, read.limit];
          }),
        ).toEqual([["/monitor", 2]]);
      });

      test("a question offering an archived label offers only the live one, as the public page does", async () => {
        harness.routeModelAPIReads({ userId: memberId, projectId: projectId });

        const question: FormField = {
          id: "labels",
          source: FormFieldSource.TargetField,
          targetField: "labels",
          label: "Labels",
          isRequired: false,
          allowedOptionIds: [
            liveLabelId.toString(),
            archivedLabelId.toString(),
          ],
        };

        expect(
          offeredBy({
            question,
            questionData: await loadFormQuestionData({
              targetType: FormTargetType.Incident,
              fields: [question],
            }),
          }),
        ).toEqual(["customer-report"]);
      });

      test("Choices Offered finds the monitor past the 10,000th, and never another project's", async () => {
        const monitors: FormRecordOptionsSource =
          FORM_RECORD_OPTIONS_SOURCES[FormTargetOptionsSource.Monitor];

        const search: (text: string) => Promise<ListedPage> = async (
          text: string,
        ): Promise<ListedPage> => {
          return await harness.list({
            path: "/monitor",
            query: withSearch(
              ArchivedValuePicker.getPickerQuery(
                monitors.modelType,
                monitors.query,
              ),
              "name",
              text,
            ),
            select: { _id: true, name: true },
            sort: { name: SortOrder.Ascending },
            limit: PICKER_PAGE_SIZE,
            userId: memberId,
            projectId: projectId,
          });
        };

        expect(valuesOf(await search("WB1500KSK0"), "name")).toEqual([
          "WB1500KSK02",
          "WB1500KSK03",
        ]);
        expect(valuesOf(await search("WB1500KSK04"), "name")).toEqual([]);
      });
    });
  },
);
