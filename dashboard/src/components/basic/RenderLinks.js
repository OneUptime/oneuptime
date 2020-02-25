import React from 'react';
import PropTypes from 'prop-types'
import DataPathHoC from '../DataPathHoC';
import UpdateFooterLink from '../modals/FooterLink';
import RemoveFooterLink from '../modals/RemoveFooterLink';

const RenderLinks = ({
    fields,
    openModal,
    createFooterLinkModalId,
    submitForm,
    statusPage,
    removeFooterLink,
    removeFooterLinkModalId,
    deleting,
}) => {
    return (
        <ul>
            <table className="Table">
                <thead className="Table-body Box-background--offset bs-Fieldset">
                    <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                    <span>Link Name</span>
                                </span>
                            </div>
                        </td>
                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                    <span>Link URL</span>
                                </span>
                            </div>
                        </td>
                        <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell" style={{ height: '1px' }}>
                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                    <span>Action</span>
                                </span>
                            </div>
                        </td>
                    </tr>
                </thead>
                <tbody className="Table-body">
                    {
                        fields.getAll().map((link, i) => {
                            return (
                                <tr id={`name_${i}`} key={i} className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem--hasLink incidentListItem" style={{ cursor: 'auto' }}>
                                    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ minWidth: '210px' }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20" style={{ marginLeft: '-23px' }}>
                                            <div className="bs-Fieldset-fields">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-vertical--8">
                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap" id={`name_${i}`}>
                                                        {link.name}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ minWidth: '210px' }}>
                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8 Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20" style={{ marginLeft: '-5px' }}>
                                            <div className="bs-Fieldset-fields">
                                                <div className="db-ListViewItem-cellContent Box-root Padding-vertical--8">
                                                    <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap" id={`name_${i}`}>
                                                        {link.url}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--wrap db-ListViewItem-cell db-ListViewItem-cell--breakWord" style={{ minWidth: '210px' }}>
                                        <div className="bs-ObjectList-cell bs-u-v-middle">
                                            <div className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart" style={{ marginLeft: '-5px' }}>
                                                <div className="Box-root Margin-right--8">
                                                    <button
                                                        type="button"
                                                        onClick={
                                                            () => openModal({
                                                                id: createFooterLinkModalId,
                                                                content: DataPathHoC(UpdateFooterLink, {
                                                                    footerName: link.name,
                                                                    submitForm: submitForm,
                                                                    statusPage: statusPage,
                                                                }),
                                                            })
                                                        }
                                                        className="Button bs-ButtonLegacy"
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                <span>Edit</span>
                                                            </span>
                                                        </div>
                                                    </button>
                                                </div>

                                                <div className="Box-root Margin-right--8" id="removeFooterLink">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            openModal({
                                                                id: removeFooterLinkModalId,
                                                                onClose: () => '',
                                                                onConfirm: () => {
                                                                    return new Promise((resolve)=>{
                                                                        removeFooterLink(link.name);
                                                                        resolve(true);
                                                                    })
                                                                },
                                                                content: DataPathHoC(RemoveFooterLink, {deleting})
                                                            })
                                                        }}
                                                        className="Button bs-ButtonLegacy"
                                                    >
                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                <span>Remove</span>
                                                            </span>
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )
                        })
                    }
                </tbody>
            </table>
        </ul>
    )
}

RenderLinks.displayName = 'RenderLinks'

RenderLinks.propTypes = {
    submitForm: PropTypes.func.isRequired,
    removeFooterLink: PropTypes.func.isRequired,
    createFooterLinkModalId: PropTypes.string,
    deleting: PropTypes.bool,
    removeFooterLinkModalId: PropTypes.string,
    statusPage: PropTypes.object,
    openModal: PropTypes.func.isRequired,
    fields: PropTypes.oneOfType([
        PropTypes.array,
        PropTypes.object
    ]).isRequired
}

export {RenderLinks}