import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { BILLING_ENABLED } from 'CommonUI/src/Config';
import IconProp from 'Common/Types/Icon/IconProp';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';

export interface ComponentProps extends PageComponentProps {
    onClickShowProjectModal: () => void;
}

const Welcome: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Page title={''} breadcrumbLinks={[]}>
            <EmptyState
                icon={IconProp.AddFolder}
                title={'No projects'}
                description={
                    <>
                        Get started by creating a new project.{' '}
                        {BILLING_ENABLED && (
                            <span> No credit card required.</span>
                        )}
                    </>
                }
                footer={
                    <Button
                        icon={IconProp.Add}
                        title={'Create New Project'}
                        buttonStyle={ButtonStyleType.PRIMARY}
                        onClick={() => {
                            props.onClickShowProjectModal();
                        }}
                    />
                }
            />
        </Page>
    );
};

export default Welcome;
