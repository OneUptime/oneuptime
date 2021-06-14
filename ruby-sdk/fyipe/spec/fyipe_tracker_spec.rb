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

        expect(timeline[0]["eventId"].class.to_s).to eql "String"
        expect(timeline[0]["timestamp"].class.to_s).to eql "String"
    end
    it 'test_should_ensure_different_timeline_event_have_the_same_eventId' do
        tracker = FyipeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], "error")

        timeline = tracker.getTimeline()
        expect(timeline.length()).to eql 2 # two timeline events
        expect(timeline[0]["eventId"]).to eql timeline[1]["eventId"] # their eventId is the same, till there is an error sent to the server
    end
    it 'test_should_ensure_max_timline_cant_be_set_as_a_negative_number' do
        options = {
            "maxTimeline": -5
        }
        tracker = FyipeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"], options)

        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], "error")

        timeline = tracker.getTimeline()
        expect(timeline.length()).to eql 2 # two timeline events
    end
    it 'test_should_ensure_new_timeline_event_after_max_timeline_are_discarded' do
        options = {
            "maxTimeline": 2
        }
        tracker = FyipeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"], options)

        customTimeline2 = {}

        customTimeline2["category"] = "logout"
        customTimeline2["type"] = "success"
        customTimeline2["content"] = {"message": "tester"}

        # add 3 timeline events
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        tracker.addToTimeline(customTimeline2["category"], customTimeline2["content"], customTimeline2["type"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], "debug")

        timeline = tracker.getTimeline()
        
        expect(options[:maxTimeline]).to eql timeline.length() # three timeline events
        expect(timeline[0]["type"]).to eql $customTimeline["type"]
        expect(timeline[1]["category"]).to eql customTimeline2["category"]
    end

end