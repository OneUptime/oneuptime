import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import API from "Common/UI/Utils/API/API";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  saveWhiteLabelSettings,
  WhiteLabelSettingsView,
} from "./WhiteLabelSettingsAPI";

/*
 * The product's name and website: what the installation is called in place
 * of OneUptime, and where its "Powered by" lines link to. Shown as two rows,
 * changed together in one small form.
 */

interface ProductNameFormValues {
  productName: string;
  websiteUrl: string;
}

export interface ComponentProps {
  settings: WhiteLabelSettingsView;
  onSaved: (settings: WhiteLabelSettingsView) => void;
}

interface DetailRowProps {
  label: string;
  value: ReactElement;
  testId: string;
}

const DetailRow: FunctionComponent<DetailRowProps> = (
  props: DetailRowProps,
): ReactElement => {
  return (
    <div className="py-3 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-gray-500">{props.label}</dt>
      <dd
        className="mt-1 text-sm text-gray-900 sm:col-span-2 sm:mt-0 [overflow-wrap:anywhere]"
        data-testid={props.testId}
      >
        {props.value}
      </dd>
    </div>
  );
};

const WhiteLabelProductNameCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const save: (values: ProductNameFormValues) => Promise<void> = async (
    values: ProductNameFormValues,
  ): Promise<void> => {
    setIsSaving(true);
    setError("");

    try {
      const settings: WhiteLabelSettingsView = await saveWhiteLabelSettings({
        productName: (values.productName || "").trim() || null,
        websiteUrl: (values.websiteUrl || "").trim() || null,
      });

      props.onSaved(settings);
      setShowModal(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card
      title="Product name"
      description="Shown in place of OneUptime: in page titles, on the sign-in pages, in emails and on status pages. Pages opened after you save show it."
      buttons={[
        {
          title: "Edit",
          icon: IconProp.Edit,
          buttonStyle: ButtonStyleType.NORMAL,
          onClick: () => {
            setError("");
            setShowModal(true);
          },
        },
      ]}
    >
      <>
        <dl className="-my-3 divide-y divide-gray-100">
          <DetailRow
            label="Product name"
            testId="white-label-product-name"
            value={
              props.settings.productName ? (
                <span className="font-medium">
                  {props.settings.productName}
                </span>
              ) : (
                <span className="text-gray-500">OneUptime (not changed)</span>
              )
            }
          />
          <DetailRow
            label="Website"
            testId="white-label-website"
            value={
              props.settings.websiteUrl ? (
                <a
                  href={props.settings.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:underline"
                >
                  {props.settings.websiteUrl}
                </a>
              ) : (
                <span className="text-gray-500">
                  Not set. &quot;Powered by&quot; lines have no link.
                </span>
              )
            }
          />
        </dl>

        {showModal ? (
          <BasicFormModal<ProductNameFormValues>
            title="Product name"
            name="White Label Product Name"
            isLoading={isSaving}
            submitButtonText="Save"
            onClose={() => {
              setShowModal(false);
              setError("");
            }}
            onSubmit={(values: ProductNameFormValues) => {
              void save(values);
            }}
            formProps={{
              id: "white-label-product-name-form",
              name: "White Label Product Name",
              error: error,
              initialValues: {
                productName: props.settings.productName || "",
                websiteUrl: props.settings.websiteUrl || "",
              },
              fields: [
                {
                  field: {
                    productName: true,
                  },
                  title: "Product name",
                  description:
                    "Up to 50 characters. Leave it empty to go by OneUptime.",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "OneUptime",
                },
                {
                  field: {
                    websiteUrl: true,
                  },
                  title: "Website",
                  description:
                    "Where \"Powered by\" lines in emails and on status pages link to. Leave it empty for no link.",
                  fieldType: FormFieldSchemaType.Text,
                  required: false,
                  placeholder: "https://example.com",
                  disableSpellCheck: true,
                },
              ],
            }}
          />
        ) : (
          <></>
        )}
      </>
    </Card>
  );
};

export default WhiteLabelProductNameCard;
