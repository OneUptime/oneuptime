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
 * "Notify Status Page Subscribers" on a new scheduled maintenance public
 * note, through the real ModelForm and the real ScheduledMaintenancePublicNote
 * model, down to the payload that would be POSTed. The state change form,
 * whose checkbox also decides whether its public note notifies, is covered
 * the same way against the real ScheduledMaintenanceStateTimeline model.
 *
 * An event created without notifying subscribers starts these boxes
 * unticked. The dashboard does that by seeding the flag as an initial value
 * as well as the field's default, because BasicForm only applies a truthy
 * default: a default of false leaves the value unset and the key never
 * reaches the server. The server would then decide from the event (or, for a
 * state change, from the database default of notifying) rather than from
 * what the user saw in the form.
 */

let capturedPayload: JSONObject | null = null;
let capturedMiscDataProps: JSONObject | null = null;

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
        model: BaseModel;
        modelType: typeof BaseModel;
        miscDataProps?: JSONObject | undefined;
      }): Promise<{ data: JSONObject }> => {
        capturedPayload = JSON.parse(
          JSON.stringify(BaseModel.toJSON(data.model, data.modelType)),
        ) as JSONObject;
        capturedMiscDataProps = data.miscDataProps || {};
        return { data: {} };
      },
    },
  };
});

import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PublicNoteSubscriberNotificationDefault from "../../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";

const NOTIFY_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";
const STATE_CHANGE_NOTIFY_FIELD: string =
  "shouldStatusPageSubscribersBeNotified";
const NOTE_PLACEHOLDER: string = "Write a public note";
const NOTE_TEXT: string =
  "The failover drill has started. Writes may pause for a few seconds.";
const CHECKBOX_TITLE: string = "Notify Status Page Subscribers";
const NOTIFYING_DESCRIPTION: string =
  "Should status page subscribers be notified?";
const STATE_CHANGE_NOTIFYING_DESCRIPTION: string =
  "Notify subscribers of this state change.";

interface RenderOptions {
  notifyByDefault: boolean;
  seedInitialValue: boolean;
}

/*
 * The shape the dashboard's public note forms use: a note, and the notify
 * checkbox whose default and description follow the event.
 */
