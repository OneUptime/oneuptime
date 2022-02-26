import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import ProbeList from '../components/probe/ProbeList';
import { getProbes } from '../actions/probe';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';

class Probe extends React.Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = { page: 1 };
    }

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
    }

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(this.props.currentProject._id, 0, 10); //0 -> skip, 10-> limit.
    };

    prevClicked = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.probes.skip
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
                ? parseInt(this.props.probes.skip, 10) - 10
                : 10,
            10
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject._id,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.probes.skip
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
                ? parseInt(this.props.probes.skip, 10) + 10
                : 10,
            10
        );
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        this.setState({ page: this.state.page + 1 });
    };

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
                <BreadCrumbItem route={pathname} name="Probe" />
                <div className="Box-root Margin-vertical--12">
                    <div>
                        <div>
                            <div
                                id="probeList"
                                className="db-RadarRulesLists-page"
                            >
                                <div className="Box-root Margin-bottom--12">
                                    <div className="bs-ContentSection Card-root Card-shadow--medium">
                                        <div className="Box-root">
                                            <div>
                                                <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Probes
                                                                </span>
                                                            </span>
                                                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                <span>
                                                                    Probes will
                                                                    monitor
                                                                    resources in
                                                                    your project
                                                                    like
                                                                    API&apos;s,
                                                                    Websites and
                                                                    more from
                                                                    different
                                                                    locations
                                                                    around the
                                                                    world.
                                                                </span>
                                                            </span>
                                                        </div>
                                                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                            <div></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <ProbeList
                                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ probesList: any; prevClicked: () => void; ... Remove this comment to see the full error message
                                                    probesList={
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probes' does not exist on type 'Readonly... Remove this comment to see the full error message
                                                        this.props.probes
                                                    }
                                                    prevClicked={
                                                        this.prevClicked
                                                    }
                                                    nextClicked={
                                                        this.nextClicked
                                                    }
                                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Readonly<{... Remove this comment to see the full error message
                                                    page={this.state.page}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Fade>
        );
    }
}

const mapStateToProps = (state: $TSFixMe) => {
    return {
        currentProject: state.project.currentProject,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        probes: state.probe.probes,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ getProbes }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Probe.propTypes = {
    getProbes: PropTypes.func,
    currentProject: PropTypes.object,
    switchToProjectViewerNav: PropTypes.bool,
    _id: PropTypes.string,
    probes: PropTypes.object,
    skip: PropTypes.number,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
Probe.displayName = 'Probe';

export default connect(mapStateToProps, mapDispatchToProps)(Probe);
