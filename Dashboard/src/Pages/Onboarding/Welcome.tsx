import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/src/Components/Button/Button";
import EmptyState from "Common/UI/src/Components/EmptyState/EmptyState";
import Page from "Common/UI/src/Components/Page/Page";
import { BILLING_ENABLED } from "Common/UI/src/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps extends PageComponentProps {
  onClickShowProjectModal: () => void;
}

const Welcome: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Page title={""} breadcrumbLinks={[]}>
      <EmptyState
        id="empty-state-no-projects"
        icon={IconProp.AddFolder}
        title={"No projects"}
        description={
          <>
            Get started by creating a new project.{" "}
            {BILLING_ENABLED && <span> No credit card required.</span>}
          </>
        }
        footer={
          <Button
            icon={IconProp.Add}
            title={"Create New Project"}
            buttonStyle={ButtonStyleType.PRIMARY}
            onClick={() => {
              props.onClickShowProjectModal();
            }}
            dataTestId="create-new-project-button"
          />
        }
      />
    </Page>
  );
};

export default Welcome;
