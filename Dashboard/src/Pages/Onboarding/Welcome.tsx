import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from 'CommonUI/src/Components/Button/Button';

export interface ComponentProps extends PageComponentProps {
    onClickShowProjectModal: () => void;
}

const Welcome: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Page title={'Welcome to OneUptime.'} breadcrumbLinks={[]}>
            <p>
                Welcome to OneUptime. Thank you for signing up! To get started
                please create a new project.
            </p>
            <Button
                onClick={() => {
                    props.onClickShowProjectModal();
                }}
                title="Create New Project"
                buttonSize={ButtonSize.Normal}
                buttonStyle={ButtonStyleType.PRIMARY}
            />
        </Page>
    );
};

export default Welcome;
