import FormsCopy from "../FormsCopy";
import {
  FORM_BRANDING_UPLOAD_TYPES,
  FormBrandingValues,
  getFormBrandingItems,
  getFormBrandingPreview,
  getFormBrandingSummary,
} from "./FormBrandingValues";
import OneUptimeFavicon from "../../../../public/assets/img/favicons/favicon-32x32.png";
import Form from "Common/Models/DatabaseModels/Form";
import {
  getPublicFormImageUrl,
  PublicFormBranding,
} from "Common/Types/Form/FormBranding";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import PublicFormLogo from "Common/UI/Components/PublicForm/PublicFormLogo";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The Build page's Branding section, above the questions: "Can you please
 * add a branding section to the form so they can upload their own logos and
 * stuff? By default, we can have the oneuptime logo and also collapse the
 * branding section by default." - the maintainer.
 *
 * It starts folded, every time, as one line that says what is inside -
 * "Logo · Favicon", the ones the form has of its own drawn as set - and,
 * while the OneUptime ones are in force, that they are. Open, it shows both
 * as the form's page will: the logo as it sits at the top of the page (the
 * same component draws it there), and the favicon in a browser tab beside
 * the form's name, which is what the tab shows. Edit Branding changes them
 * in one short dialog: upload or remove the logo, say what it shows for
 * screen readers, upload or remove the favicon. People who can read the
 * form but not edit it see the section without the button.
 *
 * On the Build page because that is where the form looks the way people
 * will see it, from the top down - the logo, the name, the questions - and
 * where Preview shows the page; the Share page is about who can reach it.
 */

export const FORM_BRANDING_TEST_ID: string = "form-branding";

export interface ComponentProps {
  formId: ObjectID;
  // The form's name: the title of its browser tab, beside the favicon.
  formName: string;
  values: FormBrandingValues;
  isReadOnly: boolean;
  onSaved: () => void;
}

const FormBrandingSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Exactly what the form's page is handed, and so draws.
  const preview: PublicFormBranding = getFormBrandingPreview(props.values);

  return (
    <div className="mb-5" data-testid={FORM_BRANDING_TEST_ID}>
      <FoldedSection
        title="Branding"
        icon={IconProp.Image}
        description={FormsCopy.brandingDescription}
        items={getFormBrandingItems(preview)}
        summary={getFormBrandingSummary(preview)}
        defaultCollapsed={true}
        isElevated={true}
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="min-w-0" data-testid="form-branding-logo">
            <div className="text-sm font-medium text-gray-900">
              {tx("Logo")}
            </div>
            <div className="mt-2 flex h-24 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 px-4">
              <PublicFormLogo
                logo={preview.logo}
                altText={preview.logoAltText}
              />
            </div>
            <p
              className="mt-2 break-words text-sm text-gray-500"
              data-testid="form-branding-logo-note"
            >
              {preview.logo ? (
                <>
                  <span className="font-medium text-gray-700">
                    {tx("Logo Alt Text")}
                  </span>
                  {": "}
                  {preview.logoAltText || tx(FormsCopy.logoAltTextEmpty)}
                </>
              ) : (
                tx(FormsCopy.logoDefault)
              )}
            </p>
          </div>

          <div className="min-w-0" data-testid="form-branding-favicon">
            <div className="text-sm font-medium text-gray-900">
              {tx("Favicon")}
            </div>
            {/*
             * A browser tab: the favicon beside the form's name, which is
             * the tab's title while the form is open.
             */}
            <div className="mt-2 flex h-24 items-end justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 px-4">
              <div className="flex min-w-0 max-w-full items-center gap-2 rounded-t-lg border border-b-0 border-gray-200 bg-white px-3 py-2">
                <img
                  className="h-4 w-4 flex-none object-contain"
                  src={
                    preview.favicon
                      ? getPublicFormImageUrl(preview.favicon)
                      : OneUptimeFavicon
                  }
                  alt=""
                  data-testid="form-branding-favicon-image"
                  data-favicon={preview.favicon ? "form" : "oneuptime"}
                />
                <span className="truncate text-sm text-gray-700">
                  {props.formName}
                </span>
              </div>
            </div>
            {preview.favicon ? (
              <></>
            ) : (
              <p
                className="mt-2 text-sm text-gray-500"
                data-testid="form-branding-favicon-note"
              >
                {tx(FormsCopy.faviconDefault)}
              </p>
            )}
          </div>
        </div>

        {props.isReadOnly ? (
          <></>
        ) : (
          <div className="mt-5 flex justify-end">
            <Button
              title={FormsCopy.editBranding}
              icon={IconProp.Edit}
              buttonStyle={ButtonStyleType.NORMAL}
              className="!ml-0"
              dataTestId="form-branding-edit"
              onClick={() => {
                setIsEditing(true);
              }}
            />
          </div>
        )}
      </FoldedSection>

      {isEditing ? (
        <ModelFormModal<Form>
          title={FormsCopy.editBranding}
          description={FormsCopy.brandingDescription}
          submitButtonText={FormsCopy.saveChanges}
          name="form-branding"
          modelType={Form}
          modelIdToEdit={props.formId}
          onClose={() => {
            setIsEditing(false);
          }}
          onSuccess={() => {
            setIsEditing(false);
            props.onSaved();
          }}
          formProps={{
            id: "form-branding-form",
            modelType: Form,
            formType: FormType.Update,
            name: "Form Branding",
            fields: [
              {
                field: {
                  logoFile: true,
                },
                title: "Logo",
                description: FormsCopy.logoDescription,
                fieldType: FormFieldSchemaType.ImageFile,
                fileTypes: FORM_BRANDING_UPLOAD_TYPES,
                required: false,
                placeholder: "Upload logo",
              },
              {
                field: {
                  logoAltText: true,
                },
                title: "Logo Alt Text",
                description: FormsCopy.logoAltTextDescription,
                fieldType: FormFieldSchemaType.Text,
                required: false,
                placeholder: FormsCopy.logoAltTextPlaceholder,
                // Only a logo of the form's own is read out.
                showIf: (values: FormValues<Form>): boolean => {
                  return Boolean((values as JSONObject)["logoFile"]);
                },
              },
              {
                field: {
                  faviconFile: true,
                },
                title: "Favicon",
                description: FormsCopy.faviconDescription,
                fieldType: FormFieldSchemaType.ImageFile,
                fileTypes: FORM_BRANDING_UPLOAD_TYPES,
                required: false,
                placeholder: FormsCopy.uploadFavicon,
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default FormBrandingSection;
