import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Permission, { UserPermission } from "../../../Types/Permission";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The consent checkbox is the whole point of the change: on the Free plan a
 * user must not be able to start a metered charge without saying they
 * understand it. This suite drives the real ModelForm rather than the field
 * definitions, because the mechanism is subtle - the form's own `required`
 * check stringifies values, so an unticked box reads as the non-empty string
 * "false" and sails straight through it. The gate is a customValidation, and
 * it only runs at all because getDefaultValue seeds the key.
 */

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

interface MutableConfig {
  billingEnabled: boolean;
}

const config: MutableConfig = { billingEnabled: true };

(
  globalThis as unknown as { __payAsYouGoGateConfig: MutableConfig }
).__payAsYouGoGateConfig = config;

jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...jest.requireActual("../../../UI/Config"),
  };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return Boolean(
        (
          globalThis as unknown as {
            __payAsYouGoGateConfig: MutableConfig | undefined;
          }
        ).__payAsYouGoGateConfig?.billingEnabled,
      );
    },
  });

  return mocked;
});

// Imported after the mocks above.
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import {
  MONITOR_CONSENT_ERROR,
  MONITOR_CONSENT_FIELD_KEY,
  TELEMETRY_CONSENT_ERROR,
  TELEMETRY_CONSENT_FIELD_KEY,
  getMonitorPayAsYouGoFormFields,
  getTelemetryPayAsYouGoFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo";

/*
 * These render real forms that validate on every keystroke, so give the waits
 * room to survive a loaded CI box.
 */
const WAIT_TIMEOUT: number = 20000;

type RenderIngestionKeyFormFunction = () => void;

const renderIngestionKeyForm: RenderIngestionKeyFormFunction = (): void => {
  render(
    <ModelForm<TelemetryIngestionKey>
      modelType={TelemetryIngestionKey}
      id="create-ingestion-key-form"
      name="Create Ingestion Key"
      formType={FormType.Create}
      submitButtonText="Create Ingestion Key"
      fields={[
        ...getTelemetryPayAsYouGoFormFields(),
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          dataTestId: "ingestion-key-name",
        },
      ]}
    />,
  );
};

type RenderMonitorFormFunction = (monitorType: MonitorType) => void;

const renderMonitorForm: RenderMonitorFormFunction = (
  monitorType: MonitorType,
): void => {
  render(
    <ModelForm<Monitor>
      modelType={Monitor}
      id="create-monitor-form"
      name="Create New Monitor"
      formType={FormType.Create}
      submitButtonText="Create Monitor"
      initialValues={{ monitorType: monitorType } as any}
      steps={[{ title: "Monitor Info", id: "monitor-info" }]}
      fields={[
        {
          field: { name: true },
          stepId: "monitor-info",
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          dataTestId: "monitor-name",
        },
        ...getMonitorPayAsYouGoFormFields({ stepId: "monitor-info" }),
      ]}
    />,
  );
};

