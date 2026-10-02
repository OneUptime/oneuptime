import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import useTranslateValue from "../../Utils/Translation";
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
 *
 * A NEW mapped field turns this around (offerEveryType): the field does not
 * have a type yet, it takes the type - and a dropdown's options - of the
 * field it copies. So every field of the source is offered, each with its
 * type under its name, and the one picked says which type the new field
 * will be.
 */

export interface ComponentProps {
  projectId: ObjectID;
  /** Definition table listing the fields available on the source resource. */
  sourceDefinitionModelType: DatabaseBaseModelType;
  /** How the source is named to the operator, e.g. "Monitor". */
  sourceTitle: string;
  /** The type this field holds; only same-typed sources can be mapped. */
  targetFieldType?: CustomFieldType | undefined;
  /*
   * For a field that is being created as a copy: offer every field of the
   * source, whatever its type, because the new field takes the type of the
   * one picked. targetFieldType is then ignored.
   */
  offerEveryType?: boolean | undefined;
  /*
   * A type's name as the settings pages name it ("Dropdown (single
   * select)"), in English - it is translated here. Shown under each field
   * when every type is offered, and for the picked one.
   */
  describeFieldType?:
    | ((type: CustomFieldType | undefined) => string | undefined)
    | undefined;
  // The picker's placeholder, translated here.
  placeholder?: string | undefined;
  /*
   * What to say when every type is offered and the source has no custom
   * fields at all, translated here.
   */
  noSourceFieldsMessage?: string | undefined;
  initialValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  tabIndex?: number | undefined;
  // The form field's label, which names the picker.
  ariaLabelledby?: string | undefined;
}

interface SourceField {
  name: string;
  customFieldType?: CustomFieldType | undefined;
}

const MapFromCustomFieldInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
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

      // A new field takes the type of the one it copies: any will do.
      if (props.offerEveryType) {
        return true;
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
      const option: DropdownOption = { label: field.name, value: field.name };

      const typeLabel: string | undefined = props.offerEveryType
        ? props.describeFieldType?.(field.customFieldType)
        : undefined;

      // The Dropdown translates an option's description itself.
      if (typeLabel) {
        option.description = typeLabel;
      }

      return option;
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

  if (props.offerEveryType && options.length === 0) {
    return (
      <ErrorMessage
        message={
          props.noSourceFieldsMessage ||
          `No ${props.sourceTitle} custom field exists in this project yet. Create one first.`
        }
      />
    );
  }

  if (!props.offerEveryType && !props.targetFieldType) {
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

  /*
   * The type the new field will have: the picked field's. Said under the
   * picker, because the menu's line under each name is gone once one is
   * picked.
   */
  const selectedField: SourceField | undefined = props.offerEveryType
    ? sourceFields.find((field: SourceField) => {
        return field.name === selectedValue;
      })
    : undefined;

  const selectedTypeLabel: string | undefined = selectedField
    ? props.describeFieldType?.(selectedField.customFieldType)
    : undefined;

  const placeholder: string =
    props.placeholder || `Select a ${props.sourceTitle} custom field`;

  return (
    <div>
      <Dropdown
        options={options}
        value={options.find((option: DropdownOption) => {
          return option.value === selectedValue;
        })}
        tabIndex={props.tabIndex}
        error={props.error}
        placeholder={placeholder}
        ariaLabelledby={props.ariaLabelledby}
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
      {selectedTypeLabel && (
        <p
          className="mt-2 text-sm text-gray-500"
          data-testid="map-from-selected-field-type"
        >
          {translateString("Field Type") ?? "Field Type"}:{" "}
          <span className="font-medium text-gray-700">
            {translateString(selectedTypeLabel) ?? selectedTypeLabel}
          </span>
        </p>
      )}
    </div>
  );
};

export default MapFromCustomFieldInput;
