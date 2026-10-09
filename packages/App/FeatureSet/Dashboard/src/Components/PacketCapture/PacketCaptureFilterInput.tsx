import {
  PacketCaptureFilterMode,
  PacketCaptureFilterValue,
  buildFilter,
  describeFilterPreview,
  getDefaultFilterValue,
} from "./PacketCaptureViewModel";
import PacketCaptureFilterUtil, {
  PacketCaptureFilterBuild,
  PacketCaptureProtocol,
} from "Common/Types/PacketCapture/PacketCaptureFilter";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

export interface ComponentProps {
  initialValue?: PacketCaptureFilterValue | string | undefined;
  onChange?: ((value: PacketCaptureFilterValue) => void) | undefined;
  // What "every packet on ..." names: the interface picked above.
  interfaceLabel: string;
  error?: string | undefined;
}

const PROTOCOL_LABELS: Record<PacketCaptureProtocol, string> = {
  [PacketCaptureProtocol.Any]: translationKey("Any protocol"),
  [PacketCaptureProtocol.TCP]: "TCP",
  [PacketCaptureProtocol.UDP]: "UDP",
  [PacketCaptureProtocol.ICMP]: "ICMP",
};

function readInitialValue(
  value: PacketCaptureFilterValue | string | undefined,
): PacketCaptureFilterValue {
  if (value && typeof value === "object") {
    return { ...getDefaultFilterValue(), ...value };
  }

  return getDefaultFilterValue();
}

/*
 * Which packets a capture keeps. Most people pick a host, a port and a
 * protocol and never see BPF; the expression they make is shown underneath,
 * so the step to writing one (Write a BPF filter instead) starts from it.
 * Either way the value ends at the check the server makes, and a mistake is
 * shown here, in words, before anything is sent.
 */
const PacketCaptureFilterInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();

  const [value, setValue] = useState<PacketCaptureFilterValue>(() => {
    return readInitialValue(props.initialValue);
  });

  // Report the starting value once, so the form holds it before any edit.
  useEffect(() => {
    props.onChange?.(value);
  }, []);

  const update: (change: Partial<PacketCaptureFilterValue>) => void = (
    change: Partial<PacketCaptureFilterValue>,
  ): void => {
    const next: PacketCaptureFilterValue = { ...value, ...change };
    setValue(next);
    props.onChange?.(next);
  };

  const build: PacketCaptureFilterBuild = buildFilter(value);

  const preview: string = describeFilterPreview({
    build: build,
    interfaceLabel: props.interfaceLabel,
    translator: translator,
  });

  const protocolOptions: Array<DropdownOption> =
    PacketCaptureFilterUtil.getProtocols().map(
      (protocol: PacketCaptureProtocol): DropdownOption => {
        return { value: protocol, label: PROTOCOL_LABELS[protocol] };
      },
    );

  const isExpression: boolean =
    value.mode === PacketCaptureFilterMode.Expression;

  return (
    <div className="space-y-3" data-testid="packet-capture-filter">
      {isExpression ? (
        <div>
          <label
            htmlFor={`${id}-expression`}
            className="block text-xs font-medium text-gray-700"
          >
            {translator.translateText("BPF filter")}
          </label>
          <Input
            id={`${id}-expression`}
            dataTestId="packet-capture-filter-expression"
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 font-mono text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            outerDivClassName="mt-1"
            placeholder="host 10.0.0.5 and (tcp port 443 or udp port 53)"
            value={value.expression}
            onChange={(expression: string) => {
              update({ expression: expression });
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_10rem]">
          <div className="min-w-0">
            <label
              htmlFor={`${id}-host`}
              className="block text-xs font-medium text-gray-700"
            >
              {translator.translateText("Host or network")}
            </label>
            <Input
              id={`${id}-host`}
              dataTestId="packet-capture-filter-host"
              outerDivClassName="mt-1"
              placeholder="10.0.0.5 or 10.0.0.0/24"
              value={value.host}
              onChange={(host: string) => {
                update({ host: host });
              }}
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-port`}
              className="block text-xs font-medium text-gray-700"
            >
              {translator.translateText("Port")}
            </label>
            <Input
              id={`${id}-port`}
              dataTestId="packet-capture-filter-port"
              outerDivClassName="mt-1"
              placeholder="443"
              value={value.port}
              onChange={(port: string) => {
                update({ port: port });
              }}
            />
          </div>
          <div>
            <span
              id={`${id}-protocol-label`}
              className="block text-xs font-medium text-gray-700"
            >
              {translator.translateText("Protocol")}
            </span>
            <div className="mt-1">
              <Dropdown
                dataTestId="packet-capture-filter-protocol"
                ariaLabelledby={`${id}-protocol-label`}
                options={protocolOptions}
                isClearable={false}
                value={protocolOptions.find((option: DropdownOption) => {
                  return option.value === value.protocol;
                })}
                onChange={(
                  picked: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  update({
                    protocol:
                      PacketCaptureFilterUtil.parseProtocol(picked) ||
                      PacketCaptureProtocol.Any,
                  });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/*
       * The expression it makes, and the way to write one: side by side
       * where there is room, the link under the expression on a phone.
       */}
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <p
          className={`min-w-0 flex-1 break-words text-xs ${build.error ? "text-red-600" : "text-gray-600"}`}
          data-testid="packet-capture-filter-preview"
          role={build.error ? "alert" : undefined}
        >
          {build.error ? (
            preview
          ) : build.expression ? (
            <>
              {translator.translateText("Filter:")}{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-800">
                {build.expression}
              </code>
            </>
          ) : (
            preview
          )}
        </p>
        <Button
          buttonStyle={ButtonStyleType.LINK}
          buttonSize={ButtonSize.ExtraSmall}
          className="shrink-0 text-xs font-medium"
          dataTestId="packet-capture-filter-mode"
          title={
            isExpression
              ? "Use host, port and protocol"
              : "Write a BPF filter instead"
          }
          onClick={() => {
            if (isExpression) {
              update({ mode: PacketCaptureFilterMode.Simple });
              return;
            }

            /*
             * The expression starts as what the boxes made, so writing BPF
             * starts from where the person was rather than from nothing.
             */
            update({
              mode: PacketCaptureFilterMode.Expression,
              expression: build.error ? value.expression : build.expression,
            });
          }}
        />
      </div>

      {props.error && props.error !== build.error ? (
        <p className="text-xs text-red-600">{props.error}</p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PacketCaptureFilterInput;
