import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  smtpConfig: ProjectSmtpConfig;
}

const ProjectSMTPConfig: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return <span>{props.smtpConfig.name}</span>;
};

export default ProjectSMTPConfig;
