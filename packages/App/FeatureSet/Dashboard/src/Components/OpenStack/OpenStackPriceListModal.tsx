import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_PRICE_LIST_DEFAULT_CURRENCY,
  isOpenStackCurrency,
} from "Common/Types/OpenStack/OpenStackPriceList";
import { OPENSTACK_HOURS_IN_A_MONTH } from "Common/Types/OpenStack/OpenStackProjectUsage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * WHAT THINGS COST, IN THE OPERATOR'S OWN WORDS.
 *
 * Prices per unit and an hour, in one currency, and nothing's asked for that most people don't need:
 * a price per flavor or per volume type waits under Advanced, for what this cloud has actually used.
 * Empty and zero both mean no price, which the page says rather than calling anything free.
 */

const CURRENCY: string = "currency";
const UNIT_PRICES: ReadonlyArray<{ key: string; title: string; hint: string }> =
  [
    {
      key: "vcpuHour",
      title: translationKey("Per vCPU, per hour"),
      hint: translationKey("Of every instance, by its flavor."),
    },
    {
      key: "memoryGbHour",
      title: translationKey("Per GB of memory, per hour"),
      hint: translationKey("Of every instance, by its flavor."),
    },
    {
      key: "volumeGbHour",
      title: translationKey("Per GB of volume, per hour"),
      hint: translationKey("Attached or not. A volume type can have its own."),
    },
    {
      key: "floatingIpHour",
      title: translationKey("Per floating IP, per hour"),
      hint: translationKey("Associated or not."),
    },
    {
      key: "imageGbHour",
      title: translationKey("Per GB of image, per hour"),
      hint: translationKey("To the project that owns it."),
    },
    {
      key: "snapshotGbHour",
      title: translationKey("Per GB of snapshot, per hour"),
      hint: translationKey("Of volume snapshots, at their size."),
    },
  ];

const LEAVE_OUT_SHUT_OFF: string = "leaveOutShutOff";

function flavorKey(name: string): string {
  return `flavor:${name}`;
}

function typeKey(name: string): string {
  return `type:${name}`;
}

