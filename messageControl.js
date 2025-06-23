// WebSocket接続の初期化
function initializeWebSocket() {
  function getUserId() {
    const m = document.cookie.match(/(^| )user_id=([^;]+)/);
    return m ? m[2] : null;
  }

  const uid = getUserId();
  if (!uid) {
    console.log("WebSocket: No user ID found in cookie");
    return null;
  }

  console.log(`WebSocket: Initializing connection for user ${uid}`);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socketUrl = `${proto}://${location.host}`;
  console.log(`WebSocket: Connecting to ${socketUrl}`);

  const socket = new WebSocket(socketUrl);

  socket.addEventListener("open", () => {
    console.log("WebSocket: Connection established, sending init message");
    socket.send(JSON.stringify({ type: "init", deviceId: uid }));
  });

  socket.addEventListener("close", (event) => {
    console.log(`WebSocket: Connection closed. Code: ${event.code}, Reason: ${event.reason}`);
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket: Connection error", error);
  });

  return socket;
}

// WebSocket接続を初期化
const socket = initializeWebSocket();

// チャット要素を取得
const textarea = document.querySelector('.messaging-box textarea');
const sendBtn = document.querySelector('.send-button');

// チャット送信機能
function sendChatMessage() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error('WebSocket接続が確立されていません');
    return;
  }

  if (!textarea) {
    console.error('テキストエリアが見つかりません');
    return;
  }

  const message = textarea.value.trim();
  if (!message) return;

  const uid = getUserId();
  if (!uid) {
    console.error('ユーザーIDが見つかりません');
    return;
  }

  // WebSocketでチャットメッセージを送信
  socket.send(JSON.stringify({
    type: 'chat',
    deviceId: uid,
    content: message
  }));

  // 入力欄をクリア
  textarea.value = '';
}

// チャットメッセージを表示する関数
function appendMessage({ message, messenger }) {
  const chatsContainer = document.querySelector('.chats');
  const lastChild = chatsContainer.lastElementChild;

  // 新しいチャット要素を作成
  const chatDiv = document.createElement('div');
  chatDiv.className = 'chat';

  // システムメッセージの場合は特別なスタイルを適用
  if (messenger === 'システム') {
    chatDiv.style.backgroundColor = '#ffebee';
    chatDiv.style.border = '1px solid #f44336';
    chatDiv.style.borderRadius = '8px';
    chatDiv.style.margin = '5px 0';
    chatDiv.style.padding = '8px';
  }

  const messageP = document.createElement('p');
  messageP.className = 'message';
  messageP.textContent = message;

  // システムメッセージの場合は赤色にする
  if (messenger === 'システム') {
    messageP.style.color = '#d32f2f';
    messageP.style.fontWeight = 'bold';
  }

  const messengerP = document.createElement('p');
  messengerP.className = 'messenger';
  messengerP.textContent = messenger;

  chatDiv.appendChild(messageP);
  chatDiv.appendChild(messengerP);

  // 入力ボックス（最後の要素）の前に挿入
  chatsContainer.insertBefore(chatDiv, lastChild);

  // チャットエリアを最下部にスクロール
  chatsContainer.scrollTop = chatsContainer.scrollHeight;
}

// ユーザーIDを取得する関数
function getUserId() {
  const m = document.cookie.match(/(^| )user_id=([^;]+)/);
  return m ? m[2] : null;
}

// イベントリスナーを設定
document.addEventListener('DOMContentLoaded', () => {
  // 送信ボタンのクリックイベント
  if (sendBtn) {
    sendBtn.addEventListener('click', sendChatMessage);
  }

  // Enterキーでの送信（Shift+Enterは改行）
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
});

