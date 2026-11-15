import { OpenStackCollectionOptions } from "Common/Types/OpenStack/OpenStackProbeCollection";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";
import {
  readOpenStackNames,
  readOpenStackOptions,
} from "./OpenStackProbeCollectionView";

/*
 * Two controls the cloud's forms and its Data Collection card draw: a list of names (regions,
 * certificates, what ports are read from), and what is read beyond the defaults.
 */

export interface OpenStackNamesFieldProps {
  // The names, as an array or as whatever was typed.
  value: unknown;
  onChange: (names: Array<string>) => void;
  onBlur?: (() => void) | undefined;
  placeholder?: string | undefined;
  // Long names go on a line each: a fingerprint is 95 characters.
  isMultiLine?: boolean | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
  tabIndex?: number | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  dataTestId?: string | undefined;
}

function joinNames(names: Array<string>, isMultiLine: boolean): string {
  return names.join(isMultiLine ? "\n" : ", ");
}

function isSameList(left: Array<string>, right: Array<string>): boolean {
  return (
    left.length === right.length &&
    left.every((name: string, index: number): boolean => {
      return name === right[index];
    })
  );
}

export const OpenStackNamesField: FunctionComponent<
  OpenStackNamesFieldProps
> = (props: OpenStackNamesFieldProps): ReactElement => {
  const names: Array<string> = readOpenStackNames(props.value);

  // What is typed stays as typed: "RegionOne, " is on its way to a second name.
  const [text, setText] = useState<string>(
    joinNames(names, Boolean(props.isMultiLine)),
  );

  // Something else set the list: "Use these regions", "Trust this certificate".
  useEffect(() => {
    if (!isSameList(readOpenStackNames(text), names)) {
      setText(joinNames(names, Boolean(props.isMultiLine)));
    }
  }, [names.join("\n")]);

  const onTextChange: (value: string) => void = (value: string): void => {
    setText(value);
    props.onChange(readOpenStackNames(value));
  };

  if (props.isMultiLine) {
    return (
      <TextArea
        value={text}
        onChange={onTextChange}
        placeholder={props.placeholder}
        error={props.error}
        rows={3}
        tabIndex={props.tabIndex}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        disableSpellCheck={true}
        dataTestId={props.dataTestId}
        {...(props.onBlur ? { onBlur: props.onBlur } : {})}
      />
    );
  }

  return (
    <Input
      value={text}
      onChange={onTextChange}
      onBlur={props.onBlur}
      placeholder={props.placeholder}
      error={props.error}
      disabled={props.disabled}
      tabIndex={props.tabIndex}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      dataTestId={props.dataTestId}
    />
  );
};

export interface OpenStackCollectionOptionsFieldProps {
  value: unknown;
  onChange: (options: OpenStackCollectionOptions) => void;
  disabled?: boolean | undefined;
  // A cloud that doesn't run Swift hears nothing of its storage servers.
  showsSwiftRecon?: boolean | undefined;
}

/*
 * What a collection reads beyond the agent's defaults. Both are off unless someone asks,
 * because each costs the cloud more, and this says what each costs where the choice is made.
 */
export const OpenStackCollectionOptionsField: FunctionComponent<
  OpenStackCollectionOptionsFieldProps
> = (props: OpenStackCollectionOptionsFieldProps): ReactElement => {
  const translator: Translator = useTranslator();
  const networksLabelId: string = useId();
  const projectsLabelId: string = useId();
  const reconLabelId: string = useId();
  const options: OpenStackCollectionOptions = readOpenStackOptions(props.value);

  const change: (changed: OpenStackCollectionOptions) => void = (
    changed: OpenStackCollectionOptions,
  ): void => {
    props.onChange({ ...options, ...changed });
  };

  return (
    <div className="space-y-4" data-testid="openstack-collection-options-field">
      <Toggle
        title={translator.translateText("Project limits")}
        description={translator.translateText(
          "Quotas and limits per project, for the Projects page. Costs four API calls per project, on every collection.",
        )}
        value={Boolean(options.collectProjectLimits)}
        disabled={props.disabled}
        dataTestId="openstack-option-project-limits"
        onChange={(value: boolean) => {
          change({ collectProjectLimits: value });
        }}
      />
      <Toggle
        title={translator.translateText("Ports")}
        description={translator.translateText(
          "One series per port, and how many have no address or a load balancer that is down. Name networks or projects: listing every port can saturate Neutron.",
        )}
        value={Boolean(options.collectPorts)}
        disabled={props.disabled}
        dataTestId="openstack-option-ports"
        onChange={(value: boolean) => {
          change({ collectPorts: value });
        }}
      />
      {options.collectPorts ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div
              id={networksLabelId}
              className="mb-1 text-xs font-medium text-gray-700"
            >
              {translator.translateText("Only these networks")}
            </div>
            <OpenStackNamesField
              value={options.portNetworkIds || []}
              ariaLabelledby={networksLabelId}
              placeholder="Network IDs"
              disabled={props.disabled}
              dataTestId="openstack-option-port-networks"
              onChange={(names: Array<string>) => {
                change({ portNetworkIds: names });
              }}
            />
          </div>
          <div>
            <div
              id={projectsLabelId}
              className="mb-1 text-xs font-medium text-gray-700"
            >
              {translator.translateText("Only these projects")}
            </div>
            <OpenStackNamesField
              value={options.portProjectIds || []}
              ariaLabelledby={projectsLabelId}
              placeholder="Project IDs"
              disabled={props.disabled}
              dataTestId="openstack-option-port-projects"
              onChange={(names: Array<string>) => {
                change({ portProjectIds: names });
              }}
            />
          </div>
        </div>
      ) : (
        <></>
      )}
      {props.showsSwiftRecon ? (
        <div>
          <div
            id={reconLabelId}
            className="mb-1 text-xs font-medium text-gray-700"
          >
            {translator.translateText("Swift's storage servers")}
          </div>
          <OpenStackNamesField
            value={options.swiftReconAddresses || []}
            ariaLabelledby={reconLabelId}
            placeholder="host:port"
            disabled={props.disabled}
            dataTestId="openstack-option-swift-recon"
            onChange={(names: Array<string>) => {
              change({ swiftReconAddresses: names });
            }}
          />
          <p className="mt-1 text-xs text-gray-500">
            {translator.translateText(
              "Only if this cloud runs Swift. Each server's /recon port, which isn't in Keystone's catalog. OneUptime reads replication and rings from it, 5 calls per server on each collection, and sends it no credential. Leave this empty to read none.",
            )}
          </p>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};
