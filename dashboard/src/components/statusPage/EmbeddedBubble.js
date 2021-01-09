import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import uuid from 'uuid';
import ShouldRender from '../basic/ShouldRender';
import { resetStatusBubbleId } from '../../actions/statusPage';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { Field, reduxForm, formValueSelector, change } from 'redux-form';
import RenderCodeEditor from '../basic/RenderCodeEditor';
import { API_URL } from '../../config';
import ResetStatusBubbleIdModal from '../modals/ResetStatusBubbleIdModal';
import { openModal, closeModal } from '../../actions/modal';

const selector = formValueSelector('EmbeddedBubble');

const css = colors => `<style>
    .all {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.uptime.r}, ${colors.uptime.g}, ${colors.uptime.b});
    }
    .some {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b});
    },
    .none {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.downtime.r}, ${colors.downtime.g}, ${colors.downtime.b});
    }
    .degraded {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        margin-right: 5px;
        background-color: rgba(${colors.degraded.r}, ${colors.degraded.g}, ${colors.degraded.b});
    }
    .text {
        color: rgb(76, 76, 76);
        font-size: 13px;
        padding-top: 4px;
    }
    .bubble-box {
        display:flex;
        flex-direction: row;
      }
    </style>`;

const createScript = (url, css) => {
    return `<div class='bubble-box'>
    <div id="fyipe-status-bubble"></div>
    <div id='fyipe-bubble-text'></div>
  </div>
    ${css}
        <script language="javascript" type="text/javascript">
        function initializeBubble() {
            var placeholderDiv = document.getElementById("fyipe-status-bubble");
            var placeholderTitleDiv = document.getElementById("fyipe-bubble-text");
            var bubble = 'all';
            var statusMessage = '';
            var url = '${url}';
            fetch(url,{
                method: 'GET',
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    Accept: 'application/json',
                    'Content-Type': 'application/json;charset=UTF-8',
                }})
                .then(response => response.json())
            .then(json => {
                bubble = json && json.bubble ? json.bubble : null;
                statusMessage = json && json.statusMessage ? json.statusMessage : null;
                if (bubble === 'all') {
                    placeholderDiv.className = 'all';
            } else if (bubble === 'some') {
              placeholderDiv.className = 'some';
            } else if (bubble === 'none') {
                placeholderDiv.className = 'none';
            } else if (bubble === 'some-degraded') {
                placeholderDiv.className = 'degraded';
            }
            placeholderTitleDiv.className = 'text';
            placeholderTitleDiv.innerHTML = statusMessage;
            })
            .catch(err => console.error(err));
        };window.onload = function (){initializeBubble()};
        </script>`;
};

