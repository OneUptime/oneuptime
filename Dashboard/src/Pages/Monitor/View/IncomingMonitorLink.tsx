import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import Card from 'CommonUI/src/Components/Card/Card';
import Link from 'CommonUI/src/Components/Link/Link';
import { DOMAIN, HTTP_PROTOCOL } from 'CommonUI/src/Config';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    modelId: ObjectID;
}

const IncomingMonitorLink: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            <Card
                title={`Incoming Request URL / Heartbeat URL`}
                description={
                    <span>
                        Please send inbound heartbeat GET or POST requests to this URL{' '}
                        <Link
                            openInNewTab={true}
                            to={new URL(HTTP_PROTOCOL, DOMAIN)
                                .addRoute('/heartbeat')
                                .addRoute(`/${props.modelId.toString()}`)}
                        >
                            <span>
                                {new URL(HTTP_PROTOCOL, DOMAIN)
                                    .addRoute('/heartbeat')
                                    .addRoute(`/${props.modelId.toString()}`)
                                    .toString()}
                            </span>
                        </Link>
                    </span>
                }
            />
        </>
    );
};

export default IncomingMonitorLink;
