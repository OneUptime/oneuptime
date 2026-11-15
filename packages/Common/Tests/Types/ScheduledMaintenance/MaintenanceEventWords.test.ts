import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import Project from "../../../Models/DatabaseModels/Project";
import PublicNoteApprovalRequest from "../../../Models/DatabaseModels/PublicNoteApprovalRequest";
import PublicNoteApprovalStep from "../../../Models/DatabaseModels/PublicNoteApprovalStep";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCalendarFeed from "../../../Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import ScheduledMaintenanceLabelRule from "../../../Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementValue from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import ScheduledMaintenanceOwnerRule from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import ScheduledMaintenanceOwnerTeam from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import WorkspacePublicNoteApprovalMessage from "../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { UniqueColumnsTogetherMetadata } from "../../../Types/Database/UniqueColumnsTogether";
import {
  FormTargetFieldDefinition,
  getFormTargetField,
} from "../../../Types/Form/FormTargetCatalog";
import FormTargetType, {
  FORM_TARGET_TYPE_TEXT,
  FormTargetTypeText,
} from "../../../Types/Form/FormTargetType";
import { DefaultUptimeHistoryLabels } from "../../../Types/Monitor/UptimeHistoryLabels";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import {
  RULE_RUN_TYPE_METADATA,
  RuleRunType,
} from "../../../Types/Rules/RuleRun";
import MaintenanceCalendar, {
  MaintenanceCalendarAudience,
} from "../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import { ROWS_KEPT_ON_DELETE_BY_QUERY } from "../../../Types/StateTimeline/RowsKeptOnDelete";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { nameInSentence } from "../../../Types/Workflow/RunRecord";
import {
  getWorkflowTemplatesByCategory,
  WorkflowTemplate,
  WorkflowTemplateCategory,
} from "../../../Types/Workflow/Templates";
import { DELETE_CONSEQUENCES } from "../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  NUMBERED_RECORD_KINDS,
  NumberedRecordKind,
  NumberedRecordKindInfo,
} from "../../../Utils/Project/NextNumber";
import { getSloNotice, SloNotice } from "../../../Utils/Slo/SloHealth";
import { STATE_LISTS, StateListType } from "../../../Utils/StateOrder";
import {
  ONLY_STATE_DELETE_MESSAGES,
  StateTimelineRecord,
} from "../../../Utils/StateTimeline/StateTimelineRowDelete";
import { describe, expect, test } from "@jest/globals";

/*
 * #6817 named one record of Scheduled Maintenance a Maintenance Event, and
 * the words Common writes for it kept the old name in lower case (#7825):
 * the nouns its sentences are built from ("You do not have permission to add
 * owners to scheduled maintenance events"), its own sentences, and its
 * models' descriptions, which the API reference, the Terraform provider and
 * the dashboard's forms show. A reader met both names on one page: a
 * "Maintenance Event" whose help said "scheduled maintenance event".
 *
 * Scheduled Maintenance stays the product's name, so the words that name the
 * product keep it: "Scheduled Maintenance Numbers Start At", "Scheduled
 * Maintenance Member", a form target titled "Scheduled Maintenance".
 */

// The retired name, in any case: "scheduled maintenance event(s)".
const RETIRED_NAME: RegExp = /scheduled maintenance events?/i;

const MAINTENANCE: ScheduledMaintenance = new ScheduledMaintenance();

// The record's name in the middle of a sentence, as the model gives it.
const SINGULAR: string = nameInSentence(MAINTENANCE.singularName || "");
const PLURAL: string = nameInSentence(MAINTENANCE.pluralName || "");

describe("the record's name in a sentence", () => {
  test("is the model's own name, as a sentence says it: maintenance event", () => {
    expect([SINGULAR, PLURAL]).toEqual([
      "maintenance event",
      "maintenance events",
    ]);
  });
});

