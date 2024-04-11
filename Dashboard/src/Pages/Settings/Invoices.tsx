import { JSONObject } from 'Common/Types/JSON';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useState,
} from 'react';
import Text from 'Common/Types/Text';
import PageComponentProps from '../PageComponentProps';
import BillingInvoice, { InvoiceStatus } from 'Model/Models/BillingInvoice';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import URL from 'Common/Types/API/URL';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import { Green, Yellow } from 'Common/Types/BrandColors';
import { APP_API_URL } from 'CommonUI/src/Config';
import BaseAPI from 'CommonUI/src/Utils/API/API';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import DashboardNavigation from '../../Utils/Navigation';
import HTTPResponse from 'Common/Types/API/HTTPResponse';

export interface ComponentProps extends PageComponentProps {}

const Settings: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    type PayInvoiceFunction = (
        customerId: string,
        invoiceId: string
    ) => Promise<void>;

    const payInvoice: PayInvoiceFunction = async (
        customerId: string,
        invoiceId: string
    ): Promise<void> => {
        try {
            setIsLoading(true);

            const result: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(APP_API_URL.toString()).addRoute(
                        `/billing-invoices/pay`
                    ),
                    {
                        data: {
                            paymentProviderInvoiceId: invoiceId,
                            paymentProviderCustomerId: customerId,
                        },
                    },
                    ModelAPI.getCommonHeaders()
                );

            if (result.isFailure()) {
                throw result;
            }

            Navigation.reload();
        } catch (err) {
            setError(BaseAPI.getFriendlyMessage(err));
            setIsLoading(false);
        }
    };

    return (
        <Fragment>
            {isLoading ? <ComponentLoader /> : <></>}

            {!isLoading ? (
                <ModelTable<BillingInvoice>
                    modelType={BillingInvoice}
                    id="invoices-table"
                    isDeleteable={false}
                    name="Settings > Billing > Invoices"
                    isEditable={false}
                    isCreateable={false}
                    isViewable={false}
                    cardProps={{
                        title: 'Invoices',
                        description:
                            'Here is a list of invoices for this project.',
                    }}
                    noItemsMessage={'No invoices so far.'}
                    query={{
                        projectId:
                            DashboardNavigation.getProjectId()?.toString(),
                    }}
                    showRefreshButton={true}
                    selectMoreFields={{
                        currencyCode: true,
                        paymentProviderCustomerId: true,
                    }}
                    filters={[
                        {
                            field: {
                                paymentProviderInvoiceId: true,
                            },
                            title: 'Invoice ID',
                            type: FieldType.Text,
                        },
                        {
                            field: {
                                amount: true,
                            },
                            title: 'Amount',
                            type: FieldType.Text,
                        },
                        {
                            field: {
                                status: true,
                            },
                            title: 'Invoice Status',
                            type: FieldType.Text,
                        },
                    ]}
                    columns={[
                        {
                            field: {
                                paymentProviderInvoiceId: true,
                            },
                            title: 'Invoice ID',
                            type: FieldType.Text,
                        },
                        {
                            field: {
                                amount: true,
                            },
                            title: 'Amount',
                            type: FieldType.Text,

                            getElement: (item: JSONObject) => {
                                return (
                                    <span>{`${
                                        (item['amount'] as number) / 100
                                    } ${item['currencyCode']
                                        ?.toString()
                                        .toUpperCase()}`}</span>
                                );
                            },
                        },
                        {
                            field: {
                                status: true,
                            },
                            title: 'Invoice Status',
                            type: FieldType.Text,

                            getElement: (item: JSONObject) => {
                                if (item['status'] === InvoiceStatus.Paid) {
                                    return (
                                        <Pill
                                            text={Text.uppercaseFirstLetter(
                                                item['status'] as string
                                            )}
                                            color={Green}
                                        />
                                    );
                                }
                                return (
                                    <Pill
                                        text={Text.uppercaseFirstLetter(
                                            item['status'] as string
                                        )}
                                        color={Yellow}
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                downloadableLink: true,
                            },
                            title: 'Actions',
                            type: FieldType.Text,

                            getElement: (item: JSONObject) => {
                                return (
                                    <div>
                                        {item['downloadableLink'] ? (
                                            <Button
                                                icon={IconProp.Download}
                                                onClick={() => {
                                                    Navigation.navigate(
                                                        item[
                                                            'downloadableLink'
                                                        ] as URL
                                                    );
                                                }}
                                                title="Download"
                                            />
                                        ) : (
                                            <></>
                                        )}

                                        {item['status'] !==
                                            InvoiceStatus.Paid &&
                                        item['status'] !==
                                            InvoiceStatus.Draft &&
                                        item['status'] !== InvoiceStatus.Void &&
                                        item['status'] !==
                                            InvoiceStatus.Deleted ? (
                                            <Button
                                                icon={IconProp.Billing}
                                                onClick={async () => {
                                                    await payInvoice(
                                                        item[
                                                            'paymentProviderCustomerId'
                                                        ] as string,
                                                        item[
                                                            'paymentProviderInvoiceId'
                                                        ] as string
                                                    );
                                                }}
                                                title="Pay Invoice"
                                            />
                                        ) : (
                                            <></>
                                        )}
                                    </div>
                                );
                            },
                        },
                    ]}
                />
            ) : (
                <></>
            )}

            {error ? (
                <ConfirmModal
                    title={`Something is not quite right...`}
                    description={`${error}`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        setError('');
                    }}
                    submitButtonType={ButtonStyleType.NORMAL}
                />
            ) : (
                <></>
            )}
        </Fragment>
    );
};

export default Settings;
