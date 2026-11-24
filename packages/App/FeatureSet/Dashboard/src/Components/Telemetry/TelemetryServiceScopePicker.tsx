import {
  getUnknownServiceScopeOption,
  useTelemetryScopeHeldOptions,
} from "./TelemetryServiceScope";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { DropdownChange } from "Common/UI/Components/Dropdown/DropdownChange";
import EntityDropdown, {
  EntityDropdownValue,
} from "Common/UI/Components/EntityDropdown/EntityDropdown";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "Common/UI/Components/EntityDropdown/EntityDropdownNotFound";
import {
  getHeldValue,
  HeldValueOptions,
} from "Common/UI/Components/EntityDropdown/HeldValueOptions";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE SERVICES A TELEMETRY INSIGHTS TAB IS SCOPED TO, SEARCHED ON THE
 * SERVER (#10764).
 *
 * The Metrics and Traces Insights tabs offered the project's first 10,000
 * services by name: a service past them could not be found or picked. The
 * picker searches the server as it is typed in (EntityDropdown), 50 by
 * name, archived services too - they keep collecting telemetry - marked
 * Archived. "Unknown Service", the telemetry that named no service, is
 * offered beside them while the page's telemetry has some, and kept while
 * the scope holds it.
 *
 * What the scope holds - from the Viewer tab, a link or a saved view - is
 * named by its ids before the picker is drawn (TelemetryServiceScope): a
 * service by its name, another telemetry entity (a RUM application, a
 * host) by its own table, one gone as "No longer available", to keep or
 * take out. Nothing it holds is dropped or changed until it is.
 */

export interface ComponentProps {
  serviceIds: Array<string>;
  onChange: (serviceIds: Array<string>) => void;
  // Whether the page's telemetry names no service somewhere.
  offersUnknownService: boolean;
  // English, looked up here.
  placeholder: string;
  ariaLabel: string;
  dataTestId?: string | undefined;
}

// What the picker hands back, as the scope's ids.
const toServiceIds: (
  value: DropdownValue | Array<DropdownValue> | null,
) => Array<string> = (
  value: DropdownValue | Array<DropdownValue> | null,
): Array<string> => {
  if (value === null || value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value])
    .map((entry: DropdownValue): string => {
      return String(entry);
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    });
};

const TelemetryServiceScopePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const held: HeldValueOptions = useTelemetryScopeHeldOptions(props.serviceIds);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Drawn once what the scope holds is named: never its bare ids.
  if (!held.options && props.serviceIds.length > 0) {
    return (
      <div
        data-testid={
          props.dataTestId ? `${props.dataTestId}-loading` : undefined
        }
      >
        <InlineValueSkeleton />
      </div>
    );
  }

  const holdsUnknownService: boolean = props.serviceIds.some(
    (serviceId: string): boolean => {
      return TelemetryServiceUtil.isUnknownServiceId(serviceId, projectId);
    },
  );

  const offeredOptions: Array<DropdownOption> =
    projectId && (props.offersUnknownService || holdsUnknownService)
      ? [getUnknownServiceScopeOption(projectId.toString())]
      : [];

  return (
    <EntityDropdown
      modelType={Service}
      labelField="name"
      valueField="_id"
      isMultiSelect={true}
      // A scope is a few services picked by name, never bulk-added by label.
      enableLabelsTab={false}
      listsArchivedValues={true}
      marksArchivedRecords={true}
      notFoundLabel={ENTITY_DROPDOWN_NOT_FOUND_LABEL}
      options={offeredOptions}
      value={
        getHeldValue({
          ids: props.serviceIds,
          options: held.options,
        }) as EntityDropdownValue
      }
      placeholder={props.placeholder}
      ariaLabel={translator.translateText(props.ariaLabel)}
      dataTestId={props.dataTestId}
      className="relative w-full"
      onChange={(
        next: DropdownValue | Array<DropdownValue> | null,
        change: DropdownChange,
      ): void => {
        // A service just picked is named by the search that offered it.
        held.remember(change.selectedOptions);
        props.onChange(toServiceIds(next));
      }}
    />
  );
};

export default TelemetryServiceScopePicker;
