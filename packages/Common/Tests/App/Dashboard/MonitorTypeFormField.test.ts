import { describe, expect, test } from "@jest/globals";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "../../../UI/Components/CardSelect/CardSelect";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import getMonitorTypeFormField, {
  MONITOR_TYPE_CATALOG,
  MONITOR_TYPE_FIELD_DESCRIPTION,
  MONITOR_TYPE_SEARCH_PLACEHOLDER,
  MORE_MONITOR_TYPES_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorTypeFormField";
import MonitorTypeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/MonitorType";

/*
 * The Monitor Type field every form offering the whole catalog draws: Create
 * Monitor, and a monitor template's create and edit forms. One helper, so the
 * three cannot drift apart - the wall of cards the maintainer called
 * "extremely confusing" came back on any page that built its own.
 */

describe("getMonitorTypeFormField", () => {
  const field: Field<Monitor> = getMonitorTypeFormField<Monitor>({
    stepId: "monitor-info",
  });

  test("is the required monitorType card picker", () => {
    expect(field.field).toEqual({ monitorType: true });
    expect(field.title).toBe("Monitor Type");
    expect(field.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(field.required).toBe(true);
  });

  test("asks the question the picker answers", () => {
    expect(field.description).toBe("What do you want to monitor?");
    expect(MONITOR_TYPE_FIELD_DESCRIPTION).toBe("What do you want to monitor?");
  });

  test("offers the whole categorised catalog", () => {
    expect(field.cardSelectOptions).toEqual(
      MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions(),
    );
  });

  test("has a search box that names the words it understands", () => {
    expect(field.cardSelectSearchable).toBe(true);
    expect(field.cardSelectSearchPlaceholder).toBe(
      "Search monitor types - try ping, ssl, k8s, postgres",
    );
    expect(MONITOR_TYPE_SEARCH_PLACEHOLDER).toBe(
      field.cardSelectSearchPlaceholder,
    );
  });

  test("lays the catalog out with the common types first and More for the rest", () => {
    expect(field.cardSelectCatalog).toBe(MONITOR_TYPE_CATALOG);
    expect(MONITOR_TYPE_CATALOG.commonOptionValues).toEqual(
      MonitorTypeHelper.getCommonMonitorTypes(),
    );
    expect(MONITOR_TYPE_CATALOG.moreOptionsText).toBe("More monitor types");
    expect(MORE_MONITOR_TYPES_TEXT).toBe("More monitor types");
  });

  test("is placed on the step the form asks for", () => {
    expect(field.stepId).toBe("monitor-info");
  });

  test("on a one-page form, belongs to no step", () => {
    expect(getMonitorTypeFormField<MonitorTemplate>().stepId).toBeUndefined();
  });

  test("lets a template say what kind of monitor it produces", () => {
    const templateField: Field<MonitorTemplate> =
      getMonitorTypeFormField<MonitorTemplate>({
        stepId: "monitor-defaults",
        description: "What kind of monitor will this template produce?",
      });

    expect(templateField.description).toBe(
      "What kind of monitor will this template produce?",
    );
    expect(templateField.stepId).toBe("monitor-defaults");
    expect(templateField.cardSelectCatalog).toBe(MONITOR_TYPE_CATALOG);
  });

  test("hands every form the same, unchanging catalog", () => {
    expect(getMonitorTypeFormField<Monitor>().cardSelectCatalog).toBe(
      getMonitorTypeFormField<MonitorTemplate>().cardSelectCatalog,
    );
  });

  test("builds no field that picks the same type twice", () => {
    const values: Array<string> = (
      field.cardSelectOptions as Array<CardSelectOptionGroup>
    ).flatMap((group: CardSelectOptionGroup): Array<string> => {
      return group.options.map((option: CardSelectOption): string => {
        return option.value;
      });
    });

    expect(new Set(values).size).toBe(values.length);
  });

  /*
   * Profiles and Server have no configuration form on Create Monitor, so the
   * catalog does not offer them - and neither may the common types.
   */
  test("never offers a type Create Monitor cannot configure", () => {
    expect(MONITOR_TYPE_CATALOG.commonOptionValues).not.toContain(
      MonitorType.Profiles,
    );
    expect(MONITOR_TYPE_CATALOG.commonOptionValues).not.toContain(
      MonitorType.Server,
    );
  });
});
