import BasicForm, {
  BasicFormHandle,
} from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import UnsavedChanges from "../../../../UI/Utils/NewVersion/UnsavedChanges";
import { JSONObject } from "../../../../Types/JSON";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { CustomElementProps } from "../../../../UI/Components/Forms/Types/Field";
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

      // The reader presses on the field, and picks.
      fireEvent.pointerDown(screen.getByRole("textbox", { name: "Name" }));
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

      fireEvent.pointerDown(screen.getByRole("textbox", { name: "Name" }));
      act(() => {
        formRef.current!.setFieldValue("name", "Checkout API");
      });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });
  });

  /*
   * A value the form is handed before the reader has done anything in it is
   * the form's own doing, never a change they would lose: a field that
   * reports what it holds as it is drawn (a monitor's criteria do), or
   * defaults filled in once something loads. A form only opened never
   * holds a reload back.
   */
  describe("a value the form is handed before the reader acts", () => {
    // A field that reports what it holds as soon as it is drawn, then later.
    const Reporter: FunctionComponent<CustomElementProps> = (
      props: CustomElementProps,
    ): ReactElement => {
      const [steps, setSteps] = useState<Array<string>>(["Ping"]);

      useEffect(() => {
        props.onChange?.(steps);
      }, [steps]);

      return (
        <button
          type="button"
          onClick={() => {
            setSteps([...steps, "Check the response"]);
          }}
        >
          Add a step
        </button>
      );
    };

    const REPORTING_FIELDS: Fields<JSONObject> = [
      ...FIELDS,
      {
        field: { steps: true },
        title: "Steps",
        fieldType: FormFieldSchemaType.CustomComponent,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          props: CustomElementProps,
        ): ReactElement => {
          return <Reporter {...props} />;
        },
      },
    ];

    const ReportingHost: FunctionComponent<{
      formRef?: React.RefObject<BasicFormHandle> | undefined;
    }> = (props: {
      formRef?: React.RefObject<BasicFormHandle> | undefined;
    }): ReactElement => {
      return (
        <BasicForm
          ref={props.formRef}
          id="reporting-form"
          fields={REPORTING_FIELDS}
          submitButtonText="Save"
          disableAutofocus={true}
          onSubmit={(
            _values: FormValues<JSONObject>,
            onSubmitSuccessful?: () => void,
          ): void => {
            onSubmitSuccessful?.();
          }}
        />
      );
    };

    test("a field reporting what it holds as it is drawn is no change", async () => {
      render(<ReportingHost />);
      await settle();

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("a value a parent hands the form before the reader acts is no change", async () => {
      const formRef: React.RefObject<BasicFormHandle> =
        React.createRef<BasicFormHandle>();

      render(<ReportingHost formRef={formRef} />);
      await settle();

      act(() => {
        formRef.current!.setFieldValue("name", "Seeded name");
      });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });

    test("the reader's own change to such a field counts", async () => {
      render(<ReportingHost />);
      await settle();

      await userEvent.click(screen.getByRole("button", { name: "Add a step" }));

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("a key pressed in the form counts as acting, as a press does", async () => {
      const formRef: React.RefObject<BasicFormHandle> =
        React.createRef<BasicFormHandle>();

      render(<ReportingHost formRef={formRef} />);
      await settle();

      fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), {
        key: "ArrowDown",
      });
      act(() => {
        formRef.current!.setFieldValue("name", "Picked from the list");
      });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
    });

    test("once saved, a value the form is handed again is no change until the reader acts again", async () => {
      const formRef: React.RefObject<BasicFormHandle> =
        React.createRef<BasicFormHandle>();

      render(<ReportingHost formRef={formRef} />);
      await settle();

      await userEvent.type(
        screen.getByRole("textbox", { name: "Name" }),
        "Checkout API",
      );

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);

      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await settle();

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

      // The saved values coming back into the form, as a page reloads them.
      act(() => {
        formRef.current!.setFieldValue("name", "Checkout API (saved)");
      });

      expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
    });
  });
});