socket.addEventListener("message", (evt) => {
  let d;
  try {
    d = JSON.parse(evt.data);
  } catch {
    return;
  }

  // 既存のチャット機能
  if (d.type === "chat") {
    appendMessage({ message: d.content, messenger: d.senderName });
  }  // 既存の死亡処理
  if (d.type === "killed") {
    console.log("[DEBUG] 'killed' message received:", d);
    showNotification("あなたは殺されました", "error");

    // チャット機能を無効化
    if (textarea) {
      textarea.disabled = true;
      textarea.placeholder = "あなたは殺されました";
    }
    if (sendBtn) {
      sendBtn.disabled = true;
    }

    // UI要素を非表示にする
    hideGameUIForDeadPlayer();

    // タスクを非表示
    if (window.renderTasks) window.renderTasks(false);

    // 死亡オーバーレイを表示
    showDeathOverlay();
  }
  // 会議開始通知
  if (d.type === "meetingStarted") {
    showMeetingNotification("会議が開始されました", d.duration);

    // キルログをチャットに表示
    if (d.killLogs && d.killLogs.length > 0) {
      setTimeout(() => {
        d.killLogs.forEach(killLog => {
          const killMessage = `${killLog.victimName}がキルされた。`;
          appendMessage({
            message: killMessage,
            messenger: "システム"
          });
        });
      }, 500); // 会議UI表示後に少し遅延させる
    }

    setTimeout(updateMeetingStatus, 500);
  }

  // 会議終了通知
  if (d.type === "meetingEnded") {
    // 会議状態を即座に更新
    setTimeout(updateMeetingStatus, 500);
    if (d.executed) {
      // 投票結果による吊るし表示
      showNotification(`${d.executed.name} は吊るされました`, "hanging");
      // 自分が吊るされた場合、死亡処理を適用
      const myId = getUserId();
      if (d.executed.deviceId === myId) {
        // チャット機能無効化
        if (textarea) {
          textarea.disabled = true;
          textarea.placeholder = "あなたは吊るされました";
        }
        if (sendBtn) sendBtn.disabled = true;
        // ゲームUI非表示
        hideGameUIForDeadPlayer();
        // タスクを非表示
        if (window.renderTasks) window.renderTasks(false);
        // 死亡オーバーレイ表示
        showDeathOverlay();
      }
    }
    if (d.gameEnded?.ended) {
      showGameEndModal(d.gameEnded);
    }
  }

  // 通報通知
  if (d.type === "reportNotification") {
    showNotification(d.message, "report");
  }
  // 通報関連
  if (d.type === "report_success") {
    showNotification(d.message || "通報しました", "success");
  }

  if (d.type === "report_error") {
    showNotification(d.message || "通報に失敗しました", "error");
  }

  // 殺害関連
  if (d.type === "kill_success") {
    showNotification(d.message || "殺害に成功しました", "success");
    // 殺害成功時に殺害ボタンの表示を更新
    if (window.killDebug && window.killDebug.findNearestKillTarget) {
      setTimeout(async () => {
        try {
          const target = await window.killDebug.findNearestKillTarget();
          const killingBtn = document.querySelector(".killingButton");
          if (killingBtn && target) {
            killingBtn.innerHTML = `<h1 class="killingButton-title">殺害: ${target.name}</h1>`;
          } else if (killingBtn) {
            killingBtn.innerHTML = `<h1 class="killingButton-title">対象なし</h1>`;
          }
        } catch (error) {
          console.error("殺害ボタン更新エラー:", error);
        }
      }, 1000);
    }
  }
  if (d.type === "kill_error") {
    showNotification(d.message || "殺害に失敗しました", "error");
  }

  // 殺害通知は殺害者と被害者のみが受信するため、全体通知は削除
});

// 通知表示関数
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `game-notification ${type}`;
  notification.textContent = message;
  // スタイル設定
  notification.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      padding: clamp(8px, 2.5vw, 12px) clamp(12px, 3vw, 20px);
      border-radius: 12px;
      color: #f0f0f0;
      font-weight: 600;
      font-family: 'Inter', 'M PLUS Rounded 1c', 'Noto Sans JP', sans-serif;
      font-size: clamp(0.8rem, 3.5vw, 1rem);
      z-index: 1000;
      animation: slideIn 0.3s ease-out;
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      max-width: min(300px, 90vw);
      word-wrap: break-word;
      ${getNotificationColor(type)}
    `;

  document.body.appendChild(notification);

  // 3秒後に削除
  setTimeout(() => {
    notification.style.animation = "slideOut 0.3s ease-in";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function getNotificationColor(type) {
  switch (type) {
    case "error":
      return "background: rgba(255, 107, 107, 0.2); border-color: rgba(255, 107, 107, 0.4);";
    case "success":
      return "background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.4);";
    case "report":
      return "background: rgba(255, 152, 0, 0.2); border-color: rgba(255, 152, 0, 0.4);";
    case "execution":
      return "background: rgba(156, 39, 176, 0.2); border-color: rgba(156, 39, 176, 0.4);";
    case "hanging":
      return "background: rgba(121, 85, 72, 0.2); border-color: rgba(121, 85, 72, 0.4);";
    case "meeting":
      return "background: rgba(102, 155, 188, 0.2); border-color: rgba(102, 155, 188, 0.4);";
    default:
      return "background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2);";
  }
}

// 死亡時のオーバーレイ表示
function showDeathOverlay() {
  // 既存のオーバーレイがあれば削除
  const existingOverlay = document.getElementById("death-overlay");
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement("div");
  overlay.id = "death-overlay";
  overlay.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(12px);
      color: #f0f0f0;
      text-align: center;
      font-family: 'Inter', 'M PLUS Rounded 1c', 'Noto Sans JP', sans-serif;
      z-index: 2000;
      padding: 20px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.4);
    `;
  overlay.innerHTML = `
      <div style="
        display: flex; 
        align-items: center; 
        justify-content: center; 
        gap: clamp(8px, 3vw, 15px);
        flex-wrap: wrap;
        padding: 0 10px;
      ">
        <h2 style="
          margin: 0; 
          color: #ff6b6b; 
          font-size: clamp(1.1rem, 4vw, 1.5rem); 
          font-weight: 600;
          background: rgba(255, 107, 107, 0.1);
          padding: clamp(6px, 2vw, 8px) clamp(12px, 3vw, 16px);
          border-radius: 12px;
          border: 1px solid rgba(255, 107, 107, 0.3);
          text-align: center;
        ">💀 あなたは死んでいます</h2>
        <div style="
          font-size: clamp(14px, 3.5vw, 16px); 
          opacity: 0.8;
          background: rgba(255, 255, 255, 0.07);
          padding: clamp(6px, 2vw, 8px) clamp(8px, 2.5vw, 12px);
          border-radius: 8px;
          text-align: center;
        ">👁️ 観戦モード</div>
      </div>
    `;
  document.body.appendChild(overlay);
}

