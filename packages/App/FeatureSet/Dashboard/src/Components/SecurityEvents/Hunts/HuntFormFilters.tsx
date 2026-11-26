import { HUNTS_TEST_IDS } from "./HuntsCopy";
import {
  getHuntFilterChips,
  getHuntSourceValues,
  removeHuntFilterValue,
} from "./HuntsModel";
import Service from "Common/Models/DatabaseModels/Service";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import ObjectID from "Common/Types/ObjectID";
import { SecurityHuntFilters } from "Common/Types/SecurityEvent/SecurityHunt";
import { ENTITY_DROPDOWN_NOT_FOUND_LABEL } from "Common/UI/Components/EntityDropdown/EntityDropdownNotFound";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import TelemetryActiveFilterChips from "Common/UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import RecordsById from "Common/UI/Utils/RecordsById";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  // The form's filters, as a hunt keeps them.
  value: unknown;
  onChange: (filters: SecurityHuntFilters) => void;
}

/*
 * What a source a hunt names reads as, by the value it is kept as: the
 * service's name, or - for an id no service answers to any more - that it
 * is gone (NOT_FOUND). A value that is no id is drawn as written.
 */
type SourceNames = Record<string, string>;

const NOT_FOUND: string = "\u0000not-found";

/*
 * A hunt's filters in its Edit form: the chips the Events sidebar made,
 * drawn as the Events explorer draws them over its list - "Severity: High",
 * "Status is not: Failure" in red, an attribute by its key - each with its
 * x, and Clear all once there are two. What is taken off here is taken off
 * the hunt when the form is saved; filters are added on the hunt's page,
 * from the explorer's sidebar.
 *
 * A source is a service's id: drawn by the service's name, read by the ids
 * the hunt holds (RecordsById) - never looked for among the project's first
 * 10,000 services by name, past which a hunt's source read as its bare id
 * (#10921). One deleted since reads "No longer available", and is taken
 * off like any other chip.
 */
const HuntFormFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [sourceNames, setSourceNames] = useState<SourceNames>({});
  const sources: Array<string> = getHuntSourceValues(props.value);
  const sourcesKey: string = sources
    .map((source: string): string => {
      return source.trim().toLowerCase();
    })
    .sort()
    .join("|");

  useEffect(() => {
    // Ids not read yet: a value that is no id is never asked for.
    const toRead: Array<string> = sources.filter((source: string): boolean => {
      return (
        sourceNames[source] === undefined && ObjectID.isValidUUID(source.trim())
      );
    });

    if (toRead.length === 0) {
      return;
    }

    let isCurrent: boolean = true;

    RecordsById.read<Service>({
      modelType: Service,
      ids: toRead,
      select: { name: true },
    })
      .then((services: Array<Service>) => {
        if (!isCurrent) {
          return;
        }

        const byId: Map<string, Service> = RecordsById.byValue<Service>({
          records: services,
        });

        setSourceNames((current: SourceNames): SourceNames => {
          const next: SourceNames = { ...current };

          for (const source of toRead) {
            const service: Service | undefined = byId.get(
              source.trim().toLowerCase(),
            );

            // Asked for by its id, and not there: deleted since.
            next[source] = service?.name?.toString() || NOT_FOUND;
          }

          return next;
        });
      })
      .catch(() => {
        // Not read: a source chip keeps its id, and can still be taken off.
      });

    return () => {
      isCurrent = false;
    };
  }, [sourcesKey]);

  // Each source by its name, one gone in the reader's words.
  const drawnNames: SourceNames = {};

  for (const [source, name] of Object.entries(sourceNames)) {
    drawnNames[source] =
      name === NOT_FOUND
        ? translator.translateText(ENTITY_DROPDOWN_NOT_FOUND_LABEL) ||
          ENTITY_DROPDOWN_NOT_FOUND_LABEL
        : name;
  }

  return (
    <div data-testid={HUNTS_TEST_IDS.formFilters}>
      <TelemetryActiveFilterChips
        filters={getHuntFilterChips(props.value, drawnNames)}
        onRemove={(facetKey: string, value: string) => {
          props.onChange(removeHuntFilterValue(props.value, facetKey, value));
        }}
        onClearAll={() => {
          props.onChange({});
        }}
      />
    </div>
  );
};

// The Edit form's Filters field draws this, from the form's values.
export function renderHuntFormFilters(
  values: FormValues<SecurityHunt>,
  elementProps: CustomElementProps,
): ReactElement {
  return (
    <HuntFormFilters
      value={(values as Record<string, unknown>)["filters"]}
      onChange={(filters: SecurityHuntFilters) => {
        elementProps.onChange?.(filters);
      }}
    />
  );
}

export default HuntFormFilters;
