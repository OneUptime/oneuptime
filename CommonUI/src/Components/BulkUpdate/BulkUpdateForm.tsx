import { GetReactElementFunction } from '../../Types/FunctionTypes';
import Button, { ButtonSize, ButtonStyleType } from '../Button/Button';
import Icon, { SizeProp } from '../Icon/Icon';
import ConfirmModal, {
    ComponentProps as ConfirmModalProps,
} from '../Modal/ConfirmModal';
import ProgressBar, { ProgressBarSize } from '../ProgressBar/ProgressBar';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import SimpleLogViewer from '../SimpleLogViewer/SimpleLogViewer';
import { Green, Red } from 'Common/Types/BrandColors';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import GenericObject from 'Common/Types/GenericObject';
import IconProp from 'Common/Types/Icon/IconProp';
import React, { ReactElement } from 'react';

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

export interface BulkActionOnClickProps<T extends GenericObject> {
    items: Array<T>;
    onProgressInfo: OnProgressInfoFunction<T>;
    onBulkActionStart: OnBulkActionStart;
    onBulkActionEnd: OnBulkActionEnd;
}

export interface BulkActionButtonSchema<T extends GenericObject> {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined;
    isVisible?: (items: Array<T>) => boolean | undefined;
    className?: string | undefined;
    onClick: (props: BulkActionOnClickProps<T>) => Promise<void>;
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

    const [actionInProgress, setActionInProgress] =
        React.useState<boolean>(false);

    const [actionName, setActionName] = React.useState<string>('');

    if (props.selectedItems.length === 0) {
        return <></>;
    }

    const showProgressInfo: GetReactElementFunction = (): ReactElement => {
        if (actionInProgress && progressInfo) {
            return (
                <ProgressBar
                    count={
                        progressInfo.successItems.length +
                        progressInfo.failed.length
                    }
                    totalCount={progressInfo.totalItems.length}
                    suffix={props.pluralLabel}
                    size={ProgressBarSize.Small}
                />
            );
        }

        if (!actionInProgress && progressInfo) {
            return (
                <div className="mt-1 mb-1 space-y-1">
                    <div className="flex">
                        <Icon
                            className="h-5 w-5"
                            icon={IconProp.CheckCircle}
                            color={Green}
                        />
                        <div className="ml-1 font-medium">
                            {progressInfo.successItems.length}{' '}
                            {props.pluralLabel} Succeeded
                        </div>
                    </div>
                    {progressInfo.failed.length > 0 && (
                        <div>
                            <div className="flex mt-3">
                                <Icon
                                    className="h-5 w-5"
                                    icon={IconProp.Close}
                                    color={Red}
                                />
                                <div className="ml-1 font-medium">
                                    {progressInfo.failed.length}{' '}
                                    {props.pluralLabel} Failed More information:
                                </div>
                            </div>
                            <div>
                                <SimpleLogViewer>
                                    {progressInfo.failed.map(
                                        (
                                            failedItem: BulkActionFailed<T>,
                                            i: number
                                        ) => {
                                            return (
                                                <div className="flex" key={i}>
                                                    {actionName}{' '}
                                                    {props.itemToString
                                                        ? props.itemToString(
                                                              failedItem.item
                                                          )
                                                        : ''}{' '}
                                                    {'Failed: '}
                                                    {failedItem.failedMessage}
                                                </div>
                                            );
                                        }
                                    )}
                                </SimpleLogViewer>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        return <></>;
    };

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
                                {props.isAllItemsSelected &&
                                    props.selectedItems.length ===
                                        LIMIT_PER_PROJECT && (
                                        <span className="text-gray-500">
                                            (You can only select{' '}
                                            {LIMIT_PER_PROJECT}{' '}
                                            {props.pluralLabel} at a time. This
                                            is for performance reasons.)
                                        </span>
                                    )}
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
                                                const buttonClickObject: BulkActionOnClickProps<T> =
                                                    {
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
                                                                setActionName(
                                                                    button.title
                                                                );
                                                                setProgressInfo(
                                                                    {
                                                                        inProgressItems:
                                                                            props.selectedItems,
                                                                        successItems:
                                                                            [],
                                                                        failed: [],
                                                                        totalItems:
                                                                            props.selectedItems,
                                                                    }
                                                                );
                                                                setActionInProgress(
                                                                    true
                                                                );
                                                                props.onActionStart &&
                                                                    props.onActionStart();
                                                            },
                                                        onBulkActionEnd: () => {
                                                            setActionInProgress(
                                                                false
                                                            );
                                                            setActionName('');
                                                        },
                                                    };

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
                                                        submitButtonType:
                                                            button.confirmButtonStyleType,
                                                        submitButtonText:
                                                            button.title,
                                                        onClose: () => {
                                                            setConfirmModalProps(
                                                                null
                                                            );
                                                        },
                                                        onSubmit: async () => {
                                                            await button.onClick(
                                                                buttonClickObject
                                                            );
                                                        },
                                                    });
                                                    return;
                                                }

                                                if (button.onClick) {
                                                    await button.onClick(
                                                        buttonClickObject
                                                    );
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
                    title={actionInProgress ? 'In Progress' : 'Completed'}
                    description={<div>{showProgressInfo()}</div>}
                    submitButtonType={ButtonStyleType.NORMAL}
                    disableSubmitButton={actionInProgress}
                    submitButtonText="Close"
                    onSubmit={() => {
                        setShowProgressInfoModal(false);
                        props.onActionEnd && props.onActionEnd();
                    }}
                />
            )}
        </div>
    );
};

export default BulkUpdateForm;