// 会議UI非表示
function hideMeetingUI() {
  const meetingUI = document.getElementById("meeting-ui");
  if (meetingUI) {
    meetingUI.remove();
  }
}

// 会議タイマー
function startMeetingTimer(duration) {
  let timeLeft = duration;
  const timerElement = document.getElementById("meeting-timer");

  const timer = setInterval(() => {
    timeLeft--;
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    if (timerElement) {
      timerElement.textContent = `${minutes}:${String(seconds).padStart(
        2,
        "0"
      )}`;
    }

    if (timeLeft <= 0) {
      clearInterval(timer);
    }
  }, 1000);
}

// 会議通知表示
function showMeetingNotification(message, duration) {
  // durationが数値でない場合の処理
  if (typeof duration !== 'number' || isNaN(duration) || duration < 0) {
    console.warn('無効なduration値を検出:', duration, '-> 0に設定');
    duration = 0;
  }

  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const timeStr = `${minutes}:${String(seconds).padStart(2, "0")}`;

  showNotification(
    `${message} (${timeStr})`,
    "meeting"
  );
}

// ゲーム終了モーダル
function showGameEndModal(gameResult) {
  const modal = document.createElement("div");
  modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 3000;
      font-family: 'Inter', 'M PLUS Rounded 1c', 'Noto Sans JP', sans-serif;
    `;

  const isVillagerWin = gameResult.winner === "villagers"; modal.innerHTML = `
      <div style="
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: clamp(20px, 5vw, 40px);
        border-radius: 16px;
        text-align: center;
        width: min(90vw, 400px);
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        color: #f0f0f0;
        margin: 0 10px;
      ">
        <div style="
          font-size: clamp(48px, 12vw, 64px); 
          margin-bottom: clamp(15px, 4vw, 20px);
        ">
          ${isVillagerWin ? "🏘️" : "🐺"}
        </div>
        <h1 style="
          margin: 0 0 clamp(15px, 4vw, 20px) 0; 
          color: ${isVillagerWin ? "#4CAF50" : "#ff6b6b"};
          font-weight: 600;
          font-size: clamp(1.4rem, 5vw, 2rem);
          line-height: 1.2;
        ">
          ${isVillagerWin ? "村人陣営の勝利！" : "人狼陣営の勝利！"}
        </h1>
        <p style="
          font-size: clamp(14px, 3.5vw, 16px); 
          margin-bottom: clamp(20px, 5vw, 30px); 
          color: #ccc;
          background: rgba(255, 255, 255, 0.07);
          padding: clamp(8px, 2.5vw, 12px);
          border-radius: 12px;
          line-height: 1.4;
        ">
          ${gameResult.reason}
        </p>
        <button onclick="location.reload()" style="
          background: rgba(255, 255, 255, 0.1);
          color: #f0f0f0;
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: clamp(10px, 2.5vw, 12px) clamp(20px, 4vw, 24px);
          border-radius: 12px;
          font-size: clamp(14px, 3.5vw, 16px);
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          font-family: 'Inter', 'M PLUS Rounded 1c', 'Noto Sans JP', sans-serif;
          width: 100%;
          max-width: 250px;
        " 
        onmouseover="this.style.background='rgba(255, 255, 255, 0.2)'; this.style.transform='scale(1.05)'"
        onmouseout="this.style.background='rgba(255, 255, 255, 0.1)'; this.style.transform='scale(1)'"
        ontouchstart="this.style.background='rgba(255, 255, 255, 0.2)'"
        ontouchend="this.style.background='rgba(255, 255, 255, 0.1)'"
        >🔄 新しいゲームを開始</button>
      </div>
    `;

  document.body.appendChild(modal);
}

// UserID取得関数を統一
function getUserId() {
  const m = document.cookie.match(/(^| )user_id=([^;]+)/);
  return m ? m[2] : null;
}

// デバッグ用関数
function debugLog(message, data = null) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${message}`, data || '');
}

