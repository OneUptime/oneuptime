import React from 'react';
import { CrumbItem, Breadcrumbs } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';

function BreadCrumbs({ styles }) {
    return (
        <div className={styles}>
            <Breadcrumbs
                separator={<span className="db-breadcrumb-seperator" />}
                item={CrumbItem}
                finalProps={{
                    style: {
                        fontWeight: 'bold',
                    },
                }}
                compare={(a, b) => 0}
            />
        </div>
    );
}

BreadCrumbs.displayName = 'BreadCrumbs';

BreadCrumbs.propTypes = {
    styles: PropTypes.string.isRequired,
};

export default BreadCrumbs;
