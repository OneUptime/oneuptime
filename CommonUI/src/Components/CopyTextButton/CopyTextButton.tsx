import React, { FunctionComponent, ReactElement } from 'react';
import Clipboard from '../../Utils/Clipboard';

export interface ComponentProps {
    textToBeCopied: string;
    className?: string | undefined;
}

const CopyTextButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = () => {
        Clipboard.copyToClipboard(props.textToBeCopied);
        setCopied(true);
        setTimeout(() => {
            setCopied(false);
        }, 5000);
    };

    return (<div className={`cursor-pointer ${props.className}`} onClick={handleCopy}>
        <div>
            {copied ? 'Copied!' : 'Copy'}
        </div>
    </div>)
};

export default CopyTextButton;