describe("the nouns Common fills sentences with name the record as the model does", () => {
  test.each([
    RuleRunType.ScheduledMaintenanceLabelRule,
    RuleRunType.ScheduledMaintenanceOwnerRule,
  ])("%s's resources", (ruleType: RuleRunType) => {
    expect({
      singular: RULE_RUN_TYPE_METADATA[ruleType].resourceSingular,
      plural: RULE_RUN_TYPE_METADATA[ruleType].resourcePlural,
    }).toEqual({ singular: SINGULAR, plural: PLURAL });
  });

  test("the maintenance state list's subject", () => {
    expect(
      STATE_LISTS[StateListType.ScheduledMaintenanceState].subject,
    ).toEqual({ singular: SINGULAR, plural: PLURAL });
  });

  test("the numbered record's name, beside the product's name on the setting", () => {
    const info: NumberedRecordKindInfo | undefined = NUMBERED_RECORD_KINDS.find(
      (kind: NumberedRecordKindInfo): boolean => {
        return kind.kind === NumberedRecordKind.ScheduledMaintenance;
      },
    );

    expect({ title: info?.title, recordName: info?.recordName }).toEqual({
      title: "Scheduled Maintenance Numbers Start At",
      recordName: SINGULAR,
    });
  });

  test("the form target's noun, beside the product's name as its title", () => {
    const text: FormTargetTypeText =
      FORM_TARGET_TYPE_TEXT[FormTargetType.ScheduledMaintenance];

    expect({
      title: text.title,
      noun: text.noun,
      nounWithArticle: text.nounWithArticle,
    }).toEqual({
      title: "Scheduled Maintenance",
      noun: SINGULAR,
      nounWithArticle: `a ${SINGULAR}`,
    });
  });

  test("what deleting a maintenance state timeline by query keeps", () => {
    expect(
      ROWS_KEPT_ON_DELETE_BY_QUERY["ScheduledMaintenanceStateTimeline"]
        ?.whatStays,
    ).toBe(`each ${SINGULAR}'s current state`);
  });

  test("the uptime strip's count of a day's maintenance", () => {
    expect([
      DefaultUptimeHistoryLabels.oneMaintenanceEvent,
      DefaultUptimeHistoryLabels.maintenanceEvents,
    ]).toEqual([`1 ${SINGULAR}`, `{{total}} ${PLURAL}`]);
  });
});

describe("Common's sentences about the record call it a maintenance event", () => {
  function permissionDescription(permission: Permission): string {
    return (
      PermissionHelper.getAllPermissionProps().find(
        (props: PermissionProps): boolean => {
          return props.permission === permission;
        },
      )?.description || ""
    );
  }

  function formFieldDescription(key: string): string {
    const field: FormTargetFieldDefinition | undefined = getFormTargetField(
      FormTargetType.ScheduledMaintenance,
      key,
    );

    return field?.description || "";
  }

  function workflowDescription(name: string): string {
    const template: WorkflowTemplate | undefined =
      getWorkflowTemplatesByCategory(
        WorkflowTemplateCategory.ScheduledMaintenance,
      ).find((candidate: WorkflowTemplate): boolean => {
        return candidate.workflowName === name;
      });

    return template?.workflowDescription || "";
  }

  const pausedSlo: SloNotice | null = getSloNotice({
    isEnabled: true,
    sloStatus: SloStatus.Paused,
    sliType: SliType.MonitorUptime,
    monitorCount: 2,
    targetPercentage: 99.9,
    lastEvaluatedAt: new Date(),
  });

  test.each([
    [
      "the only state's refusal",
      ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.ScheduledMaintenance],
    ],
    ["a form's Title field", formFieldDescription("title")],
    ["a form's Description field", formFieldDescription("description")],
    [
      "a quiet event's Notify Subscribers box",
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    ],
    [
      "the Scheduled Maintenance Member role",
      permissionDescription(Permission.ScheduledMaintenanceMember),
    ],
    [
      "the Create Form permission",
      permissionDescription(Permission.CreateForm),
    ],
    [
      "the team's maintenance calendar",
      MaintenanceCalendar.getCalendarDescription({
        audience: MaintenanceCalendarAudience.Team,
        name: "Acme Production",
      }),
    ],
    [
      "the Slack announcement workflow",
      workflowDescription("Announce maintenance in Slack"),
    ],
    [
      "the Mattermost announcement workflow",
      workflowDescription("Announce maintenance in Mattermost"),
    ],
    [
      "a delete's consequences",
      DELETE_CONSEQUENCES["ScheduledMaintenance"]?.sentence || "",
    ],
    ["a paused SLO's notice", pausedSlo?.body || ""],
  ])("%s", (_where: string, sentence: string) => {
    expect(sentence).toContain(SINGULAR);
    expect(sentence).not.toMatch(RETIRED_NAME);
  });

  test("no permission's description uses the retired name", () => {
    const retired: Array<string> = PermissionHelper.getAllPermissionProps()
      .filter((props: PermissionProps): boolean => {
        return RETIRED_NAME.test(props.description);
      })
      .map((props: PermissionProps): string => {
        return props.title;
      });

    expect(retired).toEqual([]);
  });

  test("no maintenance workflow template uses the retired name", () => {
    const retired: Array<string> = getWorkflowTemplatesByCategory(
      WorkflowTemplateCategory.ScheduledMaintenance,
    )
      .filter((template: WorkflowTemplate): boolean => {
        return RETIRED_NAME.test(
          [
            template.name,
            template.description,
            template.teaches,
            template.workflowName,
            template.workflowDescription,
          ].join("\n"),
        );
      })
      .map((template: WorkflowTemplate): string => {
        return template.id;
      });

    expect(retired).toEqual([]);
  });
});

