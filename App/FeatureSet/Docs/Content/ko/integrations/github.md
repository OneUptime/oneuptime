# GitHub 통합

OneUptime 인시던트가 생성될 때 자동으로 [GitHub](https://github.com) 이슈를 열어 — 영향받은 서비스를 소유하는 저장소에서 엔지니어링 후속 작업을 추적합니다.

이 통합은 **아웃바운드**: OneUptime이 [GitHub REST API](https://docs.github.com/en/rest/issues/issues)를 호출합니다. **Incident → On Create** 트리거와 **API 컴포넌트** 를 갖춘 OneUptime **[Workflow](/docs/workflows/index)** 를 사용합니다.

> **더 깊은 GitHub 연결을 원하시나요?** OneUptime에는 코드 저장소 연결을 위한 네이티브 **GitHub App** 통합도 있습니다(AI 에이전트 및 코드 기능에 사용됨). 이것은 워크플로가 아닌 환경 변수로 설정합니다 — [GitHub 통합 (자체 호스팅)](/docs/self-hosted/github-integration)을 참조하세요. 이 페이지는 _인시던트에서 이슈 제출_ 에 관한 것입니다.

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## 사전 요건

- 이슈를 제출할 GitHub 저장소.
- 이슈를 만들 수 있는 토큰:

  - **Issues: Read and write** 권한이 있는 해당 저장소 범위의 **세분화된 PAT**, 또는
  - `repo` 범위의 **클래식 PAT**.

  [github.com/settings/tokens](https://github.com/settings/tokens)에서 만드세요.

- 워크플로를 만들 수 있는 OneUptime 프로젝트.

## 1단계 — 토큰 저장

1. **Workflows → Global Variables → Create** 로 이동합니다.
2. 이름을 `GITHUB_TOKEN` 으로 지정하고 토큰을 붙여넣고 **Is Secret** 를 켭니다.

## 2단계 — 워크플로 구성

1. **Workflows → Create Workflow** 를 열고, 이름을 `Incidents → GitHub Issues` 로 지정하고 **Builder** 를 엽니다.
2. **Incident** 트리거를 **On Create** 로 설정해 추가합니다. 이름을 `Incident` 로 변경합니다.
3. 트리거에 연결된 **API** 블록을 추가합니다:

   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Save** 하고, 활성화하고, 테스트 인시던트를 만듭니다. 워크플로 로그에서 `201 Created` 가 나오면 이슈가 생성된 것입니다. 응답 본문에 `number` 와 `html_url` 이 포함됩니다.

## 팁

- **GitHub Enterprise Server**: `https://your-host/api/v3/repos/{owner}/{repo}/issues` 를 사용합니다.
- **담당자 / 마일스톤**: 본문에 `"assignees": ["octocat"]` 또는 `"milestone": 3` 을 추가합니다.
- **링크 백**: `{{CreateIssue.response-body.html_url}}` 을 읽고 **Update Incident** 블록으로 인시던트에 저장합니다.

## 문제 해결

- **`401`** — 토큰이 잘못되었거나 만료되었습니다. 세분화된 토큰은 저장소와 **Issues** 권한을 명시적으로 부여해야 합니다.
- **`403` / 속도 제한** — `User-Agent` 헤더를 포함하세요(GitHub은 없으면 요청을 거부합니다) 그리고 속도 제한에 걸리지 않았는지 확인하세요.
- **`404`** — `owner/repo` 경로가 잘못되었거나 토큰이 비공개 저장소를 볼 수 없습니다.
- **`422`** — 존재하지 않는 라벨은 괜찮습니다(GitHub이 참조된 라벨을 만들어줍니다), 하지만 잘못된 본문은 안 됩니다 — JSON을 확인하세요.

## 다음에 읽어 볼 내용

- [통합 개요](/docs/integrations/index) — 패턴과 인증 빠른 참조.
- [GitLab](/docs/integrations/gitlab) — GitLab에 대한 동일한 아이디어.
- [GitHub 통합 (자체 호스팅)](/docs/self-hosted/github-integration) — 네이티브 GitHub App 연결.
