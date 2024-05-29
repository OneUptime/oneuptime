import { HOME_URL, HOST, HTTP_PROTOCOL } from '../../Config';
import API from '../../Utils/API/API';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import MarkdownViewer from '../Markdown.tsx/LazyMarkdownViewer';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import ObjectID from 'Common/Types/ObjectID';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import useAsyncEffect from 'use-async-effect';

export interface ComponentProps {
    documentationLink: Route;
    workflowId: ObjectID;
}

const DocumentationViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [markdown, setMarkdown] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string>('');

    type PopulateWithEnvVarsFunction = (text: string) => string;

    const populateWithEnvVars: PopulateWithEnvVarsFunction = (
        text: string
    ): string => {
        text = text.replace('{{serverUrl}}', HOME_URL.toString());
        text = text.replace('{{workflowId}}', props.workflowId.toString());

        return text;
    };

    const loadDocs: PromiseVoidFunction = async (): Promise<void> => {
        if (props.documentationLink) {
            try {
                setIsLoading(true);
                const body: HTTPResponse<any> = await API.get(
                    new URL(HTTP_PROTOCOL, HOST, props.documentationLink),
                    {},
                    {
                        Accept: 'text/plain',
                        'Content-Type': 'text/plain',
                    }
                );
                setMarkdown(
                    populateWithEnvVars((body.data as any).data.toString())
                );
                setIsLoading(false);
            } catch (err) {
                setIsLoading(false);
                setError(API.getFriendlyMessage(err));
            }
        }
    };

    useAsyncEffect(async () => {
        await loadDocs();
    }, [props.documentationLink]);

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
