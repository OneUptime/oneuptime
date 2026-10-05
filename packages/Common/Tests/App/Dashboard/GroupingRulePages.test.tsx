import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission from "../../../Types/Permission";

/*
 * How the Incident and Alert Grouping Rules pages wire the simplified
 * experience into their tables: what the list shows and selects, the
 * ready-made rules in place of an empty list and behind the card's "Create
 * from Template" button, the blank rule's starting values, which steps show
 * when, the one More fields fold everything beyond grouping sits in, and
 * that the form still reaches every column the old one did - the
 * simplification hides choices, it removes none.
 *
 * ModelTable is a stand-in that records its props and draws the parts these
 * pages hand it (the card's buttons, the empty-list panel).
 */

const createMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return createMock(...args);
      },
    },
  };
});

let userPermissions: Array<Permission> = [Permission.ProjectOwner];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return userPermissions;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

interface CardButton {
  title: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
}

interface CapturedColumn {
  title: string;
  id?: string | undefined;
  field: Record<string, unknown>;
  getElement?: ((item: unknown) => ReactElement) | undefined;
  getExportValue?: ((item: unknown) => string) | undefined;
}

interface CapturedTable {
  modelType: unknown;
  id: string;
  name: string;
  cardProps: { title: string; description: string; buttons: Array<CardButton> };
  helpContent: { title: string; markdown: string };
  columns: Array<CapturedColumn>;
  filters: Array<{ field: Record<string, unknown>; title: string }>;
  selectMoreFields: Record<string, unknown>;
  formFields: Array<ModelField<any>>;
  formSteps: Array<FormStep<any>>;
  createInitialValues: Record<string, unknown>;
  noItemsMessage: ReactElement;
  showCreateForm: boolean;
  onCreateEditModalClose: () => void;
  refreshToggle: string;
  sortBy: string;
  sortOrder: SortOrder;
  enableDragAndDrop: boolean;
  dragDropIndexField: string;
  isCreateable: boolean;
  isEditable: boolean;
  isDeleteable: boolean;
  createEditModalWidth: ModalWidth;
}

let capturedTables: Array<CapturedTable> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable): ReactElement => {
      capturedTables.push(props);

      return (
        <div data-testid="model-table">
          <div data-testid="card-buttons">
            {props.cardProps.buttons.map((button: CardButton): ReactElement => {
              return (
                <button
                  key={button.title}
                  type="button"
                  disabled={button.disabled}
                  title={button.tooltip}
                  onClick={button.onClick}
                >
                  {button.title}
                </button>
              );
            })}
          </div>
          <div data-testid="empty-list">{props.noItemsMessage}</div>
        </div>
      );
    },
  };
});

import IncidentGroupingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentGroupingRules";
import AlertGroupingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertGroupingRules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  EPISODE_OWNERS_FIELD_KEY,
  EPISODE_OWNER_TEAMS_COLUMN,
  EPISODE_OWNER_USERS_COLUMN,
  GROUPING_MODE_FIELD_KEY,
  GROUPING_RULE_COPY,
  GroupingMode,
  GroupingRuleKind,
  LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY,
  LegacyDefaultAssigneeAction,
  getGroupingRuleSummarySelect,
  getNewGroupingRuleValues,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "../../../UI/Components/Forms/Types/Field";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import { ModalWidth } from "../../../UI/Components/Modal/Modal";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project/settings/grouping-rules"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface PageCase {
  kind: GroupingRuleKind;
  label: string;
  page: FunctionComponent<PageComponentProps>;
  modelType: unknown;
  cardTitle: string;
  ruleNoun: string;
  titleSwitch: string;
  labelsSwitch: string;
  // Every column the form wrote before it was simplified.
  formColumns: Array<string>;
}

