import React from 'react';
//import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Component } from 'react';
import { Field, FieldArray, formValueSelector, arrayPush } from 'redux-form';
import { RenderTextArea } from '../basic/RenderTextArea';
import PropTypes from 'prop-types';
import { RenderHeaders } from '../basic/RenderHeaders';
import ShouldRender from '../basic/ShouldRender';
import { RenderSelect } from '../basic/RenderSelect';
import { ValidateField } from '../../config';

const style = {
    marginTop: '10px',
    marginBottom: '-13px',
    borderRadius: '0px',
    boxShadow: 'none'
};

const textboxstyle = {
    backgroundColor: '#fff',
    borderRadius: '4px',
    width: '400px',
    boxShadow: '0 0 0 1px rgba(50, 50, 93, 0.16), 0 0 0 1px rgba(50, 151, 211, 0), 0 0 0 2px rgba(50, 151, 211, 0), 0 1px 1px rgba(0, 0, 0, 0.08)',
}
const newSelector = formValueSelector('NewMonitor');

export class ApiAdvance extends Component {

    addValue = () => {
        this.props.pushArray('NewMonitor', `headers_${this.props.index}`, { key: '', value: '' });
    }

    addRows = () => {
        this.props.pushArray('NewMonitor', `formData_${this.props.index}`, { key: '', value: '' });
    }

    render() {
        const { bodytype } = this.props;
        return (
            <div className="bs-ContentSection Card-root Card-shadow--medium" style={style}>
                <div className="Box-root">
                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Headers</span>
                            </span>
                            <p>
                                <span>
                                    This section belongs to customizing your header that will be sent with the api request.
                                </span>
                            </p>
                        </div>

                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div>
                                <button className='Button bs-ButtonLegacy ActionIconParent' type="button"
                                    onClick={this.addValue}>
                                    <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                        <span>Add Headers</span>
                                    </span>
                                </button>
                            </div>
                        </div>

                    </div>
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <FieldArray name={`headers_${this.props.index}`} component={RenderHeaders} />
                                    </div>
                                </fieldset>
                            </div>
                        </div>
                    </div>

                    <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                <span>Body</span>
                            </span>
                            <p>
                                <span>
                                    This section belongs to customizing your body that will be sent with the api request.
                                </span>
                            </p>
                        </div>
                        <ShouldRender if={bodytype === 'form-data' || bodytype === 'x-www-form-urlencoded'}>
                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16" style={{ marginRight: '15px' }}>
                                <div>
                                    <button className='Button bs-ButtonLegacy ActionIconParent' type="button"
                                        onClick={this.addRows}>
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>Add Rows</span>
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </ShouldRender>
                    </div>
                    <div className="bs-ContentSection-content Box-root Box-background--offset Box-divider--surface-bottom-1 Padding-horizontal--8 Padding-vertical--2">
                        <div>
                            <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                <fieldset className="bs-Fieldset">
                                    <div className="bs-Fieldset-rows">
                                        <div className="bs-Fieldset-row">
                                            <label className="bs-Fieldset-label">Body Type</label>
                                            <div className="bs-Fieldset-fields">
                                                <Field className="db-select-nw"
                                                    component={RenderSelect}
                                                    name={`bodyType_${this.props.index}`}
                                                    id="bodyType"
                                                    placeholder="Body Type"
                                                    disabled={false}
                                                    validate={ValidateField.select}
                                                    options={[
                                                        { value: '', label: 'None' },
                                                        { value: 'form-data', label: 'form-data' },
                                                        { value: 'x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
                                                        { value: 'text/plain', label: 'Text (text/plain)' },
                                                        { value: 'application/json', label: 'JSON (application/json)' },
                                                        { value: 'application/javascript', label: 'Javascript (application/javascript)' },
                                                        { value: 'application/xml', label: 'XML (application/xml)' },
                                                        { value: 'text/xml', label: 'XML (text/xml)' },
                                                        { value: 'text/html', label: 'HTML (text/html)' }
                                                    ]}
                                                />
                                            </div>
                                        </div>
                                        <ShouldRender if={bodytype === 'form-data' || bodytype === 'x-www-form-urlencoded'}>
                                            <FieldArray name={`formData_${this.props.index}`} component={RenderHeaders} />
                                        </ShouldRender>
                                        <ShouldRender if={['text', 'textPlain', 'applicationJson', 'applicationJavascript', 'applicationXml', 'textXml', 'textHtml'].indexOf(bodytype) > -1}>
                                            <div className="bs-Fieldset-row">
                                                <label className="bs-Fieldset-label">Body Content</label>
                                                <div className="bs-Fieldset-fields">
                                                    <Field component={RenderTextArea}
                                                        className="db-FeedbackForm-textarea"
                                                        name={`text_${this.props.index}`}
                                                        style={textboxstyle}
                                                        rows={10}
                                                        validate={ValidateField.required}
                                                    />
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                </fieldset>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

ApiAdvance.displayName = 'ApiAdvance'

ApiAdvance.propTypes = {
    pushArray: PropTypes.func,
    bodytype: PropTypes.string,
    index: PropTypes.number,
}

const mapDispatchToProps = {
    pushArray: arrayPush
}

function mapStateToProps(state, ownProps) {
    return {
        bodytype: newSelector(state, `bodyType_${ownProps.index}`),
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(ApiAdvance);