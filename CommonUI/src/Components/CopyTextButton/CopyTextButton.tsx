import React, { FunctionComponent, MouseEventHandler, ReactElement } from 'react';
import Clipboard from '../../Utils/Clipboard';

export interface ComponentProps {
    textToBeCopied: string;
    className?: string | undefined;
}

const CopyTextButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy: MouseEventHandler<HTMLDivElement> = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        event.preventDefault();
        event.stopPropagation();
        Clipboard.copyToClipboard(props.textToBeCopied);
        setCopied(true);
        setTimeout(() => {
            setCopied(false);
        }, 1000);
    };

    return (<div className={`cursor-pointer ${props.className}`} onClick={handleCopy}>
        <div>
            {copied ? 'Copied!' : 'Copy'}
        </div>
    </div>)
};

export default CopyTextButton;
