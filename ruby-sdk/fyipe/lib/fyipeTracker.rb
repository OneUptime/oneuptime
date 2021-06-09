require_relative 'fyipe/util'
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
        setUpOptions(options)
        @util = Util.new(@options)
        setEventId()
    end

    def setApiUrl(apiUrl)
        @apiUrl = apiUrl + '/error-tracking/' + @errorTrackerId + '/track';
    end

    def setUpOptions(options)
        # TODO set up options
        @options = nil
    end

    def setEventId()
        @eventId = @util.v4()
    end
    
    def getEventId()
        return @eventId
    end
end
