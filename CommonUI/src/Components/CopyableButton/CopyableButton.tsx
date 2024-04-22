import React, { FunctionComponent, ReactElement, useState } from 'react';
import Icon, { SizeProp, ThickProp } from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import Tooltip from '../Tooltip/Tooltip';

export interface ComponentProps {
    textToBeCopied: string;
}

const CopyableButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [copiedToClipboard, setCopyToClipboard] = useState<boolean>(false);

    const refreshCopyToClipboardState: VoidFunction = (): void => {
        setCopyToClipboard(true);
        setTimeout(() => {
            setCopyToClipboard(false);
        }, 2000);
    };

    return (
        <div
            className={`${
                copiedToClipboard ? '' : 'cursor-pointer mt-0.5'
            } flex ml-1 text-gray-500`}
            onClick={async () => {
                refreshCopyToClipboardState();
                await navigator.clipboard?.writeText(props.textToBeCopied);
            }}
            role="copy-to-clipboard"
        >
            {' '}
            {copiedToClipboard ? (
                'Copied to Clipboard'
            ) : (
                <Tooltip text="Copy to Clipboard">
                    <Icon
                        className="h-4 w-4"
                        data-testid="copy-to-clipboard-icon"
                        icon={IconProp.Copy}
                        size={SizeProp.Small}
                        thick={ThickProp.Thick}
                    />
                </Tooltip>
            )}{' '}
        </div>
    );
};

export default CopyableButton;
