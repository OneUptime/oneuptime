import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Page from "Common/UI/Components/Page/Page";
import { BILLING_ENABLED } from "Common/UI/Config";
import GlobalConfigUtil from "Common/UI/Utils/GlobalConfig";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps extends PageComponentProps {
  onClickShowProjectModal: () => void;
}

const Welcome: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [canCreateProject, setCanCreateProject] = useState<boolean>(true);

  useEffect(() => {
    if (User.isMasterAdmin()) {
      setCanCreateProject(true);
      return;
    }

    GlobalConfigUtil.fetchVars()
      .then((vars: { disableUserProjectCreation: boolean }) => {
        setCanCreateProject(!vars.disableUserProjectCreation);
      })
      .catch(() => {
        setCanCreateProject(true);
      });
  }, []);

  if (!canCreateProject) {
    return (
      <Page title={""} breadcrumbLinks={[]}>
        <EmptyState
          id="empty-state-project-creation-restricted"
          icon={IconProp.Lock}
          title={"Project creation restricted"}
          description={
            <>
              Creating new projects is restricted to admin users on this
              OneUptime Server. Please contact your server admin to be added to
              an existing project.
            </>
          }
        />
      </Page>
    );
  }

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
