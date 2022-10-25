import React, { FunctionComponent, ReactElement, useState } from 'react';
import Icon, { IconProp } from '../Icon/Icon';

export interface ComponentProps {
    text: string;
    isCopyable?: boolean;
}

const HiddenText: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showText, setShowText] = useState<boolean>(false);
    const [copiedToClipboard, setCopyToClipboard] = useState<boolean>(false);

    if (!showText) {
        return (
            <p
                role="hidden-text"
                className="pointer underline"
                onClick={() => {
                    setShowText(true);
                }}
            >
                Click here to reveal
            </p>
        );
    }

    return (
        <div>
            <div className="flex">
                <div
                    style={{
                        marginRight: '5px',
                    }}
                    role="revealed-text"
                >
                    {props.text}
                </div>{' '}
                <Icon
                    icon={IconProp.Hide}
                    className="pointer"
                    onClick={() => {
                        setShowText(false);
                        setCopyToClipboard(false);
                    }}
                />
            </div>
            {props.isCopyable && (
                <div>
                    <span
                        className="pointer underline"
                        onClick={async () => {
                            setCopyToClipboard(true);
                            await navigator.clipboard.writeText(props.text);
                        }}
                        role="copy-to-clipboard"
                    >
                        {' '}
                        {copiedToClipboard
                            ? 'Copied to Clipboard'
                            : 'Copy to Clipboard'}{' '}
                    </span>
                </div>
            )}
        </div>
    );
};

export default HiddenText;
