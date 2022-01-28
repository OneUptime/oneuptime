require 'httparty'

class OneUptimeTransport
    include HTTParty

    def initialize( apiUrl)
        # set up the api transporter
        @apiUrl = apiUrl
    end
    
    def sendErrorEventToServer(event)
        response = makeApiRequest(event)
        return response
    end

    private
    def makeApiRequest(body)
        # make api request and return response

        response = self.class.post(@apiUrl, :headers => {'Content-Type'=>'application/json'}, :body => body.to_json).parsed_response

        return response
    end
end