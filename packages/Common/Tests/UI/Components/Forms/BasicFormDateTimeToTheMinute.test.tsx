import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import Timezone from "../../../../Types/Timezone";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * EVERY DATE AND TIME FIELD OF A FORM SHOWS HOURS AND MINUTES (issue #7593).
 *
 * A form's DateTime field is drawn by the shared Input, which now shows its
 * value to the minute and asks for no seconds - on every form, the on-call
 * ones the issue named and every other one (an incident's Declared At, a
 * maintenance window, a workflow's dates). What is sent stays what the field
 * holds:
 *
 *   - a field left alone sends the value it started with, to the second -
 *     a record's stored 08:00:17 is saved as 08:00:17, and a "now" a record
 *     is stamped with (Declared At) keeps its exact instant, which orders it
 *     on a timeline among events of the same minute;
 *   - a time picked is sent on the minute.
 */

const OPENED: Date = new Date("2026-11-13T05:45:52.345Z");
const STORED: string = "2026-11-11T02:30:17.000Z";

function fields(): Fields<JSONObject> {
  return [
    {
      field: { declaredAt: true },
      title: "Declared At",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      getDefaultValue: (): Date => {
        return OPENED;
      },
    },
    {
      field: { startsAt: true },
      title: "Starts",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
    },
  ];
}

async function renderForm(initialValues?: JSONObject): Promise<MockFunction> {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="date-time-to-the-minute"
      fields={fields()}
      initialValues={initialValues}
      onSubmit={onSubmit}
      submitButtonText="Save"
      disableAutofocus={true}
    />,
  );

  // BasicForm fills in the fields' defaults in an effect of its own.
  await waitFor(() => {
    expect(dateTimeField("Declared At").value).not.toBe("");
  });

  return onSubmit;
}

// A field's input, found by the label the form draws for it.
function dateTimeField(title: string): HTMLInputElement {
  const label: HTMLLabelElement | undefined = Array.from(
    document.querySelectorAll("label"),
  ).find((candidate: HTMLLabelElement): boolean => {
    return (candidate.textContent || "").trim().startsWith(title);
  });

  if (!label) {
    throw new Error(`No field ${title}`);
  }

  return document.querySelector(
    `[id="${label.getAttribute("for")}"]`,
  ) as HTMLInputElement;
}

async function save(onSubmit: MockFunction): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("Save"));
  });

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  return onSubmit.mock.calls[0]![0] as JSONObject;
}

function iso(value: unknown): string {
  return OneUptimeDate.fromString(value as string).toISOString();
}

beforeEach(() => {
  // 05:45:52 UTC is 11:15:52 in Kolkata; 02:30:17 UTC is 08:00:17.
  OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
});

describe("a form's date and time fields", () => {
  test("show hours and minutes, and ask for no seconds", async () => {
    await renderForm({ startsAt: STORED });

    expect(dateTimeField("Declared At").value).toBe("2026-11-13T11:15");
    expect(dateTimeField("Starts").value).toBe("2026-11-11T08:00");

    for (const title of ["Declared At", "Starts"]) {
      expect(dateTimeField(title)).toHaveAttribute("type", "datetime-local");
      expect(dateTimeField(title)).not.toHaveAttribute("step");
    }
  });

  test("left alone, send what they hold: a stored time and a now, to the second", async () => {
    const onSubmit: MockFunction = await renderForm({ startsAt: STORED });

    const values: JSONObject = await save(onSubmit);

    expect(iso(values["startsAt"])).toBe(STORED);
    expect(iso(values["declaredAt"])).toBe(OPENED.toISOString());
  });

  test("a time picked is sent on the minute, in the person's zone", async () => {
    const onSubmit: MockFunction = await renderForm({ startsAt: STORED });

    fireEvent.change(dateTimeField("Starts"), {
      target: { value: "2026-11-11T09:45" },
    });

    const values: JSONObject = await save(onSubmit);

    expect(iso(values["startsAt"])).toBe("2026-11-11T04:15:00.000Z");
    expect(iso(values["declaredAt"])).toBe(OPENED.toISOString());
    expect(dateTimeField("Starts").value).toBe("2026-11-11T09:45");
  });
});