async function renderNoteForm(options: RenderOptions): Promise<void> {
  const fields: Fields<ScheduledMaintenancePublicNote> = [
    {
      field: { note: true },
      title: "Public Scheduled Maintenance Note",
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      placeholder: NOTE_PLACEHOLDER,
    },
    {
      field: { shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true },
      title: CHECKBOX_TITLE,
      description: options.notifyByDefault
        ? NOTIFYING_DESCRIPTION
        : PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
      fieldType: FormFieldSchemaType.Checkbox,
      defaultValue: options.notifyByDefault,
      required: false,
    },
  ];

  const initialValues: FormValues<ScheduledMaintenancePublicNote> | undefined =
    options.seedInitialValue
      ? {
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
            options.notifyByDefault,
        }
      : undefined;

  await act(async (): Promise<void> => {
    render(
      <ModelForm<ScheduledMaintenancePublicNote>
        modelType={ScheduledMaintenancePublicNote}
        id="scheduled-maintenance-public-note-form"
        name="Scheduled Maintenance > Public Note"
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

/*
 * The shape of the header's state change form: an optional public note
 * (sent alongside the timeline, not as a column of it) and the notify
 * checkbox that governs both the state change and that note.
 */
async function renderStateChangeForm(options: RenderOptions): Promise<void> {
  const fields: Fields<ScheduledMaintenanceStateTimeline> = [
    {
      field: {
        publicNote: true,
      } as any,
      fieldType: FormFieldSchemaType.LongText,
      title: "Public Note",
      required: false,
      placeholder: NOTE_PLACEHOLDER,
      overrideFieldKey: "publicNote",
      showEvenIfPermissionDoesNotExist: true,
    },
    {
      field: { shouldStatusPageSubscribersBeNotified: true },
      title: CHECKBOX_TITLE,
      description: options.notifyByDefault
        ? STATE_CHANGE_NOTIFYING_DESCRIPTION
        : PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
      fieldType: FormFieldSchemaType.Checkbox,
      defaultValue: options.notifyByDefault,
      required: false,
    },
  ];

  const initialValues:
    | FormValues<ScheduledMaintenanceStateTimeline>
    | undefined = options.seedInitialValue
    ? {
        shouldStatusPageSubscribersBeNotified: options.notifyByDefault,
      }
    : undefined;

  await act(async (): Promise<void> => {
    render(
      <ModelForm<ScheduledMaintenanceStateTimeline>
        modelType={ScheduledMaintenanceStateTimeline}
        id="scheduled-maintenance-state-change-form"
        name="Scheduled Maintenance > State Change"
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
  capturedMiscDataProps = null;
});

describe("public note form on an event created without notifying subscribers", () => {
  test("starts with the box unticked and explains why", async () => {
    await renderNoteForm({ notifyByDefault: false, seedInitialValue: true });

    expect(notifyCheckbox()).not.toBeChecked();
    expect(
      screen.getByText(
        PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
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

describe("public note form on an event that notified subscribers", () => {
  test("starts with the box ticked and the usual description", async () => {
    await renderNoteForm({ notifyByDefault: true, seedInitialValue: true });

    expect(notifyCheckbox()).toBeChecked();
    expect(screen.getByText(NOTIFYING_DESCRIPTION)).toBeInTheDocument();
    expect(
      screen.queryByText(
        PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
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

describe("state change form on an event created without notifying subscribers", () => {
  test("starts with the box unticked and explains why", async () => {
    await renderStateChangeForm({
      notifyByDefault: false,
      seedInitialValue: true,
    });

    expect(notifyCheckbox()).not.toBeChecked();
    expect(
      screen.getByText(
        PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(STATE_CHANGE_NOTIFYING_DESCRIPTION)).toBeNull();
  });

  test("sends an explicit false with the public note when the box is left unticked", async () => {
    await renderStateChangeForm({
      notifyByDefault: false,
      seedInitialValue: true,
    });

    await writeNote();
    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).toContain(STATE_CHANGE_NOTIFY_FIELD);
    expect(payload[STATE_CHANGE_NOTIFY_FIELD]).toBe(false);
    // The note travels beside the timeline row, not inside it.
    expect(capturedMiscDataProps?.["publicNote"]).toBe(NOTE_TEXT);
    expect(payload["publicNote"]).toBeUndefined();
  });

  test("sends true when the user ticks the box", async () => {
    await renderStateChangeForm({
      notifyByDefault: false,
      seedInitialValue: true,
    });

    await toggleNotify();

    expect(notifyCheckbox()).toBeChecked();

    const payload: JSONObject = await submit();

    expect(payload[STATE_CHANGE_NOTIFY_FIELD]).toBe(true);
  });
});

describe("state change form on an event that notified subscribers", () => {
  test("starts with the box ticked and sends true", async () => {
    await renderStateChangeForm({
      notifyByDefault: true,
      seedInitialValue: true,
    });

    expect(notifyCheckbox()).toBeChecked();
    expect(
      screen.getByText(STATE_CHANGE_NOTIFYING_DESCRIPTION),
    ).toBeInTheDocument();

    const payload: JSONObject = await submit();

    expect(payload[STATE_CHANGE_NOTIFY_FIELD]).toBe(true);
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

  test("on the state change form, a false default alone sends no flag, and the column default would notify", async () => {
    await renderStateChangeForm({
      notifyByDefault: false,
      seedInitialValue: false,
    });

    expect(notifyCheckbox()).not.toBeChecked();

    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).not.toContain(STATE_CHANGE_NOTIFY_FIELD);
  });

  test("a true default alone is applied and sent", async () => {
    await renderNoteForm({ notifyByDefault: true, seedInitialValue: false });

    expect(notifyCheckbox()).toBeChecked();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD]).toBe(true);
  });
});