const SHARED_FORM_COLUMNS: Array<string> = [
  "name",
  "description",
  "isEnabled",
  "monitors",
  "monitorLabels",
  "monitorNamePattern",
  "monitorDescriptionPattern",
  "groupByMonitor",
  "groupBySeverity",
  "groupByMonitorLabels",
  "enableTimeWindow",
  "timeWindowMinutes",
  "enableResolveDelay",
  "resolveDelayMinutes",
  "enableReopenWindow",
  "reopenWindowMinutes",
  "enableInactivityTimeout",
  "inactivityTimeoutMinutes",
  "episodeTitleTemplate",
  "episodeDescriptionTemplate",
  "episodeLabels",
  "onCallDutyPolicies",
  // Who owns the episodes the rule opens: one people picker.
  "episodeOwnerUsers",
  "episodeOwnerTeams",
  /*
   * The old default assignee: no longer asked for, but still read - the
   * edit form says a rule has one - and cleared once somebody settles it.
   */
  "defaultAssignToTeamId",
  "defaultAssignToUserId",
];

const PAGES: Array<PageCase> = [
  {
    kind: GroupingRuleKind.Incident,
    label: "Incidents",
    page: IncidentGroupingRulesPage,
    modelType: IncidentGroupingRule,
    cardTitle: "Incident Grouping Rules",
    ruleNoun: "incidents",
    titleSwitch: "groupByIncidentTitle",
    labelsSwitch: "groupByIncidentLabels",
    formColumns: [
      ...SHARED_FORM_COLUMNS,
      "incidentSeverities",
      "incidentLabels",
      "incidentTitlePattern",
      "incidentDescriptionPattern",
      "groupByIncidentTitle",
      "groupByIncidentLabels",
      "showEpisodeOnStatusPage",
      "episodeMemberRoleAssignments",
    ],
  },
  {
    kind: GroupingRuleKind.Alert,
    label: "Alerts",
    page: AlertGroupingRulesPage,
    modelType: AlertGroupingRule,
    cardTitle: "Alert Grouping Rules",
    ruleNoun: "alerts",
    titleSwitch: "groupByAlertTitle",
    labelsSwitch: "groupByAlertLabels",
    formColumns: [
      ...SHARED_FORM_COLUMNS,
      "alertSeverities",
      "alertLabels",
      "alertTitlePattern",
      "alertDescriptionPattern",
      "groupByAlertTitle",
      "groupByAlertLabels",
    ],
  },
];

function renderPage(pageCase: PageCase): void {
  capturedTables = [];
  const Page: FunctionComponent<PageComponentProps> = pageCase.page;
  render(<Page {...PAGE_PROPS} />);
}

function latestTable(): CapturedTable {
  const table: CapturedTable | undefined =
    capturedTables[capturedTables.length - 1];

  if (!table) {
    throw new Error("The page did not render its ModelTable.");
  }

  return table;
}

function fieldKey(field: ModelField<any>): string {
  return Object.keys(field.field || {})[0] || "";
}

// The key a field is kept under in the form: its own, or its column's.
function formKey(field: ModelField<any>): string {
  return field.overrideFieldKey || fieldKey(field);
}

/*
 * Values under which every field that can show does: the line about an old
 * default assignee shows only while the rule has one.
 */
const EVERY_FIELD_SHOWS: Record<string, unknown> = {
  defaultAssignToTeamId: "team",
  defaultAssignToUserId: "user",
};

/*
 * The fields the form draws on a step, in order: every field but the
 * column registrations, which are never shown.
 */
function drawnOnStep(stepId: string): Array<ModelField<any>> {
  return latestTable().formFields.filter((field: ModelField<any>) => {
    return (
      field.stepId === stepId &&
      (!field.showIf || field.showIf(EVERY_FIELD_SHOWS))
    );
  });
}

function findByFormKey(key: string): ModelField<any> {
  const found: ModelField<any> | undefined = latestTable().formFields.find(
    (field: ModelField<any>) => {
      return formKey(field) === key;
    },
  );

  if (!found) {
    throw new Error(`No field ${key}.`);
  }

  return found;
}

