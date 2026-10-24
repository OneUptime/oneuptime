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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Security Events > Playbooks > Start from a template: a template becomes a
 * working playbook in one click, built as Turn on recommended builds one
 * (SecurityTemplateRecords), and one that cannot be added says why in the
 * product's words - in the amber box the Overview and the Rule Library
 * use, never a server's raw sentence centred in grey, the way Turn on
 * recommended's "name length cannot be more than 50 characters" read.
 *
 * The playbooks table below the templates is its own component, mocked
 * here: these tests are about the templates.
 */

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return React.createElement("div", {
        "data-testid": "security-playbooks-table",
      });
    },
  };
});

import SecurityPlaybooksPage, {
  PLAYBOOK_NOT_ADDED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Playbooks";
import {
  SECURITY_PLAYBOOK_TEMPLATES,
  SecurityPlaybookTemplate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplates";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { buildSecurityPlaybookFromTemplate } from "../../../Utils/SecurityEvent/SecurityTemplateRecords";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../Helpers/SecurityCaseValues";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PLAYBOOK_ID: string = "22222222-2222-4222-8222-222222222222";

const TEMPLATE: SecurityPlaybookTemplate = SECURITY_PLAYBOOK_TEMPLATES.find(
  (template: SecurityPlaybookTemplate): boolean => {
    return template.key === "known-bad";
  },
)!;

let navigatedTo: Array<string> = [];

beforeEach(() => {
  navigatedTo = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(Navigation, "navigate").mockImplementation((route: unknown) => {
    navigatedTo.push(String(route));
  });
  // The project's case priorities and statuses: a new project's.
  stubDashboardSecurityCaseValues();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// Each playbook the page sent, failing with what `fail` answers for it.
function recordCreates(
  fail: (attempt: number) => HTTPErrorResponse | Error | null,
): Array<SecurityPlaybook> {
  const created: Array<SecurityPlaybook> = [];
  let attempt: number = 0;

  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(async (options: { model: BaseModel }) => {
      attempt++;
      const failure: HTTPErrorResponse | Error | null = fail(attempt);

      if (failure) {
        throw failure;
      }

      created.push(options.model as SecurityPlaybook);
      return { data: { _id: PLAYBOOK_ID } } as never;
    });

  return created;
}

// A playbook as the API sends it, its steps without their ids.
function withoutStepIds(playbook: SecurityPlaybook): JSONObject {
  const json: JSONObject = BaseModel.toJSON(playbook, SecurityPlaybook);
  const steps: JSONArray = (json["steps"] as JSONArray) || [];

  expect(steps.length).toBeGreaterThan(0);

  return {
    ...json,
    steps: steps.map((step: JSONValue): JSONObject => {
      const { id, ...rest } = step as JSONObject;
      expect(typeof id).toBe("string");
      return rest;
    }),
  };
}

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityPlaybooksPage
          pageRoute={new Route("/dashboard/security-events/playbooks")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

async function pickTemplate(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByTestId(`security-playbook-template-${TEMPLATE.key}`),
    );
  });
}

function problemsBox(): HTMLElement | null {
  return screen.queryByTestId("security-playbook-template-problems");
}

describe("Playbooks > Start from a template", () => {
  test("a template becomes the playbook Turn on recommended would build, and opens on its page", async () => {
    const created: Array<SecurityPlaybook> = recordCreates((): null => {
      return null;
    });
    await renderPage();

    await pickTemplate();

    expect(created).toHaveLength(1);
    // Each build gives its steps new ids; everything else is the same record.
    expect(withoutStepIds(created[0]!)).toEqual(
      withoutStepIds(
        buildSecurityPlaybookFromTemplate({
          projectId: PROJECT_ID,
          template: TEMPLATE.definition,
          // Its steps name the project's own critical priority and acknowledged status.
          priorities: buildDefaultTestPriorities(),
          statuses: buildDefaultTestStatuses(),
        }),
      ),
    );
    expect(navigatedTo).toHaveLength(1);
    expect(navigatedTo[0]).toContain(PLAYBOOK_ID);
    expect(problemsBox()).toBeNull();
  });

  test.each([
    {
      name: "a role that cannot add it",
      failure: new HTTPErrorResponse(
        403,
        { message: "You do not have permission to create Security Playbook." },
        {},
      ),
      reason: "Your role cannot add it.",
      raw: "You do not have permission",
    },
    {
      name: "a plan that does not include it",
      failure: new HTTPErrorResponse(
        402,
        {
          message: "Please upgrade your plan to Growth to access this feature",
        },
        {},
      ),
      reason: "Please upgrade your plan to Growth to access this feature",
      raw: "",
    },
    {
      name: "a record OneUptime would not save",
      failure: new HTTPErrorResponse(
        400,
        { message: "name length cannot be more than 50 characters" },
        {},
      ),
      reason:
        "OneUptime could not save it: name length cannot be more than 50 characters",
      raw: "",
    },
    {
      name: "a failure on OneUptime's side",
      failure: new HTTPErrorResponse(500, { message: "Server Error" }, {}),
      reason: "Something went wrong while adding it.",
      raw: "Server Error",
    },
    {
      name: "a request that never got an answer",
      failure: new Error(
        "Request failed to https://oneuptime.example/api/security-playbook. Network error",
      ),
      reason: "Something went wrong while adding it.",
      raw: "Network error",
    },
  ])(
    "a template that cannot be added for $name says why, in the product's words",
    async ({
      failure,
      reason,
      raw,
    }: {
      failure: HTTPErrorResponse | Error;
      reason: string;
      raw: string;
    }) => {
      recordCreates((): HTTPErrorResponse | Error => {
        return failure;
      });
      await renderPage();

      await pickTemplate();

      const box: HTMLElement = problemsBox()!;
      expect(box).toBeInTheDocument();
      expect(box).toHaveAttribute("role", "alert");
      expect(
        within(box).getByTestId("security-turn-on-problems-title"),
      ).toHaveTextContent(PLAYBOOK_NOT_ADDED_TITLE);
      expect(
        within(box)
          .getAllByTestId("security-turn-on-problem")
          .map((row: HTMLElement): string => {
            return (row.textContent || "").trim();
          }),
      ).toEqual([`${TEMPLATE.name} - ${reason}`]);
      if (raw) {
        expect(box).not.toHaveTextContent(raw);
      }
      // Nothing was added, so nothing to open; and no grey sentence centred under the tiles.
      expect(navigatedTo).toEqual([]);
      expect(document.querySelector(".text-center.my-10")).toBeNull();
      // The template can be picked again.
      expect(
        screen.getByTestId(`security-playbook-template-${TEMPLATE.key}`),
      ).toBeEnabled();
    },
  );

  test("picking the template again clears what the last try could not do, and adds it", async () => {
    const created: Array<SecurityPlaybook> = recordCreates(
      (attempt: number): HTTPErrorResponse | null => {
        return attempt === 1
          ? new HTTPErrorResponse(500, { message: "Server Error" }, {})
          : null;
      },
    );
    await renderPage();

    await pickTemplate();
    expect(problemsBox()).toBeInTheDocument();

    await pickTemplate();

    expect(problemsBox()).toBeNull();
    expect(created).toHaveLength(1);
    expect(navigatedTo).toHaveLength(1);
  });

  test("the box is brought into view only as far as it must be, for a phone whose tile sits a screen below it", async () => {
    const calls: Array<{ element: Element; options: unknown }> = [];
    const original: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(
        window.HTMLElement.prototype,
        "scrollIntoView",
      );
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: function (this: Element, options: unknown): void {
        calls.push({ element: this, options });
      },
    });

    try {
      recordCreates((): HTTPErrorResponse => {
        return new HTTPErrorResponse(500, { message: "Server Error" }, {});
      });
      await renderPage();

      await pickTemplate();

      expect(calls).toHaveLength(1);
      expect(calls[0]!.element.contains(problemsBox())).toBe(true);
      expect(calls[0]!.options).toMatchObject({ block: "nearest" });
    } finally {
      if (original) {
        Object.defineProperty(
          window.HTMLElement.prototype,
          "scrollIntoView",
          original,
        );
      } else {
        delete (
          window.HTMLElement.prototype as unknown as {
            scrollIntoView?: unknown;
          }
        ).scrollIntoView;
      }
    }
  });

  test("the box's title is a sentence the Dashboard translates", () => {
    expect(PLAYBOOK_NOT_ADDED_TITLE).toBe("The playbook could not be added");
  });
});
