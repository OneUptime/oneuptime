import BasicForm, {
  BasicFormHandle,
} from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import UnsavedChanges from "../../../../UI/Utils/NewVersion/UnsavedChanges";
import { JSONObject } from "../../../../Types/JSON";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Every form is a scope of unsaved changes: what the reader types into one
 * holds back any reload a new version of OneUptime would bring (the next
 * page opens inside the tab, the notice's Reload asks first), until the form
 * is saved or closed. BasicForm marks its root and clears it once its save
 * succeeds; the reading is done by Utils/NewVersion/UnsavedChanges, which
 * hears the reader's typing on the document.
 */

const FIELDS: Fields<JSONObject> = [
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
  },
];

let saves: number = 0;

const Host: FunctionComponent<{ saveSucceeds: boolean }> = (props: {
  saveSucceeds: boolean;
}): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(true);

  return (
    <div>
      {isOpen ? (
        <BasicForm
          id="unsaved-changes-form"
          fields={FIELDS}
          submitButtonText="Save"
          disableAutofocus={true}
          onSubmit={(
            _values: FormValues<JSONObject>,
            onSubmitSuccessful?: () => void,
          ) => {
            saves++;

            if (props.saveSucceeds) {
              onSubmitSuccessful?.();
            }
          }}
        />
      ) : (
        <p>Closed</p>
      )}
      <button
        type="button"
        onClick={() => {
          setIsOpen(false);
        }}
      >
        Close form
      </button>
    </div>
  );
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
};

beforeEach(() => {
  saves = 0;
  UnsavedChanges.reset();
  UnsavedChanges.install();
});

afterEach(() => {
  cleanup();
  UnsavedChanges.reset();
});

describe("BasicForm and unsaved changes", () => {
  test("marks its root as one scope of unsaved changes", async () => {
    render(<Host saveSucceeds={true} />);
    await settle();

    expect(
      document
        .getElementById("unsaved-changes-form")
        ?.getAttribute("data-unsaved-changes-scope"),
    ).toBe("form");
  });

  test("a form nobody typed in holds nothing, its defaults included", async () => {
    render(<Host saveSucceeds={true} />);
    await settle();

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("typing into it holds the page until it is saved", async () => {
    render(<Host saveSucceeds={true} />);
    await settle();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Checkout API",
    );

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();

    expect(saves).toBe(1);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("a save that fails keeps holding what was typed", async () => {
    render(<Host saveSucceeds={false} />);
    await settle();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Checkout API",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();

    expect(saves).toBe(1);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("closing the form lets go: what was typed left with it", async () => {
    render(<Host saveSucceeds={true} />);
    await settle();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Abandoned",
    );
    await userEvent.click(screen.getByRole("button", { name: "Close form" }));

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  /*
   * A pick from a dropdown or a picker fires no input event: BasicForm notes
   * every edit of its values itself, so the form counts from the pick - and
   * a field handing back the value it already had changed nothing.
   */
  describe("a value set without typing (a pick)", () => {
    const PickHost: FunctionComponent<{
      formRef: React.RefObject<BasicFormHandle>;
    }> = (props: {
      formRef: React.RefObject<BasicFormHandle>;
    }): ReactElement => {
      return (
        <BasicForm
          ref={props.formRef}
          id="pick-form"
          fields={FIELDS}
          initialValues={{ name: "Checkout API" }}
          submitButtonText="Save"
          disableAutofocus={true}
          onSubmit={(): void => {}}
        />
      );
    };

    test("counts the form from the pick on", async () => {
      const formRef: React.RefObject<BasicFormHandle> =
        React.createRef<BasicFormHandle>();

      render(<PickHost formRef={formRef} />);
      await settle();

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

      act(() => {
        formRef.current!.setFieldValue("name", "Payments API");
      });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("handing back the value it already had is no change", async () => {
      const formRef: React.RefObject<BasicFormHandle> =
        React.createRef<BasicFormHandle>();

      render(<PickHost formRef={formRef} />);
      await settle();

      act(() => {
        formRef.current!.setFieldValue("name", "Checkout API");
      });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });
  });
});
