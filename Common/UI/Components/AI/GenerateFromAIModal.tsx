import React, { FunctionComponent, ReactElement, useState } from "react";
import Modal, { ModalWidth } from "../Modal/Modal";
import AILoader from "./AILoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm from "../Forms/BasicForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../Types/JSON";
import { DropdownOption } from "../Dropdown/Dropdown";
import ButtonType from "../Button/ButtonTypes";
import { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";

export interface GenerateFromAIModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  onGenerate: (data: GenerateAIRequestData) => Promise<string>;
  onSuccess: (generatedContent: string) => void;
  templates?: Array<{ id: string; name: string; content?: string }>;
  /** Optional list of data sources that will be used for generation (shown when no templates) */
  dataSourceItems?: Array<string>;
}

export interface GenerateAIRequestData {
  template?: string;
  templateId?: string;
}

const GenerateFromAIModal: FunctionComponent<GenerateFromAIModalProps> = (
  props: GenerateFromAIModalProps,
): ReactElement => {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [formData, setFormData] = useState<JSONObject>({});

  const templateOptions: Array<DropdownOption> = props.templates
    ? props.templates.map((template: { id: string; name: string }) => {
        return {
          label: template.name,
          value: template.id,
        };
      })
    : [];

  // Add "No template" option at the beginning
  if (templateOptions.length > 0) {
    templateOptions.unshift({
      label: "No template (AI will use default format)",
      value: "",
    });
  }

  const handleGenerate: () => Promise<void> = async (): Promise<void> => {
    setIsGenerating(true);
    setError("");

    try {
      // Get template content if a template was selected
      let templateContent: string | undefined = undefined;
      const selectedTemplateId: string | undefined = formData[
        "templateId"
      ] as string;

      if (selectedTemplateId && props.templates) {
        const selectedTemplate:
          | {
              id: string;
              name: string;
              content?: string;
            }
          | undefined = props.templates.find(
          (t: { id: string; name: string; content?: string }) => {
            return t.id === selectedTemplateId;
          },
        );
        templateContent = selectedTemplate?.content;
      }

      const requestData: GenerateAIRequestData = {};

      if (templateContent) {
        requestData.template = templateContent;
      }

      if (selectedTemplateId) {
        requestData.templateId = selectedTemplateId;
      }

      const generatedContent: string = await props.onGenerate(requestData);
      props.onSuccess(generatedContent);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An error occurred while generating content.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const formFields: Array<{
    field: { [key: string]: boolean };
    title: string;
    fieldType: FormFieldSchemaType;
    required?: boolean;
    description?: string;
    dropdownOptions?: Array<DropdownOption>;
    defaultValue?: boolean;
  }> = [];

  // Add template selection if templates are provided
  if (props.templates && props.templates.length > 0) {
    formFields.push({
      field: {
        templateId: true,
      },
      title: "Select Template (Optional)",
      fieldType: FormFieldSchemaType.Dropdown,
      required: false,
      description: "Choose a template to guide the AI generation.",
      dropdownOptions: templateOptions,
    });
  }

  return (
    <Modal
      title={props.title}
      description={
        props.description ||
        "Generate content using AI based on the available data."
      }
      onClose={() => {
        if (!isGenerating) {
          props.onClose();
        }
      }}
      submitButtonText={isGenerating ? "Generating..." : "Generate with AI"}
      submitButtonStyleType={ButtonStyleType.SUCCESS}
      submitButtonType={ButtonType.Button}
      isLoading={isGenerating}
      disableSubmitButton={isGenerating}
      onSubmit={handleGenerate}
      modalWidth={ModalWidth.Medium}
      icon={IconProp.Bolt}
    >
      <>
        {error && <ErrorMessage message={error} />}

        {isGenerating && (
          <AILoader
            title="Generating with AI"
            subtitle="This may take a moment depending on the amount of data being analyzed."
            dataSourceItems={props.dataSourceItems}
          />
        )}

        {!isGenerating && formFields.length > 0 && (
          <BasicForm
            initialValues={formData}
            fields={formFields}
            hideSubmitButton={true}
            onChange={(values: JSONObject) => {
              setFormData(values);
            }}
          />
        )}

        {!isGenerating && formFields.length === 0 && (
          <div className="py-4 text-gray-600">
            <p>
              Click &quot;Generate with AI&quot; to create content based on the
              available data.
            </p>
            {props.dataSourceItems && props.dataSourceItems.length > 0 && (
              <ul className="list-disc ml-5 mt-2 space-y-1">
                {props.dataSourceItems.map(
                  (item: string, index: number): ReactElement => {
                    return <li key={index}>{item}</li>;
                  },
                )}
              </ul>
            )}
          </div>
        )}
      </>
    </Modal>
  );
};

export default GenerateFromAIModal;
