import React from 'react';
import { CrumbItem, Breadcrumbs } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';

function BreadCrumbs({ styles }) {
    return (
        <div className={styles}>
            <div id="page-title-wrapper" className="page-title-wrapper">
                <span id="titleIcon" className="page-title-icon" />
                <span id="titleText" className="page-title-text">
                    Page Title
                </span>
            </div>
            <Breadcrumbs
                separator={<span className="db-breadcrumb-seperator" />}
                item={CrumbItem}
                finalProps={{
                    style: {
                        fontWeight: 'bold',
                    },
                }}
            />
        </div>
    );
}

BreadCrumbs.displayName = 'BreadCrumbs';

BreadCrumbs.propTypes = {
    styles: PropTypes.string.isRequired,
};

export default BreadCrumbs;
