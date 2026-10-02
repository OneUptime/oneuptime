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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The On Submit page's mapping card: every field of what a submission
 * creates and where its value comes from, and Edit Settings - a stepped
 * dialog that saves from any step, keeps what was typed when a save is
 * refused, and starts on the stored settings each time it opens.
 *
 * The project's records the card reads, and the network, are stubbed; the
 * card, its rows and the dialog are the real ones.
 */

const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";
const OTHER_SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000002";
const TEMPLATE_ID: string = "a0000000-0000-4000-8000-000000000003";
const LABEL_ID: string = "a0000000-0000-4000-8000-000000000004";

const loadReferenceMock: MockFunction = getJestMockFunction();
const loadCustomFieldsMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      loadFormReferenceData: (...args: Array<unknown>): unknown => {
        return loadReferenceMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData",
  () => {
    return {
      __esModule: true,
      loadFormCustomFields: (...args: Array<unknown>): unknown => {
        return loadCustomFieldsMock(...args);
      },
      loadFormRecordOptions: async (): Promise<Array<unknown>> => {
        return [];
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import FormMappingCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormMappingCard";
import { FormReferenceData } from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData";
import Form from "../../../Models/DatabaseModels/Form";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import { FormTargetSettingReferenceModel } from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000bb";

const REFERENCE: FormReferenceData = {
  lists: {
    [FormTargetSettingReferenceModel.IncidentSeverity]: [
      { id: SEVERITY_ID, name: "Major" },
      { id: OTHER_SEVERITY_ID, name: "Minor" },
    ],
    [FormTargetSettingReferenceModel.IncidentTemplate]: [
      { id: TEMPLATE_ID, name: "Customer Report" },
    ],
    [FormTargetSettingReferenceModel.Label]: [
      { id: LABEL_ID, name: "customer-report" },
    ],
    [FormTargetSettingReferenceModel.Monitor]: [],
    [FormTargetSettingReferenceModel.OnCallDutyPolicy]: [],
    [FormTargetSettingReferenceModel.User]: [],
    [FormTargetSettingReferenceModel.Team]: [],
    [FormTargetSettingReferenceModel.StatusPage]: [],
  },
  templateIdsWithSeverity: [],
};

let gate: PermissionGateResult = { isAllowed: true };
let onSaved: MockFunction;

beforeEach(() => {
  gate = { isAllowed: true };
  onSaved = getJestMockFunction();

  loadReferenceMock.mockReset();
  loadReferenceMock.mockImplementation(async (): Promise<unknown> => {
    return REFERENCE;
  });

  loadCustomFieldsMock.mockReset();
  loadCustomFieldsMock.mockImplementation(async (): Promise<unknown> => {
    return [];
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(data?: {
  targetType?: FormTargetType;
  fields?: Array<FormField>;
  targetSettings?: JSONObject;
}): Promise<void> {
  const targetType: FormTargetType =
    data?.targetType || FormTargetType.Incident;

  await act(async (): Promise<void> => {
    render(
      <FormMappingCard
        formId={new ObjectID(FORM_ID)}
        targetType={targetType}
        fields={data?.fields || getDefaultFormFields(targetType)}
        targetSettings={
          data?.targetSettings || { incidentSeverityId: SEVERITY_ID }
        }
        onSaved={() => {
          onSaved();
        }}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId("form-mapping-rows")).toBeInTheDocument();
  });
}

function editButton(): HTMLElement {
  const button: HTMLElement | undefined = screen
    .queryAllByTestId("card-button")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(
        FormsCopy.editOnSubmitSettings,
      );
    });

  expect(button).toBeDefined();
  return button!;
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

async function openSettings(): Promise<void> {
  await act(async () => {
    fireEvent.click(editButton());
  });

  await waitFor(() => {
    expect(
      within(modal()).getByRole("textbox", { name: /^Default Title/ }),
    ).toBeInTheDocument();
  });
}

function defaultTitleInput(): HTMLElement {
  return within(modal()).getByRole("textbox", { name: /^Default Title/ });
}

function saveButton(): HTMLElement {
  return within(modal()).getByTestId("modal-footer-submit-button");
}

describe("the rows", () => {
  test("an incident form's card, row by row", async () => {
    await renderCard();

    expect(
      screen.getByText(FormsCopy.mappingIncidentTitle),
    ).toBeInTheDocument();

    for (const key of [
      "title",
      "description",
      "severity",
      "monitors",
      "labels",
      "incidentTemplate",
      "onCallPolicies",
      "owners",
      "customFields",
      "statusPages",
      "otherAnswers",
    ]) {
      expect(screen.getByTestId(`form-mapping-row-${key}`)).toBeInTheDocument();
    }

    // The title comes from the answer to the title question.
    expect(
      within(screen.getByTestId("form-mapping-row-title")).getByTestId(
        "form-mapping-answer",
      ),
    ).toHaveTextContent("Title");
    // The severity the settings name, by name.
    expect(screen.getByTestId("form-mapping-row-severity")).toHaveTextContent(
      "Major",
    );
  });

  test("a maintenance form's card has its own rows and title", async () => {
    await renderCard({
      targetType: FormTargetType.ScheduledMaintenance,
      targetSettings: {},
    });

    expect(
      screen.getByText(FormsCopy.mappingScheduledMaintenanceTitle),
    ).toBeInTheDocument();
    expect(screen.getByTestId("form-mapping-row-startsAt")).toBeInTheDocument();
    expect(
      screen.getByTestId("form-mapping-row-showOnStatusPages"),
    ).toHaveTextContent(FormsCopy.no);
    expect(
      screen.queryByTestId("form-mapping-row-severity"),
    ).not.toBeInTheDocument();
  });

  test("a form whose incidents would have no severity says so, in amber", async () => {
    await renderCard({ targetSettings: {} });

    expect(
      within(screen.getByTestId("form-mapping-row-severity")).getByTestId(
        "form-mapping-warning",
      ),
    ).toHaveTextContent(FormsCopy.noSeverityWarning);
  });

  test("what the settings always add is named", async () => {
    await renderCard({
      targetSettings: { incidentSeverityId: SEVERITY_ID, labelIds: [LABEL_ID] },
    });

    expect(
      within(screen.getByTestId("form-mapping-row-labels")).getByTestId(
        "form-mapping-always",
      ),
    ).toHaveTextContent("customer-report");
  });

  test("a custom field question names the field it fills", async () => {
    loadCustomFieldsMock.mockImplementation(async (): Promise<unknown> => {
      return [
        {
          id: "b0000000-0000-4000-8000-000000000001",
          name: "Region",
          customFieldType: "Dropdown",
          dropdownOptions: "EU",
        },
      ];
    });

    await renderCard({
      fields: [
        ...getDefaultFormFields(FormTargetType.Incident),
        {
          id: "region",
          source: FormFieldSource.TargetCustomField,
          customFieldId: "b0000000-0000-4000-8000-000000000001",
          label: "Where?",
          isRequired: false,
        },
      ],
    });

    const row: HTMLElement = screen.getByTestId(
      "form-mapping-row-customFields",
    );

    expect(row).toHaveTextContent("Region");
    expect(row).toHaveTextContent("Where?");
  });

  test("a load that fails says why, and offers no settings to edit", async () => {
    loadReferenceMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("The project's records could not be read.");
    });

    await act(async (): Promise<void> => {
      render(
        <FormMappingCard
          formId={new ObjectID(FORM_ID)}
          targetType={FormTargetType.Incident}
          fields={getDefaultFormFields(FormTargetType.Incident)}
          targetSettings={{}}
          onSaved={() => {}}
        />,
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("The project's records could not be read."),
      ).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId("card-button")).toHaveLength(0);
  });
});

describe("Edit Settings", () => {
  test("opens on the stored settings, saving from the first step", async () => {
    await renderCard({
      targetSettings: {
        defaultTitle: "Reported",
        incidentSeverityId: SEVERITY_ID,
        incidentTemplateId: TEMPLATE_ID,
        labelIds: [LABEL_ID],
      },
    });
    await openSettings();

    expect(defaultTitleInput()).toHaveValue("Reported");
    expect(saveButton()).toHaveTextContent(FormsCopy.saveChanges);
    expect(
      within(modal()).getByTestId("modal-footer-next-button"),
    ).toBeInTheDocument();

    fireEvent.change(defaultTitleInput(), {
      target: { value: "  Reported through the form  " },
    });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    // Packed: trimmed, and every setting on the other steps kept.
    expect(request["data"]).toEqual({
      targetSettings: {
        defaultTitle: "Reported through the form",
        incidentSeverityId: SEVERITY_ID,
        incidentTemplateId: TEMPLATE_ID,
        labelIds: [LABEL_ID],
      },
    });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("a refused save opens again on what was typed, with the reason", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Owner Users: a user is not a member of this project.");
    });

    await renderCard();
    await openSettings();

    fireEvent.change(defaultTitleInput(), {
      target: { value: "Typed before the refusal" },
    });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    await waitFor(() => {
      expect(
        within(modal()).getByText(
          "Owner Users: a user is not a member of this project.",
        ),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(defaultTitleInput()).toHaveValue("Typed before the refusal");
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("closed and opened again, it starts on the stored settings", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("Refused.");
    });

    await renderCard({
      targetSettings: {
        defaultTitle: "Stored",
        incidentSeverityId: SEVERITY_ID,
      },
    });
    await openSettings();

    fireEvent.change(defaultTitleInput(), { target: { value: "Abandoned" } });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    await waitFor(() => {
      expect(within(modal()).getByText("Refused.")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(within(modal()).getByTestId("modal-footer-close-button"));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });

    await openSettings();

    expect(defaultTitleInput()).toHaveValue("Stored");
    expect(within(modal()).queryByText("Refused.")).not.toBeInTheDocument();
  });

  test("someone who may not edit the form sees the button locked, with the reason", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Form permission.",
    };

    await renderCard();

    expect(editButton()).toBeDisabled();

    await act(async () => {
      fireEvent.click(editButton());
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});
