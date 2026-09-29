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
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The incident and episode create wizards have a step that assigns people to
 * incident roles, and end on a review step that lists what each step picked.
 * The roles editor hands the page only ids - a role's id and the ids of the
 * users assigned to it - and the review step used to boil them down to one
 * sentence, "3 users assigned to 2 roles.", naming neither the roles nor the
 * people. Make Alice the Incident Commander and Bob the Scribe, and the one
 * screen meant to confirm it said "2 users assigned to 2 roles."
 *
 * The review step now looks the roles up in one request and lists each one in
 * its color, with the people assigned to it beneath. These tests drive both
 * real pages with ModelForm mocked to capture the fields it is handed (as
 * CreateReviewStepSelectionSummary.test.tsx does), assign roles the way the
 * editor does - through the onChange of the element the roles field builds,
 * the only thing that fills the ref the summary reads - and render the
 * summary against a ModelAPI that knows a few roles and users by id. They
 * check what a user reads there, which person is listed under which role, and
 * what is asked of the API.
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

type EditorElementProps = {
  onChange?: ((value: unknown) => void) | undefined;
};

type CapturedField = {
  field?: Record<string, unknown> | undefined;
  overrideField?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  getCustomElement?:
    | ((value: SummaryItem, props: EditorElementProps) => React.ReactElement)
    | undefined;
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

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mocks are still unassigned when the factory runs.
 */
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

import IncidentRoleFormField, {
  RoleAssignment,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentRoleFormField";
import IncidentEpisodeRoleFormField from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeRoleFormField";
import FetchIncidentRoleAssignments from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentRole/FetchIncidentRoleAssignments";
import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import IncidentEpisodeCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeCreate";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color, { RGB } from "../../../Types/Color";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "3b1d7c2e-5f4a-4e6b-9c8d-7a6f5e4d3c2b";

// What the episode page preselects on mount: the first state by order.
const FIRST_INCIDENT_STATE_ID: string = "11111111-1111-4111-8111-000000000002";

type RoleFixture = {
  id: string;
  name: string;
  color: string;
};

type UserFixture = {
  id: string;
  name: string;
  email: string;
};

const COMMUNICATIONS_LEAD: RoleFixture = {
  id: "44444444-4444-4444-8444-000000000001",
  name: "Communications Lead",
  color: "#0ea5e9",
};

const INCIDENT_COMMANDER: RoleFixture = {
  id: "44444444-4444-4444-8444-000000000002",
  name: "Incident Commander",
  color: "#7c3aed",
};

const SCRIBE: RoleFixture = {
  id: "44444444-4444-4444-8444-000000000003",
  name: "Scribe",
  color: "#16a34a",
};

/*
 * The roles the API knows, in the order it answers them: the lookup sorts by
 * name, so this is not the order the tests assign them in.
 */
const ROLE_FIXTURES: Array<RoleFixture> = [
  COMMUNICATIONS_LEAD,
  INCIDENT_COMMANDER,
  SCRIBE,
];

// A role that was assigned in the editor and deleted before the review step.
const DELETED_ROLE_ID: string = "44444444-4444-4444-8444-0000000000ff";

const ALICE: UserFixture = {
  id: "55555555-5555-4555-8555-000000000001",
  name: "Alice Nakamura",
  email: "alice@example.com",
};

const BOB: UserFixture = {
  id: "55555555-5555-4555-8555-000000000002",
  name: "Bob Okafor",
  email: "bob@example.com",
};

const CAROL: UserFixture = {
  id: "55555555-5555-4555-8555-000000000003",
  name: "Carol Mendes",
  email: "carol@example.com",
};

const DEV: UserFixture = {
  id: "55555555-5555-4555-8555-000000000004",
  name: "Dev Patel",
  email: "dev@example.com",
};

const USER_FIXTURES: Array<UserFixture> = [ALICE, BOB, CAROL, DEV];

function assignmentOf(
  roleId: string,
  users: Array<UserFixture>,
): RoleAssignment {
  return {
    roleId: roleId,
    userIds: users.map((user: UserFixture): string => {
      return user.id;
    }),
  };
}

/*
 * Two people under one role, so a list that drops or regroups one of them
 * shows, and roles assigned in an order that is not the API's name order.
 */
const ASSIGNMENTS: Array<RoleAssignment> = [
  assignmentOf(INCIDENT_COMMANDER.id, [ALICE, BOB]),
  assignmentOf(COMMUNICATIONS_LEAD.id, [CAROL]),
  assignmentOf(SCRIBE.id, [DEV]),
];

enum LookupAnswer {
  Found = "found",
  Failed = "failed",
}

// How the role lookup answers; the user lookups always answer.
let roleLookupAnswer: LookupAnswer = LookupAnswer.Found;

const LOOKUP_FAILURE_MESSAGE: string = "Could not reach the server right now.";

const ROLE_NOT_FOUND_MESSAGE: string = "The selected role could not be found.";

// The shape of the sentence this replaced: "3 users assigned to 2 roles."
const COUNT_SENTENCE_PATTERNS: Array<RegExp> = [
  /assigned to/i,
  /\d+ users?\b/i,
];

type ListRequest = {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

type ItemRequest = {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
};

type ListAnswer = {
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
};

function listOf(data: Array<BaseModel>): ListAnswer {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

function makeRole(fixture: RoleFixture): IncidentRole {
  const role: IncidentRole = new IncidentRole();
  role._id = fixture.id;
  role.name = fixture.name;
  role.color = new Color(fixture.color);
  return role;
}

function makeUser(fixture: UserFixture): User {
  const user: User = new User();
  user._id = fixture.id;
  user.name = new Name(fixture.name);
  user.email = new Email(fixture.email);
  return user;
}

function rolesAnswer(fixtures: Array<RoleFixture>): ListAnswer {
  return listOf(fixtures.map(makeRole));
}

// The ids a lookup asks for: roles by `_id`, people through TeamMember's `userId`.
function idsIn(query: Record<string, unknown>): Array<string> | null {
  const idQuery: unknown = query["_id"] ?? query["userId"];

  if (!(idQuery instanceof Includes)) {
    return null;
  }

  return idQuery.values.map((value: string | ObjectID | number): string => {
    return value.toString();
  });
}

async function answerList(request: ListRequest): Promise<ListAnswer> {
  const ids: Array<string> | null = idsIn(request.query);

  // A lookup of roles by ids: ids the API does not know are simply absent.
  if (request.modelType === IncidentRole && ids) {
    if (roleLookupAnswer === LookupAnswer.Failed) {
      throw new Error(LOOKUP_FAILURE_MESSAGE);
    }

    return rolesAnswer(
      ROLE_FIXTURES.filter((fixture: RoleFixture): boolean => {
        return ids.includes(fixture.id);
      }),
    );
  }

  /*
   * People are looked up through TeamMember, the project-scoped link to User:
   * the server refuses a list of other users by id from the User model
   * itself. A person in several teams comes back once per team - Alice is in
   * two - so a summary that lists every row would name her twice.
   */
  if (request.modelType === TeamMember && ids) {
    return listOf(
      USER_FIXTURES.filter((fixture: UserFixture): boolean => {
        return ids.includes(fixture.id);
      }).flatMap((fixture: UserFixture): Array<TeamMember> => {
        return Array.from(
          { length: fixture.id === ALICE.id ? 2 : 1 },
          (): TeamMember => {
            const teamMember: TeamMember = new TeamMember();
            teamMember._id = ObjectID.generate().toString();
            teamMember.user = makeUser(fixture);
            return teamMember;
          },
        );
      }),
    );
  }

  // The episode page holds a loader up until this lookup lands.
  if (request.modelType === IncidentState) {
    const firstState: IncidentState = new IncidentState();
    firstState._id = FIRST_INCIDENT_STATE_ID;
    firstState.name = "Created";
    firstState.color = new Color("#ef4444");
    return listOf([firstState]);
  }

  // Labels, teams, severities and the rest: nothing to show.
  return listOf([]);
}

type Lookup = {
  modelType: unknown;
  ids: Array<string>;
  select: unknown;
};

/*
 * Every request made since the last clear, whichever of getItem or getList
 * carried it, as the model type, ids and columns it asked for.
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
      return {
        modelType: request.modelType,
        ids: idsIn(request.query) || [],
        select: request.select,
      };
    },
  );

  return [...itemLookups, ...listLookups];
}

function lookupsOf(modelType: unknown): Array<Lookup> {
  return lookupsMade().filter((lookup: Lookup): boolean => {
    return lookup.modelType === modelType;
  });
}

// Id lists compared as sets: the order ids are asked for in is not the point.
function asIdSet(ids: Array<string>): string {
  return [...ids]
    .sort((left: string, right: string): number => {
      return left.localeCompare(right);
    })
    .join(",");
}

function asIdSets(idLists: Array<Array<string>>): Array<string> {
  return idLists.map(asIdSet).sort((left: string, right: string): number => {
    return left.localeCompare(right);
  });
}

type PageUnderTest = {
  name: string;
  component: React.FunctionComponent<PageComponentProps>;
  route: string;
  rolesFieldKey: string;
  editorType: unknown;
  emptyMessage: string;
};

const INCIDENT_CREATE: PageUnderTest = {
  name: "incident create",
  component: IncidentCreate,
  route: "/dashboard/incidents/create",
  rolesFieldKey: "incidentRoles",
  editorType: IncidentRoleFormField,
  emptyMessage: "No incident roles assigned.",
};

const INCIDENT_EPISODE_CREATE: PageUnderTest = {
  name: "incident episode create",
  component: IncidentEpisodeCreate,
  route: "/dashboard/incidents/episodes/create",
  rolesFieldKey: "episodeRoles",
  editorType: IncidentEpisodeRoleFormField,
  emptyMessage: "No episode roles assigned.",
};

const PAGES: Array<PageUnderTest> = [INCIDENT_CREATE, INCIDENT_EPISODE_CREATE];

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

  // The episode page holds a loader up until its first-state lookup lands.
  await waitFor(() => {
    expect(capturedForm).not.toBeNull();
  });

  /*
   * Whatever the page asks for on mount has been asked by now, so from here
   * on every request is one the summary made.
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

/*
 * Assigns roles as the editor does. The roles field hands the form an editor
 * element whose onChange is the only thing that fills the ref the summary
 * reads - the form values carry nothing for this field. The element is never
 * rendered (its own role and user lookups are not what these tests are
 * about); its onChange is called as the editor would call it.
 */
function assignInEditor(
  page: PageUnderTest,
  field: CapturedField,
  assignments: Array<RoleAssignment>,
): void {
  expect(field.getCustomElement).toBeDefined();

  const editor: React.ReactElement = field.getCustomElement!(
    {},
    {
      onChange: (): void => {
        // The form's own copy of the value is not what the summary reads.
      },
    },
  );

  expect(editor.type).toBe(page.editorType);

  const editorProps: {
    onChange: (value: Array<RoleAssignment>) => void;
  } = editor.props as { onChange: (value: Array<RoleAssignment>) => void };

  editorProps.onChange(assignments);
}

function summaryOf(field: CapturedField): React.ReactElement {
  expect(field.getSummaryElement).toBeDefined();

  // The summary reads the editor's ref, not the form values it is given.
  return <MemoryRouter>{field.getSummaryElement!({})}</MemoryRouter>;
}

async function waitForLookupsToSettle(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(within(container).queryAllByTestId("component-loader")).toHaveLength(
      0,
    );
  });
}

// Renders the field's summary and waits for every lookup it starts to settle.
async function renderSummary(field: CapturedField): Promise<RenderResult> {
  const result: RenderResult = render(summaryOf(field));

  await waitForLookupsToSettle(result.container);

  return result;
}

function rgbOf(hex: string): string {
  const rgb: RGB = Color.colorToRgb(new Color(hex));
  return `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`;
}

/*
 * Whether anything in the summary is painted in the given color: the pills
 * put it on the pill itself or, in their minimal form, on a dot beside the
 * name.
 */
function paintsColor(container: HTMLElement, hex: string): boolean {
  const expected: string = rgbOf(hex);

  return Array.from(container.querySelectorAll<HTMLElement>("*")).some(
    (element: HTMLElement): boolean => {
      return element.style.backgroundColor === expected;
    },
  );
}

/*
 * The color of the pill that carries this name, so each role is checked
 * against its own color and two roles cannot trade theirs. The role pill is
 * the minimal one: a rounded outline, with the color on a dot beside the name.
 */
function pillColorOf(container: HTMLElement, name: string): string {
  const pill: HTMLElement | null = within(container)
    .getByText(name)
    .closest(".rounded-full");

  expect(pill).not.toBeNull();

  const dot: HTMLElement | null = pill!.querySelector('[aria-hidden="true"]');

  return (dot || pill!).style.backgroundColor;
}

function precedes(earlier: HTMLElement, later: HTMLElement): boolean {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

type PlacedText = {
  text: string;
  element: HTMLElement;
};

// Where each text sits, in document order. getByText fails on a duplicate.
function inDocumentOrder(
  container: HTMLElement,
  texts: Array<string>,
): Array<PlacedText> {
  return texts
    .map((text: string): PlacedText => {
      return { text: text, element: within(container).getByText(text) };
    })
    .sort((left: PlacedText, right: PlacedText): number => {
      return precedes(left.element, right.element) ? -1 : 1;
    });
}

/*
 * Which heading - a role's name, or the sentence that stands in for a role
 * that is gone - each person is listed under: the nearest one above them.
 * Each person must appear exactly once, so nobody is also listed under a
 * role they were not assigned to.
 */
function listedUnder(
  container: HTMLElement,
  headings: Array<string>,
  people: Array<string>,
): Record<string, string | null> {
  const placedHeadings: Array<PlacedText> = inDocumentOrder(
    container,
    headings,
  );
  const result: Record<string, string | null> = {};

  for (const person of people) {
    const row: HTMLElement = within(container).getByText(person);
    let heading: string | null = null;

    for (const placed of placedHeadings) {
      if (precedes(placed.element, row)) {
        heading = placed.text;
      }
    }

    result[person] = heading;
  }

  return result;
}

function namesOf(fixtures: Array<RoleFixture | UserFixture>): Array<string> {
  return fixtures.map((fixture: RoleFixture | UserFixture): string => {
    return fixture.name;
  });
}

/*
 * Asserting on the DOM after each step can miss text that was painted and
 * then replaced inside a single act(). This keeps every text the container
 * ever held - added nodes and the old value of every edited text node - so a
 * test can say a sentence never reached the screen, not just that it is gone.
 */
interface TextHistory {
  everShown: (text: string) => boolean;
  stop: () => void;
}

function recordTextHistory(root: HTMLElement): TextHistory {
  const seen: Array<string> = [root.textContent || ""];

  const collect: (records: Array<MutationRecord>) => void = (
    records: Array<MutationRecord>,
  ): void => {
    for (const record of records) {
      if (record.oldValue) {
        seen.push(record.oldValue);
      }

      record.addedNodes.forEach((node: Node): void => {
        seen.push(node.textContent || "");
      });
    }

    seen.push(root.textContent || "");
  };

  const observer: MutationObserver = new MutationObserver(collect);

  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
  });

  return {
    everShown: (text: string): boolean => {
      collect(observer.takeRecords());
      return seen.some((value: string): boolean => {
        return value.includes(text);
      });
    },
    stop: (): void => {
      observer.disconnect();
    },
  };
}

/*
 * A promise the test settles by hand, so it decides which role lookup
 * answers first - that ordering is the whole point of the stale-answer tests.
 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};

  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ): void => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise, resolve, reject };
}

beforeEach(() => {
  capturedForm = null;
  roleLookupAnswer = LookupAnswer.Found;
  getListMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockImplementation(answerList as never);
  getItemMock.mockImplementation((async (): Promise<null> => {
    return null;
  }) as never);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PAGES)(
  "the roles summary on the $name page's review step",
  (page: PageUnderTest) => {
    test("names each assigned role in its color, with the people assigned to it beneath", async () => {
      const field: CapturedField = findField(
        await openForm(page),
        page.rolesFieldKey,
      );

      assignInEditor(page, field, ASSIGNMENTS);

      const { container } = await renderSummary(field);

      for (const role of [INCIDENT_COMMANDER, COMMUNICATIONS_LEAD, SCRIBE]) {
        expect(within(container).getByText(role.name)).toBeInTheDocument();
        expect(paintsColor(container, role.color)).toBe(true);
        expect(pillColorOf(container, role.name)).toBe(rgbOf(role.color));
      }

      // In the order they were assigned, not the order the API answered.
      expect(
        inDocumentOrder(
          container,
          namesOf([COMMUNICATIONS_LEAD, SCRIBE, INCIDENT_COMMANDER]),
        ).map((placed: PlacedText): string => {
          return placed.text;
        }),
      ).toEqual(namesOf([INCIDENT_COMMANDER, COMMUNICATIONS_LEAD, SCRIBE]));

      expect(
        listedUnder(
          container,
          namesOf([INCIDENT_COMMANDER, COMMUNICATIONS_LEAD, SCRIBE]),
          namesOf([ALICE, BOB, CAROL, DEV]),
        ),
      ).toEqual({
        [ALICE.name]: INCIDENT_COMMANDER.name,
        [BOB.name]: INCIDENT_COMMANDER.name,
        [CAROL.name]: COMMUNICATIONS_LEAD.name,
        [DEV.name]: SCRIBE.name,
      });
    });

    test("never counts users and roles instead of naming them", async () => {
      const field: CapturedField = findField(
        await openForm(page),
        page.rolesFieldKey,
      );

      assignInEditor(page, field, ASSIGNMENTS);

      const { container } = await renderSummary(field);

      // Not vacuous: the roles and people are on screen.
      expect(container).toHaveTextContent(INCIDENT_COMMANDER.name);
      expect(container).toHaveTextContent(ALICE.name);

      for (const pattern of COUNT_SENTENCE_PATTERNS) {
        expect(container.textContent).not.toMatch(pattern);
      }
    });

    test("looks the roles up once, by exactly the assigned ids, and each role's people by exactly theirs", async () => {
      const field: CapturedField = findField(
        await openForm(page),
        page.rolesFieldKey,
      );

      assignInEditor(page, field, ASSIGNMENTS);

      await renderSummary(field);

      const roleLookups: Array<Lookup> = lookupsOf(IncidentRole);
      const userLookups: Array<Lookup> = lookupsOf(TeamMember);

      expect(roleLookups).toHaveLength(1);
      expect(asIdSet(roleLookups[0]!.ids)).toBe(
        asIdSet(
          ASSIGNMENTS.map((assignment: RoleAssignment): string => {
            return assignment.roleId;
          }),
        ),
      );
      expect(roleLookups[0]!.select).toEqual(
        expect.objectContaining({ _id: true, name: true, color: true }),
      );

      // One lookup per role, each for exactly the people assigned to it.
      expect(
        asIdSets(
          userLookups.map((lookup: Lookup): Array<string> => {
            return lookup.ids;
          }),
        ),
      ).toEqual(
        asIdSets(
          ASSIGNMENTS.map((assignment: RoleAssignment): Array<string> => {
            return assignment.userIds;
          }),
        ),
      );

      // And nothing else - never the User model, which would refuse it.
      expect(lookupsOf(User)).toEqual([]);
      expect(lookupsMade()).toHaveLength(
        roleLookups.length + userLookups.length,
      );
    });

    test.each([
      {
        how: "the editor was never touched",
        edits: [] as Array<Array<RoleAssignment>>,
      },
      {
        how: "the editor took back every role it had assigned",
        edits: [ASSIGNMENTS, []] as Array<Array<RoleAssignment>>,
      },
    ])(
      "keeps its empty sentence and looks nothing up when $how",
      async ({ edits }: { edits: Array<Array<RoleAssignment>> }) => {
        const field: CapturedField = findField(
          await openForm(page),
          page.rolesFieldKey,
        );

        for (const assignments of edits) {
          assignInEditor(page, field, assignments);
        }

        const { container } = await renderSummary(field);

        // Let anything the summary might have started get as far as the API.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        expect(container).toHaveTextContent(page.emptyMessage);
        expect(container).not.toHaveTextContent(INCIDENT_COMMANDER.name);
        expect(lookupsMade()).toEqual([]);
      },
    );

    test("shows the error when the role lookup fails, and no role name", async () => {
      roleLookupAnswer = LookupAnswer.Failed;

      const field: CapturedField = findField(
        await openForm(page),
        page.rolesFieldKey,
      );

      assignInEditor(page, field, ASSIGNMENTS);

      const { container } = await renderSummary(field);

      expect(container).toHaveTextContent(LOOKUP_FAILURE_MESSAGE);

      for (const role of [INCIDENT_COMMANDER, COMMUNICATIONS_LEAD, SCRIBE]) {
        expect(container).not.toHaveTextContent(role.name);
      }

      for (const pattern of COUNT_SENTENCE_PATTERNS) {
        expect(container.textContent).not.toMatch(pattern);
      }

      /*
       * The error stands in for the whole list: drawn beneath it, every role
       * would read as deleted and each would still look its people up.
       */
      expect(container).not.toHaveTextContent(ROLE_NOT_FOUND_MESSAGE);

      for (const user of USER_FIXTURES) {
        expect(container).not.toHaveTextContent(user.name);
      }

      expect(lookupsOf(TeamMember)).toEqual([]);
    });

    test("says a role that no longer exists could not be found, still lists its people, and names the others", async () => {
      const field: CapturedField = findField(
        await openForm(page),
        page.rolesFieldKey,
      );

      assignInEditor(page, field, [
        assignmentOf(INCIDENT_COMMANDER.id, [ALICE, BOB]),
        assignmentOf(DELETED_ROLE_ID, [CAROL]),
        assignmentOf(SCRIBE.id, [DEV]),
      ]);

      const { container } = await renderSummary(field);

      expect(pillColorOf(container, INCIDENT_COMMANDER.name)).toBe(
        rgbOf(INCIDENT_COMMANDER.color),
      );
      expect(pillColorOf(container, SCRIBE.name)).toBe(rgbOf(SCRIBE.color));

      expect(
        listedUnder(
          container,
          [INCIDENT_COMMANDER.name, ROLE_NOT_FOUND_MESSAGE, SCRIBE.name],
          namesOf([ALICE, BOB, CAROL, DEV]),
        ),
      ).toEqual({
        [ALICE.name]: INCIDENT_COMMANDER.name,
        [BOB.name]: INCIDENT_COMMANDER.name,
        [CAROL.name]: ROLE_NOT_FOUND_MESSAGE,
        [DEV.name]: SCRIBE.name,
      });

      // The gone role was still asked for, in the same one lookup.
      expect(lookupsOf(IncidentRole)).toHaveLength(1);
      expect(asIdSet(lookupsOf(IncidentRole)[0]!.ids)).toBe(
        asIdSet([INCIDENT_COMMANDER.id, DELETED_ROLE_ID, SCRIBE.id]),
      );
    });

    test("after the editor changes a role's people, shows the new people and not the old", async () => {
      const field: CapturedField = findField(
        await openForm(page),
        page.rolesFieldKey,
      );

      assignInEditor(page, field, [
        assignmentOf(INCIDENT_COMMANDER.id, [ALICE]),
      ]);

      const result: RenderResult = await renderSummary(field);

      expect(
        within(result.container).getByText(ALICE.name),
      ).toBeInTheDocument();

      getListMock.mockClear();

      // Back to the roles step, and back to the review step.
      assignInEditor(page, field, [
        assignmentOf(INCIDENT_COMMANDER.id, [BOB, CAROL]),
      ]);

      result.rerender(summaryOf(field));

      await waitForLookupsToSettle(result.container);

      expect(
        listedUnder(
          result.container,
          [INCIDENT_COMMANDER.name],
          namesOf([BOB, CAROL]),
        ),
      ).toEqual({
        [BOB.name]: INCIDENT_COMMANDER.name,
        [CAROL.name]: INCIDENT_COMMANDER.name,
      });
      expect(result.container).not.toHaveTextContent(ALICE.name);

      /*
       * The new people were looked up; the role, the same one as before,
       * was not asked for again.
       */
      expect(lookupsOf(TeamMember)).toHaveLength(1);
      expect(asIdSet(lookupsOf(TeamMember)[0]!.ids)).toBe(
        asIdSet([BOB.id, CAROL.id]),
      );
      expect(lookupsOf(IncidentRole)).toEqual([]);
    });

    test("after the editor assigns another role, looks the new set up and names it", async () => {
      const field: CapturedField = findField(
        await openForm(page),
        page.rolesFieldKey,
      );

      assignInEditor(page, field, [
        assignmentOf(INCIDENT_COMMANDER.id, [ALICE]),
      ]);

      const result: RenderResult = await renderSummary(field);

      expect(result.container).not.toHaveTextContent(SCRIBE.name);

      getListMock.mockClear();

      assignInEditor(page, field, [
        assignmentOf(INCIDENT_COMMANDER.id, [ALICE]),
        assignmentOf(SCRIBE.id, [DEV]),
      ]);

      result.rerender(summaryOf(field));

      await waitForLookupsToSettle(result.container);

      expect(pillColorOf(result.container, SCRIBE.name)).toBe(
        rgbOf(SCRIBE.color),
      );
      expect(
        listedUnder(
          result.container,
          [INCIDENT_COMMANDER.name, SCRIBE.name],
          namesOf([ALICE, DEV]),
        ),
      ).toEqual({
        [ALICE.name]: INCIDENT_COMMANDER.name,
        [DEV.name]: SCRIBE.name,
      });

      expect(lookupsOf(IncidentRole)).toHaveLength(1);
      expect(asIdSet(lookupsOf(IncidentRole)[0]!.ids)).toBe(
        asIdSet([INCIDENT_COMMANDER.id, SCRIBE.id]),
      );
    });
  },
);