// WebSocket接続状態を監視
function monitorWebSocketConnection() {
  if (socket) {
    debugLog(`WebSocket状態: ${socket.readyState === WebSocket.OPEN ? '接続中' : '未接続'}`);
    debugLog(`WebSocket readyState: ${socket.readyState}`);

    // WebSocket接続が切れている場合は、より頻繁に死亡状況をチェック
    if (socket.readyState !== WebSocket.OPEN) {
      debugLog('WebSocket接続が切れているため、死亡状況チェックを実行');
      checkDeathStatusFromDatabase();
    }
  } else {
    debugLog('WebSocketが初期化されていません');
    // WebSocketがない場合も死亡状況をチェック
    checkDeathStatusFromDatabase();
  }
}

// ページ読み込み時にWebSocket監視を開始
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    monitorWebSocketConnection();
    // 初回の死亡状況チェック
    checkDeathStatusFromDatabase();
  }, 1000);

  // 定期的にWebSocket状態をチェック
  setInterval(() => {
    if (socket) {
      const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      debugLog(`WebSocket状態: ${states[socket.readyState]} (${socket.readyState})`);
    }
  }, 10000); // 10秒ごと
  // 定期的にデータベースから死亡状況をチェック
  setInterval(() => {
    checkDeathStatusFromDatabase();
  }, 5000); // 5秒ごと

  // 定期的にゲーム進捗をチェック
  setInterval(() => {
    updateGameProgress();
  }, 10000); // 10秒ごと

  // 初回進捗表示
  setTimeout(() => {
    updateGameProgress();
  }, 2000);
});

// CSS アニメーション追加
const style = document.createElement("style");
style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
document.head.appendChild(style);

// グローバルに関数を公開（他のファイルから使えるように）
window.gameSocket = socket;
window.globalSocket = socket; // script.jsとの統一のため追加
window.showNotification = showNotification;
window.updateGameProgress = updateGameProgress;

// 死亡時にゲームUI要素を非表示にする
function hideGameUIForDeadPlayer() {
  // 投票ボックスを非表示
  const voteBox = document.querySelector(".voteBox");
  if (voteBox) {
    voteBox.style.display = "none";
  }

  // チャットボックスを非表示
  const chatBox = document.querySelector(".chatBox");
  if (chatBox) {
    chatBox.style.display = "none";
  }

  // 殺害ボタンを非表示
  const killingButton = document.querySelector(".killingButton");
  if (killingButton) {
    killingButton.style.display = "none";
  }

  // タスクエリアを非表示
  const taskArea = document.querySelector(".task-area");
  if (taskArea) {
    taskArea.style.display = "none";
  }

  // 位置情報同意ボタンを非表示（まだ表示されている場合）
  const permitButton = document.querySelector(".permit-button-yes");
  if (permitButton) {
    permitButton.style.display = "none";
  }

  console.log("死亡時UI制御: ゲーム要素を非表示にしました");
}

// データベースから死亡状況をチェックする関数
async function checkDeathStatusFromDatabase() {
  try {
    const uid = getUserId();
    if (!uid) return;

    const response = await fetch(`/api/user/${uid}/status`);
    const data = await response.json();

    if (data.success && data.user) {
      const isAlive = data.user.is_alive;
      debugLog(`データベース死亡状況チェック: ${uid}, 生存=${isAlive}`);

      // データベースで死亡していて、まだUI上で死亡処理がされていない場合
      if (!isAlive && !document.getElementById("death-overlay")) {
        console.log("データベースから死亡状況を検出、死亡処理を実行します");

        // 死亡処理を実行（WebSocket通知と同じ処理）
        showNotification("あなたは殺されました", "error");

        // チャット機能を無効化
        const textarea = document.querySelector(".chatBox textarea");
        const sendBtn = document.querySelector(".send-button");
        if (textarea) {
          textarea.disabled = true;
          textarea.placeholder = "あなたは殺されました";
        }
        if (sendBtn) sendBtn.disabled = true;

        // UI要素を非表示にする
        hideGameUIForDeadPlayer();

        // タスクを非表示
        if (window.renderTasks) window.renderTasks(false);

        // 死亡オーバーレイを表示
        showDeathOverlay();
      }
    }
  } catch (error) {
    console.error("データベース死亡状況チェックエラー:", error);
  }
}

