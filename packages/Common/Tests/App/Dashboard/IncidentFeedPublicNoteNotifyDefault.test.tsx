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
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident declared without notifying status page subscribers (the box
 * unticked, or a private incident) should not have its first public note be
 * what tells them. The feed's "Add Public Note" form now starts with
 * "Notify Status Page Subscribers" off for such an incident. The flag is
 * seeded through initialValues as well as the field's defaultValue, because
 * the form drops a false defaultValue, and the request should carry what the
 * user saw rather than leave the choice to the server. These tests pin both,
 * the checkbox copy, and that nothing changes for an incident that did
 * notify.
 */

const getListMock: MockFunction = getJestMockFunction();
const modalRenderMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

/* Keep the test about the note forms, not markdown parsing or timeline chrome. */
jest.mock("../../../UI/Components/Feed/Feed", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "rendered-feed" });
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: { title: string }): React.ReactElement => {
      modalRenderMock(props);
      return React.createElement(
        "div",
        { "data-testid": "note-modal" },
        props.title,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import IncidentFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

interface NoteField {
  field: Record<string, boolean>;
  fieldType: FormFieldSchemaType;
  title: string;
  description?: string | undefined;
  defaultValue?: unknown;
  required?: boolean | undefined;
}

interface NoteModalProps {
  name: string;
  title: string;
  modelType: unknown;
  initialValues?: Record<string, unknown> | undefined;
  onBeforeCreate: (model: unknown) => Promise<unknown>;
  formProps: {
    fields: Array<NoteField>;
  };
}

const INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";
const NOTIFY_FIELD_KEY: string =
  "shouldStatusPageSubscribersBeNotifiedOnNoteCreated";
const ORIGINAL_DESCRIPTION: string =
  "Should status page subscribers be notified when this note is posted?";
const PUBLIC_NOTE_TITLE: string = "Add Public Note to this Incident";
const PRIVATE_NOTE_TITLE: string = "Add Private Note to this Incident";

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function renderFeed(
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
): RenderResult {
  return render(
    <IncidentFeedElement
      incidentId={new ObjectID(INCIDENT_ID)}
      refreshToken={0}
      notifyStatusPageSubscribersByDefault={
        notifyStatusPageSubscribersByDefault
      }
    />,
  );
}

function lastModalProps(): NoteModalProps {
  const calls: Array<Array<NoteModalProps>> = modalRenderMock.mock
    .calls as Array<Array<NoteModalProps>>;

  return calls[calls.length - 1]![0]!;
}

function modalPropsWithTitle(title: string): NoteModalProps {
  const calls: Array<Array<NoteModalProps>> = modalRenderMock.mock
    .calls as Array<Array<NoteModalProps>>;

  const matching: Array<NoteModalProps> = calls
    .map((call: Array<NoteModalProps>): NoteModalProps => {
      return call[0]!;
    })
    .filter((props: NoteModalProps): boolean => {
      return props.title === title;
    });

  if (matching.length === 0) {
    throw new Error(`No modal titled "${title}" was rendered`);
  }

  return matching[matching.length - 1]!;
}

function notifyField(props: NoteModalProps): NoteField {
  const field: NoteField | undefined = props.formProps.fields.find(
    (candidate: NoteField): boolean => {
      return Boolean(candidate.field[NOTIFY_FIELD_KEY]);
    },
  );

  if (!field) {
    throw new Error("The public note form has no notify subscribers field");
  }

  return field;
}

async function chooseAction(text: string): Promise<void> {
  const trigger: HTMLElement = screen
    .getByText("Actions")
    .closest('[aria-haspopup="menu"]') as HTMLElement;

  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: text }));
  await flush();
}

async function openPublicNoteModal(
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
): Promise<NoteModalProps> {
  renderFeed(notifyStatusPageSubscribersByDefault);
  await flush();
  await chooseAction("Add Public Note");

  return modalPropsWithTitle(PUBLIC_NOTE_TITLE);
}

beforeEach(() => {
  window.localStorage.clear();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: DEFAULT_LIMIT,
  } as never);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  modalRenderMock.mockReset();
});

