import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";

/*
 * "Notify Status Page Subscribers" on a new incident public note, through the
 * real ModelForm and the real IncidentPublicNote model, down to the payload
 * that would be POSTed.
 *
 * An incident declared without notifying subscribers starts this box
 * unticked. The dashboard does that by seeding the flag as an initial value
 * as well as the field's default, because BasicForm only applies a truthy
 * default: a default of false leaves the value unset and the key never
 * reaches the server. The server would then decide from the incident rather
 * than from what the user saw in the form.
 */

let capturedPayload: JSONObject | null = null;

jest.mock("../../../../UI/Utils/Permission", () => {
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

jest.mock("../../../../UI/Utils/User", () => {
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

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

/*
 * Serializes the model the way ModelAPI.createOrUpdate does before it goes on
 * the wire, and then through JSON, so an unset value is exactly as absent as
 * it would be in the request body.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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
        model: IncidentPublicNote;
        modelType: typeof IncidentPublicNote;
      }): Promise<{ data: JSONObject }> => {
        capturedPayload = JSON.parse(
          JSON.stringify(BaseModel.toJSON(data.model, data.modelType)),
        ) as JSONObject;
        return { data: {} };
      },
    },
  };
});

import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PublicNoteSubscriberNotificationDefault from "../../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";

const NOTIFY_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";
const NOTE_PLACEHOLDER: string = "Write a public note";
const NOTE_TEXT: string =
  "We have identified the cause and are rolling out a fix.";
const CHECKBOX_TITLE: string = "Notify Status Page Subscribers";
const NOTIFYING_DESCRIPTION: string =
  "Should status page subscribers be notified?";

interface RenderOptions {
  notifyByDefault: boolean;
  seedInitialValue: boolean;
}

/*
 * The shape the dashboard's public note forms use: a note, and the notify
 * checkbox whose default and description follow the incident.
 */
async function renderNoteForm(options: RenderOptions): Promise<void> {
  const fields: Fields<IncidentPublicNote> = [
    {
      field: { note: true },
      title: "Public Incident Note",
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      placeholder: NOTE_PLACEHOLDER,
    },
    {
      field: { shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true },
      title: CHECKBOX_TITLE,
      description: options.notifyByDefault
        ? NOTIFYING_DESCRIPTION
        : PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
      fieldType: FormFieldSchemaType.Checkbox,
      defaultValue: options.notifyByDefault,
      required: false,
    },
  ];

  const initialValues: FormValues<IncidentPublicNote> | undefined =
    options.seedInitialValue
      ? {
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
            options.notifyByDefault,
        }
      : undefined;

  await act(async (): Promise<void> => {
    render(
      <ModelForm<IncidentPublicNote>
        modelType={IncidentPublicNote}
        id="incident-public-note-form"
        name="Incident > Public Note"
        fields={fields}
        formType={FormType.Create}
        initialValues={initialValues}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Save"
      />,
    );
  });
}

function notifyCheckbox(): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: CHECKBOX_TITLE,
  }) as HTMLInputElement;
}

async function writeNote(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(screen.getByPlaceholderText(NOTE_PLACEHOLDER), {
      target: { value: NOTE_TEXT },
    });
  });
}

async function toggleNotify(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(notifyCheckbox());
  });
}

async function submit(): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

  if (!capturedPayload) {
    throw new Error("The form did not submit");
  }

  return capturedPayload;
}

afterEach(() => {
  cleanup();
  capturedPayload = null;
});

describe("public note form on an incident declared without notifying subscribers", () => {
  test("starts with the box unticked and explains why", async () => {
    await renderNoteForm({ notifyByDefault: false, seedInitialValue: true });

    expect(notifyCheckbox()).not.toBeChecked();
    expect(
      screen.getByText(
        PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOTIFYING_DESCRIPTION)).toBeNull();
  });

  test("sends an explicit false when the box is left unticked", async () => {
    await renderNoteForm({ notifyByDefault: false, seedInitialValue: true });

    await writeNote();
    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).toContain(NOTIFY_FIELD);
    expect(payload[NOTIFY_FIELD]).toBe(false);
    expect(payload["note"]).toBe(NOTE_TEXT);
  });

  test("sends true when the user ticks the box", async () => {
    await renderNoteForm({ notifyByDefault: false, seedInitialValue: true });

    await writeNote();
    await toggleNotify();

    expect(notifyCheckbox()).toBeChecked();

    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD]).toBe(true);
  });

  test("sends false again when the user ticks and then unticks the box", async () => {
    await renderNoteForm({ notifyByDefault: false, seedInitialValue: true });

    await writeNote();
    await toggleNotify();
    await toggleNotify();

    expect(notifyCheckbox()).not.toBeChecked();

    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD]).toBe(false);
  });
});

describe("public note form on an incident that notified subscribers", () => {
  test("starts with the box ticked and the usual description", async () => {
    await renderNoteForm({ notifyByDefault: true, seedInitialValue: true });

    expect(notifyCheckbox()).toBeChecked();
    expect(screen.getByText(NOTIFYING_DESCRIPTION)).toBeInTheDocument();
    expect(
      screen.queryByText(
        PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
      ),
    ).toBeNull();
  });

  test("sends true when the box is left ticked", async () => {
    await renderNoteForm({ notifyByDefault: true, seedInitialValue: true });

    await writeNote();
    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD]).toBe(true);
  });

  test("sends false when the user unticks the box", async () => {
    await renderNoteForm({ notifyByDefault: true, seedInitialValue: true });

    await writeNote();
    await toggleNotify();

    expect(notifyCheckbox()).not.toBeChecked();

    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).toContain(NOTIFY_FIELD);
    expect(payload[NOTIFY_FIELD]).toBe(false);
  });
});

describe("why the dashboard seeds the notify flag as an initial value", () => {
  /*
   * Documents the form behaviour the dashboard works around. If this starts
   * failing because BasicForm now applies a false default, the initialValues
   * seeding in the public note and state change forms is no longer needed.
   */
  test("a false default alone leaves the box unticked but sends no notify flag, leaving the choice to the server", async () => {
    await renderNoteForm({ notifyByDefault: false, seedInitialValue: false });

    expect(notifyCheckbox()).not.toBeChecked();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD]).toBeUndefined();
    expect(Object.keys(payload)).not.toContain(NOTIFY_FIELD);
    expect(payload["note"]).toBe(NOTE_TEXT);
  });

  test("a true default alone is applied and sent", async () => {
    await renderNoteForm({ notifyByDefault: true, seedInitialValue: false });

    expect(notifyCheckbox()).toBeChecked();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD]).toBe(true);
  });
});
