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
 * Security Events > Playbooks' templates: in place of an empty list (with a
 * heading and a blank playbook), and from Create from Template, in the
 * list's menu, once there are playbooks - as the grouping rules offer
 * theirs. They used to be a card above the list on every visit, every tile
 * offering one more copy of a playbook the project already had.
 *
 * A template becomes a working playbook in one click, built as Turn on
 * recommended builds one (SecurityTemplateRecords); one that cannot be
 * added says why in the product's words, in the amber box the Overview and
 * the Rule Library use, never a server's raw sentence centred in grey; and
 * a template the project has a playbook of says Added, with View.
 *
 * The playbooks table is its own component, mocked to capture what the
 * page hands it.
 */

interface CapturedPlaybooksTable {
  singularName?: string | undefined;
  pluralName?: string | undefined;
  noItemsMessage?: React.ReactElement | string | undefined;
  showCreateForm?: boolean | undefined;
  onCreateEditModalClose?: (() => void) | undefined;
  cardProps?:
    | {
        title?: string | undefined;
        buttons?:
          | Array<{ title: string; icon?: string; onClick: () => void }>
          | undefined;
      }
    | undefined;
  columns?:
    | Array<{
        title: string;
        getElement?: ((item: unknown) => React.ReactElement) | undefined;
      }>
    | undefined;
}

let capturedTable: CapturedPlaybooksTable | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedPlaybooksTable) => {
      capturedTable = props;
      return React.createElement("div", {
        "data-testid": "security-playbooks-table",
      });
    },
  };
});

import SecurityPlaybooksPage, {
  PLAYBOOK_PLURAL_NAME,
  PLAYBOOK_SINGULAR_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Playbooks";
import SecurityPlaybookTemplatePicker, {
  PLAYBOOK_TEMPLATE_PICKER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplatePicker";
import {
  CREATE_FROM_TEMPLATE,
  PLAYBOOK_NOT_ADDED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplateModel";
import {
  SECURITY_PLAYBOOK_TEMPLATES,
  SecurityPlaybookTemplate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplates";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { Green, Red } from "../../../Types/BrandColors";
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
const EXISTING_ID: string = "33333333-3333-4333-8333-333333333333";

const TEMPLATE: SecurityPlaybookTemplate = SECURITY_PLAYBOOK_TEMPLATES.find(
  (template: SecurityPlaybookTemplate): boolean => {
    return template.key === "known-bad";
  },
)!;

let navigatedTo: Array<string> = [];

// The project's playbooks, as the picker reads them to know which templates are added.
function givePlaybooks(names: Array<string>): void {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
    modelType: { new (): BaseModel };
  }) => {
    expect(new options.modelType()).toBeInstanceOf(SecurityPlaybook);

    return {
      data: names.map((name: string, index: number): SecurityPlaybook => {
        const playbook: SecurityPlaybook = new SecurityPlaybook();
        playbook._id =
          index === 0 ? EXISTING_ID : `${EXISTING_ID.slice(0, -1)}${index}`;
        playbook.name = name;
        return playbook;
      }),
      count: names.length,
      skip: 0,
      limit: 100,
    };
  }) as never);
}

beforeEach(() => {
  navigatedTo = [];
  capturedTable = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(null);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  jest.spyOn(Navigation, "navigate").mockImplementation((route: unknown) => {
    navigatedTo.push(String(route));
  });
  // The project's case priorities and statuses: a new project's.
  stubDashboardSecurityCaseValues();
  givePlaybooks([]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// Each playbook the picker sent, failing with what `fail` answers for it.
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
  const ids: Array<unknown> = steps.map((step: JSONValue): unknown => {
    return (step as JSONObject)["id"];
  });

  expect(steps.length).toBeGreaterThan(0);

  return {
    ...json,
    steps: steps.map((step: JSONValue): JSONObject => {
      const { id, ...rest } = step as JSONObject;
      expect(typeof id).toBe("string");

      // A step that waits on another names it by id: compared by its place instead.
      const runIf: JSONObject | undefined = rest["runIf"] as
        | JSONObject
        | undefined;

      if (runIf) {
        const waitedOn: number = ids.indexOf(runIf["stepId"]);
        expect(waitedOn).toBeGreaterThanOrEqual(0);
        rest["runIf"] = { ...runIf, stepId: `step ${waitedOn + 1}` };
      }

      return rest;
    }),
  };
}

async function renderPicker(
  props: React.ComponentProps<typeof SecurityPlaybookTemplatePicker> = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityPlaybookTemplatePicker {...props} />
      </MemoryRouter>,
    );
  });
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

