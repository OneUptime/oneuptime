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
  cleanup,
  render,
  RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The alert, incident and episode create wizards end on a review step that
 * lists what each earlier step picked. The form holds only the id of the
 * chosen state or severity, and the review step used to print a fixed
 * sentence for it - "Initial state will be set to selected state", or on the
 * episode wizards "Severity will be set to selected value" - so the one place
 * meant to confirm the choice never named it. Pick "Acknowledged" and the
 * review said nothing about Acknowledged.
 *
 * The review step now looks the choice up and shows its name in its color.
 * These tests drive the four real pages, with ModelForm mocked to capture the
 * fields it is handed (as AffectedResourcesSummaryStep.test.tsx does), and
 * render each field's summary against a ModelAPI that answers per model type.
 * They check what a user reads there, what is asked of the API, and that no
 * summary on these pages says a choice "will be set to selected" - the shape
 * of the sentence a copy-pasted field would bring back.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

type SummaryItem = Record<string, unknown>;

type CapturedField = {
  field?: Record<string, unknown> | undefined;
  overrideField?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  fieldType?: string | undefined;
  dropdownModal?: { type: unknown } | undefined;
  getSummaryElement?:
    | ((item: SummaryItem) => React.ReactElement | undefined)
    | undefined;
};

type CapturedFormProps = {
  fields: Array<CapturedField>;
};

let capturedForm: CapturedFormProps | null = null;

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  // Only the component is stubbed: the pages import FormType from here too.
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForm = props;
      return <div data-testid="model-form" />;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

import AlertCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Create";
import AlertEpisodeCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeCreate";
import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import IncidentEpisodeCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeCreate";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color, { RGB } from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "3b1d7c2e-5f4a-4e6b-9c8d-7a6f5e4d3c2b";

// What the pages preselect on mount: the first state by order.
const FIRST_ALERT_STATE_ID: string = "11111111-1111-4111-8111-000000000001";
const FIRST_INCIDENT_STATE_ID: string = "11111111-1111-4111-8111-000000000002";

type NamedFixture = {
  id: string;
  name: string;
  color: string;
};

const ACKNOWLEDGED_ALERT_STATE: NamedFixture = {
  id: "22222222-2222-4222-8222-000000000001",
  name: "Acknowledged",
  color: "#f59e0b",
};

const INVESTIGATING_INCIDENT_STATE: NamedFixture = {
  id: "22222222-2222-4222-8222-000000000002",
  name: "Investigating",
  color: "#7c3aed",
};

const HIGH_ALERT_SEVERITY: NamedFixture = {
  id: "33333333-3333-4333-8333-000000000001",
  name: "High",
  color: "#dc2626",
};

const MAJOR_INCIDENT_SEVERITY: NamedFixture = {
  id: "33333333-3333-4333-8333-000000000002",
  name: "Major Incident",
  color: "#ea580c",
};

type NamedModel = BaseModel & {
  name?: string | undefined;
  color?: Color | undefined;
};

type NamedModelType = { new (): NamedModel };

/*
 * The one record of each model type the API knows by id. A lookup of the
 * wrong model type, or of any other id, finds nothing.
 */
const LOOKUP_FIXTURES: Map<unknown, NamedFixture> = new Map<
  unknown,
  NamedFixture
>([
  [AlertState, ACKNOWLEDGED_ALERT_STATE],
  [IncidentState, INVESTIGATING_INCIDENT_STATE],
  [AlertSeverity, HIGH_ALERT_SEVERITY],
  [IncidentSeverity, MAJOR_INCIDENT_SEVERITY],
]);

enum LookupAnswer {
  Found = "found",
  Missing = "missing",
  Failed = "failed",
}

let lookupAnswer: LookupAnswer = LookupAnswer.Found;

const LOOKUP_FAILURE_MESSAGE: string = "Could not reach the server right now.";

