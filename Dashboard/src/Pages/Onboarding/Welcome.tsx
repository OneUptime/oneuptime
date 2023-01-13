import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from 'CommonUI/src/Components/Button/Button';
import { BILLING_ENABLED } from 'CommonUI/src/Config';
import Icon, { IconProp } from 'CommonUI/src/Components/Icon/Icon';

export interface ComponentProps extends PageComponentProps {
    onClickShowProjectModal: () => void;
}

const Welcome: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Page title={''} breadcrumbLinks={[]}>
            <div className='flex mt-52 mb-52'>
            <div className="m-auto text-center">
                <Icon icon={IconProp.AddFolder} className="mx-auto h-12 w-12 text-gray-400" />

                <h3 className="mt-2 text-sm font-medium text-gray-900">No projects</h3>
                <p className="mt-1 text-sm text-gray-500">Get started by creating a new project. {BILLING_ENABLED && <span> No credit card required.</span>}</p>
                <div className="mt-6">
                    <Button icon={IconProp.Add} title={'Create New Project'} buttonStyle={ButtonStyleType.PRIMARY} onClick={() => {
                    props.onClickShowProjectModal();
                }} />

                </div>
                </div>
                </div>
        </Page>
    );
};

export default Welcome;
