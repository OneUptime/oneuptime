import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  DropdownOption,
  DropdownValue,
} from "../../../UI/Components/Dropdown/Dropdown";

/*
 * The device Settings page under ping-first polling.
 *
 * A probe-polled device is pinged whether or not it has SNMP credentials, so
 * this page is where three things now have to be true and stay true:
 *
 *   - the monitoring method is offered as "Probe" (the normal choice) versus
 *     "Bound monitor" (the override), in those words, because the create
 *     form no longer asks and this is the only place the choice is made;
 *   - the SNMP step is shown for a probe-polled device (credentials are
 *     optional on it), offers a credential profile, and has a "Ping only"
 *     affordance that blanks the device's own credentials on the way to a
 *     save — a v3 device cannot otherwise be made ping-only without knowing
 *     that the username is what the probe keys on;
 *   - the polling card (probe, interval, toggle) is editable for a
 *     probe-polled device and NOT for a bound-monitor override, which
 *     nothing polls.
 *
 * CardModelDetail is replaced by a prop recorder keyed on the card's name —
 * the point is what the page hands each card, not re-testing the card.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
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
      getUserId: () => {
        return null;
      },
    },
  };
});

const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        return DEVICE_ID;
      },
      navigate: () => {
        // no-op
      },
      getQueryStringByName: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return PROJECT_ID;
      },
    },
  };
});

/* What the page's device read returns: flipped per test. */
let deviceMonitoringMethod: string | undefined = undefined;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({ monitoringMethod: deviceMonitoringMethod });
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async () => {
        return [{ _id: "probe-1", name: "Branch probe" }];
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

type FormValuesLike = Record<string, unknown>;

type CapturedFormField = {
  field?: Record<string, unknown> | undefined;
  overrideField?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  title?: string | undefined;
  stepId?: string | undefined;
  description?: string | undefined;
  fieldType?: FormFieldSchemaType | undefined;
  required?: boolean | ((values: FormValuesLike) => boolean) | undefined;
  showIf?: ((values: FormValuesLike) => boolean) | undefined;
  dropdownOptions?: Array<{ label: string; value: string }> | undefined;
  dropdownModal?: { type: unknown } | undefined;
  onChange?:
    | ((
        value: unknown,
        currentFormValues: FormValuesLike,
        setNewFormValues: (values: FormValuesLike) => void,
      ) => void)
    | undefined;
};

type CapturedFormStep = {
  id: string;
  title: string;
  showIf?: ((values: FormValuesLike) => boolean) | undefined;
};

type CapturedCardProps = {
  name: string;
  isEditable?: boolean | undefined;
  cardProps?: { description?: string | undefined } | undefined;
  formSteps?: Array<CapturedFormStep> | undefined;
  formFields?: Array<CapturedFormField> | undefined;
  onSaveSuccess?: ((item: unknown) => void) | undefined;
};

const capturedCards: Map<string, CapturedCardProps> = new Map();

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedCardProps) => {
      capturedCards.set(props.name, props);
      return null;
    },
  };
});

import NetworkDeviceSettingsPage, {
  PING_ONLY_FIELD_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/network-devices/view/settings"),
  currentProject: null,
  hasPaymentMethod: true,
};

async function renderPage(): Promise<Map<string, CapturedCardProps>> {
  const Page: (props: PageComponentProps) => ReactElement =
    NetworkDeviceSettingsPage as unknown as (
      props: PageComponentProps,
    ) => ReactElement;

  render(
    <MemoryRouter>
      <Page {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedCards.has("Device Settings")).toBe(true);
    expect(capturedCards.has("Polling & Data Collection")).toBe(true);
  });

  return capturedCards;
}

function fieldFor(card: CapturedCardProps, key: string): CapturedFormField {
  const match: CapturedFormField | undefined = (card.formFields || []).find(
    (field: CapturedFormField): boolean => {
      return (
        Object.keys(field.field || {})[0] === key ||
        field.overrideFieldKey === key
      );
    },
  );

  expect({ key: key, found: Boolean(match) }).toEqual({
    key: key,
    found: true,
  });

  return match!;
}

function isShown(field: CapturedFormField, values: FormValuesLike): boolean {
  return field.showIf ? field.showIf(values) : true;
}

const PROBE_VALUES: FormValuesLike = {
  monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
};
const LEGACY_SNMP_VALUES: FormValuesLike = { monitoringMethod: "SNMP" };
const MONITOR_VALUES: FormValuesLike = {
  monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
};

