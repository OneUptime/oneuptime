/*
 * The first step of the create-a-workflow wizard: how to start.
 *
 * The maintainer, about the version before this one: "This select template
 * for workflow is extremely hard to use because it shows a lot of
 * information on the modal ... 'Start from scratch' should be more visible
 * as well because that's the most commonly used option." That version had a
 * search box with a plain Start from scratch button beside it, a column of
 * twelve categories with counts, the list, and a preview column that was
 * always open.
 *
 * So the step now reads top to bottom, and shows little until asked: Start
 * from scratch first and largest, then a few recommended templates as
 * one-line rows under "Or start from a template", with a search box and a
 * category select beside the heading, and a template's details - what
 * starts it, what it is made of, what it will ask for - inside its row once
 * it is picked. The dialog's one primary button, Use this template, is in
 * its footer, and only there while a template is picked (see
 * CreateWorkflowModal).
 *
 * The step itself is the shared template picker
 * (Components/TemplatePicker/TemplatePicker), which Create a dashboard draws
 * too: the maintainer asked for the dashboard templates to work the way
 * these do. What is the workflow's own is here: the catalog's rules
 * (Utils/Workflow/WorkflowTemplatePickerUtil), what an empty start gives, and
 * a picked template's details.
 *
 * Everything it remembers is held by the wizard (see
 * WorkflowTemplatePickerState), so Back from Name finds it as it was left.
 */

import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  WorkflowTemplate,
  WorkflowTemplateVariable,
  WorkflowTemplateWhoToPage,
} from "Common/Types/Workflow/Templates";
import {
  WORKFLOW_TEMPLATE_PICKER_RULES,
  WorkflowTemplatePickerState,
  WorkflowTemplatePreview,
  WorkflowTemplatePreviewBlock,
  getWorkflowTemplatePreview,
} from "../../Utils/Workflow/WorkflowTemplatePickerUtil";
import TemplatePicker, {
  getTemplatePickerIds,
  templateOptionDomId,
} from "../TemplatePicker/TemplatePicker";
import {
  TemplateDetails,
  TemplateDetailsChip,
  TemplateDetailsRow,
  TemplateDetailsRowHolds,
} from "../TemplatePicker/TemplateDetails";

export interface ComponentProps {
  state: WorkflowTemplatePickerState;
  onStateChange: (state: WorkflowTemplatePickerState) => void;
  /** Go on to the Name step with this template. */
  onUseTemplate: (template: WorkflowTemplate) => void;
  /** Go on to the Name step with an empty canvas. */
  onStartFromScratch: () => void;
  /** An empty canvas is the start already chosen, as after Back from Name. */
  isStartFromScratchChosen: boolean;
}

// What every id and test id of the step starts with.
const WORKFLOW_PICKER_ID_PREFIX: string = "workflow";

export const WORKFLOW_START_FROM_SCRATCH_ID: string = getTemplatePickerIds(
  WORKFLOW_PICKER_ID_PREFIX,
).startFromScratch;
export const WORKFLOW_TEMPLATE_SEARCH_INPUT_ID: string = getTemplatePickerIds(
  WORKFLOW_PICKER_ID_PREFIX,
).searchInput;
export const WORKFLOW_TEMPLATE_VIEW_SELECT_ID: string = getTemplatePickerIds(
  WORKFLOW_PICKER_ID_PREFIX,
).viewSelect;
export const WORKFLOW_TEMPLATE_LISTBOX_ID: string = getTemplatePickerIds(
  WORKFLOW_PICKER_ID_PREFIX,
).listbox;

type OptionDomIdFunction = (templateId: string) => string;

export const workflowTemplateOptionDomId: OptionDomIdFunction = (
  templateId: string,
): string => {
  return templateOptionDomId(WORKFLOW_PICKER_ID_PREFIX, templateId);
};

type TranslateFunction = (value: string) => string;

interface WorkflowTemplateDetailsProps {
  template: WorkflowTemplate;
  tx: TranslateFunction;
}

/*
 * What a picked template's row opens to show, before anything is created:
 * how it works - what starts it, then the kinds of block it is made of, as
 * the canvas names them - and what the next steps will ask for. Two short
 * lines, where the old preview was a column of its own. Drawn with the
 * shared details rows and chips (TemplatePicker/TemplateDetails), as a
 * dashboard template's are.
 *
 * A template that pages people lists who it asks to page beside its
 * settings (whoToPage): the Configure step asks for both. A template can
 * also leave something for the Builder that no step here can ask for -
 * Huntress's signing secret, added on its trigger. Its details say so
 * (setUpInBuilder) rather than "Nothing to fill in.".
 */
const WorkflowTemplateDetails: FunctionComponent<
  WorkflowTemplateDetailsProps
