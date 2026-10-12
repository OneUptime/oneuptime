import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * An ID drawn as a field of a details card (FieldType.ObjectID on any key but
 * the record's own `_id`, which goes on the ID line): the ID in a pill that
 * copies it on a click.
 *
 * The pill was handed `value.toString()`. An analytics row holds its IDs as
 * ObjectIDs, whose toString() is the ID, but JSON holds { _type, value },
 * whose toString() is "[object Object]" - and that is what the pill showed
 * and copied. It now reads every shape the way the record's own ID line and
 * the Show ID dialog do (ObjectID/RecordIdText.ts, issue #4615).
 */

const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";

interface Item {
  name?: string | undefined;
  serviceId?: unknown;
}

const SERVICE_FIELD: Field<Item> = {
  key: "serviceId",
  title: "Telemetry Service ID",
  fieldType: FieldType.ObjectID,
  placeholder: "No service",
};

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

let writeText: WriteTextMock;

beforeEach(() => {
  writeText = jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {},
  );
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

function renderField(serviceId: unknown): HTMLElement {
  const { container } = render(
    <Detail<Item>
      id="span-detail"
      item={{ name: "chat gpt-4o-mini", serviceId }}
      fields={[{ key: "name", title: "Name" }, SERVICE_FIELD]}
    />,
  );

  return container;
}

describe("an ID field, in every shape the ID arrives in", () => {
  const SHAPES: Array<{ name: string; value: unknown }> = [
    { name: "a string", value: SERVICE_ID },
    { name: "an ObjectID (an analytics row)", value: new ObjectID(SERVICE_ID) },
    {
      name: "the { _type, value } JSON of an API response",
      value: { _type: "ObjectID", value: SERVICE_ID },
    },
  ];

  test.each(SHAPES)(
    "shows $name as its text, and copies that text",
    async ({ value }: { name: string; value: unknown }) => {
      const container: HTMLElement = renderField(value);

      const pill: HTMLElement = screen.getByRole("button", {
        name: SERVICE_ID,
      });

      expect(within(pill).getByText(SERVICE_ID).tagName).toBe("CODE");
      expect(container).not.toHaveTextContent("[object Object]");

      await act(async () => {
        fireEvent.click(pill);
      });

      expect(writeText).toHaveBeenCalledWith(SERVICE_ID);
    },
  );
});

describe("an ID field with no ID", () => {
  for (const { name, value } of [
    { name: "nothing", value: undefined },
    { name: "null", value: null },
    { name: "an empty ObjectID", value: new ObjectID("") },
    { name: "an object with no value", value: { _type: "ObjectID" } },
  ]) {
    test(`shows the field's placeholder for ${name}, and no pill`, () => {
      const container: HTMLElement = renderField(value);

      expect(screen.getByText("No service")).toBeInTheDocument();
      expect(container.querySelector("code")).toBeNull();
      expect(container).not.toHaveTextContent("[object Object]");
    });
  }
});
