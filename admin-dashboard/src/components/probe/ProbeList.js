import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import moment from 'moment';
import { ListLoader, FormLoader } from '../basic/Loader';
import ProbeStatus from './ProbeStatus';
import ShouldRender from '../basic/ShouldRender';
import { openModal, closeModal } from '../../actions/modal';
import { updateProbe } from '../../actions/probe';
import ProbeDeleteModal from './ProbeDeleteModal';
import uuid from 'uuid';
import { reduxForm, Field } from 'redux-form';
import { UploadFile } from '../basic/UploadFile';
import { API_URL } from '../../config';

export class ProbeList extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = { deleteModalId: uuid.v4(), selectedProbe: '' };
    }

    handleClick = probeId => {
        const { deleteModalId } = this.state;
        this.props.openModal({
            id: deleteModalId,
            content: ProbeDeleteModal,
            probeId,
        });
    };

    handleChange = (probe, e) => {
        e.preventDefault();

        this.setState({ selectedProbe: probe._id });
        const reader = new FileReader();
        const file = e.target.files[0];

        // reader.onloadend = () => {
        //     this.props.logFile(reader.result);
        // };
        try {
            reader.readAsDataURL(file);
            const data = { id: probe._id, probeImage: file };
            this.props.updateProbe(data);
        } catch (error) {
            return;
        }
    };

    render() {
        const { selectedProbe } = this.state;
        const {
            probes,
            deleteRequesting,
            probeRequesting,
            addRequesting,
            updateRequesting,
        } = this.props;
        if (probes && probes.skip && typeof probes.skip === 'string') {
            probes.skip = parseInt(probes.skip, 10);
        }
        if (probes && probes.limit && typeof probes.limit === 'string') {
            probes.limit = parseInt(probes.limit, 10);
        }
        if (!probes.skip) probes.skip = 0;
        if (!probes.limit) probes.limit = 0;

        let canNext =
            probes && probes.count && probes.count > probes.skip + probes.limit
                ? true
                : false;
        let canPrev = probes && probes.skip <= 0 ? false : true;

        if (
            (probes && !probes.data) ||
            probeRequesting ||
            addRequesting ||
            deleteRequesting
        ) {
            canNext = false;
            canPrev = false;
        }
        const numberOfPages = Math.ceil(parseInt(probes.count) / 10);
        return (
            <div>
                <div style={{ overflow: 'hidden', overflowX: 'auto' }}>
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '270px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Probe Location</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell admin-probe-list-table-header"
                                    style={{ height: '1px', minWidth: '270px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Last Active</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="placeholder-left"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell admin-probe-list-table-header"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '48px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell admin-probe-list-table-header"
                                    style={{ height: '1px', minWidth: '270px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Status</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    id="placeholder-right"
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{
                                        height: '1px',
                                        maxWidth: '48px',
                                        minWidth: '48px',
                                        width: '68px',
                                    }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell admin-probe-list-table-header"
                                    style={{ height: '1px', minWidth: '275px' }}
                                >
                                    <div
                                        className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                        style={{ float: 'right' }}
                                    >
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Action</span>
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {probeRequesting ? (
                                <Fragment>
                                    <tr className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink">
                                        <td
                                            colSpan={7}
                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                            style={{ height: '1px' }}
                                        >
                                            <div className="db-ListViewItem-link">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div className="Box-root">
                                                            <ListLoader />
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </Fragment>
                            ) : probes &&
                              probes.data &&
                              probes.data.length > 0 ? (
                                probes.data.map(probe => {
                                    const fileData =
                                        probe && probe.probeImage
                                            ? `${API_URL}/file/${probe.probeImage}`
                                            : 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
                                    let imageTag = <span />;

                                    imageTag = (
                                        <img
                                            src={fileData}
                                            alt=""
                                            className="image-small-circle"
                                            style={{
                                                width: '25px',
                                                height: '25px',
                                            }}
                                        />
                                    );

                                    return (
                                        <tr
                                            key={probe._id}
                                            className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink"
                                        >
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord"
                                                style={{
                                                    height: '1px',
                                                    minWidth: '270px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                    <span className="db-ListViewItem-text Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <div
                                                            className="Box-root Margin-right--16"
                                                            style={{
                                                                display: 'flex',
                                                                alignItems:
                                                                    'center',
                                                            }}
                                                        >
                                                            {imageTag}
                                                            <span
                                                                style={{
                                                                    marginLeft:
                                                                        '5px',
                                                                }}
                                                            >
                                                                {
                                                                    probe.probeName
                                                                }
                                                            </span>
                                                        </div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root">
                                                                <span>
                                                                    {probe.lastAlive
                                                                        ? moment(
                                                                              probe.lastAlive
                                                                          ).format(
                                                                              'dddd, MMMM Do YYYY, h:mm a'
                                                                          )
                                                                        : ''}
                                                                </span>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                aria-hidden="true"
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{
                                                    height: '1px',
                                                    maxWidth: '48px',
                                                    minWidth: '48px',
                                                    width: '48px',
                                                }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        ⁣
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                        <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <div className="Box-root Flex-flex">
                                                                <div className="Box-root Flex-flex">
                                                                    <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                        <ProbeStatus
                                                                            lastAlive={
                                                                                probe &&
                                                                                probe.lastAlive
                                                                            }
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <form onSubmit>
                                                    <div className="bs-Button bs-DeprecatedButton Margin-left--8">
                                                        <ShouldRender
                                                            if={
                                                                probe.probeImage
                                                            }
                                                        >
                                                            <span className="bs-Button--icon bs-Button--new"></span>
                                                            <span>
                                                                Update Image
                                                            </span>
                                                        </ShouldRender>
                                                        <ShouldRender
                                                            if={
                                                                !probe.probeImage
                                                            }
                                                        >
                                                            <span className="bs-Button--icon bs-Button--new"></span>
                                                            <span>
                                                                Upload Image
                                                            </span>
                                                        </ShouldRender>
                                                        <Field
                                                            className="bs-FileUploadButton-input"
                                                            component={
                                                                UploadFile
                                                            }
                                                            name="profilePic"
                                                            id="profilePic"
                                                            accept="image/jpeg, image/jpg, image/png"
                                                            onChange={e =>
                                                                this.handleChange(
                                                                    probe,
                                                                    e
                                                                )
                                                            }
                                                            disabled={
                                                                updateRequesting &&
                                                                selectedProbe ===
                                                                    probe.id
                                                            }
                                                            fileInputKey={Math.round()}
                                                        />
                                                    </div>
                                                </form>
                                            </td>
                                            <td
                                                className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                style={{ height: '1px' }}
                                            >
                                                <div className="db-ListViewItem-link">
                                                    <div
                                                        className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                                        style={{
                                                            paddingRight:
                                                                '19px',
                                                            display: 'flex',
                                                            justifyContent:
                                                                'flex-end',
                                                        }}
                                                    >
                                                        <button
                                                            id="delete_probe"
                                                            className="bs-Button bs-DeprecatedButton Margin-left--8"
                                                            disabled={
                                                                probeRequesting ||
                                                                addRequesting ||
                                                                deleteRequesting
                                                            }
                                                            onClick={() =>
                                                                this.handleClick(
                                                                    probe._id
                                                                )
                                                            }
                                                        >
                                                            <ShouldRender
                                                                if={
                                                                    !deleteRequesting
                                                                }
                                                            >
                                                                <span>
                                                                    Remove
                                                                </span>
                                                            </ShouldRender>
                                                            <ShouldRender
                                                                if={
                                                                    deleteRequesting
                                                                }
                                                            >
                                                                <FormLoader />
                                                            </ShouldRender>
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    {probes &&
                    (!probes.data || !probes.data.length) &&
                    !probes.requesting &&
                    !probes.error
                        ? "We don't have any probes yet"
                        : null}
                    {probes && probes.error ? probes.error : null}
                </div>
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                        <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                            <span>
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    {probes && probes.count
                                        ? `Page ${
                                              this.props.page
                                          } of ${numberOfPages} (${probes &&
                                              probes.count} Probe${
                                              probes && probes.count === 1
                                                  ? ''
                                                  : 's'
                                          })`
                                        : null}
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="Box-root Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart">
                            <div className="Box-root Margin-right--8">
                                <button
                                    id="btnPrev"
                                    onClick={() => {
                                        this.props.prevClicked(
                                            probes.skip,
                                            probes.limit
                                        );
                                    }}
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
                                    onClick={() => {
                                        this.props.nextClicked(
                                            probes.skip,
                                            probes.limit
                                        );
                                    }}
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
        );
    }
}

const mapDispatchToProps = dispatch => {
    return bindActionCreators({ openModal, closeModal, updateProbe }, dispatch);
};

function mapStateToProps(state) {
    return {
        probes: state.probe.probes,
        probeRequesting: state.probe.probes && state.probe.probes.requesting,
        deleteRequesting:
            state.probe.deleteProbe && state.probe.deleteProbe.requesting,
        addRequesting: state.probe.addProbe && state.probe.addProbe.requesting,
        updateRequesting:
            state.probe.updateProbe && state.probe.updateProbe.requesting,
    };
}

ProbeList.displayName = 'ProbeList';

ProbeList.propTypes = {
    addRequesting: PropTypes.bool,
    deleteRequesting: PropTypes.bool,
    nextClicked: PropTypes.func.isRequired,
    openModal: PropTypes.func,
    prevClicked: PropTypes.func.isRequired,
    probeRequesting: PropTypes.bool,
    probes: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    requesting: PropTypes.bool,
    updateRequesting: PropTypes.bool,
    updateProbe: PropTypes.func,
    page: PropTypes.number,
};

const ProbeSettingsForm = reduxForm({
    form: 'probeForm', // a unique identifier for this form,
    enableReinitialize: true,
    // validate, // <--- validation function given to redux-for
})(ProbeList);

export default connect(mapStateToProps, mapDispatchToProps)(ProbeSettingsForm);
