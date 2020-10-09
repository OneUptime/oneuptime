class FyipeTimelineManager {
    #timeLineStack = [];
    // Todo proper way to manage the max items config
    #MAX_ITEMS_ALLOWED_IN_STACK = 100;
    #MAX_ITEMS_SET_BY_USER = 100;

    _addItemToTimeline(item) {
        // get the size of the stack
        if (this.#timeLineStack.length === this.#MAX_ITEMS_SET_BY_USER) {
            this.#timeLineStack.shift(); // remove the oldest item
        }
        // add time to it
        item.timestamp = Date.now();
        // add a new item to the stack
        this.#timeLineStack.push(item);
        return true;
    }
    addToTimeline(item) {
        this._addItemToTimeline(item);
        // Temporary showing the stack here in the console
        // eslint-disable-next-line no-console
        console.log(this.#timeLineStack);
    }
    // return the timeline
    getTimeline() {
        return this.#timeLineStack;
    }
}
export default FyipeTimelineManager;
