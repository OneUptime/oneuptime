import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * SECURITY EVENTS > DETECTIONS > RULE EXCEPTIONS: everything the project's
 * detection rules skip, in one list to review - what each skips, the rule,
 * why, where it stands and who added it - added, changed and removed with
 * the one form every door opens. The table is a ModelTable call, so its
 * props are what is pinned; the cells are then drawn from them.
 */

type Column = {
  field: Record<string, unknown>;
  title: string;
  type?: unknown;
  hideOnMobile?: boolean | undefined;
  disableSort?: boolean | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

type Captured = {
  id: string;
  userPreferencesKey: string;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  createVerb?: string | undefined;
  query: Record<string, unknown>;
  isDeleteable: boolean;
  isEditable?: boolean | undefined;
  isCreateable: boolean;
  bulkActions?: { buttons: Array<unknown> } | undefined;
  sortBy?: string | undefined;
  cardProps?: { title?: string; description?: string } | undefined;
  emptyState?:
    | { title?: string; description?: string; icon?: string }
    | undefined;
  createInitialValues?: Record<string, unknown> | undefined;
  onShowFormType?: ((formType: number) => void) | undefined;
  formSteps?: Array<{ id: string; title: string }> | undefined;
  formFields?: Array<{
    field: Record<string, unknown>;
    customValidation?: (values: Record<string, unknown>) => string | null;
  }>;
  filters: Array<{
    field: Record<string, unknown>;
    title: string;
    type: unknown;
    filterEntityType?: unknown;
    filterQuery?: Record<string, unknown>;
    filterDropdownOptions?: Array<{ label: string; value: string }>;
  }>;
  searchableFields?: Array<string> | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
  columns: Array<Column>;
};

let captured: Captured | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Captured) => {
      captured = props;
      return React.createElement("div", {
        "data-testid": "rule-exceptions-table",
      });
    },
  };
});

import SecurityRuleExceptionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleExceptions";
import {
  RULE_EXCEPTION_FORM_STEPS,
  getRuleExceptionWindowDefaults,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionFormFields";
import {
  RULE_EXCEPTIONS_EMPTY_DESCRIPTION,
  RULE_EXCEPTIONS_EMPTY_TITLE,
  RULE_EXCEPTIONS_TABLE_DESCRIPTION,
  RULE_EXCEPTIONS_TABLE_TITLE,
  RULE_EXCEPTIONS_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import {
  RULE_EXCEPTIONS_RULE_FILTER_KEY,
  RULE_EXCEPTIONS_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsRoute";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { DetectionRuleExceptionKind } from "../../../Types/SecurityEvent/DetectionRuleException";
import {
  ModalTableBulkDefaultActions,
  ModalType,
} from "../../../UI/Components/ModelTable/BaseModelTable";
import FieldType from "../../../UI/Components/Types/FieldType";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function renderPage(project?: Project): void {
  const current: Project = project || new Project();
  current.id = PROJECT_ID;

  render(
    <MemoryRouter>
      <SecurityRuleExceptionsPage
        pageRoute={new Route("/dashboard/security-events/rule-exceptions")}
        currentProject={current}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function table(): Captured {
  expect(captured).not.toBeNull();
  return captured!;
}

function columnTitled(title: string): Column {
  const column: Column | undefined = table().columns.find(
    (candidate: Column): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();

  return column!;
}

function exception(values: Record<string, unknown>): DetectionRuleException {
  const model: DetectionRuleException = new DetectionRuleException();
  model._id = "22222222-2222-4222-8222-222222222222";
  Object.assign(model, values);
  return model;
}

function draw(title: string, item: DetectionRuleException): HTMLElement {
  const { container } = render(columnTitled(title).getElement!(item));
  return container;
}

describe("Security Events > Rule Exceptions", () => {
  beforeEach(() => {
    captured = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("is the project's exceptions, newest first, under its own name", () => {
    renderPage();

    expect(table()).toMatchObject({
      id: RULE_EXCEPTIONS_TABLE_ID,
      userPreferencesKey: RULE_EXCEPTIONS_TABLE_ID,
      singularName: "Rule Exception",
      pluralName: "Rule Exceptions",
      createVerb: "Add",
      query: { projectId: PROJECT_ID },
      sortBy: "createdAt",
      cardProps: {
        title: RULE_EXCEPTIONS_TABLE_TITLE,
        description: RULE_EXCEPTIONS_TABLE_DESCRIPTION,
      },
    });
    expect(RULE_EXCEPTIONS_TABLE_TITLE).toBe("Rule Exceptions");
  });

  test("an exception is added, changed and removed here, one or many at a time", () => {
    renderPage();

    expect(table().isCreateable).toBe(true);
    expect(table().isEditable).toBe(true);
    expect(table().isDeleteable).toBe(true);
    expect(table().bulkActions?.buttons).toEqual([
      ModalTableBulkDefaultActions.Delete,
    ]);
  });

  test("an empty list says what an exception is for, and where else one is added", () => {
    renderPage();

    expect(table().emptyState).toEqual({
      title: RULE_EXCEPTIONS_EMPTY_TITLE,
      description: RULE_EXCEPTIONS_EMPTY_DESCRIPTION,
      icon: IconProp.EyeSlash,
    });
  });

  test("the form is the shared one, starting on an entity, with a window's times ready", () => {
    const before: number = Date.now();

    renderPage();

    expect(table().formSteps).toBe(RULE_EXCEPTION_FORM_STEPS);
    expect(
      (table().formFields || []).map((field: { field: Record<string, unknown> }) => {
        return Object.keys(field.field)[0];
      }),
    ).toEqual([
      "detectionRule",
      "kind",
      "entityType",
      "fieldName",
      "value",
      "startsAt",
      "endsAt",
      "reason",
      "expiresAt",
    ]);

    const initial: Record<string, unknown> = table().createInitialValues || {};

    expect(initial["kind"]).toBe(DetectionRuleExceptionKind.Entity);
    expect(initial["entityType"]).toBe(SecurityEntityType.User);

    const startsAt: Date = initial["startsAt"] as Date;
    const endsAt: Date = initial["endsAt"] as Date;

    expect(startsAt.getTime()).toBeGreaterThanOrEqual(
      getRuleExceptionWindowDefaults(new Date(before)).startsAt.getTime(),
    );
    expect(endsAt.getTime() - startsAt.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  test("Edit leaves an expiry as it was; Add holds a new one to the future", () => {
    renderPage();

    const expired: Record<string, unknown> = {
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
      value: "alice",
      reason: "Testing.",
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };

    function expiryProblem(): string | null {
      const field:
        | {
            field: Record<string, unknown>;
            customValidation?: (values: Record<string, unknown>) => string | null;
          }
        | undefined = (table().formFields || []).find(
        (candidate: { field: Record<string, unknown> }) => {
          return Object.keys(candidate.field)[0] === "expiresAt";
        },
      );

      return field!.customValidation!(expired);
    }

    expect(expiryProblem()).toBe(
      "An exception expires in the future. To stop one now, delete it.",
    );

    act(() => {
      table().onShowFormType!(ModalType.Edit);
    });
    expect(expiryProblem()).toBeNull();

    act(() => {
      table().onShowFormType!(ModalType.Create);
    });
    expect(expiryProblem()).not.toBeNull();
  });

  test("filters by rule - the filter a rule's View Exceptions lands on - and by kind; searches what was written", () => {
    renderPage();

    const [rule, kind] = table().filters;

    expect(rule).toMatchObject({
      field: { [RULE_EXCEPTIONS_RULE_FILTER_KEY]: true },
      title: "Rule",
      type: FieldType.Entity,
      filterEntityType: DetectionRule,
      filterQuery: { projectId: PROJECT_ID },
    });
    expect(kind).toMatchObject({
      field: { kind: true },
      title: "Kind",
      type: FieldType.Dropdown,
    });
    expect(
      (kind!.filterDropdownOptions || []).map(
        (option: { value: string }): string => {
          return option.value;
        },
      ),
    ).toEqual([
      DetectionRuleExceptionKind.Entity,
      DetectionRuleExceptionKind.Value,
      DetectionRuleExceptionKind.TimeWindow,
    ]);
    expect(table().searchableFields).toEqual(["value", "fieldName", "reason"]);
  });

  test("the columns: what it skips, the rule, why, where it stands and who added it", () => {
    renderPage();

    expect(
      table().columns.map((column: Column): string => {
        return column.title;
      }),
    ).toEqual(["Skips", "Rule", "Reason", "Status", "Added By"]);

    // On a phone: what it skips, the rule and where it stands.
    expect(columnTitled("Reason").hideOnMobile).toBe(true);
    expect(columnTitled("Added By").hideOnMobile).toBe(true);
    expect(columnTitled("Skips").hideOnMobile).toBeFalsy();
    expect(columnTitled("Status").hideOnMobile).toBeFalsy();

    // Every column a cell reads is selected.
    expect(table().selectMoreFields).toMatchObject({
      kind: true,
      entityType: true,
      fieldName: true,
      startsAt: true,
      endsAt: true,
      expiresAt: true,
      createdAt: true,
    });
    expect(columnTitled("Rule").field).toEqual({
      detectionRule: { name: true },
    });
    expect(columnTitled("Added By").field).toEqual({
      createdByUser: { name: true, email: true, profilePictureId: true },
    });
  });

  test("a row says what it skips, and what kind of thing that is", () => {
    renderPage();

    const user: HTMLElement = draw(
      "Skips",
      exception({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.User,
        value: "svc-*",
      }),
    );

    expect(user).toHaveTextContent("svc-*");
    expect(user).toHaveTextContent("User");

    const range: HTMLElement = draw(
      "Skips",
      exception({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.IpAddress,
        value: "10.20.0.0/16",
      }),
    );

    expect(range).toHaveTextContent("IP address range");

    const value: HTMLElement = draw(
      "Skips",
      exception({
        kind: DetectionRuleExceptionKind.Value,
        fieldName: "processName",
        value: "backup.exe",
      }),
    );

    expect(value).toHaveTextContent("backup.exe");
    expect(value).toHaveTextContent("Value of processName");

    const window: HTMLElement = draw(
      "Skips",
      exception({
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: new Date("2026-10-27T10:00:00.000Z"),
        endsAt: new Date("2026-10-27T12:00:00.000Z"),
      }),
    );

    expect(window).toHaveTextContent(" to ");
    expect(window).toHaveTextContent("Time window");
  });

  test("a row says where it stands: Active with no expiry, Expired, Upcoming", () => {
    renderPage();

    const active: HTMLElement = draw(
      "Status",
      exception({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.User,
        value: "alice",
      }),
    );

    expect(active).toHaveTextContent("Active");
    expect(active).toHaveTextContent("No expiry");

    const expired: HTMLElement = draw(
      "Status",
      exception({
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.User,
        value: "alice",
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      }),
    );

    expect(expired).toHaveTextContent("Expired");
    expect(
      expired.querySelector(`[data-testid="${RULE_EXCEPTIONS_TEST_IDS.statusCell}"] span[title]`),
    ).not.toBeNull();

    const upcoming: HTMLElement = draw(
      "Status",
      exception({
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      }),
    );

    expect(upcoming).toHaveTextContent("Upcoming");
    expect(upcoming).toHaveTextContent("Starts ");
  });

  test("a row names its rule, or says it is gone", () => {
    renderPage();

    const rule: DetectionRule = new DetectionRule();
    rule.name = "Failed logon burst";

    expect(draw("Rule", exception({ detectionRule: rule }))).toHaveTextContent(
      "Failed logon burst",
    );
    expect(draw("Rule", exception({}))).toHaveTextContent("Rule not found");
  });

  test("a row says who added it and when, or that the API did", () => {
    renderPage();

    const person: User = new User();
    person.name = "Jane Doe" as never;

    const added: HTMLElement = draw(
      "Added By",
      exception({
        createdByUser: person,
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      }),
    );

    expect(added).toHaveTextContent("Jane Doe");
    expect(added).toHaveTextContent("Added 3 days ago");

    expect(draw("Added By", exception({}))).toHaveTextContent(
      "Added through the API",
    );
  });

  test("a reseller plan without telemetry sees no list", () => {
    const project: Project = new Project();
    const reseller: Reseller = new Reseller();
    reseller.enableTelemetryFeatures = false;
    project.reseller = reseller;

    renderPage(project);

    expect(captured).toBeNull();
    expect(
      screen.getByText(/did not include telemetry features/),
    ).toBeInTheDocument();
  });
});
