import React from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';

import { Fade } from 'react-awesome-reveal';
import ProbeList from '../components/probe/ProbeList';
import { getProbes } from '../actions/probe';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';

interface ProbeProps {
    getProbes?: Function;
    currentProject?: object;
    switchToProjectViewerNav?: boolean;
    _id?: string;
    probes?: object;
    skip?: number;
    location?: {
        pathname?: string
    };
}

class Probe extends React.Component<ProbeProps> {
    constructor(props: $TSFixMe) {
        super(props);

        this.props = props;
        this.state = { page: 1 };
    }

    componentDidMount() {
        this.ready();
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        if (

            prevProps?.currentProject?._id !== this.props?.currentProject?._id
        ) {
            this.ready();
        }
    }

    ready = () => {

        this.props.getProbes(this.props.currentProject._id, 0, 10); //0 -> skip, 10-> limit.
    };

    prevClicked = () => {

        this.props.getProbes(

            this.props.currentProject._id,

            this.props.probes.skip

                ? parseInt(this.props.probes.skip, 10) - 10
                : 10,
            10
        );

        this.setState({ page: this.state.page > 1 ? this.state.page - 1 : 1 });
    };

    nextClicked = () => {

        this.props.getProbes(

            this.props.currentProject._id,

            this.props.probes.skip

                ? parseInt(this.props.probes.skip, 10) + 10
                : 10,
            10
        );

        this.setState({ page: this.state.page + 1 });
    };

    render() {
        const {

            location: { pathname },

            currentProject,

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

                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem

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

                                                    probesList={

                                                        this.props.probes
                                                    }
                                                    prevClicked={
                                                        this.prevClicked
                                                    }
                                                    nextClicked={
                                                        this.nextClicked
                                                    }

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

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ getProbes }, dispatch);
};


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


Probe.displayName = 'Probe';

export default connect(mapStateToProps, mapDispatchToProps)(Probe);