> = (props: WorkflowTemplateDetailsProps): ReactElement => {
  const preview: WorkflowTemplatePreview | null = useMemo(() => {
    return getWorkflowTemplatePreview(props.template);
  }, [props.template.id]);
  const tx: TranslateFunction = props.tx;

  if (!preview) {
    return <></>;
  }

  // Template text is shown as it is written, like its name and description.
  const setUpInBuilder: string = (preview.template.setUpInBuilder || "").trim();

  return (
    <TemplateDetails dataTestId="workflow-template-details">
      <TemplateDetailsRow
        label={tx("How It Works")}
        holds={TemplateDetailsRowHolds.Chips}
      >
        <ul
          className="flex flex-wrap items-center gap-1.5"
          data-testid="workflow-template-details-blocks"
        >
          <li className="flex max-w-full items-center gap-1.5">
            {/* One block as the builder's canvas names it: its icon and its title. */}
            <TemplateDetailsChip
              icon={preview.trigger.icon}
              label={preview.trigger.title}
              isAccent={true}
              screenReaderPrefix={`${tx("Trigger")}: `}
              dataTestId="workflow-template-details-trigger"
            />
            <Icon
              icon={IconProp.ArrowRight}
              className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
            />
          </li>
          {preview.steps.map(
            (block: WorkflowTemplatePreviewBlock): ReactElement => {
              return (
                <li key={block.componentId} className="flex max-w-full">
                  <TemplateDetailsChip
                    icon={block.icon}
                    label={block.title}
                    dataTestId="workflow-template-details-step"
                  />
                </li>
              );
            },
          )}
        </ul>
      </TemplateDetailsRow>

      <TemplateDetailsRow
        label={tx("What you'll need")}
        holds={TemplateDetailsRowHolds.Text}
      >
        {preview.settings.length > 0 || preview.whoToPage.length > 0 ? (
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1"
            data-testid="workflow-template-details-settings"
          >
            {preview.settings.map(
              (variable: WorkflowTemplateVariable): ReactElement => {
                return (
                  <li
                    key={variable.name}
                    className="flex items-center gap-1.5 text-sm text-gray-700"
                    data-testid={`workflow-template-details-setting-${variable.name}`}
                  >
                    {/* A lock marks a secret. */}
                    {variable.isSecret ? (
                      <Icon
                        icon={IconProp.Lock}
                        className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                      />
                    ) : (
                      <></>
                    )}
                    <span className="min-w-0">
                      {variable.title}
                      {variable.isSecret ? (
                        <span className="sr-only">{`, ${tx("Secret")}`}</span>
                      ) : (
                        <></>
                      )}
                      {variable.required ? (
                        <></>
                      ) : (
                        <span className="ml-1 text-gray-400">
                          ({tx("Optional")})
                        </span>
                      )}
                    </span>
                  </li>
                );
              },
            )}
            {/* Who a Page step pages, picked from the project's own people: a person icon marks it. */}
            {preview.whoToPage.map(
              (ask: WorkflowTemplateWhoToPage): ReactElement => {
                return (
                  <li
                    key={ask.componentId}
                    className="flex items-center gap-1.5 text-sm text-gray-700"
                    data-testid={`workflow-template-details-who-to-page-${ask.componentId}`}
                  >
                    <Icon
                      icon={IconProp.User}
                      className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    />
                    <span className="min-w-0">
                      {ask.title}
                      {ask.required ? (
                        <></>
                      ) : (
                        <span className="ml-1 text-gray-400">
                          ({tx("Optional")})
                        </span>
                      )}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
        {setUpInBuilder ? (
          <p
            className="text-sm text-gray-600"
            data-testid="workflow-template-details-in-builder"
          >
            {setUpInBuilder}
          </p>
        ) : (
          <></>
        )}
        {preview.settings.length === 0 &&
        preview.whoToPage.length === 0 &&
        !setUpInBuilder ? (
          <p
            className="text-sm text-gray-600"
            data-testid="workflow-template-details-no-settings"
          >
            {tx("Nothing to fill in.")}
          </p>
        ) : (
          <></>
        )}
      </TemplateDetailsRow>
    </TemplateDetails>
  );
};

const WorkflowTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: TranslateFunction = (value: string): string => {
    return translateString(value) || value;
  };

  return (
    <TemplatePicker
      idPrefix={WORKFLOW_PICKER_ID_PREFIX}
      rules={WORKFLOW_TEMPLATE_PICKER_RULES}
      state={props.state}
      onStateChange={props.onStateChange}
      onUseTemplate={props.onUseTemplate}
      onStartFromScratch={props.onStartFromScratch}
      isStartFromScratchChosen={props.isStartFromScratchChosen}
      startFromScratchDescription={tx(
        "Begin with an empty canvas and add your own trigger and steps.",
      )}
      renderDetails={(template: WorkflowTemplate): ReactElement => {
        return <WorkflowTemplateDetails template={template} tx={tx} />;
      }}
    />
  );
};

export default WorkflowTemplatePicker;
