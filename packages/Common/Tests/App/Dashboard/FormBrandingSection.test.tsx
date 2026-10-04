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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { findNestedControls } from "../../Helpers/NestedControls";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * The Build page's Branding section, drawn for real: "Can you please add a
 * branding section to the form so they can upload their own logos and
 * stuff? By default, we can have the oneuptime logo and also collapse the
 * branding section by default." - the maintainer.
 *
 *   - It starts folded, saying what is inside and, while they are in force,
 *     that the OneUptime logo and favicon are what the form shows.
 *   - Open, it draws the logo as the form's page does and the favicon in a
 *     browser tab beside the form's name - OneUptime's until the form has
 *     its own.
 *   - Edit Branding is one short dialog; saving it has the page read the
 *     branding again. Someone who may not edit the form has no button.
 *
 * The dialog is stubbed (ModelFormModal has tests of its own): what it is
 * handed is what is checked here.
 */

const recordedDialogs: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      (
        globalThis as unknown as {
          __formBrandingDialogs: Array<Record<string, unknown>>;
        }
      ).__formBrandingDialogs.push(props);
      return React.createElement("div", { "data-testid": "stub-dialog" });
    },
  };
});

(
  globalThis as unknown as {
    __formBrandingDialogs: Array<Record<string, unknown>>;
  }
).__formBrandingDialogs = recordedDialogs;

