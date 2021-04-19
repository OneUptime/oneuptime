import unittest
from faker import Faker


class LoggerTest(unittest.TestCase):

    def setUp(self):
        self.fake = Faker()
        self.setUserObject()
    
    def setUserObject(self):
        self.user = {
            'name': self.fake.name(),
            'password': '1234567890',
            'confirmPassword': '1234567890',
            'email': self.fake.ascii_company_email(),
            'companyName': self.fake.company(),
            'jobRole': self.fake.job(),
            'compannySize': self.fake.random_int(),
            'card': { 
                'stripeToken': 'tok_visa'
            },
            'subscription': {
                'stripePlanId': 0
            },
            'cardName': self.fake.credit_card_provider(),
            'cardNumber': self.fake.credit_card_number(),
            'cvv': self.fake.credit_card_security_code(),
            'expiry': self.fake.credit_card_expire(),
            'city': self.fake.city(),
            'state': self.fake.country(),
            'zipCode': self.fake.postcode(),
            'companyRole': self.fake.job(),
            'companyPhoneNumber': self.fake.phone_number(),
            'planId': 'plan_GoWIYiX2L8hwzx',
            'reference': 'Github'
        }
        return self

    def testIfTestStarts(self):
        print(self.user)
        self.assertEqual(5+5, 11, "Testing")

if __name__ == '__main__':
    unittest.main()