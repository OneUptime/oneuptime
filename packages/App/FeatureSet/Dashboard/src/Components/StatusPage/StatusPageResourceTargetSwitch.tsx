import { StatusPageResourceTargetType } from "./StatusPageResourceFormFields";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The picker on screen, which the link swaps for the other one.
  targetType: StatusPageResourceTargetType;
  /*
   * An Edit form's link changes what an existing resource shows, so it
   * says Show rather than Add.
   */
  isEditForm: boolean;
  /*
   * Add Multiple Monitors (and Monitor Groups): the link swaps a picker of
   * several, so it names several.
   */
  isBulkAdd?: boolean | undefined;
  onSwitch: () => void;
}

/*
 * The link under the resource form's picker, on projects with monitor
 * groups: it swaps the monitor picker for the monitor group one, and back -
 * and under the bulk add's, its monitors for monitor groups (issue #6544).
 * The Add form's choice belongs to the page (Status Page > Resources), so
 * the next Add opens on it. An Edit form's belongs to that form alone and
 * starts on what the resource shows (getStatusPageResourceTargetType):
 * saving it with the other picker points the resource at what that picker
 * holds instead, and the server clears what it showed before.
 */
const StatusPageResourceTargetSwitch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const isMonitorGroupPicker: boolean =
    props.targetType === StatusPageResourceTargetType.MonitorGroup;

  let text: string | undefined;

  if (props.isEditForm) {
    text = isMonitorGroupPicker
      ? translator.translateText("Show a Monitor instead.")
      : translator.translateText("Show a Monitor Group instead.");
  } else if (props.isBulkAdd) {
    text = isMonitorGroupPicker
      ? translator.translateText("Add Monitors instead.")
      : translator.translateText("Add Monitor Groups instead.");
  } else {
    text = isMonitorGroupPicker
      ? translator.translateText("Add a Monitor instead.")
      : translator.translateText("Add a Monitor Group instead.");
  }

  return (
    <Link
      onClick={() => {
        props.onSwitch();
      }}
      className="mt-1 text-sm text-gray-500 underline"
    >
      <div>
        <p data-testid="status-page-resource-target-switch">{text}</p>
      </div>
    </Link>
  );
};

export default StatusPageResourceTargetSwitch;