describe("IncidentFeed public note: incident declared without notifying subscribers", () => {
  test("seeds the form value with notify off, so a false flag is actually sent", async () => {
    const props: NoteModalProps = await openPublicNoteModal(false);

    expect(props.modelType).toBe(IncidentPublicNote);
    expect(props.name).toBe("create-incident-public-note");
    expect(props.initialValues).toEqual({
      [NOTIFY_FIELD_KEY]: false,
    });
    expect(props.initialValues![NOTIFY_FIELD_KEY]).toBe(false);
  });

  test("starts the notify checkbox unticked", async () => {
    const field: NoteField = notifyField(await openPublicNoteModal(false));

    expect(field.fieldType).toBe(FormFieldSchemaType.Checkbox);
    expect(field.title).toBe("Notify Status Page Subscribers");
    expect(field.required).toBe(false);
    expect(field.defaultValue).toBe(false);
  });

  test("explains why the checkbox starts unticked", async () => {
    const field: NoteField = notifyField(await openPublicNoteModal(false));

    expect(field.description).toBe(
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    );
    expect(field.description).toBe(
      "Unticked by default because status page subscribers were not notified when this incident was declared.",
    );
    expect(field.description).not.toBe(ORIGINAL_DESCRIPTION);
  });

  test("leaves the other public note fields as they were", async () => {
    const props: NoteModalProps = await openPublicNoteModal(false);

    expect(
      props.formProps.fields.map((field: NoteField): string => {
        return field.title;
      }),
    ).toEqual([
      "Public Note",
      "Attachments",
      "Posted At",
      "Notify Status Page Subscribers",
    ]);
    expect(props.formProps.fields[0]!.required).toBe(true);
    expect(props.formProps.fields[0]!.fieldType).toBe(
      FormFieldSchemaType.Markdown,
    );
  });

  test("still attaches the note to this incident before it is created", async () => {
    const props: NoteModalProps = await openPublicNoteModal(false);
    const note: IncidentPublicNote = new IncidentPublicNote();

    const created: IncidentPublicNote = (await props.onBeforeCreate(
      note,
    )) as IncidentPublicNote;

    expect(created).toBe(note);
    expect(created.incidentId?.toString()).toBe(INCIDENT_ID);
    // The form's own choice is not overridden on the way out.
    expect(created.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      undefined,
    );
  });

  test("onBeforeCreate never rewrites a flag the user set", async () => {
    const props: NoteModalProps = await openPublicNoteModal(false);
    const note: IncidentPublicNote = new IncidentPublicNote();
    note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated = true;

    const created: IncidentPublicNote = (await props.onBeforeCreate(
      note,
    )) as IncidentPublicNote;

    expect(created.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(created.incidentId?.toString()).toBe(INCIDENT_ID);
  });
});

describe("IncidentFeed public note: incident declared with subscribers notified", () => {
  test("seeds the form value with notify on", async () => {
    const props: NoteModalProps = await openPublicNoteModal(true);

    expect(props.initialValues).toEqual({
      [NOTIFY_FIELD_KEY]: true,
    });
  });

  test("starts the checkbox ticked with the original description", async () => {
    const field: NoteField = notifyField(await openPublicNoteModal(true));

    expect(field.defaultValue).toBe(true);
    expect(field.description).toBe(ORIGINAL_DESCRIPTION);
    expect(field.description).not.toBe(
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    );
  });

  test("attaches the note to this incident before it is created", async () => {
    const props: NoteModalProps = await openPublicNoteModal(true);

    const created: IncidentPublicNote = (await props.onBeforeCreate(
      new IncidentPublicNote(),
    )) as IncidentPublicNote;

    expect(created.incidentId?.toString()).toBe(INCIDENT_ID);
  });
});

describe("IncidentFeed public note: no default passed (backwards compatible)", () => {
  test("seeds the form value with notify on", async () => {
    const props: NoteModalProps = await openPublicNoteModal(undefined);

    expect(props.initialValues).toEqual({
      [NOTIFY_FIELD_KEY]: true,
    });
  });

  test("starts the checkbox ticked with the original description", async () => {
    const field: NoteField = notifyField(await openPublicNoteModal(undefined));

    expect(field.defaultValue).toBe(true);
    expect(field.description).toBe(ORIGINAL_DESCRIPTION);
  });

  test("a feed rendered without the prop at all behaves the same", async () => {
    render(<IncidentFeedElement incidentId={new ObjectID(INCIDENT_ID)} />);
    await flush();
    await chooseAction("Add Public Note");

    const props: NoteModalProps = modalPropsWithTitle(PUBLIC_NOTE_TITLE);

    expect(props.initialValues).toEqual({ [NOTIFY_FIELD_KEY]: true });
    expect(notifyField(props).defaultValue).toBe(true);
    expect(notifyField(props).description).toBe(ORIGINAL_DESCRIPTION);
  });
});

describe("IncidentFeed public note: the default follows the page", () => {
  /*
   * The page passes the flag once the incident has loaded, and again after a
   * refresh. The next form opened must use the current value.
   */
  test("a form opened after the default turns off starts unticked", async () => {
    const view: RenderResult = renderFeed(true);
    await flush();

    view.rerender(
      <IncidentFeedElement
        incidentId={new ObjectID(INCIDENT_ID)}
        refreshToken={0}
        notifyStatusPageSubscribersByDefault={false}
      />,
    );
    await flush();
    await chooseAction("Add Public Note");

    const props: NoteModalProps = modalPropsWithTitle(PUBLIC_NOTE_TITLE);

    expect(props.initialValues).toEqual({ [NOTIFY_FIELD_KEY]: false });
    expect(notifyField(props).defaultValue).toBe(false);
    expect(notifyField(props).description).toBe(
      PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
    );
  });

  test("a form opened after the default turns back on starts ticked", async () => {
    const view: RenderResult = renderFeed(false);
    await flush();

    view.rerender(
      <IncidentFeedElement
        incidentId={new ObjectID(INCIDENT_ID)}
        refreshToken={0}
        notifyStatusPageSubscribersByDefault={true}
      />,
    );
    await flush();
    await chooseAction("Add Public Note");

    const props: NoteModalProps = modalPropsWithTitle(PUBLIC_NOTE_TITLE);

    expect(props.initialValues).toEqual({ [NOTIFY_FIELD_KEY]: true });
    expect(notifyField(props).defaultValue).toBe(true);
    expect(notifyField(props).description).toBe(ORIGINAL_DESCRIPTION);
  });
});

describe("IncidentFeed private note is unaffected", () => {
  test.each([
    ["off", false],
    ["on", true],
    ["not passed", undefined],
  ])(
    "with the default %s, the private note form seeds no notify value and has no notify field",
    async (_label: string, notifyByDefault: boolean | undefined) => {
      renderFeed(notifyByDefault);
      await flush();
      await chooseAction("Add Private Note");

      const props: NoteModalProps = lastModalProps();

      expect(props.title).toBe(PRIVATE_NOTE_TITLE);
      expect(props.modelType).toBe(IncidentInternalNote);
      expect(props.initialValues).toBeUndefined();
      expect(
        props.formProps.fields.some((field: NoteField): boolean => {
          return Boolean(field.field[NOTIFY_FIELD_KEY]);
        }),
      ).toBe(false);
      expect(screen.queryByText(PUBLIC_NOTE_TITLE)).toBeNull();
    },
  );

  test("the private note is still attached to this incident", async () => {
    renderFeed(false);
    await flush();
    await chooseAction("Add Private Note");

    const props: NoteModalProps = modalPropsWithTitle(PRIVATE_NOTE_TITLE);

    const created: IncidentInternalNote = (await props.onBeforeCreate(
      new IncidentInternalNote(),
    )) as IncidentInternalNote;

    expect(created.incidentId?.toString()).toBe(INCIDENT_ID);
  });

  test("the on-call policy form seeds no notify value either", async () => {
    renderFeed(false);
    await flush();
    await chooseAction("Execute On-Call Policy");

    const props: NoteModalProps = lastModalProps();

    expect(props.title).toBe("Execute On-Call Policy");
    expect(props.initialValues).toBeUndefined();
  });
});
