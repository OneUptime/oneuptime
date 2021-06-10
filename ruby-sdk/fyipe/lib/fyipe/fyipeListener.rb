require_relative 'timelineManager'
require_relative 'util'

class FyipeListener
    def initialize(eventId, options)
        # start the timeline manager
        @timelineObj = FyipeTimelineManager.new(options)
        @currentEventId = eventId
        @utilObj = Util.new(options)
    end

    def logErrorEvent(content, category = 'exception')

        timelineObj = {
            "category": category,
            "data": content,
            "type": @utilObj.getErrorType('ERROR'),
            "eventId": @currentEventId
        } 

        # add timeline to the stack
        @timelineObj.addToTimeline(timelineObj)
    end

    def logCustomTimelineEvent(timelineObj)
        timelineObj["eventId"] = @currentEventId

        # add timeline to the stack
        @timelineObj.addToTimeline(timelineObj)
    end

    def getTimeline()
        # this always get the current state of the timeline array
        return @timelineObj.getTimeline()
    end

    def clearTimeline(eventId)
        # set a new eventId
        @currentEventId = eventId
        # this will reset the state of the timeline array
        return @timelineObj.clearTimeline()
    end
    
end