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
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";

/*
 * "Notify Status Page Subscribers" on a new incident episode public note,
 * through the real ModelForm and the real IncidentEpisodePublicNote model,
 * down to the payload that would be POSTed.
 *
 * An episode created without notifying subscribers starts this box unticked.
 * The dashboard does that by seeding the flag as an initial value as well as
 * the field's default, because BasicForm only applies a truthy default: a
 * default of false leaves the value unset and the key never reaches the
 * server. The server would then decide from the episode rather than from what
 * the user saw in the form.
 */

let capturedPayload: JSONObject | null = null;

// What the episode Public Notes page reads for its notify default.
let pageEpisode: IncidentEpisode | null = null;

interface CapturedModalProps {
  title: string;
  initialValues?: FormValues<IncidentEpisodePublicNote> | undefined;
  formProps: {
    fields: Fields<IncidentEpisodePublicNote>;
  };
}

let modalRenders: Array<CapturedModalProps> = [];

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
      getItem: async (): Promise<IncidentEpisode | null> => {
        return pageEpisode;
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
        model: IncidentEpisodePublicNote;
        modelType: typeof IncidentEpisodePublicNote;
      }): Promise<{ data: JSONObject }> => {
        capturedPayload = JSON.parse(
          JSON.stringify(BaseModel.toJSON(data.model, data.modelType)),
        ) as JSONObject;
        return { data: {} };
      },
      // The Public Notes page's composer posts through create.
      create: async (data: {
        model: IncidentEpisodePublicNote;
        modelType: typeof IncidentEpisodePublicNote;
      }): Promise<{ data: JSONObject }> => {
        capturedPayload = JSON.parse(
          JSON.stringify(BaseModel.toJSON(data.model, data.modelType)),
        ) as JSONObject;
        return { data: {} };
      },
    },
  };
});

/*
 * The feed's modal is a prop recorder here: the tests take the notify field
 * and seeded values it is handed and run those through the real ModelForm.
 * The Public Notes page is rendered for real, composer and all.
 */
jest.mock("../../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): ReactElement => {
      modalRenders.push(props);
      return <div data-testid="note-modal" />;
    },
  };
});

jest.mock("../../../../UI/Components/Feed/Feed", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="rendered-feed" />;
    },
  };
});

import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../../Models/DatabaseModels/Project";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import Navigation from "../../../../UI/Utils/Navigation";
import IncidentEpisodeFeedElement from "../../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeFeed";
import EpisodePublicNote from "../../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/PublicNote";

const EPISODE_ID: string = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID: string = "66666666-6666-4666-8666-666666666666";
const NOTIFY_FIELD: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";
const NOTE_PLACEHOLDER: string = "Write a public note";
const NOTE_TEXT: string =
  "We have identified the cause and are rolling out a fix.";
const CHECKBOX_TITLE: string = "Notify Status Page Subscribers";
const NOTIFYING_DESCRIPTION: string =
  "Should status page subscribers be notified?";
const PUBLIC_NOTE_TITLE: string = "Add Public Note to this Episode";

/*
 * A plain text note field, so the tests can type into it. The dashboard's own
 * forms use a markdown editor, which is not what is under test here.
 */
const noteField: Field<IncidentEpisodePublicNote> = {
  field: { note: true },
  title: "Public Episode Note",
  fieldType: FormFieldSchemaType.LongText,
  required: true,
  placeholder: NOTE_PLACEHOLDER,
};

interface RenderOptions {
  notifyByDefault: boolean;
  seedInitialValue: boolean;
}

