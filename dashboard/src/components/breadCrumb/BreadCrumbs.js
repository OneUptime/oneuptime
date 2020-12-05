import React, { useState } from 'react';
import { CrumbItem, Breadcrumbs } from 'react-breadcrumbs-dynamic';
import { PropTypes } from 'prop-types';
import { Spinner } from '../basic/Loader';

function BreadCrumbs({ styles, showDeleteBtn, close, name }) {
    const [loading, setLoading] = useState(false);
    const closeAllIncidents = async () => {
        setLoading(true);
        await close();
        setLoading(false);
    };
    const deleteBtnStyle =
        ' Flex-flex Flex-justifyContent--spaceBetween Flex-alignItems--center mobile-flex-direction-breadcrumb';
    return (
        <div
            id="breadcrumb-wrap"
            className={name === 'Home' ? styles + deleteBtnStyle : styles}
        >
            <div>
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
            {showDeleteBtn && name === 'Home' && (
                <div
                    id="incidents-close-all-btn"
                    style={{ height: 'fit-content' }}
                    onClick={closeAllIncidents}
                    className="bs-Button"
                >
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        Close all Resolved Incidents
                        <span style={{ marginLeft: '5px' }}>
                            {loading && (
                                <Spinner
                                    style={{
                                        stroke: '#000000',
                                    }}
                                />
                            )}
                        </span>
                    </span>
                </div>
            )}
        </div>
    );
}

BreadCrumbs.displayName = 'BreadCrumbs';

BreadCrumbs.propTypes = {
    styles: PropTypes.string.isRequired,
    showDeleteBtn: PropTypes.bool,
    close: PropTypes.func,
    name: PropTypes.string,
};

export default BreadCrumbs;
