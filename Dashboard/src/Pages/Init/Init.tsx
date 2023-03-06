import Route from 'Common/Types/API/Route';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Page from 'CommonUI/src/Components/Page/Page';
import Navigation from 'CommonUI/src/Utils/Navigation';
import User from 'CommonUI/src/Utils/User';
import Project from 'Model/Models/Project';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';

export interface ComponentProps extends PageComponentProps {
    isLoadingProjects: boolean;
    projects: Array<Project>;
}

const Init: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    useEffect(() => {
        // if there is an SSO token. We need to save that to localstorage.

        const sso_token: string | null =
            Navigation.getQueryStringByName('sso_token');

        if (sso_token && props.currentProject && props.currentProject.id) {
            // set token.
            User.setSsoToken(props.currentProject.id, sso_token);
        }
    }, []);

    useEffect(() => {
        // set slug to latest project and redirect to home.

        if (props.currentProject && props.currentProject._id) {
            Navigation.navigate(
                new Route('/dashboard/' + props.currentProject._id + '/home/')
            );
        }
    }, [props.currentProject]);

    useEffect(() => {
        // set slug to latest project and redirect to home.

        if (!props.isLoadingProjects && props.projects.length === 0) {
            Navigation.navigate(RouteMap[PageMap.WELCOME] as Route);
        }
    }, [props.projects]);

    return (
        <Page title={''} breadcrumbLinks={[]}>
            <PageLoader isVisible={true} />
        </Page>
    );
};

export default Init;