// 定期的に死亡状況をチェック
setInterval(() => {
  checkDeathStatusFromDatabase();
}, 5000); // 5秒ごと

// ゲーム進捗を表示する関数
async function updateGameProgress() {
  try {
    const response = await fetch('/api/game/progress');
    const data = await response.json();

    if (data.success) {
      if (data.gameEnded) {
        // ゲーム終了の場合
        showGameEndModal({
          ended: true,
          winner: data.winner,
          reason: data.reason
        });
      } else if (data.progress) {
        // ゲーム継続中の場合、タスクボックスに進捗を統合
        integrateProgressIntoTaskBox(data.progress);
      }
    }
  } catch (error) {
    console.error("ゲーム進捗取得エラー:", error);
  }
}

// タスクボックスに進捗情報を統合する関数
function integrateProgressIntoTaskBox(progress) {
  const taskBox = document.querySelector('.taskBox');
  if (!taskBox) return;

  // 既存の進捗情報があれば削除
  const existingProgress = taskBox.querySelector('.integrated-progress');
  if (existingProgress) existingProgress.remove();

  const tasksRemaining = progress.tasksRemaining;
  const progressPercent = Math.round((progress.completedTasks / progress.requiredTasks) * 100);

  // 危険度に応じた色を決定
  const getUrgencyColor = () => {
    if (progress.aliveVillagers <= 1) return '#ff6b6b'; // 赤：危険
    if (tasksRemaining <= 3) return '#ff9800'; // オレンジ：注意
    return '#4CAF50'; // 緑：安全
  };

  const urgencyColor = getUrgencyColor();

  // 進捗情報を挿入
  const progressDiv = document.createElement('div');
  progressDiv.className = 'integrated-progress';
  progressDiv.innerHTML = `
    <div style="
      display: flex; 
      justify-content: space-between; 
      align-items: center;
      margin-top: 8px;
      padding: 8px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 0.9rem;
    ">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1em;">🎯</span>
        <span style="color: #ffffff; font-weight: 500;">全体進捗</span>
      </div>
      <div style="
        display: flex; 
        align-items: center; 
        gap: 8px;
        font-weight: 600;
      ">
        <span style="color: ${urgencyColor}; font-size: 0.9rem;">
          ${progress.completedTasks}/${progress.requiredTasks}
        </span>
        <div style="
          width: 40px;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
        ">
          <div style="
            background: ${urgencyColor};
            height: 100%;
            width: ${progressPercent}%;
            transition: width 0.6s ease;
            border-radius: 3px;
          "></div>
        </div>
      </div>
    </div>
      <!-- 会議状態表示 -->
    <div class="meeting-status" style="
      padding: 6px 0;
      font-size: 0.85rem;
      margin-top: 4px;
      text-align: center;
    " id="meeting-status-display">
      <span style="color: #ccc;">会議状態を確認中...</span>
    </div>
  `;
  // タスクボックス内の最初の要素の後に挿入
  const firstChild = taskBox.firstElementChild;
  if (firstChild && firstChild.nextSibling) {
    taskBox.insertBefore(progressDiv, firstChild.nextSibling);
  } else {
    taskBox.appendChild(progressDiv);
  }

  // 会議状態を更新
  updateMeetingStatus();
}

