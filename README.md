# 성경 (Bible web app)

공공영역 성경 리더. 프레임워크·빌드 과정 없는 순수 웹앱(PWA).

- **본문**: 개역성경(한글, 1952/1961 · Wikisource 공공영역) + KJV(영어, 공공영역). 출처 [getbible.net v2](https://getbible.net).
- **기능**: 책/장/절 읽기 · 한/영/대역 토글 · 전문 검색 · 형광펜(4색)·북마크·메모 · 1년 통독 플랜 · 음성 읽기(브라우저 TTS) · 다크모드 · 글자 크기 · 오프라인 설치(PWA).
- 개인 데이터(형광펜/북마크/메모/플랜)는 전부 브라우저 `localStorage`에 저장. 서버 없음.

## 실행

```bash
cd public
python3 -m http.server 8777
# 브라우저에서 http://localhost:8777
```

폰에 설치: 브라우저에서 열고 "홈 화면에 추가"(iOS) / "앱 설치"(Android/Chrome).

## 데이터 다시 받기

```bash
python3 scripts/build_data.py   # public/data/ 재생성 (66권 × 2번역 + books.json)
```

## 구조

```
public/
  index.html          앱 셸
  css/style.css
  js/app.js           전체 로직(리더·검색·형광펜·플랜·오디오·PWA)
  data/
    books.json        매니페스트 [{nr, ko, en, chapters, testament}]
    korean/<nr>.json   개역성경 (책별)
    kjv/<nr>.json      KJV (책별)
  manifest.webmanifest, sw.js, icons/
scripts/build_data.py  getbible.net → 책별 분할 빌더
```

## 라이선스 주의

번들된 본문은 공공영역 번역만 사용. 개역개정 등 저작권 있는 번역은 포함하지 않음(대한성서공회 라이선스 필요).
