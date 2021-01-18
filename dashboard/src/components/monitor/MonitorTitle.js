import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import Badge from '../common/Badge';
import StatusIndicator from './StatusIndicator';
import ShouldRender from '../basic/ShouldRender';
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
        if (string === 'incomingHttpRequest') {
            return 'incoming Http Request';
        }
        return string.replace('-', ' ');
    };

    componentWillUnmount() {
        if (this.state.nowHandler) {
            clearTimeout(this.state.nowHandler);
        }
    }

    render() {
        const {
            monitor,
            status,
            activeProbe,
            probes,
            logs,
            requesting,
        } = this.props;

        const probe =
            monitor && probes && probes.length > 0
                ? probes[probes.length < 2 ? 0 : activeProbe]
                : null;
        const lastAlive = probe && probe.lastAlive ? probe.lastAlive : null;

        const url =
            monitor && monitor.data && monitor.data.url
                ? monitor.data.url
                : monitor && monitor.data && monitor.data.link
                ? monitor.data.link
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
                                className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap"
                            >
                                <StatusIndicator
                                    status={status}
                                    monitorName={monitor.name}
                                />
                                <span id={`monitor-title-${monitor.name}`}>
                                    {monitor.name}
                                </span>
                            </span>
                            <span
                                style={{
                                    fontSize: 12.6,
                                    fontWeight: 500,
                                    color: '#4c4c4c',
                                }}
                            >
                                Monitor ID:{' '}
                                <span id="monitorId">{monitor._id}</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                {monitor.type !== 'incomingHttpRequest' &&
                                url ? (
                                    <span>
                                        Currently{' '}
                                        {isCurrentlyNotMonitoring && 'Not'}{' '}
                                        Monitoring &nbsp;
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {url}
                                        </a>
                                    </span>
                                ) : monitor.type === 'incomingHttpRequest' &&
                                  url ? (
                                    <span>
                                        <a
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {url}
                                        </a>
                                    </span>
                                ) : (
                                    ''
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
                    <ShouldRender
                        if={
                            !requesting &&
                            monitor &&
                            monitor.type &&
                            monitor.type === 'server-monitor' &&
                            (!logs || (logs && logs.length === 0)) &&
                            !monitor.agentlessConfig
                        }
                    >
                        <div className="Card-root">
                            <div
                                className="Box-background--yellow4 Card-shadow--small Border-radius--4 Padding-horizontal--8 Padding-vertical--8"
                                style={{
                                    marginTop: 10,
                                    marginBottom: 10,
                                    display: 'flex',
                                }}
                            >
                                <img
                                    width="17"
                                    style={{
                                        marginRight: 5,
                                        verticalAlign: 'middle',
                                    }}
                                    alt="warning"
                                    src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2ZXJzaW9uPSIxLjEiIGlkPSJDYXBhXzEiIHg9IjBweCIgeT0iMHB4IiB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgc3R5bGU9ImVuYWJsZS1iYWNrZ3JvdW5kOm5ldyAwIDAgNTEyIDUxMjsiIHhtbDpzcGFjZT0icHJlc2VydmUiIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIj48Zz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik00OTkuMDE1LDM0NS40M2wtNzkuNjQ2LTEzNy45NDljLTAuMzExLTAuNTM5LTAuNjY0LTEuMDM3LTEuMDU0LTEuNDk0TDM0Mi40OTQsNzQuNjYgICAgYy04LjQ0Ny0xNi44OTUtMjEuNTY1LTMwLjgzMy0zNy45NTUtNDAuMzE4Yy0xNC43MDktOC41MTctMzEuNDI0LTEzLjAyLTQ4LjMzNy0xMy4wMmMtMzQuNDA5LDAtNjYuNDgxLDE4LjQ3My04My43MDYsNDguMjIgICAgTDkyLjg1MSwyMDcuNDhjLTAuMzEsMC41MzctMC41NjcsMS4wOTctMC43NywxLjY3M2wtNzQuNDYsMTI4Ljk4NEM2LjA5MSwzNTQuNTA5LDAsMzczLjc1OSwwLDM5My44NDMgICAgYzAsNTMuMzk1LDQzLjQ0LDk2LjgzNSw5Ni44MzUsOTYuODM1aDMxOC41NmMwLjczLDAsMS40NDItMC4wNzgsMi4xMjctMC4yMjdjMTYuMjA4LTAuMzQyLDMyLjE3My00LjgxOCw0Ni4yOTctMTIuOTk3ICAgIEM1MDkuOTIyLDQ1MC43NTksNTI1LjcwOCwzOTEuNTI3LDQ5OS4wMTUsMzQ1LjQzeiBNNDUzLjc5Nyw0NjAuMTQ2Yy0xMS42NjUsNi43NTQtMjQuOTAyLDEwLjMyNS0zOC4yODEsMTAuMzI1aC0wLjEwNyAgICBjLTAuNjg0LDAuMDE4LTEuMzY3LDAuMDY5LTIuMDMxLDAuMjA2SDk2LjgzNWMtNDIuMzY2LDAtNzYuODM0LTM0LjQ2OC03Ni44MzQtNzYuODM0YzAtMTYuMDY2LDQuOTA5LTMxLjQ1NiwxNC4xOTctNDQuNTA1ICAgIGMwLjE4NC0wLjI1OCwwLjM1NS0wLjUyNSwwLjUxNC0wLjc5OWw3NS40MjMtMTMwLjY1M2wwLjExNi0wLjE5M2MwLjM0Ny0wLjU4MiwwLjYzMi0xLjE5MiwwLjg1My0xLjgyMkwxODkuODEsNzkuNTUzICAgIGMxMy42NTUtMjMuNTgxLDM5LjA5NC0zOC4yMyw2Ni4zOTEtMzguMjNjMTMuMzk5LDAsMjYuNjQ3LDMuNTcxLDM4LjMxNywxMC4zMjhjMTMuMDY5LDcuNTY0LDIzLjUxMiwxOC42OTMsMzAuMjAxLDMyLjE4NCAgICBjMC4wOTQsMC4xODksMC4xOTMsMC4zNzYsMC4yOTksMC41NTlsNzYuODg3LDEzMy4xNjljMC4zMTEsMC41MzksMC42NjQsMS4wMzcsMS4wNTQsMS40OTRMNDgxLjcsMzU1LjQ0MSAgICBDNTAyLjg3NCwzOTIuMDA3LDQ5MC4zNTYsNDM4Ljk3Nyw0NTMuNzk3LDQ2MC4xNDZ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik0yNTUuOTkyLDEzMy4wNTljLTE5LjQyOCwwLTM1LjIzNCwxNS44MDctMzUuMjM0LDM1LjIzNnYxMDkuMTAxYzAsMTkuNDI5LDE1LjgwNiwzNS4yMzYsMzUuMjM0LDM1LjIzNiAgICBzMzUuMjM0LTE1LjgwNywzNS4yMzQtMzUuMjM2VjE2OC4yOTVDMjkxLjIyNywxNDguODY2LDI3NS40MiwxMzMuMDU5LDI1NS45OTIsMTMzLjA1OXogTTI3MS4yMjYsMjc3LjM5NiAgICBjMCw4LjQtNi44MzMsMTUuMjM1LTE1LjIzMywxNS4yMzVjLTguMzk5LDAtMTUuMjMzLTYuODM0LTE1LjIzMy0xNS4yMzVWMTY4LjI5NWMwLTguNCw2LjgzMy0xNS4yMzUsMTUuMjMzLTE1LjIzNSAgICBjOC4zOTksMCwxNS4yMzMsNi44MzQsMTUuMjMzLDE1LjIzNVYyNzcuMzk2eiIgZGF0YS1vcmlnaW5hbD0iIzAwMDAwMCIgY2xhc3M9ImFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNMjU1Ljk5MiwzMzQuNTU5Yy0xOS40MjgsMC0zNS4yMzQsMTUuODA2LTM1LjIzNCwzNS4yMzRzMTUuODA2LDM1LjIzNCwzNS4yMzQsMzUuMjM0czM1LjIzNC0xNS44MDYsMzUuMjM0LTM1LjIzNCAgICBDMjkxLjIyNywzNTAuMzY2LDI3NS40MiwzMzQuNTU5LDI1NS45OTIsMzM0LjU1OXogTTI1NS45OTIsMzg1LjAyN2MtOC4zOTksMC0xNS4yMzMtNi44MzMtMTUuMjMzLTE1LjIzMyAgICBzNi44MzMtMTUuMjMzLDE1LjIzMy0xNS4yMzNzMTUuMjMzLDYuODMzLDE1LjIzMywxNS4yMzNDMjcxLjIyNiwzNzguMTk0LDI2NC4zOTIsMzg1LjAyNywyNTUuOTkyLDM4NS4wMjd6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48Zz4KCTxnPgoJCTxwYXRoIGQ9Ik04MS4wNDgsMzE4LjI3N2MtNC43ODMtMi43Ni0xMC45LTEuMTIzLTEzLjY2MSwzLjY2MWwtMjAuNTE3LDM1LjU0MWMtMi43NjEsNC43ODMtMS4xMjIsMTAuOSwzLjY2MSwxMy42NjEgICAgYzEuNTc1LDAuOTA5LDMuMjk0LDEuMzQxLDQuOTksMS4zNDFjMy40NTYsMCw2LjgxOC0xLjc5Myw4LjY3LTUuMDAybDIwLjUxNy0zNS41NDFDODcuNDcxLDMyNy4xNTQsODUuODMzLDMyMS4wMzgsODEuMDQ4LDMxOC4yNzcgICAgeiIgZGF0YS1vcmlnaW5hbD0iIzAwMDAwMCIgY2xhc3M9ImFjdGl2ZS1wYXRoIiBzdHlsZT0iZmlsbDojRkZGRkZGIiBkYXRhLW9sZF9jb2xvcj0iIzAwMDAwMCI+PC9wYXRoPgoJPC9nPgo8L2c+PGc+Cgk8Zz4KCQk8cGF0aCBkPSJNOTUuNTI1LDI5My4xODZjLTQuNzg1LTIuNzU3LTEwLjktMS4xMTMtMTMuNjU4LDMuNjcybC0wLjExOCwwLjIwNWMtMi43NTcsNC43ODUtMS4xMTMsMTAuOSwzLjY3MiwxMy42NTggICAgYzEuNTczLDAuOTA2LDMuMjg5LDEuMzM3LDQuOTgzLDEuMzM3YzMuNDU5LDAsNi44MjMtMS43OTcsOC42NzQtNS4wMDlsMC4xMTgtMC4yMDUgICAgQzEwMS45NTYsMzAyLjA1OCwxMDAuMzExLDI5NS45NDMsOTUuNTI1LDI5My4xODZ6IiBkYXRhLW9yaWdpbmFsPSIjMDAwMDAwIiBjbGFzcz0iYWN0aXZlLXBhdGgiIHN0eWxlPSJmaWxsOiNGRkZGRkYiIGRhdGEtb2xkX2NvbG9yPSIjMDAwMDAwIj48L3BhdGg+Cgk8L2c+CjwvZz48L2c+IDwvc3ZnPg=="
                                />
                                <span className="Text-color--white Text-fontSize--14 Text-lineHeight--16">
                                    You need to install an agent on your server,
                                    please{' '}
                                    <a
                                        href="https://www.npmjs.com/package/fyipe-server-monitor"
                                        rel="noopener noreferrer"
                                        target="_blank"
                                        style={{
                                            cursor: 'pointer',
                                            textDecoration: 'underline',
                                            color: 'white',
                                        }}
                                    >
                                        click here
                                    </a>{' '}
                                    for instructions. Your Monitor ID is{' '}
                                    {monitor._id}.
                                </span>
                            </div>
                        </div>
                    </ShouldRender>
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
    logs: PropTypes.array,
    requesting: PropTypes.bool,
};

const mapDispatchToProps = dispatch => bindActionCreators({}, dispatch);

const mapStateToProps = state => {
    return {
        activeProbe: state.monitor.activeProbe,
        probes: state.probe.probes.data,
        requesting: state.monitor.fetchMonitorLogsRequest,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(MonitorTitle);
