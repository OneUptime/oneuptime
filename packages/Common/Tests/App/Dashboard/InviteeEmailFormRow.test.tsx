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
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE EMAIL ROW OF AN INVITATION FORM, IN A REAL FORM (#9701).
 *
 * Invite New Team Member and Invite New User draw their "email" row with
 * InviteeEmailField (Components/Team/InviteeEmailFormField). Inside the
 * shared form, as the two pages build the row:
 *
 *   - what is typed is the row's value, sent under "email" as before, and
 *     reaches the row's own onChange (where the pages asked whether the
 *     address had an account, until #9745: InviteeNameRow);
 *   - a suggestion picked is the row's value too;
 *   - an address that is not one stops the form, said under the box;
 *   - none at all stops it as a required row does.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import BasicForm from "../../../UI/Components/Forms/BasicForm";
import { CustomElementProps } from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  drawInviteeEmailField,
  getInviteeEmailError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Team/InviteeEmailFormField";
import { INVITE_SUGGESTIONS_DEBOUNCE_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/Team/InviteeEmailField";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  InviteSuggestionStanding,
  toInviteSuggestionsAnswerJSON,
} from "../../../Types/Team/InviteSuggestions";

const TEAM_ID: string = "22222222-2222-4222-8222-222222222222";
const TIMEOUT: number = 30000;

interface Drawn {
  onSubmit: MockFunction;
  onRowChange: MockFunction;
}

function draw(): Drawn {
  const onSubmit: MockFunction = getJestMockFunction();
  const onRowChange: MockFunction = getJestMockFunction();

  // The row as the team's Members page builds it.
  const fields: Fields<FormValues<any>> = [
    {
      field: { user: true },
      title: "Email",
      description: "We email them an invitation to this team.",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      placeholder: "member@company.com",
      overrideFieldKey: "email",
      onChange: (value: string) => {
        onRowChange(value);
      },
      customValidation: getInviteeEmailError,
      getCustomElement: (
        _values: FormValues<any>,
        customProps: CustomElementProps,
      ) => {
        return drawInviteeEmailField({
          customProps: customProps,
          teamId: TEAM_ID,
        });
      },
    },
  ];

  render(
    <BasicForm
      id="invite-form"
      name="Invite form"
      fields={fields}
      initialValues={{}}
      onSubmit={onSubmit}
      submitButtonText="Invite"
    />,
  );

  return { onSubmit: onSubmit, onRowChange: onRowChange };
}

function box(): HTMLInputElement {
  return screen.getByTestId("invitee-email") as HTMLInputElement;
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText("Invite"));
  });
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(
      200,
      toInviteSuggestionsAnswerJSON([
        {
          userId: "aaaaaaaa-0000-4000-8000-000000000001",
          name: "Ada Lovelace",
          email: "ada@acme.test",
          standing: InviteSuggestionStanding.Member,
        },
      ]),
      {},
    );
  });
});

afterEach(() => {
  cleanup();
});

describe("the invitation form's email row", () => {
  test(
    "what is typed is the row's value, sent under email, and reaches the row's onChange",
    async () => {
      const { onSubmit, onRowChange } = draw();

      fireEvent.change(box(), { target: { value: "new.person@acme.test" } });

      expect(onRowChange).toHaveBeenLastCalledWith("new.person@acme.test");

      await submit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect((onSubmit.mock.calls[0]![0] as JSONObject)["email"]).toBe(
        "new.person@acme.test",
      );
    },
    TIMEOUT,
  );

  test(
    "Enter in the box invites, as an email row always did",
    async () => {
      const { onSubmit } = draw();

      fireEvent.change(box(), { target: { value: "new.person@acme.test" } });

      await act(async () => {
        fireEvent.keyDown(box(), { key: "Enter" });
      });

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect((onSubmit.mock.calls[0]![0] as JSONObject)["email"]).toBe(
        "new.person@acme.test",
      );
    },
    TIMEOUT,
  );

  test(
    "a suggestion picked is the row's value",
    async () => {
      const { onSubmit, onRowChange } = draw();

      fireEvent.focus(box());
      fireEvent.change(box(), { target: { value: "ada" } });

      const suggestion: HTMLElement = await screen.findByTestId(
        "invitee-suggestion",
        {},
        { timeout: INVITE_SUGGESTIONS_DEBOUNCE_IN_MS * 10 },
      );

      fireEvent.click(suggestion);

      expect(onRowChange).toHaveBeenLastCalledWith("ada@acme.test");
      expect(box().value).toBe("ada@acme.test");

      await submit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect((onSubmit.mock.calls[0]![0] as JSONObject)["email"]).toBe(
        "ada@acme.test",
      );
    },
    TIMEOUT,
  );

  test(
    "an address that is not one stops the form, said under the box",
    async () => {
      const { onSubmit } = draw();

      fireEvent.change(box(), { target: { value: "ada@" } });
      fireEvent.blur(box());

      await submit();

      expect(
        await screen.findByText("Email is not valid."),
      ).toBeInTheDocument();
      expect(onSubmit).not.toHaveBeenCalled();
    },
    TIMEOUT,
  );

  test(
    "no address at all stops it, as a required row does",
    async () => {
      const { onSubmit } = draw();

      await submit();

      await waitFor(() => {
        expect(box()).toHaveAttribute("aria-invalid", "true");
      });
      expect(onSubmit).not.toHaveBeenCalled();
    },
    TIMEOUT,
  );
});
