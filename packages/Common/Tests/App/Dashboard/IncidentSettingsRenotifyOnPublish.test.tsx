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
import React, { ReactElement } from "react";

/*
 * The incident's Settings tab: turning 'Visible on Status Page' on for an
 * incident that was declared hidden offers "Notify subscribers that this
 * incident was created" (see IncidentCreatedRenotify).
 *
 * Two halves:
 *   - the page decides whether to offer the box at all, and whether it starts
 *     ticked, from the incident the settings card loaded (the card itself is
 *     stubbed and its props recorded);
 *   - the box, inside the real ModelForm, only shows while the form makes the
 *     incident visible, and reaches the server as a misc data prop - never as
 *     a column - only while ticked.
 */

const recordedCards: Array<Record<string, unknown>> = [];
let loadedIncident: unknown = null;
let savedRequests: Array<{
  model: unknown;
  miscDataProps: Record<string, unknown> | undefined;
}> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCards.push(props);
      return React.createElement("div", {
        "data-testid": `stub-card-${props["name"] as string}`,
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Reminders/NextReminderCountdown",
  () => {
    return {
      __esModule: true,
      ReminderRuleScope: { Incident: "Incident" },
      default: (): ReactElement => {
        return React.createElement("div");
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        return loadedIncident;
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): Record<string, unknown> => {
        return {};
      },
      createOrUpdate: async (request: {
        model: unknown;
        miscDataProps?: Record<string, unknown>;
      }): Promise<{ data: Record<string, unknown> }> => {
        savedRequests.push({
          model: request.model,
          miscDataProps: request.miscDataProps,
        });
        return { data: {} };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["IncidentMember"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["IncidentMember"] };
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

jest.mock("../../../UI/Utils/Translation", () => {
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

import IncidentSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Settings";
import {
  getIncidentCreatedRenotifyFormField,
  isPublishingIncident,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCreatedRenotifyFormField";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Navigation from "../../../UI/Utils/Navigation";

const INCIDENT_ID: string = "11111111-1111-4111-8111-111111111111";

const pageProps: PageComponentProps = {
  pageRoute: new Route("/settings"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface IncidentShape {
  isVisibleOnStatusPage?: boolean | undefined;
  isPrivate?: boolean | undefined;
  status?: StatusPageSubscriberNotificationStatus | undefined;
  notifyOnCreate?: boolean | undefined;
  isResolved?: boolean | undefined;
}

// A hidden incident whose 'created' notification the worker skipped.
function buildIncident(shape: IncidentShape = {}): Incident {
  const incident: Incident = new Incident();
  incident.id = new ObjectID(INCIDENT_ID);
  incident.isVisibleOnStatusPage = shape.isVisibleOnStatusPage ?? false;
  incident.isPrivate = shape.isPrivate ?? false;
  incident.subscriberNotificationStatusOnIncidentCreated =
    shape.status ?? StatusPageSubscriberNotificationStatus.Skipped;
  incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
    shape.notifyOnCreate ?? true;

  const state: IncidentState = new IncidentState();
  state.isResolvedState = shape.isResolved ?? false;
  incident.currentIncidentState = state;

  return incident;
}

interface SettingsCardProps {
  formFields: Fields<Incident>;
  modelDetailProps: {
    selectMoreFields?: Record<string, unknown>;
    onItemLoaded?: (item: Incident) => void;
    modelId: ObjectID;
  };
}

function settingsCard(): SettingsCardProps {
  const cards: Array<Record<string, unknown>> = recordedCards.filter(
    (props: Record<string, unknown>): boolean => {
      return props["name"] === "Incident Settings";
    },
  );

  expect(cards.length).toBeGreaterThan(0);
  return cards[cards.length - 1] as unknown as SettingsCardProps;
}

function fieldKeys(fields: Fields<Incident>): Array<string> {
  return fields.map((field: Fields<Incident>[number]): string => {
    return (
      field.overrideFieldKey || Object.keys(field.field || {})[0] || "unknown"
    );
  });
}

function renotifyField(): Fields<Incident>[number] | undefined {
  return settingsCard().formFields.find(
    (field: Fields<Incident>[number]): boolean => {
      return field.overrideFieldKey === IncidentCreatedRenotify.miscDataKey;
    },
  );
}

async function renderSettings(): Promise<void> {
  await act(async (): Promise<void> => {
    render(<IncidentSettings {...pageProps} />);
  });
}

async function loadIncident(shape: IncidentShape = {}): Promise<void> {
  await act(async (): Promise<void> => {
    settingsCard().modelDetailProps.onItemLoaded!(buildIncident(shape));
  });
}

beforeEach(() => {
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(INCIDENT_ID);
    });
});

afterEach(() => {
  cleanup();
  recordedCards.length = 0;
  loadedIncident = null;
  savedRequests = [];
  jest.restoreAllMocks();
});

describe("incident Settings tab: offering to notify subscribers on publish", () => {
  test("reads what the decision needs with the settings card's own item", async () => {
    await renderSettings();

    expect(settingsCard().modelDetailProps.selectMoreFields).toEqual(
      expect.objectContaining({
        subscriberNotificationStatusOnIncidentCreated: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        currentIncidentState: { isResolvedState: true },
      }),
    );
    expect(settingsCard().modelDetailProps.modelId.toString()).toBe(
      INCIDENT_ID,
    );
  });

  test("does not offer the box before the incident has loaded", async () => {
    await renderSettings();

    expect(fieldKeys(settingsCard().formFields)).toEqual([
      "isVisibleOnStatusPage",
      "isPrivate",
    ]);
  });

  test("offers it, ticked, for a hidden unresolved incident whose notification was skipped", async () => {
    await renderSettings();
    await loadIncident();

    expect(fieldKeys(settingsCard().formFields)).toEqual([
      "isVisibleOnStatusPage",
      IncidentCreatedRenotify.miscDataKey,
      "isPrivate",
    ]);
    expect(renotifyField()!.defaultValue).toBe(true);
    expect(renotifyField()!.title).toBe(IncidentCreatedRenotify.formFieldTitle);
  });

  test("offers it unticked for a resolved incident", async () => {
    await renderSettings();
    await loadIncident({ isResolved: true });

    expect(renotifyField()).toBeDefined();
    expect(renotifyField()!.defaultValue).toBe(false);
  });

  test.each([
    [
      "the incident is already visible",
      { isVisibleOnStatusPage: true } as IncidentShape,
    ],
    ["the incident is private", { isPrivate: true } as IncidentShape],
    [
      "notifying subscribers on creation is off",
      { notifyOnCreate: false } as IncidentShape,
    ],
    [
      "the notification was already sent",
      {
        status: StatusPageSubscriberNotificationStatus.Success,
      } as IncidentShape,
    ],
    [
      "the notification failed (it has its own Retry)",
      {
        status: StatusPageSubscriberNotificationStatus.Failed,
      } as IncidentShape,
    ],
    [
      "the notification is still pending",
      {
        status: StatusPageSubscriberNotificationStatus.Pending,
      } as IncidentShape,
    ],
    [
      "the notification is being sent",
      {
        status: StatusPageSubscriberNotificationStatus.InProgress,
      } as IncidentShape,
    ],
  ])(
    "does not offer it when %s",
    async (_label: string, shape: IncidentShape) => {
      await renderSettings();
      await loadIncident(shape);

      expect(renotifyField()).toBeUndefined();
      expect(fieldKeys(settingsCard().formFields)).toEqual([
        "isVisibleOnStatusPage",
        "isPrivate",
      ]);
    },
  );

  test("withdraws the offer once a save has queued the notification", async () => {
    await renderSettings();
    await loadIncident();
    expect(renotifyField()).toBeDefined();

    // The card reloads its item after every save.
    await loadIncident({
      isVisibleOnStatusPage: true,
      status: StatusPageSubscriberNotificationStatus.Pending,
    });

    expect(renotifyField()).toBeUndefined();
  });

  test("keeps the same field list between renders that change nothing", async () => {
    await renderSettings();
    await loadIncident();
    const before: Fields<Incident> = settingsCard().formFields;

    await loadIncident();

    // ModelForm rebuilds its fields whenever this array changes identity.
    expect(settingsCard().formFields).toBe(before);
  });
});

describe("the notify-on-publish field", () => {
  const field: ModelField<Incident> = getIncidentCreatedRenotifyFormField({
    tickedByDefault: true,
  });

  test("is sent as the misc data prop the server reads, not as a column", () => {
    expect(field.overrideFieldKey).toBe(IncidentCreatedRenotify.miscDataKey);
    expect(field.overrideField).toEqual({
      [IncidentCreatedRenotify.miscDataKey]: true,
    });
    expect(field.field).toBeUndefined();
    expect(new Incident().getTableColumns().columns).not.toContain(
      IncidentCreatedRenotify.miscDataKey,
    );
  });

  test("is an optional checkbox shown on edit only, without a column permission to check", () => {
    expect(field.fieldType).toBe(FormFieldSchemaType.Checkbox);
    expect(field.required).toBe(false);
    expect(field.doNotShowWhenCreating).toBe(true);
    expect(field.showEvenIfPermissionDoesNotExist).toBe(true);
    expect(field.description).toBe(
      IncidentCreatedRenotify.formFieldDescription,
    );
  });

  test("starts as the caller says", () => {
    expect(field.defaultValue).toBe(true);
    expect(
      getIncidentCreatedRenotifyFormField({ tickedByDefault: false })
        .defaultValue,
    ).toBe(false);
  });

  test("returns a new object each call, so one form cannot change another's field", () => {
    const first: ModelField<Incident> = getIncidentCreatedRenotifyFormField({
      tickedByDefault: true,
    });
    const second: ModelField<Incident> = getIncidentCreatedRenotifyFormField({
      tickedByDefault: true,
    });

    expect(first).not.toBe(second);
    expect(first.overrideField).not.toBe(second.overrideField);
  });

  test.each([
    [{ isVisibleOnStatusPage: true, isPrivate: false }, true],
    [{ isVisibleOnStatusPage: true }, true],
    [{ isVisibleOnStatusPage: false, isPrivate: false }, false],
    [{ isVisibleOnStatusPage: true, isPrivate: true }, false],
    [{}, false],
  ] as Array<[Record<string, unknown>, boolean]>)(
    "shows for form values %j: %s",
    (values: Record<string, unknown>, shown: boolean) => {
      expect(isPublishingIncident(values as FormValues<Incident>)).toBe(shown);
      expect(field.showIf!(values as FormValues<Incident>)).toBe(shown);
    },
  );
});

/*
 * The field inside the real ModelForm, editing an incident loaded as hidden.
 * The form fields mirror the Settings card's.
 */
describe("the notify-on-publish box in the edit form", () => {
  function formFields(tickedByDefault: boolean): Fields<Incident> {
    return [
      {
        field: { isVisibleOnStatusPage: true },
        title: "Visible on Status Page",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      getIncidentCreatedRenotifyFormField({ tickedByDefault }),
      {
        field: { isPrivate: true },
        title: "Private Incident",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
    ];
  }

  async function renderForm(tickedByDefault: boolean): Promise<void> {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(INCIDENT_ID);
    incident.isVisibleOnStatusPage = false;
    incident.isPrivate = false;
    loadedIncident = incident;

    await act(async (): Promise<void> => {
      render(
        <ModelForm<Incident>
          id="incident-settings-form"
          name="Incident Settings"
          modelType={Incident}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(INCIDENT_ID)}
          fields={formFields(tickedByDefault)}
          submitButtonText="Save"
        />,
      );
    });

    await screen.findAllByRole("switch");
  }

  function switches(): Array<HTMLElement> {
    return screen.getAllByRole("switch");
  }

  // The toggles in field order: visibility first, then private.
  async function flip(index: number): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.click(switches()[index]!);
    });
  }

  function renotifyCheckbox(): HTMLInputElement | null {
    return screen.queryByRole("checkbox", {
      name: new RegExp(IncidentCreatedRenotify.formFieldTitle),
    }) as HTMLInputElement | null;
  }

  async function toggleRenotify(): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.click(renotifyCheckbox()!);
    });
  }

  async function save(): Promise<{
    model: Record<string, unknown>;
    miscDataProps: Record<string, unknown>;
  }> {
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(savedRequests).toHaveLength(1);
    });

    return {
      model: savedRequests[0]!.model as Record<string, unknown>,
      miscDataProps: savedRequests[0]!.miscDataProps || {},
    };
  }

  test("is hidden until 'Visible on Status Page' is switched on, then shows ticked", async () => {
    await renderForm(true);

    expect(renotifyCheckbox()).toBeNull();

    await flip(0);

    expect(renotifyCheckbox()).not.toBeNull();
    expect(renotifyCheckbox()).toBeChecked();
  });

  test("publishing with the box ticked asks the server to notify subscribers", async () => {
    await renderForm(true);
    await flip(0);

    const { model, miscDataProps } = await save();

    expect(model["isVisibleOnStatusPage"]).toBe(true);
    expect(miscDataProps).toEqual({
      [IncidentCreatedRenotify.miscDataKey]: true,
    });
    // Never written as a column.
    expect(model[IncidentCreatedRenotify.miscDataKey]).toBeUndefined();
  });

  test("publishing with the box unticked asks for nothing", async () => {
    await renderForm(true);
    await flip(0);
    await toggleRenotify();

    expect(renotifyCheckbox()).not.toBeChecked();

    const { model, miscDataProps } = await save();

    expect(model["isVisibleOnStatusPage"]).toBe(true);
    expect(miscDataProps[IncidentCreatedRenotify.miscDataKey]).toBeUndefined();
  });

  test("for a resolved incident the box starts unticked, and ticking it asks", async () => {
    await renderForm(false);
    await flip(0);

    expect(renotifyCheckbox()).not.toBeChecked();

    await toggleRenotify();

    const { miscDataProps } = await save();

    expect(miscDataProps[IncidentCreatedRenotify.miscDataKey]).toBe(true);
  });

  test("a resolved incident published without ticking the box asks for nothing", async () => {
    await renderForm(false);
    await flip(0);

    const { model, miscDataProps } = await save();

    expect(model["isVisibleOnStatusPage"]).toBe(true);
    expect(miscDataProps[IncidentCreatedRenotify.miscDataKey]).toBeUndefined();
  });

  test("making the incident private hides the box again", async () => {
    await renderForm(true);
    await flip(0);
    expect(renotifyCheckbox()).not.toBeNull();

    await flip(1);

    expect(renotifyCheckbox()).toBeNull();
  });

  test("saving without publishing keeps the incident hidden, so the server has nothing to send", async () => {
    await renderForm(true);

    const { model } = await save();

    /*
     * The box's default may still travel as a misc data prop, but the server
     * acts on it only together with isVisibleOnStatusPage: true (see
     * IncidentCreatedRenotifyOnPublish.test.ts).
     */
    expect(model["isVisibleOnStatusPage"]).toBe(false);
  });
});
