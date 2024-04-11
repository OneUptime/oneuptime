import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageComponentProps from '../../PageComponentProps';
import BaseModel from 'Common/Models/BaseModel';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import { ShowAs } from 'CommonUI/src/Components/ModelTable/BaseModelTable';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import AlignItem from 'CommonUI/src/Types/AlignItem';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import IncidentNoteTemplate from 'Model/Models/IncidentNoteTemplate';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import IconProp from 'Common/Types/Icon/IconProp';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import OneUptimeDate from 'Common/Types/Date';
import CheckboxViewer from 'CommonUI/src/Components/Checkbox/CheckboxViewer';
import ProjectUser from '../../../Utils/ProjectUser';

const PublicNote: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [incidentNoteTemplates, setIncidentNoteTemplates] = useState<
        Array<IncidentNoteTemplate>
    >([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [showIncidentNoteTemplateModal, setShowIncidentNoteTemplateModal] =
        useState<boolean>(false);
    const [initialValuesForIncident, setInitialValuesForIncident] =
        useState<JSONObject>({});

    const fetchIncidentNoteTemplate: (id: ObjectID) => Promise<void> = async (
        id: ObjectID
    ): Promise<void> => {
        setError('');
        setIsLoading(true);

        try {
            //fetch incident template

            const incidentNoteTemplate: IncidentNoteTemplate | null =
                await ModelAPI.getItem<IncidentNoteTemplate>({
                    modelType: IncidentNoteTemplate,
                    id,
                    select: {
                        note: true,
                    },
                });

            if (incidentNoteTemplate) {
                const initialValue: JSONObject = {
                    ...BaseModel.toJSONObject(
                        incidentNoteTemplate,
                        IncidentNoteTemplate
                    ),
                };

                setInitialValuesForIncident(initialValue);
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
        setShowIncidentNoteTemplateModal(false);
    };

    const fetchIncidentNoteTemplates: () => Promise<void> =
        async (): Promise<void> => {
            setError('');
            setIsLoading(true);
            setInitialValuesForIncident({});

            try {
                const listResult: ListResult<IncidentNoteTemplate> =
                    await ModelAPI.getList<IncidentNoteTemplate>({
                        modelType: IncidentNoteTemplate,
                        query: {},
                        limit: LIMIT_PER_PROJECT,
                        skip: 0,
                        select: {
                            templateName: true,
                            _id: true,
                        },
                        sort: {},
                    });

                setIncidentNoteTemplates(listResult.data);
            } catch (err) {
                setError(API.getFriendlyMessage(err));
            }

            setIsLoading(false);
        };

    return (
        <Fragment>
            <ModelTable<IncidentPublicNote>
                modelType={IncidentPublicNote}
                id="table-incident-internal-note"
                name="Monitor > Public Note"
                isDeleteable={true}
                showCreateForm={
                    Object.keys(initialValuesForIncident).length > 0
                }
                createInitialValues={initialValuesForIncident}
                isCreateable={true}
                showViewIdButton={true}
                isEditable={true}
                createEditModalWidth={ModalWidth.Large}
                isViewable={false}
                query={{
                    incidentId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: IncidentPublicNote
                ): Promise<IncidentPublicNote> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.incidentId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'Public Notes',
                    buttons: [
                        {
                            title: 'Create from Template',
                            icon: IconProp.Template,
                            buttonStyle: ButtonStyleType.OUTLINE,
                            onClick: async (): Promise<void> => {
                                setShowIncidentNoteTemplateModal(true);
                                await fetchIncidentNoteTemplates();
                            },
                        },
                    ],
                    description:
                        'Here are public notes for this incident. This will show up on the status page.',
                }}
                noItemsMessage={
                    'No public notes created for this incident so far.'
                }
                formFields={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Public Incident Note',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        description:
                            'This note is visible on your Status Page. This is in Markdown.',
                    },
                    {
                        field: {
                            shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
                                true,
                        },

                        title: 'Notify Status Page Subscribers',
                        stepId: 'more',
                        description:
                            'Should status page subscribers be notified?',
                        fieldType: FormFieldSchemaType.Checkbox,
                        defaultValue: true,
                        required: false,
                    },
                    {
                        field: {
                            postedAt: true,
                        },
                        title: 'Posted At',
                        fieldType: FormFieldSchemaType.DateTime,
                        required: true,
                        description:
                            'This is the date and time this note was posted. This is in ' +
                            OneUptimeDate.getCurrentTimezoneString() +
                            '.',
                        defaultValue: OneUptimeDate.getCurrentDate(),
                    },
                ]}
                showAs={ShowAs.List}
                showRefreshButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            createdByUser: true,
                        },
                        type: FieldType.Entity,
                        title: 'Created By',
                        filterEntityType: User,
                        fetchFilterDropdownOptions: async () => {
                            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                                DashboardNavigation.getProjectId()!
                            );
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                    },
                    {
                        field: {
                            note: true,
                        },
                        type: FieldType.Text,
                        title: 'Note',
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        type: FieldType.Date,
                        title: 'Created At',
                    },
                ]}
                columns={[
                    {
                        field: {
                            createdByUser: {
                                name: true,
                                email: true,
                                profilePictureId: true,
                            },
                        },
                        title: '',

                        type: FieldType.Entity,

                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <UserElement
                                    user={
                                        BaseModel.fromJSON(
                                            item['createdByUser'] as JSONObject,
                                            User
                                        ) as User
                                    }
                                    suffix={'wrote'}
                                    usernameClassName={
                                        'text-base text-gray-900'
                                    }
                                    suffixClassName={
                                        'text-base text-gray-500 mt-1'
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            postedAt: true,
                        },

                        alignItem: AlignItem.Right,
                        title: '',
                        type: FieldType.DateTime,
                        contentClassName:
                            'mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3 text-right',
                    },

                    {
                        field: {
                            note: true,
                        },

                        title: '',
                        type: FieldType.Markdown,
                        contentClassName:
                            '-mt-3 space-y-1 text-sm text-gray-800',
                        colSpan: 2,
                    },
                    {
                        field: {
                            shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
                                true,
                        },
                        title: '',
                        type: FieldType.Boolean,
                        colSpan: 2,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <div className="-mt-5">
                                    <CheckboxViewer
                                        isChecked={
                                            item[
                                                'shouldStatusPageSubscribersBeNotifiedOnNoteCreated'
                                            ] as boolean
                                        }
                                        text={
                                            item[
                                                'shouldStatusPageSubscribersBeNotifiedOnNoteCreated'
                                            ]
                                                ? 'Status Page Subscribers Notified'
                                                : 'Status Page Subscribers Not Notified'
                                        }
                                    />{' '}
                                </div>
                            );
                        },
                    },
                ]}
            />

            {incidentNoteTemplates.length === 0 &&
            showIncidentNoteTemplateModal &&
            !isLoading ? (
                <ConfirmModal
                    title={`No Incident Note Templates`}
                    description={`No incident note templates have been created yet. You can create these in Project Settings > Incident > Note Templates.`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setShowIncidentNoteTemplateModal(false);
                    }}
                />
            ) : (
                <></>
            )}

            {error ? (
                <ConfirmModal
                    title={`Error`}
                    description={`${error}`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setError('');
                    }}
                />
            ) : (
                <></>
            )}

            {showIncidentNoteTemplateModal &&
            incidentNoteTemplates.length > 0 ? (
                <BasicFormModal<JSONObject>
                    title="Create Note from Template"
                    isLoading={isLoading}
                    submitButtonText="Create from Template"
                    onClose={() => {
                        setShowIncidentNoteTemplateModal(false);
                        setIsLoading(false);
                    }}
                    onSubmit={async (data: JSONObject) => {
                        await fetchIncidentNoteTemplate(
                            data['incidentNoteTemplateId'] as ObjectID
                        );
                    }}
                    formProps={{
                        initialValues: {},
                        fields: [
                            {
                                field: {
                                    incidentNoteTemplateId: true,
                                },
                                title: 'Select Note Template',
                                description:
                                    'Select a template to create a note from.',
                                fieldType: FormFieldSchemaType.Dropdown,
                                dropdownOptions:
                                    DropdownUtil.getDropdownOptionsFromEntityArray(
                                        {
                                            array: incidentNoteTemplates,
                                            labelField: 'templateName',
                                            valueField: '_id',
                                        }
                                    ),
                                required: true,
                                placeholder: 'Select Template',
                            },
                        ],
                    }}
                />
            ) : (
                <> </>
            )}
        </Fragment>
    );
};

export default PublicNote;
