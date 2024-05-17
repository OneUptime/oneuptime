import React, { ReactElement } from 'react';
import Button, { ButtonSize, ButtonStyleType } from '../Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import GenericObject from 'Common/Types/GenericObject';
import { SizeProp } from '../Icon/Icon';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import ConfirmModal, {
    ComponentProps as ConfirmModalProps,
} from '../Modal/ConfirmModal';
import ProgressBar from '../ProgressBar/ProgressBar';


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

type OnProgressInfoFunction<T  extends GenericObject> = (progressInfo: ProgressInfo<T>) => void;

type OnBulkActionStart = () => void;
type OnBulkActionEnd = () => void;

interface BulkActionButtonSchema<T extends GenericObject> {
    title: string;
    icon?: undefined | IconProp;
    buttonStyleType: ButtonStyleType;
    isLoading?: boolean | undefined;
    isVisible?: (items: Array<T>) => boolean | undefined;
    className?: string | undefined;
    onClick: (props: {items: Array<T>, onProgressInfo: OnProgressInfoFunction<T>, onBulkActionStart: OnBulkActionStart, onBulkActionEnd: OnBulkActionEnd }) => Promise<void>;
    disabled?: boolean | undefined;
    shortcutKey?: undefined | ShortcutKey;
    confirmMessage?: ((items: Array<T>) => string) | undefined;
    confirmTitle?: ((items: Array<T>) => string) | undefined;
}

export interface ComponentProps<T extends GenericObject> {
    selectedItems: Array<T>;
    isAllItemsSelected: boolean;
    onSelectAllClick: () => void;
    singularLabel: string;
    pluralLabel: string;
    onClearSelectionClick: () => void;
    buttons: Array<BulkActionButtonSchema<T>>;
}

const BulkUpdateForm: <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
        const [confirmModalProps, setConfirmModalProps] =
            React.useState<ConfirmModalProps | null>(null);

        const [progressInfo, setProgressInfo] = React.useState<ProgressInfo<T> | null>(null);
        const [showProgressInfoModal, setShowProgressInfoModal] = React.useState<boolean>(false);

        if (props.selectedItems.length === 0) {
            return <></>;
        }

        return (
            <div>
                <div>
                    <div className="mt-5 mb-5 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100">
                        <div className="flex w-full mb-3 -mt-1">
                            <div className="flex">
                                <div className="flex-auto py-0.5 text-sm leading-5 text-gray-500">
                                    <span className="font-semibold text-xs text-gray-400">
                                        {props.selectedItems.length}{' '}
                                        {props.pluralLabel?.toUpperCase() + ' ' ||
                                            ''}
                                        SELECTED
                                    </span>{' '}
                                </div>
                            </div>
                        </div>

                        <div className="flex w-full mb-3 -mt-1">
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
                                                            submitButtonText:
                                                                button.title,
                                                            onSubmit: async () => {
                                                                await button.onClick(
                                                                    {
                                                                        items: props.selectedItems,
                                                                        onProgressInfo: (progressInfo: ProgressInfo<T>) => {
                                                                            setProgressInfo(progressInfo);
                                                                        },
                                                                        onBulkActionStart: () => {
                                                                            setShowProgressInfoModal(true);
                                                                        },
                                                                        onBulkActionEnd: () => {
                                                                            setShowProgressInfoModal(false);
                                                                        }
                                                                    }
                                                                );
                                                            },
                                                        });
                                                        return;
                                                    }

                                                    if (button.onClick) {
                                                        await button.onClick(
                                                            {
                                                                items: props.selectedItems,
                                                                onProgressInfo: (progressInfo: ProgressInfo<T>) => {
                                                                    setProgressInfo(progressInfo);
                                                                },
                                                                onBulkActionStart: () => {
                                                                    setShowProgressInfoModal(true);
                                                                },
                                                                onBulkActionEnd: () => {
                                                                    setShowProgressInfoModal(false);
                                                                }
                                                            }
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

                        <div className="flex -ml-3 mt-3 -mb-2">
                            {/** Edit Filter Button */}
                            {!props.isAllItemsSelected && (
                                <Button
                                    className="font-medium text-gray-900"
                                    icon={IconProp.Filter}
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
                                className="font-medium text-gray-900"
                                icon={IconProp.Close}
                                title="Clear Selection"
                                buttonStyle={ButtonStyleType.SECONDARY_LINK}
                            />
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
                            <ProgressBar count={progressInfo.successItems.length + progressInfo.failed.length} totalCount={progressInfo.totalItems.length} suffix={props.pluralLabel} />
                        }
                        submitButtonType={ButtonStyleType.SECONDARY}
                        disableSubmitButton={progressInfo.inProgressItems.length < progressInfo.totalItems.length}
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
