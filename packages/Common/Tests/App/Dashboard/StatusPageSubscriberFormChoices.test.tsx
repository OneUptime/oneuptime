import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * Adding a status page subscriber by hand, and changing one: plain choices
 * (SubscriberFormChoices, SubscriberFormFields, Utils/Form/ColumnChoice).
 *
 * Email Subscribers > Add asked two switches, "Do not send confirmation
 * link" and "Send Subscription Email", whose words said the opposite of
 * what the second did. It asks one question now, When you add them, with
 * three answers, each written into the same two columns the switches
 * wrote. Editing a subscriber asks for its Status, in the words of the
 * lists' Status column. The other channels confirm nobody, so their Add
 * forms keep one switch, Send a welcome message, folded with the internal
 * note under More fields.
 *
 * The rules are tested on their own, then through the real ModelForm and
 * BasicForm with only the network stubbed: what is drawn, and what is sent.
 */

type CapturedRequest = {
  model: JSONObject;
  miscDataProps: JSONObject;
};

let capturedRequests: Array<CapturedRequest> = [];
let storedSubscriber: JSONObject = {};

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return { ...storedSubscriber };
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
        miscDataProps: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({
          model: data.model,
          miscDataProps: { ...data.miscDataProps },
        });
        return { data: data.model };
      },
    },
  };
});

import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  EMAIL_SUBSCRIBER_STATUS,
  readSubscriberAddChoice,
  readSubscriberStatus,
  SUBSCRIBER_ADD_CHOICE,
  SUBSCRIBER_ADD_CHOICE_COLUMNS,
  SUBSCRIBER_ADD_CHOICE_FIELD_KEY,
  SUBSCRIBER_STATUS,
  SUBSCRIBER_STATUS_FIELD_KEY,
  SubscriberAddChoice,
  SubscriberFormCopy,
  SubscriberStatusChoice,
  getSubscriberAddChoiceColumns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices";
