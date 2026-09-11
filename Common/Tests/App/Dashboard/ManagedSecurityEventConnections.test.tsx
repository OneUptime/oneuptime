import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { act, ReactElement } from "react";
import ManagedSecurityEventConnections from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ManagedSecurityEventConnections";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityEventConnectorType from "../../../Types/SecurityEvent/SecurityEventConnectorType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

type CapturedField = {
  field: Record<string, boolean>;
  dropdownOptions?: Array<{ label: string; value: string }> | undefined;
  doNotShowWhenEditing?: boolean | undefined;
};

type CapturedColumn = {
  title: string;
  getElement?: ((item: SecurityEventConnection) => ReactElement) | undefined;
};

type CapturedAction = {
  title: string;
  disabled?: boolean | undefined;
  onClick: (
    item: SecurityEventConnection,
    onCompleteAction: () => void,
  ) => void;
};

type CapturedTableProps = {
  query?: Record<string, unknown> | undefined;
  refreshToggle?: string | undefined;
  selectMoreFields?: Record<string, boolean> | undefined;
  formFields?: Array<CapturedField> | undefined;
  columns?: Array<CapturedColumn> | undefined;
  actionButtons?: Array<CapturedAction> | undefined;
};

type CapturedModalProps = {
  title?: string | undefined;
  formProps?: { fields?: Array<CapturedField> | undefined } | undefined;
  onSubmit?: ((data: Record<string, unknown>) => Promise<void>) | undefined;
};

let tableProps: CapturedTableProps | null = null;
let modalProps: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): null => {
      tableProps = props;
      return null;
    },
  };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): null => {
      modalProps = props;
      return null;
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function renderedTable(): CapturedTableProps {
  if (!tableProps) {
    throw new Error("Managed connections table was not rendered.");
  }
  return tableProps;
}

function fieldName(field: CapturedField): string {
  return Object.keys(field.field)[0] || "";
}

function healthElement(item: SecurityEventConnection): ReactElement<{
  color: unknown;
  text: string;
}> {
  const column: CapturedColumn | undefined = renderedTable().columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Health";
    },
  );
  if (!column?.getElement) {
    throw new Error("Health column was not configured.");
  }
  return column.getElement(item) as ReactElement<{
    color: unknown;
    text: string;
  }>;
}

describe("ManagedSecurityEventConnections", () => {
  beforeEach(() => {
    tableProps = null;
    modalProps = null;
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("scopes the list, keeps secrets out of reads, and offers every provider", () => {
    render(<ManagedSecurityEventConnections />);

    const props: CapturedTableProps = renderedTable();
    expect(props.query).toEqual({ projectId: PROJECT_ID });
    expect(props.selectMoreFields).not.toHaveProperty("credentialJson");
    expect(props.selectMoreFields).not.toHaveProperty("cursor");
    expect(props.selectMoreFields).not.toHaveProperty("sourceGeneration");

    const credentialField: CapturedField | undefined = props.formFields?.find(
      (field: CapturedField): boolean => {
        return fieldName(field) === "credentialJson";
      },
    );
    expect(credentialField?.doNotShowWhenEditing).toBe(true);

    const providerField: CapturedField | undefined = props.formFields?.find(
      (field: CapturedField): boolean => {
        return fieldName(field) === "provider";
      },
    );
    expect(providerField?.doNotShowWhenEditing).toBe(true);
    expect(
      providerField?.dropdownOptions?.map(
        (option: { label: string; value: string }): string => {
          return option.value;
        },
      ),
    ).toEqual([
      SecurityEventConnectorType.AwsSecurityHub,
      SecurityEventConnectorType.MicrosoftDefender,
      SecurityEventConnectorType.Cloudflare,
      SecurityEventConnectorType.CrowdStrikeFalcon,
      SecurityEventConnectorType.GoogleSecurityCommandCenter,
      SecurityEventConnectorType.Okta,
      SecurityEventConnectorType.SplunkEnterpriseSecurity,
    ]);
  });

  test("shows failures ahead of partial imports and reports partial imports", () => {
    render(<ManagedSecurityEventConnections />);

    const failed: SecurityEventConnection = new SecurityEventConnection();
    failed.lastPollResult = { complete: false, error: "denied" };
    expect(healthElement(failed).props.text).toBe("Last poll failed");

    const partial: SecurityEventConnection = new SecurityEventConnection();
    partial.lastPollResult = { complete: false };
    expect(healthElement(partial).props.text).toBe("Partial import");
  });

  test("rotates only the credential field and refreshes the table", async () => {
    const updateById: jest.Mock = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, {}, {}),
      ) as unknown as jest.Mock;
    render(<ManagedSecurityEventConnections />);

    const updateAction: CapturedAction | undefined =
      renderedTable().actionButtons?.find((action: CapturedAction): boolean => {
        return action.title === "Update Credentials";
      });
    if (!updateAction) {
      throw new Error("Update Credentials action was not configured.");
    }

    const connection: SecurityEventConnection = new SecurityEventConnection();
    connection.id = CONNECTION_ID;
    const completeAction: jest.Mock = jest.fn();
    await act(async () => {
      updateAction.onClick(connection, completeAction);
    });

    expect(completeAction).toHaveBeenCalledTimes(1);
    expect(modalProps?.title).toBe("Update Credentials");
    expect(modalProps?.formProps?.fields?.map(fieldName)).toEqual([
      "credentialJson",
    ]);
    if (!modalProps?.onSubmit) {
      throw new Error("Credential update form was not rendered.");
    }

    await act(async () => {
      await modalProps?.onSubmit?.({ credentialJson: '{"apiToken":"new"}' });
    });

    expect(updateById).toHaveBeenCalledWith({
      modelType: SecurityEventConnection,
      id: CONNECTION_ID,
      data: { credentialJson: '{"apiToken":"new"}' },
    });
    expect(renderedTable().refreshToggle).toBe("1");
  });
});
