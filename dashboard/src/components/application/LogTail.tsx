import React, { Component, useState } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { ArrowDown, ArrowRight, CopyIcon, DocumentIcon } from '../svg';
import { connect } from 'react-redux';
import moment from 'moment';
import ReactJson from 'react-json-view';
import copyToClipboard from '../../utils/copyToClipboard';
import { bindActionCreators } from 'redux';
import { getLogSuccess } from '../../actions/applicationLog';
import { socket } from '../basic/Socket';

class LogTail extends Component {
    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLogId' does not exist on type... Remove this comment to see the full error message
        socket.removeListener(`createLog-${this.props.applicationLogId}`);
    }
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLogId' does not exist on type... Remove this comment to see the full error message
        if (this.props.applicationLogId) {
            // join application log room
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLogId' does not exist on type... Remove this comment to see the full error message
            socket.emit('application_log_switch', this.props.applicationLogId);

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationLogId' does not exist on type... Remove this comment to see the full error message
            socket.on(`createLog-${this.props.applicationLogId}`, (data: $TSFixMe) => {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'getLogSuccess' does not exist on type 'R... Remove this comment to see the full error message
                this.props.getLogSuccess(data);
            });
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'logs' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { logs, applicationLog } = this.props;
        const firstItem = logs?.logs[0];
        const newDate = firstItem?.createdAt;
        const logName = applicationLog.name;
        const items = [
            {
                type: logName,
                createdAt: newDate,
                stringifiedContent: '',
            },
            {
                type: logName,
                createdAt: newDate,
                stringifiedContent: `----------------------`,
            },
            {
                type: logName,
                createdAt: newDate,
                stringifiedContent: `Welcome to ${logName} logs`,
            },
            {
                type: logName,
                createdAt: newDate,
                stringifiedContent: `----------------------`,
            },
            {
                type: logName,
                createdAt: newDate,
                stringifiedContent: '',
            },
        ];
        const noItem = {
            type: logName,
            createdAt: newDate,
            stringifiedContent: `You've no logs yet`,
        };

        return (
            <div className="bs-loglist">
                {logs && logs.requesting ? (
                    <div className="log-requesting">
                        <div>
                            <div>
                                <DocumentIcon />
                            </div>
                            <div>Loading content...</div>
                        </div>
                    </div>
                ) : (
                    <>
                        <ShouldRender if={logs && logs.error}>
                            <div className="bs-log-error">
                                {logs && logs.error}
                            </div>
                        </ShouldRender>
                        <ShouldRender if={logs && !logs.error}>
                            {items.length > 0 &&
                                items.map((item, index) => (
                                    <>
                                        <LogItem key={index} value={item} />
                                    </>
                                ))}
                            {logs &&
                                logs.logs &&
                                logs.logs.length > 0 &&
                                logs.logs.map((log: $TSFixMe, index: $TSFixMe) => (
                                    <>
                                        <LogItem key={index} value={log} />
                                    </>
                                ))}
                            {logs && logs.logs && logs.logs.length < 1 && (
                                <>
                                    <LogItem value={noItem} />
                                </>
                            )}
                        </ShouldRender>
                    </>
                )}
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
LogTail.displayName = 'LogTail';

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const applicationLogId = props.applicationLog._id;
    const logs = state.applicationLog.logs[applicationLogId];
    return {
        applicationLogId,
        logs,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ getLogSuccess }, dispatch);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
LogTail.propTypes = {
    applicationLogId: PropTypes.string,
    applicationLog: PropTypes.object,
    logs: PropTypes.object,
    getLogSuccess: PropTypes.func,
};

export default connect(mapStateToProps, mapDispatchToProps)(LogTail);

const LogItem = ({
    value
}: $TSFixMe) => {
    const [show, setShow] = useState(false);
    const [hover, setHover] = useState(false);
    const [copy, setCopy] = useState(false);
    let classes = 'bs-rowfull';
    if (show) {
        classes = classes + ' bs-active-row';
    }
    const content =
        typeof value.content === 'object' ? value.content : { message: null };

    const copyHandler = (text: $TSFixMe) => {
        copyToClipboard(text);
        setCopy(true);
    };
    return (
        <div className={classes}>
            <div
                className="bs-logrow"
                onMouseEnter={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
                onClick={() => setShow(!show)}
            >
                <div className="bs-log-line-caret">
                    <ShouldRender if={show}>
                        <ArrowDown />
                    </ShouldRender>
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'false | "bs-hover-null"' is not assignable t... Remove this comment to see the full error message
                    <div className={!show && 'bs-hover-null'}>
                        <ShouldRender if={hover && !show}>
                            <ArrowRight />
                        </ShouldRender>
                    </div>
                </div>
                <div className="bs-log-content">
                    <span className="bs-log-timestamp">
                        {moment(value.createdAt).format(
                            'YYYY-MM-DD HH:mm:ss:mm'
                        )}
                    </span>
                    <span className="bs-flights">{`[${value.type}]`}</span>
                    <span className="bs-log-message">
                        {value.stringifiedContent}
                    </span>
                </div>
            </div>
            <ShouldRender if={show}>
                <div className="bs-list-collapse">
                    <ReactJson
                        src={content}
                        theme="ocean"
                        iconStyle="triangle"
                        name={'content'}
                    />
                    <div className="bs-log-base">
                        <ShouldRender if={!copy}>
                            <span
                                onClick={() =>
                                    copyHandler(JSON.stringify(value.content))
                                }
                            >
                                <div className="bs-list-flex bs-log-cursor">
                                    <CopyIcon />
                                    <span>Copy JSON</span>
                                </div>
                            </span>
                        </ShouldRender>
                        <ShouldRender if={copy}>
                            <span onClick={() => setCopy(false)}>
                                <div className="bs-list-flex">
                                    <span>Copied</span>
                                </div>
                            </span>
                        </ShouldRender>
                    </div>
                </div>
            </ShouldRender>
        </div>
    );
};

LogItem.displayName = 'LogItem';

LogItem.propTypes = {
    value: PropTypes.object,
};
