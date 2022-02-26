import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import AceCodeEditor from '../basic/AceCodeEditor';

class ErrorEventStackTrace extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'props' because it is a read-only... Remove this comment to see the full error message
        this.props = props;
        this.state = {
            currentFrameIndex: 0,
        };
    }
    setFrameToDisplay = (index: $TSFixMe) => {
        // if current frame is not the same as the index, set it as the current frame
        // if current frame is the same, remove it to produce the toggle effect
        this.setState(state => ({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentFrameIndex' does not exist on typ... Remove this comment to see the full error message
            currentFrameIndex: state.currentFrameIndex !== index ? index : null,
        }));
    };
    renderCodeSnippet = (frame: $TSFixMe) => {
        let codeSnippet = null;
        const { linesBeforeError, errorLine, linesAfterError } = frame;
        if (linesAfterError && linesBeforeError && errorLine) {
            let codeContent = '\n';
            linesBeforeError.map((line: $TSFixMe) => {
                codeContent += line + '\n';
                return line;
            });
            codeContent += errorLine + '\n';
            linesAfterError.map((line: $TSFixMe) => {
                codeContent += line + '\n';
                return line;
            });
            codeSnippet = (
                <div>
                    <AceCodeEditor
                        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                        value={codeContent}
                        name={`codeContent`}
                        readOnly={true}
                        mode="javascript"
                        height={250}
                        markers={[
                            {
                                startRow: 6,
                                startCol: 0,
                                endRow: 6,
                                endCol: 150,
                                className: 'error-marker',
                                type: 'background',
                            },
                        ]}
                    />
                </div>
            );
        }
        return codeSnippet;
    };
    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorEvent' does not exist on type 'Read... Remove this comment to see the full error message
        const { errorEvent } = this.props;
        const errorEventDetails = errorEvent.errorEvent;
        return (
            <ShouldRender
                if={
                    !errorEvent.requesting &&
                    errorEventDetails &&
                    errorEventDetails.content
                }
            >
                <div className="ContentHeader Box-divider--border-top-1 Box-root Box-background--white Flex-flex Flex-direction--column Padding-vertical--16">
                    <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                        <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                            <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                <span>Exception</span>
                            </span>
                            <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                <span className="Text-fontWeight--medium">
                                    {errorEventDetails &&
                                        errorEventDetails.content &&
                                        errorEventDetails.content.type}
                                    {': '}
                                </span>
                                <span>
                                    {errorEventDetails &&
                                        errorEventDetails.content &&
                                        errorEventDetails.content.message}
                                    .
                                </span>
                            </span>
                        </div>
                    </div>
                    {errorEventDetails &&
                        errorEventDetails.content &&
                        errorEventDetails.content.stacktrace &&
                        errorEventDetails.content.stacktrace.frames && (
                            <div className="Flex-flex Flex-wrap--wrap">
                                <div className="Flex-flex Flex-alignItems--center Margin-right--12 Margin-top--12">
                                    <label
                                        style={{
                                            color: '#4c4c4c',
                                            marginRight: '5px',
                                        }}
                                    >
                                        function
                                    </label>
                                    <div>
                                        <div className="Badge Badge--color--red Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2">
                                            <span className="Badge-text Text-color--red Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                <span>
                                                    {
                                                        errorEventDetails
                                                            .content.stacktrace
                                                            .frames[0]
                                                            .methodName
                                                    }
                                                </span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                    <div className="Stacktrace-Listing">
                        {errorEventDetails &&
                        errorEventDetails.content &&
                        errorEventDetails.content.stacktrace &&
                        errorEventDetails.content.stacktrace.frames &&
                        errorEventDetails.content.stacktrace.frames.length >
                            0 ? (
                            errorEventDetails.content.stacktrace.frames.map(
                                (frame: $TSFixMe, i: $TSFixMe) => {
                                    return (
                                        <div key={i}>
                                            <div
                                                style={{
                                                    cursor: 'pointer',
                                                    padding: '8px 16px',
                                                }}
                                                onClick={() =>
                                                    this.setFrameToDisplay(i)
                                                }
                                            >
                                                <span className="Text-fontWeight--bold">
                                                    {frame.fileName}
                                                    {'  '}
                                                </span>
                                                {'  '}
                                                in{' '}
                                                <span className="Text-fontWeight--bold">
                                                    {frame.methodName}
                                                </span>{' '}
                                                at line{' '}
                                                <span className="Text-fontWeight--bold">
                                                    {`${
                                                        frame.lineNumber
                                                    }:${frame.columnNumber ||
                                                        0}`}
                                                </span>
                                                <span> {frame.renderCode}</span>
                                            </div>
                                            <ShouldRender
                                                if={
                                                    this.state
                                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentFrameIndex' does not exist on typ... Remove this comment to see the full error message
                                                        .currentFrameIndex === i
                                                }
                                            >
                                                {this.renderCodeSnippet(frame)}
                                            </ShouldRender>
                                        </div>
                                    );
                                }
                            )
                        ) : (
                            <div> no stacktrace avaialble </div>
                        )}
                    </div>
                </div>
            </ShouldRender>
        );
    }
}
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ErrorEventStackTrace.propTypes = {
    errorEvent: PropTypes.object,
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ErrorEventStackTrace.displayName = 'ErrorEventStackTrace';
export default ErrorEventStackTrace;
