import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import API from 'Common/Utils/API';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import MarkdownViewer from '../Markdown.tsx/MarkdownViewer';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { DOMAIN, HOME_URL, HTTP_PROTOCOL } from '../../Config';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    documentationLink: Route;
    workflowId: ObjectID
}

const DocumentationViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [markdown, setMarkdown] = useState<string>('')
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');


    const populateWithEnvVars = (text: string): string => {
        text = text.replace("{{serverUrl}}", HOME_URL.toString())
        text = text.replace("{{workflowId}}", props.workflowId.toString())

        return text; 
    }

    const loadDocs: Function = async (): Promise<void> => {
        if (props.documentationLink) {
            try {
                setIsLoading(true);
                const body = await API.get(new URL(HTTP_PROTOCOL, DOMAIN, props.documentationLink), {}, {
                    Accept: 'text/plain',
                    'Content-Type': 'text/plain',
                });
                setMarkdown(populateWithEnvVars(((body).data as any).data.toString()));
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
