import React, { useState, useEffect } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { BreadcrumbsItem } from 'react-breadcrumbs-dynamic';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
import { history } from '../../store';
import pageTitles from '../../utils/pageTitles';

function BreadCrumbItem({
    route,
    name,
    projectId,
    slug,
    pageTitle,
    type,
    status,
    containerType,
    icon,
    btnText,
    toggleForm
}: $TSFixMe) {
    const id = name ? name.split(' ').join('') : '';
    const pages = pageTitles();

    const onClick = (event: $TSFixMe) => {
        event.preventDefault();
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 2.
        history.push(getRoute(route, projectId));
    };

    const getRoute = (route: $TSFixMe) => {
        if (route === '/') {
            return `/dashboard/project/${slug}`;
        }
        return route;
    };

    const titleElement = document.querySelector('#page-title-wrapper');

    const [isShowing, setIsShowing] = useState(false);
    // if(addBtn && !isShowing){}
    if (!isShowing) {
        const wrapContainer = document.querySelector('#breadcrumb-wrap');

        if (wrapContainer && btnText) {
            // setup button and hook it to the node
            const btn = document.createElement('button');
            btn.id = 'newFormId';
            btn.type = 'button';
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'classList' because it is a read-... Remove this comment to see the full error message
            btn.classList = 'bs-Button bs-ButtonLegacy ActionIconParent';
            btn.addEventListener('click', toggleForm);

            const span = document.createElement('span');
            // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'classList' because it is a read-... Remove this comment to see the full error message
            span.classList =
                'bs-FileUploadButton bs-Button--icon bs-Button--new';
            span.innerHTML = btnText;
            btn.appendChild(span);

            wrapContainer.appendChild(btn);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'style' does not exist on type 'Element'.
            wrapContainer.style.display = 'flex';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'style' does not exist on type 'Element'.
            wrapContainer.style.alignItems = 'center';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'style' does not exist on type 'Element'.
            wrapContainer.style.justifyContent = 'space-between';

            setIsShowing(true);
        }
    }

    useEffect(
        () => () => {
            // cleanup
            if (isShowing) {
                const wrapContainer = document.querySelector(
                    '#breadcrumb-wrap'
                );
                const btn = document.querySelector('#newFormId');
                if (wrapContainer && btn) {
                    btn.removeEventListener('click', toggleForm);
                    wrapContainer.removeChild(btn);
                }
            }
        },
        [isShowing]
    );

    if (titleElement) {
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        titleElement.parentElement.style.width = '100%';

        const titleIcon = titleElement.querySelector('#titleIcon');
        const titleText = titleElement.querySelector('#titleText');
        const resourceType = titleElement.querySelector('#resourceType');
        const typeContainer = titleElement.querySelector('#typeContainer');
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        titleIcon.setAttribute(
            'class',
            `page-title-icon db-SideNav-icon--${
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                icon ? icon : pages[pageTitle || name]
            } db-SideNav-icon--selected`
        );
        if (!type && !status && !containerType) {
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            typeContainer.setAttribute('class', 'display-none');
        } else {
            // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
            typeContainer.setAttribute(
                'class',
                'Badge Badge--color--blue Box-background--blue bg-blue-700 Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 Margin-left--4'
            );
        }
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        titleText.innerHTML = pageTitle || name;
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        resourceType.innerHTML = type
            ? type === 'server-monitor'
                ? 'Server Monitor'
                : type === 'incomingHttpRequest'
                ? 'incoming Http Request Monitor'
                : type + ' Monitor'
            : status
            ? ' Status Page'
            : containerType
            ? containerType
            : null;
    }

    return (
        <BreadcrumbsItem
            to={route}
            {...{ id: `cb${id}` }}
            onClick={(event: $TSFixMe) => onClick(event)}
        >
            {name}
        </BreadcrumbsItem>
    );
}

BreadCrumbItem.displayName = 'BreadCrumbItem';

BreadCrumbItem.propTypes = {
    route: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    projectId: PropTypes.string,
    slug: PropTypes.string,
    pageTitle: PropTypes.string,
    type: PropTypes.string,
    status: PropTypes.string,
    containerType: PropTypes.string,
    icon: PropTypes.string,
    // addBtn: PropTypes.bool,
    btnText: PropTypes.string,
    toggleForm: PropTypes.func,
};

export default BreadCrumbItem;