// A number as a form sends it, kept only when it's a price. Empty and zero are no price.
function toPrice(value: unknown): number {
  const price: number = Number(value);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function getOpenStackPriceListFromForm(data: {
  values: JSONObject;
  flavorNames: ReadonlyArray<string>;
  volumeTypes: ReadonlyArray<string>;
}): JSONObject {
  const list: JSONObject = {
    currency: isOpenStackCurrency(data.values[CURRENCY])
      ? (data.values[CURRENCY] as string).trim().toUpperCase()
      : OPENSTACK_PRICE_LIST_DEFAULT_CURRENCY,
    leaveOutShutOff: data.values[LEAVE_OUT_SHUT_OFF] === true,
  };

  for (const unit of UNIT_PRICES) {
    list[unit.key] = toPrice(data.values[unit.key]);
  }

  const flavorHour: JSONObject = {};

  for (const name of data.flavorNames) {
    const price: number = toPrice(data.values[flavorKey(name)]);
    if (price > 0) {
      flavorHour[name] = price;
    }
  }

  const volumeTypeGbHour: JSONObject = {};

  for (const type of data.volumeTypes) {
    const price: number = toPrice(data.values[typeKey(type)]);
    if (price > 0) {
      volumeTypeGbHour[type] = price;
    }
  }

  list["flavorHour"] = flavorHour;
  list["volumeTypeGbHour"] = volumeTypeGbHour;

  return list;
}

export function getOpenStackPriceListFormValues(data: {
  stored: JSONObject | null;
  flavorNames: ReadonlyArray<string>;
  volumeTypes: ReadonlyArray<string>;
}): JSONObject {
  const stored: JSONObject = data.stored || {};
  const flavorHour: JSONObject = (stored["flavorHour"] as JSONObject) || {};
  const volumeTypeGbHour: JSONObject =
    (stored["volumeTypeGbHour"] as JSONObject) || {};
  const values: JSONObject = {
    [CURRENCY]:
      (stored["currency"] as string) || OPENSTACK_PRICE_LIST_DEFAULT_CURRENCY,
    [LEAVE_OUT_SHUT_OFF]: stored["leaveOutShutOff"] === true,
  };
  const shown: (price: unknown) => string = (price: unknown): string => {
    return toPrice(price) > 0 ? String(price) : "";
  };

  for (const unit of UNIT_PRICES) {
    values[unit.key] = shown(stored[unit.key]);
  }

  for (const name of data.flavorNames) {
    values[flavorKey(name)] = shown(flavorHour[name]);
  }

  for (const type of data.volumeTypes) {
    values[typeKey(type)] = shown(volumeTypeGbHour[type]);
  }

  return values;
}

export interface ComponentProps {
  openStackCloudId: ObjectID;
  stored: JSONObject | null;
  // What this cloud has used: flavors by name, because an id is different in each region.
  flavorNames: ReadonlyArray<string>;
  volumeTypes: ReadonlyArray<string>;
  onClose: () => void;
  onSaved: () => void;
}

const OpenStackPriceListModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const advanced: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>();
  const priceValidation: (
    values: FormValues<JSONObject>,
    key: string,
  ) => string | null = (
    values: FormValues<JSONObject>,
    key: string,
  ): string | null => {
    const value: unknown = (values as JSONObject)[key];

    if (value === undefined || value === null || value === "") {
      return null;
    }

    const price: number = Number(value);

    return Number.isFinite(price) && price >= 0
      ? null
      : translator.translateText(
          translationKey("Write a price as a number, such as 0.02."),
        ) || "";
  };

  const fields: Fields<JSONObject> = [
    {
      field: { [CURRENCY]: true },
      title: translationKey("Currency"),
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: OPENSTACK_PRICE_LIST_DEFAULT_CURRENCY,
      description: translationKey(
        "Three letters: USD, EUR, GBP. These are your own numbers, and nothing converts them.",
      ),
      customValidation: (values: FormValues<JSONObject>): string | null => {
        return isOpenStackCurrency((values as JSONObject)[CURRENCY])
          ? null
          : translator.translateText(
              translationKey(
                "Write a currency as three letters, such as USD or EUR.",
              ),
            ) || "";
      },
    } as Fields<JSONObject>[number],
    ...UNIT_PRICES.map(
      (unit: {
        key: string;
        title: string;
        hint: string;
      }): Fields<JSONObject>[number] => {
        return {
          field: { [unit.key]: true },
          title: unit.title,
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "0.00",
          description: unit.hint,
          customValidation: (values: FormValues<JSONObject>): string | null => {
            return priceValidation(values, unit.key);
          },
        } as Fields<JSONObject>[number];
      },
    ),
    {
      field: { [LEAVE_OUT_SHUT_OFF]: true },
      title: translationKey("Leave out shut-off instances"),
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: advanced,
      description: translationKey(
        "A shut-off instance keeps its vCPUs and memory set aside on its host, so it counts unless this is on.",
      ),
    } as Fields<JSONObject>[number],
    ...props.flavorNames.map((name: string): Fields<JSONObject>[number] => {
      return {
        field: { [flavorKey(name)]: true },
        title: translator.translateTemplate(
          translationKey("{{flavor}}, per instance, per hour"),
          { flavor: name },
        ),
        fieldType: FormFieldSchemaType.Text,
        required: false,
        placeholder: "0.00",
        collapsibleSection: advanced,
        customValidation: (values: FormValues<JSONObject>): string | null => {
          return priceValidation(values, flavorKey(name));
        },
      } as Fields<JSONObject>[number];
    }),
    ...props.volumeTypes
      .filter((type: string): boolean => {
        return type.length > 0;
      })
      .map((type: string): Fields<JSONObject>[number] => {
        return {
          field: { [typeKey(type)]: true },
          title: translator.translateTemplate(
            translationKey("{{type}} volumes, per GB, per hour"),
            { type },
          ),
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "0.00",
          collapsibleSection: advanced,
          customValidation: (values: FormValues<JSONObject>): string | null => {
            return priceValidation(values, typeKey(type));
          },
        } as Fields<JSONObject>[number];
      }),
  ];

  return (
    <BasicFormModal<JSONObject>
      title={translationKey("Prices")}
      description={translator.translateTemplate(
        translationKey(
          "Your own numbers per hour, for an estimate of what usage comes to. A month is about {{hours}} hours. A price left empty means no price, not free.",
        ),
        { hours: OPENSTACK_HOURS_IN_A_MONTH.toString() },
      )}
      isLoading={isSaving}
      error={error}
      submitButtonText={translationKey("Save prices")}
      onClose={props.onClose}
      onSubmit={(values: JSONObject): void => {
        setIsSaving(true);
        setError("");
        ModelAPI.updateById({
          modelType: OpenStackCloud,
          id: props.openStackCloudId,
          data: {
            priceList: getOpenStackPriceListFromForm({
              values,
              flavorNames: props.flavorNames,
              volumeTypes: props.volumeTypes,
            }),
          },
        })
          .then(() => {
            setIsSaving(false);
            props.onSaved();
          })
          .catch((err: unknown) => {
            setIsSaving(false);
            setError(API.getFriendlyErrorMessage(err as Error));
          });
      }}
      formProps={{
        id: "openstack-price-list-form",
        name: "OpenStack Prices",
        initialValues: getOpenStackPriceListFormValues({
          stored: props.stored,
          flavorNames: props.flavorNames,
          volumeTypes: props.volumeTypes,
        }),
        fields,
      }}
    />
  );
};

export default OpenStackPriceListModal;
