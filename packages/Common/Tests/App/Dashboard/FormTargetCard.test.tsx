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
 * What each submission creates: an incident or a scheduled maintenance
 * event, as two cards to choose between. Choosing the other one asks first,
 * then writes the new target, the questions kept for it and empty settings
 * in one request. Only the network and the permission gate are stubbed.
 */

const updateByIdMock: MockFunction = getJestMockFunction();

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
import FormTargetCard from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormTargetCard";
import Form from "../../../Models/DatabaseModels/Form";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import FormTargetType, {
  FORM_TARGET_TYPE_TEXT,
} from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000cc";

const SEVERITY_QUESTION: FormField = {
  id: "severity",
  source: FormFieldSource.TargetField,
  targetField: "incidentSeverityId",
  label: "How bad is it?",
  isRequired: false,
};

let gate: PermissionGateResult = { isAllowed: true };
let onChanged: MockFunction;

beforeEach(() => {
  gate = { isAllowed: true };
  onChanged = getJestMockFunction();

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

async function renderCard(
  targetType: FormTargetType = FormTargetType.Incident,
  fields: Array<FormField> = [
    ...getDefaultFormFields(FormTargetType.Incident),
    SEVERITY_QUESTION,
  ],
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <FormTargetCard
        formId={new ObjectID(FORM_ID)}
        targetType={targetType}
        fields={fields}
        onChanged={() => {
          onChanged();
        }}
      />,
    );
  });
}

function option(target: FormTargetType): HTMLElement {
  return screen.getByTestId(`form-target-${target}`);
}

describe("the choice", () => {
  test("both targets, as radios, the form's own checked", async () => {
    await renderCard();

    expect(screen.getByRole("radiogroup")).toHaveAccessibleName(
      FormsCopy.targetCardTitle,
    );
    expect(option(FormTargetType.Incident)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(option(FormTargetType.ScheduledMaintenance)).toHaveAttribute(
      "aria-checked",
      "false",
    );

    for (const target of [
      FormTargetType.Incident,
      FormTargetType.ScheduledMaintenance,
    ]) {
      expect(option(target)).toHaveTextContent(
        FORM_TARGET_TYPE_TEXT[target].title,
      );
      expect(option(target)).toHaveTextContent(
        FORM_TARGET_TYPE_TEXT[target].description,
      );
    }
  });

  test("choosing the one already chosen does nothing", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.click(option(FormTargetType.Incident));
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("changing it", () => {
  test("asks first, saying what happens to the questions and settings", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.click(option(FormTargetType.ScheduledMaintenance));
    });

    const confirm: HTMLElement = screen.getByTestId("modal");

    expect(confirm).toHaveTextContent(FormsCopy.changeTargetTitle);
    expect(confirm).toHaveTextContent(
      FormsCopy.changeTargetToScheduledMaintenance,
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("cancelling changes nothing", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.click(option(FormTargetType.ScheduledMaintenance));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("modal")).getByTestId(
          "modal-footer-close-button",
        ),
      );
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("confirmed, writes the target, the questions kept for it and empty settings at once", async () => {
    await renderCard();

    await act(async () => {
      fireEvent.click(option(FormTargetType.ScheduledMaintenance));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("modal")).getByTestId(
          "modal-footer-submit-button",
        ),
      );
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, unknown> = updateByIdMock.mock
      .calls[0]![0] as Record<string, unknown>;
    const data: Record<string, unknown> = request["data"] as Record<
      string,
      unknown
    >;

    expect(request["modelType"]).toBe(Form);
    expect((request["id"] as ObjectID).toString()).toBe(FORM_ID);
    expect(data["targetType"]).toBe(FormTargetType.ScheduledMaintenance);
    expect(data["targetSettings"]).toEqual({});

    const fields: Array<FormField> = data["fields"] as Array<FormField>;
    const severity: FormField | undefined = fields.find(
      (field: FormField): boolean => {
        return field.id === "severity";
      },
    );

    // Nothing the submitter is asked goes away: the severity becomes a question of the form's own.
    expect(severity?.source).toBe(FormFieldSource.Question);
    expect(severity?.label).toBe("How bad is it?");
    // And the new target's must-asks are added.
    expect(
      fields
        .filter((field: FormField): boolean => {
          return field.source === FormFieldSource.TargetField;
        })
        .map((field: FormField): string => {
          return field.targetField || "";
        }),
    ).toEqual(expect.arrayContaining(["title", "startsAt", "endsAt"]));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("and back to incidents, with its own words", async () => {
    await renderCard(
      FormTargetType.ScheduledMaintenance,
      getDefaultFormFields(FormTargetType.ScheduledMaintenance),
    );

    await act(async () => {
      fireEvent.click(option(FormTargetType.Incident));
    });

    expect(screen.getByTestId("modal")).toHaveTextContent(
      FormsCopy.changeTargetToIncident,
    );
  });

  test("a refused change keeps the dialog open, with the reason", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to edit this form.");
    });

    await renderCard();

    await act(async () => {
      fireEvent.click(option(FormTargetType.ScheduledMaintenance));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("modal")).getByTestId(
          "modal-footer-submit-button",
        ),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toHaveTextContent(
        "You do not have permission to edit this form.",
      );
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("someone who may not edit the form cannot choose the other target", async () => {
    gate = {
      isAllowed: false,
      disabledReason: "You need the Edit Form permission.",
    };

    await renderCard();

    const other: HTMLElement = option(FormTargetType.ScheduledMaintenance);

    expect(other).toBeDisabled();
    expect(other).toHaveAttribute("title", "You need the Edit Form permission.");
    // The form's own stays readable.
    expect(option(FormTargetType.Incident)).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(other);
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});
