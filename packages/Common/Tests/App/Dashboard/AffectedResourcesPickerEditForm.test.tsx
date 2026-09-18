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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The bug as the user met it: open an incident, click Edit on the Affected
 * Resources card, and the attached monitor reads "MONITOR Unnamed Monitor".
 *
 * Rendered here through the real ModelForm and the real picker, wired the way
 * the incident page wires them. ModelForm loads the incident with
 * `monitors: true`, which the server answers with `{ _id }` per monitor, and
 * then flattens the relation to bare ID strings before the picker ever sees
 * it - so the picker has to find the names itself.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import AffectedResourcesPicker, {
  isAffectedResourcesPayload,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import { CustomElementProps } from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";

const INCIDENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_NAME: string = "Production Website";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const HOST_NAME: string = "web-01";
const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const SERVICE_NAME: string = "checkout-api";

type ModelClass = { new (): BaseModel };

const NAMES: Map<ModelClass, Record<string, string>> = new Map<
  ModelClass,
  Record<string, string>
>([
  [Monitor, { [MONITOR_ID]: MONITOR_NAME }],
  [Host, { [HOST_ID]: HOST_NAME }],
  [Service, { [SERVICE_ID]: SERVICE_NAME }],
]);

let capturedGetItemSelect: Record<string, unknown> | null = null;

/*
 * What the API answers for the edit form's load: each relation selected as
 * `true` comes back as `{ _id }` only.
 */
const incidentAsLoadedByTheEditForm: () => Incident = (): Incident => {
  return BaseModel.fromJSON(
    {
      _id: INCIDENT_ID.toString(),
      monitors: [{ _id: MONITOR_ID }],
      hosts: [{ _id: HOST_ID }],
      services: [{ _id: SERVICE_ID }],
    },
    Incident,
  ) as Incident;
};

const hiddenField: (key: "hosts" | "services") => ModelField<Incident> = (
  key: "hosts" | "services",
): ModelField<Incident> => {
  return {
    field: { [key]: true } as ModelField<Incident>["field"],
    title: "",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    showIf: () => {
      return false;
    },
  };
};

/*
 * The incident page's Affected Resources edit fields, trimmed to the types
 * this test attaches: the picker as a custom component on `monitors`, the
 * page-level onChange that splits the picker's payload back into the form,
 * and hidden registrations so the other relations are loaded and saved.
 */
const AFFECTED_RESOURCE_FIELDS: Array<ModelField<Incident>> = [
  {
    field: { monitors: true },
    title: "",
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    getCustomElement: (
      values: FormValues<Incident>,
      elementProps: CustomElementProps,
    ): ReactElement => {
      return (
        <AffectedResourcesPicker
          monitors={values.monitors as Array<Monitor>}
          hosts={values.hosts as Array<Host>}
          services={values.services as Array<Service>}
          resourceTypes={["Monitor", "Host", "Service"]}
          onChange={(payload: unknown) => {
            elementProps.onChange?.(payload);
          }}
        />
      );
    },
    onChange: (
      value: unknown,
      currentValues: FormValues<Incident>,
      setNewFormValues: (values: FormValues<Incident>) => void,
    ) => {
      if (isAffectedResourcesPayload(value)) {
        const payload: typeof value = value;
        queueMicrotask(() => {
          setNewFormValues({
            ...currentValues,
            monitors: payload.monitors,
            hosts: payload.hosts,
            services: payload.services,
          } as FormValues<Incident>);
        });
      }
    },
  },
  hiddenField("hosts"),
  hiddenField("services"),
];

const renderEditForm: () => void = (): void => {
  render(
    <ModelForm<Incident>
      modelType={Incident}
      id="edit-incident-affected-resources"
      name="Edit Incident"
      fields={AFFECTED_RESOURCE_FIELDS}
      formType={FormType.Update}
      modelIdToEdit={INCIDENT_ID}
      submitButtonText="Save Changes"
      onSuccess={() => {
        // asserted through createOrUpdateMock
      }}
    />,
  );
};

beforeEach(() => {
  capturedGetItemSelect = null;
  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();

  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    capturedGetItemSelect = (args[0] as { select: Record<string, unknown> })
      .select;
    return incidentAsLoadedByTheEditForm();
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const { modelType, query } = args[0] as {
      modelType: ModelClass;
      query: Record<string, unknown>;
    };
    const names: Record<string, string> = NAMES.get(modelType) || {};
    const idFilter: unknown = query["_id"];
    const ids: Array<string> =
      idFilter instanceof Includes
        ? (idFilter.values as Array<string>).map((v: string) => {
            return String(v);
          })
        : Object.keys(names);
    const data: Array<BaseModel> = ids
      .filter((id: string) => {
        return names[id] !== undefined;
      })
      .map((id: string) => {
        const model: BaseModel = new modelType();
        model._id = id;
        (model as unknown as { name: string }).name = names[id]!;
        return model;
      });
    return { data, count: data.length, skip: 0, limit: 10 };
  });

  createOrUpdateMock.mockImplementation(async () => {
    return { data: new Incident(), miscData: undefined };
  });
});

