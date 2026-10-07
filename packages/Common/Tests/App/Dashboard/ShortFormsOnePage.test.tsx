import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Route from "../../../Types/API/Route";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * "Forms of three rows or fewer fit on one page." The note templates of
 * incidents, alerts and scheduled maintenance and the incident postmortem
 * templates walked a "Template Info" step (name, description) and then a
 * step for the one editor; SLO create walked Basic Info, Objective and
 * Period when only its target had no default. Each is one page now. The
 * network OID collection templates were one page too, until SNMP tables
 * gave them a second editor: with four fields they walk steps again, as
 * LongFormStepsGuard asks of a longer form, and are held to those below.
 *
 * The production pages build the forms; only the table around each is
 * replaced, by the create dialog the real table opens (ModelTable's own
 * ModelFormModal call: its title, its width, its create fields, its steps
 * - `props.formSteps || []` - and its initial values). Saving goes through
 * the real ModelForm, with only the network stubbed, so what a page sends
 * from its one page is checked too.
 */

let capturedModels: Array<JSONObject> = [];

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
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedModels.push(data.model);
        return { data: data.model };
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
import IncidentPostmortemTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentPostmortemTemplates";
import AlertNoteTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertNoteTemplates";
import ScheduledMaintenanceNoteTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates";
import OidCollectionTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/OidCollectionTemplates";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  getSloFormFields,
  SLO_CREATE_INITIAL_VALUES,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  hasSetChip,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const SLO_DEFAULTS_SUMMARY: string =
  "Measured over a rolling 30-day window, and At Risk when less than 20% of the error budget is left.";

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

/*
 * BasicForm opens a stepped form's first step in a mount effect, so a form
 * with steps shows its step list one render later: let every effect run
 * before saying there is none.
 */
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function expectOnePage(createButtonText: string): Promise<void> {
  await settle();

  expect(
    within(dialog()).queryByRole("navigation", { name: "Progress" }),
  ).toBeNull();
  expect(within(dialog()).queryByText(/^Step \d+ of \d+/)).toBeNull();
  // No Next: the one button creates.
  expect(within(dialog()).queryByTestId("modal-footer-next-button")).toBeNull();
  expect(
    within(dialog()).getByTestId("modal-footer-submit-button"),
  ).toHaveTextContent(createButtonText);
}

async function submitDialog(): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function expectNothingSent(): void {
  expect(capturedModels).toEqual([]);
}

function renderPage(Page: FunctionComponent<PageComponentProps>): void {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/settings"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <Page {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  capturedModels = [];
});

interface TemplatePage {
  name: string;
  Page: FunctionComponent<PageComponentProps>;
  title: string;
  createButton: string;
  // The column the template's body is saved in.
  bodyColumn: string;
}

const TEMPLATE_PAGES: Array<TemplatePage> = [
  {
    name: "Incidents > Settings > Note Templates",
    Page: IncidentNoteTemplates,
    title: "Create New Incident Note Template",
    createButton: "Create Incident Note Template",
    bodyColumn: "note",
  },
  {
    name: "Alerts > Settings > Note Templates",
    Page: AlertNoteTemplates,
    title: "Create New Alert Note Template",
    createButton: "Create Alert Note Template",
    bodyColumn: "note",
  },
  {
    name: "Scheduled Maintenance > Settings > Note Templates",
    Page: ScheduledMaintenanceNoteTemplates,
    title: "Create New Scheduled Maintenance Note Template",
    createButton: "Create Scheduled Maintenance Note Template",
    bodyColumn: "note",
  },
  {
    name: "Incidents > Settings > Postmortem Templates",
    Page: IncidentPostmortemTemplates,
    title: "Create New Incident Postmortem Template",
    createButton: "Create Incident Postmortem Template",
    bodyColumn: "postmortemNote",
  },
];

/*
 * The template's body, written in its editor's Markdown source: the editor
 * opens in its visual mode, and its Markdown button shows the source as a
 * textarea - the dialog's only one besides the template's description.
 */
function writeBody(text: string): void {
  const toolbar: HTMLElement = within(dialog()).getByTestId(
    "markdown-editor-toolbar",
  );

  fireEvent.click(within(toolbar).getByRole("button", { name: "Markdown" }));

  const description: HTMLElement = within(dialog()).getByPlaceholderText(
    "Template Description",
  );
  const sources: Array<HTMLTextAreaElement> = Array.from(
    dialog().querySelectorAll<HTMLTextAreaElement>("textarea"),
  ).filter((textarea: HTMLTextAreaElement): boolean => {
    return textarea !== description;
  });

  expect(sources).toHaveLength(1);

  fireEvent.change(sources[0]!, { target: { value: text } });
}

