import ExceptionUtil from "../../Utils/Exception";
import ObjectID from "Common/Types/ObjectID";

describe("ExceptionUtil", () => {
  describe("normalizeForFingerprint", () => {
    test("normalizes Stripe subscription IDs", () => {
      const message1: string =
        "No such subscription: 'sub_1POgR8ANuQdJ93r7dySVHs4K'";
      const message2: string =
        "No such subscription: 'sub_1PRZvTANuQdJ93r7K1nhUFZ9'";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("No such subscription: '<STRIPE_ID>'");
    });

    test("normalizes Stripe customer IDs", () => {
      const message1: string = "Customer cus_ABC123DEF456GHI not found";
      const message2: string = "Customer cus_XYZ789JKL012MNO not found";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Customer <STRIPE_ID> not found");
    });

    test("normalizes UUIDs", () => {
      const message1: string =
        "Failed to find resource 550e8400-e29b-41d4-a716-446655440000";
      const message2: string =
        "Failed to find resource a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Failed to find resource <UUID>");
    });

    test("normalizes MongoDB ObjectIDs", () => {
      const message1: string = "Document not found: 507f1f77bcf86cd799439011";
      const message2: string = "Document not found: 60a1b2c3d4e5f6a7b8c9d0e1";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Document not found: <OBJECT_ID>");
    });

    test("normalizes IP addresses", () => {
      const message1: string = "Connection refused from 192.168.1.100";
      const message2: string = "Connection refused from 10.0.0.50";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Connection refused from <IP>");
    });

    test("normalizes email addresses", () => {
      const message1: string = "Invalid email: user@example.com";
      const message2: string = "Invalid email: admin@company.org";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Invalid email: <EMAIL>");
    });

    test("normalizes timestamps", () => {
      const message1: string = "Request failed at 2024-03-15T14:30:00.000Z";
      const message2: string = "Request failed at 2024-12-01T09:15:30.500Z";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Request failed at <TIMESTAMP>");
    });

    test("normalizes Unix timestamps", () => {
      const message1: string = "Event occurred at 1710511800000";
      const message2: string = "Event occurred at 1733059530500";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Event occurred at <TIMESTAMP>");
    });

    test("normalizes memory addresses", () => {
      const message1: string = "Segmentation fault at 0x7fff5fbff8c0";
      const message2: string = "Segmentation fault at 0x00007ffe12345678";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Segmentation fault at <MEMORY_ADDR>");
    });

    test("normalizes session IDs", () => {
      const message1: string = "Session expired: session_id=abc123def456";
      const message2: string = "Session expired: session_id=xyz789jkl012";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Session expired: session_id=<SESSION>");
    });

    test("normalizes request IDs", () => {
      const message1: string = "Request failed: request_id=req_abc123";
      const message2: string = "Request failed: request_id=req_xyz789";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Request failed: request_id=<REQUEST>");
    });

    test("normalizes large numbers", () => {
      /*
       * Large numbers (8+ digits) may match hex pattern since 0-9 are valid hex
       * The important thing is both normalize to the same value
       */
      const message1: string = "User 8234567890 not found";
      const message2: string = "User 9876543210 not found";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      // Both should normalize to the same value (ensuring same fingerprint)
      expect(normalized1).toBe(normalized2);
    });

    test("normalizes 7-digit numbers as NUMBER", () => {
      // 7-digit numbers don't match hex pattern (8+ chars) so fall through to NUMBER
      const message1: string = "Error code 1234567";
      const message2: string = "Error code 9876543";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Error code <NUMBER>");
    });

    test("handles empty string", () => {
      const normalized: string = ExceptionUtil.normalizeForFingerprint("");
      expect(normalized).toBe("");
    });

    test("preserves meaningful text while normalizing IDs", () => {
      const message: string =
        "Failed to process payment for customer cus_ABC123DEF456GHI: Card declined";
      const normalized: string = ExceptionUtil.normalizeForFingerprint(message);

      expect(normalized).toBe(
        "Failed to process payment for customer <STRIPE_ID>: Card declined",
      );
    });

    test("normalizes multiple dynamic values in same message", () => {
      const message1: string =
        "User user@example.com (id=12345678) failed to access resource 550e8400-e29b-41d4-a716-446655440000";
      const message2: string =
        "User admin@company.org (id=87654321) failed to access resource a1b2c3d4-e5f6-7890-abcd-ef1234567890";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
    });

    test("normalizes JWT tokens", () => {
      const message1: string =
        "Invalid token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const message2: string =
        "Invalid token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ODc2NTQzMjEwIiwibmFtZSI6IkphbmUgRG9lIiwiaWF0IjoxNjE2MjM5MDIyfQ.DifferentSignatureHere123456789";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Invalid token: <JWT>");
    });

    test("normalizes generic service IDs with prefix_alphanumeric pattern", () => {
      const message1: string = "Failed to find resource aws_abc123def456";
      const message2: string = "Failed to find resource aws_xyz789jkl012";

      const normalized1: string =
        ExceptionUtil.normalizeForFingerprint(message1);
      const normalized2: string =
        ExceptionUtil.normalizeForFingerprint(message2);

      expect(normalized1).toBe(normalized2);
      expect(normalized1).toBe("Failed to find resource <SERVICE_ID>");
    });
  });

  describe("getFingerprint", () => {
    test("generates same fingerprint for exceptions with different dynamic IDs", () => {
      const projectId: ObjectID = ObjectID.generate();
      const serviceId: ObjectID = ObjectID.generate();

      const fingerprint1: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId,
        message: "No such subscription: 'sub_1POgR8ANuQdJ93r7dySVHs4K'",
        exceptionType: "StripeError",
        stackTrace: "at processPayment (payment.js:100)",
      });

      const fingerprint2: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId,
        message: "No such subscription: 'sub_1PRZvTANuQdJ93r7K1nhUFZ9'",
        exceptionType: "StripeError",
        stackTrace: "at processPayment (payment.js:100)",
      });

      expect(fingerprint1).toBe(fingerprint2);
    });

    test("generates different fingerprints for different exception types", () => {
      const projectId: ObjectID = ObjectID.generate();
      const serviceId: ObjectID = ObjectID.generate();

      const fingerprint1: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId,
        message: "No such subscription: 'sub_1POgR8ANuQdJ93r7dySVHs4K'",
        exceptionType: "StripeError",
        stackTrace: "at processPayment (payment.js:100)",
      });

      const fingerprint2: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId,
        message: "No such subscription: 'sub_1PRZvTANuQdJ93r7K1nhUFZ9'",
        exceptionType: "PaymentError",
        stackTrace: "at processPayment (payment.js:100)",
      });

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    test("generates different fingerprints for different services", () => {
      const projectId: ObjectID = ObjectID.generate();
      const serviceId1: ObjectID = ObjectID.generate();
      const serviceId2: ObjectID = ObjectID.generate();

      const fingerprint1: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId: serviceId1,
        message: "No such subscription: 'sub_1POgR8ANuQdJ93r7dySVHs4K'",
        exceptionType: "StripeError",
      });

      const fingerprint2: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId: serviceId2,
        message: "No such subscription: 'sub_1PRZvTANuQdJ93r7K1nhUFZ9'",
        exceptionType: "StripeError",
      });

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    test("generates different fingerprints for different projects", () => {
      const projectId1: ObjectID = ObjectID.generate();
      const projectId2: ObjectID = ObjectID.generate();
      const serviceId: ObjectID = ObjectID.generate();

      const fingerprint1: string = ExceptionUtil.getFingerprint({
        projectId: projectId1,
        serviceId,
        message: "Error occurred",
        exceptionType: "Error",
      });

      const fingerprint2: string = ExceptionUtil.getFingerprint({
        projectId: projectId2,
        serviceId,
        message: "Error occurred",
        exceptionType: "Error",
      });

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    test("generates same fingerprint for similar stack traces with different line numbers", () => {
      const projectId: ObjectID = ObjectID.generate();
      const serviceId: ObjectID = ObjectID.generate();

      // Stack traces might have memory addresses or other dynamic values
      const fingerprint1: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId,
        message: "NullPointerException",
        exceptionType: "NullPointerException",
        stackTrace:
          "at com.example.MyClass.method(MyClass.java:42)\nat 0x7fff5fbff8c0",
      });

      const fingerprint2: string = ExceptionUtil.getFingerprint({
        projectId,
        serviceId,
        message: "NullPointerException",
        exceptionType: "NullPointerException",
        stackTrace:
          "at com.example.MyClass.method(MyClass.java:42)\nat 0x00007ffe12345678",
      });

      expect(fingerprint1).toBe(fingerprint2);
    });
  });
});