import {
  SUBSCRIBER_INFO_STEP_ID,
  getEmailSubscriberAddChoiceFields,
  getSubscriberInternalNoteField,
  getSubscriberStatusFields,
  getSubscriberWelcomeField,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormFields";
import {
  ColumnChoiceConfig,
  getColumnChoiceInForm,
  getColumnChoiceRadioButtons,
  getColumnChoiceTitle,
  getColumnChoiceTitles,
  getValuesForColumnChoice,
  isColumnChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ColumnChoice";
import {
  ColumnChoiceAnswer,
  ColumnChoiceRadio,
  getColumnChoiceField,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/ColumnChoiceField";

const SUBSCRIBER_ID: string = "00000005-0000-4000-8000-000000000005";
const EMAIL_PLACEHOLDER: string = "subscriber@company.com";

const EMAIL_FIELD: ModelField<StatusPageSubscriber> = {
  field: { subscriberEmail: true },
  stepId: SUBSCRIBER_INFO_STEP_ID,
  title: "Email",
  fieldType: FormFieldSchemaType.Email,
  required: true,
  placeholder: EMAIL_PLACEHOLDER,
};

type Values = Record<string, unknown>;

afterEach(() => {
  cleanup();
  capturedRequests = [];
  storedSubscriber = {};
});

describe("When you add them: the question an email subscriber added by hand is asked", () => {
  test("is one question with three answers, each saying what it means", () => {
    expect(SUBSCRIBER_ADD_CHOICE.title).toBe("When you add them");
    expect(
      SUBSCRIBER_ADD_CHOICE.options.map((option: { title: string }) => {
        return option.title;
      }),
    ).toEqual([
      "Subscribe them now",
      "Subscribe them now and tell them",
      "Ask them to confirm first",
    ]);
    expect(
      SUBSCRIBER_ADD_CHOICE.options.map(
        (option: { description?: string | undefined }) => {
          return option.description;
        },
      ),
    ).toEqual([
      "They get updates from now on. Nothing is sent to them now.",
      "We email them that they are subscribed, with a link to unsubscribe.",
      "We email them a link. They get updates once they click it.",
    ]);
  });

  test("each answer writes the two columns the switches wrote", () => {
    expect(SUBSCRIBER_ADD_CHOICE_COLUMNS).toEqual({
      [SubscriberAddChoice.SubscribeNow]: {
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: false,
      },
      [SubscriberAddChoice.SubscribeAndTell]: {
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: true,
      },
      [SubscriberAddChoice.AskToConfirm]: {
        isSubscriptionConfirmed: false,
        sendYouHaveSubscribedMessage: false,
      },
    });

    for (const choice of Object.values(SubscriberAddChoice)) {
      expect(SUBSCRIBER_ADD_CHOICE.getColumns(choice)).toEqual(
        SUBSCRIBER_ADD_CHOICE_COLUMNS[choice],
      );
      // A copy: changing what an answer wrote never changes the answer.
      expect(SUBSCRIBER_ADD_CHOICE.getColumns(choice)).not.toBe(
        SUBSCRIBER_ADD_CHOICE_COLUMNS[choice],
      );
    }
  });

  test("the columns read back as the answer the server acts on", () => {
    // Not confirmed is a confirmation link, whatever the second column says.
    expect(
      readSubscriberAddChoice({
        isSubscriptionConfirmed: false,
        sendYouHaveSubscribedMessage: true,
      }),
    ).toBe(SubscriberAddChoice.AskToConfirm);
    expect(
      readSubscriberAddChoice({
        isSubscriptionConfirmed: false,
        sendYouHaveSubscribedMessage: false,
      }),
    ).toBe(SubscriberAddChoice.AskToConfirm);
    expect(
      readSubscriberAddChoice({
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: true,
      }),
    ).toBe(SubscriberAddChoice.SubscribeAndTell);
    expect(
      readSubscriberAddChoice({
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: false,
      }),
    ).toBe(SubscriberAddChoice.SubscribeNow);
    // A new form, before anything is touched: what the switches started as.
    expect(readSubscriberAddChoice({})).toBe(SubscriberAddChoice.SubscribeNow);

    for (const choice of Object.values(SubscriberAddChoice)) {
      expect(
        readSubscriberAddChoice(SUBSCRIBER_ADD_CHOICE_COLUMNS[choice]),
      ).toBe(choice);
    }
  });

  test("Add in Bulk sends the columns of the answer it was given, and of Subscribe them now for anything else", () => {
    expect(
      getSubscriberAddChoiceColumns(SubscriberAddChoice.AskToConfirm),
    ).toEqual({
      isSubscriptionConfirmed: false,
      sendYouHaveSubscribedMessage: false,
    });
    expect(
      getSubscriberAddChoiceColumns(SubscriberAddChoice.SubscribeAndTell),
    ).toEqual({
      isSubscriptionConfirmed: true,
      sendYouHaveSubscribedMessage: true,
    });

    for (const unknown of [undefined, null, "", "confirm", 1, {}]) {
      expect(getSubscriberAddChoiceColumns(unknown)).toEqual({
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: false,
      });
    }
  });
});

describe("a subscriber's Status, on its Edit form", () => {
  test("an email subscriber can also be awaiting confirmation", () => {
    expect(EMAIL_SUBSCRIBER_STATUS.title).toBe("Status");
    expect(
      EMAIL_SUBSCRIBER_STATUS.options.map((option: { title: string }) => {
        return option.title;
      }),
    ).toEqual(["Subscribed", "Awaiting Confirmation", "Unsubscribed"]);
    expect(
      SUBSCRIBER_STATUS.options.map((option: { title: string }) => {
        return option.title;
      }),
    ).toEqual(["Subscribed", "Unsubscribed"]);

    for (const option of [
      ...EMAIL_SUBSCRIBER_STATUS.options,
      ...SUBSCRIBER_STATUS.options,
    ]) {
      expect(option.description).toBeTruthy();
    }
  });

  test("reads the status the lists' Status column shows", () => {
    expect(readSubscriberStatus({ isUnsubscribed: true })).toBe(
      SubscriberStatusChoice.Unsubscribed,
    );
    // Unsubscribed wins over not confirmed.
    expect(
      readSubscriberStatus({
        isUnsubscribed: true,
        isSubscriptionConfirmed: false,
      }),
    ).toBe(SubscriberStatusChoice.Unsubscribed);
    expect(
      readSubscriberStatus({
        isUnsubscribed: false,
        isSubscriptionConfirmed: false,
      }),
    ).toBe(SubscriberStatusChoice.AwaitingConfirmation);
    expect(
      readSubscriberStatus({
        isUnsubscribed: false,
        isSubscriptionConfirmed: true,
      }),
    ).toBe(SubscriberStatusChoice.Subscribed);
    expect(readSubscriberStatus({})).toBe(SubscriberStatusChoice.Subscribed);

    // The other channels confirm nobody: only unsubscribed or not.
    expect(
      SUBSCRIBER_STATUS.readChoice({
        isUnsubscribed: false,
        isSubscriptionConfirmed: false,
      }),
    ).toBe(SubscriberStatusChoice.Subscribed);
    expect(SUBSCRIBER_STATUS.readChoice({ isUnsubscribed: true })).toBe(
      SubscriberStatusChoice.Unsubscribed,
    );
  });

  test("writes only what the status changes", () => {
    expect(
      EMAIL_SUBSCRIBER_STATUS.getColumns(SubscriberStatusChoice.Subscribed),
    ).toEqual({ isUnsubscribed: false, isSubscriptionConfirmed: true });
    expect(
      EMAIL_SUBSCRIBER_STATUS.getColumns(
        SubscriberStatusChoice.AwaitingConfirmation,
      ),
    ).toEqual({ isUnsubscribed: false, isSubscriptionConfirmed: false });
    // Unsubscribing leaves whether they had confirmed as it was.
    expect(
      EMAIL_SUBSCRIBER_STATUS.getColumns(SubscriberStatusChoice.Unsubscribed),
    ).toEqual({ isUnsubscribed: true });

    expect(
      SUBSCRIBER_STATUS.getColumns(SubscriberStatusChoice.Subscribed),
    ).toEqual({ isUnsubscribed: false });
    expect(
      SUBSCRIBER_STATUS.getColumns(SubscriberStatusChoice.Unsubscribed),
    ).toEqual({ isUnsubscribed: true });
  });

  test("the copy names the lists' rows and their button as the tables draw them", () => {
    expect(SubscriberFormCopy.subscriberName).toBe("Subscriber");
    expect(SubscriberFormCopy.addButton).toBe("Add Subscriber");
    expect(SubscriberFormCopy.addDialogTitle).toBe("Add New Subscriber");
    expect(SubscriberFormCopy.welcomeTitle).toBe("Send a welcome message");
    expect(SubscriberFormCopy.internalNoteDescription).toBe(
      "Only your team sees it.",
    );
  });
});

describe("ColumnChoice: one question, written into its columns", () => {
  const config: ColumnChoiceConfig<SubscriberAddChoice> = SUBSCRIBER_ADD_CHOICE;

  test("knows its own answers, and nothing else", () => {
    expect(isColumnChoice(config, SubscriberAddChoice.AskToConfirm)).toBe(true);
    expect(isColumnChoice(config, "subscribed")).toBe(false);
    expect(isColumnChoice(config, undefined)).toBe(false);
    expect(isColumnChoice(config, 3)).toBe(false);
  });

  test("a form shows the answer picked in it, else the one its columns make", () => {
    expect(getColumnChoiceInForm(config, undefined)).toBe(
      SubscriberAddChoice.SubscribeNow,
    );
    expect(
      getColumnChoiceInForm(config, {
        isSubscriptionConfirmed: false,
      }),
    ).toBe(SubscriberAddChoice.AskToConfirm);
    expect(
      getColumnChoiceInForm(config, {
        [SUBSCRIBER_ADD_CHOICE_FIELD_KEY]: SubscriberAddChoice.SubscribeAndTell,
        isSubscriptionConfirmed: false,
      }),
    ).toBe(SubscriberAddChoice.SubscribeAndTell);
    // A pick that is no answer is not one.
    expect(
      getColumnChoiceInForm(config, {
        [SUBSCRIBER_ADD_CHOICE_FIELD_KEY]: "nonsense",
        isSubscriptionConfirmed: false,
      }),
    ).toBe(SubscriberAddChoice.AskToConfirm);
  });

  test("picking an answer keeps the pick and writes its columns over the rest of the form", () => {
    const values: Values = getValuesForColumnChoice({
      config: config,
      values: {
        subscriberEmail: "ana@example.com",
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: true,
      },
      choice: SubscriberAddChoice.AskToConfirm,
    });

    expect(values).toEqual({
      subscriberEmail: "ana@example.com",
      [SUBSCRIBER_ADD_CHOICE_FIELD_KEY]: SubscriberAddChoice.AskToConfirm,
      isSubscriptionConfirmed: false,
      sendYouHaveSubscribedMessage: false,
    });
    expect(
      getValuesForColumnChoice({
        config: config,
        values: null,
        choice: SubscriberAddChoice.SubscribeNow,
      }),
    ).toEqual({
      [SUBSCRIBER_ADD_CHOICE_FIELD_KEY]: SubscriberAddChoice.SubscribeNow,
      isSubscriptionConfirmed: true,
      sendYouHaveSubscribedMessage: false,
    });
  });

  test("lists its answers for a plain form, and names one for a card", () => {
    expect(getColumnChoiceTitles(config)).toEqual([
      "Subscribe them now",
      "Subscribe them now and tell them",
      "Ask them to confirm first",
    ]);
    expect(getColumnChoiceRadioButtons(config)).toEqual(
      config.options.map((option: Values) => {
        return {
          value: option["value"],
          title: option["title"],
          description: option["description"],
        };
      }),
    );
    expect(
      getColumnChoiceTitle(config, SubscriberAddChoice.SubscribeAndTell),
    ).toBe("Subscribe them now and tell them");
    expect(
      getColumnChoiceTitle(config, "elsewhere" as SubscriberAddChoice),
    ).toBe("elsewhere");
  });

  test("the radios draw each answer with its line, and say which answer was picked", () => {
    const picked: Array<SubscriberAddChoice> = [];

    render(
      <ColumnChoiceRadio<SubscriberAddChoice>
        config={config}
        value={SubscriberAddChoice.SubscribeNow}
        onChange={(choice: SubscriberAddChoice): void => {
          picked.push(choice);
        }}
      />,
    );

    const group: HTMLElement = screen.getByTestId(config.dataTestId);

    expect(group).toHaveTextContent(
      "They get updates from now on. Nothing is sent to them now.",
    );
    expect(
      screen.getByRole("radio", { name: "Subscribe them now" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Ask them to confirm first" }),
    ).not.toBeChecked();

    fireEvent.click(
      screen.getByRole("radio", { name: "Ask them to confirm first" }),
    );

    expect(picked).toEqual([SubscriberAddChoice.AskToConfirm]);
  });

  test("an answer on a card is drawn as its words", () => {
    render(
      <ColumnChoiceAnswer
        title="Subscribe them now and tell them"
        dataTestId="answer"
      />,
    );

    expect(screen.getByTestId("answer")).toHaveTextContent(
      "Subscribe them now and tell them",
    );
  });

  test("the field is form-only, stands in for its column, and writes the columns of what is picked", () => {
    const field: ModelField<StatusPageSubscriber> = getColumnChoiceField<
      StatusPageSubscriber,
      SubscriberAddChoice
    >({
      config: config,
      column: "isSubscriptionConfirmed",
      stepId: SUBSCRIBER_INFO_STEP_ID,
      doNotShowWhenEditing: true,
    });

    expect(field.formOnly).toBe(true);
    expect(field.overrideField).toEqual({ isSubscriptionConfirmed: true });
    expect(field.overrideFieldKey).toBe(SUBSCRIBER_ADD_CHOICE_FIELD_KEY);
    expect(field.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(field.title).toBe("When you add them");
    expect(field.required).toBe(false);
    expect(field.hideOptionalLabel).toBe(true);
    expect(field.hideColumnDescription).toBe(true);
    expect(field.doNotShowWhenEditing).toBe(true);
    expect(field.stepId).toBe(SUBSCRIBER_INFO_STEP_ID);

    const written: Array<Values> = [];
    const write: (values: FormValues<StatusPageSubscriber>) => void = (
      values: FormValues<StatusPageSubscriber>,
    ): void => {
      written.push(values as Values);
    };

    field.onChange!(
      SubscriberAddChoice.SubscribeAndTell,
      {
        subscriberEmail: "ana@example.com",
      } as FormValues<StatusPageSubscriber>,
      write,
    );
    // Something that is no answer changes nothing.
    field.onChange!(
      "unsubscribed",
      {} as FormValues<StatusPageSubscriber>,
      write,
    );

    expect(written).toEqual([
      {
        subscriberEmail: "ana@example.com",
        [SUBSCRIBER_ADD_CHOICE_FIELD_KEY]: SubscriberAddChoice.SubscribeAndTell,
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: true,
      },
    ]);
  });
});

describe("the fields the subscriber lists' forms share", () => {
  test("Email Subscribers > Add: the question, and the two columns registered unseen at Subscribe them now", () => {
    const fields: Array<ModelField<StatusPageSubscriber>> =
      getEmailSubscriberAddChoiceFields();

    expect(fields).toHaveLength(3);
    expect(fields[0]!.overrideFieldKey).toBe(SUBSCRIBER_ADD_CHOICE_FIELD_KEY);

    const hidden: Array<ModelField<StatusPageSubscriber>> = fields.slice(1);

    expect(
      hidden.map((field: ModelField<StatusPageSubscriber>) => {
        return Object.keys(field.field || {})[0];
      }),
    ).toEqual(["isSubscriptionConfirmed", "sendYouHaveSubscribedMessage"]);

    for (const field of fields) {
      expect(field.stepId).toBe(SUBSCRIBER_INFO_STEP_ID);
      expect(field.doNotShowWhenEditing).toBe(true);
    }

    for (const field of hidden) {
      expect(field.showIf!({} as FormValues<StatusPageSubscriber>)).toBe(false);
    }

    // What a form nobody touches sends: the first answer, exactly.
    const untouched: Values = {
      isSubscriptionConfirmed: hidden[0]!.defaultValue,
      sendYouHaveSubscribedMessage: hidden[1]!.defaultValue,
    };

    expect(untouched).toEqual(
      SUBSCRIBER_ADD_CHOICE_COLUMNS[SubscriberAddChoice.SubscribeNow],
    );
    expect(readSubscriberAddChoice(untouched)).toBe(
      SubscriberAddChoice.SubscribeNow,
    );
  });

  test("Edit: the status, and the columns it writes, never on Add", () => {
    const email: Array<ModelField<StatusPageSubscriber>> =
      getSubscriberStatusFields({ isEmail: true });
    const other: Array<ModelField<StatusPageSubscriber>> =
      getSubscriberStatusFields({ isEmail: false });

    expect(email[0]!.overrideFieldKey).toBe(SUBSCRIBER_STATUS_FIELD_KEY);
    expect(email[0]!.overrideField).toEqual({ isUnsubscribed: true });
    expect(
      email.slice(1).map((field: ModelField<StatusPageSubscriber>) => {
        return Object.keys(field.field || {})[0];
      }),
    ).toEqual(["isUnsubscribed", "isSubscriptionConfirmed"]);
    expect(
      other.slice(1).map((field: ModelField<StatusPageSubscriber>) => {
        return Object.keys(field.field || {})[0];
      }),
    ).toEqual(["isUnsubscribed"]);

    for (const field of [...email, ...other]) {
      expect(field.doNotShowWhenCreating).toBe(true);
      expect(field.stepId).toBe(SUBSCRIBER_INFO_STEP_ID);
    }

    for (const field of [...email.slice(1), ...other.slice(1)]) {
      expect(field.showIf!({} as FormValues<StatusPageSubscriber>)).toBe(false);
    }
  });

  test("the welcome message and the internal note wait under More fields", () => {
    const moreFields: ReturnType<
      typeof getAdvancedFormSection<StatusPageSubscriber>
    > = getAdvancedFormSection<StatusPageSubscriber>();
    const welcome: ModelField<StatusPageSubscriber> =
      getSubscriberWelcomeField(moreFields);
    const note: ModelField<StatusPageSubscriber> =
      getSubscriberInternalNoteField(moreFields);

    expect(welcome.field).toEqual({ sendYouHaveSubscribedMessage: true });
    expect(welcome.title).toBe("Send a welcome message");
    expect(welcome.description).toBe(
      "Tells them they are subscribed, with a link to unsubscribe.",
    );
    expect(welcome.fieldType).toBe(FormFieldSchemaType.Toggle);
    // Off, as it always started: the admin decides to tell them.
    expect(welcome.defaultValue).toBe(false);
    expect(welcome.doNotShowWhenEditing).toBe(true);
    expect(welcome.collapsibleSection).toBe(moreFields);

    expect(note.field).toEqual({ internalNote: true });
    expect(note.title).toBe("Internal Note");
    expect(note.description).toBe("Only your team sees it.");
    expect(note.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(note.collapsibleSection).toBe(moreFields);
    expect(note.stepId).toBe(SUBSCRIBER_INFO_STEP_ID);
  });
});

async function renderAddForm(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<StatusPageSubscriber>
        modelType={StatusPageSubscriber}
        id="email-subscriber-form"
        name="Email Subscriber"
        fields={[EMAIL_FIELD, ...getEmailSubscriberAddChoiceFields()]}
        formType={FormType.Create}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Add Subscriber"
      />,
    );
  });
}

async function submit(buttonName: string): Promise<CapturedRequest> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
  });

  await waitFor(() => {
    expect(capturedRequests).toHaveLength(1);
  });

  return capturedRequests[0]!;
}

describe("Email Subscribers > Add, through the real form", () => {
  test("asks When you add them, at Subscribe them now, and no longer the two switches", async () => {
    await renderAddForm();

    expect(screen.getByText("When you add them")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Subscribe them now" }),
    ).toBeChecked();
    expect(screen.queryByText("Do not send confirmation link")).toBeNull();
    expect(screen.queryByText("Send Subscription Email")).toBeNull();
    expect(screen.queryByText("Is Subscription Confirmed")).toBeNull();
  });

  test.each([
    [
      "Subscribe them now",
      { isSubscriptionConfirmed: true, sendYouHaveSubscribedMessage: false },
    ],
    [
      "Subscribe them now and tell them",
      { isSubscriptionConfirmed: true, sendYouHaveSubscribedMessage: true },
    ],
    [
      "Ask them to confirm first",
      { isSubscriptionConfirmed: false, sendYouHaveSubscribedMessage: false },
    ],
  ])(
    "%s sends its two columns, and never the answer itself",
    async (answer: string, columns: Values) => {
      await renderAddForm();

      fireEvent.change(screen.getByPlaceholderText(EMAIL_PLACEHOLDER), {
        target: { value: "ana@example.com" },
      });

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByRole("radio", { name: answer }));
      });

      expect(screen.getByRole("radio", { name: answer })).toBeChecked();

      const request: CapturedRequest = await submit("Add Subscriber");

      expect(request.model["subscriberEmail"]).toBe("ana@example.com");
      expect(request.model["isSubscriptionConfirmed"]).toBe(
        columns["isSubscriptionConfirmed"],
      );
      expect(request.model["sendYouHaveSubscribedMessage"]).toBe(
        columns["sendYouHaveSubscribedMessage"],
      );
      expect(request.model[SUBSCRIBER_ADD_CHOICE_FIELD_KEY]).toBeUndefined();
      expect(request.miscDataProps).toEqual({});
    },
  );

  test("untouched, it sends what Subscribe them now means", async () => {
    await renderAddForm();

    fireEvent.change(screen.getByPlaceholderText(EMAIL_PLACEHOLDER), {
      target: { value: "ana@example.com" },
    });

    const request: CapturedRequest = await submit("Add Subscriber");

    expect(request.model["isSubscriptionConfirmed"]).toBe(true);
    expect(request.model["sendYouHaveSubscribedMessage"]).toBe(false);
  });
});