afterEach(() => {
  cleanup();
});

describe("the Edit modal of an incident's Affected Resources card", () => {
  test("loads the relations the way the bug report saw them: IDs only", async () => {
    renderEditForm();

    await waitFor(() => {
      expect(capturedGetItemSelect).not.toBeNull();
    });
    // `true`, not `{ _id, name }` - the server hands back `{ _id }` for this.
    expect(capturedGetItemSelect!["monitors"]).toBe(true);
  });

  test("names the attached monitor instead of showing 'Unnamed Monitor'", async () => {
    renderEditForm();

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
    expect(screen.queryByText("Unnamed Monitor")).toBeNull();
  });

  test("names every attached resource type, not just monitors", async () => {
    renderEditForm();

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
    expect(await screen.findByText(HOST_NAME)).toBeInTheDocument();
    expect(await screen.findByText(SERVICE_NAME)).toBeInTheDocument();
    expect(screen.queryByText(/^Unnamed /)).toBeNull();
    expect(screen.queryByText(/^Unknown /)).toBeNull();
  });

  test("looks each name up by ID against its own model", async () => {
    renderEditForm();

    await screen.findByText(SERVICE_NAME);

    const lookups: Array<{ modelType: ModelClass; ids: Array<string> }> =
      getListMock.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            modelType: ModelClass;
            query: Record<string, unknown>;
          };
        })
        .filter((args: { query: Record<string, unknown> }) => {
          return args.query["_id"] instanceof Includes;
        })
        .map(
          (args: { modelType: ModelClass; query: Record<string, unknown> }) => {
            return {
              modelType: args.modelType,
              ids: (
                (args.query["_id"] as Includes).values as Array<string>
              ).map((v: string) => {
                return String(v);
              }),
            };
          },
        );

    expect(lookups).toHaveLength(3);
    expect(lookups).toEqual(
      expect.arrayContaining([
        { modelType: Monitor, ids: [MONITOR_ID] },
        { modelType: Host, ids: [HOST_ID] },
        { modelType: Service, ids: [SERVICE_ID] },
      ]),
    );
  });

  test("saving without changes keeps every attached resource", async () => {
    renderEditForm();

    await screen.findByText(MONITOR_NAME);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    const saved: Incident = (
      createOrUpdateMock.mock.calls[0]![0] as { model: Incident }
    ).model;
    const idsOf: (models: Array<BaseModel> | undefined) => Array<string> = (
      models: Array<BaseModel> | undefined,
    ): Array<string> => {
      return (models || []).map((model: BaseModel) => {
        return String(model._id);
      });
    };
    expect(idsOf(saved.monitors)).toEqual([MONITOR_ID]);
    expect(idsOf(saved.hosts)).toEqual([HOST_ID]);
    expect(idsOf(saved.services)).toEqual([SERVICE_ID]);
  });

  /*
   * Also covers the in-between render: act() flushes the form's
   * setFieldValue(monitors, <picker payload>) before the page's queued
   * splitter runs, so the picker is briefly handed a non-array and must not
   * throw on it.
   */
  test("removing the monitor in the modal saves the incident without it", async () => {
    renderEditForm();

    fireEvent.click(
      await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );
    await waitFor(() => {
      expect(screen.queryByText(MONITOR_NAME)).toBeNull();
    });
    // The other chips keep their names through the form's rewrite to IDs.
    expect(screen.getByText(HOST_NAME)).toBeInTheDocument();
    expect(screen.getByText(SERVICE_NAME)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    const saved: Incident = (
      createOrUpdateMock.mock.calls[0]![0] as { model: Incident }
    ).model;
    expect(saved.monitors || []).toEqual([]);
    expect(
      (saved.hosts || []).map((host: Host) => {
        return String(host._id);
      }),
    ).toEqual([HOST_ID]);
  });
});
