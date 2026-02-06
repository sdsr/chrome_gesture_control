// ============================================================
// Mouse Gesture Navigation - Content Script
// ============================================================
// 마우스 우클릭 드래그 제스처를 감지하여 방향 시퀀스를 만들고,
// 저장소(chrome.storage)에서 불러온 제스처 매핑 테이블과 비교하여
// background 서비스 워커에 동작 ID를 전달한다.
//
// [핵심 알고리즘]
// 1. mousedown(우클릭) -> 추적 시작
// 2. mousemove -> 이전 지점과의 각도로 방향(U/D/L/R) 결정,
//    일정 거리(threshold) 이상 움직였을 때만 방향 기록
// 3. mouseup -> 방향 시퀀스로 동작 ID 판별, background에 전송
// 4. contextmenu -> 제스처가 인식되었으면 기본 컨텍스트 메뉴 차단
// ============================================================

(function () {
  "use strict";

  // ----------------------------------------------------------
  // 동작 ID -> 한글 라벨 (오버레이 표시용)
  //
  // Whale 브라우저의 전체 동작 목록을 커버한다.
  // Chrome 확장에서 구현 불가능한 Whale 전용 기능은 제외했다.
  // ----------------------------------------------------------
  const ACTION_LABELS = {
    NONE: "",
    BACK: "이전 페이지",
    FORWARD: "다음 페이지",
    JUMPTO_TOP: "맨 위로",
    JUMPTO_BOTTOM: "맨 아래로",
    HOMEPAGE: "홈페이지로",
    REFRESH: "새로고침",
    FULLSCREEN_WINDOW: "전체화면",
    MAXIMIZE_WINDOW: "창 최대화",
    MINIMIZE_WINDOW: "창 최소화",
    NEW_WINDOW: "새 창 열기",
    NEW_TAB: "새 탭 열기",
    OPENIN_SECRET_WINDOW: "시크릿창에서 열기",
    CLONE_TAB: "탭 복제",
    CLOSE_WINDOW: "창 닫기",
    ACTIVATE_LEFT_TAB: "왼쪽 탭으로 이동",
    ACTIVATE_RIGHT_TAB: "오른쪽 탭으로 이동",
    CLOSE_TAB: "탭 닫기",
    CLOSE_OTHER_TAB: "다른 탭 모두 닫기",
    CLOSE_LEFT_TAB: "왼쪽 탭 모두 닫기",
    CLOSE_RIGHT_TAB: "오른쪽 탭 모두 닫기",
    REOPEN_CLOSED_TAB: "닫은 탭 다시 열기",
    PAGE_UP: "한 페이지 위로",
    PAGE_DOWN: "한 페이지 아래로",
    TOGGLE_MUTE: "소리 끄기/켜기",
    OPEN_DOWNLOADS: "다운로드 열기",
    TOGGLE_BOOKMARK: "북마크 추가/삭제",
  };

  // ----------------------------------------------------------
  // 기본 제스처 매핑 (Whale 브라우저 기본값과 동일)
  // storage에 사용자 설정이 없으면 이 값을 사용한다.
  //
  // 키: 방향 시퀀스 문자열 (L, R, U, D, LR, DR 등)
  // 값: 동작 ID (ACTION_LABELS의 키)
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

  // ----------------------------------------------------------
  // 설정값 (기본값, storage에서 덮어쓸 수 있음)
  // ----------------------------------------------------------
  let settings = {
    enabled: true,
    trailColor: "#000000",
    trailWidth: 3,
    minDistance: 10,
    sensitivity: 30,
    showTrail: true,
    showGestureName: true,
  };

  // 제스처 매핑 (storage에서 불러오기 전까지 기본값 사용)
  let gestureMap = { ...DEFAULT_GESTURE_MAP };

  // storage에서 설정과 제스처 매핑 불러오기
  if (chrome.storage) {
    chrome.storage.sync.get(["gestureSettings", "gestureMap"], (result) => {
      if (result.gestureSettings) {
        settings = { ...settings, ...result.gestureSettings };
      }
      if (result.gestureMap) {
        // 저장된 매핑을 기본값에 병합한다.
        // 이렇게 하면 새로 추가된 제스처 패턴도 기본값을 유지한다.
        gestureMap = { ...DEFAULT_GESTURE_MAP, ...result.gestureMap };
      }
    });

    // 설정 변경 실시간 반영
    // 팝업에서 설정을 바꾸면 즉시 컨텐츠 스크립트에 적용된다.
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.gestureSettings) {
        settings = { ...settings, ...changes.gestureSettings.newValue };
      }
      if (changes.gestureMap) {
        gestureMap = { ...DEFAULT_GESTURE_MAP, ...changes.gestureMap.newValue };
      }
    });
  }

  // ----------------------------------------------------------
  // 상태 변수
  // ----------------------------------------------------------
  let isGesturing = false;
  let gestureDetected = false;
  let points = [];
  let directions = [];
  let lastPoint = null;
  let totalDistance = 0;

  // ----------------------------------------------------------
  // 캔버스(트레일 그리기용)
  // ----------------------------------------------------------
  let canvas = null;
  let ctx = null;

  // ----------------------------------------------------------
  // 제스처 이름 표시용 오버레이
  // ----------------------------------------------------------
  let gestureOverlay = null;

  /**
   * 트레일 캔버스를 생성하고 화면 전체를 덮도록 설정한다.
   */
  function createCanvas() {
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "mouse-gesture-canvas";
      canvas.style.cssText = [
        "position: fixed",
        "top: 0",
        "left: 0",
        "width: 100vw",
        "height: 100vh",
        "z-index: 2147483647",
        "pointer-events: none",
        "opacity: 1",
      ].join(";");
      document.documentElement.appendChild(canvas);
    }
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  function removeCanvas() {
    if (canvas && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }
    canvas = null;
    ctx = null;
  }

  function createOverlay() {
    if (!gestureOverlay) {
      gestureOverlay = document.createElement("div");
      gestureOverlay.id = "mouse-gesture-overlay";
      document.documentElement.appendChild(gestureOverlay);
    }
    gestureOverlay.textContent = "";
    gestureOverlay.style.display = "none";
  }

  function removeOverlay() {
    if (gestureOverlay && gestureOverlay.parentNode) {
      gestureOverlay.parentNode.removeChild(gestureOverlay);
    }
    gestureOverlay = null;
  }

  function showGestureName(text) {
    if (!settings.showGestureName || !gestureOverlay) return;
    gestureOverlay.textContent = text;
    gestureOverlay.style.display = "block";
  }

  function drawTrail(x, y) {
    if (!settings.showTrail || !ctx) return;
    if (points.length < 2) return;

    const prev = points[points.length - 2];
    ctx.strokeStyle = settings.trailColor;
    ctx.lineWidth = settings.trailWidth;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function distance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 두 점 사이의 이동 방향을 4방향(U/D/L/R)으로 판별한다.
   *
   * Math.atan2로 각도를 구한 뒤 45도 단위로 분할:
   *   -45 ~  45 : 오른쪽(R)
   *    45 ~ 135 : 아래(D)  (화면 좌표계에서 Y가 아래로 증가하므로)
   *  -135 ~ -45 : 위(U)
   *   나머지    : 왼쪽(L)
   */
  function getDirection(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    if (angle >= -45 && angle < 45) return "R";
    if (angle >= 45 && angle < 135) return "D";
    if (angle >= -135 && angle < -45) return "U";
    return "L";
  }

  /**
   * 방향 시퀀스를 문자열로 합쳐 제스처 맵에서 동작 ID를 조회한다.
   *
   * @returns {string|null} 매칭된 동작 ID 또는 null
   */
  function recognizeGesture() {
    if (directions.length === 0) return null;
    const pattern = directions.join("");
    const action = gestureMap[pattern];
    // "NONE"이면 동작 없음으로 처리
    if (action && action !== "NONE") return action;
    return null;
  }

  // ----------------------------------------------------------
  // 이벤트 핸들러
  // ----------------------------------------------------------

  function onMouseDown(e) {
    if (!settings.enabled) return;
    if (e.button !== 2) return;

    isGesturing = true;
    gestureDetected = false;
    points = [{ x: e.clientX, y: e.clientY }];
    directions = [];
    lastPoint = { x: e.clientX, y: e.clientY };
    totalDistance = 0;

    if (settings.showTrail) {
      createCanvas();
    }
    if (settings.showGestureName) {
      createOverlay();
    }
  }

  function onMouseMove(e) {
    if (!isGesturing) return;

    const current = { x: e.clientX, y: e.clientY };
    points.push(current);
    drawTrail(current.x, current.y);

    const dist = distance(lastPoint, current);
    totalDistance += dist;

    if (dist >= settings.minDistance) {
      const dir = getDirection(lastPoint, current);

      // 연속 중복 제거: "DDDD" -> "D"
      if (directions.length === 0 || directions[directions.length - 1] !== dir) {
        directions.push(dir);
      }
      lastPoint = current;

      // 실시간으로 현재 인식된 제스처 이름 표시
      const action = recognizeGesture();
      if (action && totalDistance >= settings.sensitivity) {
        showGestureName(ACTION_LABELS[action] || action);
      } else if (directions.length > 0) {
        // 아직 매칭되지 않으면 방향 화살표만 표시
        const arrowMap = { U: "\u2191", D: "\u2193", L: "\u2190", R: "\u2192" };
        const arrows = directions.map((d) => arrowMap[d] || d).join(" ");
        showGestureName(arrows);
      }
    }
  }

  function onMouseUp(e) {
    if (!isGesturing) return;
    if (e.button !== 2) return;

    isGesturing = false;

    if (totalDistance >= settings.sensitivity) {
      const action = recognizeGesture();
      if (action) {
        gestureDetected = true;
        // background에 동작 ID 전송
        chrome.runtime.sendMessage({ type: "gesture", action: action });

        showGestureName(ACTION_LABELS[action] || action);
        setTimeout(cleanup, 300);
        return;
      }
    }

    cleanup();
  }

  /**
   * 제스처가 감지된 경우 기본 컨텍스트 메뉴를 차단한다.
   * gestureDetected가 false이면 (단순 우클릭) 정상 동작한다.
   */
  function onContextMenu(e) {
    if (gestureDetected) {
      e.preventDefault();
      e.stopPropagation();
      gestureDetected = false;
    }
  }

  function cleanup() {
    removeCanvas();
    removeOverlay();
    points = [];
    directions = [];
    totalDistance = 0;
  }

  // capture: true -> 페이지 자체 핸들러보다 먼저 이벤트를 잡는다
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("beforeunload", cleanup);
})();