// 会議状態を更新する関数
async function updateMeetingStatus() {
  try {
    const response = await fetch('/api/meeting/status');
    const data = await response.json();

    // デバッグ情報を出力
    console.log('会議状態APIレスポンス:', data);

    if (data.success && data.meeting) {
      const meeting = data.meeting;
      cachedMeetingData = meeting; // データをキャッシュ
      const isActive = meeting.isActive;

      let timeRemaining = 0;
      meetingStartTime = null;
      meetingDuration = null;

      if (isActive) {
        // startTimeとdurationから残り時間を計算
        if (meeting.startTime && meeting.duration) {
          // サーバーからの時刻文字列を正しく解釈
          // サーバーの時刻がUTCかJSTかを自動判定して処理
          let startTime;

          // 複数の形式を試行
          const timeString = meeting.startTime.replace(' ', 'T');

          // 1. JSTとして解釈を試行
          const jstTime = new Date(timeString + '+09:00').getTime();

          // 2. UTCとして解釈を試行  
          const utcTime = new Date(timeString + 'Z').getTime();

          // 3. ローカルタイムとして解釈を試行
          const localTime = new Date(timeString).getTime();

          const currentTime = new Date().getTime();

          // 現在時刻との差が最も妥当なものを選択
          const jstDiff = Math.abs(currentTime - jstTime);
          const utcDiff = Math.abs(currentTime - utcTime);
          const localDiff = Math.abs(currentTime - localTime);

          // 最も差が小さく、かつ妥当な範囲（24時間以内）のものを選択
          if (jstDiff <= utcDiff && jstDiff <= localDiff && jstDiff < 24 * 60 * 60 * 1000) {
            startTime = jstTime;
            console.log('時刻解釈: JSTとして処理');
          } else if (utcDiff <= localDiff && utcDiff < 24 * 60 * 60 * 1000) {
            startTime = utcTime;
            console.log('時刻解釈: UTCとして処理');
          } else if (localDiff < 24 * 60 * 60 * 1000) {
            startTime = localTime;
            console.log('時刻解釈: ローカルタイムとして処理');
          } else {
            // どれも妥当でない場合はサーバーのtimeRemainingを使用
            console.warn('時刻解釈に失敗、サーバーのtimeRemainingを使用');
            timeRemaining = meeting.timeRemaining || 0;
            startTime = currentTime; // ダミー値
          }

          if (timeRemaining === 0) { // 上記でtimeRemainingが設定されていない場合
            const elapsed = Math.floor((currentTime - startTime) / 1000); // 経過秒数
            timeRemaining = Math.max(0, meeting.duration - elapsed);
          }

          // キャッシュ用にタイマー情報を保存
          meetingStartTime = startTime;
          meetingDuration = meeting.duration;

          // 詳細なデバッグ情報
          console.log('時刻計算詳細:', {
            サーバー開始時刻文字列: meeting.startTime,
            JST解釈ミリ秒: jstTime,
            UTC解釈ミリ秒: utcTime,
            ローカル解釈ミリ秒: localTime,
            選択された開始時刻ミリ秒: startTime,
            現在時刻ミリ秒: currentTime,
            経過秒数: Math.floor((currentTime - startTime) / 1000),
            会議継続時間: meeting.duration,
            計算された残り時間: timeRemaining,
            現在時刻JST: new Date().toLocaleString('ja-JP'),
            選択された開始時刻JST: new Date(startTime).toLocaleString('ja-JP')
          });
        } else if (meeting.timeRemaining !== undefined) {
          // timeRemainingが直接提供されている場合
          timeRemaining = meeting.timeRemaining;
        }
      }

      // デバッグ情報
      console.log('会議情報:', {
        isActive,
        startTime: meeting.startTime,
        duration: meeting.duration,
        計算された残り時間: timeRemaining
      });

      // timeRemainingが数値でない場合の処理
      if (typeof timeRemaining !== 'number' || isNaN(timeRemaining) || timeRemaining < 0) {
        console.warn('無効なtimeRemaining値を検出:', timeRemaining, '-> 0に設定');
        timeRemaining = 0;
      }

      // UIを更新
      updateMeetingUI(isActive, timeRemaining);
    } else {

      if (data.success) {
        // 成功時の処理
        updateMeetingUI(false, 0);
      } else {
        cachedMeetingData = null;
        meetingStartTime = null;
        meetingDuration = null;

        const meetingStatusEl = document.getElementById('meeting-status-display');
        if (meetingStatusEl) {
          meetingStatusEl.innerHTML = `
            <span style="color: #ccc;">
              📡 会議状態不明
            </span>
          `;
        }
      }
    }
  } catch (error) {
    console.error('会議状態の取得エラー:', error);

    // エラー状態をキャッシュクリア
    cachedMeetingData = null;
    meetingStartTime = null;
    meetingDuration = null;

    if (data.success) {

    }

    const meetingStatusEl = document.getElementById('meeting-status-display');
    if (meetingStatusEl) {
      meetingStatusEl.innerHTML = `
        <span style="color: #f44336;">
          ❌ 状態取得エラー
        </span>
      `;
    }
  }
}

// 会議UIを更新する関数（データ取得とUI更新を分離）
function updateMeetingUI(isActive, timeRemaining) {
  const meetingStatusEl = document.getElementById('meeting-status-display');
  if (!meetingStatusEl) return;

  if (isActive) {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    meetingStatusEl.innerHTML = `
      <span style="color: #ff9800; display: flex; align-items: center; justify-content: center; gap: 4px;">
        会議中 (残り ${timeStr})
      </span>
    `;
  } else {
    meetingStatusEl.innerHTML = `      <span style="color: #4CAF50; display: flex; align-items: center; justify-content: center; gap: 4px;">
        ✅ 平常時
      </span>
    `;
  }
}

