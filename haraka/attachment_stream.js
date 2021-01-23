'use strict';

const Stream = require('stream');

class AttachmentStream extends Stream {
    constructor(header) {
        super();
        this.header = header;
        this.encoding = null;
        this.paused = false;
        this.end_emitted = false;
        this.connection = null;
        this.buffer = [];
    }

    emit_data(data) {
        // console.log("YYY: DATA emit");
        if (this.paused) {
            return this.buffer.push(data);
        }

        if (this.encoding) {
            this.emit('data', data.toString(this.encoding));
        } else {
            this.emit('data', data);
        }
    }

    emit_end(force) {
        if (this.paused && !force) {
            // console.log("YYY: end emit (cache)");
            this.end_emitted = true;
        } else {
            // console.log("YYY: end emit");
            if (this.buffer.length > 0) {
                while (this.buffer.length > 0) {
                    // Don't use this.emit_data() here because we don't want to
                    // re-buffer the data we're trying to emit, when we're
                    // paused and forcing the end.
                    const data = this.buffer.shift();
                    if (this.encoding) {
                        this.emit('data', data.toString(this.encoding));
                    } else {
                        this.emit('data', data);
                    }
                }
            }
            this.emit('end');
        }
    }

    pipe(dest, options) {
        const self = this;
        this.paused = false;

        const pipe = Stream.prototype.pipe.call(this, dest, options);

        dest.on('drain', () => {
            // console.log("YYY: DRAIN!!!");
            if (self.paused) self.resume();
        });
        dest.on('end', () => {
            // console.log("YYY: END!!");
            if (self.paused) self.resume();
        });
        dest.on('close', () => {
            // console.log("YYY: CLOSE!!");
            if (self.paused) self.resume();
        });

        return pipe;
    }

    setEncoding(enc) {
        if (enc !== 'binary') {
            throw 'Unable to set encoding to anything other than binary';
        }
        this.encoding = enc;
    }

    pause() {
        // console.log("YYY: PAUSE!!");
        this.paused = true;
        if (this.connection) {
            // console.log("YYYY: Backpressure pause");
            this.connection.pause();
        }
    }

    resume() {
        // console.log("YYY: RESUME!!");
        if (this.connection) {
            // console.log("YYYY: Backpressure resume");
            this.connection.resume();
        }
        this.paused = false;
        if (this.buffer.length) {
            while (this.paused === false && this.buffer.length > 0) {
                this.emit_data(this.buffer.shift());
            }
            if (this.buffer.length === 0 && this.end_emitted) {
                this.emit('end');
            }
        } else if (this.end_emitted) {
            this.emit('end');
        }
    }

    destroy() {
        // console.log("YYYY: Stream destroyed");
    }
}

exports.createStream = header => new AttachmentStream(header);
