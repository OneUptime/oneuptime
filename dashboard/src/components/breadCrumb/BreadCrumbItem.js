import React from 'react';
import { BreadcrumbsItem } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';
import { history } from '../../store';
import pageTitles from '../../utils/pageTitles';

function BreadCrumbItem({ route, name, projectId, pageTitle }) {
    const id = name ? name.split(' ').join('') : '';
    const pages = pageTitles();

    const onClick = event => {
        event.preventDefault();
        history.push(getRoute(route, projectId));
    };

    const getRoute = (route, projectId) => {
        if (route === '/') {
            return `/dashboard/project/${projectId}/components`;
        }
        return route;
    };

    const titleElement = document.querySelector('#page-title-wrapper');
    if (titleElement) {
        const titleIcon = titleElement.querySelector('#titleIcon');
        const titleText = titleElement.querySelector('#titleText');
        titleIcon.setAttribute(
            'class',
            `page-title-icon db-SideNav-icon--${
                pages[pageTitle ?? name]
            } db-SideNav-icon--selected`
        );
        titleText.innerHTML = name;
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
};

export default BreadCrumbItem;
