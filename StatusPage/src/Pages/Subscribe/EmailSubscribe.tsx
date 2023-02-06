import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import User from '../../Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Route from 'Common/Types/API/Route';
import SubscribeSideMenu from './SideMenu';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Card from 'CommonUI/src/Components/Card/Card';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';
import URL from 'Common/Types/API/URL';

const SubscribePage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [isSuccess, setIsSuccess] = useState<boolean>(false);

    const id: ObjectID = LocalStorage.getItem('statusPageId') as ObjectID;
    if (!id) {
        throw new BadDataException('Status Page ID is required');
    }

    if (
        props.statusPageId &&
        props.isPrivatePage &&
        !User.isLoggedIn(props.statusPageId)
    ) {
        Navigation.navigate(
            new Route(
                props.isPreviewPage
                    ? `/status-page/${props.statusPageId}/login`
                    : '/login'
            )
        );
    }

    return (
        <Page
            title={'Subscribe'}
            breadcrumbLinks={[
                {
                    title: 'Overview',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewPage
                            ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                            : (RouteMap[PageMap.OVERVIEW] as Route)
                    ),
                },
                {
                    title: 'Subscribe',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewPage
                            ? (RouteMap[
                                  PageMap.PREVIEW_SUBSCRIBE_EMAIL
                              ] as Route)
                            : (RouteMap[PageMap.SUBSCRIBE_EMAIL] as Route)
                    ),
                },
            ]}
            sideMenu={
                <SubscribeSideMenu
                    isPreviewStatusPage={Boolean(props.isPreviewPage)}
                />
            }
        >
            <div className="justify-center">
                <div>
                    {isSuccess && (
                        <p className="text-center text-gray-400 mb-20 mt-20">
                            {' '}
                            You have been subscribed successfully.
                        </p>
                    )}

                    {!isSuccess ? (
                        <div className="-mr-4">
                            <Card
                                title="Subscribe by Email"
                                description={
                                    'All of our updates will be sent to this email address.'
                                }
                            >
                                <ModelForm<StatusPageSubscriber>
                                    modelType={StatusPageSubscriber}
                                    id="email-form"
                                    name="Status Page > Email Subscribe"
                                    fields={[
                                        {
                                            field: {
                                                subscriberEmail: true,
                                            },
                                            title: 'Your Email',
                                            fieldType:
                                                FormFieldSchemaType.Email,
                                            required: true,
                                            placeholder:
                                                'subscriber@company.com',
                                        },
                                    ]}
                                    apiUrl={URL.fromString(
                                        DASHBOARD_API_URL.toString()
                                    ).addRoute(
                                        `/status-page/subscribe/${id.toString()}`
                                    )}
                                    formType={FormType.Create}
                                    submitButtonText={'Subscribe'}
                                    onBeforeCreate={async (
                                        item: StatusPageSubscriber
                                    ) => {
                                        const id: ObjectID =
                                            LocalStorage.getItem(
                                                'statusPageId'
                                            ) as ObjectID;
                                        if (!id) {
                                            throw new BadDataException(
                                                'Status Page ID is required'
                                            );
                                        }

                                        item.statusPageId = id;
                                        return item;
                                    }}
                                    onSuccess={(_value: JSONObject) => {
                                        setIsSuccess(true);
                                    }}
                                    maxPrimaryButtonWidth={true}
                                />
                            </Card>
                        </div>
                    ) : (
                        <></>
                    )}
                </div>
            </div>
        </Page>
    );
};

export default SubscribePage;
