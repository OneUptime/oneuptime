import React, { FunctionComponent, ReactElement, useState } from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  INFRASTRUCTURE_ADD_EXPLANATION,
  INFRASTRUCTURE_NOTHING_SENDING,
  INFRASTRUCTURE_QUIET,
  INFRASTRUCTURE_RECEIVING_DATA,
  ResourceDataState,
  getResourceDataState,
} from "./InfrastructureMonitorSetupText";

/*
 * The first thing an infrastructure monitor asks: which host, cluster,
 * vCenter, array or fleet to watch.
 *
 * - None yet: says so, and offers the type's Add button, which opens its
 *   install steps - keys filled in - and waits for the first data. The one
 *   that connects is picked.
 * - Picked: says whether it is sending data (its lastSeenAt), so a monitor
 *   is never set up in the dark on an agent that stopped.
 * - Any time: the Add button sits under the list too.
 */

export interface AddInfrastructureResource {
  // The type's Add button ("Add Host", "Add Kubernetes Cluster").
  title: string;
  /*
   * The type's add dialog. `onConnected` hands back the value the new
   * resource is picked by - its identifier, as the dropdown's options carry
   * it. Left out: `onClick` instead, for a type added on its own page.
   */
  renderModal?:
    | ((input: {
        onClose: () => void;
        onConnected: (value: string) => void;
      }) => ReactElement)
    | undefined;
  onClick?: (() => void) | undefined;
}

export interface ComponentProps {
  // "Host", "Kubernetes Cluster": the field's title, as before.
  title: string;
  placeholder: string;
  options: Array<DropdownOption>;
  value: string | undefined;
  onChange: (value: string) => void;
  isLoading: boolean;
  lastSeenAtByValue: Record<string, Date | undefined>;
  addResource?: AddInfrastructureResource | undefined;
  /*
   * After a resource was added from here: read the list again and pick the
   * new one.
   */
  onResourceAdded?: ((value: string) => void) | undefined;
}

const InfrastructureResourceField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isAdding, setIsAdding] = useState<boolean>(false);

  const hasResources: boolean = props.options.length > 0;

  const openAdd: () => void = (): void => {
    if (props.addResource?.renderModal) {
      setIsAdding(true);
      return;
    }

    props.addResource?.onClick?.();
  };

  const renderStatus: () => ReactElement | null = (): ReactElement | null => {
    if (!props.value) {
      return null;
    }

    const lastSeenAt: Date | undefined = props.lastSeenAtByValue[props.value];

    const state: ResourceDataState = getResourceDataState({
      lastSeenAt: lastSeenAt,
      now: OneUptimeDate.getCurrentDate(),
    });

    if (state === ResourceDataState.Unknown || !lastSeenAt) {
      return null;
    }

    const isReceiving: boolean = state === ResourceDataState.Receiving;

    return (
      <p
        className="mt-2 flex items-center gap-2 text-sm text-gray-600"
        data-testid="infrastructure-resource-data-state"
        data-state={state}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            isReceiving ? "bg-green-500" : "bg-amber-500"
          }`}
        ></span>
        <span>
          {translator.translateTemplate(
            isReceiving ? INFRASTRUCTURE_RECEIVING_DATA : INFRASTRUCTURE_QUIET,
            { time: OneUptimeDate.fromNow(lastSeenAt) },
          )}
        </span>
      </p>
    );
  };

  return (
    <div className="mb-6" data-testid="infrastructure-resource-field">
      <FieldLabelElement title={props.title} required={true} />

      {!hasResources && !props.isLoading ? (
        <div
          className="rounded-md border border-dashed border-gray-300 p-4"
          data-testid="infrastructure-resource-empty"
        >
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText(INFRASTRUCTURE_NOTHING_SENDING)}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {translator.translateText(INFRASTRUCTURE_ADD_EXPLANATION)}
          </p>
          {props.addResource ? (
            <div className="mt-3">
              <Button
                title={props.addResource.title}
                icon={IconProp.Add}
                buttonStyle={ButtonStyleType.PRIMARY}
                buttonSize={ButtonSize.Small}
                onClick={openAdd}
                dataTestId="infrastructure-resource-add"
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <>
          <Dropdown
            options={props.options}
            value={props.options.find((option: DropdownOption) => {
              return option.value === props.value;
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              props.onChange((value as string) || "");
            }}
            placeholder={props.placeholder}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-4">
            {renderStatus() || <span></span>}
            {props.addResource ? (
              <Button
                title={props.addResource.title}
                icon={IconProp.Add}
                buttonStyle={ButtonStyleType.LINK}
                buttonSize={ButtonSize.Small}
                onClick={openAdd}
                dataTestId="infrastructure-resource-add"
              />
            ) : (
              <></>
            )}
          </div>
        </>
      )}

      {isAdding && props.addResource?.renderModal ? (
        props.addResource.renderModal({
          onClose: () => {
            setIsAdding(false);
          },
          onConnected: (value: string) => {
            props.onResourceAdded?.(value);
          },
        })
      ) : (
        <></>
      )}
    </div>
  );
};

export default InfrastructureResourceField;
