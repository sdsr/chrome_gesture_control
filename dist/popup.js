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
  // i18n 헬퍼
  //
  // chrome.i18n.getMessage()는 _locales 폴더에서
  // 브라우저 언어에 맞는 메시지를 가져온다.
  // 메시지가 없으면 default_locale(en)의 값을 반환한다.
  // ----------------------------------------------------------
  function msg(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  // ----------------------------------------------------------
  // 동작 ID -> i18n 메시지 키 매핑
  //
  // ACTION_GROUPS와 content.js의 ACTION_LABELS에서
  // 동일한 메시지 키를 사용하여 번역 일관성을 유지한다.
  // ----------------------------------------------------------
  const ACTION_I18N_MAP = {
    BACK: "actionBack",
    FORWARD: "actionForward",
    JUMPTO_TOP: "actionJumpToTop",
    JUMPTO_BOTTOM: "actionJumpToBottom",
    HOMEPAGE: "actionHomepage",
    REFRESH: "actionRefresh",
    PAGE_UP: "actionPageUp",
    PAGE_DOWN: "actionPageDown",
    NEW_TAB: "actionNewTab",
    CLOSE_TAB: "actionCloseTab",
    CLONE_TAB: "actionCloneTab",
    ACTIVATE_LEFT_TAB: "actionActivateLeftTab",
    ACTIVATE_RIGHT_TAB: "actionActivateRightTab",
    CLOSE_OTHER_TAB: "actionCloseOtherTab",
    CLOSE_LEFT_TAB: "actionCloseLeftTab",
    CLOSE_RIGHT_TAB: "actionCloseRightTab",
    REOPEN_CLOSED_TAB: "actionReopenClosedTab",
    NEW_WINDOW: "actionNewWindow",
    OPENIN_SECRET_WINDOW: "actionOpenInSecretWindow",
    CLOSE_WINDOW: "actionCloseWindow",
    FULLSCREEN_WINDOW: "actionFullscreenWindow",
    MAXIMIZE_WINDOW: "actionMaximizeWindow",
    MINIMIZE_WINDOW: "actionMinimizeWindow",
    TOGGLE_MUTE: "actionToggleMute",
    OPEN_DOWNLOADS: "actionOpenDownloads",
    TOGGLE_BOOKMARK: "actionToggleBookmark",
  };

  // ----------------------------------------------------------
  // 사용 가능한 동작 목록
  // i18n 메시지 키를 사용하여 브라우저 언어에 맞는 이름을 표시한다.
  // ----------------------------------------------------------
  const ACTION_GROUPS = [
    {
      label: msg("groupNavigation"),
      actions: [
        { id: "BACK", name: msg("actionBack") },
        { id: "FORWARD", name: msg("actionForward") },
        { id: "JUMPTO_TOP", name: msg("actionJumpToTop") },
        { id: "JUMPTO_BOTTOM", name: msg("actionJumpToBottom") },
        { id: "HOMEPAGE", name: msg("actionHomepage") },
        { id: "REFRESH", name: msg("actionRefresh") },
        { id: "PAGE_UP", name: msg("actionPageUp") },
        { id: "PAGE_DOWN", name: msg("actionPageDown") },
      ],
    },
    {
      label: msg("groupTab"),
      actions: [
        { id: "NEW_TAB", name: msg("actionNewTab") },
        { id: "CLOSE_TAB", name: msg("actionCloseTab") },
        { id: "CLONE_TAB", name: msg("actionCloneTab") },
        { id: "ACTIVATE_LEFT_TAB", name: msg("actionActivateLeftTab") },
        { id: "ACTIVATE_RIGHT_TAB", name: msg("actionActivateRightTab") },
        { id: "CLOSE_OTHER_TAB", name: msg("actionCloseOtherTab") },
        { id: "CLOSE_LEFT_TAB", name: msg("actionCloseLeftTab") },
        { id: "CLOSE_RIGHT_TAB", name: msg("actionCloseRightTab") },
        { id: "REOPEN_CLOSED_TAB", name: msg("actionReopenClosedTab") },
      ],
    },
    {
      label: msg("groupWindow"),
      actions: [
        { id: "NEW_WINDOW", name: msg("actionNewWindow") },
        { id: "OPENIN_SECRET_WINDOW", name: msg("actionOpenInSecretWindow") },
        { id: "CLOSE_WINDOW", name: msg("actionCloseWindow") },
        { id: "FULLSCREEN_WINDOW", name: msg("actionFullscreenWindow") },
        { id: "MAXIMIZE_WINDOW", name: msg("actionMaximizeWindow") },
        { id: "MINIMIZE_WINDOW", name: msg("actionMinimizeWindow") },
      ],
    },
    {
      label: msg("groupEtc"),
      actions: [
        { id: "TOGGLE_MUTE", name: msg("actionToggleMute") },
        { id: "OPEN_DOWNLOADS", name: msg("actionOpenDownloads") },
        { id: "TOGGLE_BOOKMARK", name: msg("actionToggleBookmark") },
      ],
    },
  ];

  // ----------------------------------------------------------
  // 14개 제스처 패턴 정의 (1방향 4개 + 왕복 2개 + ㄱ자 8개)
  //
  // pattern: 방향 시퀀스 문자열 (GESTURE_MAP의 키)
  // pair: 왕복 제스처의 경우 역방향 패턴. 드롭박스 변경 시
  //       pair 패턴에도 동일한 동작이 저장된다.
  //       예: LR을 "홈페이지로"로 바꾸면 RL도 자동으로 동일하게 저장.
  // ----------------------------------------------------------
  const GESTURE_PATTERNS = [
    { pattern: "L", label: "\u2190" },
    { pattern: "R", label: "\u2192" },
    { pattern: "U", label: "\u2191" },
    { pattern: "D", label: "\u2193" },
    { pattern: "LR", pair: "RL", label: "\u2190 \u2192" },
    { pattern: "UD", pair: "DU", label: "\u2191 \u2193" },
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
    showGestureName: false,
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
  /**
   * 제스처 패턴을 SVG 아이콘으로 그린다.
   *
   * @param {string}  pattern   - 방향 시퀀스 ("L", "UR", "LR" 등)
   * @param {boolean} bothEnds  - true이면 양쪽 끝에 화살표를 그린다 (왕복 제스처)
   */
  function createGestureSVG(pattern, bothEnds) {
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

    if (bothEnds) {
      // 왕복 제스처: 첫 번째 방향 끝점 <-> 두 번째 방향 끝점 직선
      // 예: LR -> 왼쪽 끝 <-> 오른쪽 끝, UD -> 위쪽 끝 <-> 아래쪽 끝
      pts = [endPoints[dirs[0]], endPoints[dirs[1]]];
    } else if (dirs.length === 1) {
      const start = endPoints[opposite[dirs[0]]];
      const end = endPoints[dirs[0]];
      pts = [start, end];
    } else {
      const start = endPoints[opposite[dirs[0]]];
      const end = endPoints[dirs[1]];
      pts = [start, [mid, mid], end];
    }

    const arrowLen = 7;
    const arrowAngle = Math.PI / 6; // 30도

    // 끝점 화살표 (항상 그림)
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const endAngle = Math.atan2(last[1] - prev[1], last[0] - prev[0]);

    const e1x = last[0] - arrowLen * Math.cos(endAngle - arrowAngle);
    const e1y = last[1] - arrowLen * Math.sin(endAngle - arrowAngle);
    const e2x = last[0] - arrowLen * Math.cos(endAngle + arrowAngle);
    const e2y = last[1] - arrowLen * Math.sin(endAngle + arrowAngle);

    const pointsStr = pts.map((p) => p.join(",")).join(" ");

    let svg =
      '<svg width="' + size + '" height="' + size +
      '" viewBox="0 0 ' + size + " " + size + '">' +
      '  <polyline points="' + pointsStr + '"' +
      '    fill="none" stroke="#3a9c8e" stroke-width="2.5"' +
      '    stroke-linecap="round" stroke-linejoin="round" />' +
      '  <polyline points="' + e1x + "," + e1y + " " + last.join(",") + " " + e2x + "," + e2y + '"' +
      '    fill="none" stroke="#3a9c8e" stroke-width="2.5"' +
      '    stroke-linecap="round" stroke-linejoin="round" />';

    // 양방향 화살표 (왕복 제스처)
    if (bothEnds) {
      const first = pts[0];
      const next = pts[1];
      const startAngle = Math.atan2(first[1] - next[1], first[0] - next[0]);

      const s1x = first[0] - arrowLen * Math.cos(startAngle - arrowAngle);
      const s1y = first[1] - arrowLen * Math.sin(startAngle - arrowAngle);
      const s2x = first[0] - arrowLen * Math.cos(startAngle + arrowAngle);
      const s2y = first[1] - arrowLen * Math.sin(startAngle + arrowAngle);

      svg +=
        '  <polyline points="' + s1x + "," + s1y + " " + first.join(",") + " " + s2x + "," + s2y + '"' +
        '    fill="none" stroke="#3a9c8e" stroke-width="2.5"' +
        '    stroke-linecap="round" stroke-linejoin="round" />';
    }

    svg += "</svg>";
    return svg;
  }

  // ----------------------------------------------------------
  // 드롭다운 <select> 생성
  //
  // ACTION_GROUPS를 <optgroup>으로 그룹핑하여
  // Whale 설정 화면과 유사한 구조를 만든다.
  // ----------------------------------------------------------
  /**
   * 드롭다운 <select> 생성
   *
   * @param {string} pattern - 제스처 패턴 (예: "LR")
   * @param {string} selectedAction - 현재 선택된 동작 ID
   * @param {string|undefined} pair - 왕복 제스처의 역방향 패턴 (예: "RL")
   */
  function createActionSelect(pattern, selectedAction, pair) {
    const select = document.createElement("select");
    select.className = "gesture-select";
    select.dataset.pattern = pattern;

    // "없음" 옵션
    const noneOption = document.createElement("option");
    noneOption.value = "NONE";
    noneOption.textContent = msg("actionNone");
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

    // 변경 시 저장 (pair가 있으면 역방향도 동일하게 저장)
    select.addEventListener("change", () => {
      currentGestureMap[pattern] = select.value;
      if (pair) {
        currentGestureMap[pair] = select.value;
      }
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

    for (const { pattern, pair } of GESTURE_PATTERNS) {
      const row = document.createElement("div");
      row.className = "gesture-config-row";

      // SVG 아이콘 (왕복 제스처면 양방향 화살표)
      const iconDiv = document.createElement("div");
      iconDiv.className = "gesture-icon";
      iconDiv.innerHTML = pair
        ? createGestureSVG(pattern, true)
        : createGestureSVG(pattern, false);

      // 드롭다운 (pair 전달)
      const selectedAction = currentGestureMap[pattern] || "NONE";
      const select = createActionSelect(pattern, selectedAction, pair);

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

  // ----------------------------------------------------------
  // i18n: HTML의 data-i18n 속성을 스캔하여 번역된 텍스트로 교체
  // ----------------------------------------------------------
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const translated = msg(el.dataset.i18n);
    if (translated) el.textContent = translated;
  });

  // 초기 로드
  loadAll();
})();
