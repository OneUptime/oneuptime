import {
  SERVICE_SCOPE_FACET_KEY,
  TELEMETRY_SCOPE_KIND_FIELD,
  TelemetryScopeKind,
  createTelemetryScopeChoicesAPI,
  encodeTelemetryScopeValue,
  getTelemetryScopeKind,
  getTelemetryScopeSearchKinds,
  useTelemetryResourceScopeHeldOptions,
} from "./TelemetryResourceScope";
import { getUnknownServiceScopeOption } from "./TelemetryServiceScope";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
  HeldValueOptions,
  getHeldValue,
} from "Common/UI/Components/EntityDropdown/HeldValueOptions";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
} from "react";

/*
 * THE SERVICES, HOSTS AND OTHER RESOURCES A TELEMETRY INSIGHTS TAB IS
 * SCOPED TO, SEARCHED ON THE SERVER (#10921).
 *
 * Logs > Insights' scope picker: the shared EntityDropdown, as the Metrics
 * and Traces Insights tabs' services picker is (TelemetryServiceScopePicker),
 * searching the services and every kind of resource the page offers at
 * once (TelemetryResourceScope) - 50 a search, a fair share for each kind,
 * each record's kind beside its name ("web-01 · Host"), archived ones
 * marked Archived. "Unknown Service", the telemetry that named no service,
 * is offered beside them while the page's telemetry has some, and kept
 * while the scope holds it.
 *
 * What the scope holds - from the Viewer tab, a link or a saved view - is
 * named by its values before the picker is drawn: never a bare id, and one
 * gone as "No longer available", to keep or take out. Nothing it holds is
 * dropped or changed until it is.
 */

export interface ComponentProps {
  // The scope: "<facetKey>:<id>" values (TelemetryResourceScope).
  values: Array<string>;
  onChange: (values: Array<string>) => void;
  /*
   * The kinds of resource searched beside the services, by facet key
   * ("hostId"): the kinds the page's telemetry has. A kind the scope holds
   * is searched too.
   */
  resourceFacetKeys: Array<string>;
  // Whether the page's telemetry names no service somewhere.
  offersUnknownService: boolean;
  // English, looked up here.
  placeholder: string;
  ariaLabel: string;
  dataTestId?: string | undefined;
}

// What the picker hands back, as the scope's values.
const toScopeValues: (
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

const TelemetryResourceScopePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const held: HeldValueOptions = useTelemetryResourceScopeHeldOptions(
    props.values,
  );
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const searchKinds: Array<string> = getTelemetryScopeSearchKinds({
    resourceFacetKeys: props.resourceFacetKeys,
    values: props.values,
  });
  const searchKindsKey: string = searchKinds.join("|");

  // One API for as long as the kinds it searches are the same.
  const modelAPI: typeof ModelAPI = useMemo(() => {
    return createTelemetryScopeChoicesAPI(searchKinds);
  }, [searchKindsKey]);

  /*
   * A record as the list draws it: its name as written, its kind beside it
   * in the reader's words, so a host and a service of one name are told
   * apart.
   */
  const formatOption: (
    option: DropdownOption,
    record: BaseModel,
  ) => DropdownOption = useCallback(
    (option: DropdownOption, record: BaseModel): DropdownOption => {
      const kind: TelemetryScopeKind | undefined = getTelemetryScopeKind(
        String(
          (record as unknown as Record<string, unknown>)[
            TELEMETRY_SCOPE_KIND_FIELD
          ] || "",
        ),
      );

      return {
        ...option,
        // What its owner named it, drawn as written.
        isUserContent: true,
        ...(kind
          ? { description: translator.translateText(kind.label) || kind.label }
          : {}),
      };
    },
    [translator.language],
  );

  // Drawn once what the scope holds is named: never its bare ids.
  if (!held.options && props.values.length > 0) {
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

  const unknownServiceValue: string | null = projectId
    ? encodeTelemetryScopeValue(SERVICE_SCOPE_FACET_KEY, projectId.toString())
    : null;

  const holdsUnknownService: boolean = props.values.some(
    (value: string): boolean => {
      const separator: number = value.indexOf(":");

      return (
        separator > 0 &&
        value.substring(0, separator) === SERVICE_SCOPE_FACET_KEY &&
        TelemetryServiceUtil.isUnknownServiceId(
          value.substring(separator + 1),
          projectId,
        )
      );
    },
  );

  const offeredOptions: Array<DropdownOption> =
    unknownServiceValue && (props.offersUnknownService || holdsUnknownService)
      ? [
          {
            ...getUnknownServiceScopeOption(projectId!.toString()),
            value: unknownServiceValue,
          },
        ]
      : [];

  return (
    <EntityDropdown
      modelType={Service}
      modelAPI={modelAPI}
      labelField="name"
      valueField="_id"
      isMultiSelect={true}
      // A scope is a few records picked by name, never bulk-added by label.
      enableLabelsTab={false}
      listsArchivedValues={true}
      marksArchivedRecords={true}
      notFoundLabel={ENTITY_DROPDOWN_NOT_FOUND_LABEL}
      options={offeredOptions}
      formatOption={formatOption}
      value={
        getHeldValue({
          ids: props.values,
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
        // A record just picked is named by the search that offered it.
        held.remember(change.selectedOptions);
        props.onChange(toScopeValues(next));
      }}
    />
  );
};

export default TelemetryResourceScopePicker;
