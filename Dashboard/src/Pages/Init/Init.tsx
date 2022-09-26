import Route from 'Common/Types/API/Route';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Page from 'CommonUI/src/Components/Page/Page';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageComponentProps from '../PageComponentProps';

const Init: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    useEffect(() => {
        // set slug to latest project and redirect to home.

        if (props.currentProject && props.currentProject._id) {
            Navigation.navigate(new Route('/dashboard/' + props.currentProject._id + '/home'));
        }

    }, [props.currentProject]);


    return (
        <Page title={''} breadcrumbLinks={[]}>
            <PageLoader isVisible={true} />
        </Page>
    );
};

export default Init;