const STATE_PLACEHOLDER: string = "Initial state will be set to selected state";
const SEVERITY_PLACEHOLDER: string = "Severity will be set to selected value";
const ANY_PLACEHOLDER_PATTERN: RegExp = /will be set to selected/i;

type ItemRequest = {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
};

type ListRequest = {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

type ListAnswer = {
  data: Array<NamedModel>;
  count: number;
  skip: number;
  limit: number;
};

function makeModel(
  modelType: NamedModelType,
  fixture: NamedFixture,
): NamedModel {
  const model: NamedModel = new modelType();
  model._id = fixture.id;
  model.name = fixture.name;
  model.color = new Color(fixture.color);
  return model;
}

function listOf(data: Array<NamedModel>): ListAnswer {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

async function answerItem(request: ItemRequest): Promise<NamedModel | null> {
  const fixture: NamedFixture | undefined = LOOKUP_FIXTURES.get(
    request.modelType,
  );

  if (!fixture) {
    return null;
  }

  if (lookupAnswer === LookupAnswer.Failed) {
    throw new Error(LOOKUP_FAILURE_MESSAGE);
  }

  if (
    lookupAnswer === LookupAnswer.Missing ||
    request.id.toString() !== fixture.id
  ) {
    /*
     * What ModelAPI.getItem really resolves for an id the server cannot
     * find: the API answers {} and the client turns that into a model with
     * no id - never null.
     */
    return new (request.modelType as NamedModelType)();
  }

  return makeModel(request.modelType as NamedModelType, fixture);
}

async function answerList(request: ListRequest): Promise<ListAnswer> {
  const fixture: NamedFixture | undefined = LOOKUP_FIXTURES.get(
    request.modelType,
  );
  const idQuery: unknown = request.query["_id"];

  // A lookup by ids, as the incident severity summary makes.
  if (fixture && idQuery instanceof Includes) {
    if (lookupAnswer === LookupAnswer.Failed) {
      throw new Error(LOOKUP_FAILURE_MESSAGE);
    }

    const ids: Array<string> = idQuery.values.map(
      (value: string | ObjectID | number): string => {
        return value.toString();
      },
    );

    if (lookupAnswer === LookupAnswer.Missing || !ids.includes(fixture.id)) {
      return listOf([]);
    }

    return listOf([makeModel(request.modelType as NamedModelType, fixture)]);
  }

  if (request.modelType === AlertState) {
    return listOf([
      makeModel(AlertState, {
        id: FIRST_ALERT_STATE_ID,
        name: "Created",
        color: "#ef4444",
      }),
    ]);
  }

  if (request.modelType === IncidentState) {
    return listOf([
      makeModel(IncidentState, {
        id: FIRST_INCIDENT_STATE_ID,
        name: "Created",
        color: "#ef4444",
      }),
    ]);
  }

  // Labels, teams, users, monitors and the rest: nothing to show.
  return listOf([]);
}

type Lookup = {
  modelType: unknown;
  ids: Array<string>;
  select: unknown;
};

/*
 * Every request made since the page finished mounting, whichever of getItem
 * or getList carried it, as the model type, ids and columns it asked for.
 */
function lookupsMade(): Array<Lookup> {
  const itemLookups: Array<Lookup> = getItemMock.mock.calls.map(
    (call: Array<unknown>): Lookup => {
      const request: ItemRequest = call[0] as ItemRequest;
      return {
        modelType: request.modelType,
        ids: [request.id.toString()],
        select: request.select,
      };
    },
  );

  const listLookups: Array<Lookup> = getListMock.mock.calls.map(
    (call: Array<unknown>): Lookup => {
      const request: ListRequest = call[0] as ListRequest;
      const idQuery: unknown = request.query["_id"];
      return {
        modelType: request.modelType,
        ids:
          idQuery instanceof Includes
            ? idQuery.values.map(
                (value: string | ObjectID | number): string => {
                  return value.toString();
                },
              )
            : [],
        select: request.select,
      };
    },
  );

  return [...itemLookups, ...listLookups];
}

type PageUnderTest = {
  name: string;
  component: React.FunctionComponent<PageComponentProps>;
  route: string;
  stateFieldKey: string;
};

const ALERT_CREATE: PageUnderTest = {
  name: "alert create",
  component: AlertCreate,
  route: "/dashboard/alerts/create",
  stateFieldKey: "currentAlertState",
};

const ALERT_EPISODE_CREATE: PageUnderTest = {
  name: "alert episode create",
  component: AlertEpisodeCreate,
  route: "/dashboard/alerts/episodes/create",
  stateFieldKey: "currentAlertState",
};

const INCIDENT_CREATE: PageUnderTest = {
  name: "incident create",
  component: IncidentCreate,
  route: "/dashboard/incidents/create",
  stateFieldKey: "currentIncidentState",
};

const INCIDENT_EPISODE_CREATE: PageUnderTest = {
  name: "incident episode create",
  component: IncidentEpisodeCreate,
  route: "/dashboard/incidents/episodes/create",
  stateFieldKey: "currentIncidentState",
};

const PAGES: Array<PageUnderTest> = [
  ALERT_CREATE,
  ALERT_EPISODE_CREATE,
  INCIDENT_CREATE,
  INCIDENT_EPISODE_CREATE,
];

type LookupFieldCase = {
  page: PageUnderTest;
  fieldKey: string;
  modelType: NamedModelType;
  chosen: NamedFixture;
  placeholder: string;
  emptyMessage: string;
  notFoundMessage: string;
};

const STATE_FIELD_CASES: Array<LookupFieldCase> = [
  {
    page: ALERT_CREATE,
    fieldKey: "currentAlertState",
    modelType: AlertState,
    chosen: ACKNOWLEDGED_ALERT_STATE,
    placeholder: STATE_PLACEHOLDER,
    emptyMessage: "Will use first available state by priority",
    notFoundMessage: "The selected alert state could not be found.",
  },
  {
    page: ALERT_EPISODE_CREATE,
    fieldKey: "currentAlertState",
    modelType: AlertState,
    chosen: ACKNOWLEDGED_ALERT_STATE,
    placeholder: STATE_PLACEHOLDER,
    emptyMessage: "Will use first available state by priority",
    notFoundMessage: "The selected alert state could not be found.",
  },
  {
    page: INCIDENT_CREATE,
    fieldKey: "currentIncidentState",
    modelType: IncidentState,
    chosen: INVESTIGATING_INCIDENT_STATE,
    placeholder: STATE_PLACEHOLDER,
    emptyMessage: "Will use first available state by priority",
    notFoundMessage: "The selected incident state could not be found.",
  },
  {
    page: INCIDENT_EPISODE_CREATE,
    fieldKey: "currentIncidentState",
    modelType: IncidentState,
    chosen: INVESTIGATING_INCIDENT_STATE,
    placeholder: STATE_PLACEHOLDER,
    emptyMessage: "Will use first available state by priority",
    notFoundMessage: "The selected incident state could not be found.",
  },
];

const EPISODE_SEVERITY_FIELD_CASES: Array<LookupFieldCase> = [
  {
    page: ALERT_EPISODE_CREATE,
    fieldKey: "alertSeverity",
    modelType: AlertSeverity,
    chosen: HIGH_ALERT_SEVERITY,
    placeholder: SEVERITY_PLACEHOLDER,
    emptyMessage: "No alert severity selected.",
    notFoundMessage: "The selected alert severity could not be found.",
  },
  {
    /*
     * Looked up by ids through the list endpoint, as the incident create
     * page's severity already was; an empty answer reads as the list's own
     * empty message.
     */
    page: INCIDENT_EPISODE_CREATE,
    fieldKey: "incidentSeverity",
    modelType: IncidentSeverity,
    chosen: MAJOR_INCIDENT_SEVERITY,
    placeholder: SEVERITY_PLACEHOLDER,
    emptyMessage: "No incident severity selected.",
    notFoundMessage: "No Incident Severities.",
  },
];

async function openForm(page: PageUnderTest): Promise<Array<CapturedField>> {
  render(
    <MemoryRouter>
      <page.component
        pageRoute={new Route(page.route)}
        currentProject={new Project()}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  // The episode pages hold a loader up until their first-state lookup lands.
  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
  });

  /*
   * Whatever the page asks for on mount has been asked by now, so from here
   * on every request is one a summary made.
   */
  getListMock.mockClear();
  getItemMock.mockClear();

  return capturedForm!.fields;
}

function keyOf(field: CapturedField): string | undefined {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || field.overrideField || {})[0]
  );
}

