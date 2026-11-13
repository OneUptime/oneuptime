import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";

/*
 * What a recording of the setup pages hears about (#6834), from the places
 * that know: forms that refuse somebody (BasicForm, ModelForm), the
 * product's events (#6830, ProductEvents) and where in a guided setup the
 * person is (GuidedSetupFrame). Nobody listens unless something asked.
 */

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (): void => {},
    },
  };
});

import BasicForm from "../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormRefusals, { FormRefusalKind } from "../../../UI/Utils/FormRefusals";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import { PRODUCT_TEXT_CLASS_NAME } from "../../../UI/Utils/ProductText";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../../Types/JSON";
import GuidedSetupFrame, {
  GuidedSetupFrameStep,
  SUMMARY_STEP_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import GuidedSetupContext from "../../../../App/FeatureSet/Dashboard/src/Utils/DashboardRecording/GuidedSetupContext";

afterEach(() => {
  cleanup();
  GuidedSetupContext.set(null);
});

describe("FormRefusals", () => {
  test("tells every listener, until it unsubscribes, and a listener that throws stops nobody", () => {
    const heard: Array<FormRefusalKind> = [];
    const unsubscribeThrower: () => void = FormRefusals.subscribe(() => {
      throw new Error("listener bug");
    });
    const unsubscribe: () => void = FormRefusals.subscribe(
      (kind: FormRefusalKind) => {
        heard.push(kind);
      },
    );

    FormRefusals.report(FormRefusalKind.Invalid);
    FormRefusals.report(FormRefusalKind.Refused);
    unsubscribe();
    unsubscribeThrower();
    FormRefusals.report(FormRefusalKind.Invalid);

    expect(heard).toEqual([FormRefusalKind.Invalid, FormRefusalKind.Refused]);
  });

  test("BasicForm reports a press its own checks refuse, and not one that goes through", async () => {
    const heard: Array<FormRefusalKind> = [];
    const unsubscribe: () => void = FormRefusals.subscribe(
      (kind: FormRefusalKind) => {
        heard.push(kind);
      },
    );
    const submitted: Array<JSONObject> = [];

    render(
      <BasicForm
        id="refusal-form"
        name="Refusal form"
        initialValues={{ name: "" }}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ]}
        submitButtonText="Save"
        onSubmit={(values: JSONObject) => {
          submitted.push(values);
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(heard).toEqual([FormRefusalKind.Invalid]);
    expect(submitted).toHaveLength(0);

    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Payments API" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    expect(heard).toEqual([FormRefusalKind.Invalid]);
    expect(submitted).toHaveLength(1);

    unsubscribe();
  });
});

describe("ModelForm and a server that refuses", () => {
  test("reports the refusal where it shows the server's message, and nothing on success", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/Forms/ModelForm.tsx"),
      "utf8",
    );
    const refusal: RegExpMatchArray | null = source.match(
      /catch \(err\) \{\n\s*const message: string = API\.getFriendlyMessage\(err\);\n\s*setError\(message\);\n\s*props\.onSubmitError\?\.\(message\);\n\s*FormRefusals\.report\(FormRefusalKind\.Refused\);\n\s*\}/,
    );

    expect(refusal).not.toBeNull();
    // Once: a successful save reports nothing.
    expect(source.split("FormRefusals.report(").length - 1).toBe(1);
  });
});

describe("ProductEvents.subscribe", () => {
  test("hears each event by its name and its own reviewed properties - not the common ones", () => {
    const heard: Array<[string, JSONObject]> = [];
    const unsubscribe: () => void = ProductEvents.subscribe(
      (name: ProductEventName, properties: JSONObject) => {
        heard.push([name, properties]);
      },
    );

    ProductEvents.send(ProductEventName.GuidedSetupStepReached, {
      setup: "website_down",
      step: "address",
      step_number: 1,
      // Not one of the event's properties: dropped before anybody hears it.
      monitor_name: "Payments API",
    });
    unsubscribe();
    ProductEvents.send(ProductEventName.GuidedSetupFinished, {
      setup: "website_down",
    });

    expect(heard).toHaveLength(1);
    expect(heard[0]?.[0]).toBe("guided_setup/step_reached");
    expect(heard[0]?.[1]["setup"]).toBe("website_down");
    expect(heard[0]?.[1]).not.toHaveProperty("monitor_name");
    expect(heard[0]?.[1]).not.toHaveProperty("project_id");
  });

  test("a listener that throws never breaks the page", () => {
    const unsubscribe: () => void = ProductEvents.subscribe(() => {
      throw new Error("listener bug");
    });

    expect(() => {
      ProductEvents.send(ProductEventName.ImporterOpened, { from: "home" });
    }).not.toThrow();

    unsubscribe();
  });
});

describe("GuidedSetupFrame and a recording", () => {
  const steps: Array<GuidedSetupFrameStep> = [
    {
      key: "address",
      title: "What to watch",
      isDone: false,
      doneLine: "Watching payments.example.com",
      content: <p>asks</p>,
    },
    {
      key: "test",
      title: "Send a test",
      isDone: false,
      content: <p>asks</p>,
    },
  ];

  test("says which setup and step is open, by the keys its events carry, and clears it when it leaves", () => {
    const { rerender, unmount } = render(
      <GuidedSetupFrame
        setup="website_down"
        steps={steps}
        openStepKey="address"
        onOpenStep={() => {}}
        summary={<p>done</p>}
        isFinished={false}
      />,
    );

    expect(GuidedSetupContext.get()).toEqual({
      setup: "website_down",
      step: "address",
    });

    rerender(
      <GuidedSetupFrame
        setup="website_down"
        steps={steps.map((step: GuidedSetupFrameStep) => {
          return { ...step, isDone: true };
        })}
        openStepKey={null}
        onOpenStep={() => {}}
        summary={<p>done</p>}
        isFinished={true}
      />,
    );

    expect(GuidedSetupContext.get()).toEqual({
      setup: "website_down",
      step: SUMMARY_STEP_KEY,
    });

    unmount();

    expect(GuidedSetupContext.get()).toBeNull();
  });

  test("marks its steps' titles and its progress line as the product's words, never a done line", () => {
    render(
      <GuidedSetupFrame
        setup="website_down"
        steps={[{ ...steps[0]!, isDone: true }, steps[1]!]}
        openStepKey="test"
        onOpenStep={() => {}}
        summary={<p>done</p>}
        isFinished={false}
      />,
    );

    expect(
      screen.getByText("What to watch").closest(`.${PRODUCT_TEXT_CLASS_NAME}`),
    ).not.toBeNull();
    expect(screen.getByTestId("guided-setup-progress").className).toContain(
      PRODUCT_TEXT_CLASS_NAME,
    );
    expect(
      screen
        .getByText("Watching payments.example.com")
        .closest(`.${PRODUCT_TEXT_CLASS_NAME}`),
    ).toBeNull();
  });

  test("a setup's clear never clears another setup's place", () => {
    GuidedSetupContext.set({ setup: "paging", step: "who" });
    GuidedSetupContext.clear("website_down");

    expect(GuidedSetupContext.get()).toEqual({ setup: "paging", step: "who" });
  });
});
