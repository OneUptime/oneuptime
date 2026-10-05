import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ColorPicker from "Common/UI/Components/Forms/Fields/ColorPicker";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import Modal from "Common/UI/Components/Modal/Modal";
import Color from "Common/Types/Color";
import "Common/UI/Styles/Theme.css";

/*
 * Scenarios, chosen with ?scenario=:
 *
 *   label    (default) the Create Label dialog of the report: Name,
 *            Description and a required Label Color, already picked.
 *   options  a dialog holding a custom field's options, each with an
 *            optional color in the compact layout, the last ones at the foot
 *            of the dialog.
 *   page     an optional color field on a page, outside any dialog, and a
 *            compact one at the foot of the page.
 *
 * ?color= sets the label's starting color ("" for none), ?theme=dark the
 * dark theme. What a form submits is written to [data-testid=submitted], and
 * a closed dialog says so in [data-testid=dialog-state].
 */

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") || "label";
const startColor = params.has("color") ? params.get("color") : "#6366f1";

const toJSON = (values) => {
  return JSON.stringify(
    values,
    (key, value) => {
      return value instanceof Color ? value.toString() : value;
    },
    2,
  );
};

function LabelDialog() {
  const formRef = useRef(null);
  const [isOpen, setIsOpen] = useState(true);
  const [submitted, setSubmitted] = useState("");

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-700">
      <h1 className="text-xl font-semibold">Labels</h1>
      <p className="mt-2 text-sm text-gray-500">
        Labels help you categorize resources in your project.
      </p>
      <p data-testid="dialog-state" className="mt-2 text-xs">
        {isOpen ? "open" : "closed"}
      </p>
      <pre data-testid="submitted" className="mt-4 text-xs">
        {submitted}
      </pre>
      {isOpen ? (
        <Modal
          title="Create New Label"
          submitButtonText="Create Label"
          onClose={() => {
            setIsOpen(false);
          }}
          onSubmit={() => {
            formRef.current?.submitForm();
          }}
        >
          <BasicForm
            ref={formRef}
            id="create-label"
            name="Create Label"
            hideSubmitButton={true}
            initialValues={
              startColor ? { color: new Color(startColor) } : { color: null }
            }
            fields={[
              {
                field: { name: true },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "internal-service",
                dataTestId: "label-name",
              },
              {
                field: { description: true },
                title: "Description",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "This label is for all the internal services.",
              },
              {
                field: { color: true },
                title: "Label Color",
                fieldType: FormFieldSchemaType.Color,
                required: true,
                placeholder: "Please select color for this label.",
                dataTestId: "label-color",
              },
            ]}
            onSubmit={(values) => {
              setSubmitted(toJSON(values));
              setIsOpen(false);
            }}
          />
        </Modal>
      ) : (
        <></>
      )}
    </main>
  );
}

function OptionsDialog() {
  const [value, setValue] = useState(
    '[{"value":"Low","color":"#16a34a"},{"value":"Medium"},{"value":"High","color":"#3e409a"},{"value":"Urgent"},{"value":"Critical","color":"#ef4444"},{"value":"Blocker"}]',
  );
  const [isOpen, setIsOpen] = useState(true);

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-700">
      <p data-testid="dialog-state" className="text-xs">
        {isOpen ? "open" : "closed"}
      </p>
      <pre data-testid="submitted" className="text-xs">
        {value}
      </pre>
      {isOpen ? (
        <Modal
          title="Create Custom Field"
          submitButtonText="Create Custom Field"
          onClose={() => {
            setIsOpen(false);
          }}
          onSubmit={() => {}}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              The values people can pick for this field, each with an
              optional color.
            </p>
            <div className="h-48 rounded-md border border-dashed border-gray-300"></div>
            <DropdownOptionsInput initialValue={value} onChange={setValue} />
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </main>
  );
}

function PageField() {
  const [color, setColor] = useState("");
  const [footColor, setFootColor] = useState("#0d9488");

  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-700">
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <span id="page-color-label" className="text-sm font-medium">
          Service Color
        </span>
        <div className="mt-2">
          <ColorPicker
            ariaLabelledby="page-color-label"
            dataTestId="page-color"
            value={color}
            onChange={(next) => {
              setColor(next ? next.toString() : "");
            }}
          />
        </div>
      </section>
      <pre data-testid="submitted" className="mt-4 text-xs">
        {color}
      </pre>
      <div className="h-[1200px]"></div>
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <span id="foot-color-label" className="text-sm font-medium">
          Foot Color
        </span>
        <div className="mt-2 w-60">
          <ColorPicker
            layout="compact"
            ariaLabelledby="foot-color-label"
            dataTestId="foot-color"
            value={footColor}
            onChange={(next) => {
              setFootColor(next ? next.toString() : "");
            }}
          />
        </div>
      </section>
    </main>
  );
}

function Fixture() {
  if (scenario === "options") {
    return <OptionsDialog />;
  }

  if (scenario === "page") {
    return <PageField />;
  }

  return <LabelDialog />;
}

createRoot(document.getElementById("root")).render(<Fixture />);
