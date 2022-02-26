import React, { Component } from 'react';
import { connect } from 'react-redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import PropTypes from 'prop-types';
import APISettings from '../components/settings/APISettings';
import TutorialBox from '../components/tutorial/TutorialBox';
import RenderIfOwner from '../components/basic/RenderIfOwner';
import RenderIfSubProjectMember from '../components/basic/RenderIfSubProjectMember';
class OneUptimeApi extends Component {
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
                    route={getParentRoute(pathname)}
                    name="Project Settings"
                />
                <BreadCrumbItem route={pathname} name="API" />
                <div id="oneuptimeApi" className="db-BackboneViewContainer">
                    <div className="react-settings-view react-view">
                        <RenderIfOwner>
                            // @ts-expect-error ts-migrate(2741) FIXME: Property 'currentProjectId' is missing in type '{ ... Remove this comment to see the full error message
                            <TutorialBox type="api" />
                            <APISettings />
                        </RenderIfOwner>
                        <RenderIfSubProjectMember>
                            <div className="Box-root ">
                                <div className="db-Trends bs-ContentSection Card-root Card-shadow--small">
                                    <div className="Box-root Card-shadow--medium Border-radius--4">
                                        <div
                                            className="bs-ContentSection-content Box-root Padding-horizontal--20 Padding-vertical--12"
                                            style={{
                                                paddingBottom: '100px',
                                                paddingTop: '100px',
                                            }}
                                        >
                                            <div
                                                className="db-SideNav-icon db-SideNav-icon--blocked"
                                                style={{
                                                    backgroundRepeat:
                                                        'no-repeat',
                                                    backgroundSize: 'contain',
                                                    backgroundPosition:
                                                        'center',
                                                    height: '40px',
                                                    width: '40px',
                                                    marginRight: '50%',
                                                    marginLeft: '50%',
                                                }}
                                            />
                                            <div
                                                id="errorMessage"
                                                style={{
                                                    width: '100%',
                                                    padding: '10px',
                                                    textAlign: 'center',
                                                }}
                                            >
                                                You are not authorized to view
                                                this page because you’re not an
                                                administrator of this project.
                                                <br />
                                                Please contact admin for any
                                                work you need to be done on this
                                                page.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </RenderIfSubProjectMember>
                    </div>
                </div>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
OneUptimeApi.displayName = 'OneUptimeApi';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
OneUptimeApi.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    };
};
export default connect(mapStateToProps)(OneUptimeApi);
