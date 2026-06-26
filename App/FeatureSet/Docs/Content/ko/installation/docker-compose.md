# Docker Compose로 OneUptime을 완전 무료로 배포하기

자체 서버에서 OneUptime을 호스팅하려면 Docker Compose를 사용하여 Debian, Ubuntu 또는 RHEL에서 단일 서버 인스턴스를 배포할 수 있습니다. 이 옵션은 인스턴스에 대한 더 많은 제어 및 커스터마이징을 제공하지만 배포 및 유지 관리에 더 많은 기술적 기술과 리소스가 필요합니다.

#### 시스템 요구 사항 선택

사용량과 예산에 따라 서버의 다양한 시스템 요구 사항 중에서 선택할 수 있습니다. 최적의 성능을 위해 OneUptime을 다음과 함께 사용하는 것을 권장합니다:

- **권장 시스템 요구 사항**
  - 16GB RAM
  - 8코어
  - 400 GB 디스크
  - Ubuntu 22.04
  - Docker 및 Docker Compose 설치됨
- **홈랩 / 최소 요구 사항**
  - 가정 환경에서 개인 또는 실험 목적으로 OneUptime을 실행하려는 경우 (일부 사용자는 RaspberryPi에도 설치함), 홈랩 요구 사항을 사용할 수 있습니다:
    - 8 GB RAM
    - 4코어
    - 20 GB 디스크
    - Docker 및 Docker Compose 설치됨

#### 단일 서버 배포의 전제 조건

설치 튜토리얼: [https://youtu.be/j1SWmMW2oL4](https://youtu.be/j1SWmMW2oL4)

배포 프로세스를 시작하기 전에 다음이 있는지 확인하십시오:

- Debian, Ubuntu 또는 RHEL 파생 운영 체제를 실행하는 서버
- 서버에 Docker 및 Docker Compose 설치됨

OneUptime을 설치하려면:

```
# 릴리스 브랜치만으로 이 레포를 클론하고 해당 디렉토리로 이동합니다.
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env를 config.env로 복사합니다
cp config.example.env config.env

# 중요: config.env 파일을 편집합니다. 무작위 시크릿이 있는지 확인하십시오.

npm start
```

npm을 사용하지 않거나 설치되지 않은 경우 대신 다음을 실행합니다:

```
# config.env 파일에서 환경 변수를 읽고 docker compose up을 실행합니다.
(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)

# 포트 바인딩에 권한 문제가 있는 경우 sudo를 사용합니다.
sudo bash -c "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)"
```

### OneUptime 액세스

OneUptime은 http://localhost에서 실행됩니다. 인스턴스를 사용하기 시작하려면 새 계정을 등록해야 합니다.

### TLS/SSL 인증서 설정

OneUptime은 SSL/TLS 인증서 설정을 **지원하지 않습니다**. SSL/TLS 인증서를 직접 설정해야 합니다.

SSL/TLS 인증서를 사용해야 하는 경우 다음 단계를 따르십시오:

1. Nginx 또는 Caddy와 같은 리버스 프록시를 사용합니다.
2. Let's Encrypt를 사용하여 인증서를 프로비저닝합니다.
3. 리버스 프록시를 OneUptime 서버로 지정합니다.
4. 다음 설정을 업데이트합니다:
   - `HTTP_PROTOCOL` 환경 변수를 `https`로 설정합니다.
   - `HOST` 환경 변수를 리버스 프록시가 호스팅되는 서버의 도메인 이름으로 변경합니다.

## 프로덕션 준비 체크리스트

프로덕션 환경에서 docker-compose로 OneUptime을 배포하지 않는 것이 이상적입니다. Kubernetes를 사용하는 것을 강력히 권장합니다. OneUptime용 Helm 차트는 [여기](https://artifacthub.io/packages/helm/oneuptime/oneuptime)에서 사용할 수 있습니다.

그래도 docker-compose로 OneUptime을 프로덕션에 배포하려면 다음을 고려하십시오:

- **SSL/TLS**: SSL/TLS 인증서를 설정합니다. OneUptime은 SSL/TLS 인증서 설정을 지원하지 않습니다. 직접 설정해야 합니다. 위를 참조하십시오.
- **시크릿**: `config.env` 파일에 무작위 시크릿이 있는지 확인합니다. 해당 파일에 일부 기본 시크릿이 있습니다. 이를 무작위 긴 문자열로 교체하십시오.
- **백업**: 데이터베이스(Clickhouse, Postgres)를 정기적으로 백업합니다. Redis는 캐시로 사용되며 무상태이므로 무시해도 됩니다.
- **업데이트**: OneUptime을 정기적으로 업데이트하십시오. 매일 업데이트를 릴리스합니다. 프로덕션에서 실행하는 경우 적어도 주 1회 소프트웨어를 업데이트하는 것을 권장합니다.

### OneUptime 업데이트

업데이트하려면:

```
git checkout release # 릴리스 브랜치에 있는지 확인하십시오.
git pull
npm run update
```

### 고려해야 할 사항

- Docker 설정에서는 로컬 로깅 드라이버를 사용합니다. OneUptime, 특히 probe 및 ingest 컨테이너는 상당한 양의 로그를 생성합니다. 저장 공간이 가득 차는 것을 방지하려면 Docker에서 로깅 저장 공간을 제한하는 것이 중요합니다. 이를 수행하는 방법에 대한 자세한 지침은 [여기](https://docs.docker.com/config/containers/logging/local/)의 공식 Docker 문서를 참조하십시오.

### OneUptime 제거

OneUptime을 제거하려면 다음 명령을 실행합니다:

```
npm run down
```

이렇게 하면 OneUptime에서 생성된 모든 컨테이너, 네트워크 및 볼륨이 중지되고 제거됩니다. `config.env` 파일이나 클론된 저장소는 제거되지 않습니다.
