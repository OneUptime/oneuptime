import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Badge from '../common/Badge';
import StatusIndicator from './StatusIndicator';
import moment from 'moment';

export class MonitorTitle extends Component {
    constructor(props) {
        super(props);

        this.state = {
            now: Date.now(),
            nowHandler: null,
        };
    }

    componentDidMount() {
        this.setLastAlive();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.probes !== this.props.probes) {
            if (this.state.nowHandler) {
                clearTimeout(this.state.nowHandler);
            }

            this.setLastAlive();
        }
    }

    setLastAlive = () => {
        this.setState({ now: Date.now() });

        const nowHandler = setTimeout(() => {
            this.setState({ now: Date.now() });
        }, 300000);

        this.setState({ nowHandler });
    };

    replaceDashWithSpace = string => {
        return string.replace('-', ' ');
    };

    componentWillUnmount() {
        if (this.state.nowHandler) {
            clearTimeout(this.state.nowHandler);
        }
    }

    render() {
        const { monitor, status, activeProbe, probes } = this.props;

        const probe =
            monitor && probes && probes.length > 0
                ? probes[probes.length < 2 ? 0 : activeProbe]
                : null;
        const lastAlive = probe && probe.lastAlive ? probe.lastAlive : null;

        const url =
            monitor && monitor.data && monitor.data.url
                ? monitor.data.url
                : null;

        let badgeColor;
        switch (monitor.type) {
            case 'manual':
                badgeColor = 'red';
                break;
            case 'device':
                badgeColor = 'green';
                break;
            default:
                badgeColor = 'blue';
                break;
        }

        const isCurrentlyNotMonitoring =
            (lastAlive &&
                moment(this.state.now).diff(moment(lastAlive), 'seconds') >=
                    300) ||
            !lastAlive;

        return (
            <div className="db-Trends-title">
                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span
                                id="monitor-content-header"
                                className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                            >
                                <StatusIndicator status={status} />
                                <span id={`monitor-title-${monitor.name}`}>
                                    {monitor.name}
                                </span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {url && (
                                    <span>
                                        Currently{' '}
                                        {isCurrentlyNotMonitoring && 'Not'}{' '}
                                        Monitoring &nbsp;
                                        <a href={url}>{url}</a>
                                    </span>
                                )}
                                {monitor.type === 'manual' &&
                                    monitor.data &&
                                    monitor.data.description &&
                                    monitor.data.description !== '' && (
                                        <span>
                                            Description:{' '}
                                            {monitor.data.description}
                                        </span>
                                    )}
                            </span>
                        </div>
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                <Badge color={badgeColor}>
                                    {this.replaceDashWithSpace(monitor.type)}
                                </Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

MonitorTitle.displayName = 'MonitorTitle';

MonitorTitle.propTypes = {
    monitor: PropTypes.object.isRequired,
    status: PropTypes.string,
    activeProbe: PropTypes.number,
    probes: PropTypes.array,
};

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

const mapStateToProps = state => {
    return {
        activeProbe: state.monitor.activeProbe,
        probes: state.probe.probes.data,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorTitle);
