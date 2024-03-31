import ObjectID from 'Common/Types/ObjectID';
import Card from 'CommonUI/src/Components/Card/Card';
import CodeBlock from 'CommonUI/src/Components/CodeBlock/CodeBlock';
import { HOST, HTTP_PROTOCOL, VERSION } from 'CommonUI/src/Config';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    secretKey: ObjectID;
}

const ServerMonitorDocumentation: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const host: string = `${HTTP_PROTOCOL}${HOST}`;
    let showHost: boolean = true;

    if (host === 'https://oneuptime.com') {
        showHost = false;
    }

    return (
        <>
            <Card
                title={`Set up your Server Monitor`}
                description={
                    <div className="space-y-2 w-full mt-5">
                        <CodeBlock
                            language="bash"
                            code={`
# Install the agent
curl -s ${HTTP_PROTOCOL}${HOST.toString()}/docs/static/scripts/infrastructure-agent/install-linux.sh | bash 

# Run the agent
oneuptime-infrastructure-agent --secret-key=${props.secretKey.toString()} ${
                                showHost ? '--oneuptime-url=' + host : ''
                            }

`}
                        />
                    </div>
                }
            />
        </>
    );
};

export default ServerMonitorDocumentation;
