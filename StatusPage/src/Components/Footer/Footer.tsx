import React, { FunctionComponent, ReactElement } from 'react';
import Footer from 'CommonUI/src/Components/Footer/Footer';
import URL from 'Common/Types/API/URL';
import Link from 'Common/Types/Link';

export interface ComponentProps {
    copyright?: string | undefined;
    links: Array<Link>;
    className?: string | undefined;
    hidePoweredByOneUptimeBranding?: boolean | undefined;
}

const StatusPageFooter: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const links: Array<Link> = [...props.links];

    if (!props.hidePoweredByOneUptimeBranding) {
        links.push({
            title: 'Powered by OneUptime',
            to: URL.fromString('https://oneuptime.com'),
            openInNewTab: true,
        });
    }

    return (
        <Footer
            className={props.className}
            copyright={props.copyright}
            links={links}
        />
    );
};

export default StatusPageFooter;
