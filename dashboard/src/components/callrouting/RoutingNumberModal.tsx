import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';

import { reduxForm, Field } from 'redux-form';

import ClickOutside from 'react-click-outside';
import {
    fetchNumbers,
    addCallRoutingNumber,
    resetFetchNumbers,
    resetAddCallRoutingNumber,
} from '../../actions/callRouting';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader, Spinner } from '../basic/Loader';
import { countryCode } from '../common/countryCode';
import { RenderSelect } from '../basic/RenderSelect';
import { ValidateField } from '../../config';

class RoutingNumberModal extends React.Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { countryCode: '', numberType: '' };
    }
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {

        this.props.resetFetchNumbers();

        this.props.resetAddCallRoutingNumber();
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    submitForm = () => {
        const {

            closeThisDialog,

            fetchNumber,

            currentProject,

            addCallRoutingNumber,
        } = this.props;
        const {
            phoneNumber,
            locality,
            region,
            capabilities,
            price,
            priceUnit,
        } = fetchNumber.numbers;

        const { countryCode, numberType } = this.state;
        const postObj = {
            projectId: currentProject._id,
            phoneNumber,
            locality,
            region,
            capabilities,
            price,
            priceUnit,
            countryCode,
            numberType,
        };
        addCallRoutingNumber(currentProject._id, postObj).then(() => {

            if (this.props.saveNumber && !this.props.saveNumber.error) {
                closeThisDialog();
            }
        });
    };
    changeCountryCode = (event: $TSFixMe, value: $TSFixMe) => {
        this.setState({ countryCode: value });

        if (value && this.state.numberType && this.state.numberType.length) {

            this.getNumbers(value, this.state.numberType);
        }
    };
    changeNumberType = (event: $TSFixMe, value: $TSFixMe) => {
        this.setState({ numberType: value });

        if (value && this.state.countryCode && this.state.countryCode.length) {

            this.getNumbers(this.state.countryCode, value);
        }
    };
    getNumbers = (countryCode: $TSFixMe, numberType: $TSFixMe) => {

        const { currentProject, fetchNumbers } = this.props;
        const projectId =
            currentProject && currentProject._id ? currentProject._id : null;
        fetchNumbers(projectId, countryCode, numberType);
    };
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':

                return document.getElementById('addNumber').click();
            default:
                return false;
        }
    };

    render() {

        const { fetchNumber, saveNumber, closeThisDialog } = this.props;
        const isRequesting = saveNumber && saveNumber.requesting ? true : false;
        const isFetching = fetchNumber && fetchNumber.requesting ? true : false;
        const currentNumber =
            fetchNumber &&
                fetchNumber.numbers &&
                fetchNumber.numbers.phoneNumber &&
                fetchNumber.numbers.phoneNumber.length
                ? fetchNumber.numbers.phoneNumber
                : null;
        const capabilitiesMMS =
            fetchNumber &&
                fetchNumber.numbers &&
                fetchNumber.numbers.capabilities &&
                fetchNumber.numbers.capabilities.MMS
                ? fetchNumber.numbers.capabilities.MMS
                : false;
        const capabilitiesSMS =
            fetchNumber &&
                fetchNumber.numbers &&
                fetchNumber.numbers.capabilities &&
                fetchNumber.numbers.capabilities.SMS
                ? fetchNumber.numbers.capabilities.SMS
                : false;
        const capabilitiesVoice =
            fetchNumber &&
                fetchNumber.numbers &&
                fetchNumber.numbers.capabilities &&
                fetchNumber.numbers.capabilities.voice
                ? fetchNumber.numbers.capabilities.voice
                : false;

        const price =
            fetchNumber && fetchNumber.numbers && fetchNumber.numbers.price
                ? fetchNumber.numbers.price
                : 'Not available';
        const countryCodes = countryCode();
        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <div className="bs-BIM">
                    <div className="bs-Modal" style={{ width: '500px' }}>
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div
                                    className="bs-Modal-header-copy"
                                    style={{
                                        marginBottom: '10px',
                                        marginTop: '10px',
                                    }}
                                >
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Add Routing Number</span>
                                    </span>
                                </div>
                            </div>
                            <form>
                                <div className="bs-Modal-content">
                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                        <fieldset>
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorId"
                                                    >
                                                        <span>Country</span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div className="bs-Fieldset-field">
                                                            <Field
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="countrycode"
                                                                id="countrycode"
                                                                placeholder="Select country"
                                                                disabled={
                                                                    isRequesting ||
                                                                    isFetching
                                                                }
                                                                onChange={
                                                                    this
                                                                        .changeCountryCode
                                                                }
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                                options={
                                                                    countryCodes &&
                                                                        countryCodes.length >
                                                                        0
                                                                        ? countryCodes
                                                                        : [
                                                                            {
                                                                                value:
                                                                                    '',
                                                                                label:
                                                                                    'Select a country',
                                                                            },
                                                                        ]
                                                                }
                                                                className="db-select-nw db-MultiSelect-input"
                                                            />
                                                        </div>
                                                        <p className="bs-Fieldset-explanation">
                                                            <span>
                                                                Pick a country
                                                                to get number
                                                                registered in
                                                                that country.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>

                                        <fieldset className="Margin-bottom--16">
                                            <div className="bs-Fieldset-rows">
                                                <div
                                                    className="bs-Fieldset-row"
                                                    style={{ padding: 0 }}
                                                >
                                                    <label
                                                        className="bs-Fieldset-label Text-align--left"
                                                        htmlFor="monitorId"
                                                    >
                                                        <span>
                                                            Phone Number Type
                                                        </span>
                                                    </label>
                                                    <div className="bs-Fieldset-fields">
                                                        <div
                                                            className="bs-Fieldset-field"
                                                            style={{
                                                                width: '250px',
                                                            }}
                                                        >
                                                            <Field
                                                                component={
                                                                    RenderSelect
                                                                }
                                                                name="numbertype"
                                                                id="numbertype"
                                                                placeholder="Select number type"
                                                                disabled={
                                                                    isRequesting ||
                                                                    isFetching
                                                                }
                                                                onChange={
                                                                    this
                                                                        .changeNumberType
                                                                }
                                                                validate={
                                                                    ValidateField.select
                                                                }
                                                                options={[
                                                                    {
                                                                        value:
                                                                            'Local',
                                                                        label:
                                                                            'Local',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'Mobile',
                                                                        label:
                                                                            'Mobile',
                                                                    },
                                                                    {
                                                                        value:
                                                                            'TollFree',
                                                                        label:
                                                                            'TollFree',
                                                                    },
                                                                ]}
                                                                className="db-select-nw db-MultiSelect-input"
                                                            />
                                                        </div>
                                                        <p className="bs-Fieldset-explanation">
                                                            <span>
                                                                Type of phone
                                                                number
                                                                local/Mobile/TollFree.
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </fieldset>
                                        <ShouldRender
                                            if={
                                                currentNumber &&
                                                currentNumber.length &&
                                                !isFetching
                                            }
                                        >
                                            <fieldset
                                                className="Margin-bottom--16"
                                                style={{
                                                    paddingTop: '0',
                                                    marginBottom: '0',
                                                }}
                                            >
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label className="bs-Fieldset-label Text-align--left">
                                                            <span>
                                                                Routing Number
                                                            </span>
                                                        </label>
                                                        <div className="bs-Fieldset-fields">
                                                            <div className="bs-Fieldset-field">
                                                                <span
                                                                    style={{
                                                                        paddingTop:
                                                                            '5px',
                                                                    }}
                                                                >
                                                                    {
                                                                        currentNumber
                                                                    }
                                                                </span>
                                                                <button
                                                                    style={{
                                                                        border:
                                                                            'none',
                                                                        background:
                                                                            'none',
                                                                    }}
                                                                    disabled={
                                                                        isRequesting ||
                                                                        isFetching
                                                                    }
                                                                    type="button"
                                                                    id="btnreset"
                                                                    onClick={() =>
                                                                        this.getNumbers(
                                                                            this
                                                                                .state

                                                                                .countryCode,
                                                                            this
                                                                                .state

                                                                                .numberType
                                                                        )
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
                                                                                marginLeft:
                                                                                    '20px',
                                                                                marginTop:
                                                                                    '7px',
                                                                            }}
                                                                        />
                                                                    </span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>

                                            <fieldset
                                                className="Margin-bottom--16"
                                                style={{
                                                    marginBottom: '0',
                                                }}
                                            >
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label className="bs-Fieldset-label Text-align--left"></label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                flexDirection:
                                                                    'row',
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    paddingRight:
                                                                        '0',
                                                                    paddingTop:
                                                                        '0',
                                                                    flexBasis:
                                                                        '40%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Location :
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-field"
                                                                style={{
                                                                    flexDirection:
                                                                        'row',
                                                                    lineHeight:
                                                                        '1.6',
                                                                }}
                                                            >
                                                                <span>
                                                                    {fetchNumber &&
                                                                        fetchNumber.numbers &&
                                                                        fetchNumber
                                                                            .numbers
                                                                            .locality &&
                                                                        fetchNumber
                                                                            .numbers
                                                                            .locality
                                                                            .length
                                                                        ? fetchNumber
                                                                            .numbers
                                                                            .locality
                                                                        : 'Not Available'}
                                                                    ,
                                                                    {fetchNumber &&
                                                                        fetchNumber.numbers &&
                                                                        fetchNumber
                                                                            .numbers
                                                                            .region &&
                                                                        fetchNumber
                                                                            .numbers
                                                                            .region
                                                                            .length
                                                                        ? fetchNumber
                                                                            .numbers
                                                                            .region
                                                                        : 'Not Available'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                            <fieldset
                                                className="Margin-bottom--16"
                                                style={{
                                                    marginBottom: '0',
                                                }}
                                            >
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label className="bs-Fieldset-label Text-align--left"></label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                flexDirection:
                                                                    'row',
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    paddingRight:
                                                                        '0',
                                                                    paddingTop:
                                                                        '0',
                                                                    flexBasis:
                                                                        '40%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Price :
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-field"
                                                                style={{
                                                                    flexDirection:
                                                                        'row',
                                                                    lineHeight:
                                                                        '1.6',
                                                                }}
                                                            >
                                                                <span>
                                                                    {price}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                            <fieldset
                                                className="Margin-bottom--16"
                                                style={{
                                                    marginBottom: '0',
                                                }}
                                            >
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label className="bs-Fieldset-label Text-align--left"></label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                flexDirection:
                                                                    'row',
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    paddingRight:
                                                                        '0',
                                                                    paddingTop:
                                                                        '0',
                                                                    flexBasis:
                                                                        '40%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Price Unit :
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-field"
                                                                style={{
                                                                    flexDirection:
                                                                        'row',
                                                                    lineHeight:
                                                                        '1.6',
                                                                }}
                                                            >
                                                                <span>
                                                                    {fetchNumber &&
                                                                        fetchNumber.numbers &&
                                                                        fetchNumber
                                                                            .numbers
                                                                            .priceUnit &&
                                                                        fetchNumber
                                                                            .numbers
                                                                            .priceUnit
                                                                            .length
                                                                        ? fetchNumber
                                                                            .numbers
                                                                            .priceUnit
                                                                        : 'Not Available'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                            <fieldset
                                                className="Margin-bottom--16"
                                                style={{
                                                    marginBottom: '0',
                                                }}
                                            >
                                                <div className="bs-Fieldset-rows">
                                                    <div
                                                        className="bs-Fieldset-row"
                                                        style={{ padding: 0 }}
                                                    >
                                                        <label className="bs-Fieldset-label Text-align--left"></label>
                                                        <div
                                                            className="bs-Fieldset-fields"
                                                            style={{
                                                                flexDirection:
                                                                    'row',
                                                            }}
                                                        >
                                                            <label
                                                                className="bs-Fieldset-label Text-align--left"
                                                                style={{
                                                                    paddingRight:
                                                                        '0',
                                                                    paddingTop:
                                                                        '0',
                                                                    flexBasis:
                                                                        '40%',
                                                                }}
                                                            >
                                                                <span>
                                                                    Capabilities
                                                                    :
                                                                </span>
                                                            </label>
                                                            <div
                                                                className="bs-Fieldset-field"
                                                                style={{
                                                                    flexDirection:
                                                                        'column',
                                                                    lineHeight:
                                                                        '1.6',
                                                                }}
                                                            >
                                                                <span
                                                                    className={`capabilities${capabilitiesMMS}`}
                                                                >
                                                                    MMS
                                                                </span>
                                                                <span
                                                                    className={`capabilities${capabilitiesSMS}`}
                                                                >
                                                                    SMS
                                                                </span>
                                                                <span
                                                                    className={`capabilities${capabilitiesVoice}`}
                                                                >
                                                                    Voice
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </fieldset>
                                        </ShouldRender>
                                        <ShouldRender if={isFetching}>
                                            <td

                                                colSpan="5"
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            >
                                                <div
                                                    className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Padding-vertical--2"
                                                    style={{
                                                        boxShadow: 'none',
                                                    }}
                                                >
                                                    <div className="bs-Fieldset-wrapper Box-root Margin-bottom--2">
                                                        <div
                                                            className="db-Trend"
                                                            style={{
                                                                height: '100%',
                                                                cursor:
                                                                    'pointer',
                                                            }}
                                                        >
                                                            <div className="block-chart-side line-chart">
                                                                <div className="db-TrendRow">
                                                                    <div
                                                                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--center"
                                                                        style={{
                                                                            textAlign:
                                                                                'center',
                                                                            width:
                                                                                '100%',
                                                                            fontSize: 14,
                                                                        }}
                                                                    >
                                                                        <Spinner
                                                                            style={{
                                                                                stroke:
                                                                                    '#8898aa',
                                                                            }}
                                                                        />{' '}
                                                                        <span
                                                                            style={{
                                                                                width: 10,
                                                                            }}
                                                                        />
                                                                        We are
                                                                        currently
                                                                        fetching
                                                                        your
                                                                        number
                                                                        please
                                                                        wait.
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender
                                            if={
                                                (fetchNumber &&
                                                    fetchNumber.error) ||
                                                (saveNumber && saveNumber.error)
                                            }
                                        >
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {fetchNumber.error ||
                                                                saveNumber.error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className="bs-Button bs-DeprecatedButton btn__modal"
                                            type="button"
                                            onClick={closeThisDialog}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            disabled={
                                                isRequesting || isFetching
                                            }
                                            type="button"
                                            id="addNumber"
                                            onClick={this.submitForm}
                                        >
                                            {!isRequesting && (
                                                <>
                                                    <span>Reserve</span>
                                                    <span className="create-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {isRequesting && <FormLoader />}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        );
    }
}


RoutingNumberModal.displayName = 'RoutingNumberModal';

const NewRoutingNumberModal = reduxForm({
    form: 'routingNumberModal', // a unique identifier for this form
    enableReinitialize: true,
    destroyOnUnmount: true,
})(RoutingNumberModal);


RoutingNumberModal.propTypes = {
    addCallRoutingNumber: PropTypes.func,
    closeThisDialog: PropTypes.func,
    currentProject: PropTypes.object,
    fetchNumber: PropTypes.shape({
        error: PropTypes.any,
        numbers: PropTypes.shape({
            basePrice: PropTypes.any,
            capabilities: PropTypes.shape({
                MMS: PropTypes.any,
                SMS: PropTypes.any,
                voice: PropTypes.any,
            }),
            currentPrice: PropTypes.any,
            locality: PropTypes.shape({
                length: PropTypes.any,
            }),
            phoneNumber: PropTypes.shape({
                length: PropTypes.any,
            }),
            price: PropTypes.any,
            priceUnit: PropTypes.shape({
                length: PropTypes.any,
            }),
            region: PropTypes.shape({
                length: PropTypes.any,
            }),
        }),
        requesting: PropTypes.any,
    }),
    fetchNumbers: PropTypes.func,
    resetAddCallRoutingNumber: PropTypes.func,
    resetFetchNumbers: PropTypes.func,
    saveNumber: PropTypes.shape({
        error: PropTypes.any,
        requesting: PropTypes.any,
    }),
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        fetchNumbers,
        addCallRoutingNumber,
        resetFetchNumbers,
        resetAddCallRoutingNumber,
    },
    dispatch
);

const mapStateToProps = (state: $TSFixMe) => {
    return {
        fetchNumber: state.callRouting.fetchNumber,
        saveNumber: state.callRouting.saveNumber,
        currentProject: state.project.currentProject,
    };
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(NewRoutingNumberModal);