import FormBrandingSection, {
  FORM_BRANDING_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/FormBrandingSection";
import {
  FORM_BRANDING_UPLOAD_MAX_MEGABYTES,
  FORM_BRANDING_UPLOAD_TYPES,
  FormBrandingValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/FormBrandingValues";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import File from "../../../Models/DatabaseModels/File";
import Form from "../../../Models/DatabaseModels/Form";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000dd";

const LOGO_BYTES: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const FAVICON_BYTES: Buffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"/>',
);

function image(fileType: string, bytes: Buffer): File {
  const file: File = new File();
  file._id = "f1000000-0000-4000-8000-000000000001";
  file.name = "image";
  file.fileType = fileType as MimeType;
  file.file = bytes;
  return file;
}

const LOGO: File = image(MimeType.png, LOGO_BYTES);
const FAVICON: File = image(MimeType.svg, FAVICON_BYTES);

let onSaved: MockFunction;

beforeEach(() => {
  recordedDialogs.length = 0;
  onSaved = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderSection(
  values: FormBrandingValues = {},
  isReadOnly: boolean = false,
): void {
  render(
    <FormBrandingSection
      formId={new ObjectID(FORM_ID)}
      formName="Report a Problem"
      values={values}
      isReadOnly={isReadOnly}
      onSaved={() => {
        onSaved();
      }}
    />,
  );
}

function section(): HTMLElement {
  return screen.getByTestId(FORM_BRANDING_TEST_ID);
}

function header(): HTMLElement {
  return within(section()).getByTestId("folded-section-header");
}

function open(): void {
  fireEvent.click(header());
}

function lastDialog(): Record<string, unknown> {
  return recordedDialogs[recordedDialogs.length - 1]!;
}

describe("folded", () => {
  test("starts folded, titled Branding, every time", () => {
    renderSection();

    expect(header()).toHaveAttribute("aria-expanded", "false");
    expect(
      within(header()).getByTestId("folded-section-title"),
    ).toHaveTextContent("Branding");
    expect(within(section()).getByTestId("folded-section")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    // Nothing inside can be reached while folded.
    expect(within(section()).getByTestId("folded-section-body")).toHaveClass(
      "invisible",
    );
  });

  test("says what is inside, and that the OneUptime logo and favicon are in force", () => {
    renderSection();

    expect(listedNames(header())).toEqual(["Logo", "Favicon"]);
    expect(setChips(header())).toEqual([]);
    expect(
      within(header()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(FormsCopy.brandingSummaryDefault);
  });

  test("the form's own logo is drawn as set, and the summary is about the favicon", () => {
    renderSection({ logoFile: LOGO });

    expect(setChips(header())).toEqual(["Logo"]);
    expect(
      within(header()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(FormsCopy.brandingSummaryDefaultFavicon);
  });

  test("with both of its own, no summary: the set items say it", () => {
    renderSection({ logoFile: LOGO, faviconFile: FAVICON });

    expect(setChips(header())).toEqual(["Logo", "Favicon"]);
    expect(
      within(header()).queryByTestId("collapsible-section-summary"),
    ).not.toBeInTheDocument();
  });

  test("the header is a button with nothing pressable inside it", () => {
    renderSection({ logoFile: LOGO });

    expect(header().tagName).toBe("BUTTON");
    expect(findNestedControls(section())).toEqual([]);
  });
});

describe("open", () => {
  test("shows the OneUptime logo and favicon until the form has its own", () => {
    renderSection();
    open();

    expect(header()).toHaveAttribute("aria-expanded", "true");
    expect(
      within(header()).getByTestId("folded-section-description"),
    ).toHaveTextContent(FormsCopy.brandingDescription);

    const logo: HTMLElement = within(
      screen.getByTestId("form-branding-logo"),
    ).getByTestId("form-logo");

    expect(logo).toHaveAttribute("data-logo", "oneuptime");
    expect(screen.getByTestId("form-branding-logo-note")).toHaveTextContent(
      FormsCopy.logoDefault,
    );

    const favicon: HTMLElement = screen.getByTestId(
      "form-branding-favicon-image",
    );

    expect(favicon).toHaveAttribute("data-favicon", "oneuptime");
    // A browser tab: the icon beside the form's name, the tab's title.
    expect(screen.getByTestId("form-branding-favicon")).toHaveTextContent(
      "Report a Problem",
    );
    expect(screen.getByTestId("form-branding-favicon-note")).toHaveTextContent(
      FormsCopy.faviconDefault,
    );
  });

  test("draws the form's own logo as its page does, with what it says for screen readers", () => {
    renderSection({ logoFile: LOGO, logoAltText: "Acme Inc." });
    open();

    const logo: HTMLElement = within(
      screen.getByTestId("form-branding-logo"),
    ).getByTestId("form-logo");

    expect(logo).toHaveAttribute("data-logo", "form");
    expect(logo).toHaveAttribute(
      "src",
      `data:image/png;base64,${LOGO_BYTES.toString("base64")}`,
    );
    expect(logo).toHaveAttribute("alt", "Acme Inc.");
    expect(screen.getByTestId("form-branding-logo-note")).toHaveTextContent(
      "Logo Alt Text: Acme Inc.",
    );
  });

  test("a logo without alt text says screen readers skip it", () => {
    renderSection({ logoFile: LOGO });
    open();

    expect(screen.getByTestId("form-branding-logo-note")).toHaveTextContent(
      `Logo Alt Text: ${FormsCopy.logoAltTextEmpty}`,
    );
  });

  test("draws the form's own favicon in the tab", () => {
    renderSection({ faviconFile: FAVICON });
    open();

    const favicon: HTMLElement = screen.getByTestId(
      "form-branding-favicon-image",
    );

    expect(favicon).toHaveAttribute("data-favicon", "form");
    expect(favicon).toHaveAttribute(
      "src",
      `data:image/svg+xml;base64,${FAVICON_BYTES.toString("base64")}`,
    );
    expect(
      screen.queryByTestId("form-branding-favicon-note"),
    ).not.toBeInTheDocument();
  });

  test("an image the form's page would not draw is shown as the OneUptime one", () => {
    renderSection({
      logoFile: image(MimeType.pdf, LOGO_BYTES),
      logoAltText: "Acme Inc.",
      faviconFile: image("text/html", Buffer.from("<html>")),
    });

    expect(setChips(header())).toEqual([]);

    open();

    expect(
      within(screen.getByTestId("form-branding-logo")).getByTestId("form-logo"),
    ).toHaveAttribute("data-logo", "oneuptime");
    expect(screen.getByTestId("form-branding-favicon-image")).toHaveAttribute(
      "data-favicon",
      "oneuptime",
    );
  });
});

describe("Edit Branding", () => {
  test("opens one short dialog: the logo, what it says, the favicon", () => {
    renderSection({ logoFile: LOGO });
    open();

    expect(screen.queryByTestId("stub-dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("form-branding-edit"));

    expect(screen.getByTestId("stub-dialog")).toBeInTheDocument();

    const dialog: Record<string, unknown> = lastDialog();
    const formProps: Record<string, unknown> = dialog["formProps"] as Record<
      string,
      unknown
    >;
    const fields: Array<Field<Form>> = formProps["fields"] as Array<
      Field<Form>
    >;

    expect(dialog["title"]).toBe(FormsCopy.editBranding);
    expect(dialog["submitButtonText"]).toBe(FormsCopy.saveChanges);
    expect(dialog["modelType"]).toBe(Form);
    expect((dialog["modelIdToEdit"] as ObjectID).toString()).toBe(FORM_ID);
    expect(formProps["formType"]).toBe(FormType.Update);
    // One page: no steps.
    expect(formProps["steps"]).toBeUndefined();

    expect(
      fields.map((field: Field<Form>): Array<unknown> => {
        return [
          Object.keys(field.field || {})[0],
          field.title,
          field.fieldType,
          field.required,
        ];
      }),
    ).toEqual([
      ["logoFile", "Logo", FormFieldSchemaType.ImageFile, false],
      ["logoAltText", "Logo Alt Text", FormFieldSchemaType.Text, false],
      ["faviconFile", "Favicon", FormFieldSchemaType.ImageFile, false],
    ]);

    // Uploads offer exactly the image types and the size the server takes.
    expect(fields[0]!.fileTypes).toEqual(FORM_BRANDING_UPLOAD_TYPES);
    expect(fields[2]!.fileTypes).toEqual(FORM_BRANDING_UPLOAD_TYPES);
    expect(FORM_BRANDING_UPLOAD_MAX_MEGABYTES).toBe(1);
    expect(fields[0]!.maxFileSizeInMegabytes).toBe(1);
    expect(fields[2]!.maxFileSizeInMegabytes).toBe(1);
    expect(fields[0]!.description).toBe(FormsCopy.logoDescription);
    expect(fields[1]!.description).toBe(FormsCopy.logoAltTextDescription);
    expect(fields[1]!.placeholder).toBe(FormsCopy.logoAltTextPlaceholder);
    expect(fields[2]!.description).toBe(FormsCopy.faviconDescription);
    expect(fields[2]!.placeholder).toBe(FormsCopy.uploadFavicon);
  });

  test("asks what the logo says only once there is a logo", () => {
    renderSection();
    open();
    fireEvent.click(screen.getByTestId("form-branding-edit"));

    const altText: Field<Form> = (
      (lastDialog()["formProps"] as Record<string, unknown>)["fields"] as Array<
        Field<Form>
      >
    )[1]!;

    expect(altText.showIf!({})).toBe(false);
    expect(altText.showIf!({ logoFile: null } as never)).toBe(false);
    expect(altText.showIf!({ logoFile: LOGO } as never)).toBe(true);
  });

  test("saving closes the dialog and has the page read the branding again", async () => {
    renderSection();
    open();
    fireEvent.click(screen.getByTestId("form-branding-edit"));

    await act(async () => {
      (lastDialog()["onSuccess"] as (form: Form) => void)(new Form());
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("stub-dialog")).not.toBeInTheDocument();
  });

  test("closing it changes nothing", async () => {
    renderSection();
    open();
    fireEvent.click(screen.getByTestId("form-branding-edit"));

    await act(async () => {
      (lastDialog()["onClose"] as () => void)();
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stub-dialog")).not.toBeInTheDocument();
  });

  test("someone who may not edit the form sees the branding, and no button", () => {
    renderSection({ logoFile: LOGO }, true);
    open();

    expect(
      within(screen.getByTestId("form-branding-logo")).getByTestId("form-logo"),
    ).toHaveAttribute("data-logo", "form");
    expect(screen.queryByTestId("form-branding-edit")).not.toBeInTheDocument();
  });
});
