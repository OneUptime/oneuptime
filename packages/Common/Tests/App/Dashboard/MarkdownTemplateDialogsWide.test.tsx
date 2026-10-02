import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Route from "../../../Types/API/Route";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * The dialog in the maintainer's screenshot - Create New Incident Note
 * Template - and the other template tables that create with a Markdown
 * editor and asked for no width of their own: they opened Medium, because
 * they have steps, and the editor's toolbar took two lines beside the step
 * list. They open in the wide dialog now, the step list and the whole
 * toolbar side by side.
 *
 * The production pages build the forms; only the table around each is
 * replaced, by the create dialog the real table opens (ModelTable's own
 * ModelFormModal call: its title, its width prop, its create fields and
 * steps). Transport, permissions and the project are stubbed.
 */

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      const singularName: string =
        props.singularName || new props.modelType().singularName || "";

      // What the real table opens from its Create button.
      return (
        <ModelFormModal<TBaseModel>
          title={`Create New ${singularName}`}
          name={`${props.name} > Create New ${singularName}`}
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText={`Create ${singularName}`}
          onClose={() => {}}
          onSuccess={() => {}}
          formProps={{
            id: `create-${props.modelType.name}-from`,
            name: `create-${props.modelType.name}-from`,
            modelType: props.modelType,
            fields: (props.formFields || []).filter(
              (field: ModelField<TBaseModel>): boolean => {
                return !field.doNotShowWhenCreating;
              },
            ),
            steps: props.formSteps || [],
            summary: props.formSummary,
            formType: FormType.Create,
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

import IncidentNoteTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentNoteTemplates";
import AlertNoteTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertNoteTemplates";
import ScheduledMaintenanceNoteTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates";
import StatusPageAnnouncementTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageAnnouncementTemplates";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

interface TemplatePage {
  name: string;
  Page: (props: PageComponentProps) => ReactElement;
  title: string;
  // The step the Markdown editor is on.
  editorStep: string;
}

const PAGES: Array<TemplatePage> = [
  {
    name: "Incidents > Settings > Note Templates",
    Page: IncidentNoteTemplates,
    title: "Create New Incident Note Template",
    editorStep: "Note Details",
  },
  {
    name: "Alerts > Settings > Note Templates",
    Page: AlertNoteTemplates,
    title: "Create New Alert Note Template",
    editorStep: "Note Details",
  },
  {
    name: "Scheduled Maintenance > Settings > Note Templates",
    Page: ScheduledMaintenanceNoteTemplates,
    title: "Create New Scheduled Maintenance Note Template",
    editorStep: "Note Details",
  },
  {
    name: "Status Pages > Settings > Announcement Templates",
    Page: StatusPageAnnouncementTemplates,
    title: "Create New Status Page Announcement Template",
    editorStep: "Announcement Details",
  },
];

function renderPage(page: TemplatePage): void {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/settings"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <page.Page {...props} />
    </MemoryRouter>,
  );
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

/*
 * Fills what the current step asks for and moves on, until the Markdown
 * editor is on screen.
 */
async function walkToTheEditor(user: UserEvent): Promise<HTMLElement> {
  /*
   * BasicForm opens its first step in a mount effect - its first render
   * shows every field - so the walk starts once the step list is there.
   */
  await within(dialog()).findByRole("navigation", { name: "Progress" });

  for (let step: number = 0; step < 6; step++) {
    const toolbar: HTMLElement | null = within(dialog()).queryByTestId(
      "markdown-editor-toolbar",
    );

    if (toolbar) {
      return toolbar;
    }

    const blanks: Array<HTMLElement> = Array.from(
      dialog().querySelectorAll<HTMLElement>('input[type="text"], textarea'),
    ).filter((element: HTMLElement): boolean => {
      return (element as HTMLInputElement).value === "";
    });

    for (const blank of blanks) {
      await user.type(blank, "Checkout outage");
    }

    await user.click(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    );

    await waitFor(() => {
      expect(dialog()).toBeInTheDocument();
    });
  }

  throw new Error("the form never reached its Markdown editor");
}

afterEach(() => {
  cleanup();
});

describe("template tables that create with a Markdown editor", () => {
  for (const page of PAGES) {
    test(`${page.name}: the create dialog opens wide`, async () => {
      renderPage(page);

      expect(await screen.findByText(page.title)).toBeInTheDocument();
      expect(dialog()).toHaveClass("sm:max-w-7xl");
      expect(dialog()).not.toHaveClass("sm:max-w-3xl");
      expect(dialog()).not.toHaveClass("sm:max-w-lg");
    });

    test(`${page.name}: the editor's whole toolbar is in it, beside the step list`, async () => {
      const user: UserEvent = userEvent.setup();
      renderPage(page);

      const toolbar: HTMLElement = await walkToTheEditor(user);

      // The editor is on its own step, the one the step list marks current.
      const progress: HTMLElement = within(dialog()).getByRole("navigation", {
        name: "Progress",
      });
      expect(progress.querySelector('[aria-current="step"]')).toHaveTextContent(
        page.editorStep,
      );

      // Nothing measured in jsdom, so nothing is put under More formatting.
      expect(within(toolbar).getByTitle("Bold (Ctrl+B)")).toBeInTheDocument();
      expect(within(toolbar).getByTitle("Code Block")).toBeInTheDocument();
      expect(
        within(toolbar).queryByTestId("markdown-editor-more-formatting"),
      ).toBeNull();

      // Still the wide dialog on the editor's step.
      expect(dialog()).toHaveClass("sm:max-w-7xl");
    });
  }
});

// The stub table opens the real ModelFormModal; nothing here sends anything.
describe("the stubbed table", () => {
  test("opens the production create dialog, with its create fields only", async () => {
    renderPage(PAGES[0]!);

    expect(
      await within(dialog()).findByText("Template Name"),
    ).toBeInTheDocument();
  });
});
