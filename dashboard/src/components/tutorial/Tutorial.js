import React from 'react';
import { tutorials } from '../../config';
import PropTypes from 'prop-types';

class Tutorial extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            currentSlide: 's1',
        }

        this.mounted = true;
    }

    changeSlide(value) {
        if (this.mounted)
            this.setState({ currentSlide: value });
    }

    componentDidMount() {
        this.mounted = true;
        this.loopCard();
    }

    componentWillUnmount() {
        this.mounted = false;
    }

    renderNote(note) {
        if (note) {
            return (
                <div className="Flex-flex Flex-alignItems--center">
                    <img src={note.icon} alt="" className={`tut-Icon--${note.iconText} Margin-right--20`} height="75" width="75" />
                    <div>
                        <h3>
                            {note.title}
                        </h3>
                        <article className="Text-wrap--wrap col-sm-12">
                            {note.description}
                        </article>
                    </div>
                </div>
            );
        } else {
            return (
                <div>
                    <h3>
                        Oopsie!
                    </h3>
                    <article className="Text-wrap--wrap col-sm-12">
                        No description for this tutorial.
                    </article>
                </div>
            );
        }
    }


    loopCard() {
        const self = this;
        setInterval(function () {
            const { currentSlide } = self.state;
            if (currentSlide === 's1')
                self.changeSlide('s2');

            if (currentSlide === 's2')
                self.changeSlide('s3');

            if (currentSlide === 's3')
                self.changeSlide('s4');

            if (currentSlide === 's4')
                self.changeSlide('s5');

            if (currentSlide === 's5')
                self.changeSlide('s1');
        }, 10000);
    }

    render() {
        const { deprecated, type } = this.props;
        const { currentSlide } = this.state;

        const note = tutorials.getTutorials().filter(tutorial => tutorial.id === type);

        if (deprecated) {
            return (
                <div className="Flex-flex Flex-alignContent--stretch tut-Main row">
                    <div className="Tutorial-image--box col-sm-6">
                        <section id="slider">
                            <input className="tut-Hide--check" readOnly type="radio" name="slider" id="s1" onClick={() => this.changeSlide('s1')} checked={currentSlide === 's1'} />
                            <input className="tut-Hide--check" readOnly type="radio" name="slider" id="s2" onClick={() => this.changeSlide('s2')} checked={currentSlide === 's2'} />
                            <input className="tut-Hide--check" readOnly type="radio" name="slider" id="s3" onClick={() => this.changeSlide('s3')} checked={currentSlide === 's3'} />
                            <input className="tut-Hide--check" readOnly type="radio" name="slider" id="s4" onClick={() => this.changeSlide('s4')} checked={currentSlide === 's4'} />
                            <input className="tut-Hide--check" readOnly type="radio" name="slider" id="s5" onClick={() => this.changeSlide('s5')} checked={currentSlide === 's5'} />
                            <label htmlFor="s1" id="slide1">
                                <div className="Flex-alignContent--center">
                                    <img alt="" className="tut-Monitor--monitor" width="290" />
                                    <img alt="" className="tut-Monitor--monitor" width="290" />
                                </div>
                            </label>
                            <label htmlFor="s2" id="slide2">
                                <div className="Flex-alignContent--center">
                                    <img alt="" className="tut-Monitor--incident" width="290" />
                                    <img alt="" className="tut-Monitor--incident" width="290" />
                                </div>
                            </label>
                            <label htmlFor="s3" id="slide3">
                                <div className="Flex-alignContent--center">
                                    <img alt="" className="tut-Monitor--ack" width="290" />
                                    <img alt="" className="tut-Monitor--ack" width="290" />
                                </div>
                            </label>
                            <label htmlFor="s4" id="slide4">
                                <div className="Flex-alignContent--center">
                                    <img alt="" className="tut-Monitor--metrics" width="290" />
                                    <img alt="" className="tut-Monitor--range" width="290" />
                                    <img alt="" className="tut-Monitor--metrics" width="290" />
                                    <img alt="" className="tut-Monitor--range" width="290" />
                                </div>
                            </label>
                            <label htmlFor="s5" id="slide5">
                                <div className="Flex-alignContent--center">
                                    <img alt="" className="tut-Monitor--ack" width="290" />
                                    <img alt="" className="tut-Monitor--ack" width="290" />
                                </div>
                            </label>
                        </section>
                    </div>
                    <div className="bs-u-justify--center col-sm-6 Flex-justifyContent--center Padding-all--20 Vertical">
                        {currentSlide === 's1' && this.renderNote(tutorials.getTutorials()[0])}
                        {currentSlide === 's2' && this.renderNote(tutorials.getTutorials()[1])}
                        {currentSlide === 's3' && this.renderNote(tutorials.getTutorials()[2])}
                        {currentSlide === 's4' && this.renderNote(tutorials.getTutorials()[3])}
                        {currentSlide === 's5' && this.renderNote(tutorials.getTutorials()[4])}
                    </div>
                </div>
            );
        } else {
            return (
                <div className="Flex-flex Flex-alignContent--stretch tut-Main row">
                    <div className="bs-u-justify--center col-sm-12 Flex-justifyContent--center Padding-all--20 Vertical">
                        {this.renderNote(note[0] || null)}
                    </div>
                </div>
            )
        }
    }
}

Tutorial.displayName = 'Tutorial';

Tutorial.propTypes = {
    deprecated: PropTypes.bool,
    type: PropTypes.string
};

export default Tutorial;