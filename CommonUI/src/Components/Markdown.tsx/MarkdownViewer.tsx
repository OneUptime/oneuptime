import React, {
    FunctionComponent,
    ReactElement,
} from 'react';

// https://github.com/remarkjs/react-markdown
import ReactMarkdown from 'react-markdown';

// https://github.com/remarkjs/remark-gfm
import remarkGfm from 'remark-gfm'

export interface ComponentProps {
    text: string
}

const MarkdownViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <div>
           <ReactMarkdown children={props.text} remarkPlugins={[remarkGfm]} />
        </div>
    );
};

export default MarkdownViewer;
