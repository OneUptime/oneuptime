import React from 'react';
import { BreadcrumbsItem } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';

function BreadCrumbItem({ route, name }) {
    const id = name.split(' ').join('');
    return (
        <BreadcrumbsItem to={route} {...{ id: `cb${id}` }}>
            {name}
        </BreadcrumbsItem>
    );
}

BreadCrumbItem.displayName = 'BreadCrumbItem';

BreadCrumbItem.propTypes = {
    route: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
};

export default BreadCrumbItem;
