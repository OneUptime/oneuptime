import Route from 'Common/Types/API/Route';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Page from 'CommonUI/src/Components/Page/Page';
import Navigation from 'CommonUI/src/Utils/Navigation';
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
        // set slug to latest project and redirect to home.

        if (props.currentProject && props.currentProject._id) {
            Navigation.navigate(
                new Route('/dashboard/' + props.currentProject._id + '/home')
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
