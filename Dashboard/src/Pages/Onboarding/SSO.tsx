import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Card from 'CommonUI/src/Components/Card/Card';
import ModelList from 'CommonUI/src/Components/ModelList/ModelList';
import ProjectSSO from 'Model/Models/ProjectSso';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';
import URL from 'Common/Types/API/URL';
import { IDENTITY_URL } from 'CommonUI/src/Config';
import Route from 'Common/Types/API/Route';

const SSO: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page title={''} breadcrumbLinks={[]}>
            <div className="flex justify-center w-full mt-20">
                <div className="w-1/3 min-w-lg">
                    <Card
                        title={'Single Sign On (SSO)'}
                        description="Please select an SSO provider to log in to this project."
                    >
                        <div className="mt-6 -ml-6 -mr-6 border-t border-gray-200">
                            <div className="ml-6 mr-6  pt-6">
                                <ModelList<ProjectSSO>
                                    query={{
                                        projectId:
                                            DashboardNavigation.getProjectId()?.toString(),
                                        isEnabled: true,
                                    }}
                                    modelType={ProjectSSO}
                                    titleField="name"
                                    descriptionField="description"
                                    select={{
                                        name: true,
                                        description: true,
                                        _id: true,
                                    }}
                                    noItemsMessage="No SSO Providers Configured or Enabled"
                                    onSelectChange={(
                                        list: Array<ProjectSSO>
                                    ) => {
                                        if (list && list.length > 0) {
                                            Navigation.navigate(
                                                URL.fromURL(
                                                    IDENTITY_URL
                                                ).addRoute(
                                                    new Route(
                                                        `/sso/${DashboardNavigation.getProjectId()}/${
                                                            list[0]?._id
                                                        }`
                                                    )
                                                )
                                            );
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </Page>
    );
};

export default SSO;