async function renderForm(
  fields: Fields<IncidentEpisodePublicNote>,
  initialValues: FormValues<IncidentEpisodePublicNote> | undefined,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<IncidentEpisodePublicNote>
        modelType={IncidentEpisodePublicNote}
        id="incident-episode-public-note-form"
        name="Episode > Public Note"
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
 * The shape the dashboard's episode public note forms use: a note, and the
 * notify checkbox whose default and description follow the episode.
 */
async function renderNoteForm(options: RenderOptions): Promise<void> {
  const fields: Fields<IncidentEpisodePublicNote> = [
    noteField,
    {
      field: { shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true },
      title: CHECKBOX_TITLE,
      description: options.notifyByDefault
        ? NOTIFYING_DESCRIPTION
        : PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      fieldType: FormFieldSchemaType.Checkbox,
      defaultValue: options.notifyByDefault,
      required: false,
    },
  ];

  const initialValues: FormValues<IncidentEpisodePublicNote> | undefined =
    options.seedInitialValue
      ? {
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
            options.notifyByDefault,
        }
      : undefined;

  await renderForm(fields, initialValues);
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

function findNotifyField(
  fields: Fields<IncidentEpisodePublicNote> | undefined,
): Field<IncidentEpisodePublicNote> {
  const field: Field<IncidentEpisodePublicNote> | undefined = (
    fields || []
  ).find((candidate: Field<IncidentEpisodePublicNote>): boolean => {
    return Boolean(
      (candidate.field as Record<string, unknown> | undefined)?.[NOTIFY_FIELD],
    );
  });

  if (!field) {
    throw new Error("The form has no notify subscribers field");
  }

  return field;
}

beforeEach(() => {
  window.localStorage.clear();
  modalRenders = [];
  pageEpisode = null;
});

afterEach(() => {
  cleanup();
  capturedPayload = null;
  jest.restoreAllMocks();
});

describe("public note form on an episode created without notifying subscribers", () => {
  test("starts with the box unticked and explains why", async () => {
    await renderNoteForm({ notifyByDefault: false, seedInitialValue: true });

    expect(notifyCheckbox()).not.toBeChecked();
    expect(
      screen.getByText(
        PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
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

describe("public note form on an episode that notified subscribers", () => {
  test("starts with the box ticked and the usual description", async () => {
    await renderNoteForm({ notifyByDefault: true, seedInitialValue: true });

    expect(notifyCheckbox()).toBeChecked();
    expect(screen.getByText(NOTIFYING_DESCRIPTION)).toBeInTheDocument();
    expect(
      screen.queryByText(
        PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
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
   * seeding in the episode public note forms is no longer needed.
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

/*
 * The same round trip, but with the notify field and the seeded values the
 * dashboard itself builds: the episode feed's "Add Public Note" modal and the
 * episode Public Notes page's create form.
 */
describe("what the episode dashboard hands the form", () => {
  async function renderWithFeedWiring(
    notifyStatusPageSubscribersByDefault: boolean,
  ): Promise<void> {
    const view: RenderResult = render(
      <IncidentEpisodeFeedElement
        incidentEpisodeId={new ObjectID(EPISODE_ID)}
        notifyStatusPageSubscribersByDefault={
          notifyStatusPageSubscribersByDefault
        }
      />,
    );

    const trigger: HTMLElement = (await screen.findByText("Actions")).closest(
      '[aria-haspopup="menu"]',
    ) as HTMLElement;

    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Add Public Note" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("note-modal")).toBeInTheDocument();
    });

    const modal: CapturedModalProps = modalRenders[modalRenders.length - 1]!;

    expect(modal.title).toBe(PUBLIC_NOTE_TITLE);

    view.unmount();

    await renderForm(
      [noteField, findNotifyField(modal.formProps.fields)],
      modal.initialValues,
    );
  }

  /*
   * The Public Notes page itself: it loads the episode's notify setting, then
   * draws the notes feed, whose composer posts the note. The note is typed in
   * the real markdown editor's source mode.
   */
  async function renderWithPageWiring(
    notifyOnEpisodeCreated: boolean,
  ): Promise<void> {
    const episode: IncidentEpisode = new IncidentEpisode();
    episode._id = EPISODE_ID;
    episode.shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated =
      notifyOnEpisodeCreated;
    pageEpisode = episode;

    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockImplementation((): ObjectID => {
        return new ObjectID(EPISODE_ID);
      });

    const project: Project = new Project();
    project._id = PROJECT_ID;

    render(
      <EpisodePublicNote
        pageRoute={new Route("/dashboard/incidents/episodes/public-notes")}
        currentProject={project}
        hasPaymentMethod={true}
      />,
    );

    const prompt: HTMLElement = await screen.findByTestId(
      "note-composer-prompt",
    );

    await act(async (): Promise<void> => {
      fireEvent.click(prompt.querySelector("button")!);
    });

    await screen.findByTestId("note-composer");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTitle("Switch to markdown source"));
    });
  }

  function pageNotifyCheckbox(): HTMLInputElement {
    return screen.getByRole("checkbox", {
      name: "Notify status page subscribers",
    }) as HTMLInputElement;
  }

  async function writePageNote(): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.change(
        screen
          .getByTestId("note-composer")
          .querySelector("textarea") as HTMLTextAreaElement,
        { target: { value: NOTE_TEXT } },
      );
    });
  }

  async function submitPageNote(): Promise<JSONObject> {
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("note-submit"));
    });

    if (!capturedPayload) {
      throw new Error("The composer did not post");
    }

    return capturedPayload;
  }

  test("the feed's form on a quiet episode sends an explicit false", async () => {
    await renderWithFeedWiring(false);

    expect(notifyCheckbox()).not.toBeChecked();
    expect(
      screen.getByText(
        PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      ),
    ).toBeInTheDocument();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(Object.keys(payload)).toContain(NOTIFY_FIELD);
    expect(payload[NOTIFY_FIELD]).toBe(false);
  });

  test("the feed's form on an episode that notified sends true", async () => {
    await renderWithFeedWiring(true);

    expect(notifyCheckbox()).toBeChecked();

    await writeNote();
    const payload: JSONObject = await submit();

    expect(payload[NOTIFY_FIELD]).toBe(true);
  });

  test("the Public Notes page's composer on a quiet episode sends an explicit false", async () => {
    await renderWithPageWiring(false);

    expect(pageNotifyCheckbox()).not.toBeChecked();
    expect(
      screen.getByText(
        PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      ),
    ).toBeInTheDocument();

    await writePageNote();
    const payload: JSONObject = await submitPageNote();

    expect(payload["note"]).toBe(NOTE_TEXT);
    expect(Object.keys(payload)).toContain(NOTIFY_FIELD);
    expect(payload[NOTIFY_FIELD]).toBe(false);
    expect(payload["incidentEpisodeId"]).toMatchObject({ value: EPISODE_ID });
    expect(payload["projectId"]).toMatchObject({ value: PROJECT_ID });
  });

  test("the Public Notes page's composer on an episode that notified sends true", async () => {
    await renderWithPageWiring(true);

    expect(pageNotifyCheckbox()).toBeChecked();

    await writePageNote();
    const payload: JSONObject = await submitPageNote();

    expect(payload[NOTIFY_FIELD]).toBe(true);
  });

  test("unticking the page's box on an episode that notified sends false", async () => {
    await renderWithPageWiring(true);

    await act(async (): Promise<void> => {
      fireEvent.click(pageNotifyCheckbox());
    });
    await writePageNote();
    const payload: JSONObject = await submitPageNote();

    expect(payload[NOTIFY_FIELD]).toBe(false);
  });
});
