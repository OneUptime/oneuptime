import React, { useState, useEffect } from 'react';

import { BreadcrumbsItem } from 'react-breadcrumbs-dynamic';

import { PropTypes } from 'prop-types';
import { history, RootState } from '../../store';
import pageTitles from '../../utils/pageTitles';

interface BreadCrumbItemProps {
    route: string;
    name: string;
    projectId?: string;
    slug?: string;
    pageTitle?: string;
    type?: string;
    status?: string;
    containerType?: string;
    icon?: string;
    // addBtn: PropTypes.bool,
    btnText?: string;
    toggleForm?: Function;
}

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
}: BreadCrumbItemProps) {
    const id = name ? name.split(' ').join('') : '';
    const pages = pageTitles();

    const onClick: Function = (event: $TSFixMe) => {
        event.preventDefault();

        history.push(getRoute(route, projectId));
    };

    const getRoute: Function = (route: $TSFixMe) => {
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

            btn.classList = 'bs-Button bs-ButtonLegacy ActionIconParent';
            btn.addEventListener('click', toggleForm);

            const span = document.createElement('span');

            span.classList =
                'bs-FileUploadButton bs-Button--icon bs-Button--new';
            span.innerHTML = btnText;
            btn.appendChild(span);

            wrapContainer.appendChild(btn);

            wrapContainer.style.display = 'flex';

            wrapContainer.style.alignItems = 'center';

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

        titleElement.parentElement.style.width = '100%';

        const titleIcon = titleElement.querySelector('#titleIcon');
        const titleText = titleElement.querySelector('#titleText');
        const resourceType = titleElement.querySelector('#resourceType');
        const typeContainer = titleElement.querySelector('#typeContainer');

        titleIcon.setAttribute(
            'class',
            `page-title-icon db-SideNav-icon--${icon ? icon : pages[pageTitle || name]
            } db-SideNav-icon--selected`
        );
        if (!type && !status && !containerType) {

            typeContainer.setAttribute('class', 'display-none');
        } else {

            typeContainer.setAttribute(
                'class',
                'Badge Badge--color--blue Box-background--blue bg-blue-700 Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 Margin-left--4'
            );
        }

        titleText.innerHTML = pageTitle || name;

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
