import React from 'react';
import { BreadcrumbsItem } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';
import { history } from '../../store';
import pageTitles from '../../utils/pageTitles';

function BreadCrumbItem({
    route,
    name,
    projectId,
    pageTitle,
    type,
    status,
    containerType,
    icon,
    switchToProjectViewerNav,
}) {
    const id = name ? name.split(' ').join('') : '';
    const pages = pageTitles();

    const onClick = event => {
        event.preventDefault();
        history.push(getRoute(route, projectId));
    };

    const getRoute = (route, projectId) => {
        if (route === '/') {
            if (switchToProjectViewerNav) {
                return `/dashboard/project/${projectId}/status-pages`;
            }
            return `/dashboard/project/${projectId}`;
        }
        return route;
    };

    const titleElement = document.querySelector('#page-title-wrapper');

    if (titleElement) {
        const titleIcon = titleElement.querySelector('#titleIcon');
        const titleText = titleElement.querySelector('#titleText');
        const resourceType = titleElement.querySelector('#resourceType');
        const typeContainer = titleElement.querySelector('#typeContainer');
        titleIcon.setAttribute(
            'class',
            `page-title-icon db-SideNav-icon--${
                icon ? icon : pages[pageTitle ?? name]
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
        titleText.innerHTML = name;
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
            onClick={event => onClick(event)}
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
    pageTitle: PropTypes.string,
    type: PropTypes.string,
    status: PropTypes.string,
    containerType: PropTypes.string,
    icon: PropTypes.string,
    switchToProjectViewerNav: PropTypes.bool,
};

export default BreadCrumbItem;
