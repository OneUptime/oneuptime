import React, { ReactElement } from 'react';
import Button, { ButtonSize, ButtonStyleType } from '../Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import GenericObject from 'Common/Types/GenericObject';
import Icon, { SizeProp } from '../Icon/Icon';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import ConfirmModal, {
    ComponentProps as ConfirmModalProps,
} from '../Modal/ConfirmModal';
import ProgressBar, { ProgressBarSize } from '../ProgressBar/ProgressBar';
import { Green, Red } from 'Common/Types/BrandColors';
import SimpleLogViewer from '../SimpleLogViewer/SimpleLogViewer';

export interface BulkActionFailed<T extends GenericObject> {
    failedMessage: string | ReactElement;
    item: T;
}

export interface ProgressInfo<T extends GenericObject> {
    inProgressItems: Array<T>;
    successItems: Array<T>;
    failed: Array<BulkActionFailed<T>>;
    totalItems: Array<T>;
}

export type OnProgressInfoFunction<T extends GenericObject> = (
    progressInfo: ProgressInfo<T>
) => void;

export type OnBulkActionStart = () => void;
export type OnBulkActionEnd = () => void;

export interface BulkActionButtonSchema<T extends GenericObject> {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined;
    isVisible?: (items: Array<T>) => boolean | undefined;
    className?: string | undefined;
    onClick: (props: {
        items: Array<T>;
        onProgressInfo: OnProgressInfoFunction<T>;
        onBulkActionStart: OnBulkActionStart;
        onBulkActionEnd: OnBulkActionEnd;
    }) => Promise<void>;
    disabled?: boolean | undefined;
    shortcutKey?: undefined | ShortcutKey;
    confirmMessage?: ((items: Array<T>) => string) | undefined;
    confirmTitle?: ((items: Array<T>) => string) | undefined;
    confirmButtonStyleType?: ButtonStyleType;
}

export interface ComponentProps<T extends GenericObject> {
    selectedItems: Array<T>;
    isAllItemsSelected: boolean;
    onSelectAllClick: () => void;
    singularLabel: string;
    pluralLabel: string;
    onClearSelectionClick: () => void;
    buttons: Array<BulkActionButtonSchema<T>>;
    onActionStart?: () => void;
    onActionEnd?: () => void;
    itemToString?: (item: T) => string;
}

