# 로컬 개발

로컬 개발을 위해서는 docker-compose.dev.yml 파일을 사용해야 합니다. 

다음이 있는지 확인해야 합니다: 
- Docker 및 Docker Compose 설치됨. 
- Node.js 및 NPM 설치됨.

```
# 이 레포를 클론하고 해당 디렉토리로 이동합니다.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# config.example.env를 config.env로 복사합니다
cp config.example.env config.env

# 개발 환경이므로 config.env의 값을 수정할 필요가 없습니다. 선택 사항입니다.
npm run dev
```
