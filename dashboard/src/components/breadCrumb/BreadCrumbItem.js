import React from 'react';
import { BreadcrumbsItem } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';
import { history } from '../../store';

function BreadCrumbItem({ route, name, projectId }) {
    const id = name ? name.split(' ').join('') : '';

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
};

export default BreadCrumbItem;
