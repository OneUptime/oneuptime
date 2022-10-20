import React, { FunctionComponent, ReactElement, useState } from 'react';
import Icon, { IconProp } from '../Icon/Icon';

export interface ComponentProps {
    text: string;
    isCopyable?: boolean;
    dataTestId?: string;
}

const HiddenText: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showText, setShowText] = useState<boolean>(false);
    const [copiedToClipboard, setCopyToClipboard] = useState<boolean>(false);

    if (!showText) {
        return (
            <p 
                role='paragraph'
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
        <div >
            <div className="flex">
                <div 
                    style={{
                        marginRight: '5px',
                    }}
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
                        data-testid={props.dataTestId}
                        className="pointer underline"
                        onClick={async () => {
                            await navigator.clipboard.writeText(props.text); 
                            setCopyToClipboard(true);
                        }}
                    >
                        {' '}
                        {copiedToClipboard
                            ? 'Copied to clipboard'
                            : 'Copy to Clipboard'}{' '}
                    </span>
                </div>
            )}
        </div>
    );
};

export default HiddenText;
