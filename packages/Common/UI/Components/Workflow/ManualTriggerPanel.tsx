import ComponentSettingsSection from "./ComponentSettingsSection";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Manual trigger has no settings, so its dialog used to open on a card
 * saying exactly that. What someone opening it wants to know is how it is
 * started. The two names below are the builder toolbar's button and the
 * component's title; ManualTriggerPanel.test.tsx fails if either is renamed
 * without this.
 */
export const RUN_WORKFLOW_BUTTON_TITLE: string = "Run Workflow";
export const EXECUTE_WORKFLOW_COMPONENT_TITLE: string = "Execute Workflow";

const ManualTriggerPanel: FunctionComponent = (): ReactElement => {
  return (
    <ComponentSettingsSection
      id="how-to-run"
      icon={IconProp.Play}
      title="How to run it"
      tone="primary"
    >
      <ul
        className="list-disc space-y-1 pl-5 text-sm text-gray-700"
        data-testid="manual-trigger-how-to-run"
      >
        <li>
          Click <strong>{RUN_WORKFLOW_BUTTON_TITLE}</strong> in the
          builder&apos;s toolbar and enter the JSON this run starts with.
        </li>
        <li>
          Or start it from another workflow with an{" "}
          <strong>{EXECUTE_WORKFLOW_COMPONENT_TITLE}</strong> step, which passes
          the JSON for you.
        </li>
      </ul>
    </ComponentSettingsSection>
  );
};

export default ManualTriggerPanel;
