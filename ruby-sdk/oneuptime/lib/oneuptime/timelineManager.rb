class OneUptimeTimelineManager
    def initialize(options)
        @options = options
        @timeLineStack = []
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

   
    private
    def addItemToTimeline(item)
        # get the size of the stack
        if (@options[:maxTimeline] != nil && (@timeLineStack.length() == @options[:maxTimeline].to_i))
            return # It discards new timeline update once maximum is reached
        end

        # add time to it
        # current date and time
        time = Time.now
        now = time.inspect

        item["timestamp"] = now
        
        # add a new item to the stack
        @timeLineStack.append(item)
        return true
    end
end 