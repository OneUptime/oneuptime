import BasicForm, {
  BasicFormHandle,
} from "../../../../UI/Components/Forms/BasicForm";
import { CustomElementProps } from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, {
  createRef,
  FunctionComponent,
  ReactElement,
  RefObject,
  useEffect,
} from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A field that fills itself in as it is drawn - a rule's conditions builder
 * writes the conditions it shows, an editor writes the value it normalised -
 * runs that effect before the form's own: React runs a child's effects
 * before its parent's. Drawn on a form's first step, it used to write before
 * BasicForm had taken its initial values and defaults, and BasicForm then
 * took none of them ("nothing re-seeds a form already edited"): a Create
 * form started every other field empty, so a switch whose column starts on
 * - an owner rule's Notify Owners - was saved off, and an initial value was
 * dropped.
 *
 * Now the form still takes its initial values and defaults, and what the
 * field wrote is kept over them.
 */

interface FillsInProps {
  // The value the element writes as it is drawn.
  writes: unknown;
  customElementProps: CustomElementProps;
}

const FillsInOnShow: FunctionComponent<FillsInProps> = (
  props: FillsInProps,
): ReactElement => {
  useEffect(() => {
    props.customElementProps.onChange?.(props.writes);
  }, []);

  return <div data-testid="fills-in-on-show">Conditions</div>;
};

const STEPS: Array<FormStep<JSONObject>> = [
  { title: "Match", id: "match" },
  { title: "Action", id: "action" },
];

function fieldsWith(data: {
  writes: unknown;
  onChange?: Fields<JSONObject>[number]["onChange"];
}): Fields<JSONObject> {
  return [
    {
      field: { criteria: true },
      title: "Conditions",
      stepId: "match",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      onChange: data.onChange,
      getCustomElement: (
        _values: FormValues<JSONObject>,
        customElementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <FillsInOnShow
            writes={data.writes}
            customElementProps={customElementProps}
          />
        );
      },
    },
    {
      field: { name: true },
      title: "Name",
      stepId: "action",
      fieldType: FormFieldSchemaType.Text,
      required: true,
    },
    {
      field: { notifyOwners: true },
      title: "Notify Owners",
      stepId: "action",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // As ModelForm hands a Create form the column's default.
      defaultValue: true,
    },
    {
      field: { channel: true },
      title: "Channel",
      stepId: "action",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      defaultValue: "email",
    },
  ];
}

interface Rendered {
  formRef: RefObject<BasicFormHandle>;
  onSubmit: MockFunction;
}

async function renderForm(data: {
  fields: Fields<JSONObject>;
  initialValues?: JSONObject;
}): Promise<Rendered> {
  const formRef: RefObject<BasicFormHandle> = createRef<BasicFormHandle>();
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="fills-in-on-show"
      ref={formRef}
      fields={data.fields}
      steps={STEPS}
      initialValues={data.initialValues || {}}
      onSubmit={onSubmit}
      submitButtonText="Create"
      hideSubmitButton={true}
      disableAutofocus={true}
    />,
  );

  await screen.findByTestId("fills-in-on-show");

  return { formRef, onSubmit };
}

async function submitAll(rendered: Rendered): Promise<JSONObject> {
  act(() => {
    rendered.formRef.current?.submitAllSteps();
  });

  await waitFor(() => {
    expect(rendered.onSubmit).toHaveBeenCalledTimes(1);
  });

  return rendered.onSubmit.mock.calls[0]?.[0] as JSONObject;
}

describe("a field that fills itself in on a form's first step", () => {
  afterEach(() => {
    cleanup();
  });

  test("does not stop the form taking its defaults: a switch that starts on is sent on", async () => {
    const rendered: Rendered = await renderForm({
      fields: fieldsWith({ writes: { filters: [] } }),
      initialValues: { name: "Add production" },
    });

    const values: JSONObject = await submitAll(rendered);

    expect(values["notifyOwners"]).toBe(true);
    expect(values["channel"]).toBe("email");
  });

  test("keeps what it wrote, and the form keeps its initial values", async () => {
    const rendered: Rendered = await renderForm({
      fields: fieldsWith({ writes: { filters: ["written"] } }),
      initialValues: {
        name: "Add production",
        // What the field writes as it is drawn wins over what it started as.
        criteria: { filters: ["initial"] },
      },
    });

    const values: JSONObject = await submitAll(rendered);

    expect(values["criteria"]).toEqual({ filters: ["written"] });
    expect(values["name"]).toBe("Add production");
  });

  test("keeps what its onChange wrote into the form's other values as it was drawn", async () => {
    const rendered: Rendered = await renderForm({
      fields: fieldsWith({
        writes: { filters: [] },
        onChange: (
          _value: unknown,
          currentValues: FormValues<JSONObject>,
          setNewFormValues: (values: FormValues<JSONObject>) => void,
        ): void => {
          setNewFormValues({ ...currentValues, name: "Named by the field" });
        },
      }),
    });

    const values: JSONObject = await submitAll(rendered);

    expect(values["name"]).toBe("Named by the field");
    expect(values["notifyOwners"]).toBe(true);
  });

  test("a default never replaces a value the form starts with", async () => {
    const rendered: Rendered = await renderForm({
      fields: fieldsWith({ writes: { filters: [] } }),
      initialValues: {
        name: "Add production",
        notifyOwners: false,
        channel: "sms",
      },
    });

    const values: JSONObject = await submitAll(rendered);

    expect(values["notifyOwners"]).toBe(false);
    expect(values["channel"]).toBe("sms");
  });

  test("keeps a value its onChange cleared as it was drawn cleared, default or not", async () => {
    const rendered: Rendered = await renderForm({
      fields: fieldsWith({
        writes: { filters: [] },
        onChange: (
          _value: unknown,
          currentValues: FormValues<JSONObject>,
          setNewFormValues: (values: FormValues<JSONObject>) => void,
        ): void => {
          const values: JSONObject = { ...(currentValues as JSONObject) };
          delete values["channel"];
          setNewFormValues(values as FormValues<JSONObject>);
        },
      }),
      initialValues: { name: "Add production", channel: "sms" },
    });

    const values: JSONObject = await submitAll(rendered);

    expect(values["channel"]).toBeUndefined();
    // What it did not touch still takes its starting value and default.
    expect(values["name"]).toBe("Add production");
    expect(values["notifyOwners"]).toBe(true);
  });
});
