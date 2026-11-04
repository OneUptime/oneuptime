import React from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import NewVersion, {
  NewVersionAudience,
} from "Common/UI/Utils/NewVersion/NewVersion";
import FileModel from "Common/Models/DatabaseModels/File";
import MimeType from "Common/Types/File/MimeType";
import "Common/UI/Styles/Theme.css";

/*
 * A form with one field that draws with a control in a file of its own (a
 * code editor, a Markdown editor, a file picker), as a real form draws it. It
 * imports none of those controls: this entry's own files are the first load,
 * and each control is fetched as the field needs it, so the spec can hold that
 * file back and measure the form before and after it arrives.
 */

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

// As every frontend's Index.tsx does: it is what hears what is typed on a form.
NewVersion.start({ audience: NewVersionAudience.Members });

// A document of this many lines that parses, so the status bar says so.
const jsonLinesOf = (count) => {
  return JSON.stringify(
    Array.from({ length: count - 2 }, (_, index) => {
      return index;
    }),
    null,
    2,
  );
};

const yamlLinesOf = (count) => {
  return Array.from({ length: count }, (_, index) => {
    return `line${index + 1}: value`;
  }).join("\n");
};

const fileNamed = (name, id) => {
  const file = new FileModel();
  file._id = id;
  file.name = name;
  file.fileType = MimeType.pdf;
  return file;
};

const VARIABLES = [
  {
    title: "Incident",
    variables: [{ name: "incident.title", description: "Title" }],
  },
];

const SCENARIOS = {
  "json-empty": { fieldType: FormFieldSchemaType.JSON },
  "json-three-lines": {
    fieldType: FormFieldSchemaType.JSON,
    value: '{\n  "retries": 3\n}',
  },
  "json-ten-lines": {
    fieldType: FormFieldSchemaType.JSON,
    value: jsonLinesOf(10),
  },
  "json-too-long": {
    fieldType: FormFieldSchemaType.JSON,
    value: jsonLinesOf(80),
  },
  "json-with-variables": {
    fieldType: FormFieldSchemaType.JSON,
    templateVariables: VARIABLES,
  },
  "html-empty": { fieldType: FormFieldSchemaType.HTML },
  "css-empty": { fieldType: FormFieldSchemaType.CSS },
  "javascript-empty": { fieldType: FormFieldSchemaType.JavaScript },
  "yaml-empty": { fieldType: FormFieldSchemaType.YAML },
  "yaml-thirty-lines": {
    fieldType: FormFieldSchemaType.YAML,
    value: yamlLinesOf(30),
  },
  "markdown-empty": { fieldType: FormFieldSchemaType.Markdown },
  "markdown-short": {
    fieldType: FormFieldSchemaType.Markdown,
    value: "Rolled back the deploy.",
  },
  "markdown-with-variables": {
    fieldType: FormFieldSchemaType.Markdown,
    templateVariables: VARIABLES,
  },
  "file-empty": { fieldType: FormFieldSchemaType.File },
  "image-empty": { fieldType: FormFieldSchemaType.ImageFile },
  "files-empty": { fieldType: FormFieldSchemaType.MultipleFiles },
  "file-held": {
    fieldType: FormFieldSchemaType.File,
    value: fileNamed("runbook.pdf", "11111111-1111-4111-8111-111111111111"),
  },
  "files-held": {
    fieldType: FormFieldSchemaType.MultipleFiles,
    value: [
      fileNamed("runbook.pdf", "11111111-1111-4111-8111-111111111111"),
      fileNamed("postmortem.pdf", "22222222-2222-4222-8222-222222222222"),
    ],
  },
  "files-full": {
    fieldType: FormFieldSchemaType.MultipleFiles,
    maxFiles: 2,
    value: [
      fileNamed("runbook.pdf", "11111111-1111-4111-8111-111111111111"),
      fileNamed("postmortem.pdf", "22222222-2222-4222-8222-222222222222"),
    ],
  },
};

const params = new URLSearchParams(window.location.search);
const { value, ...scenario } = SCENARIOS[params.get("scenario")];

const fields = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
  },
  {
    field: { config: true },
    title: "Config",
    description: "What this form is about.",
    ...scenario,
  },
];

createRoot(document.getElementById("root")).render(
  <main className="mx-auto max-w-2xl p-4">
    <div data-testid="the-form" className="rounded-xl bg-white p-5">
      <BasicForm
        id="form-field-loading"
        fields={fields}
        initialValues={{
          name: "Database",
          ...(value === undefined ? {} : { config: value }),
        }}
        onSubmit={() => {}}
        submitButtonText="Save"
        disableAutofocus={true}
      />
    </div>
  </main>,
);
