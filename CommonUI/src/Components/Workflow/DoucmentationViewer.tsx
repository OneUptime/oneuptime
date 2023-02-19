import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import URL from 'Common/Types/API/URL';
import API from 'Common/Utils/API';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import MarkdownViewer from '../Markdown.tsx/MarkdownViewer';

export interface ComponentProps {
    documentationLink: URL;
}

const DocumentationViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [markdown, setMarkdown] = useState<string>('')
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');

    const loadDocs: Function = async (): Promise<void> => {
        if (props.documentationLink) {
            try {
                setIsLoading(true);
                const body = await API.get(props.documentationLink, {}, {
                    Accept: 'text/plain',
                    'Content-Type': 'text/plain',
                });
                setMarkdown((body).data.toString());
                setIsLoading(false);
            } catch (err) {
                setIsLoading(false);
                try {
                    setError(
                        (err as HTTPErrorResponse).message ||
                            'Server Error. Please try again'
                    );
                } catch (e) {
                    setError('Server Error. Please try again');
                }
            }
        }
    }


    useEffect(() => {
        loadDocs();
    }, [props.documentationLink])

    return (
        <div className="mt-5 mb-5">
            <h2 className="text-base font-medium text-gray-500">
                Documentation
            </h2>
            <p className="text-sm font-medium text-gray-400">
                Here is some documentation for this component.
            </p>

            {error ? <ErrorMessage error={error} /> : <></>}
                {isLoading ? <ComponentLoader /> : <></>}

            <div className="mt-3">
                <MarkdownViewer text={markdown} />
            </div>
        </div>
    );
};

export default DocumentationViewer;