describe("Email Subscribers > Edit, through the real form", () => {
  async function renderEditForm(stored: JSONObject): Promise<void> {
    storedSubscriber = {
      _id: SUBSCRIBER_ID,
      subscriberEmail: "ana@example.com",
      ...stored,
    };

    await act(async (): Promise<void> => {
      render(
        <ModelForm<StatusPageSubscriber>
          modelType={StatusPageSubscriber}
          id="email-subscriber-edit-form"
          name="Email Subscriber"
          fields={[
            EMAIL_FIELD,
            ...getSubscriberStatusFields({ isEmail: true }),
          ]}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(SUBSCRIBER_ID)}
          onSuccess={(): void => {
            // Not asserted on.
          }}
          submitButtonText="Save"
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toHaveValue(
        "ana@example.com",
      );
    });
  }

  test.each([
    [{ isUnsubscribed: false, isSubscriptionConfirmed: true }, "Subscribed"],
    [
      { isUnsubscribed: false, isSubscriptionConfirmed: false },
      "Awaiting Confirmation",
    ],
    [{ isUnsubscribed: true, isSubscriptionConfirmed: true }, "Unsubscribed"],
  ])(
    "a subscriber stored as %j shows as %s",
    async (stored: JSONObject, status: string) => {
      await renderEditForm(stored);

      await waitFor(() => {
        expect(screen.getByRole("radio", { name: status })).toBeChecked();
      });
      expect(screen.queryByText("Do not send confirmation link")).toBeNull();
    },
  );

  test("confirming one who never clicked the link: Subscribed writes confirmed", async () => {
    await renderEditForm({
      isUnsubscribed: false,
      isSubscriptionConfirmed: false,
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("radio", { name: "Subscribed" }));
    });

    const request: CapturedRequest = await submit("Save");

    expect(request.model["isUnsubscribed"]).toBe(false);
    expect(request.model["isSubscriptionConfirmed"]).toBe(true);
    expect(request.model[SUBSCRIBER_STATUS_FIELD_KEY]).toBeUndefined();
    expect(request.miscDataProps).toEqual({});
  });

  test("unsubscribing leaves whether they had confirmed as it was", async () => {
    await renderEditForm({
      isUnsubscribed: false,
      isSubscriptionConfirmed: true,
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("radio", { name: "Unsubscribed" }));
    });

    const request: CapturedRequest = await submit("Save");

    expect(request.model["isUnsubscribed"]).toBe(true);
    expect(request.model["isSubscriptionConfirmed"]).toBe(true);
  });
});
