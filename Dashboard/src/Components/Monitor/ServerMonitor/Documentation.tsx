
import ObjectID from 'Common/Types/ObjectID';
import Card from 'CommonUI/src/Components/Card/Card';
import CodeBlock from 'CommonUI/src/Components/CodeBlock/CodeBlock';
import { HOST, HTTP_PROTOCOL } from 'CommonUI/src/Config';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    secretKey: ObjectID;
}

const ServerMonitorDocumentation: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const host = `${HTTP_PROTOCOL}${HOST}`;

    return (
        <>
            <Card
                title={`Set up your Server Monitor`}
                description={
                    <div className='space-y-2 w-full'>
                        <div>Please install NPM on your server. </div>
                        <CodeBlock language='bash' code={<div>
                            <p>npm install -g @oneuptime/infrastructure-agent</p>
                            <p>oneuptime-infrastructure-agent --secret-key={props.secretKey.toString()} --oneuptime-url={host}</p>
                        </div>} />
                    </div>

                }
            />
        </>
    );
};

export default ServerMonitorDocumentation;
