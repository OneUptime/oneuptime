import React from 'react';
import ShouldRender from '../basic/ShouldRender';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { deleteAutomatedScript } from '../../actions/automatedScript';

const AutomatedTabularList = props => {
    const { scripts } = props;
    const pathName = props.history.location.pathname;

    return (
        <div className="Box-root Margin-bottom--12">
            <div className="bs-ContentSection Card-root Card-shadow--medium">
                <div>
                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                <span className="ContentHeader-title Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                    <span
                                        style={{ textTransform: 'capitalize' }}
                                    >
                                        Automation Script
                                    </span>
                                </span>
                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                    <span>
                                        Automated script are script created for
                                        yor project
                                    </span>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    className="Box-root"
                    style={{ overflow: 'hidden', overflowX: 'auto' }}
                >
                    {scripts.length > 0 && (
                        <table className="Table">
                            <thead className="Table-body">
                                <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{
                                            height: '1px',
                                            minWidth: '210px',
                                        }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                <span>Name</span>
                                            </span>
                                        </div>
                                    </td>
                                    <td
                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                        style={{ height: '1px' }}
                                    >
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                            <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                <span>Action</span>
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
                                        onClick={() => {
                                            props.history.push(
                                                `${pathName}/${x.slug}`
                                            );
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
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

AutomatedTabularList.propTypes = {
    scripts: PropTypes.array.isRequired,
    history: PropTypes.object.isRequired,
    // deleteAutomatedScript: PropTypes.func.isRequired,
};

const mapStateToProps = state => {
    return {
        scripts: state.automatedScripts.scripts,
    };
};

export default connect(mapStateToProps, { deleteAutomatedScript })(
    AutomatedTabularList
);