// 会議データのキャッシュ
let cachedMeetingData = null;
let meetingStartTime = null;
let meetingDuration = null;

// 定期的な会議状態更新を開始
function startMeetingStatusUpdates() {
  // 初回更新
  updateMeetingStatus();

  // 10秒ごとにサーバーから会議状態を取得
  setInterval(() => {
    updateMeetingStatus();
  }, 10000);

  // 1秒ごとに残り時間を更新（ローカル計算）
  setInterval(() => {
    updateMeetingTimer();
  }, 1000);
}

// ローカルで会議タイマーを更新する関数
function updateMeetingTimer() {
  if (!cachedMeetingData || !meetingStartTime || !meetingDuration) {
    return; // 会議データがない場合は何もしない
  }

  const currentTime = new Date().getTime();
  const elapsed = Math.floor((currentTime - meetingStartTime) / 1000);
  const timeRemaining = Math.max(0, meetingDuration - elapsed);

  // UIを更新（サーバー通信なし）
  updateMeetingUI(cachedMeetingData.isActive, timeRemaining);
}

// WebSocket接続確立時に開始
if (window.globalSocket) {
  startMeetingStatusUpdates();
} else {
  // WebSocketが準備できるまで待機
  let checkCount = 0;
  const checkInterval = setInterval(() => {
    checkCount++;
    if (window.globalSocket || checkCount >= 50) { // 5秒待機
      if (window.globalSocket) {
        startMeetingStatusUpdates();
      }
      clearInterval(checkInterval);
    }
  }, 100);
}

// チャットデバッグ機能
window.chatDebug = {
  // 現在のチャット状態を表示
  showStatus: function () {
    const uid = getUserId();
    const socketStatus = socket ? socket.readyState : 'null';
    const socketStates = {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED'
    };

    console.log('=== チャットデバッグ状態 ===');
    console.log('ユーザーID:', uid);
    console.log('WebSocket状態:', socketStates[socketStatus] || socketStatus);
    console.log('テキストエリア:', textarea ? '存在' : '見つからない');
    console.log('送信ボタン:', sendBtn ? '存在' : '見つからない');

    if (textarea) {
      console.log('テキストエリア無効化:', textarea.disabled);
      console.log('プレースホルダー:', textarea.placeholder);
    }

    if (sendBtn) {
      console.log('送信ボタン無効化:', sendBtn.disabled);
    }
  },

  // テストメッセージを送信
  sendTest: function (message = 'テストメッセージ') {
    if (textarea) {
      textarea.value = message;
      sendChatMessage();
    } else {
      console.error('テキストエリアが見つかりません');
    }
  },

  // チャット機能を強制的に有効化
  enable: function () {
    if (textarea) {
      textarea.disabled = false;
      textarea.placeholder = '';
    }
    if (sendBtn) {
      sendBtn.disabled = false;
    }
    console.log('チャット機能を有効化しました');
  },

  // チャット履歴をクリア
  clearHistory: function () {
    const chats = document.querySelectorAll('.chats .chat:not(:last-child)');
    chats.forEach(chat => chat.remove());
    console.log('チャット履歴をクリアしました');
  }
};

console.log('チャットデバッグ機能が利用可能です: window.chatDebug');

