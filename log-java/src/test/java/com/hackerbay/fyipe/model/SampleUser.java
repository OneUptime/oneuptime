package test.java.com.hackerbay.fyipe.model;

public class SampleUser {
    private String name;
    private String email;
    private String password;
    private String confirmPassword;
    private String companyName;
    private String jobRole;
    private int companySize;
    private String cardName;
    private String cardNumber;
    private String cvv;
    private String expiry;
    private String city;
    private String state;
    private String zipCode;
    private String country;
    private String planId;
    private String companyRole;
    private String companyPhoneNumber;
    private String reference;

    public SampleUser(String name, String email, String password, String confirmPassword, String companyName, String jobRole, int companySize, String cardName, String cardNumber, String cvv, String expiry, String city, String state, String zipCode, String country, String planId, String companyRole, String companyPhoneNumber, String reference) {
        this.name = name;
        this.email = email;
        this.password = password;
        this.confirmPassword = confirmPassword;
        this.companyName = companyName;
        this.jobRole = jobRole;
        this.companySize = companySize;
        this.cardName = cardName;
        this.cardNumber = cardNumber;
        this.cvv = cvv;
        this.expiry = expiry;
        this.city = city;
        this.state = state;
        this.zipCode = zipCode;
        this.country = country;
        this.planId = planId;
        this.companyRole = companyRole;
        this.companyPhoneNumber = companyPhoneNumber;
        this.reference = reference;
    }
}