function stepShows(stepId: string, values: Record<string, unknown>): boolean {
  const step: FormStep<any> | undefined = latestTable().formSteps.find(
    (candidate: FormStep<any>) => {
      return candidate.id === stepId;
    },
  );

  if (!step) {
    throw new Error(`No step ${stepId}.`);
  }

  return !step.showIf || step.showIf(values);
}

describe.each(PAGES)(
  "$label > Settings > Grouping Rules",
  (pageCase: PageCase) => {
    beforeEach(() => {
      cleanup();
      createMock.mockReset();
      createMock.mockResolvedValue({ data: {} });
      userPermissions = [Permission.ProjectOwner];
    });

    afterEach(() => {
      cleanup();
    });

    test("is still a drag-ordered table of the rule model, editable and deletable", () => {
      renderPage(pageCase);
      const table: CapturedTable = latestTable();

      expect(table.modelType).toBe(pageCase.modelType);
      expect(table.enableDragAndDrop).toBe(true);
      expect(table.dragDropIndexField).toBe("priority");
      expect(table.sortBy).toBe("priority");
      expect(table.sortOrder).toBe(SortOrder.Ascending);
      expect(table.isCreateable).toBe(true);
      expect(table.isEditable).toBe(true);
      expect(table.isDeleteable).toBe(true);
      expect(table.createEditModalWidth).toBe(ModalWidth.Large);
    });

    test("explains grouping in plain words on its card", () => {
      renderPage(pageCase);
      const table: CapturedTable = latestTable();

      expect(table.cardProps.title).toBe(pageCase.cardTitle);
      expect(table.cardProps.description).toBe(
        GROUPING_RULE_COPY.cardDescription[pageCase.kind],
      );
      expect(table.cardProps.description).toContain(
        `instead of a flood of ${pageCase.ruleNoun}`,
      );
      expect(table.cardProps.description).toContain("drag a rule");
      // The in-depth help is still a click away.
      expect(table.helpContent.markdown).toContain("Group By");
    });

    test("lists a rule's name, what it groups and whether it is on - not raw minutes", () => {
      renderPage(pageCase);
      const table: CapturedTable = latestTable();

      expect(
        table.columns.map((column: CapturedColumn) => {
          return column.title;
        }),
      ).toEqual(["Name", GROUPING_RULE_COPY.summaryColumnTitle, "Status"]);

      const titles: Array<string> = table.columns.map(
        (column: CapturedColumn) => {
          return column.title;
        },
      );
      expect(titles).not.toContain("Time Window (min)");
      expect(titles).not.toContain("Inactivity Timeout (min)");
      expect(titles).not.toContain("Description");
    });

    test("the Grouping column says what a row's rule does, in the table and in its CSV", () => {
      renderPage(pageCase);
      const column: CapturedColumn = latestTable().columns[1]!;

      expect(column.id).toBe("grouping-summary");

      const rule: Record<string, unknown> = {
        [pageCase.titleSwitch]: true,
        enableTimeWindow: true,
        timeWindowMinutes: 60,
      };

      cleanup();
      render(column.getElement!(rule));

      expect(screen.getByTestId("grouping-rule-summary")).toHaveTextContent(
        "One episode per title",
      );
      expect(column.getExportValue!(rule)).toBe(
        `One episode per title. New ${pageCase.ruleNoun} join while they arrive within 1 hour of the last one`,
      );
    });

    test("the Name column shows the rule's description under its name", () => {
      renderPage(pageCase);
      const column: CapturedColumn = latestTable().columns[0]!;

      cleanup();
      render(
        column.getElement!({
          name: "Payments storms",
          description: "Everything from the payments cluster",
        }),
      );

      expect(screen.getByText("Payments storms")).toBeInTheDocument();
      expect(
        screen.getByText("Everything from the payments cluster"),
      ).toBeInTheDocument();
    });

    test("selects every column the list reads, and never the order number", () => {
      renderPage(pageCase);
      const select: Record<string, unknown> = latestTable().selectMoreFields;

      expect(select).toEqual(
        expect.objectContaining({
          isEnabled: true,
          description: true,
          ...getGroupingRuleSummarySelect(pageCase.kind),
        }),
      );
      expect(select).not.toHaveProperty("priority");
    });

    test("a blank rule starts enabled, grouping by monitor within half an hour", () => {
      renderPage(pageCase);

      expect(latestTable().createInitialValues).toEqual(
        getNewGroupingRuleValues({
          kind: pageCase.kind,
          translate: (text: string): string => {
            return text;
          },
        }),
      );
    });

    test("regression: the Enabled switch defaults to on", () => {
      renderPage(pageCase);
      const enabled: ModelField<any> | undefined =
        latestTable().formFields.find((field: ModelField<any>) => {
          return fieldKey(field) === "isEnabled" && !field.overrideFieldKey;
        });

      expect(enabled?.defaultValue).toBe(true);
      expect(enabled?.stepId).toBe("grouping");
    });

    test("the form still reads and writes every column it did before", () => {
      renderPage(pageCase);
      const registered: Set<string> = new Set<string>();

      for (const field of latestTable().formFields) {
        // A people picker writes one value per kind it offers.
        for (const kind of field.peoplePicker?.kinds || []) {
          registered.add(kind.valueKey);
        }

        if (!field.formOnly) {
          registered.add(fieldKey(field));
        }
      }

      for (const column of pageCase.formColumns) {
        expect({ column, registered: registered.has(column) }).toEqual({
          column,
          registered: true,
        });
      }

      // And never the order number, which is dragged.
      expect(registered.has("priority")).toBe(false);
    });

    test("On-Call & Ownership asks who owns the episodes with one people picker", () => {
      renderPage(pageCase);

      const pickers: Array<ModelField<any>> = latestTable().formFields.filter(
        (field: ModelField<any>) => {
          return field.fieldType === FormFieldSchemaType.PeoplePicker;
        },
      );

      expect(pickers).toHaveLength(1);

      const owners: ModelField<any> = pickers[0]!;

      expect(fieldKey(owners)).toBe(EPISODE_OWNERS_FIELD_KEY);
      expect(owners.title).toBe("Episode Owners");
      expect(owners.title).toBe(GROUPING_RULE_COPY.episodeOwnersTitle);
      expect(owners.description).toBe(
        "Added as owners of every episode this rule opens, and notified like any other owner.",
      );
      // Folded under More fields, at the end of the Grouping step.
      expect(owners.stepId).toBe("grouping");
      expect(owners.collapsibleSection?.title).toBe(MORE_FIELDS_SECTION_TITLE);
      expect(owners.spanFullRow).toBe(true);
      expect(owners.required).toBe(false);
      // People first, then teams, saved to the rule's own two lists.
      expect(
        owners.peoplePicker?.kinds.map(
          (kind: { kind: PeoplePickerKind; valueKey: string }) => {
            return [kind.kind, kind.valueKey];
          },
        ),
      ).toEqual([
        [PeoplePickerKind.User, EPISODE_OWNER_USERS_COLUMN],
        [PeoplePickerKind.Team, EPISODE_OWNER_TEAMS_COLUMN],
      ]);
      expect(owners.formOnly).toBe(true);
    });

    test("no field asks for a default assignee any more - the old pair is only read", () => {
      renderPage(pageCase);

      const oldPair: Array<ModelField<any>> = latestTable().formFields.filter(
        (field: ModelField<any>) => {
          return fieldKey(field).startsWith("defaultAssignTo");
        },
      );

      expect(oldPair.map(fieldKey).sort()).toEqual([
        "defaultAssignToTeamId",
        "defaultAssignToUserId",
      ]);

      for (const field of oldPair) {
        expect(field.showIf?.({ [fieldKey(field)]: "id" })).toBe(false);
        expect(field.stepId).toBe("grouping");
      }

      expect(
        latestTable().formFields.map((field: ModelField<any>) => {
          return field.title;
        }),
      ).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Default Assign To (Team|User)$/),
        ]),
      );
    });

    test("the line about an old default assignee shows only while the rule has one", () => {
      renderPage(pageCase);

      const line: ModelField<any> | undefined = latestTable().formFields.find(
        (field: ModelField<any>) => {
          return field.overrideFieldKey === LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY;
        },
      );

      expect(line).toBeDefined();
      expect(line!.formOnly).toBe(true);
      expect(line!.stepId).toBe("grouping");
      expect(line!.collapsibleSection?.title).toBe(MORE_FIELDS_SECTION_TITLE);
      expect(line!.fieldType).toBe(FormFieldSchemaType.CustomComponent);

      expect(line!.showIf!({})).toBe(false);
      // A new rule never has one.
      expect(line!.showIf!(latestTable().createInitialValues)).toBe(false);
      expect(line!.showIf!({ defaultAssignToTeamId: "team" })).toBe(true);
      expect(line!.showIf!({ defaultAssignToUserId: "user" })).toBe(true);
      // Settled: Add as owners or Remove wrote null.
      expect(
        line!.showIf!({
          defaultAssignToTeamId: null,
          defaultAssignToUserId: null,
        }),
      ).toBe(false);

      // It sits right under the owners picker.
      const keys: Array<string> = latestTable().formFields.map(
        (field: ModelField<any>) => {
          return field.overrideFieldKey || fieldKey(field);
        },
      );

      expect(keys.indexOf(LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY)).toBeGreaterThan(
        keys.indexOf(EPISODE_OWNERS_FIELD_KEY),
      );
    });

    test("the line's buttons settle the old pair: Add as owners moves it into the owners", () => {
      renderPage(pageCase);

      const line: ModelField<any> = latestTable().formFields.find(
        (field: ModelField<any>) => {
          return field.overrideFieldKey === LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY;
        },
      )!;

      let written: Record<string, unknown> = {};

      line.onChange!(
        {
          action: LegacyDefaultAssigneeAction.AddAsOwners,
          userId: "user-1",
          teamId: "team-1",
        },
        {
          defaultAssignToUserId: "user-1",
          defaultAssignToTeamId: "team-1",
          episodeOwnerUsers: ["user-2"],
        },
        (values: Record<string, unknown>): void => {
          written = values;
        },
      );

      expect(written).toEqual({
        defaultAssignToUserId: null,
        defaultAssignToTeamId: null,
        episodeOwnerUsers: ["user-2", "user-1"],
        episodeOwnerTeams: ["team-1"],
      });

      line.onChange!(
        { action: LegacyDefaultAssigneeAction.Remove },
        {
          defaultAssignToUserId: "user-1",
          episodeOwnerUsers: ["user-2"],
        },
        (values: Record<string, unknown>): void => {
          written = values;
        },
      );

      expect(written).toEqual({
        defaultAssignToUserId: null,
        defaultAssignToTeamId: null,
        episodeOwnerUsers: ["user-2"],
      });

      // Anything else is not the line's to act on.
      written = {};
      line.onChange!("add-as-owners", {}, (values: Record<string, unknown>) => {
        written = values;
      });
      expect(written).toEqual({});
    });

    test("everything beyond grouping is one More fields fold, at the end of the Grouping step", () => {
      renderPage(pageCase);

      const grouping: Array<ModelField<any>> = drawnOnStep("grouping");
      const open: Array<string> = grouping
        .filter((field: ModelField<any>) => {
          return !field.collapsibleSection;
        })
        .map(formKey);
      const folded: Array<ModelField<any>> = grouping.filter(
        (field: ModelField<any>) => {
          return Boolean(field.collapsibleSection);
        },
      );

      // Two questions, the name and the switch stay on screen.
      expect(open).toEqual([
        GROUPING_MODE_FIELD_KEY,
        "timeWindowSetting",
        "name",
        "isEnabled",
      ]);

      // Then the fold: every field of it after them, one after another.
      expect(grouping.slice(open.length)).toEqual(folded);

      // One section object, built once, so the form folds them together.
      const sections: Set<FormFieldCollapsibleSection<any>> = new Set(
        folded.map((field: ModelField<any>) => {
          return field.collapsibleSection!;
        }),
      );
      expect(sections.size).toBe(1);

      const section: FormFieldCollapsibleSection<any> =
        folded[0]!.collapsibleSection!;
      expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
      expect(section.title).toBe(MORE_FIELDS_SECTION_TITLE);
      expect(section.title).toBe("More fields");
      // Folded on an edit form too: its chips say what is set.
      expect(section.openWhenConfigured).toBe(false);
      expect(section.listFieldsWhileFolded).toBe(true);
      // The fields themselves decide what is set; no rule of its own.
      expect(section.isConfigured).toBeUndefined();

      expect(folded.map(formKey)).toEqual(
        pageCase.kind === GroupingRuleKind.Incident
          ? [
              "onCallDutyPolicies",
              EPISODE_OWNERS_FIELD_KEY,
              LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY,
              "episodeMemberRoleAssignments",
              "reopenWindowSetting",
              "resolveDelaySetting",
              "inactivityTimeoutSetting",
              "description",
              "episodeTitleTemplate",
              "episodeDescriptionTemplate",
              "showEpisodeOnStatusPage",
              "episodeLabels",
            ]
          : [
              "onCallDutyPolicies",
              EPISODE_OWNERS_FIELD_KEY,
              LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY,
              "reopenWindowSetting",
              "resolveDelaySetting",
              "inactivityTimeoutSetting",
              "description",
              "episodeTitleTemplate",
              "episodeDescriptionTemplate",
              "episodeLabels",
            ],
      );
    });

    test("the fold has three small headings, and each field still says what it does", () => {
      renderPage(pageCase);

      const headed: Array<[string, string]> = drawnOnStep("grouping")
        .filter((field: ModelField<any>) => {
          return Boolean(field.sectionTitle);
        })
        .map((field: ModelField<any>): [string, string] => {
          return [formKey(field), field.sectionTitle as string];
        });

      expect(headed).toEqual([
        ["onCallDutyPolicies", "On-Call & Ownership"],
        ["reopenWindowSetting", "Episode Lifecycle"],
        ["description", "Details"],
      ]);

      /*
       * The headings group them; they do not explain them. Every field in
       * the fold still says what it does - a line of help of its own, or a
       * control that draws its title and help itself (the lifecycle
       * switches, the old default assignee's line) - except the rule's
       * Description, whose title says it all.
       */
      const unexplained: Array<string> = drawnOnStep("grouping")
        .filter((field: ModelField<any>) => {
          return (
            Boolean(field.collapsibleSection) &&
            !field.description &&
            !field.customElementDrawsOwnLabel
          );
        })
        .map(formKey);

      expect(unexplained).toEqual(["description"]);
      expect(findByFormKey("onCallDutyPolicies").description).toBe(
        "On-call policies to fire when an episode is created by this rule.",
      );
    });

    test("a lifecycle setting's chip says its minutes while it is on, and nothing while it is off", () => {
      renderPage(pageCase);

      const cases: Array<[string, string, string, string]> = [
        [
          "reopenWindowSetting",
          "enableReopenWindow",
          "reopenWindowMinutes",
          "45 minutes",
        ],
        [
          "resolveDelaySetting",
          "enableResolveDelay",
          "resolveDelayMinutes",
          "45 minutes",
        ],
        [
          "inactivityTimeoutSetting",
          "enableInactivityTimeout",
          "inactivityTimeoutMinutes",
          "45 minutes",
        ],
      ];

      for (const [key, enabledColumn, minutesColumn, said] of cases) {
        const field: ModelField<any> = findByFormKey(key);

        expect(field.getFoldedValue).toBeDefined();
        expect(
          field.getFoldedValue!({ [enabledColumn]: true, [minutesColumn]: 45 }),
        ).toBe(said);
        expect(
          field.getFoldedValue!({
            [enabledColumn]: true,
            [minutesColumn]: 180,
          }),
        ).toBe("3 hours");
        // Off, or on with 0 minutes the engines ignore: not set.
        expect(
          field.getFoldedValue!({
            [enabledColumn]: false,
            [minutesColumn]: 45,
          }),
        ).toBeNull();
        expect(
          field.getFoldedValue!({ [enabledColumn]: true, [minutesColumn]: 0 }),
        ).toBeNull();
        expect(field.getFoldedValue!({})).toBeNull();
        // Typed but not a number yet: set, its name alone.
        expect(
          field.getFoldedValue!({
            [enabledColumn]: true,
            [minutesColumn]: "abc",
          }),
        ).toBe("");
      }
    });

    test("the old default assignee is a chip with its name while the rule has one", () => {
      renderPage(pageCase);

      const line: ModelField<any> = findByFormKey(
        LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY,
      );

      expect(line.getFoldedValue?.({ defaultAssignToTeamId: "team" })).toBe("");
      expect(line.getFoldedValue?.({ defaultAssignToUser: { _id: "u" } })).toBe(
        "",
      );
      expect(line.getFoldedValue?.({})).toBeNull();
      expect(
        line.getFoldedValue?.({
          defaultAssignToTeamId: null,
          defaultAssignToUserId: null,
        }),
      ).toBeNull();
    });

    test("its form-only controls are never saved", () => {
      renderPage(pageCase);

      for (const field of latestTable().formFields) {
        if (field.overrideFieldKey) {
          expect(field.formOnly).toBe(true);
        }
      }
    });

    test("walks Grouping, Group By for a custom mix, and Which - and no more", () => {
      renderPage(pageCase);

      expect(
        latestTable().formSteps.map((step: FormStep<any>) => {
          return [step.id, step.title];
        }),
      ).toEqual([
        ["grouping", GROUPING_RULE_COPY.groupingStepTitle],
        ["group-by", "Group By"],
        ["match-criteria", GROUPING_RULE_COPY.whichStepTitle[pageCase.kind]],
      ]);

      // Every field is on one of them.
      const stepIds: Array<string> = latestTable().formSteps.map(
        (step: FormStep<any>) => {
          return step.id;
        },
      );

      for (const field of latestTable().formFields) {
        expect({ field: formKey(field), step: field.stepId }).toEqual({
          field: formKey(field),
          step: expect.stringMatching(new RegExp(`^(${stepIds.join("|")})$`)),
        });
      }
    });

    test("Group By shows only for a custom mix", () => {
      renderPage(pageCase);

      expect(stepShows("group-by", { groupByMonitor: true })).toBe(false);
      expect(stepShows("group-by", {})).toBe(false);
      expect(
        stepShows("group-by", { groupByMonitor: true, groupBySeverity: true }),
      ).toBe(true);
      expect(stepShows("group-by", { [pageCase.labelsSwitch]: true })).toBe(
        true,
      );
      expect(
        stepShows("group-by", {
          groupByMonitor: true,
          [GROUPING_MODE_FIELD_KEY]: GroupingMode.Custom,
        }),
      ).toBe(true);
      expect(
        stepShows("group-by", {
          groupByMonitor: true,
          groupBySeverity: true,
          [GROUPING_MODE_FIELD_KEY]: GroupingMode.Monitor,
        }),
      ).toBe(false);
    });

    test("no switch adds steps: Grouping and Which always show, whatever a rule uses", () => {
      renderPage(pageCase);

      const busyRule: Record<string, unknown> = {
        enableReopenWindow: true,
        reopenWindowMinutes: 30,
        onCallDutyPolicies: ["policy"],
        episodeOwnerUsers: ["user"],
        description: "Production payments",
        showAdvancedSettings: true,
      };

      for (const values of [{}, busyRule]) {
        expect(stepShows("grouping", values)).toBe(true);
        expect(stepShows("match-criteria", values)).toBe(true);
      }

      // The retired switch is no field of the form any more.
      expect(
        latestTable().formFields.filter((field: ModelField<any>) => {
          return (
            formKey(field) === "showAdvancedSettings" ||
            field.title === "Show advanced settings"
          );
        }),
      ).toEqual([]);
    });

    test("an empty list offers the ready-made rules and a custom one", () => {
      renderPage(pageCase);

      const empty: HTMLElement = screen.getByTestId("empty-list");

      expect(
        within(empty).getByRole("region", { name: "Start with a template" }),
      ).toBeInTheDocument();
      expect(within(empty).getAllByRole("listitem")).toHaveLength(4);
      expect(
        within(empty).getByRole("button", { name: "Create Custom Rule" }),
      ).toBeInTheDocument();
    });

    test("Create Custom Rule opens the regular create form, and closing it resets", async () => {
      renderPage(pageCase);

      expect(latestTable().showCreateForm).toBe(false);

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: "Create Custom Rule" }),
        );
      });

      expect(latestTable().showCreateForm).toBe(true);

      await act(async (): Promise<void> => {
        latestTable().onCreateEditModalClose();
      });

      expect(latestTable().showCreateForm).toBe(false);
    });

    test("a template added from the empty list refreshes the list and says so", async () => {
      renderPage(pageCase);
      const refreshBefore: string = latestTable().refreshToggle;

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(screen.getByTestId("empty-list")).getByTestId(
            "grouping-rule-template-same-monitor-add",
          ),
        );
      });

      await waitFor(() => {
        expect(latestTable().refreshToggle).not.toBe(refreshBefore);
      });

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("grouping-rule-status")).toHaveTextContent(
        `Rule added: Group ${pageCase.ruleNoun} from the same monitor`,
      );
      expect(screen.getByRole("status")).toBe(
        screen.getByTestId("grouping-rule-status"),
      );
    });

    test("Create from Template opens the templates in a dialog, which closes once one is added", async () => {
      renderPage(pageCase);

      const button: HTMLElement = within(
        screen.getByTestId("card-buttons"),
      ).getByRole("button", { name: "Create from Template" });

      await act(async (): Promise<void> => {
        fireEvent.click(button);
      });

      const dialog: HTMLElement = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(
        "Add a ready-made rule in one click. You can edit it afterwards.",
      );
      // The dialog skips the introduction the empty list gives.
      expect(
        within(dialog).queryByText("Start with a template"),
      ).not.toBeInTheDocument();

      const refreshBefore: string = latestTable().refreshToggle;

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog).getByTestId(
            "grouping-rule-template-same-severity-add",
          ),
        );
      });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(latestTable().refreshToggle).not.toBe(refreshBefore);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    test("the template dialog can be closed without adding anything", async () => {
      renderPage(pageCase);

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(screen.getByTestId("card-buttons")).getByRole("button", {
            name: "Create from Template",
          }),
        );
      });

      const dialog: HTMLElement = await screen.findByRole("dialog");

      await act(async (): Promise<void> => {
        fireEvent.click(within(dialog).getByTestId("close-button"));
      });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(createMock).not.toHaveBeenCalled();
    });

    test("without permission to create rules, Create from Template is locked and says why", () => {
      userPermissions = [Permission.ProjectMember];
      renderPage(pageCase);

      const button: HTMLElement = within(
        screen.getByTestId("card-buttons"),
      ).getByRole("button", { name: "Create from Template" });

      expect(button).toBeDisabled();
      expect(button.getAttribute("title")).toContain(
        "You do not have permission to create",
      );
    });

    test("before permissions are known, Create from Template is left out", () => {
      userPermissions = [];
      renderPage(pageCase);

      expect(
        within(screen.getByTestId("card-buttons")).queryByRole("button", {
          name: "Create from Template",
        }),
      ).not.toBeInTheDocument();
    });
  },
);
