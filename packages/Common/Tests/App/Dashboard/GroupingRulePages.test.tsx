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
 * when, and that the form still reaches every column the old one did - the
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
  SHOW_ADVANCED_SETTINGS_FIELD_KEY,
  getGroupingRuleSummarySelect,
  getNewGroupingRuleValues,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
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
      expect(owners.stepId).toBe("on-call-ownership");
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
        expect(field.stepId).toBe("on-call-ownership");
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
      expect(line!.stepId).toBe("on-call-ownership");
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

    test("On-Call & Ownership has no section headings: each field says what it does", () => {
      renderPage(pageCase);

      const onTheStep: Array<ModelField<any>> = latestTable().formFields.filter(
        (field: ModelField<any>) => {
          return field.stepId === "on-call-ownership";
        },
      );

      expect(
        onTheStep.filter((field: ModelField<any>) => {
          return Boolean(field.sectionTitle);
        }),
      ).toEqual([]);

      const onCall: ModelField<any> | undefined = onTheStep.find(
        (field: ModelField<any>) => {
          return fieldKey(field) === "onCallDutyPolicies";
        },
      );

      expect(onCall?.description).toBe(
        "On-call policies to fire when an episode is created by this rule.",
      );
    });

    test("its form-only controls are never saved", () => {
      renderPage(pageCase);

      for (const field of latestTable().formFields) {
        if (field.overrideFieldKey) {
          expect(field.formOnly).toBe(true);
        }
      }
    });

    test("walks Grouping, Group By, Which, then the three advanced steps", () => {
      renderPage(pageCase);

      expect(
        latestTable().formSteps.map((step: FormStep<any>) => {
          return [step.id, step.title];
        }),
      ).toEqual([
        ["grouping", GROUPING_RULE_COPY.groupingStepTitle],
        ["group-by", "Group By"],
        ["match-criteria", GROUPING_RULE_COPY.whichStepTitle[pageCase.kind]],
        ["episode-lifecycle", "Episode Lifecycle"],
        ["details", "Details"],
        ["on-call-ownership", "On-Call & Ownership"],
      ]);
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

    test("the advanced steps show only behind Show advanced settings", () => {
      renderPage(pageCase);

      for (const stepId of [
        "episode-lifecycle",
        "details",
        "on-call-ownership",
      ]) {
        expect(stepShows(stepId, {})).toBe(false);
        expect(
          stepShows(stepId, { [SHOW_ADVANCED_SETTINGS_FIELD_KEY]: false }),
        ).toBe(false);
        expect(
          stepShows(stepId, { [SHOW_ADVANCED_SETTINGS_FIELD_KEY]: true }),
        ).toBe(true);
      }

      expect(stepShows("grouping", {})).toBe(true);
      expect(stepShows("match-criteria", {})).toBe(true);
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
