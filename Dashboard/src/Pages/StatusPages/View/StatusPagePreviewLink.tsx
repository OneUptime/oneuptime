import URL from 'Common/Types/API/URL';
import ObjectID from 'Common/Types/ObjectID';
import Card from 'CommonUI/src/Components/Card/Card';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Link from 'CommonUI/src/Components/Link/Link';
import { STATUS_PAGE_URL } from 'CommonUI/src/Config';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    modelId: ObjectID;
}

const StatusPagePreviewLink: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            <Card
                title={`Status Page Preview URL`}
                icon={IconProp.ExternalLink}
                description={
                    <span>
                        Here&apos;s a link to preview your status page:{' '}
                        <Link
                            openInNewTab={true}
                            to={URL.fromString(
                                `${STATUS_PAGE_URL.toString()}/${props.modelId}`
                            )}
                        >
                            <span>{`${STATUS_PAGE_URL.toString()}/${
                                props.modelId
                            }`}</span>
                        </Link>
                    </span>
                }
            />
        </>
    );
};

export default StatusPagePreviewLink;
