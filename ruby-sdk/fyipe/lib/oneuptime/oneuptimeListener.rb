require_relative 'timelineManager'
require_relative 'util'

class OneUptimeListener
    def initialize(eventId, options)
        # start the timeline manager
        @timelineObj = OneUptimeTimelineManager.new(options)
        @currentEventId = eventId
        @utilObj = Util.new(options)
    end

    def logErrorEvent(content, category = 'exception')
        timelineObj = {}
        timelineObj["category"]= category
        timelineObj["data"]= content
        timelineObj["type"]= @utilObj.getErrorType('ERROR')
        timelineObj["eventId"]= @currentEventId

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