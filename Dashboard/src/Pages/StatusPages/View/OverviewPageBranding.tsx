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

            <CardModelDetail<StatusPage>
                name="Status Page > Branding > Default Bar Color"
                cardProps={{
                    title: 'Default History Chart Bar Color',
                    description:
                        'Bar color will be used for history chart when no data is set.',
                }}
                isEditable={true}
                editButtonText={'Edit Default Bar Color'}
                formFields={[
                    {
                        field: {
                            defaultBarColor: true,
                        },
                        title: 'Default Bar Color',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 1,
                    modelType: StatusPage,
                    id: 'default-bar-color',
                    fields: [
                        {
                            field: {
                                defaultBarColor: true,
                            },
                            fieldType: FieldType.Color,
                            title: 'Default Bar Color',
                            placeholder: 'No color set.',
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Fragment>
    );
};

export default StatusPageDelete;
