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
  // i18n 헬퍼
  // ----------------------------------------------------------
  function msg(key) {
    try {
      return chrome.i18n.getMessage(key) || key;
    } catch (e) {
      return key;
    }
  }

  // ----------------------------------------------------------
  // 동작 ID -> 번역된 라벨 (오버레이 표시용)
  //
  // chrome.i18n.getMessage()로 브라우저 언어에 맞는 이름을 가져온다.
  // _locales/ko/messages.json 또는 _locales/en/messages.json 참조.
  // ----------------------------------------------------------
  const ACTION_LABELS = {
    NONE: "",
    BACK: msg("actionBack"),
    FORWARD: msg("actionForward"),
    JUMPTO_TOP: msg("actionJumpToTop"),
    JUMPTO_BOTTOM: msg("actionJumpToBottom"),
    HOMEPAGE: msg("actionHomepage"),
    REFRESH: msg("actionRefresh"),
    FULLSCREEN_WINDOW: msg("actionFullscreenWindow"),
    MAXIMIZE_WINDOW: msg("actionMaximizeWindow"),
    MINIMIZE_WINDOW: msg("actionMinimizeWindow"),
    NEW_WINDOW: msg("actionNewWindow"),
    NEW_TAB: msg("actionNewTab"),
    OPENIN_SECRET_WINDOW: msg("actionOpenInSecretWindow"),
    CLONE_TAB: msg("actionCloneTab"),
    CLOSE_WINDOW: msg("actionCloseWindow"),
    ACTIVATE_LEFT_TAB: msg("actionActivateLeftTab"),
    ACTIVATE_RIGHT_TAB: msg("actionActivateRightTab"),
    CLOSE_TAB: msg("actionCloseTab"),
    CLOSE_OTHER_TAB: msg("actionCloseOtherTab"),
    CLOSE_LEFT_TAB: msg("actionCloseLeftTab"),
    CLOSE_RIGHT_TAB: msg("actionCloseRightTab"),
    REOPEN_CLOSED_TAB: msg("actionReopenClosedTab"),
    PAGE_UP: msg("actionPageUp"),
    PAGE_DOWN: msg("actionPageDown"),
    TOGGLE_MUTE: msg("actionToggleMute"),
    OPEN_DOWNLOADS: msg("actionOpenDownloads"),
    TOGGLE_BOOKMARK: msg("actionToggleBookmark"),
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
    showGestureName: false,
  };

  // 제스처 매핑 (storage에서 불러오기 전까지 기본값 사용)
  let gestureMap = { ...DEFAULT_GESTURE_MAP };

  // ----------------------------------------------------------
  // 확장 프로그램 컨텍스트 유효성 체크
  //
  // 확장 프로그램이 재로드/업데이트되면 기존 content script의
  // chrome.* API 연결이 끊어진다. chrome.runtime.id가 undefined가
  // 되면 컨텍스트가 무효화된 것이므로, 이벤트 리스너를 제거하고
  // 스크립트를 정리해야 한다.
  // ----------------------------------------------------------
  function isExtensionValid() {
    try {
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // storage에서 설정과 제스처 매핑 불러오기
  if (chrome.storage) {
    try {
      chrome.storage.sync.get(["gestureSettings", "gestureMap"], (result) => {
        if (chrome.runtime.lastError) return;
        if (result.gestureSettings) {
          settings = { ...settings, ...result.gestureSettings };
        }
        if (result.gestureMap) {
          gestureMap = { ...DEFAULT_GESTURE_MAP, ...result.gestureMap };
        }
        console.log("[Gesture] loaded gestureMap:", JSON.stringify(gestureMap));
        console.log("[Gesture] loaded settings:", JSON.stringify(settings));
      });

      // 설정 변경 실시간 반영
      chrome.storage.onChanged.addListener((changes) => {
        if (!isExtensionValid()) return;
        if (changes.gestureSettings) {
          settings = { ...settings, ...changes.gestureSettings.newValue };
        }
        if (changes.gestureMap) {
          gestureMap = { ...DEFAULT_GESTURE_MAP, ...changes.gestureMap.newValue };
        }
      });
    } catch (e) {
      // 이미 컨텍스트가 무효화된 상태
    }
  }

  // ----------------------------------------------------------
  // 상태 변수
  // ----------------------------------------------------------
  let isGesturing = false;
  let gestureDetected = false;
  let points = [];
  let directions = [];
  let segmentDistances = []; // 각 방향 세그먼트의 누적 이동 거리 (px)
  let lastPoint = null;
  let totalDistance = 0;
  let activePointerId = null; // Pointer Capture에 사용할 포인터 ID

  // ----------------------------------------------------------
  // 드래그 판정 임계값 (px)
  //
  // 컨텍스트 메뉴 차단 여부를 결정하는 최소 이동 거리.
  // sensitivity(제스처 인식 임계값, 기본 30px)와는 별개로,
  // 이 값 이상 움직이면 "드래그했다"고 판정하여 컨텍스트 메뉴를 차단한다.
  // 손 떨림을 고려하여 5px로 설정한다.
  // ----------------------------------------------------------
  const DRAG_THRESHOLD = 5;

  // ----------------------------------------------------------
  // 방향 전환 떨림 필터 임계값 (px)
  //
  // 2방향 제스처(UL, UR, DR 등)를 그릴 때 꺾이는 지점에서
  // 손 미세 떨림으로 순간적으로 잘못된 방향이 잡히는 것을 방지한다.
  //
  // 예: "위 -> 오른쪽"을 그릴 때 꺾는 순간 잠깐 "아래"가 잡히면
  //     "UDR" 3글자 패턴이 되어 "UR"과 매칭이 안 된다.
  //     이 임계값보다 짧은 세그먼트는 떨림으로 판정하여 제거한다.
  // ----------------------------------------------------------
  const DIR_JITTER_THRESHOLD = 30;

  // ----------------------------------------------------------
  // 캔버스(트레일 그리기용)
  // ----------------------------------------------------------
  let canvas = null;
  let ctx = null;

  // ----------------------------------------------------------
  // 제스처 이름 표시용 오버레이
  // ----------------------------------------------------------
  let gestureOverlay = null;

  // ----------------------------------------------------------
  // 컨텍스트 메뉴 차단용 투명 Shield
  //
  // iframe 위에서 드래그가 끝나면 contextmenu 이벤트가
  // iframe 내부 document에서 발생하여 메인 프레임의
  // onContextMenu 핸들러가 잡지 못한다.
  //
  // Shield는 z-index 2147483646의 투명 div로, 제스처 중
  // 뷰포트 전체를 덮어 iframe보다 위에 위치한다.
  // pointer-events: auto이므로 contextmenu 이벤트는
  // iframe이 아닌 shield에서 발생하여 차단할 수 있다.
  //
  // Pointer Capture는 포인터 이벤트만 리다이렉트하고
  // contextmenu(UI 이벤트)는 영향을 주지 않으므로,
  // shield가 별도로 필요하다.
  // ----------------------------------------------------------
  let contextMenuShield = null;

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

  /**
   * 컨텍스트 메뉴 차단용 투명 Shield를 생성한다.
   *
   * Shield는 뷰포트 전체를 덮는 투명 div로,
   * pointer-events: auto 이기 때문에 contextmenu 이벤트가
   * iframe이 아닌 shield에서 발생한다.
   *
   * Pointer Capture는 포인터 이벤트(pointermove 등)만
   * 리다이렉트하므로 shield의 pointer-events: auto와
   * 충돌하지 않는다.
   */
  function createContextMenuShield() {
    if (contextMenuShield) return;
    contextMenuShield = document.createElement("div");
    contextMenuShield.style.cssText = [
      "position: fixed",
      "top: 0",
      "left: 0",
      "width: 100vw",
      "height: 100vh",
      "z-index: 2147483646",
      "pointer-events: auto",
      "background: transparent",
    ].join(";");
    contextMenuShield.addEventListener(
      "contextmenu",
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      },
      true
    );
    document.documentElement.appendChild(contextMenuShield);
  }

  function removeContextMenuShield() {
    if (contextMenuShield && contextMenuShield.parentNode) {
      contextMenuShield.parentNode.removeChild(contextMenuShield);
    }
    contextMenuShield = null;
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
   * 1차: 정확한 패턴 매칭을 시도한다.
   * 2차(폴백): 3방향 패턴이면 중간 방향을 제거하고 재매칭한다.
   *     이는 세그먼트 거리 필터에서 걸러지지 않은 미세 떨림에 대한
   *     마지막 안전장치다.
   *     예: "UDR" (U로 올라가다 꺾으면서 잠시 D 후 R)
   *        -> 중간 "D" 제거 -> "UR" -> 매칭
   *
   * 4방향 이상은 단순화하지 않는다. 원형 제스처 등이
   * 의도치 않게 2방향 동작에 매칭되는 것을 방지하기 위함이다.
   *
   * @returns {string|null} 매칭된 동작 ID 또는 null
   */
  function recognizeGesture() {
    if (directions.length === 0) return null;
    const pattern = directions.join("");

    // 1차: 정확한 패턴 매칭
    const action = gestureMap[pattern];
    if (action && action !== "NONE") {
      console.log("[Gesture] exact match:", pattern, "->", action);
      return action;
    }

    // 2차: 3방향 패턴 -> 중간 떨림 제거 후 재매칭
    // 첫 방향과 마지막 방향이 같으면 단순화 불가 (예: "URU" -> "UU" = 무의미)
    if (directions.length === 3 && directions[0] !== directions[2]) {
      const simplified = directions[0] + directions[2];
      const simplifiedAction = gestureMap[simplified];
      if (simplifiedAction && simplifiedAction !== "NONE") {
        console.log(
          "[Gesture] simplified:",
          pattern,
          "->",
          simplified,
          "->",
          simplifiedAction
        );
        return simplifiedAction;
      }
    }

    console.log(
      "[Gesture] NO match: pattern='" + pattern + "'",
      "dirs=[" + directions.join(",") + "]",
      "segDist=[" + segmentDistances.join(",") + "]"
    );
    return null;
  }

  // ----------------------------------------------------------
  // 이벤트 핸들러 (Pointer Events API 사용)
  //
  // [왜 Mouse Events 대신 Pointer Events를 쓰는가]
  //
  // Mouse Events(mousemove 등)는 iframe 경계를 넘지 못한다.
  // 마우스가 iframe 위를 지나가면 메인 document의 mousemove가
  // 끊기고, iframe 내부의 별도 document에서만 이벤트가 발생한다.
  //
  // Pointer Events API의 setPointerCapture()를 사용하면
  // 브라우저 엔진 레벨에서 모든 포인터 이벤트를 지정 요소로
  // 리다이렉트한다. iframe 위를 지나가더라도 이벤트가 끊기지 않고
  // 메인 document에서 계속 수신할 수 있다.
  //
  // 좌표(clientX/clientY)는 포인터 캡처 상태에서도
  // 실제 화면 위치를 반영하므로 궤적 그리기에 문제가 없다.
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // 이벤트 핸들러 본체
  //
  // 각 핸들러는 아래의 safeBind()로 감싸져 등록된다.
  // 확장 컨텍스트가 무효화되면 자동으로 리스너를 전부 제거한다.
  // ----------------------------------------------------------

  function onPointerDown(e) {
    if (!settings.enabled) return;
    if (e.button !== 2) return;

    isGesturing = true;
    gestureDetected = false;
    points = [{ x: e.clientX, y: e.clientY }];
    directions = [];
    segmentDistances = [];
    lastPoint = { x: e.clientX, y: e.clientY };
    totalDistance = 0;
    activePointerId = e.pointerId;

    // Pointer Capture: iframe, 광고 위를 지나가도 이벤트가 끊기지 않는다.
    try {
      document.documentElement.setPointerCapture(e.pointerId);
    } catch (err) {}

    // iframe 위에서 드래그가 끝나도 contextmenu를 차단할 수 있도록
    // 투명 shield를 깔아둔다.
    createContextMenuShield();

    if (settings.showTrail) {
      createCanvas();
    }
    if (settings.showGestureName) {
      createOverlay();
    }
  }

  function onPointerMove(e) {
    if (!isGesturing) return;

    const current = { x: e.clientX, y: e.clientY };
    points.push(current);
    drawTrail(current.x, current.y);

    const dist = distance(lastPoint, current);
    totalDistance += dist;

    // 드래그가 감지되는 즉시 컨텍스트 메뉴 차단 플래그를 건다.
    if (!gestureDetected && totalDistance > DRAG_THRESHOLD) {
      gestureDetected = true;
    }

    if (dist >= settings.minDistance) {
      const dir = getDirection(lastPoint, current);

      if (directions.length === 0) {
        // 첫 방향 등록
        directions.push(dir);
        segmentDistances.push(dist);
      } else if (directions[directions.length - 1] === dir) {
        // 같은 방향 -> 거리만 누적
        segmentDistances[segmentDistances.length - 1] += dist;
      } else {
        // 방향이 바뀜 -> 이전 세그먼트가 떨림인지 판정
        const lastSegDist = segmentDistances[segmentDistances.length - 1];

        if (lastSegDist < DIR_JITTER_THRESHOLD && directions.length >= 2) {
          // 이전 세그먼트가 짧다 = 꺾이는 지점의 떨림으로 판정
          if (directions[directions.length - 2] === dir) {
            // 떨림 전 방향과 현재 방향이 같다 -> 떨림 세그먼트 제거, 병합
            // 예: ["U", "R(떨림)"] + "U" -> ["U"]
            directions.pop();
            segmentDistances.pop();
            segmentDistances[segmentDistances.length - 1] += dist;
          } else {
            // 떨림 전 방향과 현재 방향이 다르다 -> 떨림을 현재 방향으로 교체
            // 예: ["U", "D(떨림)"] + "R" -> ["U", "R"]
            directions[directions.length - 1] = dir;
            segmentDistances[segmentDistances.length - 1] = dist;
          }
        } else {
          // 정상적인 방향 전환
          directions.push(dir);
          segmentDistances.push(dist);
        }
      }
      lastPoint = current;

      const action = recognizeGesture();
      if (action && totalDistance >= settings.sensitivity) {
        showGestureName(ACTION_LABELS[action] || action);
      } else if (directions.length > 0) {
        const arrowMap = { U: "\u2191", D: "\u2193", L: "\u2190", R: "\u2192" };
        const arrows = directions.map((d) => arrowMap[d] || d).join(" ");
        showGestureName(arrows);
      }
    }
  }

  function onPointerUp(e) {
    if (!isGesturing) return;
    if (e.button !== 2) return;

    isGesturing = false;

    try {
      document.documentElement.releasePointerCapture(e.pointerId);
    } catch (err) {}
    activePointerId = null;

    console.log(
      "[Gesture] pointerup -",
      "dirs=[" + directions.join(",") + "]",
      "segDist=[" + segmentDistances.map(Math.round).join(",") + "]",
      "total=" + Math.round(totalDistance)
    );

    if (totalDistance >= settings.sensitivity) {
      const action = recognizeGesture();
      if (action) {
        console.log("[Gesture] sending action:", action);
        try {
          chrome.runtime.sendMessage(
            { type: "gesture", action: action },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn(
                  "[Gesture] sendMessage error:",
                  chrome.runtime.lastError.message
                );
              } else {
                console.log("[Gesture] sendMessage response:", response);
              }
            }
          );
        } catch (err) {
          console.warn("[Gesture] sendMessage exception:", err.message);
        }

        showGestureName(ACTION_LABELS[action] || action);
        setTimeout(cleanup, 300);
        return;
      }
    }

    // 드래그가 있었으면 cleanup을 약간 지연한다.
    // contextmenu 이벤트는 pointerup 직후에 발생하는데,
    // 즉시 cleanup하면 shield가 사라져서 iframe 위의
    // contextmenu를 차단하지 못한다.
    if (gestureDetected) {
      setTimeout(cleanup, 80);
    } else {
      // 순수 우클릭(드래그 없음) -> 즉시 정리, 정상 컨텍스트 메뉴 허용
      cleanup();
    }
  }

  function onContextMenu(e) {
    if (gestureDetected) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      gestureDetected = false;
    }
  }

  function cleanup() {
    if (activePointerId !== null) {
      try {
        document.documentElement.releasePointerCapture(activePointerId);
      } catch (err) {}
      activePointerId = null;
    }
    removeCanvas();
    removeOverlay();
    removeContextMenuShield();
    points = [];
    directions = [];
    segmentDistances = [];
    totalDistance = 0;
  }

  // ----------------------------------------------------------
  // 이벤트 리스너 등록
  //
  // safeBind: 모든 핸들러를 try-catch로 감싼다.
  // "Extension context invalidated" 에러 발생 시
  // 모든 리스너를 자동 제거하여 죽은 스크립트가 남지 않도록 한다.
  // ----------------------------------------------------------
  const boundHandlers = [];

  function safeBind(target, event, handler, options) {
    const wrapped = function (e) {
      try {
        handler(e);
      } catch (err) {
        if (
          err.message &&
          err.message.includes("Extension context invalidated")
        ) {
          // 확장 컨텍스트 무효화 -> 모든 리스너 제거
          for (const h of boundHandlers) {
            h.target.removeEventListener(h.event, h.wrapped, h.options);
          }
          boundHandlers.length = 0;
          cleanup();
        }
      }
    };
    boundHandlers.push({ target, event, wrapped, options });
    target.addEventListener(event, wrapped, options);
  }

  safeBind(document, "pointerdown", onPointerDown, true);
  safeBind(document, "pointermove", onPointerMove, true);
  safeBind(document, "pointerup", onPointerUp, true);
  safeBind(document, "contextmenu", onContextMenu, true);
  safeBind(window, "beforeunload", cleanup, false);
})();