describe("the templates", () => {
  test("a template becomes the playbook Turn on recommended would build, and opens on its page", async () => {
    const created: Array<SecurityPlaybook> = recordCreates((): null => {
      return null;
    });
    await renderPicker();

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

  test("each tile says when its playbook runs and how many steps it takes", async () => {
    await renderPicker();

    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      const tile: HTMLElement = screen.getByTestId(
        `security-playbook-template-tile-${template.key}`,
      );

      expect(tile).toHaveTextContent(template.name);
      expect(tile).toHaveTextContent(template.trigger);
      expect(tile).toHaveTextContent(
        `${
          template.getSteps({
            priorityId: (): string => {
              return "";
            },
            statusId: (): string => {
              return "";
            },
          }).length
        } steps`,
      );
      expect(
        within(tile).getByRole("button", {
          name: `Add Playbook: ${template.name}`,
        }),
      ).toBeInTheDocument();
    }
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
      await renderPicker();

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
    await renderPicker();

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
      await renderPicker();

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

describe("a template the project has a playbook of", () => {
  test("says Added, offers View to that playbook, and makes no second copy", async () => {
    const created: Array<SecurityPlaybook> = recordCreates((): null => {
      return null;
    });
    // Named as the project named it, whatever its case.
    givePlaybooks([TEMPLATE.name.toUpperCase()]);
    await renderPicker();

    const tile: HTMLElement = screen.getByTestId(
      `security-playbook-template-tile-${TEMPLATE.key}`,
    );

    expect(
      within(tile).getByTestId(
        `security-playbook-template-added-${TEMPLATE.key}`,
      ),
    ).toHaveTextContent("Added");
    expect(
      within(tile).queryByTestId(`security-playbook-template-${TEMPLATE.key}`),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(tile).getByTestId(
          `security-playbook-template-view-${TEMPLATE.key}`,
        ),
      );
    });

    expect(navigatedTo).toHaveLength(1);
    expect(navigatedTo[0]).toContain(EXISTING_ID);
    expect(created).toEqual([]);

    // The other templates are still one click from a playbook.
    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      if (template.key !== TEMPLATE.key) {
        expect(
          screen.getByTestId(`security-playbook-template-${template.key}`),
        ).toBeEnabled();
      }
    }
  });

  test("a project whose playbooks cannot be read still gets every template to add", async () => {
    jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
      throw new HTTPErrorResponse(500, { message: "Server Error" }, {});
    }) as never);
    await renderPicker();

    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      expect(
        screen.getByTestId(`security-playbook-template-${template.key}`),
      ).toBeEnabled();
    }
  });

  test("a reader who cannot create playbooks sees every Add locked, with why", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need the Create Security Playbook permission.",
    });
    await renderPicker({
      showIntro: true,
      onCreateBlank: (): void => {
        // Never reached: the button is locked.
      },
    });

    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      expect(
        screen.getByTestId(`security-playbook-template-${template.key}`),
      ).toBeDisabled();
    }
    expect(screen.getByTestId("security-playbook-create-blank")).toBeDisabled();
  });
});

