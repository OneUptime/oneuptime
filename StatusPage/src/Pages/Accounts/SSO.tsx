import React, { FunctionComponent, useState } from 'react';
import Route from 'Common/Types/API/Route';
import ModelList from 'CommonUI/src/Components/ModelList/ModelList';
import URL from 'Common/Types/API/URL';
import UserUtil from '../../Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { DASHBOARD_API_URL, FILE_URL, IDENTITY_URL } from 'CommonUI/src/Config';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageSSO from 'Model/Models/StatusPageSso';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import StatusPageUtil from '../../Utils/StatusPage';

export interface ComponentProps {
    statusPageName: string;
    logoFileId: ObjectID;
}

const LoginPage: FunctionComponent<ComponentProps> = (
    props: ComponentProps
) => {
    const [isLoading, setIsLoading] = useState<boolean>(false);

    if (!StatusPageUtil.getStatusPageId()) {
        return <></>;
    }

    if (!StatusPageUtil.isPrivateStatusPage()) {
        Navigation.navigate(
            new Route(
                StatusPageUtil.isPreviewPage()
                    ? `/status-page/${StatusPageUtil.getStatusPageId()}`
                    : '/'
            )
        );
    }

    if (
        StatusPageUtil.getStatusPageId() &&
        UserUtil.isLoggedIn(StatusPageUtil.getStatusPageId()!)
    ) {
        if (Navigation.getQueryStringByName('redirectUrl')) {
            Navigation.navigate(
                new Route(Navigation.getQueryStringByName('redirectUrl')!)
            );
        } else {
            Navigation.navigate(
                new Route(
                    StatusPageUtil.isPreviewPage()
                        ? `/status-page/${StatusPageUtil.getStatusPageId()}`
                        : '/'
                )
            );
        }
    }

    if (Navigation.getQueryStringByName('redirectUrl')) {
        // save this to local storage, so in the overview page. We can redirect to this page.
        LocalStorage.setItem(
            'redirectUrl',
            Navigation.getQueryStringByName('redirectUrl')
        );
    }

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    return (
        <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
                {props.logoFileId && props.logoFileId.toString() ? (
                    <img
                        style={{ height: '70px', margin: 'auto' }}
                        src={`${URL.fromString(FILE_URL.toString()).addRoute(
                            '/image/' + props.logoFileId.toString()
                        )}`}
                    />
                ) : (
                    <></>
                )}
                <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
                    Log in with SSO
                </h2>
                <p className="mt-2 text-center text-sm text-gray-600">
                    Please login to view {props.statusPageName || 'Status Page'}
                </p>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
                    <ModelList<StatusPageSSO>
                        overrideFetchApiUrl={URL.fromString(
                            DASHBOARD_API_URL.toString()
                        ).addRoute(
                            '/status-page/sso/' +
                                StatusPageUtil.getStatusPageId().toString()
                        )}
                        modelType={StatusPageSSO}
                        titleField="name"
                        descriptionField="description"
                        select={{
                            name: true,
                            description: true,
                            _id: true,
                        }}
                        noItemsMessage="No SSO Providers Configured or Enabled"
                        onSelectChange={(list: Array<StatusPageSSO>) => {
                            if (list && list.length > 0) {
                                setIsLoading(true);
                                Navigation.navigate(
                                    URL.fromURL(IDENTITY_URL).addRoute(
                                        new Route(
                                            `/status-page-sso/${StatusPageUtil.getStatusPageId()}/${
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
        </div>
    );
};

export default LoginPage;
