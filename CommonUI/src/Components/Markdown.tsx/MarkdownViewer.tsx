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
                    // because tailwind does not supply <h1 ... /> styles https://tailwindcss.com/docs/preflight#headings-are-unstyled
                    h1: ({ node, ...props }) => <h1 className='text-4xl ' {...props} />,
                    h2: ({node, ...props}) => <h1 className='text-3xl ' {...props} />,
                    h3: ({node, ...props}) => <h1 className='text-2xl ' {...props} />,
                    h4: ({ node, ...props }) => <h1 className='text-xl ' {...props} />,
                    h5: ({node, ...props}) => <h1 className='text-lg ' {...props} />,
                    h6: ({node, ...props}) => <h1 className='text-base ' {...props} />,
                  }}
                children={props.text} remarkPlugins={[remarkGfm]} />
            
        </div>
    );
};

export default MarkdownViewer;
