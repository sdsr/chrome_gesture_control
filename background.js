// ============================================================
// Mouse Gesture Navigation - Background Service Worker
// ============================================================
// 컨텐츠 스크립트에서 인식된 동작 ID를 받아
// 해당하는 브라우저 동작을 실행한다.
//
// [동작 목록]
// 탐색: BACK, FORWARD, JUMPTO_TOP, JUMPTO_BOTTOM, HOMEPAGE,
//       REFRESH, PAGE_UP, PAGE_DOWN
// 탭:   NEW_TAB, CLOSE_TAB, CLONE_TAB, ACTIVATE_LEFT_TAB,
//       ACTIVATE_RIGHT_TAB, CLOSE_OTHER_TAB, CLOSE_LEFT_TAB,
//       CLOSE_RIGHT_TAB, REOPEN_CLOSED_TAB
// 창:   NEW_WINDOW, OPENIN_SECRET_WINDOW, CLOSE_WINDOW,
//       FULLSCREEN_WINDOW, MAXIMIZE_WINDOW, MINIMIZE_WINDOW
// 기타: TOGGLE_MUTE, OPEN_DOWNLOADS, TOGGLE_BOOKMARK
// ============================================================

/**
 * 동작 ID에 따라 실제 브라우저 동작을 실행한다.
 *
 * @param {string} action    - 동작 ID
 * @param {number} tabId     - 제스처가 발생한 탭의 ID
 * @param {number} windowId  - 제스처가 발생한 창의 ID
 * @param {string} tabUrl    - 현재 탭의 URL
 */