describe("FetchIncidentRoleAssignments", () => {
  const COMMANDER_WITH_ALICE: Array<RoleAssignment> = [
    assignmentOf(INCIDENT_COMMANDER.id, [ALICE]),
  ];

  const LEAD_WITH_BOB: Array<RoleAssignment> = [
    assignmentOf(COMMUNICATIONS_LEAD.id, [BOB]),
  ];

  function assignmentsElement(
    assignments: Array<RoleAssignment>,
  ): React.ReactElement {
    return <FetchIncidentRoleAssignments assignments={assignments} />;
  }

  /*
   * Role lookups answer with these, in order, when the test settles them;
   * user lookups keep answering from the fixtures straight away.
   */
  function holdRoleLookups(lookups: Array<Deferred<ListAnswer>>): void {
    const queue: Array<Deferred<ListAnswer>> = [...lookups];

    getListMock.mockImplementation(((
      request: ListRequest,
    ): Promise<ListAnswer> => {
      const held: Deferred<ListAnswer> | undefined =
        request.modelType === IncidentRole ? queue.shift() : undefined;

      return held ? held.promise : answerList(request);
    }) as never);
  }

  function roleLookupIds(): Array<Array<string>> {
    return lookupsOf(IncidentRole).map((lookup: Lookup): Array<string> => {
      return lookup.ids;
    });
  }

  test("an answer for the old roles that arrives after the new roles' answer never replaces it", async () => {
    const firstLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    const secondLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    holdRoleLookups([firstLookup, secondLookup]);

    const view: RenderResult = render(assignmentsElement(COMMANDER_WITH_ALICE));
    const history: TextHistory = recordTextHistory(view.container);

    view.rerender(assignmentsElement(LEAD_WITH_BOB));

    expect(roleLookupIds()).toEqual([
      [INCIDENT_COMMANDER.id],
      [COMMUNICATIONS_LEAD.id],
    ]);

    await act(async () => {
      secondLookup.resolve(rolesAnswer([COMMUNICATIONS_LEAD]));
    });

    expect(await screen.findByText(BOB.name)).toBeInTheDocument();
    expect(screen.getByText(COMMUNICATIONS_LEAD.name)).toBeInTheDocument();

    /*
     * The old answer holds only the Incident Commander. Were it let in, it
     * would be filed under the Commander's roles, and the summary would fall
     * back to the loader for good: nothing asks for the Communications Lead
     * again.
     */
    await act(async () => {
      firstLookup.resolve(rolesAnswer([INCIDENT_COMMANDER]));
    });

    expect(screen.queryByTestId("component-loader")).toBeNull();

    expect(screen.getByText(COMMUNICATIONS_LEAD.name)).toBeInTheDocument();
    expect(pillColorOf(view.container, COMMUNICATIONS_LEAD.name)).toBe(
      rgbOf(COMMUNICATIONS_LEAD.color),
    );
    expect(screen.getByText(BOB.name)).toBeInTheDocument();
    expect(history.everShown(ROLE_NOT_FOUND_MESSAGE)).toBe(false);

    history.stop();
  });

  test("an answer for the old roles that arrives while the new roles are loading is ignored", async () => {
    const firstLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    const secondLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    holdRoleLookups([firstLookup, secondLookup]);

    const view: RenderResult = render(assignmentsElement(COMMANDER_WITH_ALICE));
    const history: TextHistory = recordTextHistory(view.container);

    view.rerender(assignmentsElement(LEAD_WITH_BOB));

    await act(async () => {
      firstLookup.resolve(rolesAnswer([INCIDENT_COMMANDER]));
    });

    // Still waiting on the roles that are actually assigned.
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();

    await act(async () => {
      secondLookup.resolve(rolesAnswer([COMMUNICATIONS_LEAD]));
    });

    expect(await screen.findByText(BOB.name)).toBeInTheDocument();
    expect(screen.getByText(COMMUNICATIONS_LEAD.name)).toBeInTheDocument();
    expect(history.everShown(ROLE_NOT_FOUND_MESSAGE)).toBe(false);

    history.stop();
  });

  test("a failure for the old roles that arrives after the new roles' answer is ignored too", async () => {
    const firstLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    const secondLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    holdRoleLookups([firstLookup, secondLookup]);

    const view: RenderResult = render(assignmentsElement(COMMANDER_WITH_ALICE));

    view.rerender(assignmentsElement(LEAD_WITH_BOB));

    await act(async () => {
      secondLookup.resolve(rolesAnswer([COMMUNICATIONS_LEAD]));
    });

    expect(await screen.findByText(BOB.name)).toBeInTheDocument();

    await act(async () => {
      firstLookup.reject(new Error(LOOKUP_FAILURE_MESSAGE));
    });

    expect(screen.queryByTestId("component-loader")).toBeNull();
    expect(screen.getByText(COMMUNICATIONS_LEAD.name)).toBeInTheDocument();
    expect(screen.getByText(BOB.name)).toBeInTheDocument();
    expect(screen.queryByText(LOOKUP_FAILURE_MESSAGE)).toBeNull();
  });

  test("a new set of roles waits for its own answer instead of drawing from the old one", async () => {
    const firstLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    const secondLookup: Deferred<ListAnswer> = createDeferred<ListAnswer>();
    holdRoleLookups([firstLookup, secondLookup]);

    const view: RenderResult = render(assignmentsElement(COMMANDER_WITH_ALICE));

    await act(async () => {
      firstLookup.resolve(rolesAnswer([INCIDENT_COMMANDER]));
    });

    expect(await screen.findByText(ALICE.name)).toBeInTheDocument();

    getListMock.mockClear();
    const history: TextHistory = recordTextHistory(view.container);

    view.rerender(
      assignmentsElement([
        assignmentOf(INCIDENT_COMMANDER.id, [ALICE]),
        assignmentOf(SCRIBE.id, [DEV]),
      ]),
    );

    /*
     * The old answer holds no Scribe. Drawn from it, the Scribe would read as
     * not found for a render, and Dev would be looked up for a list that is
     * about to be replaced.
     */
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(lookupsOf(TeamMember)).toEqual([]);

    await act(async () => {
      secondLookup.resolve(rolesAnswer([INCIDENT_COMMANDER, SCRIBE]));
    });

    expect(await screen.findByText(DEV.name)).toBeInTheDocument();
    expect(pillColorOf(view.container, SCRIBE.name)).toBe(rgbOf(SCRIBE.color));
    expect(history.everShown(ROLE_NOT_FOUND_MESSAGE)).toBe(false);
    expect(
      asIdSets(
        lookupsOf(TeamMember).map((lookup: Lookup): Array<string> => {
          return lookup.ids;
        }),
      ),
    ).toEqual(asIdSets([[ALICE.id], [DEV.id]]));

    history.stop();
  });
});
