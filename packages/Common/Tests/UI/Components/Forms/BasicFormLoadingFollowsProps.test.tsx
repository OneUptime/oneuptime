import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction from "../../../MockType";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * BasicForm disables its fields while the form it belongs to saves
 * (isLoading) and shows why a save failed (error). The form above it -
 * ModelForm - changes the two together, in one render, so the page must
 * show them together.
 *
 * BasicForm used to copy isLoading into state of its own and keep the copy
 * in step with an effect, which runs after the render it follows. For that
 * one render a failed save showed its error while every field was still
 * disabled - on a slow CI runner a test typing a new name the moment the
 * error appeared found the field not editable (DashboardCreateFromTemplate)
 * - and a save that had just started left the fields, and Next, enabled.
 *
 * What each render put on the page is read by a probe drawn beside the
 * form: its layout effect runs once the render is on the page and before
 * any effect, so it sees exactly what one render drew.
 */

const SAVE_ERROR: string = "Dashboard with the same name already exists.";

const FIELDS: Fields<JSONObject> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
  },
];

interface Drawn {
  isLoading: boolean;
  isErrorShown: boolean;
  isNameShown: boolean;
  isNameEditable: boolean;
}

/*
 * What a person - or user-event's clear() and type() - can type into. A
 * form's text fields are locked by readOnly (Input), not by disabled.
 */
function isEditable(input: HTMLInputElement | null): boolean {
  return Boolean(input && !input.readOnly && !input.disabled);
}

let drawn: Array<Drawn> = [];

function Probe(props: { isLoading: boolean }): ReactElement {
  useLayoutEffect(() => {
    const nameInput: HTMLInputElement | null = screen.queryByRole("textbox", {
      name: "Name",
    }) as HTMLInputElement | null;

    drawn.push({
      isLoading: props.isLoading,
      isErrorShown: screen.queryByText(SAVE_ERROR) !== null,
      isNameShown: nameInput !== null,
      isNameEditable: isEditable(nameInput),
    });
  });

  return <></>;
}

function Page(props: { isLoading: boolean; error: string }): ReactElement {
  return (
    <>
      <BasicForm
        id="loading-follows-props-form"
        fields={FIELDS}
        onSubmit={getJestMockFunction()}
        submitButtonText="Create"
        disableAutofocus={true}
        isLoading={props.isLoading}
        error={props.error}
      />
      <Probe isLoading={props.isLoading} />
    </>
  );
}

// Lets the form take its fields and draw them.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
}

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
}

describe("BasicForm shows a save's loading and its error in the same render", () => {
  beforeEach(() => {
    drawn = [];
  });

  afterEach(() => {
    cleanup();
  });

  test("a failed save's error never shows beside disabled fields", async () => {
    const { rerender } = render(<Page isLoading={true} error="" />);
    await settle();
    expect(isEditable(nameInput())).toBe(false);

    drawn = [];
    rerender(<Page isLoading={false} error={SAVE_ERROR} />);

    // The first render after the save failed already shows both.
    expect(drawn[0]).toEqual({
      isLoading: false,
      isErrorShown: true,
      isNameShown: true,
      isNameEditable: true,
    });
    expect(
      drawn.filter((render: Drawn): boolean => {
        return render.isErrorShown && !render.isNameEditable;
      }),
    ).toEqual([]);
    expect(isEditable(nameInput())).toBe(true);
    expect(screen.getByText(SAVE_ERROR)).toBeVisible();
  });

  test("the fields are disabled in the render that starts a save", async () => {
    const { rerender } = render(<Page isLoading={false} error="" />);
    await settle();
    expect(isEditable(nameInput())).toBe(true);

    drawn = [];
    rerender(<Page isLoading={true} error="" />);

    expect(drawn[0]).toEqual({
      isLoading: true,
      isErrorShown: false,
      isNameShown: true,
      isNameEditable: false,
    });
    expect(isEditable(nameInput())).toBe(false);
  });

  test("a form drawn while saving keeps its fields locked", async () => {
    render(<Page isLoading={true} error="" />);
    await settle();

    expect(isEditable(nameInput())).toBe(false);
  });
});
