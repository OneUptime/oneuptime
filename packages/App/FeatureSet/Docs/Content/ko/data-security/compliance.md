# 데이터 보안 규정 준수

데이터 보안은 스캔에서 찾은 것으로 아홉 개 프레임워크의 점수를 매깁니다. 각 프레임워크는 그 규칙이 다루는 저장소를 대상으로 하며(GDPR은 개인 데이터가 있는 저장소, PCI DSS는 카드 데이터가 발견된 저장소, SOC 2는 모든 저장소), 각 요구 사항은 그 증거가 되는 검사에 따라 충족되거나 실패합니다. **데이터 보안 → 규정 준수** 에는 각 프레임워크의 점수, 대상 저장소 수, 그리고 모든 요구 사항과 그 요구 사항을 실패시키는 열린 이슈 수가 표시됩니다. 데이터 저장소가 있는 각 리소스(Kubernetes 클러스터, Docker 또는 Podman 호스트, 데이터베이스, 서비스, 클라우드 리소스)에도 같은 페이지가 따로 있으며, 그 리소스에 해당하지 않는 것은 거기에서 끌 수 있습니다. 점수는 인증서가 아니라 감사를 위한 증거입니다. OneUptime이 읽는 저장소에 대해 볼 수 있는 것을 알려 줄 뿐입니다.

