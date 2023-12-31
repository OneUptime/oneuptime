import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Title and Description"
                cardProps={{
                    title: 'Title and Description',
                    description: 'This will also be used for SEO.',
                }}
                editButtonText={'Edit'}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            pageTitle: true,
                        },
                        title: 'Page Title',
                        fieldType: FormFieldSchemaType.Text,
                        required: false,
                        placeholder: 'Please enter page title here.',
                    },
                    {
                        field: {
                            pageDescription: true,
                        },
                        title: 'Page Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: false,
                        placeholder: 'Please enter page description here.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                pageTitle: true,
                            },
                            fieldType: FieldType.Text,
                            title: 'Page Title',
                            placeholder: 'No page title entered so far.',
                        },
                        {
                            field: {
                                pageDescription: true,
                            },
                            fieldType: FieldType.Text,
                            title: 'Page Description',
                            placeholder: 'No page description entered so far.',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Favicon"
                cardProps={{
                    title: 'Favicon',
                    description: 'Favicon will be used for SEO.',
                }}
                isEditable={true}
                editButtonText={'Edit Favicon'}
                formFields={[
                    {
                        field: {
                            faviconFile: true,
                        },
                        title: 'Favicon',
                        fieldType: FormFieldSchemaType.ImageFile,
                        required: false,
                        placeholder: 'Upload Favicon.',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'model-detail-status-page',
                    fields: [
                        {
                            field: {
                                faviconFile: {
                                    file: true,
                                    type: true,
                                },
                            },
                            fieldType: FieldType.ImageFile,
                            title: 'Favicon',
                            placeholder: 'No favicon uploaded.',
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Overview Page"
                cardProps={{
                    title: 'Overview Page',
                    description:
                        'Essential branding elements for overview page.',
                }}
                isEditable={true}
                editButtonText={'Edit Branding'}
                formFields={[
                    {
                        field: {
                            overviewPageDescription: true,
                        },
                        title: 'Overview Page Description.',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: false,
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'overview-page-description',
                    fields: [
                        {
                            field: {
                                overviewPageDescription: true,
                            },
                            fieldType: FieldType.Markdown,
                            title: 'Overview Page Description',
                            placeholder: 'No description set.',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Fragment>
    );
};

export default StatusPageDelete;