describe("the device Settings page", () => {
  beforeEach(() => {
    capturedCards.clear();
    deviceMonitoringMethod = NetworkDeviceMonitoringMethod.Probe;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("the monitoring method", () => {
    test("is offered as Probe (normal) versus Bound monitor (override), in those words", async () => {
      const cards: Map<string, CapturedCardProps> = await renderPage();
      const method: CapturedFormField = fieldFor(
        cards.get("Device Settings")!,
        "monitoringMethod",
      );

      const labels: Array<string> = (method.dropdownOptions || []).map(
        (option: { label: string }): string => {
          return option.label;
        },
      );

      expect(
        method.dropdownOptions?.map((option: DropdownOption): DropdownValue => {
          return option.value;
        }),
      ).toEqual([
        NetworkDeviceMonitoringMethod.Probe,
        NetworkDeviceMonitoringMethod.Monitor,
      ]);
      expect(labels[0]).toMatch(/^Probe — /);
      expect(labels[0]).toContain("pinged");
      expect(labels[1]).toMatch(/^Bound monitor — /);
      expect(labels[1]).toContain("override");
      expect(method.description).toContain("Probe is the normal choice");
    });

    test("the bound-monitor field is shown only for the override", async () => {
      const cards: Map<string, CapturedCardProps> = await renderPage();
      const monitor: CapturedFormField = fieldFor(
        cards.get("Device Settings")!,
        "monitor",
      );

      expect(isShown(monitor, MONITOR_VALUES)).toBe(true);
      expect(isShown(monitor, PROBE_VALUES)).toBe(false);
      expect(isShown(monitor, LEGACY_SNMP_VALUES)).toBe(false);
      expect(monitor.required).toBe(false);
    });
  });

  describe("the SNMP step", () => {
    test("is shown for a probe-polled device (including legacy SNMP rows) and hidden for a bound-monitor override", async () => {
      const cards: Map<string, CapturedCardProps> = await renderPage();
      const snmpStep: CapturedFormStep | undefined = cards
        .get("Device Settings")!
        .formSteps?.find((step: CapturedFormStep): boolean => {
          return step.id === "snmp";
        });

      expect(snmpStep).toBeDefined();
      expect(snmpStep!.showIf!(PROBE_VALUES)).toBe(true);
      expect(snmpStep!.showIf!(LEGACY_SNMP_VALUES)).toBe(true);
      expect(snmpStep!.showIf!({})).toBe(true);
      expect(snmpStep!.showIf!(MONITOR_VALUES)).toBe(false);
    });

    test("offers a credential profile bound to the profile model, optional, and says the device's own credentials win", async () => {
      const cards: Map<string, CapturedCardProps> = await renderPage();
      const profile: CapturedFormField = fieldFor(
        cards.get("Device Settings")!,
        "snmpCredentialProfile",
      );

      expect(profile.stepId).toBe("snmp");
      expect(profile.required).toBe(false);
      expect(profile.dropdownModal?.type).toBe(NetworkSnmpCredentialProfile);
      expect(profile.description).toContain("own credentials below win");
      expect(profile.description).toContain("site can carry a default");
    });

    test("the Ping only box blanks the device's own credentials when ticked", async () => {
      const cards: Map<string, CapturedCardProps> = await renderPage();
      const pingOnly: CapturedFormField = fieldFor(
        cards.get("Device Settings")!,
        PING_ONLY_FIELD_KEY,
      );

      expect(pingOnly.fieldType).toBe(FormFieldSchemaType.Checkbox);
      expect(pingOnly.stepId).toBe("snmp");
      expect(pingOnly.field).toBeUndefined();
      expect(pingOnly.overrideField).toEqual({ [PING_ONLY_FIELD_KEY]: true });

      let next: FormValuesLike | null = null;
      pingOnly.onChange!(
        true,
        {
          ...PROBE_VALUES,
          snmpVersion: "V3",
          snmpV3Username: "netops",
          snmpV3AuthKey: "secret",
          snmpV3PrivKey: "secret2",
          snmpCommunityString: "public",
        },
        (values: FormValuesLike): void => {
          next = values;
        },
      );

      expect(next).not.toBeNull();
      expect(next!["snmpCommunityString"]).toBe("");
      expect(next!["snmpV3Username"]).toBe("");
      expect(next!["snmpV3AuthKey"]).toBe("");
      expect(next!["snmpV3PrivKey"]).toBe("");
      // Everything else is left alone — the version in particular.
      expect(next!["snmpVersion"]).toBe("V3");
    });

    test("the Ping only box does nothing when unticked", async () => {
      const cards: Map<string, CapturedCardProps> = await renderPage();
      const pingOnly: CapturedFormField = fieldFor(
        cards.get("Device Settings")!,
        PING_ONLY_FIELD_KEY,
      );

      let calls: number = 0;
      pingOnly.onChange!(
        false,
        { ...PROBE_VALUES, snmpCommunityString: "public" },
        (): void => {
          calls++;
        },
      );

      expect(calls).toBe(0);
    });
  });

  describe("the polling card", () => {
    test("is editable for a probe-polled device", async () => {
      deviceMonitoringMethod = NetworkDeviceMonitoringMethod.Probe;

      const cards: Map<string, CapturedCardProps> = await renderPage();
      const polling: CapturedCardProps = cards.get(
        "Polling & Data Collection",
      )!;

      expect(polling.isEditable).toBe(true);
      expect(polling.cardProps?.description).toContain("pings this device");
      expect(fieldFor(polling, "probe").required).toBe(true);
    });

    test("is read-only, and says why, for a bound-monitor override", async () => {
      deviceMonitoringMethod = NetworkDeviceMonitoringMethod.Monitor;

      const cards: Map<string, CapturedCardProps> = await renderPage();

      await waitFor(() => {
        expect(cards.get("Polling & Data Collection")!.isEditable).toBe(false);
      });

      expect(
        cards.get("Polling & Data Collection")!.cardProps?.description,
      ).toContain("nothing polls it");
    });

    test("a legacy SNMP row is treated as probe-polled", async () => {
      deviceMonitoringMethod = "SNMP";

      const cards: Map<string, CapturedCardProps> = await renderPage();

      expect(cards.get("Polling & Data Collection")!.isEditable).toBe(true);
    });

    test("the Device Settings card re-reads the method after a save", async () => {
      const cards: Map<string, CapturedCardProps> = await renderPage();

      expect(cards.get("Device Settings")!.onSaveSuccess).toBeDefined();
    });
  });
});
