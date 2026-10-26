import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import BasicModelForm from "../../../../UI/Components/Forms/BasicModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "../../../../Models/DatabaseModels/Label";
import IncidentSlaRule from "../../../../Models/DatabaseModels/IncidentSlaRule";
import getJestMockFunction from "../../../MockType";

/*
 * A FORM FIELD WITHOUT WORDS OF ITS OWN DOES NOT SAY "ANY FRIENDLY NAME OF
 * THIS OBJECT".
 *
 * The maintainer's follow-ups: "Settings create and edit forms show the
 * model's English field help ('Any friendly name of this object') in every
 * language." A field with no description of its own shows its model
 * column's (BasicModelForm) - written for the API reference, in English -
 * and on nearly every settings page Name and Description said only what
 * their titles say. Those are left off (Forms/Utils/ColumnDescriptionOnForm);
 * a column description that tells the reader something is still shown, and
 * a field's own description always wins.
 */

afterEach(() => {
  cleanup();
});

describe("a column description that only restates its field is left off", () => {
  test("a label's Name and Description show no help", async () => {
    render(
      <BasicModelForm<Label>
        model={new Label()}
        id="label-form"
        onSubmit={getJestMockFunction()}
        error={null}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
        ]}
      />,
    );

    await screen.findByLabelText("Name");

    expect(screen.queryByText("Any friendly name of this object")).toBeNull();
    expect(
      screen.queryByText("Friendly description that will help you remember"),
    ).toBeNull();
    // No help, so nothing describes the boxes.
    expect(screen.getByLabelText("Name")).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  test("a field's own words are shown, whatever its column says", async () => {
    render(
      <BasicModelForm<Label>
        model={new Label()}
        id="label-form"
        onSubmit={getJestMockFunction()}
        error={null}
        fields={[
          {
            field: { name: true },
            title: "Name",
            description: "What people pick it by, like Production.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ]}
      />,
    );

    expect(
      await screen.findByText("What people pick it by, like Production."),
    ).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
      "What people pick it by, like Production.",
    );
  });
});

describe("a column description that says more is still shown", () => {
  test("an SLA rule's response time says what it means", async () => {
    render(
      <BasicModelForm<IncidentSlaRule>
        model={new IncidentSlaRule()}
        id="sla-form"
        onSubmit={getJestMockFunction()}
        error={null}
        fields={[
          {
            field: { responseTimeInMinutes: true },
            title: "Response Time (minutes)",
            fieldType: FormFieldSchemaType.Number,
            required: false,
          },
        ]}
      />,
    );

    expect(
      await screen.findByText(
        "Target response time in minutes. This is the maximum time allowed before the incident must be acknowledged.",
      ),
    ).toBeVisible();
  });
});
