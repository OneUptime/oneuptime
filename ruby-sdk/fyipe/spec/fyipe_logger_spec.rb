# spec/fyipe_logger_spec.rb
require_relative '../lib/fyipe'
require_relative 'helper'

RSpec.configure do |config|
    config.before(:suite){
        # using $ registers the variable as a global variable
        # ref: https://stackoverflow.com/a/19167379/6800815
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
            puts "Couldnt create an application log to run a test, Error occured: #{exception.message}"
        ensure
            puts "All clear, Tests will commence now"
        end 
                        
    }
end

RSpec.describe FyipeLogger do
    it 'test_application_log_key_is_required' do
        logger = FyipeLogger.new($apiUrl, $applicationLog["_id"], '')
        response = logger.log('test content')
        expect(response['message']).to eql 'Application Log Key is required.'
    end
    it 'test_content_is_required' do
        logger = FyipeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.log('')
        expect(response['message']).to eql 'Content to be logged is required.'
    end
    it 'test_valid_applicaiton_log_id_is_required' do
        logger = FyipeLogger.new($apiUrl, "5eec6f33d7d57033b3a7d502", $applicationLog["key"])
        response = logger.log('test')
        expect(response['message']).to eql 'Application Log does not exist.'
    end
end