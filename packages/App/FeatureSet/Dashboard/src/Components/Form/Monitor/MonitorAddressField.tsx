import MonitorAddressHelp from "./MonitorAddressHelp";
import type { MonitorStepSeed } from "./MonitorSteps";
import {
  getMonitorDestinationFieldCopy,
  hasMonitorAddress,
  MONITOR_PORT_FIELD_DESCRIPTION,
  MonitorDestinationFieldCopy,
} from "../../../Utils/Form/Monitor/MonitorDestinationFieldCopy";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import IP from "Common/Types/IP/IP";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Port from "Common/Types/Port";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import Input from "Common/UI/Components/Input/Input";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  MONITOR_NAME_MAX_LENGTH,
  parseWebsiteAddress,
  WebsiteAddress,
} from "Common/Utils/GuidedSetup/WebsiteMonitorRecords";
import MonitorDestinationUtil, {
  ParsedMonitorDestination,
} from "Common/Utils/Monitor/MonitorDestinationUtil";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * WHAT TO MONITOR, AND WHERE IT IS (#7463).
 *
 * Create Monitor asked what to monitor and what to call it, and only on the
 * next step - named "Criteria", under a heading that said "Monitor Details" -
 * where it was: the website's URL, a host to ping, a port. A newcomer named
 * the monitor before saying what it checks, and found the address under a
 * step whose name said rules. Now the address is asked first, with the type,
 * as the website guided setup asks it, and the name follows it until the
 * person writes one of their own.
 *
 * For every type whose check is of one address: Website, API, SSL
 * Certificate, Ping, IP, Port (with its port) and NTP. The address goes into
 * the monitor's first step when the criteria step is drawn
 * (withMonitorAddress), and again as the monitor is created, so the step
 * always holds the address as it reads for the type picked last. The other
 * types say where to look on their own Criteria step, beside what else
 * their check reads: a DNS monitor's domain and record type, a database's
 * connection.
 */

// The form values the address and its port are kept under: never sent.
export const MONITOR_ADDRESS_FIELD_KEY: string = "monitorAddress";
export const MONITOR_ADDRESS_PORT_FIELD_KEY: string = "monitorAddressPort";

export const MONITOR_ADDRESS_WORDS: Readonly<{
  required: string;
  portRequired: string;
  portInvalid: string;
}> = {
  required: translationKey("Enter the address to check."),
  portRequired: translationKey("Enter the port to check, like 443."),
  portInvalid: translationKey("Enter a port from 1 to 65535."),
};

// What a person typed, as the type's address, or why it is not one.
export function parseMonitorAddress(data: {
  monitorType: MonitorType;
  address: string | undefined | null;
}): ParsedMonitorDestination {
  const address: string = (data.address || "").trim();

  if (!address) {
    return { destination: undefined, error: MONITOR_ADDRESS_WORDS.required };
  }

  return MonitorDestinationUtil.parse({
    value: address,
    monitorType: data.monitorType,
  });
}

// A port is written in digits alone.
const DIGITS_ONLY: RegExp = /^\d+$/;

// A port typed, or undefined when it is not one.
export function parseMonitorPort(
  port: string | number | undefined | null,
): Port | undefined {
  const text: string = String(port ?? "").trim();

  if (!text || !DIGITS_ONLY.test(text) || !Port.isValid(text)) {
    return undefined;
  }

  return new Port(text);
}

/*
 * What the monitor is called while the person has not named it: the
 * website's host and path, as the guided setup names it ("acme.com/shop"),
 * or the host - with the port, for a Port monitor ("db.acme.com:5432").
 * Empty for an address that is not one yet.
 */
export function getMonitorNameFromAddress(data: {
  monitorType: MonitorType | undefined;
  address: string | undefined | null;
  port?: string | number | undefined | null;
}): string {
  const address: string = (data.address || "").trim();

  if (!data.monitorType || !hasMonitorAddress(data.monitorType) || !address) {
    return "";
  }

  if (
    data.monitorType === MonitorType.Website ||
    data.monitorType === MonitorType.API ||
    data.monitorType === MonitorType.SSLCertificate
  ) {
    const website: WebsiteAddress | null = parseWebsiteAddress(address);
    return website ? website.monitorName : "";
  }

  const parsed: ParsedMonitorDestination = parseMonitorAddress({
    monitorType: data.monitorType,
    address,
  });

  if (!parsed.destination) {
    return "";
  }

  const host: string = address.replace(/^\[|\]$/g, "");
  const port: Port | undefined =
    data.monitorType === MonitorType.Port
      ? parseMonitorPort(data.port)
      : undefined;
  const name: string = port ? `${host}:${port.toString()}` : host;

  return name.length > MONITOR_NAME_MAX_LENGTH
    ? name.slice(0, MONITOR_NAME_MAX_LENGTH)
    : name;
}

// The monitor's steps as the form holds them: steps, or the JSON a link seeded.
function toMonitorSteps(
  monitorSteps: MonitorSteps | JSONObject | undefined | null,
): MonitorSteps | undefined {
  if (!monitorSteps) {
    return undefined;
  }

  try {
    return monitorSteps instanceof MonitorSteps
      ? monitorSteps
      : MonitorSteps.fromJSON(monitorSteps as JSONObject);
  } catch {
    return undefined;
  }
}

// The address and the port the first step holds, as text for the fields.
export function readMonitorAddress(
  monitorSteps: MonitorSteps | JSONObject | undefined | null,
): { address: string; port: string } {
  const step: MonitorStep | undefined =
    toMonitorSteps(monitorSteps)?.data?.monitorStepsInstanceArray[0];
  const destination: URL | IP | Hostname | undefined =
    step?.data?.monitorDestination;
  const port: Port | undefined = step?.data?.monitorDestinationPort;

  return {
    address: destination ? destination.toString() : "",
    port: port ? port.toString() : "",
  };
}

/*
 * The steps with the address the person typed in their first step, as it
 * reads for the type picked: a copy, so the steps the form holds are never
 * changed under it. Undefined when there are no steps yet - the criteria
 * step seeds them with the address (MonitorStepSeed).
 */
export function withMonitorAddress(data: {
  monitorSteps: MonitorSteps | JSONObject | undefined | null;
  monitorType: MonitorType | undefined;
  address: string | undefined | null;
  port?: string | number | undefined | null;
}): MonitorSteps | undefined {
  const monitorSteps: MonitorSteps | undefined = toMonitorSteps(
    data.monitorSteps,
  );

  if (
    !monitorSteps ||
    !data.monitorType ||
    !hasMonitorAddress(data.monitorType)
  ) {
    return undefined;
  }

  const firstStep: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (!firstStep) {
    return undefined;
  }

  const copy: MonitorSteps = MonitorSteps.clone(monitorSteps);
  const step: MonitorStep = MonitorStep.clone(firstStep);

  step.setMonitorDestination(
    parseMonitorAddress({
      monitorType: data.monitorType,
      address: data.address,
    }).destination,
  );

  if (data.monitorType === MonitorType.Port) {
    step.setPort(parseMonitorPort(data.port));
  }

  copy.setMonitorStepsInstanceArray([
    step,
    ...(monitorSteps.data?.monitorStepsInstanceArray.slice(1) || []),
  ]);

  return copy;
}

/*
 * What the criteria step seeds a new monitor's first step with: the address
 * typed - over the one a link brought, which is where it came from - and
 * whatever else the link asked for (a device's web UI takes a self-signed
 * certificate).
 */
export function getMonitorAddressSeed(data: {
  monitorType: MonitorType | undefined;
  address: string | undefined | null;
  port?: string | number | undefined | null;
  linkSeed?: MonitorStepSeed | undefined;
}): MonitorStepSeed | undefined {
  if (!data.monitorType || !hasMonitorAddress(data.monitorType)) {
    return data.linkSeed;
  }

  const destination: URL | IP | Hostname | undefined = parseMonitorAddress({
    monitorType: data.monitorType,
    address: data.address,
  }).destination;

  if (!destination) {
    return data.linkSeed;
  }

  return {
    ...(data.linkSeed && data.linkSeed.monitorType === data.monitorType
      ? data.linkSeed
      : {}),
    monitorType: data.monitorType,
    monitorDestination: destination,
    monitorDestinationPort:
      data.monitorType === MonitorType.Port
        ? parseMonitorPort(data.port)
        : undefined,
  };
}

/*
 * The values a form opens with, the address fields filled in: from the
 * steps a template or a link brought, else from the address a link asked
 * for. Values that already hold an address keep it.
 */
export function withMonitorAddressValues(data: {
  values: JSONObject;
  linkSeed?: MonitorStepSeed | undefined;
}): JSONObject {
  if (
    typeof data.values[MONITOR_ADDRESS_FIELD_KEY] === "string" &&
    data.values[MONITOR_ADDRESS_FIELD_KEY]
  ) {
    return data.values;
  }

  const fromSteps: { address: string; port: string } = readMonitorAddress(
    data.values["monitorSteps"] as JSONObject | undefined,
  );

  const address: string =
    fromSteps.address ||
    (data.linkSeed ? data.linkSeed.monitorDestination.toString() : "");

  return {
    ...data.values,
    [MONITOR_ADDRESS_FIELD_KEY]: address,
    [MONITOR_ADDRESS_PORT_FIELD_KEY]: fromSteps.port,
  };
}

/*
 * The name follows the address while it is the one the address made, or
 * empty: once the person writes a name of their own, it is theirs.
 */
function getValuesWithAddress(data: {
  values: FormValues<Monitor>;
  address: string;
  port: string;
}): FormValues<Monitor> {
  const values: JSONObject = data.values as JSONObject;
  const monitorType: MonitorType | undefined = values["monitorType"] as
    | MonitorType
    | undefined;
  const name: string =
    typeof values["name"] === "string" ? (values["name"] as string).trim() : "";

  const suggested: string = getMonitorNameFromAddress({
    monitorType,
    address: values[MONITOR_ADDRESS_FIELD_KEY] as string | undefined,
    port: values[MONITOR_ADDRESS_PORT_FIELD_KEY] as string | undefined,
  });

  if (name && name !== suggested) {
    return data.values;
  }

  return {
    ...values,
    name: getMonitorNameFromAddress({
      monitorType,
      address: data.address,
      port: data.port,
    }),
  } as FormValues<Monitor>;
}

interface AddressInputProps {
  monitorType: MonitorType;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
}

// The type's address, named and explained as the type has it.
const MonitorAddressInput: FunctionComponent<AddressInputProps> = (
  props: AddressInputProps,
): ReactElement => {
  const id: string = useId();
  const descriptionId: string = `${id}-description`;
  const copy: MonitorDestinationFieldCopy | null =
    getMonitorDestinationFieldCopy(props.monitorType);

  return (
    <div data-testid="monitor-address-field">
      <FieldLabelElement
        title={copy?.title || "Address"}
        description={copy?.description}
        htmlFor={id}
        descriptionId={copy?.description ? descriptionId : undefined}
        required={true}
      />
      <div className="mt-2">
        <Input
          id={id}
          ariaDescribedby={copy?.description ? descriptionId : undefined}
          initialValue={props.value}
          placeholder={copy?.placeholder}
          disableSpellCheck={true}
          // An address reads left to right on every page.
          readsLeftToRight={true}
          dataTestId="monitor-address-input"
          error={props.error}
          onChange={(value: string) => {
            props.onChange(value);
          }}
          onBlur={() => {
            props.onBlur();
          }}
        />
      </div>
      <MonitorAddressHelp monitorType={props.monitorType} />
    </div>
  );
};

/*
 * The address, and for a Port monitor its port, on Create Monitor's first
 * step: right after the type, before the name it fills in.
 */
export function getMonitorAddressFormFields(data: {
  stepId: string;
}): Array<ModelField<Monitor>> {
  const typeOf: (values: FormValues<Monitor>) => MonitorType | undefined = (
    values: FormValues<Monitor>,
  ): MonitorType | undefined => {
    return (values as JSONObject)["monitorType"] as MonitorType | undefined;
  };

  return [
    {
      overrideField: {
        [MONITOR_ADDRESS_FIELD_KEY]: true,
      },
      overrideFieldKey: MONITOR_ADDRESS_FIELD_KEY,
      // It fills in the monitor's first step; nothing of it is sent itself.
      formOnly: true,
      showEvenIfPermissionDoesNotExist: true,
      stepId: data.stepId,
      title: "Address",
      fieldType: FormFieldSchemaType.CustomComponent,
      customElementDrawsOwnLabel: true,
      dataTestId: "monitor-address",
      required: true,
      showIf: (values: FormValues<Monitor>): boolean => {
        return hasMonitorAddress(typeOf(values));
      },
      customValidation: (values: FormValues<Monitor>): string | null => {
        const monitorType: MonitorType | undefined = typeOf(values);

        if (!monitorType) {
          return null;
        }

        return parseMonitorAddress({
          monitorType,
          address: (values as JSONObject)[MONITOR_ADDRESS_FIELD_KEY] as
            | string
            | undefined,
        }).error;
      },
      onChange: (
        value: unknown,
        currentValues: FormValues<Monitor>,
        setNewFormValues: (values: FormValues<Monitor>) => void,
      ): void => {
        setNewFormValues(
          getValuesWithAddress({
            values: currentValues,
            address: typeof value === "string" ? value : "",
            port: String(
              (currentValues as JSONObject)[MONITOR_ADDRESS_PORT_FIELD_KEY] ??
                "",
            ),
          }),
        );
      },
      getCustomElement: (
        values: FormValues<Monitor>,
        props: CustomElementProps,
      ): ReactElement => {
        const monitorType: MonitorType | undefined = typeOf(values);

        if (!monitorType) {
          return <></>;
        }

        return (
          <MonitorAddressInput
            monitorType={monitorType}
            value={String(
              (values as JSONObject)[MONITOR_ADDRESS_FIELD_KEY] ?? "",
            )}
            error={props.error}
            onChange={(value: string) => {
              props.onChange?.(value);
            }}
            onBlur={() => {
              props.onBlur?.();
            }}
          />
        );
      },
    },
    {
      overrideField: {
        [MONITOR_ADDRESS_PORT_FIELD_KEY]: true,
      },
      overrideFieldKey: MONITOR_ADDRESS_PORT_FIELD_KEY,
      formOnly: true,
      showEvenIfPermissionDoesNotExist: true,
      stepId: data.stepId,
      title: "Port",
      description: MONITOR_PORT_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Text,
      placeholder: "443",
      dataTestId: "monitor-address-port",
      required: true,
      showIf: (values: FormValues<Monitor>): boolean => {
        return typeOf(values) === MonitorType.Port;
      },
      customValidation: (values: FormValues<Monitor>): string | null => {
        const port: unknown = (values as JSONObject)[
          MONITOR_ADDRESS_PORT_FIELD_KEY
        ];

        if (!String(port ?? "").trim()) {
          return MONITOR_ADDRESS_WORDS.portRequired;
        }

        return parseMonitorPort(port as string)
          ? null
          : MONITOR_ADDRESS_WORDS.portInvalid;
      },
      onChange: (
        value: unknown,
        currentValues: FormValues<Monitor>,
        setNewFormValues: (values: FormValues<Monitor>) => void,
      ): void => {
        const port: string = typeof value === "string" ? value : "";
        const values: FormValues<Monitor> = getValuesWithAddress({
          values: currentValues,
          address: String(
            (currentValues as JSONObject)[MONITOR_ADDRESS_FIELD_KEY] ?? "",
          ),
          port: port,
        });

        setNewFormValues(values);
      },
    },
  ];
}

// The form's address and port, as text.
export function getMonitorAddressValues(values: JSONObject): {
  address: string;
  port: string;
} {
  return {
    address: String(values[MONITOR_ADDRESS_FIELD_KEY] ?? ""),
    port: String(values[MONITOR_ADDRESS_PORT_FIELD_KEY] ?? ""),
  };
}