describe("the note and postmortem template forms", () => {
  for (const page of TEMPLATE_PAGES) {
    test(`${page.name}: one page - the name, the description and the editor at once`, async () => {
      renderPage(page.Page);

      expect(await screen.findByText(page.title)).toBeInTheDocument();
      await expectOnePage(page.createButton);

      // All three on the one page, the editor's toolbar whole beside them.
      expect(
        within(dialog()).getByPlaceholderText("Template Name"),
      ).toBeVisible();
      expect(
        within(dialog()).getByPlaceholderText("Template Description"),
      ).toBeVisible();
      const toolbar: HTMLElement = within(dialog()).getByTestId(
        "markdown-editor-toolbar",
      );
      expect(within(toolbar).getByTitle("Bold (Ctrl+B)")).toBeInTheDocument();
      expect(
        within(toolbar).queryByTestId("markdown-editor-more-formatting"),
      ).toBeNull();

      // Wide, for the editor's toolbar (Forms/Utils/FormModalWidth).
      expect(dialog()).toHaveClass("sm:max-w-7xl");
    });

    test(`${page.name}: the step names it walked are gone`, async () => {
      renderPage(page.Page);

      expect(await screen.findByText(page.title)).toBeInTheDocument();
      await settle();

      for (const stepTitle of [
        "Template Info",
        "Note Details",
        "Postmortem Details",
      ]) {
        expect(within(dialog()).queryByText(stepTitle)).toBeNull();
      }
    });

    test(`${page.name}: the one button creates the template, with all three fields`, async () => {
      renderPage(page.Page);

      expect(await screen.findByText(page.title)).toBeInTheDocument();
      await settle();

      fireEvent.change(within(dialog()).getByPlaceholderText("Template Name"), {
        target: { value: "Investigating" },
      });
      fireEvent.change(
        within(dialog()).getByPlaceholderText("Template Description"),
        { target: { value: "The first update of an outage" } },
      );
      writeBody("We are looking into it.");

      const model: JSONObject = await submitDialog();

      expect(model["templateName"]).toBe("Investigating");
      expect(model["templateDescription"]).toBe(
        "The first update of an outage",
      );
      expect(model[page.bodyColumn]).toBe("We are looking into it.");
    });

    test(`${page.name}: an empty form asks for all three on the one page`, async () => {
      renderPage(page.Page);

      expect(await screen.findByText(page.title)).toBeInTheDocument();
      await settle();

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog()).getByTestId("modal-footer-submit-button"),
        );
      });

      // Nothing is sent, and no step is walked to: the errors are all here.
      await waitFor(() => {
        expect(within(dialog()).getAllByText(/is required/i).length).toBe(3);
      });
      expectNothingSent();
      expect(
        within(dialog()).queryByRole("navigation", { name: "Progress" }),
      ).toBeNull();
    });
  }
});

async function clickNext(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
  });
  await settle();
}

describe("the OID collection template form", () => {
  /*
   * The name and description, then the OID list with its vendor profiles,
   * then the SNMP tables: each editor gets a step of its own, and the
   * template is created from the last one.
   */
  test("walks Template, OIDs and SNMP Tables, one editor per step", async () => {
    renderPage(OidCollectionTemplates);

    expect(
      await screen.findByText("Create New OID Collection Template"),
    ).toBeInTheDocument();
    await settle();

    const progress: HTMLElement = within(dialog()).getByRole("navigation", {
      name: "Progress",
    });

    for (const step of ["Template", "OIDs", "SNMP Tables"]) {
      expect(within(progress).getByText(step)).toBeInTheDocument();
    }

    expect(within(dialog()).getByPlaceholderText("Core Routers")).toBeVisible();
    expect(
      within(dialog()).getByPlaceholderText(
        "CPU, memory and temperature for the Cisco IOS-XE core routers.",
      ),
    ).toBeVisible();
    expect(within(dialog()).queryByTestId("snmp-oid-add")).toBeNull();
    expect(within(dialog()).queryByTestId("snmp-table-add")).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
  });

  test("creates a template with no OIDs and no tables yet", async () => {
    renderPage(OidCollectionTemplates);

    expect(
      await screen.findByText("Create New OID Collection Template"),
    ).toBeInTheDocument();
    await settle();

    fireEvent.change(within(dialog()).getByPlaceholderText("Core Routers"), {
      target: { value: "Core Routers" },
    });

    await clickNext();

    expect(
      within(dialog()).getByText("Start from a Vendor Profile"),
    ).toBeInTheDocument();
    expect(within(dialog()).getByTestId("snmp-oid-add")).toBeInTheDocument();
    expect(within(dialog()).queryByPlaceholderText("Core Routers")).toBeNull();

    await clickNext();

    expect(within(dialog()).getByTestId("snmp-table-add")).toBeInTheDocument();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create OID Collection Template");
    expectNothingSent();

    const model: JSONObject = await submitDialog();

    expect(model["name"]).toBe("Core Routers");
  });
});

