import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * What the Custom Fields card does with a field whose value is copied from the
 * monitor (OneUptime/oneuptime#3549).
 *
 * Two decisions are pinned here, both of which had an obvious-looking wrong
 * answer:
 *
 *   1. A mapped field is left OUT of the edit form rather than rendered
 *      disabled. `Field.disabled` is honoured by only three of the form's
 *      input branches — not the Dropdown, multi-select or toggle ones — so a
 *      "disabled" mapped dropdown would still be editable, and the value would
 *      silently snap back on the next sync.
 *
 *   2. It is only treated as mapped when the record actually HAS a monitor.
 *      SLO burn-rate alerts, security-event alerts and AI-declared incidents
 *      are created with none; making the field read-only there would take away
 *      a field the operator can fill in today and give nothing back, because
 *      the mapping can never fill it in either.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import CustomFieldsDetail from "../../../../UI/Components/CustomFields/CustomFieldsDetail";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertCustomField from "../../../../Models/DatabaseModels/AlertCustomField";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamCustomField from "../../../../Models/DatabaseModels/TeamCustomField";
import CustomFieldMappingSourceResource from "../../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ALERT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

interface SchemaFieldInput {
  name: string;
  customFieldType?: CustomFieldType | undefined;
  mapFromResourceType?: string | undefined;
  mapFromCustomFieldName?: string | undefined;
}

type BuildSchemaFunction = (
  fields: Array<SchemaFieldInput>,
) => Array<AlertCustomField>;

const buildSchema: BuildSchemaFunction = (
  fields: Array<SchemaFieldInput>,
): Array<AlertCustomField> => {
  return fields.map((field: SchemaFieldInput) => {
    return Object.assign(new AlertCustomField(), {
      customFieldType: CustomFieldType.Text,
      ...field,
    });
  });
};

type ResolveListFunction = (data: Array<BaseModel>) => void;

const resolveListWith: ResolveListFunction = (data: Array<BaseModel>): void => {
  getListMock.mockResolvedValue({
    data: data,
    count: data.length,
    skip: 0,
    limit: data.length,
  } as never);
};

type BuildAlertFunction = (data: {
  customFields: JSONObject;
  monitorId?: ObjectID | undefined;
}) => Alert;

const buildAlert: BuildAlertFunction = (data: {
  customFields: JSONObject;
  monitorId?: ObjectID | undefined;
}): Alert => {
  const alert: Alert = new Alert();
  alert.id = ALERT_ID;
  alert.customFields = data.customFields;

  if (data.monitorId) {
    alert.monitorId = data.monitorId;
  }

  return alert;
};

type RenderCardFunction = () => void;

const renderCard: RenderCardFunction = (): void => {
  render(
    <CustomFieldsDetail
      title="Custom Fields"
      description="Custom fields for this alert."
      modelType={Alert}
      customFieldType={AlertCustomField}
      name="Alert Custom Fields"
      projectId={PROJECT_ID}
      modelId={ALERT_ID}
    />,
  );
};

const MAPPED_VENDOR: SchemaFieldInput = {
  name: "Vendor",
  mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
  mapFromCustomFieldName: "Vendor",
};

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
});

