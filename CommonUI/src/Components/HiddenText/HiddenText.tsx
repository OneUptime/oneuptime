import React, { FunctionComponent, ReactElement, useState } from 'react';
import Icon from '../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import CopyableButton from '../CopyableButton/CopyableButton';

export interface ComponentProps {
    text: string;
    isCopyable?: boolean;
}

const HiddenText: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showText, setShowText] = useState<boolean>(false);

    if (!showText) {
        return (
            <p
                role="hidden-text"
                className="cursor-pointer underline"
                onClick={() => {
                    setShowText(true);
                }}
            >
                Click here to reveal
            </p>
        );
    }

    return (
        <div className="flex">
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
                    className="cursor-pointer text-gray-400 h-4 w-4"
                    data-testid="hide-text-icon"
                    onClick={() => {
                        setShowText(false);
                    }}
                />
            </div>
            {props.isCopyable && showText && (
                <CopyableButton textToBeCopied={props.text} />
            )}
        </div>
    );
};

export default HiddenText;
