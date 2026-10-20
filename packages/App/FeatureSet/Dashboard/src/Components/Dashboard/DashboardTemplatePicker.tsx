/*
 * The first step of Create a dashboard: how to start.
 *
 * It used to be a dialog of its own, Create from Template: sixteen
 * equally large cards, each with three or four lines of description, in
 * four labelled groups that ran past the bottom of the dialog - Blank
 * Dashboard among them as one more card - and a click on any card went
 * straight on to a second dialog. The maintainer: "The workflow templates
 * model is a lot easier to understand and use. Please make the dashboard
 * templates model like workflow templates."
 *
 * So it is now the step Create a workflow opens on, the shared template
 * picker (Components/TemplatePicker/TemplatePicker), over the dashboard
 * catalog: Start from scratch first and largest, then a few recommended
 * templates as one-line rows under "Or start from a template", a search box
 * and a category select, and a template's details - the widgets it adds,
 * as Add Widget names them, and the variables it brings - inside its row
 * once it is picked. Use this template is in the dialog's footer, and only
 * there while a template is picked (CreateDashboardModal).
 *
 * Everything it remembers is held by the wizard
 * (DashboardTemplatePickerState), so Back from Name finds it as it was left.
 */

import React, { FunctionComponent, ReactElement, useMemo } from "react";
import useTranslateValue from "Common/UI/Utils/Translation";
import {
  DASHBOARD_TEMPLATE_PICKER_RULES,
  DashboardPickerTemplate,
  DashboardTemplatePickerState,
  DashboardTemplatePreview,
  DashboardTemplatePreviewWidget,
  getDashboardTemplatePreview,
} from "../../Utils/Dashboard/DashboardTemplatePickerUtil";
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
  state: DashboardTemplatePickerState;
  onStateChange: (state: DashboardTemplatePickerState) => void;
  /** Go on to the Name step with this template. */
  onUseTemplate: (template: DashboardPickerTemplate) => void;
  /** Go on to the Name step with an empty dashboard. */
  onStartFromScratch: () => void;
  /** An empty dashboard is the start already chosen, as after Back from Name. */
  isStartFromScratchChosen: boolean;
  /*
   * A template taken while the wizard still waits for the names the
   * project's dashboards have, to fill one in that none has yet.
   */
  busyTemplateId?: string | null | undefined;
}

// What every id and test id of the step starts with.
export const DASHBOARD_PICKER_ID_PREFIX: string = "dashboard";

export const DASHBOARD_START_FROM_SCRATCH_ID: string = getTemplatePickerIds(
  DASHBOARD_PICKER_ID_PREFIX,
).startFromScratch;
export const DASHBOARD_TEMPLATE_SEARCH_INPUT_ID: string = getTemplatePickerIds(
  DASHBOARD_PICKER_ID_PREFIX,
).searchInput;
export const DASHBOARD_TEMPLATE_VIEW_SELECT_ID: string = getTemplatePickerIds(
  DASHBOARD_PICKER_ID_PREFIX,
).viewSelect;
export const DASHBOARD_TEMPLATE_LISTBOX_ID: string = getTemplatePickerIds(
  DASHBOARD_PICKER_ID_PREFIX,
).listbox;

type OptionDomIdFunction = (templateId: string) => string;

export const dashboardTemplateOptionDomId: OptionDomIdFunction = (
  templateId: string,
): string => {
  return templateOptionDomId(DASHBOARD_PICKER_ID_PREFIX, templateId);
};

type TranslateFunction = (value: string) => string;

interface DashboardTemplateDetailsProps {
  template: DashboardPickerTemplate;
  tx: TranslateFunction;
}

/*
 * What a picked template's row opens to show, before anything is created:
 * the kinds of widget it adds, as Add Widget names them, in the order the
 * dashboard shows them - and the variables it brings, the pickers its
 * toolbar narrows it with. A template without variables leaves that row
 * out rather than saying so.
 */
const DashboardTemplateDetails: FunctionComponent<
  DashboardTemplateDetailsProps
> = (props: DashboardTemplateDetailsProps): ReactElement => {
  const preview: DashboardTemplatePreview | null = useMemo(() => {
    return getDashboardTemplatePreview(props.template);
  }, [props.template.type]);
  const tx: TranslateFunction = props.tx;

  if (!preview) {
    return <></>;
  }

  return (
    <TemplateDetails dataTestId="dashboard-template-details">
      <TemplateDetailsRow
        label={tx("Widgets")}
        holds={TemplateDetailsRowHolds.Chips}
      >
        <ul
          className="flex flex-wrap items-center gap-1.5"
          data-testid="dashboard-template-details-widgets"
        >
          {preview.widgets.map(
            (widget: DashboardTemplatePreviewWidget): ReactElement => {
              return (
                <li key={widget.componentType} className="flex max-w-full">
                  <TemplateDetailsChip
                    icon={widget.icon}
                    // Named as Add Widget names it, in the reader's language.
                    label={tx(widget.label)}
                    dataTestId="dashboard-template-details-widget"
                  />
                </li>
              );
            },
          )}
        </ul>
      </TemplateDetailsRow>

      {preview.variables.length > 0 ? (
        <TemplateDetailsRow
          label={tx("Variables")}
          holds={TemplateDetailsRowHolds.Text}
        >
          <ul
            className="flex flex-wrap gap-x-4 gap-y-1"
            data-testid="dashboard-template-details-variables"
          >
            {preview.variables.map((variable: string): ReactElement => {
              return (
                <li
                  key={variable}
                  className="text-sm text-gray-700"
                  data-testid="dashboard-template-details-variable"
                >
                  {/* Template text, shown as it is written, like its name. */}
                  {variable}
                </li>
              );
            })}
          </ul>
        </TemplateDetailsRow>
      ) : (
        <></>
      )}
    </TemplateDetails>
  );
};

const DashboardTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: TranslateFunction = (value: string): string => {
    return translateString(value) || value;
  };

  return (
    <TemplatePicker
      idPrefix={DASHBOARD_PICKER_ID_PREFIX}
      rules={DASHBOARD_TEMPLATE_PICKER_RULES}
      state={props.state}
      onStateChange={props.onStateChange}
      onUseTemplate={props.onUseTemplate}
      onStartFromScratch={props.onStartFromScratch}
      isStartFromScratchChosen={props.isStartFromScratchChosen}
      startFromScratchDescription={tx(
        "Begin with an empty dashboard and add your own widgets.",
      )}
      busyTemplateId={props.busyTemplateId}
      renderDetails={(template: DashboardPickerTemplate): ReactElement => {
        return <DashboardTemplateDetails template={template} tx={tx} />;
      }}
    />
  );
};

export default DashboardTemplatePicker;
