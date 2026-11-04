import { HUNTS_TEST_IDS } from "./HuntsCopy";
import {
  getHuntFilterChips,
  hasHuntSourceFilter,
  removeHuntFilterValue,
} from "./HuntsModel";
import Service from "Common/Models/DatabaseModels/Service";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { SecurityHuntFilters } from "Common/Types/SecurityEvent/SecurityHunt";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import TelemetryActiveFilterChips from "Common/UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
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
 * A hunt's filters in its Edit form: the chips the Events sidebar made,
 * drawn as the Events explorer draws them over its list - "Severity: High",
 * "Status is not: Failure" in red, an attribute by its key - each with its
 * x, and Clear all once there are two. What is taken off here is taken off
 * the hunt when the form is saved; filters are added on the hunt's page,
 * from the explorer's sidebar.
 *
 * A source is a service's id: drawn by the service's name, read when the
 * hunt has one.
 */
const HuntFormFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});
  const needsSourceNames: boolean = hasHuntSourceFilter(props.value);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!needsSourceNames || !projectId) {
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getList<Service>({
      modelType: Service,
      query: { projectId },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true },
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ListResult<Service>) => {
        if (!isCurrent) {
          return;
        }

        const names: Record<string, string> = {};

        for (const service of result.data) {
          if (service.id && service.name) {
            names[service.id.toString()] = service.name;
          }
        }

        setSourceNames(names);
      })
      .catch(() => {
        // Not read: a source chip keeps its id, and can still be taken off.
      });

    return () => {
      isCurrent = false;
    };
  }, [needsSourceNames]);

  return (
    <div data-testid={HUNTS_TEST_IDS.formFilters}>
      <TelemetryActiveFilterChips
        filters={getHuntFilterChips(props.value, sourceNames)}
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
