require 'faker'
require 'httparty'

class Helper 
    include HTTParty

    def getTitle() 
        return Faker::Movie.title
    end
    def getSampleUser()
        user = {
            'name'=> Faker::Name.name,
            'password' => '1234567890',
            'confirmPassword' => '1234567890',
            'email' => Faker::Internet.email,
            'companyName' => Faker::Company.name,
            'jobTitle' => Faker::Company.profession,
            'companySize' => Faker::Number.between(from: 1, to: 100),
            'card' => {
                'stripeToken' => 'tok_visa'
            },
            'subscription' => {
                'stripePlanId' => 0
            },
            'cardName' => Faker::Stripe.valid_token,
            'cardNumber' => Faker::Stripe.valid_card,
            'expiry' => Faker::Stripe.valid_card,
            'cvv' => 123,
            'city' => Faker::Address.city,
            'state' => Faker::Address.state,
            'zipCode' => Faker::Address.zip_code,
            'planId' => 'plan_GoWIYiX2L8hwzx',
            'companyRole' => Faker::Company.profession,
            'companyPhoneNumber' => Faker::Company.profession,
            'reference' => 'Github',
        } 
        return user
    end

    def makeApiRequest(url, data, token = nil)
        # make api request and return response 
        params = { body: data, headers: token == nil ? nil : {Authorization: 'Basic '+token}}


        response = self.class.post(url, params).parsed_response
        return response
    
    end
end 