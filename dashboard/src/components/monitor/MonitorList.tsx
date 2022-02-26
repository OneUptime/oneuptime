import React, { useEffect } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { withRouter } from 'react-router-dom';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject';
import MonitorDetail from './MonitorDetail';
// import sortByName from '../../utils/sortByName';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';
import { updateprobebysocket } from '../../actions/socket';

function MonitorList(props: $TSFixMe) {
    const monitors = props.monitors ? props.monitors : [];
    const skip = props.skip;
    const limit = props.limit;
    const count = props.count;
    const page = props.page;
    const canNext = monitors && count && count > skip + limit ? true : false;
    const canPrev = monitors && skip <= 0 ? false : true;
    const numberOfPages = props.numberOfPage
        ? props.numberOfPage
        : Math.ceil(parseInt(count) / limit);

    let monitorDetails = null;
    if (props.monitors && props.monitors.length > 0) {
        const monitors = props.monitors;
        monitorDetails = monitors.map((monitor: $TSFixMe, i: $TSFixMe) => (
            <div id={`monitor${i}`} key={monitor._id}>
                <RenderIfUserInSubProject
                    subProjectId={monitor.projectId._id || monitor.projectId}
                >
                    <MonitorDetail
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ shouldRenderProjectType: boolean; projectN... Remove this comment to see the full error message
                        shouldRenderProjectType={false}
                        projectName={props.projectName}
                        projectType={props.projectType}
                        componentId={props.componentId}
                        monitor={monitor}
                        index={monitor._id}
                        key={monitor._id}
                    />
                </RenderIfUserInSubProject>
            </div>
        ));
    }

    useEffect(() => {
        // socket.on(`updateProbe`, function(data) {
        //     props.updateprobebysocket(data);
        // });
        // return () => {
        //     socket.removeListener(`updateProbe`);
        // };
    }, []);

    return (
        <div>
            {monitorDetails}

            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            <div className="Box-root Card-shadow--medium" tabIndex="0">
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span
                                    id={`incident_count`}
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                >
                                    <ShouldRender if={numberOfPages > 0}>
                                        Page {page ? page : 1} of{' '}
                                        {numberOfPages} (
                                        <ShouldRender if={monitors}>
                                            <span id="numberOfMonitors">
                                                {count}
                                            </span>{' '}
                                            {count > 1
                                                ? 'total monitors'
                                                : 'Monitor'}{' '}
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
                                    <ShouldRender if={!(numberOfPages > 0)}>
                                        <span id="numberOfMonitors">
                                            {count}{' '}
                                            {count > 1
                                                ? 'total monitors'
                                                : 'Monitor'}
                                        </span>
                                    </ShouldRender>
                                </span>
                            </span>
                        </span>
                    </div>
                    {props.requestingNextPage ? <ListLoader /> : null}
                    {props.error ? (
                        <div
                            style={{
                                color: 'red',
                            }}
                        >
                            {props.error}
                        </div>
                    ) : null}
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    onClick={() =>
                                        props.prevClicked(
                                            props.projectId,
                                            skip,
                                            limit
                                        )
                                    }
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canPrev ? '' : 'Is--disabled')
                                    }
                                    disabled={!canPrev}
                                    data-db-analytics-name="list_view.pagination.previous"
                                    type="button"
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Previous</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                            <div className="Box-root">
                                <button
                                    id="btnNext"
                                    onClick={() =>
                                        props.nextClicked(
                                            props.projectId,
                                            skip,
                                            limit
                                        )
                                    }
                                    className={
                                        'Button bs-ButtonLegacy' +
                                        (canNext ? '' : 'Is--disabled')
                                    }
                                    disabled={!canNext}
                                    data-db-analytics-name="list_view.pagination.next"
                                    type="button"
                                >
                                    <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                        <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                            <span>Next</span>
                                        </span>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

MonitorList.displayName = 'MonitorList';

MonitorList.propTypes = {
    monitors: PropTypes.array,
    skip: PropTypes.number,
    limit: PropTypes.number,
    count: PropTypes.number,
    // shouldRenderProjectType: PropTypes.bool,
    projectId: PropTypes.string,
    projectName: PropTypes.string,
    projectType: PropTypes.string,
    numberOfPage: PropTypes.number,
    page: PropTypes.number,
    nextClicked: PropTypes.func,
    prevClicked: PropTypes.func,
    requestingNextPage: PropTypes.bool,
    error: PropTypes.string,
    componentId: PropTypes.string,
    // updateprobebysocket: PropTypes.func,
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ updateprobebysocket }, dispatch);

const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const { componentSlug } = ownProps.match.params;

    return {
        currentProject: state.project.currentProject,
        componentSlug,
    };
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(MonitorList)
);
