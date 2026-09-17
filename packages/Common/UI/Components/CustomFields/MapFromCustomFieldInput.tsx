import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Picks the field a custom field copies its value from
 * (OneUptime/oneuptime#3549) — the "map from" half of the settings form.
 *
 * WHY THIS IS A CUSTOM COMPONENT AND NOT `fetchDropdownOptions`. The list of
 * offerable fields depends on ANOTHER value in the same form: only source
 * fields of the same type can be mapped, so choosing "Number" has to change
 * what this picker shows. `Field.fetchDropdownOptions` is awaited from a
 * `useAsyncEffect` in BasicForm whose dependency array is
 * `[props.fields, currentFormStepId]` — it does not re-run when a value
 * changes, so a picker built on it would keep offering the previous type's
 * fields. `getCustomElement` receives the live form values on every render
 * instead, which is the route three other call sites in this codebase already
 * take for exactly this reason.
 *
 * A configured value that is no longer offered — the source field was renamed
 * or deleted — is still shown, flagged. The mapping has quietly stopped
 * resolving at that point, and the settings page is the only place anyone
 * would find out.
 */

export interface ComponentProps {
  projectId: ObjectID;
  /** Definition table listing the fields available on the source resource. */
  sourceDefinitionModelType: DatabaseBaseModelType;
  /** How the source is named to the operator, e.g. "Monitor". */
  sourceTitle: string;
  /** The type this field holds; only same-typed sources can be mapped. */
  targetFieldType?: CustomFieldType | undefined;
  initialValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  tabIndex?: number | undefined;
}

interface SourceField {
  name: string;
  customFieldType?: CustomFieldType | undefined;
}

const MapFromCustomFieldInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [sourceFields, setSourceFields] = useState<Array<SourceField>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [selectedValue, setSelectedValue] = useState<string>(
    props.initialValue || "",
  );

  const sourceModelName: string = props.sourceDefinitionModelType.name;

  useEffect(() => {
    let isMounted: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        setIsLoading(true);
        setLoadError("");

        const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>(
          {
            modelType: props.sourceDefinitionModelType,
            query: {
              projectId: props.projectId,
            } as any,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              name: true,
              customFieldType: true,
            } as any,
            sort: {},
          },
        );

        if (!isMounted) {
          return;
        }

        setSourceFields(
          result.data.map((item: BaseModel): SourceField => {
            return {
              name: (item as any)["name"],
              customFieldType: (item as any)["customFieldType"],
            };
          }),
        );
        setIsLoading(false);
      } catch (err) {
        if (!isMounted) {
          return;
        }

        setIsLoading(false);
        setLoadError(API.getFriendlyMessage(err));
      }
    };

    load().catch(() => {
      // load() reports its own failures through loadError.
    });

    return () => {
      isMounted = false;
    };
    /*
     * The source list is per-project and per-source-table; neither changes
     * while this input is mounted. The type filter below is applied on each
     * render instead, so choosing a different field type re-filters without a
     * refetch.
     */
  }, [props.projectId.toString(), sourceModelName]);

  const options: Array<DropdownOption> = sourceFields
    .filter((field: SourceField) => {
      if (!field.name) {
        return false;
      }

      /*
       * With no type chosen yet there is nothing to be compatible with, so
       * offer nothing rather than a list that will be rejected on save.
       */
      if (!props.targetFieldType) {
        return false;
      }

      return field.customFieldType === props.targetFieldType;
    })
    .map((field: SourceField): DropdownOption => {
      return { label: field.name, value: field.name };
    });

  const isSelectedValueOffered: boolean = options.some(
    (option: DropdownOption) => {
      return option.value === selectedValue;
    },
  );

  if (selectedValue && !isSelectedValueOffered) {
    options.unshift({
      label: `${selectedValue} (no longer available on ${props.sourceTitle})`,
      value: selectedValue,
    });
  }

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (loadError) {
    return <ErrorMessage message={loadError} />;
  }

  if (!props.targetFieldType) {
    return (
      <ErrorMessage message="Choose a field type above before picking the field to map from." />
    );
  }

  if (options.length === 0) {
    return (
      <ErrorMessage
        message={`No ${props.sourceTitle} custom field of this type exists in this project. Create one first, or choose a different field type.`}
      />
    );
  }

  return (
    <Dropdown
      options={options}
      value={options.find((option: DropdownOption) => {
        return option.value === selectedValue;
      })}
      tabIndex={props.tabIndex}
      error={props.error}
      placeholder={`Select a ${props.sourceTitle} custom field`}
      onBlur={() => {
        if (props.onBlur) {
          props.onBlur();
        }
      }}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        const nextValue: string = value ? value.toString() : "";

        setSelectedValue(nextValue);

        if (props.onChange) {
          props.onChange(nextValue);
        }
      }}
    />
  );
};

export default MapFromCustomFieldInput;