function findField(
  fields: Array<CapturedField>,
  fieldKey: string,
): CapturedField {
  const field: CapturedField | undefined = fields.find(
    (candidate: CapturedField): boolean => {
      return keyOf(candidate) === fieldKey;
    },
  );

  expect(field).toBeDefined();

  return field!;
}

// Renders a field's summary and waits for any lookup it starts to settle.
async function renderSummary(
  field: CapturedField,
  item: SummaryItem,
): Promise<RenderResult> {
  expect(field.getSummaryElement).toBeDefined();

  const result: RenderResult = render(
    <MemoryRouter>{field.getSummaryElement!(item)}</MemoryRouter>,
  );

  await waitFor(() => {
    expect(
      within(result.container).queryAllByTestId("component-loader"),
    ).toHaveLength(0);
  });

  return result;
}

/*
 * Whether anything in the summary is painted in the given color: the pills
 * put it on the pill itself or, in their minimal form, on a dot beside the
 * name.
 */
function paintsColor(container: HTMLElement, hex: string): boolean {
  const rgb: RGB = Color.colorToRgb(new Color(hex));
  const expected: string = `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`;

  return Array.from(container.querySelectorAll<HTMLElement>("*")).some(
    (element: HTMLElement): boolean => {
      return element.style.backgroundColor === expected;
    },
  );
}

