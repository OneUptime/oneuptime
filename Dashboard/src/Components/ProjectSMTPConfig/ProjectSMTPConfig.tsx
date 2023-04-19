import React, { FunctionComponent, ReactElement } from 'react';
import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';

export interface ComponentProps {
    smtpConfig: ProjectSmtpConfig;
}

const ProjectSMTPConfig: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <span>{props.smtpConfig.name}</span>;
};

export default ProjectSMTPConfig;