const BulkUpdateForm: <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
        const [confirmModalProps, setConfirmModalProps] =
            React.useState<ConfirmModalProps | null>(null);

        const [progressInfo, setProgressInfo] =
            React.useState<ProgressInfo<T> | null>(null);
        const [showProgressInfoModal, setShowProgressInfoModal] =
            React.useState<boolean>(false);

        const [actionInProgress, setActionInProgress] = React.useState<boolean>(
            false
        );

        if (props.selectedItems.length === 0) {
            return <></>;
        }


        const showProgressInfo = () => {
            if (actionInProgress && progressInfo) {
                return <ProgressBar
                    count={
                        progressInfo.successItems.length +
                        progressInfo.failed.length
                    }
                    totalCount={progressInfo.totalItems.length}
                    suffix={props.pluralLabel}
                    size={ProgressBarSize.Small}
                />
            }

            if (!actionInProgress && progressInfo) {
                return <div className='mt-1 mb-1 space-y-1'>
                    <div className='flex'>
                        <Icon className='h-4 w-4' icon={IconProp.CheckCircle} size={SizeProp.Small} color={Green} />
                        <div>
                            {progressInfo.successItems.length}{' '}
                            {props.pluralLabel} Succeeded
                        </div>
                    </div>
                    {progressInfo.failed.length > 0 && <div className='flex'>
                        <Icon className='h-4 w-4' icon={IconProp.Close} size={SizeProp.Small} color={Red} />
                        <div>
                            {progressInfo.failed.length}{' '}
                            {props.pluralLabel} Failed
                        </div>
                        <div>
                            <div  className='font-semibold'>More information: </div>
                            <SimpleLogViewer>
                                {progressInfo.failed.map((failedItem, i) => {
                                    return (
                                        <div className='flex' key={i}>
                                            {props.itemToString ? props.itemToString(failedItem.item) : ''}
                                            {failedItem.failedMessage}
                                        </div>
                                    );
                                })}
                            </SimpleLogViewer>
                        </div>
                    </div>}
                </div>
            }

            return <></>;
        }


        return (
            <div>
                <div>
                    <div className="flex mt-5 mb-5 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100 justify-between">
                        <div className="w-full -mt-1">
                            <div className="flex mt-1">
                                <div className="flex-auto py-0.5 text-sm leading-5">
                                    <span className="font-semibold">
                                        {props.selectedItems.length}{' '}
                                        {props.pluralLabel + ' ' || ''}
                                        Selected
                                    </span>{' '}
                                </div>
                            </div>
                            <div className="flex -ml-3 mt-1">
                                {/** Edit Filter Button */}
                                {!props.isAllItemsSelected && (
                                    <Button
                                        className="font-medium text-gray-900"
                                        icon={IconProp.CheckCircle}
                                        onClick={() => {
                                            props.onSelectAllClick();
                                        }}
                                        title={`Select All ${props.pluralLabel}`}
                                        iconSize={SizeProp.Smaller}
                                        buttonStyle={ButtonStyleType.SECONDARY_LINK}
                                    />
                                )}

                                {/** Clear Filter Button */}
                                <Button
                                    onClick={() => {
                                        props.onClearSelectionClick();
                                    }}
                                    className="font-medium text-gray-900 -ml-2"
                                    icon={IconProp.Close}
                                    title="Clear Selection"
                                    buttonStyle={ButtonStyleType.SECONDARY_LINK}
                                />
                            </div>
                        </div>

                        <div className="flex w-full h-full -mt-1 justify-end mt-auto mb-auto">
                            {props.buttons?.map(
                                (button: BulkActionButtonSchema<T>, i: number) => {
                                    return (
                                        <div
                                            style={
                                                i > 0
                                                    ? {
                                                        marginLeft: '10px',
                                                    }
                                                    : {}
                                            }
                                            key={i}
                                        >
                                            <Button
                                                key={i}
                                                title={button.title}
                                                buttonStyle={button.buttonStyleType}
                                                className={button.className}
                                                onClick={async () => {
                                                    if (button.confirmMessage) {
                                                        setConfirmModalProps({
                                                            title: button.confirmTitle
                                                                ? button.confirmTitle(
                                                                    props.selectedItems
                                                                )
                                                                : 'Confirm',
                                                            description:
                                                                button.confirmMessage(
                                                                    props.selectedItems
                                                                ),
                                                            submitButtonType: button.confirmButtonStyleType,
                                                            submitButtonText:
                                                                button.title,
                                                            onClose: () => {
                                                                setConfirmModalProps(null);
                                                            },
                                                            onSubmit: async () => {
                                                                await button.onClick(
                                                                    {
                                                                        items: props.selectedItems,
                                                                        onProgressInfo:
                                                                            (
                                                                                progressInfo: ProgressInfo<T>
                                                                            ) => {
                                                                                setProgressInfo(
                                                                                    progressInfo
                                                                                );
                                                                            },
                                                                        onBulkActionStart:
                                                                            () => {
                                                                                setShowProgressInfoModal(
                                                                                    true
                                                                                );
                                                                                props.onActionStart &&
                                                                                    props.onActionStart();
                                                                            },
                                                                        onBulkActionEnd:
                                                                            () => {
                                                                                setShowProgressInfoModal(
                                                                                    false
                                                                                );
                                                                                props.onActionEnd &&
                                                                                    props.onActionEnd();
                                                                            },
                                                                    }
                                                                );
                                                            },
                                                        });
                                                        return;
                                                    }

                                                    if (button.onClick) {
                                                        await button.onClick({
                                                            items: props.selectedItems,
                                                            onProgressInfo: (
                                                                progressInfo: ProgressInfo<T>
                                                            ) => {
                                                                setProgressInfo(
                                                                    progressInfo
                                                                );
                                                            },
                                                            onBulkActionStart:
                                                                () => {
                                                                    setShowProgressInfoModal(
                                                                        true
                                                                    );
                                                                    setProgressInfo({
                                                                        inProgressItems: props.selectedItems,
                                                                        successItems: [],
                                                                        failed: [],
                                                                        totalItems: props.selectedItems,
                                                                    });
                                                                    setActionInProgress(true);
                                                                },
                                                            onBulkActionEnd: () => {
                                                                setActionInProgress(false);
                                                            },
                                                        });
                                                    }
                                                }}
                                                disabled={button.disabled}
                                                icon={button.icon}
                                                shortcutKey={button.shortcutKey}
                                                buttonSize={ButtonSize.Small}
                                                dataTestId="card-button"
                                            />
                                        </div>
                                    );
                                }
                            )}
                        </div>
                    </div>
                </div>

                {confirmModalProps && (
                    <ConfirmModal
                        {...confirmModalProps}
                        onSubmit={() => {
                            confirmModalProps.onSubmit();
                            setConfirmModalProps(null);
                        }}

                    />
                )}

                {showProgressInfoModal && progressInfo && (
                    <ConfirmModal
                        title="In Progress"
                        description={
                            <div>
                                {showProgressInfo()}
                            </div>
                        }
                        submitButtonType={ButtonStyleType.NORMAL}
                        disableSubmitButton={
                            actionInProgress
                        }
                        submitButtonText="Close"
                        onSubmit={() => {
                            setShowProgressInfoModal(false);
                        }}
                    />
                )}
            </div>
        );
    };

export default BulkUpdateForm;
