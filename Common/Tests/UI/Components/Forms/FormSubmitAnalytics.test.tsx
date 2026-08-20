import "@testing-library/jest-dom";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The "FORM SUBMIT" event is what names a conversion in PostHog and in the GTM
 * dataLayer. Every wrapper around BasicForm has to hand it something
 * meaningful, and BasicForm has to stay silent when nothing meaningful exists.
 * An event named after a missing prop reads as "FORM SUBMIT: undefined" and
 * collapses every form in the product into one indistinguishable conversion.
 */

const captureMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<any>) => {
        return captureMock(...args);
      },
    },
  };
});

import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import BasicFormModal from "../../../../UI/Components/FormModal/BasicFormModal";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import FormAnalyticsName from "../../../../UI/Components/Forms/Utils/FormAnalyticsName";

const fields: Fields<FormValues<any>> = [
  {
    field: {
      label: true,
    },
    title: "Label",
    fieldType: FormFieldSchemaType.Text,
    dataTestId: "label",
  },
];

function setupUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

type CapturedEventNamesFunction = () => Array<string>;

const capturedEventNames: CapturedEventNamesFunction = (): Array<string> => {
  return captureMock.mock.calls.map((call: Array<any>) => {
    return call[0] as string;
  });
};

describe("FORM SUBMIT analytics naming", () => {
  beforeEach(() => {
    captureMock.mockClear();
  });

  describe("FormAnalyticsName.resolve", () => {
    test("takes the first usable candidate", () => {
      expect(FormAnalyticsName.resolve("Create Monitor", "Fallback")).toBe(
        "Create Monitor",
      );
      expect(FormAnalyticsName.resolve(undefined, "Fallback")).toBe("Fallback");
      expect(FormAnalyticsName.resolve(null, "  Trimmed  ")).toBe("Trimmed");
    });

    test("rejects candidates that are, or embed, a stringified empty value", () => {
      expect(FormAnalyticsName.resolve("undefined")).toBeUndefined();
      expect(FormAnalyticsName.resolve("null")).toBeUndefined();
      expect(FormAnalyticsName.resolve("Duplicate undefined")).toBeUndefined();
      expect(FormAnalyticsName.resolve("Edit null")).toBeUndefined();

      // A rejected candidate falls through to the next one.
      expect(
        FormAnalyticsName.resolve("Duplicate undefined", "Duplicate Monitor"),
      ).toBe("Duplicate Monitor");
    });

    test("returns undefined when no candidate is usable", () => {
      expect(FormAnalyticsName.resolve()).toBeUndefined();
      expect(
        FormAnalyticsName.resolve(undefined, null, "", "   "),
      ).toBeUndefined();
    });

    test("leaves real words that merely look like empty values alone", () => {
      expect(FormAnalyticsName.resolve("Set Nullable Columns")).toBe(
        "Set Nullable Columns",
      );
    });
  });

  describe("BasicForm", () => {
    test("captures the form name on submit", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <BasicForm
          fields={fields}
          id="named-form"
          name="Create Widget"
          initialValues={{ label: "" }}
          onSubmit={onSubmit}
          submitButtonText="Submit"
        />,
      );

      const user: UserEvent = setupUser();
      await user.click(screen.getByTestId("Submit"));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      expect(capturedEventNames()).toEqual(["FORM SUBMIT: Create Widget"]);
    }, 30000);

    test("stays silent when the form has no name", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <BasicForm
          fields={fields}
          id="unnamed-form"
          initialValues={{ label: "" }}
          onSubmit={onSubmit}
          submitButtonText="Submit"
        />,
      );

      const user: UserEvent = setupUser();
      await user.click(screen.getByTestId("Submit"));

      // The form still submits -- only the analytics event is skipped.
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      expect(captureMock).not.toHaveBeenCalled();
    }, 30000);
  });

  describe("BasicFormModal", () => {
    test("falls back to the modal title when the caller passes no name", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <BasicFormModal<FormValues<any>>
          title="Add Probe to Monitors"
          submitButtonText="Save"
          onSubmit={onSubmit}
          formProps={{
            fields: fields,
            initialValues: { label: "" },
          }}
        />,
      );

      const user: UserEvent = setupUser();
      await user.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      expect(capturedEventNames()).toEqual([
        "FORM SUBMIT: Add Probe to Monitors",
      ]);
    }, 30000);

    test("prefers a name the caller supplied over the modal title", async () => {
      const onSubmit: MockFunction = getJestMockFunction();

      render(
        <BasicFormModal<FormValues<any>>
          title="Add Probe to Monitors"
          name="Monitor > Bulk Add Probe"
          submitButtonText="Save"
          onSubmit={onSubmit}
          formProps={{
            fields: fields,
            initialValues: { label: "" },
          }}
        />,
      );

      const user: UserEvent = setupUser();
      await user.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });

      expect(capturedEventNames()).toEqual([
        "FORM SUBMIT: Monitor > Bulk Add Probe",
      ]);
    }, 30000);
  });
});
