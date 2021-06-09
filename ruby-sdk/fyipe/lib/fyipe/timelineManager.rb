class FyipeTimelineManager
    def initialize(options)
        @options = options
        @timelineStack = []
    end

    def addToTimeline(item)
        addItemToTimeline(item)
    end
    
    # return the timeline
    def getTimeline()
        return @timeLineStack
    end
    
    # clear the timeline
    def clearTimeline()
        @timeLineStack = []
    end 

    private_class_method def addItemToTimeline(item)
        # get the size of the stack
        if (@options['maxTimeline'] != nil and (@timeLineStack.length() == @options['maxTimeline']))
            return # It discards new timeline update once maximum is reached
        end

        # add time to it
        # current date and time
        time = Time.now
        now = time.inspect

        item["timestamp"] = now
        
        # add a new item to the stack
        @timeLineStack.push(item)
        return true
    end
end 