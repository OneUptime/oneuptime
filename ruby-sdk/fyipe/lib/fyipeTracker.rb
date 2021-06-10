require_relative 'fyipe/util'
require_relative 'fyipe/fyipeListener'
class FyipeTracker
    # FyipeLogger constructor.
    # @param string apiUrl
    # @param string errorTrackerId
    # @param string errorTrackerKey
    
    def initialize(apiUrl, errorTrackerId, errorTrackerKey, options = [])
        # instance variable intialzation
        @errorTrackerId = errorTrackerId
        setApiUrl(apiUrl) 
        @errorTrackerKey = errorTrackerKey
        @tags = []
        @fingerprint = []
        @options = {
            'maxTimeline': 5
        }
        setUpOptions(options)
        @util = Util.new(@options)
        setEventId()
        @listenerObj = FyipeListener.new(getEventId(), @options)
    end

    def setApiUrl(apiUrl)
        @apiUrl = apiUrl + '/error-tracking/' + @errorTrackerId + '/track';
    end

    def setUpOptions(options)
        # TODO set up options
        # @options = nil
    end

    def setEventId()
        @eventId = @util.v4()
    end
    
    def getEventId()
        return @eventId
    end

    def addToTimeline(category, content, type)
        timelineObj =  {
            "category": category,
            "data": content,
            "type": type
        }

        @listenerObj.logCustomTimelineEvent(timelineObj)
    end

    def getTimeline()
        return @listenerObj.getTimeline()
    end
end
