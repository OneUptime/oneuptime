import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import Modal, { ModalWidth } from "../Modal/Modal";
import AILoader from "./AILoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import ButtonType from "../Button/ButtonTypes";
import { ButtonStyleType } from "../Button/Button";
import IconProp from "../../../Types/Icon/IconProp";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import MarkdownEditor from "../Markdown.tsx/MarkdownEditor";

export interface GenerateFromAIModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  onGenerate: (data: GenerateAIRequestData) => Promise<string>;
  onSuccess: (generatedContent: string) => void;
  templates?: Array<{ id: string; name: string; content?: string }>;
}

export interface GenerateAIRequestData {
  template?: string;
  templateId?: string;
}

// Default hardcoded templates for incident postmortem
const DEFAULT_TEMPLATES: Array<{ id: string; name: string; content: string }> =
  [
    {
      id: "default-standard",
      name: "Standard Postmortem",
      content: `## Executive Summary
[Brief overview of the incident, its impact, and resolution]

## Incident Timeline
| Time | Event |
|------|-------|
| [Time] | [Event description] |

## Root Cause Analysis
[Detailed analysis of what caused the incident]

## Impact Assessment
- **Duration**: [How long the incident lasted]
- **Users Affected**: [Number or percentage of affected users]
- **Services Affected**: [List of affected services]

## Resolution
[Steps taken to resolve the incident]

## Action Items
- [ ] [Action item 1]
- [ ] [Action item 2]
- [ ] [Action item 3]

## Lessons Learned
[Key takeaways and improvements identified]`,
    },
    {
      id: "default-detailed",
      name: "Detailed Technical Postmortem",
      content: `## Incident Overview
**Incident Title**: [Title]
**Severity**: [P1/P2/P3/P4]
**Duration**: [Start time] - [End time]
**Authors**: [Names]

## Summary
[2-3 sentence summary of the incident]

## Detection
- **How was the incident detected?** [Monitoring alert / Customer report / etc.]
- **Time to detection**: [Duration from start to detection]

## Timeline
| Timestamp | Action | Owner |
|-----------|--------|-------|
| [Time] | [What happened] | [Who did it] |

## Root Cause
### Primary Cause
[Detailed explanation of the root cause]

### Contributing Factors
1. [Factor 1]
2. [Factor 2]

## Impact
### Customer Impact
[Description of how customers were affected]

### Business Impact
[Description of business consequences]

### Technical Impact
[Systems and services affected]

## Mitigation & Resolution
### Immediate Actions
[Steps taken to stop the bleeding]

### Permanent Fix
[Long-term solution implemented]

## Prevention
### What Went Well
- [Item 1]
- [Item 2]

### What Went Wrong
- [Item 1]
- [Item 2]

### Where We Got Lucky
- [Item 1]

## Action Items
| Action | Owner | Priority | Due Date |
|--------|-------|----------|----------|
| [Action] | [Name] | [High/Medium/Low] | [Date] |

## Appendix
[Any additional technical details, logs, or graphs]`,
    },
    {
      id: "default-brief",
      name: "Brief Postmortem",
      content: `## What Happened
[Concise description of the incident]

## Why It Happened
[Root cause explanation]

## How We Fixed It
[Resolution steps]

## How We Prevent It
- [ ] [Prevention action 1]
- [ ] [Prevention action 2]`,
    },
  ];

const GenerateFromAIModal: FunctionComponent<GenerateFromAIModalProps> = (
  props: GenerateFromAIModalProps,
): ReactElement => {
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    DEFAULT_TEMPLATES[0]?.id || "",
  );
  const [templateContent, setTemplateContent] = useState<string>("");

  // Combine default templates with custom templates
  const allTemplates: Array<{ id: string; name: string; content?: string }> = [
    ...DEFAULT_TEMPLATES,
    ...(props.templates || []),
  ];

  // Build dropdown options
  const templateOptions: Array<DropdownOption> = allTemplates.map(
    (template: { id: string; name: string; content?: string }) => {
      return {
        label: template.name,
        value: template.id,
      };
    },
  );

  // Update template content when selection changes
  useEffect(() => {
    if (selectedTemplateId) {
      const selectedTemplate:
        | { id: string; name: string; content?: string }
        | undefined = allTemplates.find(
        (t: { id: string; name: string; content?: string }) => {
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
        {error && <ErrorMessage message={error} />}

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
                <div className="border border-gray-200 rounded-md">
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
