class FyipeTimelineManager {
    constructor(options) {
        this.options = options;
        this.timeLineStack = [];
    }
    _addItemToTimeline(item) {
        // get the size of the stack
        if (this.timeLineStack.length === this.options.maxTimeline) {
            // this.timeLineStack.shift(); // remove the oldest item
            return; // It discards new timline update once maximum is reached
        }
        // add time to it
        item.timestamp = Date.now();
        // add a new item to the stack
        this.timeLineStack.push(item);
        return true;
    }
    addToTimeline(item) {
        this._addItemToTimeline(item);
    }
    // return the timeline
    getTimeline() {
        return this.timeLineStack;
    }
    // clear the timeline
    clearTimeline() {
        this.timeLineStack = [];
    }
}
export default FyipeTimelineManager;
