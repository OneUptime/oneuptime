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

const PageNotFound: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [currentTab, _setCurrentTab] = useState<string>('Email');
    const [isSuccess, setIsSuccess] = useState<boolean>(false);

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
        <Page>
            <div className="justify-center">
                <div>
                    {!isSuccess && <h5>Subscribe to this page.</h5>}
                    {isSuccess && (
                        <p
                            className="text-center color-light-grey"
                            style={{
                                marginTop: '50px',
                                marginBottom: '50px',
                            }}
                        >
                            {' '}
                            You have been subscribed successfully.
                        </p>
                    )}

                    {/* <Tabs
                tabs={['Email', 'SMS', 'Webhook']}
                onTabChange={(tab: string) => {
                    setCurrentTab(tab);
                }}
            /> */}

                    {currentTab === 'Email' && !isSuccess ? (
                        <ModelForm<StatusPageSubscriber>
                            modelType={StatusPageSubscriber}
                            id="email-form"
                            fields={[
                                {
                                    field: {
                                        subscriberEmail: true,
                                    },
                                    title: 'Please enter your Email',
                                    description:
                                        'Status page updates will be sent to this email.',
                                    fieldType: FormFieldSchemaType.Email,
                                    required: true,
                                    placeholder: 'subscriber@company.com',
                                },
                            ]}
                            formType={FormType.Create}
                            submitButtonText={'Subscribe'}
                            onBeforeCreate={async (
                                item: StatusPageSubscriber
                            ) => {
                                const id: ObjectID = LocalStorage.getItem(
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
                    ) : (
                        <></>
                    )}

                    {/* {currentTab === 'SMS' ? (
                <ModelForm<StatusPageSubscriber>
                    modelType={StatusPageSubscriber}
                    id="sms-form"
                    onBeforeCreate={async (item: StatusPageSubscriber) => {
                        const id: ObjectID = LocalStorage.getItem(
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
                    fields={[
                        {
                            field: {
                                subscriberSMS: true,
                            },
                            title: 'SMS',
                            description:
                                'An SMS will be sent to this number for status page updates.',
                            fieldType: FormFieldSchemaType.Phone,
                            required: true,
                            placeholder: '+1234567890',
                        },
                    ]}
                    formType={FormType.Create}
                    submitButtonText={'Subscribe'}
                    onSuccess={(_value: JSONObject) => {
                        //LoginUtil.login(value);
                    }}
                    maxPrimaryButtonWidth={true}
                />
            ) : (
                <></>
            )}

            {currentTab === 'Webhook' ? (
                <ModelForm<StatusPageSubscriber>
                    modelType={StatusPageSubscriber}
                    id="webhook-form"
                    onBeforeCreate={async (item: StatusPageSubscriber) => {
                        const id: ObjectID = LocalStorage.getItem(
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
                    fields={[
                        {
                            field: {
                                subscriberEmail: true,
                            },
                            title: 'Webhook URL',
                            description:
                                'A POST request will be sent to this webhook for status page updates.',
                            fieldType: FormFieldSchemaType.URL,
                            required: true,
                            placeholder: 'https://google.com',
                        },
                    ]}
                    formType={FormType.Create}
                    submitButtonText={'Subscribe'}
                    onSuccess={(_value: JSONObject) => {
                        //LoginUtil.login(value);
                    }}
                    maxPrimaryButtonWidth={true}
                />
            ) : (
                <></>
            )} */}
                </div>
            </div>
        </Page>
    );
};

export default PageNotFound;
