# 반찬량 체크

`bonbanchan`의 업로드 화면을 바탕으로 만든 YOLO 사진 분류 실험입니다. Claude API와 Supabase 없이 로컬 PC에서 사진과 실측 중량을 수집하고 `부족 / 정상 / 초과` 분류 모델을 학습합니다. 사진으로 g을 직접 측정하지 않습니다.

## 실행 (Windows PowerShell)

Python 3.11 이상과 Node.js 20 이상을 설치한 뒤 **서로 다른 터미널 두 개**에서 실행하세요.

```powershell
cd changjorim
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```powershell
cd changjorim
npm ci
npm run dev
```

`http://localhost:3000/admin`에서 반찬명과 기준 중량을 입력하고 입력 칸 바깥을 눌러 저장하세요. 기본 허용 오차는 ±10%입니다. 저울로 용기 무게를 제외한 반찬 중량을 측정하고, 실측 중량을 입력한 뒤 사진을 등록합니다. 부족·정상·초과 사진을 각각 최소 5장 넣은 다음 `YOLO 모델 학습하기`를 누릅니다. 이 수량은 실행 검증용 최소치입니다. 실제 사용 전에는 각 구간에서 여러 날 찍은 독립 사진을 더 모아 평가하세요. 첫 학습 때 사전 학습 모델이 다운로드됩니다. CPU에서는 오래 걸릴 수 있습니다.

학습 완료 후 `http://localhost:3000/weight-check`에서 새 사진을 판정합니다. 모델 확률은 정확도나 중량 측정값이 아닙니다. 확률이 75% 미만이면 `확인 필요`로 표시합니다. 실제 중량은 저울로 확인하세요.

판정이 틀리거나 애매하면 같은 화면에 **저울로 잰 실제 중량**을 입력하고 `실측 사진을 학습 데이터에 추가`를 누르세요. 이 사진은 바로 판정에 반영되지 않습니다. 관리자 화면에서 `YOLO 모델 학습하기`를 다시 눌러 새 모델을 만들어야 합니다. 학습 시에는 용기와 반찬이 모두 보이도록 사진 전체를 정사각형 안에 맞춰 사용합니다.

각 구간 5장은 실행 확인용 최소치입니다. 그 정도로 학습된 모델은 정확한 정량 검사에 사용하면 안 됩니다. 같은 접시를 반복 촬영한 사진 대신 **서로 다른 담음 상태·촬영일**을 각 구간에 모으고, 학습에 넣지 않은 별도 실측 사진으로 부족을 정상이라고 판정한 비율을 확인하세요. 육안으로 구분하기 어려운 중량 차이는 사진 모델도 구분하기 어렵습니다.

## Vercel + Railway 배포

먼저 GitHub 최신 코드를 배포합니다. 웹 화면은 Vercel, Python YOLO 서버는 Railway에서 실행합니다. 공개 배포 시 **두 서비스의 비밀값을 저장소나 채팅에 올리지 마세요.**

1. Railway에서 `Deploy from GitHub repo`로 `hwi-woong/changjorim`을 선택합니다. 저장소 루트의 `Dockerfile`을 빌드에 사용하고, 서비스에 Volume을 추가하여 **`/app/data`**에 마운트합니다. 인스턴스는 하나로 운영하세요. Railway 변수 `API_SHARED_SECRET`에 충분히 긴 임의 문자열을 설정합니다. 서버는 Railway가 제공하는 `PORT`로 실행되며 `/health`로 상태를 확인할 수 있습니다. Settings → Networking에서 공개 도메인을 생성합니다. 모델 학습은 CPU에서 오래 걸리고 메모리를 많이 쓰므로 Railway 리소스와 사용량을 확인하세요.
2. Vercel에서 같은 GitHub 저장소를 Next.js 프로젝트로 가져옵니다. 프로젝트 환경 변수 `API_BASE_URL`에 Railway의 **HTTPS 도메인**을 넣습니다(예: `https://xxx.up.railway.app`, `/api`는 붙이지 않음). `API_SHARED_SECRET`에 Railway와 같은 값을 넣고 `APP_USER`, `APP_PASSWORD`에 관리자 계정을 설정합니다. Production 및 사용하는 Preview 환경에 설정한 다음 배포합니다. `/admin`과 관리 API에 접근할 때 브라우저가 사용자 이름과 비밀번호를 요구합니다. `/weight-check`에서 목록 조회와 사진 판정은 로그인 없이 가능합니다. 서버 주소와 비밀값은 브라우저 코드에 공개되지 않습니다.
3. Vercel 주소에서 `/admin`을 열어 반찬과 사진 목록을 확인하고 `/weight-check`에서 테스트하세요. 오류가 나면 Railway 로그와 Vercel Functions 로그를 확인합니다. 로컬에서는 환경 변수가 없으면 기존처럼 `127.0.0.1:8000`을 사용합니다.

**기존 로컬 학습 데이터 옮기기:** 로컬 서버 둘 다 종료한 뒤 `changjorim/data`를 백업합니다. Railway 볼륨의 `/app/data`에 `samples.sqlite3`, `photos/`, `models/`를 같은 이름으로 복사하세요. Railway CLI의 `railway volume browse /` 또는 `railway volume files upload`로 올릴 수 있습니다. 볼륨 루트는 `/app/data`에 해당합니다. 오래된 DB에 저장된 Windows 사진 경로는 앱이 반찬 ID와 파일명으로 복원합니다. `datasets/`, `training/`은 옮기지 않아도 기존 모델 판정은 가능합니다. SQLite를 복사할 때는 로컬 서버를 중지하여 파일을 일관되게 복사하세요. 새 배포에는 로컬 `data/`가 자동 업로드되지 않습니다.

사진 요청은 Vercel의 Functions를 통과하므로 사진을 **각각 4MB 이하**로 줄여서 올려야 합니다. 이 제한을 넘는 원본 업로드가 필요하면 별도 업로드 경로를 구현해야 합니다. 판정 화면에서 실측 사진을 학습 데이터에 추가하는 기능도 관리자 인증이 필요합니다. 관리자 페이지에서 로그인한 브라우저로 사용하세요. 관리자 Basic 인증은 소규모 실험용이며 사람별 계정·감사 기록이 필요한 운영 시스템에는 별도 인증이 필요합니다.

## 데이터와 운영 범위

- 이미지·실측값은 `data/`에 저장되며 git에 올라가지 않습니다. 모델은 `data/models/{dishId}/best.pt`에 저장됩니다. `data/`를 백업하세요.
- 사진 등록 후에는 기준 중량 변경과 반찬 삭제가 제한됩니다. 기준을 변경하려면 새 반찬으로 등록하세요.
- 한 종류의 반찬과 동일한 용기·각도·조명으로 시작하세요. 같은 담음 상태를 여러 장 찍어 학습과 검증에 함께 넣으면 성능이 부풀려집니다. 자동 분할은 이런 중복을 식별하지 못합니다.
- 배포 환경은 관리자 Basic 인증과 서버 간 공유 비밀값으로 보호합니다. 설정되지 않으면 Vercel 화면은 열리지 않고 Railway API 요청은 거부됩니다.
- Next.js 서버가 `/api/*`를 Python API로 전달합니다. 로컬에서는 `127.0.0.1:8000`, 배포에서는 `API_BASE_URL`을 사용합니다.
