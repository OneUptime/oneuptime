import React, { FunctionComponent, ReactElement, useId } from "react";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import {
  EXTERNAL_STATUS_PAGE_MONITOR_MORE_FIELDS,
  getMonitorOptionsMoreFieldsItems,
} from "../MonitorMoreFields";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import { parseMonitorStepRetriesInput } from "Common/Types/Monitor/MonitorStepRetries";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export interface ComponentProps {
  monitorStepExternalStatusPageMonitor: MonitorStepExternalStatusPageMonitor;
  onChange: (value: MonitorStepExternalStatusPageMonitor) => void;
}

/*
 * The Provider dropdown's choices: Auto first - it is what a new monitor
 * starts on and what most people keep - then each format in the enum's
 * order (ExternalStatusPageProviderType).
 */
export const getExternalStatusPageProviderOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    const options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(ExternalStatusPageProviderType);

    return [
      ...options.filter((option: DropdownOption): boolean => {
        return option.value === ExternalStatusPageProviderType.Auto;
      }),
      ...options.filter((option: DropdownOption): boolean => {
        return option.value !== ExternalStatusPageProviderType.Auto;
      }),
    ];
  };

const ExternalStatusPageMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const providerDropdownOptions: Array<DropdownOption> =
    getExternalStatusPageProviderOptions();

  /*
   * Each field's label names its box for a screen reader. A monitor can
   * have several steps on one page, so the ids are the step's own.
   */
  const idPrefix: string = useId();
  const statusPageUrlLabelId: string = `${idPrefix}-status-page-url`;
  const providerLabelId: string = `${idPrefix}-provider`;
  const componentGroupLabelId: string = `${idPrefix}-component-group`;
  const componentNameLabelId: string = `${idPrefix}-component-name`;
  const timeoutLabelId: string = `${idPrefix}-timeout`;
  const retriesLabelId: string = `${idPrefix}-retries`;

  return (
    <div className="space-y-5">
      <div>
        {/*
         * A key of its own: the extractor takes a description with "://"
         * in it for a URL, so this one was never offered for translation.
         */}
        <FieldLabelElement
          id={statusPageUrlLabelId}
          title="Status Page URL"
          description={translationKey(
            "The URL of the external status page to monitor (e.g. https://www.githubstatus.com or https://status.openai.com)",
          )}
          required={true}
        />
        <Input
          initialValue={
            props.monitorStepExternalStatusPageMonitor.statusPageUrl
          }
          placeholder="https://status.example.com"
          ariaLabelledby={statusPageUrlLabelId}
          onChange={(value: string) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              statusPageUrl: value,
            });
          }}
        />
      </div>

      <div>
        {/*
         * Always set - Auto until a person picks a format - so it is
         * neither marked optional nor clearable.
         */}
        <FieldLabelElement
          id={providerLabelId}
          title="Provider"
          description="How OneUptime reads this status page. 'Auto' detects the format for you."
          required={false}
          hideOptionalLabel={true}
        />
        <Dropdown
          initialValue={providerDropdownOptions.find((i: DropdownOption) => {
            return (
              i.value ===
              (props.monitorStepExternalStatusPageMonitor.provider ||
                ExternalStatusPageProviderType.Auto)
            );
          })}
          options={providerDropdownOptions}
          ariaLabelledby={providerLabelId}
          isClearable={false}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...props.monitorStepExternalStatusPageMonitor,
              provider:
                (value?.toString() as ExternalStatusPageProviderType) ||
                ExternalStatusPageProviderType.Auto,
            });
          }}
        />
      </div>

      {/*
       * More fields, folded like every form's: options most monitors
       * leave at their defaults. Its header names them and shows the
       * ones changed.
       */}
      <FoldedSection
        title={MORE_FIELDS_SECTION_TITLE}
        items={getMonitorOptionsMoreFieldsItems(
          props.monitorStepExternalStatusPageMonitor,
          EXTERNAL_STATUS_PAGE_MONITOR_MORE_FIELDS,
        )}
        dataTestId="external-status-page-monitor-more-fields"
      >
        <div className="space-y-4">
          <div>
            <FieldLabelElement
              id={componentGroupLabelId}
              title="Component Group Filter"
              description="Only watch one component group, e.g. 'APIs'. RSS and Atom feeds have no groups."
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.componentGroupName ||
                ""
              }
              placeholder="e.g. APIs"
              ariaLabelledby={componentGroupLabelId}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  componentGroupName: value || undefined,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              id={componentNameLabelId}
              title="Component Name Filter"
              description="Only watch components whose names contain this, e.g. 'API'. With a group set, only inside that group."
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.componentName || ""
              }
              placeholder="e.g. API, Compute Engine, us-east-1"
              ariaLabelledby={componentNameLabelId}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  componentName: value || undefined,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              id={timeoutLabelId}
              title="Timeout (ms)"
              description="How long to wait for a response before timing out"
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.timeout?.toString() ||
                "10000"
              }
              placeholder="10000"
              type={InputType.NUMBER}
              ariaLabelledby={timeoutLabelId}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  timeout: parseInt(value) || 10000,
                });
              }}
            />
          </div>

          <div>
            <FieldLabelElement
              id={retriesLabelId}
              title="Retries"
              description="Number of times to retry after the first attempt fails. For example, 2 means up to 3 attempts in total. Set to 0 for no retries. Defaults to 3."
              required={false}
            />
            <Input
              initialValue={
                props.monitorStepExternalStatusPageMonitor.retries?.toString() ||
                "3"
              }
              placeholder="3"
              type={InputType.NUMBER}
              ariaLabelledby={retriesLabelId}
              onChange={(value: string) => {
                props.onChange({
                  ...props.monitorStepExternalStatusPageMonitor,
                  // A typed 0 means no retries, so it must not read as "unset".
                  retries: parseMonitorStepRetriesInput(value, 3),
                });
              }}
            />
          </div>
        </div>
      </FoldedSection>
    </div>
  );
};

export default ExternalStatusPageMonitorStepForm;
