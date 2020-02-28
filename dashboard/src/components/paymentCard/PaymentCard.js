import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router';
import uuid from 'uuid';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { openModal, closeModal } from '../../actions/modal';
import { fetchCards, setDefaultCard } from '../../actions/card';
import DataPathHoC from '../DataPathHoC';
import AddCard from '../modals/AddCard';
import DeleteCard from '../modals/DeleteCard';
import { ListLoader } from '../basic/Loader';
import { User } from '../../config';

class PaymentCard extends Component {
    constructor(props) {
        super(props);
        this.props = props;
        this.state = {
            createCardModalId: uuid.v4(),
            confirmCardDeleteModalId: uuid.v4(),
        };
    }

    componentDidMount() {
        const { userId } = this.props;
        this.props.fetchCards(userId);
    }

    render() {
        const { createCardModalId, confirmCardDeleteModalId } = this.state;
        const {
            cards,
            requesting,
            settingDefaultCard,
            requestingDefaultCardId,
            userId,
        } = this.props;
        return (
            <div
                className="db-World-contentPane Box-root"
                style={{ paddingTop: 0 }}
            >
                <div className="db-RadarRulesLists-page">
                    <div className="Box-root Margin-bottom--12">
                        <div className="bs-ContentSection Card-root Card-shadow--medium">
                            <div className="Box-root">
                                <div>
                                    <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                                        <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                                            <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                                                <span className="ContentHeader-title Text-color--dark Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--28 Text-typeface--base Text-wrap--wrap">
                                                    <span>Cards</span>
                                                </span>
                                                <span className="ContentHeader-description Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span>
                                                        Add multiple backup
                                                        cards which will be used
                                                        for billing if your
                                                        primary card is
                                                        unbillable.
                                                    </span>
                                                </span>
                                            </div>
                                            <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                                                <div className="Box-root">
                                                    <button
                                                        onClick={() => {
                                                            this.props.openModal(
                                                                {
                                                                    id: createCardModalId,
                                                                    content: DataPathHoC(
                                                                        AddCard,
                                                                        {}
                                                                    ),
                                                                }
                                                            );
                                                        }}
                                                        className="Button bs-ButtonLegacy ActionIconParent"
                                                        type="button"
                                                    >
                                                        <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                            <div className="Box-root Margin-right--8">
                                                                <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                                            </div>
                                                            <span
                                                                id="addCardButton"
                                                                className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new"
                                                            >
                                                                <span>
                                                                    Add card
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {requesting ? (
                                        <ListLoader />
                                    ) : (
                                        <div
                                            style={{
                                                overflow: 'hidden',
                                                overflowX: 'auto',
                                            }}
                                        >
                                            <table className="Table">
                                                <thead className="Table-body">
                                                    <tr className="Table-row db-ListViewItem db-ListViewItem-header">
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                minWidth:
                                                                    '270px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                    <span>
                                                                        Card
                                                                        Details
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                    <span>
                                                                        Expiry
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            id="placeholder-left"
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                maxWidth:
                                                                    '48px',
                                                                minWidth:
                                                                    '48px',
                                                                width: '48px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                    <span></span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                    <span>
                                                                        Default
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            id="placeholder-right"
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                                maxWidth:
                                                                    '48px',
                                                                minWidth:
                                                                    '48px',
                                                                width: '48px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                    <span></span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td
                                                            className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                            style={{
                                                                height: '1px',
                                                            }}
                                                        >
                                                            <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                    <span>
                                                                        Actions
                                                                    </span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                </thead>
                                                <tbody className="Table-body">
                                                    {!requesting &&
                                                        cards.length > 0 &&
                                                        cards.map((card, i) => {
                                                            if (
                                                                card.brand ===
                                                                'American Express'
                                                            ) {
                                                                card.brand =
                                                                    'cc-amex';
                                                            } else if (
                                                                card.brand ===
                                                                'Diners Club'
                                                            ) {
                                                                card.brand =
                                                                    'cc-diners-club';
                                                            } else if (
                                                                card.brand ===
                                                                'Visa'
                                                            ) {
                                                                card.brand =
                                                                    'cc-visa';
                                                            } else if (
                                                                card.brand ===
                                                                'MasterCard'
                                                            ) {
                                                                card.brand =
                                                                    'cc-mastercard';
                                                            } else if (
                                                                card.brand ===
                                                                'JCB'
                                                            ) {
                                                                card.brand =
                                                                    'cc-jcb';
                                                            } else if (
                                                                card.brand ===
                                                                'Discover'
                                                            ) {
                                                                card.brand =
                                                                    'cc-discover';
                                                            }
                                                            return (
                                                                <tr
                                                                    className="Table-row db-ListViewItem bs-ActionsParent db-ListViewItem"
                                                                    key={
                                                                        card.id
                                                                    }
                                                                >
                                                                    <td
                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                        style={{
                                                                            height:
                                                                                '1px',
                                                                            minWidth:
                                                                                '270px',
                                                                        }}
                                                                    >
                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                            <span className="db-ListViewItem-text Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                                                <div className="Box-root Margin-right--16">
                                                                                    <div className="Box-root bs-u-floatLeft Padding-vertical--8">
                                                                                        <span>
                                                                                            <i
                                                                                                className={`fa fa-${card.brand} fa-lg`}
                                                                                            ></i>
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            </span>
                                                                            <div className="Box-root bs-u-floatLeft Padding-all--8">
                                                                                <span
                                                                                    style={{
                                                                                        fontWeight:
                                                                                            'bold',
                                                                                    }}
                                                                                >
                                                                                    {`•••• ${card.last4}`}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </td>
                                                                    <td
                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--middle Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                        style={{
                                                                            height:
                                                                                '1px',
                                                                        }}
                                                                    >
                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                            <span className="db-ListViewItem-text Text-align--left Text-color--dark Text-display--block Text-fontSize--13 Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap">
                                                                                {card.exp_month.toString()
                                                                                    .length ===
                                                                                1 ? (
                                                                                    <span>{`0${card.exp_month}/${card.exp_year}`}</span>
                                                                                ) : (
                                                                                    <span>{`${card.exp_month}/${card.exp_year}`}</span>
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                    </td>
                                                                    <td
                                                                        id="placeholder-left"
                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                    >
                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                            <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                                                        </div>
                                                                    </td>
                                                                    <td
                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--middle Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                        style={{
                                                                            height:
                                                                                '1px',
                                                                        }}
                                                                    >
                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                            <span className="db-ListViewItem-text Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"></span>
                                                                        </div>
                                                                    </td>
                                                                    <td
                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--middle Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                        style={{
                                                                            height:
                                                                                '1px',
                                                                        }}
                                                                    >
                                                                        <div className="db-RadarRulesListUserName Box-root Flex-flex Flex-alignItems--center Flex-direction--row Flex-justifyContent--flexStart">
                                                                            {card.default_source && (
                                                                                <div className="Badge Badge--color--green Box-root Flex-inlineFlex Flex-alignItems--center Padding-horizontal--8 Padding-vertical--2 bs-u-float Right Margin-all--8">
                                                                                    <span className="Badge-text Text-color--green Text-display--inline Text-fontSize--12 Text-fontWeight--bold Text-lineHeight--16 Text-typeface--upper Text-wrap--noWrap">
                                                                                        <span
                                                                                            style={{
                                                                                                fontWeight:
                                                                                                    'bold',
                                                                                            }}
                                                                                        >
                                                                                            Default
                                                                                        </span>
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                    <td
                                                                        id="placeholder-right"
                                                                        className="Table-cell Table-cell--align--left Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                    >
                                                                        <div className="db-ListViewItem-cellContent Box-root Padding-all--8">
                                                                            <span className="db-ListViewItem-text Text-color--dark Text-display--inline Text-fontSize--13 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--upper Text-wrap--wrap"></span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--wrap--noWrap db-ListViewItem-cell"></td>
                                                                    <td
                                                                        className="Table-cell Table-cell--align--right Table-cell--verticalAlign--top Table-cell--width--minimized Table-cell--wrap--noWrap db-ListViewItem-cell"
                                                                        style={{
                                                                            height:
                                                                                '1px',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            className="db-ListViewItem-cellContent Box-root Padding-all--8"
                                                                            style={{
                                                                                display:
                                                                                    'flex',
                                                                            }}
                                                                        >
                                                                            <div
                                                                                id={`deleteCard${i}`}
                                                                                onClick={() =>
                                                                                    this.props.openModal(
                                                                                        {
                                                                                            id: confirmCardDeleteModalId,
                                                                                            content: DataPathHoC(
                                                                                                DeleteCard,
                                                                                                {}
                                                                                            ),
                                                                                            deleteCardId:
                                                                                                card.id,
                                                                                        }
                                                                                    )
                                                                                }
                                                                                className="Box-root"
                                                                            >
                                                                                <div className="Margin-all--4 bs-u-v-middle">
                                                                                    <button
                                                                                        className="Button bs-ButtonLegacy"
                                                                                        type="button"
                                                                                    >
                                                                                        <div className="Button-fill bs-ButtonLegacy-fill Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                                            <span className="Button-label Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                                                <i className="fa fa-trash"></i>
                                                                                            </span>
                                                                                        </div>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                            {!card.default_source && (
                                                                                <div
                                                                                    id={`setDefaultCard${i}`}
                                                                                    className="Box-root"
                                                                                    onClick={() =>
                                                                                        this.props.setDefaultCard(
                                                                                            userId,
                                                                                            card.id
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    <div className="Margin-all--4 bs-u-v-middle">
                                                                                        <button
                                                                                            className="Button bs-ButtonLegacy"
                                                                                            type="button"
                                                                                            disabled={
                                                                                                settingDefaultCard
                                                                                            }
                                                                                        >
                                                                                            {requestingDefaultCardId ===
                                                                                            card.id ? (
                                                                                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                                                    <div
                                                                                                        style={{
                                                                                                            marginTop: -20,
                                                                                                        }}
                                                                                                    >
                                                                                                        <ListLoader />
                                                                                                    </div>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <div className="Button-fill bs-ButtonLegacy-fill Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                                                                                    <span className="Button-label Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                                                                        <span>
                                                                                                            Set
                                                                                                            as
                                                                                                            default
                                                                                                        </span>
                                                                                                    </span>
                                                                                                </div>
                                                                                            )}
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    <div
                                        className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween"
                                        style={{ backgroundColor: 'white' }}
                                    >
                                        <div className="Box-root Flex-flex Flex-alignItems--center Padding-all--20">
                                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                <span>
                                                    <span
                                                        id="cardsCount"
                                                        className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap"
                                                    >
                                                        {this.props.count
                                                            ? this.props.count +
                                                              (this.props
                                                                  .count > 1
                                                                  ? ' Cards'
                                                                  : ' Card')
                                                            : '0 Card'}
                                                    </span>
                                                </span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

PaymentCard.displayName = 'PaymentCard';

PaymentCard.propTypes = {
    userId: PropTypes.string,
    fetchCards: PropTypes.func.isRequired,
    cards: PropTypes.array,
    count: PropTypes.number,
    openModal: PropTypes.func.isRequired,
    settingDefaultCard: PropTypes.bool,
    setDefaultCard: PropTypes.func.isRequired,
    requesting: PropTypes.bool,
    requestingDefaultCardId: PropTypes.string,
};

const mapStateToProps = state => {
    return {
        cards: state.card.fetchCards.cards,
        count: state.card.fetchCards.cards.length,
        requesting: state.card.fetchCards.requesting,
        settingDefaultCard: state.card.setDefaultCard.requesting,
        requestingDefaultCardId: state.card.setDefaultCard.requestingCardId,
        userId: User.getUserId(),
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { openModal, closeModal, fetchCards, setDefaultCard },
        dispatch
    );

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(PaymentCard)
);
