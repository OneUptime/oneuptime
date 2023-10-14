import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import Card from 'CommonUI/src/Components/Card/Card';
import Link from 'CommonUI/src/Components/Link/Link';
import IconProp from 'Common/Types/Icon/IconProp';
import { ButtonStyleType } from 'CommonUI/src/Component/Button/Button';
import { HOST, HTTP_PROTOCOL } from 'CommonUI/src/Config';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    modelId: ObjectID;
    monitorKey?: ObjectID;
}

const EmbeddedMonitorKey: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            <Card
                title={`Embedded Monitor Key`}
                description={
                    <span>
                        You can fetch the status of this monitor at any time
                        using this monitor key:{' '}
                        <Link
                            openInNewTab={true}
                            to={new URL(HTTP_PROTOCOL, HOST)
                                .addRoute('/heartbeat')
                                .addRoute(`/${props.modelId.toString()}`)
                                .append('key', props.monitorKey.toString())
                                .toString()}
                        >
                            <span>
                                {new URL(HTTP_PROTOCOL, HOST)
                                    .addRoute('/heartbeat')
                                    .addRoute(`/${props.modelId.toString()}`)
                                    .append('key', props.monitorKey.toString())
                                    .toString()}
                            </span>
                        </Link>
                    </span>
                }
                buttons={[
                    {
                        title: 'Reset Key',
                        buttonStyle: ButtonStyleType.NORMAL,
                        icon: IconProp.Refresh,
                        onClick: () => {
                            
                        }
                    },
                ]}
            />
        </>
    );
};

export default EmbeddedMonitorKey;
