// ============================================================
// Mouse Gesture Navigation - Popup Script
// ============================================================
// 설정 팝업의 UI를 관리한다.
//
// [주요 기능]
// 1. 기본 설정(활성화, 궤적, 색상 등) 관리
// 2. 제스처별 동작 매핑 드롭다운 UI 생성
// 3. chrome.storage.sync와 양방향 바인딩
//
// [데이터 흐름]
// popup.js -> chrome.storage.sync.set() -> storage.onChanged
//          -> content.js / background.js에서 실시간 반영
// ============================================================

(function () {
  "use strict";

  // ----------------------------------------------------------
  // 사용 가능한 동작 목록
  // optgroup 라벨과 함께 그룹별로 정리한다.
  // 드롭다운 <select>에서 <optgroup>으로 그룹핑된다.
  // ----------------------------------------------------------
  const ACTION_GROUPS = [
    {
      label: "탐색",
      actions: [
        { id: "BACK", name: "이전 페이지" },
        { id: "FORWARD", name: "다음 페이지" },
        { id: "JUMPTO_TOP", name: "맨 위로" },
        { id: "JUMPTO_BOTTOM", name: "맨 아래로" },
        { id: "HOMEPAGE", name: "홈페이지로" },
        { id: "REFRESH", name: "새로고침" },
        { id: "PAGE_UP", name: "한 페이지 위로" },
        { id: "PAGE_DOWN", name: "한 페이지 아래로" },
      ],
    },
    {
      label: "탭",
      actions: [
        { id: "NEW_TAB", name: "새 탭 열기" },
        { id: "CLOSE_TAB", name: "탭 닫기" },
        { id: "CLONE_TAB", name: "탭 복제" },
        { id: "ACTIVATE_LEFT_TAB", name: "왼쪽 탭으로 이동" },
        { id: "ACTIVATE_RIGHT_TAB", name: "오른쪽 탭으로 이동" },
        { id: "CLOSE_OTHER_TAB", name: "다른 탭 모두 닫기" },
        { id: "CLOSE_LEFT_TAB", name: "왼쪽 탭 모두 닫기" },
        { id: "CLOSE_RIGHT_TAB", name: "오른쪽 탭 모두 닫기" },
        { id: "REOPEN_CLOSED_TAB", name: "닫은 탭 다시 열기" },
      ],
    },
    {
      label: "창",
      actions: [
        { id: "NEW_WINDOW", name: "새 창 열기" },
        { id: "OPENIN_SECRET_WINDOW", name: "시크릿창에서 열기" },
        { id: "CLOSE_WINDOW", name: "창 닫기" },
        { id: "FULLSCREEN_WINDOW", name: "전체화면" },
        { id: "MAXIMIZE_WINDOW", name: "창 최대화" },
        { id: "MINIMIZE_WINDOW", name: "창 최소화" },
      ],
    },
    {
      label: "기타",
      actions: [
        { id: "TOGGLE_MUTE", name: "소리 끄기/켜기" },
        { id: "OPEN_DOWNLOADS", name: "다운로드 열기" },
        { id: "TOGGLE_BOOKMARK", name: "북마크 추가/삭제" },
      ],
    },
  ];

  // ----------------------------------------------------------
  // 16개 제스처 패턴 정의 (1방향 4개 + 2방향 12개)
  //
  // pattern: 방향 시퀀스 문자열 (GESTURE_MAP의 키)
  // label: 사람이 읽기 쉬운 화살표 표시
  // ----------------------------------------------------------
  const GESTURE_PATTERNS = [
    { pattern: "L", label: "\u2190" },
    { pattern: "R", label: "\u2192" },
    { pattern: "U", label: "\u2191" },
    { pattern: "D", label: "\u2193" },
    { pattern: "LR", label: "\u2190 \u2192" },
    { pattern: "RL", label: "\u2192 \u2190" },
    { pattern: "UD", label: "\u2191 \u2193" },
    { pattern: "DU", label: "\u2193 \u2191" },
    { pattern: "UL", label: "\u2191 \u2190" },
    { pattern: "UR", label: "\u2191 \u2192" },
    { pattern: "DL", label: "\u2193 \u2190" },
    { pattern: "DR", label: "\u2193 \u2192" },
    { pattern: "RU", label: "\u2192 \u2191" },
    { pattern: "LD", label: "\u2190 \u2193" },
    { pattern: "RD", label: "\u2192 \u2193" },
    { pattern: "LU", label: "\u2190 \u2191" },
  ];

  // ----------------------------------------------------------
  // 기본 제스처 매핑 (Whale 브라우저 기본값)
  // ----------------------------------------------------------
  const DEFAULT_GESTURE_MAP = {
    L: "BACK",
    R: "FORWARD",
    U: "JUMPTO_TOP",
    D: "JUMPTO_BOTTOM",
    LR: "HOMEPAGE",
    RL: "HOMEPAGE",
    UD: "REFRESH",
    DU: "REFRESH",
    UL: "NEW_WINDOW",
    UR: "NEW_TAB",
    DL: "OPENIN_SECRET_WINDOW",
    DR: "CLOSE_TAB",
    RU: "FULLSCREEN_WINDOW",
    LD: "REOPEN_CLOSED_TAB",
    RD: "MINIMIZE_WINDOW",
    LU: "MAXIMIZE_WINDOW",
  };

  // 기본 설정값
  const DEFAULT_SETTINGS = {
    enabled: true,
    trailColor: "#000000",
    trailWidth: 3,
    minDistance: 10,
    sensitivity: 30,
    showTrail: true,
    showGestureName: true,
  };

  // ----------------------------------------------------------
  // DOM 요소 참조
  // ----------------------------------------------------------
  const elements = {
    enabled: document.getElementById("enabled"),
    showTrail: document.getElementById("showTrail"),
    showGestureName: document.getElementById("showGestureName"),
    trailColor: document.getElementById("trailColor"),
    trailWidth: document.getElementById("trailWidth"),
    trailWidthValue: document.getElementById("trailWidthValue"),
    sensitivity: document.getElementById("sensitivity"),
    sensitivityValue: document.getElementById("sensitivityValue"),
    gestureConfigList: document.getElementById("gestureConfigList"),
    resetGestures: document.getElementById("resetGestures"),
  };

  // 현재 제스처 매핑 상태
  let currentGestureMap = { ...DEFAULT_GESTURE_MAP };

  // ----------------------------------------------------------
  // SVG 제스처 아이콘 생성
  //
  // 각 방향 패턴에 대해 40x40 SVG를 만들어
  // 실제 마우스 움직임 경로를 시각적으로 보여준다.
  //
  // [좌표 체계]
  // - 캔버스: 40x40, 패딩 8px
  // - 1방향: 시작점(반대쪽) -> 끝점(방향쪽)
  // - 2방향: 시작점 -> 중앙(꺾임점) -> 끝점
  // ----------------------------------------------------------
  function createGestureSVG(pattern) {
    const size = 40;
    const pad = 8;
    const mid = size / 2;

    // 각 방향의 끝점 좌표
    const endPoints = {
      L: [pad, mid],
      R: [size - pad, mid],
      U: [mid, pad],
      D: [mid, size - pad],
    };

    // 반대 방향 매핑
    const opposite = { L: "R", R: "L", U: "D", D: "U" };

    const dirs = pattern.split("");
    let pts;

    if (dirs.length === 1) {
      // 1방향: 반대쪽에서 출발, 해당 방향으로 이동
      const start = endPoints[opposite[dirs[0]]];
      const end = endPoints[dirs[0]];
      pts = [start, end];
    } else {
      // 2방향: 첫 번째 방향의 반대에서 출발, 중앙에서 꺾어 두 번째 방향으로
      const start = endPoints[opposite[dirs[0]]];
      const end = endPoints[dirs[1]];
      pts = [start, [mid, mid], end];
    }

    // 화살표 머리 계산 (끝점 기준)
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
    const arrowLen = 7;
    const arrowAngle = Math.PI / 6; // 30도

    const a1x = last[0] - arrowLen * Math.cos(angle - arrowAngle);
    const a1y = last[1] - arrowLen * Math.sin(angle - arrowAngle);
    const a2x = last[0] - arrowLen * Math.cos(angle + arrowAngle);
    const a2y = last[1] - arrowLen * Math.sin(angle + arrowAngle);

    // SVG 생성
    const pointsStr = pts.map((p) => p.join(",")).join(" ");

    return [
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '">',
      '  <polyline points="' + pointsStr + '"',
      '    fill="none" stroke="#3a9c8e" stroke-width="2.5"',
      '    stroke-linecap="round" stroke-linejoin="round" />',
      '  <polyline points="' + a1x + "," + a1y + " " + last.join(",") + " " + a2x + "," + a2y + '"',
      '    fill="none" stroke="#3a9c8e" stroke-width="2.5"',
      '    stroke-linecap="round" stroke-linejoin="round" />',
      "</svg>",
    ].join("");
  }

  // ----------------------------------------------------------
  // 드롭다운 <select> 생성
  //
  // ACTION_GROUPS를 <optgroup>으로 그룹핑하여
  // Whale 설정 화면과 유사한 구조를 만든다.
  // ----------------------------------------------------------
  function createActionSelect(pattern, selectedAction) {
    const select = document.createElement("select");
    select.className = "gesture-select";
    select.dataset.pattern = pattern;

    // "없음" 옵션
    const noneOption = document.createElement("option");
    noneOption.value = "NONE";
    noneOption.textContent = "없음";
    if (selectedAction === "NONE") noneOption.selected = true;
    select.appendChild(noneOption);

    // 그룹별 옵션 생성
    for (const group of ACTION_GROUPS) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;

      for (const action of group.actions) {
        const option = document.createElement("option");
        option.value = action.id;
        option.textContent = action.name;
        if (selectedAction === action.id) option.selected = true;
        optgroup.appendChild(option);
      }

      select.appendChild(optgroup);
    }

    // 변경 시 저장
    select.addEventListener("change", () => {
      currentGestureMap[pattern] = select.value;
      saveGestureMap();
    });

    return select;
  }

  // ----------------------------------------------------------
  // 제스처 설정 목록 렌더링
  // ----------------------------------------------------------
  function renderGestureConfig() {
    const container = elements.gestureConfigList;
    container.innerHTML = "";

    for (const { pattern } of GESTURE_PATTERNS) {
      const row = document.createElement("div");
      row.className = "gesture-config-row";

      // SVG 아이콘
      const iconDiv = document.createElement("div");
      iconDiv.className = "gesture-icon";
      iconDiv.innerHTML = createGestureSVG(pattern);

      // 드롭다운
      const selectedAction = currentGestureMap[pattern] || "NONE";
      const select = createActionSelect(pattern, selectedAction);

      row.appendChild(iconDiv);
      row.appendChild(select);
      container.appendChild(row);
    }
  }

  // ----------------------------------------------------------
  // 저장/불러오기
  // ----------------------------------------------------------

  function loadAll() {
    chrome.storage.sync.get(["gestureSettings", "gestureMap"], (result) => {
      // 설정 불러오기
      const settings = { ...DEFAULT_SETTINGS, ...result.gestureSettings };

      elements.enabled.checked = settings.enabled;
      elements.showTrail.checked = settings.showTrail;
      elements.showGestureName.checked = settings.showGestureName;
      elements.trailColor.value = settings.trailColor;
      elements.trailWidth.value = settings.trailWidth;
      elements.trailWidthValue.textContent = settings.trailWidth + "px";
      elements.sensitivity.value = settings.sensitivity;
      elements.sensitivityValue.textContent = settings.sensitivity + "px";

      // 제스처 매핑 불러오기
      if (result.gestureMap) {
        currentGestureMap = { ...DEFAULT_GESTURE_MAP, ...result.gestureMap };
      } else {
        currentGestureMap = { ...DEFAULT_GESTURE_MAP };
      }

      renderGestureConfig();
    });
  }

  function saveSettings() {
    const settings = {
      enabled: elements.enabled.checked,
      showTrail: elements.showTrail.checked,
      showGestureName: elements.showGestureName.checked,
      trailColor: elements.trailColor.value,
      trailWidth: parseInt(elements.trailWidth.value, 10),
      minDistance: DEFAULT_SETTINGS.minDistance,
      sensitivity: parseInt(elements.sensitivity.value, 10),
    };

    chrome.storage.sync.set({ gestureSettings: settings });
  }

  function saveGestureMap() {
    chrome.storage.sync.set({ gestureMap: currentGestureMap });
  }

  // ----------------------------------------------------------
  // 이벤트 리스너
  // ----------------------------------------------------------

  elements.enabled.addEventListener("change", saveSettings);
  elements.showTrail.addEventListener("change", saveSettings);
  elements.showGestureName.addEventListener("change", saveSettings);
  elements.trailColor.addEventListener("input", saveSettings);

  elements.trailWidth.addEventListener("input", () => {
    elements.trailWidthValue.textContent = elements.trailWidth.value + "px";
    saveSettings();
  });

  elements.sensitivity.addEventListener("input", () => {
    elements.sensitivityValue.textContent =
      elements.sensitivity.value + "px";
    saveSettings();
  });

  // 기본값 초기화 버튼
  elements.resetGestures.addEventListener("click", () => {
    currentGestureMap = { ...DEFAULT_GESTURE_MAP };
    saveGestureMap();
    renderGestureConfig();
  });

  // 초기 로드
  loadAll();
})();