export class EmbeddedBubble extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            showMoreOptions: false,
            resetModalId: uuid.v4(),
        };
    }
    resetcss = css => {
        const url = `${API_URL}/statusPage/statusBubble?statusPageId=${this.props.statusPageId}&statusBubbleId=${this.props.statusBubbleId}`;
        const value = createScript(url, css);
        this.props.change('embeddedcode', value);
    };
    showMoreOptionsToggle = () =>
        this.setState(prevState => ({
            showMoreOptions: !prevState.showMoreOptions,
        }));

    render() {
        const {
            statusBubbleId,
            statusBubble,
            resetStatusBubbleId,
            statusPageId,
            projectId,
            customCssValue,
            customCodeValue,
        } = this.props;
        const { showMoreOptions, resetModalId } = this.state;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Embedded Status Bubble</span>
                            </span>
                            <p>
                                <span>
                                    Add embedded status bubble to your website.
                                </span>
                            </p>
                        </div>
                        <div
                            className="bs-Fieldset-row"
                            style={{
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            <label style={{ marginRight: 10 }}>
                                Show advanced options
                            </label>
                            <div>
                                <label className="Toggler-wrap">
                                    <input
                                        className="btn-toggler"
                                        type="checkbox"
                                        onChange={() =>
                                            this.showMoreOptionsToggle()
                                        }
                                        name="moreOptions"
                                        id="moreOptions"
                                        checked={showMoreOptions}
                                    />
                                    <span className="TogglerBtn-slider round"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <form>
                        <div
                            className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1"
                            style={{ overflow: 'hidden', overflowX: 'auto' }}
                        >
                            <div>
                                <div className="bs-Fieldset-wrapper Box-root">
                                    <fieldset className="Box-background--offset">
                                        <div className="bs-Fieldset-rows">
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label script-label">
                                                    Bubble Display
                                                </label>
                                                <div
                                                    className="bs-Fieldset-fields script-editor-wrapper"
                                                    style={{
                                                        height: '200px',
                                                        width: '80%',
                                                        position: 'relative',
                                                    }}
                                                >
                                                    <iframe
                                                        id="bubbleDisplay"
                                                        title="script status display"
                                                        srcDoc={
                                                            customCodeValue
                                                                ? customCodeValue
                                                                : ''
                                                        }
                                                        style={{
                                                            position:
                                                                'absolute',
                                                            top: 0,
                                                            left: 0,
                                                            bottom: 0,
                                                            right: 0,
                                                            height: '100%',
                                                            width: '100%',
                                                            border: 'none',
                                                            background: 'white',
                                                            boxShadow:
                                                                'rgba(50, 50, 93, 0.16) 0px 0px 0px 1px, rgba(50, 151, 211, 0) 0px 0px 0px 1px, rgba(50, 151, 211, 0) 0px 0px 0px 2px, rgba(0, 0, 0, 0.08) 0px 1px 1px',
                                                        }}
                                                    >
                                                        {customCodeValue}
                                                    </iframe>
                                                </div>
                                            </div>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label script-label">
                                                    Embedded Code
                                                </label>
                                                <div className="bs-Fieldset-fields script-editor-wrapper">
                                                    <Field
                                                        id="embeddedcode"
                                                        name="embeddedcode"
                                                        component={
                                                            RenderCodeEditor
                                                        }
                                                        mode="html"
                                                        theme="github"
                                                        height="180px"
                                                        width="100%"
                                                    />
                                                </div>
                                            </div>
                                            <ShouldRender if={showMoreOptions}>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label script-label">
                                                        Status Bubble ID :
                                                    </label>
                                                    <div
                                                        className="bs-Fieldset-fields"
                                                        style={{
                                                            paddingTop: '7px',
                                                        }}
                                                    >
                                                        <span>
                                                            {statusBubbleId}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <button
                                                            style={{
                                                                border: 'none',
                                                                background:
                                                                    'none',
                                                            }}
                                                            disabled={
                                                                statusBubble.requesting
                                                            }
                                                            type="button"
                                                            id="btnreset"
                                                            onClick={() =>
                                                                this.props.openModal(
                                                                    {
                                                                        id: resetModalId,
                                                                        onConfirm: () => {
                                                                            return resetStatusBubbleId(
                                                                                projectId,
                                                                                statusPageId
                                                                            );
                                                                        },
                                                                        content: ResetStatusBubbleIdModal,
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            <ShouldRender
                                                                if={
                                                                    !statusBubble.requesting
                                                                }
                                                            >
                                                                <span>
                                                                    <img
                                                                        src="/dashboard/assets/img/refresh.svg"
                                                                        alt="refresh"
                                                                        style={{
                                                                            height:
                                                                                'inherit',
                                                                            width:
                                                                                '15px',
                                                                            marginTop:
                                                                                '8px',
                                                                        }}
                                                                    />
                                                                </span>
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={
                                                                    statusBubble.requesting
                                                                }
                                                            >
                                                                <FormLoader />
                                                            </ShouldRender>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="bs-Fieldset-row">
                                                    <label className="bs-Fieldset-label script-label">
                                                        Embedded Custom CSS
                                                    </label>
                                                    <div className="bs-Fieldset-fields script-editor-wrapper">
                                                        <Field
                                                            id="embeddedCustomCSS"
                                                            name="embeddedCustomCSS"
                                                            component={
                                                                RenderCodeEditor
                                                            }
                                                            mode="css"
                                                            theme="github"
                                                            height="150px"
                                                            width="100%"
                                                        />
                                                    </div>
                                                </div>
                                            </ShouldRender>
                                        </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--12">
                            <span className="db-SettingsForm-footerMessage">
                                <ShouldRender if={statusBubble.error}>
                                    <div className="bs-Tail-copy">
                                        <div
                                            className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                            style={{ marginTop: '10px' }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {statusBubble.error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                            </span>
                            <ShouldRender if={showMoreOptions}>
                                <div>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        disabled={false}
                                        type="button"
                                        id="btnresetcss"
                                        onClick={() =>
                                            this.resetcss(customCssValue)
                                        }
                                    >
                                        <span>Change CSS</span>
                                    </button>
                                </div>
                            </ShouldRender>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
}

EmbeddedBubble.displayName = 'Embedded Bubble';

EmbeddedBubble.propTypes = {
    change: PropTypes.func,
    customCodeValue: PropTypes.shape({
        length: PropTypes.func,
        substring: PropTypes.func,
    }),
    customCssValue: PropTypes.any,
    openModal: PropTypes.func,
    projectId: PropTypes.any,
    resetStatusBubbleId: PropTypes.func,
    statusBubble: PropTypes.shape({
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
    statusBubbleId: PropTypes.any,
    statusPageId: PropTypes.any,
};

const EmbeddedBubbleForm = reduxForm({
    form: 'EmbeddedBubble', // a unique identifier for this form
    enableReinitialize: true,
})(EmbeddedBubble);

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { resetStatusBubbleId, change, openModal, closeModal },
        dispatch
    );

const mapStateToProps = state => {
    const customCssValue = selector(state, 'embeddedCustomCSS');
    const customCodeValue = selector(state, 'embeddedcode');
    const { statusBubbleId, _id, projectId, colors } = state.statusPage.status;
    const url = `${API_URL}/statusPage/statusBubble?statusPageId=${_id}&statusBubbleId=${statusBubbleId}`;
    const customCss = css(colors);
    const script = createScript(url, customCss);
    return {
        initialValues: { embeddedcode: script, embeddedCustomCSS: customCss },
        statusBubbleId,
        statusPageId: _id,
        statusBubble: state.statusPage.statusBubble,
        projectId: projectId._id,
        customCssValue,
        customCodeValue,
    };
};

export default connect(mapStateToProps, mapDispatchToProps)(EmbeddedBubbleForm);
