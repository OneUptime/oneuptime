import BaseAPI from "../../../UI/Utils/API/API";
import ObjectID from "../../../Types/ObjectID";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Route from "../../../Types/API/Route";
import Project from "../../../Models/DatabaseModels/Project";
import Permission, { UserPermission } from "../../../Types/Permission";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import MonitorCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Create";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import {
  TELEMETRY_CONSENT_ERROR,
  TELEMETRY_CONSENT_FIELD_KEY,
  getTelemetryPayAsYouGoFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo";

/*
 * Telemetry creation still requires explicit consent. Single-monitor creation
 * instead relies on the page's pricing warning, and must allow the user to
 * advance from Monitor Info without an additional acknowledgement.
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
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      getCommonHeaders: () => {
        return {};
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="monitor-steps" />;
      },
    };
  },
);

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

function renderMonitorPage(monitorType: MonitorType): void {
  const project: Project = new Project();
  project.id = new ObjectID("11111111-1111-4111-8111-111111111111");

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(project.id);
  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (paramName: string): string | null => {
      return paramName === "monitorType" ? monitorType : null;
    },
  );

  render(
    <MemoryRouter>
      <MonitorCreate
        pageRoute={new Route("/dashboard/monitors/create")}
        currentProject={project}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

async function advanceMonitorInfo(): Promise<void> {
  await userEvent.type(
    await screen.findByPlaceholderText(
      "Monitor Name",
      {},
      { timeout: WAIT_TIMEOUT },
    ),
    "Marketing site",
  );
  await userEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(
    await screen.findByTestId("monitor-steps", {}, { timeout: WAIT_TIMEOUT }),
  ).toBeInTheDocument();
}

describe("Pay as you go consent gate", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(ObjectID.generate());
    jest
      .spyOn(BaseAPI, "get")
      .mockResolvedValue({ data: { isAllowed: true } } as any);
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
    it.each([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Logs,
      MonitorType.IncomingRequest,
      MonitorType.SSLCertificate,
    ])(
      "shows the page warning and advances %s without billing acknowledgement",
      async (monitorType: MonitorType) => {
        renderMonitorPage(monitorType);

        const pricingNotice: HTMLElement = await screen.findByTestId(
          "monitor-pay-as-you-go-card",
        );
        expect(pricingNotice).toHaveTextContent("$1");
        expect(pricingNotice).toHaveTextContent("per monitor per month");
        await screen.findByPlaceholderText("Monitor Name");

        expect(
          screen.queryByTestId("monitor-pay-as-you-go-consent"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(/I understand this monitor is billed/i),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText("I agree to these usage charges"),
        ).not.toBeInTheDocument();

        await advanceMonitorInfo();
      },
    );
  });

  describe("creating a monitor off the Free plan", () => {
    it("advances without a warning or acknowledgement on a paid plan", async () => {
      getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(
        PlanType.Growth,
      );
      renderMonitorPage(MonitorType.Website);

      await advanceMonitorInfo();

      expect(
        screen.queryByTestId("monitor-pay-as-you-go-card"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("monitor-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();
    });

    it("advances without a warning or acknowledgement on a self-hosted install", async () => {
      config.billingEnabled = false;
      renderMonitorPage(MonitorType.Website);

      await advanceMonitorInfo();

      expect(
        screen.queryByTestId("monitor-pay-as-you-go-card"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("monitor-pay-as-you-go-consent"),
      ).not.toBeInTheDocument();
    });
  });
});