/*
 * A value for a field as the form would hold it once something is picked:
 * the known record's id for a state or severity, so its lookup succeeds, and
 * a fresh id (or a list of one) for everything else.
 */
function representativeValue(field: CapturedField): unknown {
  const fixture: NamedFixture | undefined = field.dropdownModal
    ? LOOKUP_FIXTURES.get(field.dropdownModal.type)
    : undefined;

  if (fixture) {
    return fixture.id;
  }

  if (field.fieldType === FormFieldSchemaType.Dropdown) {
    return ObjectID.generate().toString();
  }

  return [ObjectID.generate().toString()];
}

describe("the create wizards' review step", () => {
  beforeEach(() => {
    capturedForm = null;
    lookupAnswer = LookupAnswer.Found;
    getListMock.mockReset();
    getItemMock.mockReset();
    getListMock.mockImplementation(answerList as never);
    getItemMock.mockImplementation(answerItem as never);

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe.each([...STATE_FIELD_CASES, ...EPISODE_SEVERITY_FIELD_CASES])(
    "the $fieldKey summary on the $page.name page",
    (fieldCase: LookupFieldCase) => {
      test("names the chosen value in its color instead of a placeholder sentence", async () => {
        const field: CapturedField = findField(
          await openForm(fieldCase.page),
          fieldCase.fieldKey,
        );

        const { container } = await renderSummary(field, {
          [fieldCase.fieldKey]: fieldCase.chosen.id,
        });

        expect(
          within(container).getByText(fieldCase.chosen.name),
        ).toBeInTheDocument();
        expect(paintsColor(container, fieldCase.chosen.color)).toBe(true);
        expect(container).not.toHaveTextContent(fieldCase.placeholder);
        expect(container.textContent).not.toMatch(ANY_PLACEHOLDER_PATTERN);
      });

      test("looks up exactly the chosen id of its own model type, asking for the name and color", async () => {
        const field: CapturedField = findField(
          await openForm(fieldCase.page),
          fieldCase.fieldKey,
        );

        await renderSummary(field, {
          [fieldCase.fieldKey]: fieldCase.chosen.id,
        });

        expect(lookupsMade()).toEqual([
          {
            modelType: fieldCase.modelType,
            ids: [fieldCase.chosen.id],
            select: expect.objectContaining({ name: true, color: true }),
          },
        ]);
      });

      test("keeps its nothing-chosen message and looks nothing up when nothing is chosen", async () => {
        const field: CapturedField = findField(
          await openForm(fieldCase.page),
          fieldCase.fieldKey,
        );

        const { container } = await renderSummary(field, {});

        // Let anything the summary might have started get as far as the API.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        expect(container).toHaveTextContent(fieldCase.emptyMessage);
        expect(container.textContent).not.toMatch(ANY_PLACEHOLDER_PATTERN);
        expect(lookupsMade()).toEqual([]);
      });

      test("shows the error when the lookup fails, not a placeholder sentence", async () => {
        lookupAnswer = LookupAnswer.Failed;

        const field: CapturedField = findField(
          await openForm(fieldCase.page),
          fieldCase.fieldKey,
        );

        const { container } = await renderSummary(field, {
          [fieldCase.fieldKey]: fieldCase.chosen.id,
        });

        expect(container).toHaveTextContent(LOOKUP_FAILURE_MESSAGE);
        expect(container).not.toHaveTextContent(fieldCase.chosen.name);
        expect(container.textContent).not.toMatch(ANY_PLACEHOLDER_PATTERN);
      });

      test("says so when the chosen value no longer exists", async () => {
        lookupAnswer = LookupAnswer.Missing;

        const field: CapturedField = findField(
          await openForm(fieldCase.page),
          fieldCase.fieldKey,
        );

        const { container } = await renderSummary(field, {
          [fieldCase.fieldKey]: fieldCase.chosen.id,
        });

        expect(container).toHaveTextContent(fieldCase.notFoundMessage);
        expect(container).not.toHaveTextContent(fieldCase.chosen.name);
        expect(container.textContent).not.toMatch(ANY_PLACEHOLDER_PATTERN);
      });
    },
  );

  test("the alert create page's severity keeps the form's own dropdown summary", async () => {
    /*
     * Only the episode wizards had a severity sentence to replace. The alert
     * wizard's severity never had a summary of its own, so the form shows the
     * picked option's label for it, and it stays that way.
     */
    const field: CapturedField = findField(
      await openForm(ALERT_CREATE),
      "alertSeverity",
    );

    expect(field.getSummaryElement).toBeUndefined();
    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.dropdownModal?.type).toBe(AlertSeverity);
  });

  describe.each(PAGES)("on the $name page", (page: PageUnderTest) => {
    test("no summary says a choice will be set to the selected one, chosen or not", async () => {
      const fields: Array<CapturedField> = await openForm(page);
      const withSummary: Array<CapturedField> = fields.filter(
        (field: CapturedField): boolean => {
          return Boolean(field.getSummaryElement);
        },
      );

      // Not vacuous: the state field is among the summaries rendered.
      expect(withSummary.map(keyOf)).toContain(page.stateFieldKey);

      const chosenItem: SummaryItem = {};
      for (const field of withSummary) {
        chosenItem[keyOf(field)!] = representativeValue(field);
      }

      const offenders: Array<string> = [];

      for (const field of withSummary) {
        for (const [label, item] of [
          ["chosen", chosenItem],
          ["nothing chosen", {}],
        ] as Array<[string, SummaryItem]>) {
          const result: RenderResult = await renderSummary(field, item);
          const text: string = result.container.textContent || "";

          if (ANY_PLACEHOLDER_PATTERN.test(text)) {
            offenders.push(`${keyOf(field)} (${label}): "${text}"`);
          }

          result.unmount();
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});