describe("the Playbooks page", () => {
  test("leads with the list: no card of templates above it", async () => {
    await renderPage();

    expect(screen.getByTestId("security-playbooks-table")).toBeInTheDocument();
    expect(screen.queryByTestId(PLAYBOOK_TEMPLATE_PICKER_TEST_ID)).toBeNull();
    expect(screen.queryByText("Start from a template")).toBeNull();
  });

  test("names its list Playbooks: Create Playbook, not Create Security Playbook", async () => {
    await renderPage();

    expect(PLAYBOOK_SINGULAR_NAME).toBe("Playbook");
    expect(PLAYBOOK_PLURAL_NAME).toBe("Playbooks");
    expect(capturedTable?.singularName).toBe(PLAYBOOK_SINGULAR_NAME);
    expect(capturedTable?.pluralName).toBe(PLAYBOOK_PLURAL_NAME);
  });

  test("an empty list offers the templates with a heading, and a blank playbook that opens the create form", async () => {
    await renderPage();

    const empty: React.ReactElement = capturedTable!
      .noItemsMessage as React.ReactElement;
    expect(React.isValidElement(empty)).toBe(true);

    await act(async () => {
      render(<MemoryRouter>{empty}</MemoryRouter>);
    });

    const picker: HTMLElement = screen.getByTestId(
      PLAYBOOK_TEMPLATE_PICKER_TEST_ID,
    );
    expect(
      within(picker).getByRole("heading", { name: "Start from a template" }),
    ).toBeInTheDocument();
    expect(picker).toHaveTextContent(
      "Each template is a working playbook you can save as it is and change later.",
    );

    expect(capturedTable?.showCreateForm).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-playbook-create-blank"));
    });

    expect(capturedTable?.showCreateForm).toBe(true);

    await act(async () => {
      capturedTable!.onCreateEditModalClose!();
    });

    expect(capturedTable?.showCreateForm).toBe(false);
  });

  test("Create from Template, in the list's menu, opens the templates in a dialog", async () => {
    givePlaybooks([TEMPLATE.name]);
    await renderPage();

    const button: { title: string; onClick: () => void } | undefined =
      capturedTable?.cardProps?.buttons?.find(
        (candidate: { title: string }): boolean => {
          return candidate.title === CREATE_FROM_TEMPLATE;
        },
      );

    expect(button).toBeDefined();
    expect(screen.queryByTestId("modal")).toBeNull();

    await act(async () => {
      button!.onClick();
    });

    const dialog: HTMLElement = screen.getByTestId("modal");
    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      "Create from Template",
    );
    // The dialog has its own title: no second heading inside it.
    expect(
      within(dialog).queryByRole("heading", { name: "Start from a template" }),
    ).toBeNull();
    expect(
      within(dialog).getByTestId(
        `security-playbook-template-added-${TEMPLATE.key}`,
      ),
    ).toBeInTheDocument();
  });

  /*
   * The picker is centred at a reading width (max-w-4xl) where it stands in
   * for the empty list. In the dialog - as wide as a large dialog is - that
   * left a hand's width of nothing either side of the tiles: there they
   * fill the dialog. A tile acts at once, so the dialog closes with Close,
   * not Cancel: nothing waits in it to be cancelled.
   */
  test("in the dialog the tiles fill it, and it closes with Close", async () => {
    givePlaybooks([TEMPLATE.name]);
    await renderPage();

    await act(async () => {
      capturedTable!
        .cardProps!.buttons!.find((candidate: { title: string }): boolean => {
          return candidate.title === CREATE_FROM_TEMPLATE;
        })!
        .onClick();
    });

    const dialog: HTMLElement = screen.getByTestId("modal");
    const picker: HTMLElement = within(dialog).getByTestId(
      PLAYBOOK_TEMPLATE_PICKER_TEST_ID,
    );

    expect(picker.className.split(" ")).not.toContain("max-w-4xl");
    expect(picker.className.split(" ")).not.toContain("mx-auto");
    expect(
      within(dialog).getByTestId("modal-footer-close-button"),
    ).toHaveTextContent(/^Close$/);
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  test("in place of an empty list the picker stays centred at a reading width", async () => {
    await renderPage();

    await act(async () => {
      render(
        <MemoryRouter>
          {capturedTable!.noItemsMessage as React.ReactElement}
        </MemoryRouter>,
      );
    });

    expect(
      screen.getByTestId(PLAYBOOK_TEMPLATE_PICKER_TEST_ID).className.split(" "),
    ).toEqual(expect.arrayContaining(["mx-auto", "max-w-4xl"]));
  });

  test("a reader who cannot create playbooks is not offered Create from Template", async () => {
    jest.spyOn(PermissionGate, "check").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need the Create Security Playbook permission.",
    });
    await renderPage();

    const button: { title: string } | undefined =
      capturedTable?.cardProps?.buttons?.find(
        (candidate: { title: string }): boolean => {
          return candidate.title === CREATE_FROM_TEMPLATE;
        },
      );

    // Gated as the grouping rules gate theirs: locked or left out, never pressable.
    expect(
      !button || (button as { disabled?: boolean }).disabled === true,
    ).toBe(true);
  });

  test("a disabled playbook reads Disabled in red, as every list in the Dashboard draws a switch", async () => {
    await renderPage();

    const status: {
      getElement?: ((item: unknown) => React.ReactElement) | undefined;
    } = capturedTable!.columns!.find((column: { title: string }): boolean => {
      return column.title === "Status";
    })!;

    const on: SecurityPlaybook = new SecurityPlaybook();
    on.isEnabled = true;
    const off: SecurityPlaybook = new SecurityPlaybook();
    off.isEnabled = false;

    const onPill: React.ReactElement = status.getElement!(on);
    const offPill: React.ReactElement = status.getElement!(off);

    expect(onPill.props).toMatchObject({ text: "Enabled", color: Green });
    expect(offPill.props).toMatchObject({ text: "Disabled", color: Red });
  });
});
