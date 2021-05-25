# spec/fyipe_logger_spec.rb
require_relative '../lib/fyipe'
require_relative 'helper'

RSpec.configure do |config|
    config.before(:suite){
        # using $ registers the variable as a global variable
        # ref: https://stackoverflow.com/a/19167379/6800815
        # $logger = FyipeLogger.new()
        $apiUrl = 'http://localhost:3002/api'
        $helper = Helper.new()
        sampleUser = $helper.getSampleUser()

        begin
            # create user
            createdUser = $helper.makeApiRequest($apiUrl+"/user/signup", sampleUser)

            # get token and project
            $token = createdUser['tokens']['jwtAccessToken']
            $project = createdUser['project']

            # create a component
            component = { 'name' => $helper.getTitle() }
            $createdComponent = $helper.makeApiRequest($apiUrl+"/component/"+$project["_id"], component, $token) 
            
            # create an applicationlog and set it as the global application Log.
            appLog = { 'name' => $helper.getTitle() }
            $applicationLog = $helper.makeApiRequest($apiUrl+"/application-log/"+$project["_id"]+"/"+$createdComponent["_id"]+"/create", appLog, $token)
        rescue => exception
            puts "Couldnt create an application log to run a test, Error occured: " + exception.message
        ensure
            puts "All clear, Tests will commence now"
        end 
                        
    }
end
RSpec.describe FyipeLogger do
  context "#world" do
    it { expect('hello world').to eql 'hello world' }
  end
end