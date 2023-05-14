enum ExceptionCode {
    NotImplementedException = 0,
    GeneralException = 1,
    APIException = 2,
    DatabaseNotConnectedException = 3,
    BadOperationException = 5,
    WebRequestException = 6,
    BadDataException = 400,
    BadRequestException = 400,
    ServerException = 500,
    NotAuthorizedException = 403,
    NotAuthenticatedxception = 401,
    PaymentRequiredException = 402,
    NotFoundException = 404,
    TimeoutException = 408,
    SsoAuthorizationException = 406,
}

export default ExceptionCode;
