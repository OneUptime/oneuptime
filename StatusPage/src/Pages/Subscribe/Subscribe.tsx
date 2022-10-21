import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import Tabs from 'CommonUI/src/Components/Tabs/Tabs';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { JSONObject } from 'Common/Types/JSON';


const PageNotFound: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {

    const [currentTab, setCurrentTab] = useState<string>('Email');


    return (
        <Page>
            <p>Subscribe.</p>
            
            <Tabs tabs={[
                "Email",
                "SMS",
                "Webhook"
            ]} onTabChange={(tab: string) => {
                setCurrentTab(tab);
            }} />


            {currentTab === 'Email' ? <ModelForm<StatusPageSubscriber>
                modelType={StatusPageSubscriber}
                id="email-form"
                fields={[
                    {
                        field: {
                            subscriberEmail: true,
                        },
                        title: 'Email',
                        description:
                            'An email will be sent to this email for status page updates.',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'subscriber@company.com',
                    },
                ]}
                formType={FormType.Create}
                submitButtonText={'Subscribe'}
                onSuccess={(_value: JSONObject) => {
                    //LoginUtil.login(value);
                }}
                maxPrimaryButtonWidth={true}
            /> : <></>}

            {currentTab === 'SMS' ? <ModelForm<StatusPageSubscriber>
                modelType={StatusPageSubscriber}
                id="sms-form"
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
            /> : <></>}


            {currentTab === 'Webhook' ? <ModelForm<StatusPageSubscriber>
                modelType={StatusPageSubscriber}
                id="webhook-form"
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
            /> : <></>}
        </Page>
    );
};

export default PageNotFound;
