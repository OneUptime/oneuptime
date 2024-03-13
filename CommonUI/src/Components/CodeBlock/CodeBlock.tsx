import React, { FunctionComponent, ReactElement } from 'react';
import Highlight from 'react-highlight'

export interface ComponentProps {
    code: string | ReactElement;
    language: string;
}

const CodeBlock: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Highlight className={`language-${props.language}`}>
            {props.code}
        </Highlight>
    );
};

export default CodeBlock;
