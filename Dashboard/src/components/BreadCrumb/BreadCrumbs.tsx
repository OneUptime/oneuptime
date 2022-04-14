import React, { useState } from 'react';
import { connect } from 'react-redux';

import { CrumbItem, Breadcrumbs } from 'react-breadcrumbs-dynamic';

import { PropTypes } from 'prop-types';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { bindActionCreators, Dispatch } from 'redux';
import { closeIncident } from '../../actions/incident';

interface BreadCrumbsProps {
    styles: string;
    name?: string;
    closeIncidentRequest?: object;
    incidents?: unknown[];
    closeIncident?: Function;
    currentProjectId?: string;
}

function BreadCrumbs({
    styles,
    name,
    closeIncidentRequest,
    incidents,
    currentProjectId,
    closeIncident
}: BreadCrumbsProps) {
    const [loading, setLoading]: $TSFixMe = useState(true);

    const close = async (): $TSFixMe => {
        const projectId: $TSFixMe = currentProjectId;
        for (const incident of incidents) {
            if (incident.resolved) {
                closeIncident(projectId, incident._id);
            }
        }
    };

    const closeAllIncidents = async (): $TSFixMe => {
        await close();
        setLoading(false);
    };

    const deleteBtnStyle: $TSFixMe =
        ' Flex-flex Flex-justifyContent--spaceBetween Flex-alignItems--center mobile-flex-direction-breadcrumb';

    const showDeleteBtn = incidents.some((incident: $TSFixMe) => incident.resolved);

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

            {loading && showDeleteBtn && name === 'Home' && (
                <div
                    id="incidents-close-all-btn"
                    style={{ height: 'fit-content' }}
                    onClick={closeAllIncidents}
                    className="bs-Button"
                >
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        <div
                            className=" bs-ticks "
                            style={{ marginTop: '0' }}
                        ></div>
                        Close all Resolved Incidents
                        <span style={{ marginLeft: '5px' }}></span>
                    </span>
                </div>
            )}

            <ShouldRender if={closeIncidentRequest.requesting !== false}>
                <Spinner
                    style={{
                        stroke: '#000000',
                    }}
                />
            </ShouldRender>
        </div>
    );
}

BreadCrumbs.displayName = 'BreadCrumbs';
const mapStateToProps: Function = (state: RootState) => {
    const currentProjectId: $TSFixMe =
        state.project.currentProject && state.project.currentProject._id;
    return {
        closeIncidentRequest: state.incident.closeincident,
        incidents: state.incident.unresolvedincidents.incidents,
        currentProjectId,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        {
            closeIncident,
        },
        dispatch
    );
};
BreadCrumbs.propTypes = {
    styles: PropTypes.string.isRequired,
    name: PropTypes.string,
    closeIncidentRequest: PropTypes.object,
    incidents: PropTypes.array,
    closeIncident: PropTypes.func,
    currentProjectId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(BreadCrumbs);
