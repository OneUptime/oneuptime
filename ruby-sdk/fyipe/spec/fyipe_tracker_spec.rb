# spec/fyipe_tracker_spec.rb
require_relative '../lib/fyipeTracker'
require_relative 'helper'

RSpec.configure do |config|
    config.before(:suite){
        # using $ registers the variable as a global variable
        # ref: https://stackoverflow.com/a/19167379/6800815
        $apiUrl = 'http://localhost:3002/api'
        $helper = Helper.new()
        sampleUser = $helper.getSampleUser()
        $customTimeline = {}
        $customTimeline["category"] = "cart"
        $customTimeline["type"] = "info"
        $customTimeline["content"] = { "message": "test-content"}

        begin
            # create user
            createdUser = $helper.makeApiRequest($apiUrl+"/user/signup", sampleUser)

            # get token and project
            $token = createdUser['tokens']['jwtAccessToken']
            $project = createdUser['project']

            # create a component
            component = { 'name' => $helper.getTitle() }
            $createdComponent = $helper.makeApiRequest($apiUrl+"/component/"+$project["_id"], component, $token) 
            
            # create an errorTracker and set it as the global error tracker.
            errorTrack = { 'name' => $helper.getTitle() }
            $errorTracker = $helper.makeApiRequest($apiUrl+"/error-tracker/"+$project["_id"]+"/"+$createdComponent["_id"]+"/create", errorTrack, $token)
        rescue => exception
            puts "Couldnt create an error tracker to run a test, Error occured: #{exception.message}"
        ensure
            puts "All clear, Tests will commence now"
        end 
                        
    }
end

RSpec.describe FyipeTracker do
    it 'test_should_take_in_custom_timeline_event' do
        tracker = FyipeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        timeline = tracker.getTimeline()
        expect(timeline.class.to_s).to eql "Array"
        expect(timeline.length()).to eql 1
        expect($customTimeline["category"]).to eql timeline[0]["category"]
    end
    it 'test_should_ensure_timeline_event_contains_eventId_and_timestamp' do
        tracker = FyipeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])

        timeline = tracker.getTimeline()
        puts timeline

        expect(timeline[0]["eventId"].class.to_s).to eql "String"
        expect(timeline[0]["timestamp"].class.to_s).to eql "String"
    end
end