async function executeAction(action, tabId, windowId, tabUrl) {
  try {
    switch (action) {

      // ========== 탐색 ==========

      case "BACK":
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => history.back(),
        });
        break;

      case "FORWARD":
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => history.forward(),
        });
        break;

      case "JUMPTO_TOP":
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.scrollTo({ top: 0, behavior: "smooth" }),
        });
        break;

      case "JUMPTO_BOTTOM":
        chrome.scripting.executeScript({
          target: { tabId },
          func: () =>
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: "smooth",
            }),
        });
        break;

      case "PAGE_UP":
        chrome.scripting.executeScript({
          target: { tabId },
          func: () =>
            window.scrollBy({ top: -window.innerHeight, behavior: "smooth" }),
        });
        break;

      case "PAGE_DOWN":
        chrome.scripting.executeScript({
          target: { tabId },
          func: () =>
            window.scrollBy({ top: window.innerHeight, behavior: "smooth" }),
        });
        break;

      case "HOMEPAGE":
        // 새 탭 페이지로 이동 (Chrome 홈페이지)
        chrome.tabs.update(tabId, { url: "chrome://newtab" });
        break;

      case "REFRESH":
        chrome.tabs.reload(tabId);
        break;

      // ========== 탭 관리 ==========

      case "NEW_TAB":
        chrome.tabs.create({});
        break;

      case "CLOSE_TAB":
        chrome.tabs.remove(tabId);
        break;

      case "CLONE_TAB":
        // 현재 탭 복제: tabs.duplicate()는 동일한 URL의 새 탭을 생성한다
        chrome.tabs.duplicate(tabId);
        break;

      case "ACTIVATE_LEFT_TAB": {
        // 현재 창의 모든 탭을 조회하여 왼쪽(인덱스 - 1) 탭으로 이동
        const tabs = await chrome.tabs.query({ windowId });
        const currentTab = tabs.find((t) => t.id === tabId);
        if (currentTab) {
          // 가장 왼쪽이면 순환하여 마지막 탭으로 이동
          const prevIndex =
            currentTab.index > 0 ? currentTab.index - 1 : tabs.length - 1;
          const targetTab = tabs.find((t) => t.index === prevIndex);
          if (targetTab) {
            chrome.tabs.update(targetTab.id, { active: true });
          }
        }
        break;
      }

      case "ACTIVATE_RIGHT_TAB": {
        // 현재 창의 모든 탭을 조회하여 오른쪽(인덱스 + 1) 탭으로 이동
        const tabs = await chrome.tabs.query({ windowId });
        const currentTab = tabs.find((t) => t.id === tabId);
        if (currentTab) {
          // 가장 오른쪽이면 순환하여 첫 번째 탭으로 이동
          const nextIndex =
            currentTab.index < tabs.length - 1 ? currentTab.index + 1 : 0;
          const targetTab = tabs.find((t) => t.index === nextIndex);
          if (targetTab) {
            chrome.tabs.update(targetTab.id, { active: true });
          }
        }
        break;
      }

      case "CLOSE_OTHER_TAB": {
        // 현재 탭을 제외한 같은 창의 모든 탭 닫기
        const tabs = await chrome.tabs.query({ windowId });
        const otherTabIds = tabs
          .filter((t) => t.id !== tabId)
          .map((t) => t.id);
        if (otherTabIds.length > 0) {
          chrome.tabs.remove(otherTabIds);
        }
        break;
      }

      case "CLOSE_LEFT_TAB": {
        // 현재 탭 왼쪽의 모든 탭 닫기
        const tabs = await chrome.tabs.query({ windowId });
        const currentTab = tabs.find((t) => t.id === tabId);
        if (currentTab) {
          const leftTabIds = tabs
            .filter((t) => t.index < currentTab.index)
            .map((t) => t.id);
          if (leftTabIds.length > 0) {
            chrome.tabs.remove(leftTabIds);
          }
        }
        break;
      }

      case "CLOSE_RIGHT_TAB": {
        // 현재 탭 오른쪽의 모든 탭 닫기
        const tabs = await chrome.tabs.query({ windowId });
        const currentTab = tabs.find((t) => t.id === tabId);
        if (currentTab) {
          const rightTabIds = tabs
            .filter((t) => t.index > currentTab.index)
            .map((t) => t.id);
          if (rightTabIds.length > 0) {
            chrome.tabs.remove(rightTabIds);
          }
        }
        break;
      }

      case "REOPEN_CLOSED_TAB":
        // 가장 최근에 닫힌 탭 복원
        try {
          await chrome.sessions.restore();
        } catch (e) {
          console.warn("No closed session to restore:", e.message);
        }
        break;

      // ========== 창 관리 ==========

      case "NEW_WINDOW":
        chrome.windows.create({});
        break;

      case "OPENIN_SECRET_WINDOW":
        // 현재 탭의 URL을 시크릿 창으로 연다.
        // chrome://extensions에서 "시크릿 모드에서 허용"을 켜야
        // 시크릿 창에서도 확장이 동작한다.
        chrome.windows.create({
          url: tabUrl || undefined,
          incognito: true,
        });
        break;

      case "CLOSE_WINDOW":
        chrome.windows.remove(windowId);
        break;

      case "FULLSCREEN_WINDOW": {
        // 전체화면 토글: fullscreen <-> normal
        const win = await chrome.windows.get(windowId);
        const newState =
          win.state === "fullscreen" ? "normal" : "fullscreen";
        chrome.windows.update(windowId, { state: newState });
        break;
      }

      case "MAXIMIZE_WINDOW": {
        // 최대화 토글: maximized <-> normal
        const win = await chrome.windows.get(windowId);
        const newState =
          win.state === "maximized" ? "normal" : "maximized";
        chrome.windows.update(windowId, { state: newState });
        break;
      }

      case "MINIMIZE_WINDOW":
        chrome.windows.update(windowId, { state: "minimized" });
        break;

      // ========== 기타 ==========

      case "TOGGLE_MUTE": {
        // 현재 탭의 음소거 상태를 토글한다
        const tab = await chrome.tabs.get(tabId);
        chrome.tabs.update(tabId, { muted: !tab.mutedInfo.muted });
        break;
      }

      case "OPEN_DOWNLOADS":
        // 다운로드 페이지를 새 탭으로 열기
        chrome.tabs.create({ url: "chrome://downloads" });
        break;

      case "TOGGLE_BOOKMARK": {
        // 현재 URL이 북마크에 있으면 삭제, 없으면 추가
        if (!tabUrl) break;
        const bookmarks = await chrome.bookmarks.search({ url: tabUrl });
        if (bookmarks.length > 0) {
          // 이미 북마크됨 -> 삭제
          for (const bm of bookmarks) {
            await chrome.bookmarks.remove(bm.id);
          }
        } else {
          // 북마크 추가 (기타 북마크 폴더에)
          const tab = await chrome.tabs.get(tabId);
          chrome.bookmarks.create({
            title: tab.title || tabUrl,
            url: tabUrl,
          });
        }
        break;
      }

      case "NONE":
      default:
        break;
    }
  } catch (err) {
    console.warn("Gesture action failed:", action, err.message);
  }
}

// 컨텐츠 스크립트로부터 메시지 수신
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "gesture" && sender.tab) {
    executeAction(
      message.action,
      sender.tab.id,
      sender.tab.windowId,
      sender.tab.url
    );
    sendResponse({ success: true });
  }
});
