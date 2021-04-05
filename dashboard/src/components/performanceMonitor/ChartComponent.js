import PropTypes from 'prop-types';
import React, { Component, Fragment } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { setStartDate, setEndDate } from '../../actions/performanceMonitoring';
import PerformanceChart from '../basic/performanceChart';
import DateTimeRangePicker from '../basic/DateTimeRangePicker';
import moment from 'moment';
//import ShouldRender from '../../components/basic/ShouldRender';

export class ChartComponent extends Component {
    render() {
        const {
            heading,
            title,
            subHeading,
            startDate,
            endDate,
            setStartDate,
            setEndDate,
        } = this.props;
        const status = {
            display: 'inline-block',
            borderRadius: '2px',
            height: '8px',
            width: '8px',
            margin: '0 8px 1px 0',
            backgroundColor: 'rgb(117, 211, 128)',
        };
        return (
            <div className="Box-root Margin-bottom--12">
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>{heading}</span>
                                </span>
                                <p>
                                    <span>{subHeading}</span>
                                </p>
                                <div
                                    className="db-Trends-controls"
                                    style={{ marginTop: '15px' }}
                                >
                                    <div className="db-Trends-timeControls">
                                        <DateTimeRangePicker
                                            currentDateRange={{
                                                startDate,
                                                endDate,
                                            }}
                                            handleStartDateTimeChange={val =>
                                                setStartDate(moment(val))
                                            }
                                            handleEndDateTimeChange={val =>
                                                setEndDate(moment(val))
                                            }
                                            formId={`performanceMonitoringDateTime-${heading}`}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="db-ListViewItem-cellContent Box-root">
                                <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <div className="Box-root Margin-right--16">
                                        <span className="Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--dark">
                                            <span>1.5 ms</span>
                                        </span>
                                    </div>
                                </span>
                                <div className="Box-root Flex">
                                    <div className="Box-root Flex-flex">
                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center">
                                                <span className="Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--dark">
                                                    <span>App Server</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div
                            className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-vertical--2"
                            style={{ boxShadow: 'none' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                    <div
                                        style={{
                                            margin: '30px 20px 10px 20px',
                                        }}
                                    >
                                        <PerformanceChart
                                            type={`url`}
                                            data={[
                                                {
                                                    createdAt:
                                                        '2020-11-05T07:40:57.765+00:00',
                                                    value: 50,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-06T07:40:57.765+00:00',
                                                    value: 10,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-07T07:40:57.765+00:00',
                                                    value: 100,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-08T07:40:57.765+00:00',
                                                    value: 80,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-09T07:40:57.765+00:00',
                                                    value: 58,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-09T08:40:57.765+00:00',
                                                    value: 70,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-09T09:40:57.765+00:00',
                                                    value: 25,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-09T10:40:57.765+00:00',
                                                    value: 40,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-10T07:40:57.765+00:00',
                                                    value: 39,
                                                },
                                                {
                                                    createdAt:
                                                        '2020-11-11T07:40:57.765+00:00',
                                                    value: 68,
                                                },
                                            ]}
                                            name={'response time'}
                                            symbol="ms"
                                            requesting={false}
                                        />
                                    </div>
                                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20">
                                        <div className="Box-root">
                                            {title.map((t, i) => (
                                                <Fragment key={i}>
                                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                                        <span
                                                            style={status}
                                                        ></span>
                                                        <span>{t}</span>
                                                    </span>
                                                    <span>
                                                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                                                    </span>
                                                </Fragment>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <div className="bs-Tail-copy">
                                <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                                    <div style={{ height: '20px' }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ChartComponent.displayName = 'ChartComponent';

ChartComponent.propTypes = {
    endDate: PropTypes.any,
    heading: PropTypes.any,
    setEndDate: PropTypes.any,
    setStartDate: PropTypes.any,
    startDate: PropTypes.any,
    subHeading: PropTypes.any,
    title: PropTypes.shape({
        map: PropTypes.func,
    }),
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ setStartDate, setEndDate }, dispatch);

function mapStateToProps(state) {
    return {
        currentProject: state.project.currentProject,
        startDate: state.performanceMonitoring.dates.startDate,
        endDate: state.performanceMonitoring.dates.endDate,
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(ChartComponent);
