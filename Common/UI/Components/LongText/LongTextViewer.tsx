import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
    text: string;
    disableTruncation?: boolean;
}

const LongTextViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {
    const [showFullText, setShowFullText] = useState<boolean>(false);
    const characterLimit = 300;
    
    const shouldTruncate = !props.disableTruncation && props.text.length > characterLimit;
    const displayText = shouldTruncate && !showFullText 
        ? `${props.text.substring(0, characterLimit)}...` 
        : props.text;

    return (
        <div className="max-w-2xl break-words">
            <div className="whitespace-pre-wrap">{displayText}</div>
            
            {shouldTruncate && (
                <button 
                    onClick={() => setShowFullText(!showFullText)}
                    className="text-blue-600 hover:text-blue-800 text-sm mt-1 focus:outline-none"
                >
                    {showFullText ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
};

export default LongTextViewer;
