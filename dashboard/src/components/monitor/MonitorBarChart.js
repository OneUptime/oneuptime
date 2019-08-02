import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import BlockChart from '../blockchart/BlockChart';
import toPascalCase from 'to-pascal-case';

export function MonitorBarChart(props) {
    let block = [];
    for (var i = 0; i < 90; i++) {
        if (props.monitor && props.monitor.time && i < props.monitor.time.length) {
            block.unshift(<BlockChart time={props.monitor.time[i]} key={i} id={i} />);
        } else {
            block.unshift(<BlockChart time={false} key={i} emptytime={new Date().setDate(new Date().getDate(props.monitor.time && props.monitor.time[0] && props.monitor.time[0].date ? props.monitor.time[0].date : new Date()) - i)} id={i} />);
        }
    }
    let chart =  <div className="db-Trends-content"><span><div className="db-TrendsRows"><span><div className="db-Trend"><span></span>
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Gross volume">
                                    <div className="db-Trend-title"><span className="chart-font">Response Time</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{props.monitor.responseTime ? props.monitor.responseTime.toString().split('.')[0] : '0'} ms</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Gross volume">
                                    <div className="db-Trend-title"><span className="chart-font">Monitor Status</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{props.monitor.status && props.monitor.time && props.monitor.time[0] && (props.monitor.time[0].downTime || props.monitor.time[0].upTime) ? toPascalCase(props.monitor.status) : 'Online'}</span></span></div>
                                </div>
                            </div>
                            <div className="db-Trend-colInformation">
                                <div className="db-Trend-rowTitle" title="Gross volume">
                                    <div className="db-Trend-title"><span className="chart-font">Uptime Stats</span></div>
                                </div>
                                <div className="db-Trend-row">
                                    <div className="db-Trend-col db-Trend-colValue"><span> <span className="chart-font">{(props.monitor.uptimePercent || (props.monitor.uptimePercent !== undefined && props.monitor.uptimePercent !== null)) && props.monitor.time && props.monitor.time[0] && (props.monitor.time[0].downTime || props.monitor.time[0].upTime) ? props.monitor.uptimePercent.toString().split('.')[0] : '100'} %</span></span></div>
                                </div>
                            </div>
                            <div className="block-chart-main">
                                <div className="block-chart">
                                    {block}
                                </div>
                            </div>

                        </div></span>
                        </div>
                        </span>
                        </div>

    return chart;
}

MonitorBarChart.displayName = 'MonitorBarChart'

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch)

const mapStateToProps = () => (
    {
    }
)

export default connect(mapStateToProps, mapDispatchToProps)(MonitorBarChart);