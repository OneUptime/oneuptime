# spec/oneuptime_logger_spec.rb
require_relative '../lib/oneuptime'
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

RSpec.describe OneUptimeLogger do
    it 'test_application_log_key_is_required' do
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], '')
        response = logger.log('test content')
        expect(response['message']).to eql 'Application Log Key is required.'
    end
    it 'test_content_is_required' do
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.log('')
        expect(response['message']).to eql 'Content to be logged is required.'
    end
    it 'test_valid_applicaiton_log_id_is_required' do
        logger = OneUptimeLogger.new($apiUrl, "5eec6f33d7d57033b3a7d502", $applicationLog["key"])
        response = logger.log('test')
        expect(response['message']).to eql 'Application Log does not exist.'
    end
    it 'test_valid_string_content_of_type_info_is_logged' do
        log = "sample content to be logged"
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.log(log)
        expect(response['content']).to eql log
        expect(response['content']).to be_an_instance_of(String)
        expect(response['type']).to eql "info"
    end
    it 'test_valid_object_content_of_type_info_is_logged' do
        log = {
            "name" => "Tony Lewinsky",
            "location" => "Liverpool"
        }
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.log(log)
        expect(response['content']["location"]).to eql log["location"]
        expect(response['content']).to be_an_instance_of(Hash)
        expect(response['type']).to eql "info"
    end
    it 'test_valid_string_content_of_type_error_is_logged' do
        log = "sample content to be logged"
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.error(log)
        expect(response['content']).to eql log
        expect(response['content']).to be_an_instance_of(String)
        expect(response['type']).to eql "error"
    end
    it 'test_valid_object_content_of_type_warning_is_logged' do
        log = {
            "name" => "Tony Lewinsky",
            "location" => "Liverpool"
        }
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.warning(log)
        expect(response['content']["location"]).to eql log["location"]
        expect(response['content']).to be_an_instance_of(Hash)
        expect(response['type']).to eql "warning"
    end
    it 'test_valid_object_content_of_type_warning_with_one_tag_is_logged' do
        log = {
            "name" => "Tony Lewinsky",
            "location" => "Liverpool"
        }
        tag = "Famous";
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.warning(log, tag)
        expect(response['content']["location"]).to eql log["location"]
        expect(response['content']).to be_an_instance_of(Hash)
        expect(response['type']).to eql "warning"
        expect(response['tags']).to be_an_instance_of(Array)
        expect(response['tags'].find { |item| item == tag }).to_not be_nil
    end
    it 'test_valid_object_content_of_type_error_with_no_tag_is_logged' do
        log = "sample content to be logged"
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.error(log)
        expect(response['content']).to eql log
        expect(response['content']).to be_an_instance_of(String)
        expect(response['type']).to eql "error"
    end
    it 'test_valid_object_content_of_type_warning_with_four_tags_is_logged' do
        log = {
            "name" => "Tony Lewinsky",
            "location" => "Liverpool"
        }
        tags = ['testing', 'rubylansh', 'trial', 'correct']
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        response = logger.warning(log, tags)
        expect(response['content']["location"]).to eql log["location"]
        expect(response['content']).to be_an_instance_of(Hash)
        expect(response['type']).to eql "warning"
        expect(response['tags']).to be_an_instance_of(Array)
        tags.each {
            |tag| expect(response['tags'].find { |item| item == tag }).to_not be_nil
        }

    end
    it 'test_valid_object_content_of_type_warning_return_invalid_tags' do
        log = {
            "name" => "Tony Lewinsky",
            "location" => "Liverpool"
        }
        tags = {"content" => "test"}
        logger = OneUptimeLogger.new($apiUrl, $applicationLog["_id"], $applicationLog["key"])
        begin
            response = logger.warning(log, tags)
        rescue => exception
            expect(exception.message).to eql 'Invalid Content Tags to be logged'
        ensure
            
        end
        
    end
end