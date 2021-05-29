import React, { useState } from 'react';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { FormLoader } from '../basic/Loader';
import { deleteAutomatedScript } from '../../actions/automatedScript';

const AutomatedTabularList = props => {
    const [loading, setLoading] = useState(false);
    const { scripts } = props;

    const deleteScrip = async id => {
        setLoading(true);
        const res = props.deleteAutomatedScript(id);
        if (res) {
            setLoading(false);
        } else {
            setLoading(false);
        }
    };
    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div
                    className="Box-root"
                    style={{ overflow: 'hidden', overflowX: 'auto' }}
                >
                    <table className="Table">
                        <thead className="Table-body">
                            <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '210px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Name</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px', minWidth: '210px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>Script</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            <span>View</span>
                                        </span>
                                    </div>
                                </td>
                                <td
                                    className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                    style={{ height: '1px' }}
                                >
                                    <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                        <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                            {/* <span>View</span> */}
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        </thead>
                        <tbody className="Table-body">
                            {scripts.map((x, i) => (
                                <tr
                                    key={i}
                                    className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem"
                                    style={{
                                        height: '50px',
                                        width: '100%',
                                    }}
                                >
                                    <td
                                        className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '210px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            {x.name}
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '210px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            {x.script}
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <ShouldRender if={true}>
                                                <button
                                                    className="bs-Button"
                                                    disabled={false}
                                                >
                                                    <span>View</span>
                                                </button>
                                            </ShouldRender>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left  Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <ShouldRender if={true}>
                                                <button
                                                    className="bs-Button Box-background--red Text-color--white"
                                                    // disabled={loading}
                                                    onClick={() => {
                                                        deleteScrip(x._id);
                                                    }}
                                                >
                                                    <ShouldRender if={!loading}>
                                                        <span>Delete</span>
                                                    </ShouldRender>

                                                    <ShouldRender if={loading}>
                                                        <FormLoader />
                                                    </ShouldRender>
                                                </button>
                                            </ShouldRender>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

AutomatedTabularList.propTypes = {
    scripts: PropTypes.array.isRequired,
    deleteAutomatedScript: PropTypes.func.isRequired,
};

const mapStateToProps = state => {
    return {
        scripts: state.automatedScripts.scripts,
    };
};

export default connect(mapStateToProps, { deleteAutomatedScript })(
    AutomatedTabularList
);
