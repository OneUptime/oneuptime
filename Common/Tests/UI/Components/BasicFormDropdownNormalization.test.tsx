import BasicForm from "../../../UI/Components/Forms/BasicForm";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ObjectID from "../../../Types/ObjectID";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * BasicForm's initial-values effect canonicalizes each Dropdown field's stored
 * value onto the matching option. It used to finish with
 *
 *   values[fieldName] = dropdownOption?.value || null;
 *
 * which silently replaced any value that matched no option with null. That is
 * data loss, not cosmetics: ModelForm submits every selected field, so an
 * untouched field whose value was wiped here is PUT back as null and clears
 * the column.
 *
 * Options legitimately fail to contain a valid stored value — a
 * permission-scoped or truncated entity list, an options fetch that failed, or
 * a free-text column holding a spelling the options don't list verbatim
 * (NetworkDevice.snmpVersion stores either "V3" or the raw enum "3", and the
 * SNMP form's showIf tolerates both via SnmpVersionUtil — but only if the
 * value survives long enough to be read).
 *
 * These tests drive the real component and assert on the values it actually
 * submits, because the normalization lives in a useEffect and re-implementing
 * it in a test would pin nothing.
 *
 * Note: jest-dom matchers (toBeInTheDocument etc.) fail typecheck repo-wide,
 * so assertions here stay on submitted values and plain DOM text.
 */

describe("BasicForm dropdown initial-value normalization", () => {
  const OPTIONS: Array<DropdownOption> = [
    { label: "V1", value: "V1" },
    { label: "V2c", value: "V2c" },
    { label: "V3", value: "V3" },
  ];

  type BuildFieldsFunction = (
    options: Array<DropdownOption>,
  ) => Fields<FormValues<any>>;

  const buildFields: BuildFieldsFunction = (
    options: Array<DropdownOption>,
  ): Fields<FormValues<any>> => {
    return [
      {
        field: { snmpVersion: true },
        title: "SNMP Version",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: options,
        required: false,
      },
    ];
  };

  type SubmitFormFunction = (
    initialValues: FormValues<any>,
    fields: Fields<FormValues<any>>,
  ) => Promise<FormValues<any>>;

  /*
   * Renders the form, clicks Save, and hands back the values BasicForm
   * submitted — i.e. what would be written to the database.
   */
  const submitForm: SubmitFormFunction = async (
    initialValues: FormValues<any>,
    fields: Fields<FormValues<any>>,
  ): Promise<FormValues<any>> => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        fields={fields}
        id="dropdown-normalization"
        initialValues={initialValues}
        onSubmit={onSubmit}
        submitButtonText="Save"
      />,
    );

    await userEvent.setup().click(screen.getByTestId("Save"));

    return onSubmit.mock.calls[0]?.[0] as FormValues<any>;
  };

  test("keeps a stored value that matches no option instead of nulling it", async () => {
    /*
     * The reported case: a device whose snmpVersion column holds the raw enum
     * spelling "3" while the dropdown lists "V1"/"V2c"/"V3".
     */
    const submitted: FormValues<any> = await submitForm(
      { snmpVersion: "3" } as FormValues<any>,
      buildFields(OPTIONS),
    );

    expect(submitted).toEqual({ snmpVersion: "3" });
  });

  test("keeps stored values when the options failed to load", async () => {
    /*
     * ModelForm sets dropdownOptions to [] when an entity list comes back
     * empty or its fetch throws. Nulling on no-match wiped every dropdown on
     * such a form.
     */
    const submitted: FormValues<any> = await submitForm(
      { snmpVersion: "V3" } as FormValues<any>,
      buildFields([]),
    );

    expect(submitted).toEqual({ snmpVersion: "V3" });
  });

  test("still canonicalizes a value that does match an option", async () => {
    const submitted: FormValues<any> = await submitForm(
      { snmpVersion: "V3" } as FormValues<any>,
      buildFields(OPTIONS),
    );

    expect(submitted).toEqual({ snmpVersion: "V3" });
  });

  test("converts a matching ObjectID initial value to its string form", async () => {
    const id: ObjectID = new ObjectID("3f1b6b0e-0000-4000-8000-000000000001");

    const submitted: FormValues<any> = await submitForm(
      { snmpVersion: id } as unknown as FormValues<any>,
      buildFields([{ label: "Probe A", value: id.toString() }]),
    );

    expect(submitted).toEqual({ snmpVersion: id.toString() });
  });

  test("preserves an unmatched ObjectID as a string, not as an ObjectID", async () => {
    /*
     * An entity dropdown whose referenced row is missing from the (possibly
     * permission-scoped) option list must still submit the canonical string
     * the API expects — preserving the raw ObjectID instance would send an
     * object.
     */
    const id: ObjectID = new ObjectID("3f1b6b0e-0000-4000-8000-000000000002");

    const submitted: FormValues<any> = await submitForm(
      { snmpVersion: id } as unknown as FormValues<any>,
      buildFields([{ label: "Someone else", value: "a-different-id" }]),
    );

    expect(submitted).toEqual({ snmpVersion: id.toString() });
    expect(typeof submitted["snmpVersion"]).toBe("string");
  });

  test("leaves an absent value alone", async () => {
    const submitted: FormValues<any> = await submitForm(
      {} as FormValues<any>,
      buildFields(OPTIONS),
    );

    expect(submitted["snmpVersion"]).toBeUndefined();
  });
});
