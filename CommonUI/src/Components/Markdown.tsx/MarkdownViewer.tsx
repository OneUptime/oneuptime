import React, { FunctionComponent, ReactElement } from 'react';

// https://github.com/remarkjs/react-markdown
import ReactMarkdown from 'react-markdown';

// https://github.com/remarkjs/remark-gfm
import remarkGfm from 'remark-gfm';

export interface ComponentProps {
    text: string;
}

const MarkdownViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <ReactMarkdown
                components={{
                    // Map `h1` (`# heading`) to use `h2`s.
                    h1: ({ node, ...props }) => <h1 className='text-4xl font-bold' {...props} />,
                    h2: ({node, ...props}) => <h1 className='text-3xl font-bold' {...props} />,
                    h3: ({node, ...props}) => <h1 className='text-2xl font-bold' {...props} />,
                    h4: ({ node, ...props }) => <h1 className='text-xl font-bold' {...props} />,
                    h5: ({node, ...props}) => <h1 className='text-lg font-bold' {...props} />,
                    h6: ({node, ...props}) => <h1 className='text-base font-bold' {...props} />,
                  }}
                children={props.text} remarkPlugins={[remarkGfm]} />
            
        </div>
    );
};

export default MarkdownViewer;