/*
 * The models whose descriptions name the record: their table descriptions,
 * their columns' titles and descriptions, and what they say when a row is
 * one they have already (two owners refuse a second row for one owner).
 */
describe("the models' descriptions call the record a maintenance event", () => {
  const MODELS: Array<DatabaseBaseModel> = [
    new Form(),
    new FormSubmission(),
    new Project(),
    new PublicNoteApprovalRequest(),
    new PublicNoteApprovalStep(),
    new RunbookExecution(),
    new RunbookRule(),
    new ScheduledMaintenance(),
    new ScheduledMaintenanceCalendarFeed(),
    new ScheduledMaintenanceLabelRule(),
    new ScheduledMaintenanceMeasurement(),
    new ScheduledMaintenanceMeasurementValue(),
    new ScheduledMaintenanceOwnerRule(),
    new ScheduledMaintenanceOwnerTeam(),
    new ScheduledMaintenanceOwnerUser(),
    new ScheduledMaintenancePublicNote(),
    new ScheduledMaintenanceReminderRule(),
    new ScheduledMaintenanceStateTimeline(),
    new ScheduledMaintenanceTemplate(),
    new WorkspacePublicNoteApprovalMessage(),
  ];

  function textsOf(model: DatabaseBaseModel): Array<string> {
    const texts: Array<string> = [model.tableDescription || ""];

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      texts.push(metadata.title || "", metadata.description || "");
    }

    for (const unique of model.getUniqueColumnsTogether()) {
      texts.push(unique.errorMessage);
    }

    return texts.filter((text: string): boolean => {
      return text !== "";
    });
  }

  test.each(
    MODELS.map((model: DatabaseBaseModel): [string, DatabaseBaseModel] => {
      return [model.tableName || "", model];
    }),
  )("%s", (_tableName: string, model: DatabaseBaseModel) => {
    const texts: Array<string> = textsOf(model);

    expect(
      texts.filter((text: string): boolean => {
        return RETIRED_NAME.test(text);
      }),
    ).toEqual([]);

    // Each still names the record somewhere, so this list stays the right one.
    expect(
      texts.some((text: string): boolean => {
        return text.toLowerCase().includes(SINGULAR);
      }),
    ).toBe(true);
  });

  test("a second owner row is refused in the record's name", () => {
    const refusals: Array<string> = [
      new ScheduledMaintenanceOwnerUser(),
      new ScheduledMaintenanceOwnerTeam(),
    ].flatMap((model: DatabaseBaseModel): Array<string> => {
      return model
        .getUniqueColumnsTogether()
        .map((unique: UniqueColumnsTogetherMetadata): string => {
          return unique.errorMessage;
        });
    });

    expect(refusals).toEqual([
      "This user is already an owner of this maintenance event.",
      "This team is already an owner of this maintenance event.",
    ]);
  });
});
