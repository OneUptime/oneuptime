require 'securerandom'

class Util 

    def initialize(options)
        @options = options
    end

    def v4()
        return SecureRandom.uuid
    end
end