/*
 * SLO create, as the SLOs table opens it: the page's own field list and
 * initial values (Pages/Slo/Slos.tsx hands both to its table, with no
 * steps).
 */
async function renderSloCreate(): Promise<void> {
  render(
    <MemoryRouter>
      <ModelFormModal<ServiceLevelObjective>
        title="Create New Service Level Objective"
        name="SLOs > Create New Service Level Objective"
        modelType={ServiceLevelObjective}
        initialValues={SLO_CREATE_INITIAL_VALUES}
        submitButtonText="Create Service Level Objective"
        onClose={() => {}}
        onSuccess={() => {}}
        formProps={{
          id: "create-ServiceLevelObjective-from",
          name: "create-ServiceLevelObjective-from",
          modelType: ServiceLevelObjective,
          fields: getSloFormFields(),
          steps: [],
          formType: FormType.Create,
        }}
      />
    </MemoryRouter>,
  );

  await screen.findByText("Create New Service Level Objective");
  await settle();
}

function advancedHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "More fields" });
}

function sloField(placeholder: string): HTMLInputElement {
  return within(dialog()).getByPlaceholderText(placeholder) as HTMLInputElement;
}

describe("SLO create", () => {
  test("is one page: the name, the target and the folded Advanced section", async () => {
    await renderSloCreate();
    await expectOnePage("Create Service Level Objective");

    expect(sloField("API Availability")).toBeVisible();
    // The suggested target, there to see and change.
    expect(sloField("99.9")).toHaveValue(99.9);

    for (const stepTitle of ["Basic Info", "Objective", "Period"]) {
      expect(within(dialog()).queryByText(stepTitle)).toBeNull();
    }
  });

  test("keeps the description, the threshold, the window and the labels folded, and says what their defaults do", async () => {
    await renderSloCreate();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(SLO_DEFAULTS_SUMMARY);
    // The summary says it; no "Configured" for defaults.
    expect(setChips(dialog())).toEqual([]);

    expect(sloField("99.9% availability for the public API")).not.toBeVisible();
    expect(sloField("20")).not.toBeVisible();

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(sloField("99.9% availability for the public API")).toBeVisible();
    expect(sloField("20")).toHaveValue(20);
    expect(sloField("30")).toHaveValue(30);
    expect(within(dialog()).getByText("Window Type")).toBeVisible();
    expect(within(dialog()).getByText("Labels")).toBeVisible();
    // Timezone belongs to a calendar month, not to the rolling default.
    expect(within(dialog()).queryByText("Timezone")).toBeNull();
  });

  test("says Configured, not the defaults, once a folded value is changed", async () => {
    await renderSloCreate();

    fireEvent.click(advancedHeader());
    fireEvent.change(sloField("30"), { target: { value: "28" } });
    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog()).queryByTestId("collapsible-section-summary"),
    ).toBeNull();
    expect(hasSetChip(dialog())).toBe(true);
  });

  test("creates with only a name typed: the suggested target and the column defaults", async () => {
    await renderSloCreate();

    fireEvent.change(sloField("API Availability"), {
      target: { value: "Checkout API" },
    });

    const model: JSONObject = await submitDialog();

    expect(model["name"]).toBe("Checkout API");
    expect(Number(model["targetPercentage"])).toBe(99.9);
    expect(model["windowType"]).toBe(SloWindowType.Rolling);
    expect(Number(model["windowDays"])).toBe(30);
    expect(Number(model["atRiskThresholdPercentage"])).toBe(20);
  });

  test("sends a target that was changed", async () => {
    await renderSloCreate();

    fireEvent.change(sloField("API Availability"), {
      target: { value: "Checkout API" },
    });
    fireEvent.change(sloField("99.9"), { target: { value: "99.95" } });

    const model: JSONObject = await submitDialog();

    expect(Number(model["targetPercentage"])).toBe(99.95);
  });

  test("opens the folded section by itself on an error in it, and sends nothing", async () => {
    await renderSloCreate();

    fireEvent.change(sloField("API Availability"), {
      target: { value: "Checkout API" },
    });
    // Typed while open, then folded away again.
    fireEvent.click(advancedHeader());
    fireEvent.change(sloField("20"), { target: { value: "20.5" } });
    fireEvent.click(advancedHeader());
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    });
    expect(
      within(dialog()).getByText("At-risk threshold must be a whole number."),
    ).toBeVisible();
    expectNothingSent();
  });
});
