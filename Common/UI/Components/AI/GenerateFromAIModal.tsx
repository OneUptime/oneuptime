import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import Modal, { ModalWidth } from "../Modal/Modal";
import AILoader from "./AILoader";
import Alert, { AlertType } from "../Alerts/Alert";
import ButtonType from "../Button/ButtonTypes";
import { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import MarkdownEditor from "../Markdown.tsx/MarkdownEditor";

export interface AITemplate {
  id: string;
  name: string;
  content?: string;
}

export interface GenerateFromAIModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  onGenerate: (data: GenerateAIRequestData) => Promise<string>;
  onSuccess: (generatedContent: string) => void;
  templates: Array<AITemplate>;
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    props.templates[0]?.id || "",
  );
  const [templateContent, setTemplateContent] = useState<string>("");

  // Build dropdown options
  const templateOptions: Array<DropdownOption> = props.templates.map(
    (template: AITemplate) => {
      return {
        label: template.name,
        value: template.id,
      };
    },
  );

  // Update template content when selection changes
  useEffect(() => {
    if (selectedTemplateId) {
      const selectedTemplate: AITemplate | undefined = props.templates.find(
        (t: AITemplate) => {
          return t.id === selectedTemplateId;
        },
      );
      setTemplateContent(selectedTemplate?.content || "");
    } else {
      setTemplateContent("");
    }
  }, [selectedTemplateId]);

  const handleGenerate: () => Promise<void> = async (): Promise<void> => {
    setIsGenerating(true);
    setError("");

    try {
      const requestData: GenerateAIRequestData = {};

      // Use the edited template content if a template was selected
      if (selectedTemplateId && templateContent) {
        requestData.template = templateContent;
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
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      submitButtonType={ButtonType.Button}
      isLoading={isGenerating}
      disableSubmitButton={isGenerating}
      onSubmit={handleGenerate}
      modalWidth={ModalWidth.Large}
      icon={IconProp.Bolt}
    >
      <>
        {error && (
          <Alert
            type={AlertType.DANGER}
            strongTitle="Error"
            title={error}
            className="mb-4"
          />
        )}

        {isGenerating && <AILoader />}

        {!isGenerating && (
          <div className="space-y-4">
            {/* Template Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Template
              </label>
              <Dropdown
                options={templateOptions}
                value={templateOptions.find((opt: DropdownOption) => {
                  return opt.value === selectedTemplateId;
                })}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setSelectedTemplateId((value as string) || "");
                }}
                placeholder="Select a template..."
              />
              <p className="mt-1 text-xs text-gray-500">
                Choose a template to guide the AI generation. You can edit it
                below before generating.
              </p>
            </div>

            {/* Template Preview/Editor */}
            {selectedTemplateId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Preview
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Edit the template below. AI will fill in the sections with
                  incident data.
                </p>
                <div className="">
                  <MarkdownEditor
                    key={selectedTemplateId}
                    initialValue={templateContent}
                    onChange={(value: string) => {
                      setTemplateContent(value);
                    }}
                    placeholder="Template content..."
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </>
    </Modal>
  );
};

export default GenerateFromAIModal;