describe("Pay as you go consent gate", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    config.billingEnabled = true;
    createOrUpdateMock.mockReset();
    getItemMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
    getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Free);
  });

  describe("creating a telemetry ingestion key on the Free plan", () => {
    it("shows the pay as you go notice and the consent box in the form", async () => {
      renderIngestionKeyForm();

      expect(
        await screen.findByText(
          "Telemetry is a pay as you go feature",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("telemetry-pay-as-you-go-consent"),
      ).toBeInTheDocument();
    });

    it("refuses to create the key until the charge is acknowledged", async () => {
      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );

      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(screen.getByText(TELEMETRY_CONSENT_ERROR)).toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );

      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    it("creates the key once the box is ticked", async () => {
      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );
      await userEvent.click(
        screen.getByTestId("telemetry-pay-as-you-go-consent"),
      );
      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    });

    it("blocks again if the box is ticked and then unticked", async () => {
      /*
       * The regression this guards: an unticked box that has been touched
       * holds boolean false, which the form's `required` check would accept.
       */
      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );

      const consent: HTMLElement = screen.getByTestId(
        "telemetry-pay-as-you-go-consent",
      );

      await userEvent.click(consent);
      await userEvent.click(consent);
      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(screen.getByText(TELEMETRY_CONSENT_ERROR)).toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );

      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    it("does not send the acknowledgement to the API", async () => {
      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );
      await userEvent.click(
        screen.getByTestId("telemetry-pay-as-you-go-consent"),
      );
      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );

      const call: any = createOrUpdateMock.mock.calls[0]?.[0];

      /*
       * The consent is a UI gate, not data. It has no column, so sending it
       * would be an unknown property on the create payload.
       */
      expect(call?.miscDataProps ?? {}).not.toHaveProperty(
        TELEMETRY_CONSENT_FIELD_KEY,
      );
      expect(JSON.stringify(call?.model ?? {})).not.toContain(
        TELEMETRY_CONSENT_FIELD_KEY,
      );
    });
  });

  describe("creating a telemetry ingestion key off the Free plan", () => {
    it("asks for nothing extra on a paid plan", async () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(
        PlanType.Growth,
      );

      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );

      expect(
        screen.queryByTestId("telemetry-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Telemetry is a pay as you go feature"),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    });

    it("asks for nothing extra on a self-hosted install", async () => {
      config.billingEnabled = false;

      renderIngestionKeyForm();

      await userEvent.type(
        await screen.findByTestId(
          "ingestion-key-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Production",
      );

      expect(
        screen.queryByTestId("telemetry-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("Create Ingestion Key"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    });
  });

  describe("creating a monitor on the Free plan", () => {
    it("refuses to create a billed monitor until the charge is acknowledged", async () => {
      renderMonitorForm(MonitorType.Website);

      await userEvent.type(
        await screen.findByTestId(
          "monitor-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Marketing site",
      );

      expect(
        screen.getByTestId("monitor-pay-as-you-go-consent"),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByText("Create Monitor"));

      await waitFor(
        () => {
          expect(screen.getByText(MONITOR_CONSENT_ERROR)).toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );

      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    it("creates the billed monitor once the box is ticked", async () => {
      renderMonitorForm(MonitorType.Website);

      await userEvent.type(
        await screen.findByTestId(
          "monitor-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Marketing site",
      );
      await userEvent.click(
        screen.getByTestId("monitor-pay-as-you-go-consent"),
      );
      await userEvent.click(screen.getByText("Create Monitor"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );

      const call: any = createOrUpdateMock.mock.calls[0]?.[0];

      expect(call?.miscDataProps ?? {}).not.toHaveProperty(
        MONITOR_CONSENT_FIELD_KEY,
      );
    });

    it("asks nothing of a Manual monitor - those are free", async () => {
      renderMonitorForm(MonitorType.Manual);

      await userEvent.type(
        await screen.findByTestId(
          "monitor-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Runbook step",
      );

      expect(
        screen.queryByTestId("monitor-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("Create Monitor"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    });

    it.each([
      MonitorType.API,
      MonitorType.Logs,
      MonitorType.IncomingRequest,
      MonitorType.SSLCertificate,
    ])(
      "blocks %s too - every non-Manual type is billed",
      async (monitorType: MonitorType) => {
        renderMonitorForm(monitorType);

        await userEvent.type(
          await screen.findByTestId(
            "monitor-name",
            {},
            { timeout: WAIT_TIMEOUT },
          ),
          "Something",
        );
        await userEvent.click(screen.getByText("Create Monitor"));

        await waitFor(
          () => {
            expect(screen.getByText(MONITOR_CONSENT_ERROR)).toBeInTheDocument();
          },
          { timeout: WAIT_TIMEOUT },
        );

        expect(createOrUpdateMock).not.toHaveBeenCalled();
      },
    );
  });

  describe("creating a monitor off the Free plan", () => {
    it("asks for nothing extra on a paid plan", async () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(
        PlanType.Growth,
      );

      renderMonitorForm(MonitorType.Website);

      await userEvent.type(
        await screen.findByTestId(
          "monitor-name",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
        "Marketing site",
      );

      expect(
        screen.queryByTestId("monitor-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByText("Create Monitor"));

      await waitFor(
        () => {
          expect(createOrUpdateMock).toHaveBeenCalled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    });
  });
});
