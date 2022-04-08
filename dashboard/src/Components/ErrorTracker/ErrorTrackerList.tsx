import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ErrorTrackerDetail from './ErrorTrackerDetail';
import ShouldRender from '../basic/ShouldRender';
import { ListLoader } from '../basic/Loader';

interface ErrorTrackerListProps {
    projectId?: string;
    errorTrackers?: unknown[];
    componentId?: string;
    prevClicked?: Function;
    nextClicked?: Function;
    error?: string;
    skip?: number;
    limit?: number;
    page?: number;
    count?: number;
    numberOfPage?: number;
    fetchingPage?: boolean;
    showComponentWithIssue?: boolean;
}

export const ErrorTrackerList = (props: ErrorTrackerListProps) => {
    const errorTrackers = props.errorTrackers || [];
    let errorTrackerDetails = null;
    const skip = props.skip;
    const limit = props.limit;
    const count = props.count;
    const page = props.page;
    const canNext =
        errorTrackers && count && count > skip + limit ? true : false;
    const canPrev = errorTrackers && skip <= 0 ? false : true;
    const numberOfPages = props.numberOfPage
        ? props.numberOfPage
        : Math.ceil(parseInt(count) / limit);

    if (props.errorTrackers && props.errorTrackers.length > 0) {
        errorTrackerDetails = props.errorTrackers.map((errorTracker: $TSFixMe, i: $TSFixMe) => (
            <div id={`errorTracker${i}`} key={errorTracker._id}>
                <ErrorTrackerDetail
                    componentId={errorTracker.componentId._id}
                    componentSlug={errorTracker.componentId.slug}
                    index={errorTracker._id}
                    key={errorTracker._id}
                    showComponentWithIssue={props.showComponentWithIssue}
                />
            </div>
        ));
    }

    return (
        <div>
            {errorTrackerDetails}


            <div className="Box-root Card-shadow--medium" tabIndex="0">
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span
                                    id={`errortracker_count`}
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                >
                                    <ShouldRender if={numberOfPages > 0}>
                                        Page {page ? page : 1} of{' '}
                                        {numberOfPages} (
                                        <ShouldRender if={errorTrackers}>
                                            <span id="numberOfErrorTrackers">
                                                {count}
                                            </span>{' '}
                                            {count > 1
                                                ? 'total error trackers'
                                                : 'Error tracker'}{' '}
                                        </ShouldRender>
                                        )
                                    </ShouldRender>
                                    <ShouldRender if={!(numberOfPages > 0)}>
                                        <span id="numberOfErrorTrackers">
                                            {count}{' '}
                                            {count > 1
                                                ? 'total error trackers'
                                                : 'Error tracker'}
                                        </span>
                                    </ShouldRender>
                                </span>
                            </span>
                        </span>
                    </div>
                    {props.fetchingPage ? <ListLoader /> : null}
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
                                            props.componentId,
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
                                            props.componentId,
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

ErrorTrackerList.displayName = 'ErrorTrackerList';

ErrorTrackerList.propTypes = {
    projectId: PropTypes.string,
    errorTrackers: PropTypes.array,
    componentId: PropTypes.string,
    prevClicked: PropTypes.func,
    nextClicked: PropTypes.func,
    error: PropTypes.string,
    skip: PropTypes.number,
    limit: PropTypes.number,
    page: PropTypes.number,
    count: PropTypes.number,
    numberOfPage: PropTypes.number,
    fetchingPage: PropTypes.bool,
    showComponentWithIssue: PropTypes.bool,
};

const mapStateToProps = (state: RootState) => ({
    currentProject: state.project.currentProject
});

export default connect(mapStateToProps)(ErrorTrackerList);
