import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The owners people picker as a form field (FormFieldSchemaType.PeoplePicker)
 * through the real BasicForm: it writes people to ownerUsers and teams to
 * ownerTeams - the two values the two dropdowns it replaces wrote - and
 * nothing under its own name; it is validated by its picks; and a summary
 * step lists them by name.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import getOwnersFormField from "../../../../UI/Components/PeoplePicker/OwnersFormField";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";

function serveDirectory(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const user: User = new User();
      user._id = ADA;
      user.name = new Name("Ada Lovelace");
      user.email = new Email("ada@example.com");

      const member: TeamMember = new TeamMember();
      member.user = user;

      const matches: boolean =
        !(request.query.userId instanceof Includes) ||
        (request.query.userId.values as Array<string>).includes(ADA);

      const rows: Array<TeamMember> = matches ? [member] : [];

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    }

    const team: Team = new Team();
    team._id = PLATFORM;
    team.name = "Platform";

    return { data: [team], count: 1, skip: 0, limit: 1 };
  });
}

const NAME_FIELD: Field<JSONObject> = {
  field: { name: true },
  title: "Name",
  fieldType: FormFieldSchemaType.Text,
  required: true,
};

function renderForm(data: {
  fields: Fields<JSONObject>;
  initialValues?: JSONObject;
  steps?: Array<FormStep<JSONObject>> | undefined;
  summary?: boolean;
}): MockFunction {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="owners-form"
      fields={data.fields}
      steps={data.steps}
      summary={data.summary ? { enabled: true } : undefined}
      initialValues={data.initialValues || {}}
      onSubmit={onSubmit}
      submitButtonText="Save"
      disableAutofocus={true}
    />,
  );

  return onSubmit;
}

async function pick(name: string): Promise<void> {
  const button: HTMLElement = screen.getByRole("button", { name: "Add owner" });

  if (button.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(button);
  }

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owner",
  });

  const options: Array<HTMLElement> =
    await within(dialog).findAllByRole("option");

  const option: HTMLElement | undefined = options.find(
    (candidate: HTMLElement): boolean => {
      return candidate.textContent?.includes(name) || false;
    },
  );

  fireEvent.click(option!);
}

function submittedValues(onSubmit: MockFunction): JSONObject {
  return onSubmit.mock.calls[0]![0] as JSONObject;
}

describe("a people picker in a form", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    serveDirectory();
  });

  afterEach(() => {
    cleanup();
  });

  test("writes people to ownerUsers and teams to ownerTeams, and nothing under its own name", async () => {
    const onSubmit: MockFunction = renderForm({
      fields: [NAME_FIELD, getOwnersFormField<JSONObject>({})],
      initialValues: { name: "Database is down" },
    });

    await pick("Ada Lovelace");
    await pick("Platform");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const values: JSONObject = submittedValues(onSubmit);

    expect(values["name"]).toBe("Database is down");
    expect(values["ownerUsers"]).toEqual([ADA]);
    expect(values["ownerTeams"]).toEqual([PLATFORM]);
    expect(values).not.toHaveProperty("owners");
  });

  test("an untouched picker sends the ids it started with, however they were given", async () => {
    const onSubmit: MockFunction = renderForm({
      fields: [NAME_FIELD, getOwnersFormField<JSONObject>({})],
      initialValues: {
        name: "Database is down",
        ownerUsers: [new ObjectID(ADA)] as unknown as JSONObject,
        ownerTeams: [{ _id: PLATFORM }],
      },
    });

    // The picks it started with are shown by name.
    await waitFor(() => {
      expect(screen.getAllByTestId("people-chip")[0]).toHaveTextContent(
        "Ada Lovelace",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(submittedValues(onSubmit)["ownerUsers"]).toEqual([ADA]);
    expect(submittedValues(onSubmit)["ownerTeams"]).toEqual([PLATFORM]);
  });

  test("is named by its label, as one group", async () => {
    renderForm({ fields: [NAME_FIELD, getOwnersFormField<JSONObject>({})] });

    const group: HTMLElement = await screen.findByRole("group", {
      name: /Owners/,
    });

    expect(group).toContainElement(
      screen.getByRole("button", { name: "Add owner" }),
    );
  });

  test("when required, is answered by a pick of either kind", async () => {
    const onSubmit: MockFunction = renderForm({
      fields: [NAME_FIELD, getOwnersFormField<JSONObject>({ required: true })],
      initialValues: { name: "Database is down" },
    });

    await screen.findByRole("button", { name: "Add owner" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Owners is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    // A team alone is an answer.
    await pick("Platform");

    await waitFor(() => {
      expect(screen.queryByText("Owners is required.")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(submittedValues(onSubmit)["ownerTeams"]).toEqual([PLATFORM]);
  });

  test("runs the form's own check on its picks", async () => {
    const onSubmit: MockFunction = renderForm({
      fields: [
        NAME_FIELD,
        getOwnersFormField<JSONObject>({
          customValidation: (values: FormValues<JSONObject>): string | null => {
            const teams: unknown = (values as JSONObject)["ownerTeams"];

            return Array.isArray(teams) && teams.length > 0
              ? null
              : "Pick a team to own it.";
          },
        }),
      ],
      initialValues: { name: "Database is down" },
    });

    await pick("Ada Lovelace");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Pick a team to own it."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("on a stepped form, sits on its step, and the summary lists the picks by name", async () => {
    const onSubmit: MockFunction = renderForm({
      fields: [
        { ...NAME_FIELD, stepId: "details" },
        getOwnersFormField<JSONObject>({ stepId: "owners" }),
      ],
      steps: [
        { title: "Details", id: "details" },
        { title: "Owners", id: "owners" },
      ],
      summary: true,
      initialValues: { name: "Database is down" },
    });

    await screen.findByRole("navigation", { name: "Progress" });

    // Not on the first step.
    expect(
      screen.queryByRole("button", { name: "Add owner" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await pick("Ada Lovelace");
    await pick("Platform");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // The Summary step names them, without opening anything.
    await waitFor(() => {
      expect(screen.getByTestId("people-list")).toHaveTextContent(
        "Ada Lovelace",
      );
    });
    expect(screen.getByTestId("people-list")).toHaveTextContent("Platform");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(submittedValues(onSubmit)["ownerUsers"]).toEqual([ADA]);
    expect(submittedValues(onSubmit)["ownerTeams"]).toEqual([PLATFORM]);
  });

  test("a summary with no picks says None", async () => {
    renderForm({
      fields: [
        { ...NAME_FIELD, stepId: "details" },
        getOwnersFormField<JSONObject>({ stepId: "owners" }),
      ],
      steps: [
        { title: "Details", id: "details" },
        { title: "Owners", id: "owners" },
      ],
      summary: true,
      initialValues: { name: "Database is down" },
    });

    await screen.findByRole("navigation", { name: "Progress" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("button", { name: "Add owner" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.getByTestId("people-list")).toHaveTextContent("None");
    });
  });
});
