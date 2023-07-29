import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import Card from 'CommonUI/src/Components/Card/Card';
import Link from 'CommonUI/src/Components/Link/Link';
import { PROBE_API_URL } from 'CommonUI/src/Config';
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
                title={`Incoming Request Link`}
                description={
                    <span>
                        Please send inbound heartbeat requests to this URL{' '}
                        <Link
                            openInNewTab={true}
                            to={URL.fromString(
                                `${PROBE_API_URL.toString()}/${props.modelId}`
                            )}
                        >
                            <span>{`${PROBE_API_URL.toString()}/${
                                props.modelId
                            }`}</span>
                        </Link>
                    </span>
                }
            />
        </>
    );
};

export default IncomingMonitorLink;