describe("CustomFieldsDetail with a mapped custom field", () => {
  /*
   * The mapping metadata only reaches the browser if it is in this select.
   * Nothing else in the component would fail without it — the field would just
   * quietly behave as if it were never mapped.
   */
  test("asks the API for the mapping configuration", async () => {
    resolveListWith(buildSchema([MAPPED_VENDOR]));
    getItemMock.mockResolvedValue(
      buildAlert({ customFields: { Vendor: "Acme" }, monitorId: MONITOR_ID }),
    );

    renderCard();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    const select: JSONObject = (getListMock.mock.calls[0]![0] as JSONObject)[
      "select"
    ] as JSONObject;

    expect(select["mapFromResourceType"]).toBe(true);
    expect(select["mapFromCustomFieldName"]).toBe(true);
  });

  /*
   * Reading the alert's monitor is what lets the card tell a mapped field that
   * can be filled in from one that never will be.
   */
  test("reads the relation the mapping would inherit through", async () => {
    resolveListWith(buildSchema([MAPPED_VENDOR]));
    getItemMock.mockResolvedValue(
      buildAlert({ customFields: {}, monitorId: MONITOR_ID }),
    );

    renderCard();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    const select: JSONObject = (getItemMock.mock.calls[0]![0] as JSONObject)[
      "select"
    ] as JSONObject;

    expect(select["customFields"]).toBe(true);
    expect(select["monitorId"]).toBe(true);
  });

  test("says where an inherited value came from", async () => {
    resolveListWith(buildSchema([MAPPED_VENDOR]));
    getItemMock.mockResolvedValue(
      buildAlert({ customFields: { Vendor: "Acme" }, monitorId: MONITOR_ID }),
    );

    renderCard();

    expect(
      await screen.findByText(/Copied from the Monitor custom field "Vendor"/i),
    ).toBeInTheDocument();
  });

  test("offers no edit button when every field is inherited", async () => {
    resolveListWith(buildSchema([MAPPED_VENDOR]));
    getItemMock.mockResolvedValue(
      buildAlert({ customFields: { Vendor: "Acme" }, monitorId: MONITOR_ID }),
    );

    renderCard();

    await screen.findByText("Vendor");

    expect(screen.queryByText("Edit Fields")).not.toBeInTheDocument();
  });

  test("still offers editing when some fields are not inherited", async () => {
    resolveListWith(buildSchema([MAPPED_VENDOR, { name: "Owner" }]));
    getItemMock.mockResolvedValue(
      buildAlert({ customFields: { Vendor: "Acme" }, monitorId: MONITOR_ID }),
    );

    renderCard();

    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();
  });

  /*
   * The regression this is here for: a mapped field on a record with no
   * monitor must stay editable, or SLO and security-event alerts lose the
   * ability to carry that field at all.
   */
  test("leaves a mapped field editable on a record with no monitor", async () => {
    resolveListWith(buildSchema([MAPPED_VENDOR]));
    getItemMock.mockResolvedValue(buildAlert({ customFields: {} }));

    renderCard();

    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();
    expect(
      screen.queryByText(/Copied from the Monitor custom field/i),
    ).not.toBeInTheDocument();
  });

  test("a definition with no mapping behaves exactly as before", async () => {
    resolveListWith(buildSchema([{ name: "Owner" }]));
    getItemMock.mockResolvedValue(
      buildAlert({ customFields: { Owner: "kate" }, monitorId: MONITOR_ID }),
    );

    renderCard();

    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();
    expect(
      screen.queryByText(/Copied from the Monitor custom field/i),
    ).not.toBeInTheDocument();
  });
});

describe("CustomFieldsDetail on a resource with no mapping sources", () => {
  /*
   * Six of the nine resources have nothing to inherit from. The card must ask
   * for no relation at all on those — a select naming a column the model does
   * not have is rejected by the API and takes the whole card down with it.
   */
  test("asks for no relation columns", async () => {
    resolveListWith([
      Object.assign(new TeamCustomField(), {
        name: "Vendor",
        customFieldType: CustomFieldType.Text,
      }),
    ]);

    const team: Team = new Team();
    team.id = ALERT_ID;
    team.customFields = { Vendor: "Acme" };
    getItemMock.mockResolvedValue(team);

    render(
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom fields for this team."
        modelType={Team}
        customFieldType={TeamCustomField}
        name="Team Custom Fields"
        projectId={PROJECT_ID}
        modelId={ALERT_ID}
      />,
    );

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect((getItemMock.mock.calls[0]![0] as JSONObject)["select"]).toEqual({
      customFields: true,
    });
  });
});
