require 'httparty'

class FyipeTransport
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
        params = { body: body }

        response = self.class.post(@apiUrl, params).parsed_response
        return response
    end
end