:::cards
- [프레임워크](#프레임워크): 아홉 개 프레임워크와 각각이 대상으로 하는 저장소.
- [프레임워크의 점수 산정 방식](#프레임워크의-점수-산정-방식): 통과, 실패, 평가되지 않은 요구 사항.
- [리소스 페이지에서](#리소스-페이지에서): 클러스터, 호스트, 데이터베이스, 서비스 또는 클라우드 리소스 하나의 규정 준수와 그 리소스에서 꺼 둔 것.
- [요구 사항과 검사](#요구-사항과-검사): 모든 요구 사항과 그 증거가 되는 검사.
- [처리 활동 기록](#처리-활동-기록): 저장소를 바탕으로 작성되는 GDPR 제30조 기록과, 확인을 기다리는 OneUptime AI의 초안.
- [영향 평가](#영향-평가): 영향 평가가 필요한 각 저장소의 데이터 보호 영향 평가.
- [감사 증거](#감사-증거): 감사인이 각 요구 사항 아래에서 읽는 내용으로, 기록 및 이슈 이력과 함께 내보냅니다.
:::

## 프레임워크

| 프레임워크 | 정식 명칭 | 대상 저장소 |
| --- | --- | --- |
| GDPR | EU 일반 개인정보 보호 규정 | 개인 데이터가 있는 저장소. |
| CCPA | CPRA로 개정된 캘리포니아 소비자 개인정보 보호법 | 개인 정보가 있는 저장소. |
| HIPAA | HIPAA 보안 규칙 | 건강 데이터가 있는 저장소. |
| PCI DSS | PCI DSS v4.0 | 카드 번호가 발견된 저장소. |
| SOC 2 | SOC 2 신뢰 서비스 기준 | 모든 데이터 저장소. |
| ISO 27001 | ISO/IEC 27001:2022 | 모든 데이터 저장소. |
| NIST CSF | NIST 사이버보안 프레임워크 2.0 | 모든 데이터 저장소. |
| LGPD | 브라질 일반 개인정보 보호법 | 브라질에 있는 사람의 개인 데이터가 있는 저장소. |
| DPDP | 2023년 인도 디지털 개인정보 보호법 | 인도에 있는 사람의 개인 데이터가 있는 저장소. |

## 프레임워크가 대상으로 하는 저장소

저장소가 어떤 프레임워크의 대상인지는 그 안에서 발견된 데이터로 정해지므로, 스캔이 더 많은 것을 찾으면 바뀝니다.

- **SOC 2, ISO 27001, NIST CSF** 는 보안 프레임워크입니다. 무엇이 들어 있든 모든 저장소를 대상으로 합니다.
- **GDPR, CCPA, HIPAA, PCI DSS** 는 자신이 보호하는 데이터 유형이 있는 저장소를 대상으로 합니다. 개인 데이터가 있으면 GDPR과 CCPA가, 건강 데이터가 있으면 HIPAA도, 카드 번호, 카드 보안 코드, 카드 만료일이 있으면 PCI DSS가 대상이 됩니다. 시크릿이나 비즈니스 문서만 있는 저장소는 어느 것의 대상도 아닙니다.
- **LGPD와 DPDP** 는 각 국가의 고유한 법입니다. 브라질 CPF나 인도 Aadhaar 번호처럼 그 국가에 속한 데이터 유형으로 판단해, 브라질이나 인도에 있는 사람의 개인 데이터가 있는 저장소를 대상으로 합니다.

[민감한 데이터 유형](/docs/data-security/data-types#기본-제공-데이터-유형)에는 모든 데이터 유형이 그 국가와 함께 나열되어 있습니다.

## 프레임워크의 점수 산정 방식

```mermaid title="요구 사항 하나가 결정되는 방식"
flowchart TB
    start["프레임워크의<br/>요구 사항 하나"] --> evaluated{"대상 저장소 중 읽거나<br/>스캔한 것이 있는가?"}
    evaluated -->|"아니요"| none["평가되지 않음"]
    evaluated -->|"예"| open{"그 검사의 열린 이슈가<br/>대상 저장소에<br/>있는가?"}
    open -->|"예"| failing["실패"]
    open -->|"아니요"| passing["통과"]
```

- 요구 사항에 매핑된 검사의 열린 이슈가 프레임워크의 대상 저장소에 하나도 없으면 **요구 사항은 통과하고**, 하나라도 있으면 **실패합니다**.
- 대상 저장소 중 구성을 읽었거나 콘텐츠를 스캔한 저장소가 하나도 없는 동안에는 **평가되지 않습니다**.
- **두 가지 요구 사항은 데이터 보안 자체로 충족됩니다**: GDPR 제30조(처리 활동 기록)와 ISO 27001 A.5.12(정보 분류)입니다. 이 둘은 모든 대상 저장소를 읽거나 스캔하면 통과하고, 그렇지 않은 저장소가 하나라도 있는 동안에는 실패합니다.
- 대상 저장소가 모두 그 요구 사항을 끈 리소스에 속해 있으면 요구 사항이 **꺼집니다**([리소스 페이지에서](#리소스-페이지에서) 참고).
- **점수** 는 프레임워크의 평가된 요구 사항 중 통과한 것의 비율을 정수 백분율로 나타낸 것입니다. 꺼진 요구 사항은 통과로도 실패로도 세지 않습니다. 평가된 것이 없는 프레임워크에는 점수가 없습니다.

열린 이슈만 셉니다. 위험이 수락된 이슈나 문제 아님으로 표시된 이슈는 요구 사항을 실패시키지 않으므로, 수락된 위험은 감사에서 이슈를 통해 확인할 수 있는 결정이 됩니다. 누가, 왜, 언제까지 수락했는지가 남습니다.

## 리소스 페이지에서

데이터 보안을 사용하는 프로젝트에서 리소스에 데이터 보안이 알고 있는 데이터 저장소가 생기면, 데이터 저장소를 읽을 수 있는 사람에게는 그 리소스의 메뉴에 **보안** 섹션이 표시됩니다. 이 섹션은 열기 전까지 접혀 있습니다. 리소스별 데이터 저장소는 다음과 같습니다.

| 리소스 | 해당 데이터 저장소 |
| --- | --- |
| Kubernetes 클러스터 | 그 위에서 실행되는 데이터베이스 |
| Docker 또는 Podman 호스트 | 그 위에서 실행되는 데이터베이스 |
| 데이터베이스 | 데이터베이스 자체 |
| 서비스 | 서비스의 텔레메트리: 서비스가 보내는 로그, 트레이스, 예외 |
| 클라우드 리소스 | 리소스 자체인 버킷, 데이터베이스 또는 웨어하우스 |

- **데이터 보안** 은 그 저장소들을 위험이 큰 것부터 나열하고, 그 저장소의 열린 이슈도 함께 보여 줍니다. 각 항목은 데이터 보안에서 열리며, 처리도 그곳에서 합니다.
- **규정 준수** 는 그 저장소들만을 대상으로 프레임워크의 점수를 매깁니다. 저장소의 데이터 때문에 대상이 되는 프레임워크가 먼저 나오고, 꺼진 프레임워크와 어느 저장소에도 해당 데이터가 없는 프레임워크는 그 아래에 접혀 있습니다.

각 프레임워크에는 **여기에 적용** 스위치가 있고, 각 요구 사항에도 있습니다. 스위치를 끄면 리소스 페이지에서도, 리소스에서 꺼진 저장소 수를 알려 주는 **데이터 보안 → 규정 준수** 에서도 그 리소스의 저장소가 그 프레임워크나 요구 사항의 대상에서 빠집니다. 다시 켜면 대상으로 돌아옵니다. 모든 스위치는 즉시 저장되며, 각 변경은 프로젝트의 [감사 로그](/docs/configuration/audit-logs)에 기록됩니다.

스위치를 끄면 이어서 그 아래에 **여기에 적용되지 않는 이유는 무엇인가요?** 라는 질문이 나타납니다. 사유는 선택 사항입니다. 짧게 작성하고 **사유 저장** 을 선택하거나, 작성하지 않으려면 **나중에** 를 선택하세요. 그 후에는 누가 언제 껐는지와 그 사유가 표시되며, 나중에 **사유 추가** 또는 **사유 편집** 으로 사유를 작성하거나 변경할 수 있습니다. 스위치와 마찬가지로 사유도 감사 로그에 기록됩니다.

**데이터 보안 → 규정 준수** 에는 모든 리소스에 대해 같은 내용이 표시됩니다. 프레임워크를 선택하면 **프레임워크 전체에서 꺼짐** 아래에 그 프레임워크 전체를 끈 리소스가 나열되고, 각 요구 사항의 상태 아래에는 그 요구 사항을 끈 리소스가 표시됩니다. 각 리소스는 자체 규정 준수 페이지로 연결되며, 누가, 언제, 왜 껐는지가 함께 표시됩니다. 이 페이지의 **CSV 내보내기** 에는 `Turned Off On` 열로, **JSON 내보내기** 에는 `turnedOff` 목록으로 들어 있습니다.

저장소는 한 리소스의 스위치만 따릅니다. Kubernetes 클러스터나 Docker 또는 Podman 호스트에서 실행되는 데이터베이스는 그 클러스터나 호스트의 스위치를 따릅니다. 클러스터에서 프레임워크를 끄면 그 위의 모든 데이터베이스에서 꺼집니다. 데이터베이스 자체의 규정 준수 페이지는 이를 알려 주고 그곳으로 연결되며, 스위치는 잠겨 있습니다.

보안 구성원, 보안 관리자, 프로젝트 관리자, 프로젝트 소유자는 검사를 조정할 수 있는 것처럼 프레임워크와 요구 사항을 켜고 끌 수 있습니다. 보안 뷰어는 무엇이 꺼져 있는지와 그 이유를 볼 수 있습니다.

## 요구 사항과 검사

### GDPR

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| 제5조(1)(c) | 데이터 최소화 | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| 제5조(1)(e) | 저장 제한 | `stale-sensitive-data` |
| 제25조 | 설계 및 기본 설정에 의한 데이터 보호 | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| 제28조 | 처리자 | `sensitive-data-to-ai` |
| 제30조 | 처리 활동 기록 | 데이터 보안 자체로 충족 |
| 제32조 | 처리의 보안 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `not-encrypted-at-rest`, `no-customer-managed-key`, `encryption-in-transit-not-enforced`, `weak-tls`, `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable`, `access-not-logged`, `shared-key-access`, `object-acls-enabled`, `many-readers`, `unused-access`, `secrets-stored`, `plaintext-passwords`, `secrets-in-telemetry` |
| 제44-49조 | 제삼국으로의 이전 | `residency-violation` |

### CCPA

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| 1798.100(c) | 필요한 범위로 제한된 수집 | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| 1798.150 | 합리적인 보안 절차 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `shared-key-access`, `object-acls-enabled`, `many-readers` |

### HIPAA

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| 164.308(a)(4) | 정보 접근 관리 | `unused-access` |
| 164.308(a)(7) | 비상 계획 | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| 164.312(a)(1) | 접근 통제 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| 164.312(a)(2)(iv) | 암호화 및 복호화 | `not-encrypted-at-rest`, `no-customer-managed-key` |
| 164.312(b) | 감사 통제 | `access-not-logged` |
| 164.312(e)(1) | 전송 보안 | `encryption-in-transit-not-enforced`, `weak-tls` |

### PCI DSS

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| 3.3.1 | 민감한 인증 데이터를 승인 후에 보관하지 않음 | `card-security-codes-stored` |
| 3.4.1 | 카드 번호는 표시될 때 마스킹됨 | `card-numbers-readable`, `sensitive-data-in-telemetry` |
| 3.5.1 | 카드 번호는 어디에 저장되든 읽을 수 없음 | `not-encrypted-at-rest`, `no-customer-managed-key`, `card-numbers-readable` |
| 4.2.1 | 강력한 암호화로 전송 중인 카드 데이터를 보호 | `encryption-in-transit-not-enforced`, `weak-tls` |
| 7.2 | 필요에 따라 접근 권한을 정의하고 부여 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| 7.2.4 | 계정과 그 접근 권한을 검토함 | `unused-access` |
| 8.3.2 | 인증 요소는 저장될 때 읽을 수 없음 | `plaintext-passwords` |
| 10.2 | 감사 로그가 카드 데이터에 대한 접근을 기록 | `access-not-logged` |

### SOC 2

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| A1.2 | 백업 및 복구 | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| CC6.1 | 논리적 접근 보안 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `not-encrypted-at-rest`, `no-customer-managed-key`, `shared-key-access`, `object-acls-enabled`, `many-readers`, `secrets-stored`, `plaintext-passwords`, `secrets-in-telemetry` |
| CC6.2 | 더 이상 필요하지 않은 접근 권한을 제거함 | `unused-access` |
| CC6.7 | 정보 전송 | `encryption-in-transit-not-enforced`, `weak-tls` |
| CC7.2 | 시스템 구성 요소 모니터링 | `access-not-logged` |

### ISO 27001

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| A.5.9 | 정보 및 기타 관련 자산의 목록 | `no-owner` |
| A.5.12 | 정보 분류 | 데이터 보안 자체로 충족 |
| A.5.15 | 접근 통제 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| A.5.18 | 접근 권한 | `unused-access` |
| A.5.34 | 개인정보 보호 및 PII 보호 | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| A.8.11 | 데이터 마스킹 | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| A.8.12 | 데이터 유출 방지 | `secrets-stored`, `secrets-in-telemetry` |
| A.8.13 | 정보 백업 | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| A.8.15 | 로깅 | `access-not-logged` |
| A.8.24 | 암호화 사용 | `not-encrypted-at-rest`, `no-customer-managed-key`, `encryption-in-transit-not-enforced`, `weak-tls`, `plaintext-passwords` |

### NIST CSF

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| ID.AM-07 | 데이터와 메타데이터의 목록을 유지 | `no-owner` |
| PR.AA-05 | 접근 권한을 관리 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `shared-key-access`, `object-acls-enabled`, `many-readers`, `unused-access` |
| PR.DS-01 | 저장된 데이터를 보호 | `not-encrypted-at-rest`, `no-customer-managed-key`, `secrets-stored`, `secrets-in-telemetry` |
| PR.DS-02 | 전송 중인 데이터를 보호 | `encryption-in-transit-not-enforced`, `weak-tls` |
| PR.DS-11 | 데이터 백업을 보관하고 테스트 | `no-backups`, `no-point-in-time-recovery`, `deletion-protection-off`, `deleted-data-not-recoverable` |
| DE.CM-09 | 데이터와 그 사용을 모니터링 | `access-not-logged` |

### LGPD

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| 제6조 | 필요성 및 목적 제한 | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| 제33조 | 데이터의 국제 이전 | `residency-violation` |
| 제46조 | 보안 조치 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `not-encrypted-at-rest`, `no-customer-managed-key`, `shared-key-access`, `object-acls-enabled`, `many-readers` |

### DPDP

| 요구 사항 | 요구 내용 | 검사 |
| --- | --- | --- |
| 제8조(5) | 합리적인 보안 보호 조치 | `public-read`, `public-write`, `public-access-not-blocked`, `internet-reachable`, `open-to-all-addresses`, `snapshot-public`, `snapshot-shared-externally`, `shared-with-external-accounts`, `readable-without-credentials`, `not-encrypted-at-rest`, `no-customer-managed-key`, `shared-key-access`, `object-acls-enabled`, `many-readers` |
| 제8조(7) | 목적 달성 시 삭제 | `production-data-in-non-production`, `stale-sensitive-data`, `new-personal-data-column`, `sensitive-data-in-telemetry`, `sensitive-data-to-ai`, `sensitive-data-in-ai-store` |
| 제16조 | 인도 밖으로의 이전 | `residency-violation` |

## 처리 활동 기록

GDPR 제30조는 처리 활동의 기록을 보관하도록 요구합니다. 데이터 보안은 그중 개인 데이터가 어디에 보관되는지에 관한 부분을 작성합니다. 개인 데이터가 있는 저장소마다 한 행입니다. 이 기록은 **데이터 보안 → 규정 준수** 맨 아래의 **처리 기록** 카드이며, **CSV 내보내기** 와 **JSON 내보내기** 가 있습니다.

| 열 | 출처 |
| --- | --- |
| 저장소, 종류, 공급자, 지역 | Discovery |
| 환경 | 저장소의 태그나 이름, 또는 직접 설정한 값 |
| 민감도, 범주, 데이터 유형 | 스캔이 찾은 것, 또는 직접 설정한 민감도 |
| 소유자 | 저장소의 소유자: 사람과 소유 팀의 구성원 |
| 목적 | 저장소의 **목적** 에 작성하거나 확인한 내용: 개인 데이터를 가지고 있는 이유. OneUptime이 보안을 위해 보관하는 저장소는 OneUptime이 채웁니다 |
| 보존 | 저장소의 **보존** 에 작성하거나 확인한 내용: 데이터를 보관하는 기간. OneUptime이 보안을 위해 보관하는 저장소는 OneUptime이 채우고, 서비스의 텔레메트리는 프로젝트의 텔레메트리 보존 기간으로 채웁니다 |
| 읽을 수 있는 대상 | OneUptime이 보안을 위해 보관하는 저장소를 읽을 수 있는 대상 |
| 프레임워크 | 데이터 유형에 따라 대상이 되는 프레임워크 |
| 선언한 주체 | OneUptime이 보안을 위해 보관하는 저장소는 OneUptime |
| 법적 근거 | 작성하거나 확인한 내용: GDPR 제6조에 따른 저장소의 법적 근거로, 동의, 계약, 법적 의무, 중대한 이익, 공익 업무, 정당한 이익 중 하나입니다. OneUptime이 보안을 위해 보관하는 저장소는 정당한 이익입니다 |
| 데이터 주체 | 작성하거나 확인한 내용: 저장소의 데이터가 누구에 관한 것인지. 예: 고객, 사용자, 직원, 환자 |
| 수령인 | 저장소의 데이터 흐름에서 산출: 데이터를 보내는 외부 호스트와 AI 공급자, 그리고 데이터 사본이 있는 저장소 |
| 이전 | 저장소의 지역, 클라우드가 데이터를 복사하는 지역, 사본의 지역을 데이터 주체가 있는 국가와 비교해 산출: 그 국가 밖으로의 각 이전, 또는 알 수 없는 이유 |
| 영향 평가 | 저장소에 데이터 보호 영향 평가가 필요한지와 그 상태: 필요하지 않음, 필요, 초안 작성됨, 편집됨 |
| 검토 대기 | 초안이 사람을 기다리는 필드. 초안은 누군가 확인하기 전까지 기록에도, 기록의 내보내기에도 들어가지 않습니다 |

데이터 보안이 찾은 저장소는 개인 데이터를 가지고 있는 이유, 보관 기간, 근거, 누구에 관한 데이터인지를 어떤 스캔으로도 알 수 없습니다. **설정** 에서 작성하거나 OneUptime AI의 초안을 확인하세요. 기록과 점수는 데이터 저장소를 읽을 수 있는 사람이라면 누구나 데이터 보안 API의 `/data-security/record-of-processing`, `/data-security/compliance`, 그리고 리소스 하나에 대해서는 `/data-security/resource-compliance` 에서도 받을 수 있습니다([데이터 보안 통합](/docs/data-security/integrations#api-terraform-및-mcp) 참고).

### OneUptime AI의 초안

OneUptime AI는 데이터 보안이 저장소에 대해 아는 내용으로 저장소의 **목적**, **보존**, **법적 근거**, **데이터 주체** 초안을 작성합니다. 발견된 데이터 유형, 저장소의 이름, 태그, 설명, 저장소를 사용하는 서비스와 해당 팀이 작성한 서비스의 용도, 데이터가 가는 곳과 보관되는 곳입니다. 데이터의 값은 절대 보지 않습니다([데이터 보안의 OneUptime AI](/docs/data-security/ai) 참고).

- **초안에는 초안 표시가 붙고** 이유가 함께 나오며, 근거가 된 사실은 클릭 한 번으로 볼 수 있습니다. **확인** 을 누르거나 **편집** 해 직접 쓴 내용으로 바꾸기 전까지는 기록에 들어가지 않습니다.
- **직접 쓴 내용은 초안으로 덮어쓰지 않습니다.** 직접 작성한 필드는 다시 초안으로 작성되지 않습니다. 확인한 초안은 근거가 된 사실이 바뀔 때만 다시 작성되며, 그때도 적용되지 않고 제안됩니다. **변경 제안됨** 으로 표시되고, 바뀐 내용과 **새 초안 사용**, **현재 값 유지** 가 함께 나옵니다.
- **처리 기록** 카드의 **초안 검토** 는 초안이 사용자를 기다리는 저장소를 하나씩 차례로 보여 줍니다. 저장소의 **설정** 에도 같은 필드가 있으며, 비어 있는 필드에는 **OneUptime AI로 초안 작성** 이 있습니다.
- **스스로**, OneUptime AI는 **데이터 보안 → AI** 에서 **새 이슈 처리** 가 켜져 있는 동안 AI 규칙이 허용하는 대로, 위험이 가장 큰 저장소의 비어 있는 필드 초안을 하루에 한 번 작성합니다.

서비스 텔레메트리의 보존 기간, 수령인, 이전은 일반 코드로 산출되며 초안으로 작성되지 않습니다. 초안은 출발점일 뿐 법률 자문이 아닙니다. 규정 준수를 책임지는 사람에게 검토를 받으세요.

### OneUptime이 보안을 위해 보관하는 저장소

네 저장소는 네트워크를 보호하려고 일부러 IP 주소와 사용자 이름을 보관합니다. **보안 이벤트**, **Network Flows**, **보안 주소 보관소**, **보안 사용자 보관소** 입니다. 기록에는 프로젝트에 있는 저장소가 각각 나옵니다. OneUptime은 이 저장소들을 찾는 대신 선언합니다. 무엇을 보관하는지 설계상 알고 있으므로 어떤 스캔도 읽지 않고, 어떤 검사도 적용되지 않으며, 이러한 주소와 이름을 보관해도 이슈가 되지 않습니다. 그것이 이 저장소들의 목적이기 때문입니다. **데이터 저장소** 에서는 **OneUptime이 선언함** 으로 표시되며, **개요** 와 프레임워크 점수에서는 빠집니다.

| 저장소 | 보관 내용 | 보존 | 읽을 수 있는 대상 |
| --- | --- | --- | --- |
| 보안 이벤트 | 행동한 사람과 그 대상의 IP 주소, 사용자 이름, 이메일 주소 | 프로젝트의 [텔레메트리 보존 기간](/docs/telemetry/data-retention). 기록을 읽을 때마다 다시 읽으므로 변경이 바로 반영됩니다 | 프로젝트 소유자, 프로젝트 관리자, 보안 관리자, 보안 구성원, 보안 뷰어, 그리고 Read Security Event 권한이 있는 모든 사용자 |
| Network Flows | 서로 통신한 상대의 IP 주소 | 플로가 도착한 후 30일 | 네트워크 장치를 읽을 수 있는 모든 사용자 |
| 보안 주소 보관소 | [보안 이벤트](/docs/telemetry/security-events) 가 읽는 로그와 트레이스에 해시하는 IP 주소 규칙이 남긴 각 토큰 뒤의 IP 주소 | 주소가 마지막으로 확인된 후 30일 | OneUptime 내부의 보안 이벤트 스캔만: 어떤 사람, 페이지, 내보내기, API, AI 도구도 읽을 수 없습니다 |
| 보안 사용자 보관소 | [보안 이벤트](/docs/telemetry/security-events) 가 로그와 트레이스에서 사용자를 읽는 곳에 해시하는 규칙이 남긴 각 토큰 뒤의 사용자 | 사용자가 마지막으로 확인된 후 30일 | OneUptime 내부의 보안 이벤트 스캔만: 어떤 사람, 페이지, 내보내기, API, AI 도구도 읽을 수 없습니다 |

각 저장소의 목적은 "네트워크 및 정보 보안 (GDPR 전문 49)" 입니다. 직접 목적이나 보존 기간을 작성하려면 저장소 **설정** 의 **기록 편집** 을 사용하세요. 비워 둔 필드는 OneUptime의 내용을 유지합니다.

저장소는 프로젝트가 그 데이터를 보관하는 동안 기록에 나옵니다. 주소 보관소는 활성화된 IP 주소 규칙이 보안 이벤트가 읽는 로그나 트레이스를 해시하는 동안, 사용자 보관소는 다른 패턴의 활성화된 규칙이 그렇게 하는 동안, 그리고 각각 그 후 31일 동안 나옵니다([민감한 데이터 스크럽](/docs/telemetry/drop-filters-and-scrub-rules#민감한-데이터-스크럽) 참고). 데이터가 없어지면 저장소는 보관 처리되며, 데이터가 다시 생기면 작성한 목적과 보존 기간과 함께 돌아옵니다.

“보안 사용자 보관소”에서, 그리고 이를 통해 그 사람의 이름을 표시하는 이벤트와 케이스에서 한 사람을 삭제하려면 삭제 요청을 제출하세요. [개인 삭제](/docs/telemetry/security-events#개인-삭제)를 참조하세요.

## 영향 평가

GDPR 제35조는 높은 위험을 초래할 가능성이 있는 처리 전에 데이터 보호 영향 평가를 요구합니다. 데이터 보안은 어떤 저장소에 영향 평가가 필요한지 알려 줍니다. 건강 데이터 같은 특수 범주 데이터, 많은 사람의 데이터(약 100,000개 이상의 레코드), 또는 데이터 주체가 있는 국가 밖으로 나가는 데이터를 보관하는 저장소입니다.

저장소 메뉴에서 **설정** 아래에 있는 **영향 평가** 는 저장소에 영향 평가가 필요한 이유를, 또는 필요하지 않다는 것을 알려 줍니다. **평가 초안 작성** 은 저장소의 기록, 열린 이슈와 최근 수정된 이슈, 노출 정도, 접근할 수 있는 대상의 수, 암호화를 바탕으로 제35조(7)이 요구하는 네 부분을 OneUptime AI에 요청합니다:

| 부분 | 조항 |
| --- | --- |
| 처리와 그 목적 | 제35조(7)(a) |
| 필요성과 비례성 | 제35조(7)(b) |
| 데이터 주체에 대한 위험 | 제35조(7)(c) |
| 위험에 대응하는 조치 | 제35조(7)(d) |

각 부분에는 누가 언제 작성했는지가 표시되며, 초안으로 작성된 부분에는 그 근거가 된 사실이 함께 나옵니다. **편집** 하면 그 부분은 직접 쓴 것이 되어 다시 초안으로 작성되지 않으며, **초안 다시 작성** 은 아무도 편집하지 않은 부분만 다시 작성합니다. 작성된 후 근거가 된 사실이 바뀐 부분은 그렇다고 알려 줍니다. **PDF 내보내기** 와 **Markdown 내보내기** 는 평가를 다운로드합니다.

## 감사 증거

**데이터 보안 → 규정 준수** 에서 고른 프레임워크의 **감사 증거** 는 지난 30일, 90일, 180일 또는 365일 동안에 대해 감사인이 각 요구 사항 아래에서 읽는 내용입니다:

- 범위 내 저장소와 검사 상태
- 기간 중 열리고 수정된 검사 이슈와 수정 속도
- 요구 사항에서 수락된 위험과 그 사유 및 만료
- 요구 사항을 끈 리소스와 그 이유

**증거 초안 작성** 은 각 요구 사항 아래에 둘 단락을 그 사실에 근거해 작성하도록 OneUptime AI에 요청합니다. **편집** 하면 단락은 직접 쓴 것이 되어 다시 초안으로 작성되지 않습니다. 단락이 없는 요구 사항은 증거를 있는 그대로 보여 줍니다. **PDF 내보내기** 와 **Markdown 내보내기** 는 두 개의 부록과 함께 증거를 다운로드합니다. 범위 내 저장소의 처리 기록과, 증거가 인용하는 이슈 이력입니다.

## 다음 단계

:::cards
- [데이터 보안 검사 및 이슈](/docs/data-security/checks-and-issues): 모든 요구 사항의 근거가 되는 검사와 해결 방법.
- [데이터 흐름, 접근 및 상주](/docs/data-security/flows-access-residency): GDPR, LGPD, DPDP의 데이터 이전을 위한 데이터 상주 규칙.
- [민감한 데이터 유형](/docs/data-security/data-types): 저장소를 프레임워크의 대상에 포함시키는 데이터 유형.
:::
