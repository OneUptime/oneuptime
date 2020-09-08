import React from 'react';
import { CrumbItem, Breadcrumbs } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';

function BreadCrumbs({ styles }) {
    return (
        <div className={styles}>
            <div
                id="page-title-wrapper"
                className="page-title-wrapper Flex-flex Flex-direction--row"
            >
                <span id="titleIcon" className="page-title-icon" />
                <span id="titleText" className="page-title-text">
                    Page Title
                </span>
                <span className="Flex-flex--1 Text-align--right">
                    <span
                        className="Badge Badge--color--blue Box-background--blue bg-blue-700 Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 Margin-left--4"
                        id="typeContainer"
                    >
                        <span
                            className="Badge-text bg-blue-700 Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap Text-color--white"
                            id="resourceType"
                        >
                            URL
                        </span>
                    </span>
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
