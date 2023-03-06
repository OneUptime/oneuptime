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
import JSONWebToken from 'CommonUI/src/Utils/JsonWebToken';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';

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

        if (sso_token) {
            // set token.

            const decodedtoken: JSONWebTokenData | null = JSONWebToken.decode(sso_token) as JSONWebTokenData;

            if(!decodedtoken){
                alert("Invalid SSO Token. Logging out.")
                return Navigation.navigate(RouteMap[PageMap.LOGOUT] as Route);
            }


            if(decodedtoken.userId.toString() !== User.getUserId().toString()){
                alert("SSO Token does not belong to this user. Logging out.")
                return Navigation.navigate(RouteMap[PageMap.LOGOUT] as Route);
            }

            if(!decodedtoken.projectId){
                alert("Project ID not found in the SSO token. Logging out.")
                return Navigation.navigate(RouteMap[PageMap.LOGOUT] as Route);
            }

            User.setSsoToken(decodedtoken.projectId, sso_token);
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