// 開発者ツール用のデバッグ機能
window.gameDebug = {
  // 会議を開始
  startMeeting: function (durationMinutes = 3) {
    fetch('/api/meeting/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        duration: durationMinutes,
        trigger: 'debug'
      })
    })
      .then(response => response.json())
      .then(data => {
        console.log('会議開始結果:', data);
        if (data.success) {
          console.log(`✅ ${durationMinutes}分間の会議を開始しました`);
        } else {
          console.error('❌ 会議開始に失敗:', data.message);
        }
      })
      .catch(error => {
        console.error('❌ 会議開始エラー:', error);
      });
  },

  // 会議を終了
  endMeeting: function () {
    fetch('/api/meeting/end', {
      method: 'POST'
    })
      .then(response => response.json())
      .then(data => {
        console.log('会議終了結果:', data);
        if (data.success) {
          console.log('✅ 会議を終了しました');
        } else {
          console.error('❌ 会議終了に失敗:', data.message);
        }
      })
      .catch(error => {
        console.error('❌ 会議終了エラー:', error);
      });
  },

  // 会議状態を確認
  checkMeeting: function () {
    fetch('/api/meeting/status')
      .then(response => response.json())
      .then(data => {
        console.log('会議状態:', data);
        if (data.success && data.meeting) {
          if (data.meeting.isActive) {
            console.log('🗣️ 会議中です');
            console.log('開始時刻:', data.meeting.startTime);
            console.log('継続時間:', data.meeting.duration + '秒');
            console.log('トリガー:', data.meeting.trigger);
          } else {
            console.log('⏸️ 会議は開催されていません');
          }
        }
      })
      .catch(error => {
        console.error('❌ 会議状態取得エラー:', error);
      });
  },

  // ユーザー一覧を表示
  showUsers: function () {
    fetch('/api/users')
      .then(response => response.json())
      .then(data => {
        console.log('ユーザー一覧:', data);
        if (data.success && data.users) {
          console.table(data.users.map(user => ({
            名前: user.name,
            ID: user.device_id,
            生存: user.is_alive ? '✅' : '❌',
            役職: user.type || '不明',
            位置: user.latitude && user.longitude ?
              `${user.latitude.toFixed(6)}, ${user.longitude.toFixed(6)}` : '未設定'
          })));
        }
      })
      .catch(error => {
        console.error('❌ ユーザー一覧取得エラー:', error);
      });
  },

  // ゲーム進捗を表示
  showProgress: function () {
    fetch('/api/game/progress')
      .then(response => response.json())
      .then(data => {
        console.log('ゲーム進捗:', data);
        if (data.success) {
          if (data.gameEnded) {
            console.log('🎮 ゲーム終了');
            console.log('勝者:', data.winner);
            console.log('理由:', data.reason);
          } else if (data.progress) {
            const p = data.progress;
            console.log('📊 ゲーム進捗');
            console.log(`タスク: ${p.completedTasks}/${p.requiredTasks} (${Math.round(p.completedTasks / p.requiredTasks * 100)}%)`);
            console.log(`生存村人: ${p.aliveVillagers}人`);
            console.log(`生存人狼: ${p.aliveWerewolves}人`);
            console.log(`残りタスク: ${p.tasksRemaining}個`);
          }
        }
      })
      .catch(error => {
        console.error('❌ ゲーム進捗取得エラー:', error);
      });
  },

  // 自分の状態を表示
  showMyStatus: function () {
    const uid = getUserId();
    if (!uid) {
      console.error('❌ ユーザーIDが見つかりません');
      return;
    }

    fetch(`/api/user/${uid}/status`)
      .then(response => response.json())
      .then(data => {
        console.log('自分の状態:', data);
        if (data.success && data.user) {
          const user = data.user;
          console.log('👤 自分の情報');
          console.log('名前:', user.name);
          console.log('ID:', user.device_id);
          console.log('生存:', user.is_alive ? '✅' : '❌');
          console.log('役職:', user.type || '不明');
          if (user.latitude && user.longitude) {
            console.log('位置:', `${user.latitude.toFixed(6)}, ${user.longitude.toFixed(6)}`);
          }
        }
      })
      .catch(error => {
        console.error('❌ 自分の状態取得エラー:', error);
      });
  },

  // 使用方法を表示
  help: function () {
    console.log(`

    `);
  }
};

// --- 会議キャッシュ確認用デバッグユーティリティ ---
window.meetingDebug = {
  // キャッシュされている会議オブジェクトを返す
  getCachedMeeting: () => cachedMeetingData,

  // キャッシュされた開始時刻・継続時間を返す
  getTimerInfo: () => ({
    meetingStartTime,
    meetingDuration
  }),

  // 一気に全部ログ出力
  logAll: () => {
    console.group('Meeting Cache Debug');
    console.log('cachedMeetingData:', cachedMeetingData);
    console.log('meetingStartTime:', meetingStartTime, new Date(meetingStartTime).toLocaleString());
    console.log('meetingDuration:', meetingDuration);
    console.groupEnd();
  }
};
/*
setInterval(() => {
  setMeetingIcon();
}, 1000);

function setMeetingIcon() {
  meetingDebug.getCachedMeeting = () => cachedMeetingData;
  const meetingData = window.meetingDebug.getCachedMeeting();

  const vote_box = document.querySelector(".voteBox");
  if (meetingData?.isActive) {
    console.log("会議は開催中です");
    if (vote_box) {
      if (!(vote_box.classList.contains("expand"))) {
        console.log("投票ボックスを縮小します");
        vote_box.classList.remove("expand");
      }
    }
  } else {
    console.log("会議は開催されていません");
    if (vote_box) {
      vote_box.classList.add("expand");
    }
  }

}
  */



console.log('ゲームデバッグ機能が利用可能です: window.gameDebug');
console.log('使用方法を確認するには: gameDebug.help()');

