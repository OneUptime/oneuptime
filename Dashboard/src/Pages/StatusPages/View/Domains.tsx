import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import PageComponentProps from '../../PageComponentProps';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import Domain from 'Model/Models/Domain';
import IconProp from 'Common/Types/Icon/IconProp';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { StatusPageCNameRecord } from 'CommonUI/src/Config';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import { ErrorFunction, VoidFunction } from 'Common/Types/FunctionTypes';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

    const [showCnameModal, setShowCnameModal] = useState<boolean>(false);

    const [selectedStatusPageDomain, setSelectedStatusPageDomain] =
        useState<StatusPageDomain | null>(null);

    const [showSslProvisioningModal, setShowSslProvisioningModal] =
        useState<boolean>(false);

    const [verifyCnameLoading, setVerifyCnameLoading] =
        useState<boolean>(false);
    const [error, setError] = useState<string>('');

    return (
        <Fragment>
            <>
                <ModelTable<StatusPageDomain>
                    modelType={StatusPageDomain}
                    query={{
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                        statusPageId: modelId,
                    }}
                    name="Status Page > Domains"
                    id="domains-table"
                    isDeleteable={true}
                    isCreateable={true}
                    cardProps={{
                        title: 'Custom Domains',
                        description: `Important: Please add ${StatusPageCNameRecord} as your CNAME for these domains for this to work.`,
                    }}
                    refreshToggle={refreshToggle}
                    onBeforeCreate={(
                        item: StatusPageDomain
                    ): Promise<StatusPageDomain> => {
                        if (
                            !props.currentProject ||
                            !props.currentProject._id
                        ) {
                            throw new BadDataException(
                                'Project ID cannot be null'
                            );
                        }
                        item.statusPageId = modelId;
                        item.projectId = new ObjectID(props.currentProject._id);
                        return Promise.resolve(item);
                    }}
                    actionButtons={[
                        {
                            title: 'Add CNAME',
                            buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
                            icon: IconProp.Check,
                            isVisible: (item: StatusPageDomain): boolean => {
                                if (item['isCnameVerified']) {
                                    return false;
                                }

                                return true;
                            },
                            onClick: async (
                                item: StatusPageDomain,
                                onCompleteAction: VoidFunction,
                                onError: ErrorFunction
                            ) => {
                                try {
                                    setShowCnameModal(true);
                                    setSelectedStatusPageDomain(item);
                                    onCompleteAction();
                                } catch (err) {
                                    onCompleteAction();
                                    onError(err as Error);
                                }
                            },
                        },
                        {
                            title: 'Provision SSL',
                            buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
                            icon: IconProp.Check,
                            isVisible: (item: StatusPageDomain): boolean => {
                                if (
                                    item['isCnameVerified'] &&
                                    !item['isSslProvisioned']
                                ) {
                                    return true;
                                }

                                return false;
                            },
                            onClick: async (
                                _item: StatusPageDomain,
                                onCompleteAction: VoidFunction,
                                onError: ErrorFunction
                            ) => {
                                try {
                                    setShowSslProvisioningModal(true);

                                    onCompleteAction();
                                } catch (err) {
                                    onCompleteAction();
                                    onError(err as Error);
                                }
                            },
                        },
                    ]}
                    noItemsMessage={'No custom domains found.'}
                    viewPageRoute={Navigation.getCurrentRoute()}
                    formFields={[
                        {
                            field: {
                                subdomain: true,
                            },
                            title: 'Subdomain',
                            fieldType: FormFieldSchemaType.Text,
                            required: true,
                            placeholder: 'status',
                            validation: {
                                minLength: 2,
                            },
                        },
                        {
                            field: {
                                domain: true,
                            },
                            title: 'Domain',
                            description:
                                'Please select a verified domain from this list. If you do not see any domains in this list, please head over to More -> Project Settings -> Custom Domains to add one.',
                            fieldType: FormFieldSchemaType.Dropdown,
                            dropdownModal: {
                                type: Domain,
                                labelField: 'domain',
                                valueField: '_id',
                            },
                            required: true,
                            placeholder: 'Select domain',
                        },
                    ]}
                    showRefreshButton={true}
                    filters={[
                        {
                            field: {
                                fullDomain: true,
                            },
                            title: 'Domain',
                            type: FieldType.Text,
                        },
                        {
                            field: {},
                            title: 'CNAME Valid',
                            type: FieldType.Boolean,
                        },
                        {
                            field: {},
                            title: 'SSL Provisioned',
                            type: FieldType.Boolean,
                        },
                    ]}
                    columns={[
                        {
                            field: {
                                fullDomain: true,
                            },
                            title: 'Domain',
                            type: FieldType.Text,
                        },
                        {
                            field: {
                                isCnameVerified: true,
                            },
                            title: 'CNAME Valid',
                            type: FieldType.Boolean,

                            tooltipText: (item: StatusPageDomain): string => {
                                if (item['isCnameVerified']) {
                                    return 'We have verified your CNAME record.';
                                }
                                return `Please add a new CNAME record to your domain ${item['fullDomain']}. It should look like CNAME ${item['fullDomain']} ${StatusPageCNameRecord}`;
                            },
                        },
                        {
                            field: {
                                isSslProvisioned: true,
                            },
                            title: 'SSL Provisioned',
                            type: FieldType.Boolean,

                            tooltipText: (_item: StatusPageDomain): string => {
                                return 'This will happen automatically after CNAME is verified. Please allow 24 hours for SSL to be provisioned after CNAME is verified. If that does not happen in 24 hours, please contact support.';
                            },
                        },
                    ]}
                />

                {selectedStatusPageDomain?.cnameVerificationToken &&
                    showCnameModal && (
                        <ConfirmModal
                            title={`Add CNAME`}
                            description={
                                <div>
                                    <span>
                                        Please add CNAME record to your domain.
                                        Details of the CNAME records are:
                                    </span>
                                    <br />
                                    <br />
                                    <span>
                                        <b>Record Type: </b> CNAME
                                    </span>
                                    <br />
                                    <span>
                                        <b>Name: </b>
                                        {
                                            selectedStatusPageDomain?.cnameVerificationToken
                                        }
                                    </span>
                                    <br />
                                    <span>
                                        <b>Content: </b>
                                        {StatusPageCNameRecord}
                                    </span>
                                    <br />
                                    <br />
                                    <span>
                                        Once you have done this, it should take
                                        24 hours to automatically verify.
                                    </span>
                                </div>
                            }
                            submitButtonText={'Verify CNAME'}
                            onClose={() => {
                                setShowCnameModal(false);
                                return setSelectedStatusPageDomain(null);
                            }}
                            isLoading={verifyCnameLoading}
                            error={error}
                            onSubmit={async () => {
                                try {
                                    setVerifyCnameLoading(true);
                                    setError('');
                                    // verify domain.
                                    await ModelAPI.updateById<StatusPageDomain>(
                                        {
                                            modelType: StatusPageDomain,
                                            id: selectedStatusPageDomain.id!,
                                            data: {
                                                isCnameVerified: true,
                                            },
                                        }
                                    );

                                    setShowCnameModal(false);
                                    setRefreshToggle(!refreshToggle);
                                } catch (err) {
                                    setError(API.getFriendlyMessage(err));
                                }

                                setVerifyCnameLoading(false);
                                setSelectedStatusPageDomain(null);
                            }}
                        />
                    )}

                {showSslProvisioningModal && (
                    <ConfirmModal
                        title={`Provision SSL`}
                        description={`This is an automatic process and takes around 24 hours to complete. If you do not see your SSL provisioned in 24 hours. Please contact support@oneuptime.com`}
                        submitButtonText={'Close'}
                        onSubmit={() => {
                            return setShowSslProvisioningModal(false);
                        }}
                    />
                )}
            </>
        </Fragment>
    );
};

export default StatusPageDelete;
