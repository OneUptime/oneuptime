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
 * AN INVITATION'S NAME ROW, IN A REAL FORM (#9745).
 *
 * The invite forms used to ask the server whether the address typed had a
 * OneUptime account (POST /team-member/is-user-registered) and offered a
 * Name only when it had none - so any signed-in account could ask about any
 * address. Now, as Invite New User and Invite New Team Member build it:
 *
 *   - the Name row is offered, optional, as soon as a whole address is
 *     typed, whoever it belongs to, and nothing is asked about the address;
 *   - a new person is invited with their name, or without one;
 *   - the person picked from the suggestions has an account the reader may
 *     see, so no Name is asked for them, until the address is changed.
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
  INVITEE_NAME_DESCRIPTION,
  shouldAskForInviteeName,
} from "../../../UI/Utils/InviteeName";
import {
  drawInviteeEmailField,
  getInviteeEmailError,
} from "../../../UI/Components/InviteeEmailField/InviteeEmailFormField";
import { INVITE_SUGGESTIONS_DEBOUNCE_IN_MS } from "../../../UI/Components/InviteeEmailField/InviteeEmailField";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  InviteSuggestionStanding,
  toInviteSuggestionsAnswerJSON,
} from "../../../Types/Team/InviteSuggestions";

const TEAM_ID: string = "22222222-2222-4222-8222-222222222222";
const TIMEOUT: number = 30000;

const ADA: InviteSuggestion = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
  email: "ada@acme.test",
  standing: InviteSuggestionStanding.Member,
};

interface HarnessProps {
  onSubmit: (values: JSONObject) => void;
}

/*
 * The two rows as the Dashboard's invite forms build them: the page keeps
 * the address of the suggestion picked last, and the Name row's showIf
 * reads it.
 */
const InviteFormHarness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const [pickedInviteeEmail, setPickedInviteeEmail] =
    React.useState<string>("");

  const fields: Fields<FormValues<any>> = [
    {
      field: { user: true },
      title: "Email",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      placeholder: "member@company.com",
      overrideFieldKey: "email",
      customValidation: getInviteeEmailError,
      getCustomElement: (
        _values: FormValues<any>,
        customProps: CustomElementProps,
      ) => {
        return drawInviteeEmailField({
          customProps: customProps,
          teamId: TEAM_ID,
          onPick: (suggestion: InviteSuggestion) => {
            setPickedInviteeEmail(suggestion.email);
          },
        });
      },
    },
    {
      field: { user: true },
      title: "Name",
      description: INVITEE_NAME_DESCRIPTION,
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "John Smith",
      overrideFieldKey: "name",
      showIf: (values: FormValues<any>): boolean => {
        return shouldAskForInviteeName({
          email: (values as JSONObject)["email"],
          pickedEmail: pickedInviteeEmail,
        });
      },
    },
  ];

  return (
    <BasicForm
      id="invite-form"
      name="Invite form"
      fields={fields}
      initialValues={{}}
      onSubmit={(values: FormValues<any>) => {
        props.onSubmit(values as JSONObject);
      }}
      submitButtonText="Invite"
    />
  );
};

function draw(): MockFunction {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <InviteFormHarness
      onSubmit={(values: JSONObject) => {
        onSubmit(values);
      }}
    />,
  );

  return onSubmit;
}

function box(): HTMLInputElement {
  return screen.getByTestId("invitee-email") as HTMLInputElement;
}

function nameBox(): HTMLInputElement | null {
  return screen.queryByPlaceholderText("John Smith") as HTMLInputElement | null;
}

async function type(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(box(), { target: { value: value } });
  });
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText("Invite"));
  });
}

// Every address the form asked the server about, by route.
function routesAsked(): Array<string> {
  return postMock.mock.calls.map((call: Array<any>): string => {
    return String((call[0] as { url: unknown }).url);
  });
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(
      200,
      toInviteSuggestionsAnswerJSON([ADA]),
      {},
    );
  });
});

afterEach(() => {
  cleanup();
});

describe("an invitation's Name row", () => {
  test(
    "is not offered before an address is typed, nor for part of one",
    async () => {
      draw();

      expect(nameBox()).toBeNull();

      await type("grace@");

      expect(nameBox()).toBeNull();
    },
    TIMEOUT,
  );

  test(
    "is offered, optional, once a whole address is typed, with what it is for",
    async () => {
      draw();

      await type("grace@acme.test");

      await waitFor(() => {
        expect(nameBox()).not.toBeNull();
      });
      expect(screen.getAllByText(/^Name\b/).length).toBeGreaterThan(0);
      expect(screen.getByText(INVITEE_NAME_DESCRIPTION)).toBeInTheDocument();
      expect(screen.getAllByText("(Optional)").length).toBeGreaterThan(0);
      expect(nameBox()).not.toBeRequired();
    },
    TIMEOUT,
  );

  test(
    "a new person is invited with the name typed",
    async () => {
      const onSubmit: MockFunction = draw();

      await type("grace@acme.test");

      await waitFor(() => {
        expect(nameBox()).not.toBeNull();
      });

      await act(async () => {
        fireEvent.change(nameBox()!, { target: { value: "Grace Hopper" } });
      });

      await submit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      const sent: JSONObject = onSubmit.mock.calls[0]![0] as JSONObject;

      expect(sent["email"]).toBe("grace@acme.test");
      expect(sent["name"]).toBe("Grace Hopper");
    },
    TIMEOUT,
  );

  test(
    "a new person is invited without one: the name is optional",
    async () => {
      const onSubmit: MockFunction = draw();

      await type("grace@acme.test");
      await submit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect((onSubmit.mock.calls[0]![0] as JSONObject)["email"]).toBe(
        "grace@acme.test",
      );
    },
    TIMEOUT,
  );

  test(
    "nothing asks the server whether the address has an account (the regression)",
    async () => {
      const onSubmit: MockFunction = draw();

      await type("grace@acme.test");

      // Long past the old check's 400ms debounce.
      await act(async () => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, INVITE_SUGGESTIONS_DEBOUNCE_IN_MS * 4);
        });
      });

      await submit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      for (const route of routesAsked()) {
        expect(route).toContain(INVITE_SUGGESTIONS_ROUTE);
        expect(route).not.toContain("is-user-registered");
      }
    },
    TIMEOUT,
  );

  test(
    "is not offered for the person picked from the suggestions, and is again once the address changes",
    async () => {
      const onSubmit: MockFunction = draw();

      fireEvent.focus(box());
      await type("ada");

      const suggestion: HTMLElement = await screen.findByTestId(
        "invitee-suggestion",
        {},
        { timeout: INVITE_SUGGESTIONS_DEBOUNCE_IN_MS * 10 },
      );

      await act(async () => {
        fireEvent.click(suggestion);
      });

      expect(box().value).toBe(ADA.email);
      await waitFor(() => {
        expect(nameBox()).toBeNull();
      });

      // Someone else's address: their name may be needed again.
      await type("ada.byron@acme.test");

      await waitFor(() => {
        expect(nameBox()).not.toBeNull();
      });

      // And back to the person picked: nothing to ask.
      await type(ADA.email);

      await waitFor(() => {
        expect(nameBox()).toBeNull();
      });

      await submit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect((onSubmit.mock.calls[0]![0] as JSONObject)["email"]).toBe(
        ADA.email,
      );
    },
    TIMEOUT,
  );
});
