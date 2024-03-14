import React, { FunctionComponent, ReactElement } from 'react';
import Highlight from 'react-highlight';
import 'highlight.js/styles/a11y-dark.css';

export interface ComponentProps {
    code: string | ReactElement;
    language: string;
}

const CodeBlock: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Highlight
            className={`p-3 language-${props.language} rounded-md shadow`}
        >
            {props.code}
        </Highlight>
    );
};

export default CodeBlock;
