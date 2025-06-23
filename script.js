import { returnInfo } from "./geo.js";
const map = new maplibregl.Map({
  container: "map",
  style:
    "https://api.maptiler.com/maps/01977113-a491-7fec-944a-e445a6864f6a/style.json?key=Pp3WMHlk6qoL0StTJ2gE",
  zoom: 19,
});

//とりあえず動かせんようにしてみたよ
map.dragRotate.disable();
map.keyboard.disable();
map.doubleClickZoom.disable();
map.touchZoomRotate.disable();

let userX = 136.6196224;
let userY = 36.5783;
let userAngle = Math.PI;



async function init() {
  // 例えば読み込み直後に一度取得
  const info = returnInfo();
  if (info.ido != null) {
    userX = info.keido;
    userY = info.ido;
    userAngle = info.angleG;
  }

  // 継続的に位置を追いかけたいなら…
  setInterval(() => {
    const { ido, keido, angleG } = returnInfo();
    if (ido != null) {
      userX = keido;
      userY = ido;
      userAngle = angleG;
      // マップの中心と方角を更新
      map.setCenter([userX, userY]);
    }
  }, 1000);
}

init();

// 位置情報取得のタイムアウト短縮＆失敗時のデフォルト返却
async function getUserPosition() {
  return new Promise((resolve) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          userX = position.coords.longitude;
          userY = position.coords.latitude;
          resolve({ lng: userX, lat: userY });
        },
        (error) => {
          console.warn("Geolocation error (fallback to default):", error);
          // デフォルト座標を返す
          resolve({ lng: userX, lat: userY });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      // Geolocation API非対応時もデフォルト返却
      resolve({ lng: userX, lat: userY });
    }
  });
}

// OSがIOSの場合に向きを取得する関数
/* async function getUserAngle() {
  return new Promise((resolve, reject) => {
    if (window.DeviceOrientationEvent) {
      window.addEventListener(
        "deviceorientation",
        (event) => {
          // iOSでは、alphaが0から360度の範囲で回転角度を表す
          userAngle = event.alpha ? (event.alpha * Math.PI) / 180 : Math.PI;
          resolve(userAngle);
        },
        { once: true, passive: true }
      );
    } else {
      reject(
        new Error("DeviceOrientationEvent is not supported by this browser.")
      );
    }
  });
}
 */

let tasks = [];

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

async function loadAndRenderTasks() {
  const deviceId = getUserId();
  if (!deviceId) {
    console.warn("User ID not found in cookies.");
    return;
  }

  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(deviceId)}`);
    const { tasks: serverTasks } = await response.json();
    if (!Array.isArray(serverTasks)) {
      throw new Error("Invalid data format");
    }

    tasks = serverTasks.map((task) => ({
      id: task.id,
      content: task.content,
      done: task.isDone,
      remainingTime: Number(task.remainingTime),
      missionId: task.mission_id,
    }));

    if (tasks.length === 0) {
      const box = document.querySelector(".taskBox");
      if (box) {
        box.innerHTML = "<p>タスクがありません</p>";
      }
      return;
    }

    renderTasks();
  } catch (err) {
    console.error("タスクの読み込みエラー:", err);
  }
}

function renderTasks() {
  const box = document.querySelector(".taskBox");
  if (!box) return;

  const wrappers = box.querySelectorAll(".taskWrapper");
  wrappers.forEach((el) => el.remove()); // 既存のタスクを削除

  // 残り時間がマイナスのタスクを除外
  const validTasks = tasks.filter((task) => task.remainingTime >= 0);

  validTasks.forEach((task) => {
    const wrap = document.createElement("div");
    wrap.className = "taskWrapper";
    if (task.done) {
      wrap.classList.add("done");
    }

    const p = document.createElement("p");
    p.className = "task";
    p.textContent = task.content;
    wrap.appendChild(p);

    const detail = document.createElement("div");
    detail.className = "task-detail";

    const btn = document.createElement("button");
    btn.className = "task-button";
    btn.dataset.taskId = task.id;
    btn.dataset.missionId = task.missionId;
    btn.textContent = task.done ? "完了" : "未完了";

    if (task.done) {
      btn.disabled = true;
      btn.classList.add("completed");
    }

    detail.appendChild(btn);

    const timeP = document.createElement("p");
    timeP.className = "limitTime";
    timeP.textContent = `残り時間: ${formatTime(task.remainingTime)}`;
    detail.appendChild(timeP);

    wrap.appendChild(detail);
    box.appendChild(wrap);
  });
}

setInterval(() => {
  let dirty = false;
  const expiredTasks = [];

  tasks.forEach((t) => {
    if (!t.done && t.remainingTime > 0) {
      t.remainingTime--;
      dirty = true;
    } else if (!t.done && t.remainingTime === 0) {
      // タスクが時間切れになった場合
      expiredTasks.push(t);
      dirty = true;
    }
  });

  // マイナス時間のタスクをローカル配列から除去（表示もされなくなる）
  tasks = tasks.filter((t) => t.remainingTime >= 0);

  // 時間切れタスクの処理
  if (expiredTasks.length > 0) {
    expiredTasks.forEach(async (expiredTask) => {
      try {
        // サーバーでタスクを削除
        await fetch(`/api/task/${expiredTask.id}`, {
          method: "DELETE",
        });

        // ローカルのタスク配列から削除
        const index = tasks.findIndex((t) => t.id === expiredTask.id);
        if (index !== -1) {
          tasks.splice(index, 1);
        }

        // 通知を表示
        if (window.showNotification) {
          window.showNotification(
            `${expiredTask.mission_name}の時間が切れました。新しいタスクを追加します`,
            "error"
          );
        }

        // 新しいタスクを底に追加（最低優先度で追加）
        const userId = getUserId();
        if (userId) {
          const response = await fetch(`/api/tasks/${userId}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              priority: "low", // 底に追加するため低優先度
              reason: "time_expired",
            }),
          });

          if (response.ok) {
            // タスクリストを再読み込み
            await loadAndRenderTasks();
            if (window.showNotification) {
              window.showNotification("新しいタスクが追加されました", "info");
            }
          }
        }
      } catch (error) {
        console.error("時間切れタスクの処理エラー:", error);
        if (window.showNotification) {
          window.showNotification(
            "タスクの更新でエラーが発生しました",
            "error"
          );
        }
      }
    });
  }

  if (dirty) renderTasks();
}, 1000);

function getUserId() {
  const name = "user_id";
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match[2] : null;
}

let geojson = {
  type: "FeatureCollection",
  features: [],
};

map.on("load", async () => {
  map.setCenter([userX, userY]);

  // サーバーからユーザの情報を取得する
  try {
    const res = await fetch("/api/users");
    const data = await res.json();

    if (!Array.isArray(data.users)) {
      throw new Error("Invalid data format");
    }

    const offsetDistance = 30;

    for (const user of data.users) {
      const pos = JSON.parse(user.position);
      const angle = user.angle || 180; // デフォルト値を設定
      const rad = (angle * Math.PI) / 180;

      const offsetX = Math.cos(rad) * offsetDistance;
      const offsetY = Math.sin(rad) * offsetDistance;

      geojson.features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [pos.lng, pos.lat],
        },
        properties: {
          userName: user.name || "Unknown User",
          userColor: user.color || `hsl(${Math.random() * 360}, 100%, 50%)`,
          angle: angle,
          offset: [offsetX, offsetY],
          isAlive:
            user.is_alive === true ||
            user.is_alive === 1 ||
            user.is_alive === "true",
        },
      });
    }
  } catch (err) {
    console.error("Error fetching user data:", err);
  }

  map.addSource("circle-source", {
    type: "geojson",
    data: geojson,
  });

  // 三角形アイコン作成
  if (!map.hasImage("triangle")) {
    const triangleCanvas = document.createElement("canvas");
    triangleCanvas.width = 64;
    triangleCanvas.height = 64;
    const ctx = triangleCanvas.getContext("2d");
    const side = 40;
    const height = (side * Math.sqrt(3)) / 2;
    const offsetX = 32;
    const offsetY = 32;
    ctx.fillStyle = "rgba(252, 163, 17, 0.7)";
    ctx.beginPath();
    ctx.moveTo(0 + offsetX, 0 + offsetY);
    ctx.lineTo(side / 2 + offsetX, height + offsetY);
    ctx.lineTo(-side / 2 + offsetX, height + offsetY);
    ctx.closePath();
    ctx.fill();

    map.addImage(
      "triangle",
      {
        width: 64,
        height: 64,
        data: ctx.getImageData(0, 0, 64, 64).data,
      },
      { pixelRatio: 2 }
    );
  }

  // 円アイコン作成
  if (!map.hasImage("circle-icon")) {
    const circleCanvas = document.createElement("canvas");
    circleCanvas.width = 64;
    circleCanvas.height = 64;
    const circleCtx = circleCanvas.getContext("2d");
    circleCtx.beginPath();
    circleCtx.arc(32, 32, 28, 0, Math.PI * 2);
    circleCtx.fillStyle = "rgba(0, 150, 255, 0.7)";
    circleCtx.fill();

    map.addImage(
      "circle-icon",
      {
        width: 64,
        height: 64,
        data: circleCtx.getImageData(0, 0, 64, 64).data,
      },
      { pixelRatio: 2 }
    );
  }

  if (!map.hasImage("dead-icon")) {
    const deadCanvas = document.createElement("canvas");
    deadCanvas.width = 64;
    deadCanvas.height = 64;
    const deadCtx = deadCanvas.getContext("2d");
    deadCtx.strokeStyle = "red";
    deadCtx.lineWidth = 8;
    deadCtx.beginPath();
    deadCtx.moveTo(10, 10);
    deadCtx.lineTo(54, 54);
    deadCtx.moveTo(54, 10);
    deadCtx.lineTo(10, 54);
    deadCtx.stroke();

    map.addImage(
      "dead-icon",
      {
        width: 64,
        height: 64,
        data: deadCtx.getImageData(0, 0, 64, 64).data,
      },
      { pixelRatio: 2 }
    );
  }

  map.addLayer({
    id: "triangle-symbol-layer",
    type: "symbol",
    source: "circle-source",
    layout: {
      "icon-image": "triangle",
      "icon-size": 2.5,
      "icon-rotate": ["get", "angle"],
      "icon-allow-overlap": true,
      "icon-anchor": "top",
    },
    filter: ["==", ["get", "is_alive"], true],
  });

  // 円レイヤー (生死でアイコンを切り替え)
  map.addLayer({
    id: "circle-symbol-layer",
    type: "symbol",
    source: "circle-source",
    layout: {
      "icon-image": [
        "case",
        ["==", ["get", "is_alive"], true],
        "circle-icon",
        "dead-icon",
      ],
      "icon-size": 0.6,
      "icon-allow-overlap": true,
    },
  });

  map.addLayer({
    id: "text-layer",
    type: "symbol",
    source: "circle-source",
    layout: {
      "text-field": ["get", "userName"],
      "text-font": ["Open Sans Regular"],
      "text-offset": [0, 1.5],
      "text-anchor": "center",
    },
    paint: {
      "text-color": [
        "case",
        ["==", ["get", "is_alive"], true],
        "#000000",
        "#808080",
      ],
      "text-halo-color": "#FFFFFF",
      "text-halo-width": 1,
    },
  });

  function animate() {
    map.setCenter([userX, userY]);
    requestAnimationFrame(animate);
  }

  animate();
});

async function updateGeojsonFromServer() {
  //console.log("[script.js] サーバーへ全ユーザー情報の取得をリクエストします。");
  try {
    const res = await fetch("/api/users");
    const data = await res.json();

    if (!Array.isArray(data.users)) {
      throw new Error("Invalid data format");
    }

    const geojson = {
      type: "FeatureCollection",
      features: [],
    };

    const offsetDistance = 30;

    for (const user of data.users) {
      const pos = JSON.parse(user.position);
      const angle = user.angle || 180;
      const rad = (angle * Math.PI) / 180;

      const offsetX = Math.cos(rad) * offsetDistance;
      const offsetY = Math.sin(rad) * offsetDistance;

      geojson.features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [pos.lng, pos.lat],
        },
        properties: {
          userName: user.name || "Unknown User",
          userColor: user.color || `hsl(${Math.random() * 360}, 100%, 50%)`,
          angle: angle,
          offset: [offsetX, offsetY],
          // is_aliveプロパティを追加
          is_alive:
            user.is_alive === true ||
            user.is_alive === 1 ||
            user.is_alive === "true",
        },
      });
    }

    const source = map.getSource("circle-source");
    if (source) {
      source.setData(geojson);
      //console.log(
      //  "[script.js] サーバーから取得した情報でマップを更新しました。",
      //  geojson
      //);
    }
  } catch (error) {
    console.error("Error fetching user data:", error);
  }
}

setInterval(() => {
  updateGeojsonFromServer();
}, 100); // 5秒ごとに更新

document.addEventListener("DOMContentLoaded", function () {
  loadAndRenderTasks();

  // タスクボックスのところ
  const taskBox = document.querySelector(".taskBox");
  taskBox.addEventListener("click", function (event) {
    if (event.target.closest(".task-button")) return;
    this.classList.toggle("expand");
  });

  // チャットボックスよ
  const chatBox = document.querySelector(".chatBox");
  const chat = chatBox.querySelector(".chat");

  chatBox.addEventListener("click", () => {
    chatBox.classList.toggle("expand");
    chat.style.display = chatBox.classList.contains("expand")
      ? "block"
      : "none";
  });

  const interactiveElements = chatBox.querySelectorAll(
    "textarea, button, .messaging-box"
  );
  interactiveElements.forEach((el) =>
    el.addEventListener("click", (event) => event.stopPropagation())
  );

  // 投票のところよ
  const voteBox = document.querySelector(".voteBox");
  if (voteBox) {
    voteBox.addEventListener("click", function (event) {
      // 拡張状態での内容クリック時は閉じない
      if (
        voteBox.classList.contains("expand") &&
        event.target.closest(".voteWrapper")
      ) {
        event.stopPropagation();
        return;
      }

      const isExpanding = !voteBox.classList.contains("expand");
      if (isExpanding) {
        // 開く時
          const meetingData = window.meetingDebug.getCachedMeeting();
          // 会議未開催時は展開せず通知を表示して処理を中断
          if (!meetingData?.isActive) {
            if (window.showNotification) {
              window.showNotification("会議はまだ開始されていません", "warning");
            } else {
              alert("会議はまだ開始されていません");
            }
            return;
          }
        voteBox.classList.add("expand");
        loadVoteCandidates();
      } else {
        // 閉じる時
        voteBox.classList.remove("expand");
      }

      event.stopPropagation();
    });
  }
  const voteButtons = voteBox.querySelectorAll(".vote-button");
  voteButtons.forEach((el) =>
    el.addEventListener("click", (event) => event.stopPropagation())
  );
  // ここから投票候補一覧の表示
  function getUserId() {
    const m = document.cookie.match(/(^| )user_id=([^;]+)/);
    return m ? m[2] : null;
  }

  function loadVoteCandidates() {
  const uid = getUserId();
  if (!uid) {
    console.error("ユーザーIDが取得できません");
    return;
  }

  // スクロール位置をリセット
  voteBox.scrollTop = 0;

  console.log("投票候補を読み込み中...");

  // 既存の候補を削除（タイトルは残す）
  voteBox
    .querySelectorAll(".voteWrapper, .vote-divider, .no-candidates, .loading-message")
    .forEach((el) => el.remove());

  // ローディング表示を追加
  const loadingWrapper = document.createElement("div");
  loadingWrapper.className = "loading-message";
  loadingWrapper.innerHTML = `
    <div class="voteWrapper" style="justify-content: center; padding: 20px;">
      <div style="display: flex; align-items: center; gap: 8px; color: #ccc;">
        <div style="
          width: 16px; 
          height: 16px; 
          border: 2px solid #ccc; 
          border-top: 2px solid #2196F3; 
          border-radius: 50%; 
          animation: spin 1s linear infinite;
        "></div>
        読み込み中...
      </div>
    </div>
  `;
  voteBox.appendChild(loadingWrapper);

  // 投票状況を取得
  fetch(`/api/vote-status/${encodeURIComponent(uid)}`)
    .then((res) => res.json())
    .then((voteStatus) => {
      return fetch("/api/users")
        .then((res) => res.json())
        .then((data) => {
          // ローディング表示を削除
          voteBox.querySelector(".loading-message")?.remove();
          
          console.log("投票候補データ:", data);
          const users = data.users || data;

          // 生存ユーザーのみ、かつ自分自身以外を候補に
          const candidates = users.filter(
            (u) =>
              u.device_id !== uid &&
              (u.is_alive === true ||
                u.is_alive === 1 ||
                u.is_alive === "true")
          );

          if (Array.isArray(candidates)) {
            // HTML形式に合わせて候補者リストを生成
            candidates.forEach((u) => {
              const wrapper = document.createElement("div");
              wrapper.className = "voteWrapper";

              const isCurrentVote =
                voteStatus.hasVoted &&
                voteStatus.targetDeviceId === u.device_id;

              // <div class="voteWrapper"><p class="voter">名前</p><button class="vote-button">投票する/投票済み</button></div>
              wrapper.innerHTML = `
                <p class="voter">${u.name}</p>
                <button class="vote-button" ${isCurrentVote ? 'disabled' : ''}>
                  ${isCurrentVote ? '投票済み' : '投票する'}
                </button>
              `;
              voteBox.appendChild(wrapper);

              const btn = wrapper.querySelector(".vote-button");
              if (!isCurrentVote) {
                btn.addEventListener("click", (event) => {
                  event.stopPropagation();
                  btn.disabled = true;
                  btn.textContent = "投票中...";
                  // WebSocket or HTTP投票処理
                  if (
                    window.globalSocket &&
                    window.globalSocket.readyState === WebSocket.OPEN
                  ) {
                    window.globalSocket.send(
                      JSON.stringify({
                        type: "vote",
                        deviceId: uid,
                        targetId: u.device_id,
                      })
                    );
                  } else {
                    fetch(`/api/vote`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        deviceId: uid,
                        targetId: u.device_id,
                      }),
                    })
                      .then((res) => res.json())
                      .then((data) => {
                        if (data.success) {
                          loadVoteCandidates();
                        } else {
                          btn.disabled = false;
                          btn.textContent = "投票する";
                          showErrorNotification(`投票に失敗: ${data.message || '不明なエラー'}`);
                        }
                      })
                      .catch((error) => {
                        btn.disabled = false;
                        btn.textContent = "投票する";
                        showErrorNotification("通信エラーが発生しました");
                      });
                  }
                });
              }
            });

            // 候補者がいない場合
            if (candidates.length === 0) {
              const wrapper = document.createElement("div");
              wrapper.className = "voteWrapper no-candidates";
              wrapper.innerHTML = `
                <div style="
                  display: flex; 
                  flex-direction: column; 
                  align-items: center; 
                  gap: 12px; 
                  padding: 20px;
                  text-align: center;
                  width: 100%;
                ">
                  <div style="font-size: 2rem;">🤷</div>
                  <p class="voter" style="margin: 0; color: #ccc;">
                    投票候補者がいません
                  </p>
                  <p style="margin: 0; color: #aaa; font-size: 0.8rem;">
                    他のプレイヤーが参加するまでお待ちください
                  </p>
                </div>
              `;
              voteBox.appendChild(wrapper);
            }
          } else {
            console.error("ユーザーデータが配列ではありません:", data);
            showErrorWrapper("データの読み込みに失敗しました");
          }
        });
    })
    .catch((err) => {
      console.error("投票候補の取得に失敗:", err);
      voteBox.querySelector(".loading-message")?.remove();
      showErrorWrapper("接続エラーが発生しました");
    });
}

// エラー通知を表示する関数
function showErrorNotification(message) {
  const errorMsg = document.createElement("div");
  errorMsg.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(244, 67, 54, 0.9);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 0.9rem;
    z-index: 2000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  errorMsg.textContent = message;
  document.body.appendChild(errorMsg);
  
  setTimeout(() => errorMsg.remove(), 3000);
}

// エラー表示用のwrapperを作成する関数
function showErrorWrapper(message) {
  const errorWrapper = document.createElement("div");
  errorWrapper.className = "voteWrapper";
  errorWrapper.innerHTML = `
    <div style="
      display: flex; 
      flex-direction: column; 
      align-items: center; 
      gap: 12px; 
      padding: 20px;
      text-align: center;
      width: 100%;
    ">
      <div style="font-size: 2rem;">⚠️</div>
      <p class="voter" style="margin: 0; color: #f44336;">
        ${message}
      </p>
      <button onclick="loadVoteCandidates()" class="vote-button" style="
        background: rgba(33, 150, 243, 0.2);
        color: #2196F3;
        border: 1px solid #2196F3;
        font-size: 0.8rem;
      ">
        🔄 再試行
      </button>
    </div>
  `;
  voteBox.appendChild(errorWrapper);
}
  // 初回読み込み
  loadVoteCandidates();

  // WebSocketが利用可能になったら再読み込み（最大10秒待機）
  let checkCount = 0;
  const checkSocketInterval = setInterval(() => {
    checkCount++;
    if (window.globalSocket) {
      console.log("WebSocket接続を確認しました");
      clearInterval(checkSocketInterval);
      // WebSocketが接続されたら再読み込みはしない（重複を防ぐため）
      // loadVoteCandidates();
    } else if (checkCount >= 100) {
      // 10秒経過
      console.warn("WebSocket接続のタイムアウト");
      clearInterval(checkSocketInterval);
    }
  }, 100); // WebSocketメッセージ処理（一度だけ設定）
  let voteMessageHandlerSet = false;
  const setupVoteMessageHandler = () => {
    if (window.globalSocket && !voteMessageHandlerSet) {
      voteMessageHandlerSet = true;
      // 投票関連のメッセージはmessageControl.jsで処理されるため、
      // ここでは基本的なログ出力のみ行う
      window.globalSocket.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "vote_success") {
            console.log("投票成功:", data.message);
            // UI更新は1.5秒後に実行
            setTimeout(() => {
              loadVoteCandidates();
            }, 1500);
          } else if (data.type === "vote_error") {
            console.error("投票エラー:", data.message);
            // エラー時は即座にリロード
            loadVoteCandidates();
          }
        } catch (e) {
          // JSON parse error - ignore
        }
      });
    }
  };

  // WebSocketの準備完了を定期的にチェック
  const checkWebSocketInterval = setInterval(() => {
    if (window.globalSocket) {
      setupVoteMessageHandler();
      clearInterval(checkWebSocketInterval);
    }
  }, 100);
});

document.addEventListener("DOMContentLoaded", function () {
  const taskBox = document.querySelector(".taskBox");
  const detailButton = document.querySelector(".detail-button");

  if (taskBox && detailButton) {
    detailButton.addEventListener("click", function (event) {
      taskBox.classList.toggle("expand");
      event.stopPropagation();
    });
  }
});

// WebSocketメッセージ処理は上記で設定済みのため、この部分は削除

// 人狼による殺人の実行
async function getMyInfo() {
  const deviceId = getUserId();
  const res = await fetch(`/api/users/${encodeURIComponent(deviceId)}`);
  return await res.json();
}

// 犯すボタンの制御（人狼のみ表示）
document.addEventListener("DOMContentLoaded", async () => {
  console.log("殺害ボタンの初期化を開始");

  const killingBtn = document.querySelector(".killingButton");
  if (!killingBtn) {
    console.warn("殺害ボタンが見つかりません");
    return;
  }

  console.log("殺害ボタンが見つかりました:", killingBtn);
  killingBtn.style.display = "none";

  try {
    const myInfo = await getMyInfo();
    console.log("ユーザー情報:", myInfo);

    if (myInfo.user && myInfo.user.type === "marder") {
      console.log("人狼ユーザーです。殺害ボタンを表示します。");
      killingBtn.style.display = "block";
      killingBtn.style.cursor = "pointer";

      // 定期的に最も近い殺害対象を表示
      let nearestTargetInterval;

      async function updateNearestTarget() {
        try {
          const target = await findNearestKillTarget();
          if (target) {
            killingBtn.innerHTML = `<h1 class="killingButton-title">殺害: ${target.name}</h1>`;
            killingBtn.style.backgroundColor = "#ff4444";
          } else {
            killingBtn.innerHTML = `<h1 class="killingButton-title">対象なし</h1>`;
            killingBtn.style.backgroundColor = "#666";
          }
        } catch (error) {
          console.error("対象更新エラー:", error);
          killingBtn.innerHTML = `<h1 class="killingButton-title">犯す</h1>`;
        }
      }

      // 初回更新と定期更新
      updateNearestTarget();
      nearestTargetInterval = setInterval(updateNearestTarget, 2000);

      // クリックイベントを設定
      killingBtn.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        console.log("殺害ボタンがクリックされました");

        // ボタンを一時的に無効化
        killingBtn.disabled = true;
        killingBtn.style.opacity = "0.5";

        try {
          await executeKill();
        } finally {
          // ボタンを再有効化
          setTimeout(() => {
            killingBtn.disabled = false;
            killingBtn.style.opacity = "1";
          }, 2000);
        }
      };

      // ページを離れる時にインターバルをクリア
      window.addEventListener("beforeunload", () => {
        if (nearestTargetInterval) {
          clearInterval(nearestTargetInterval);
        }
      });
    } else {
      console.log("人狼ではないため、殺害ボタンを非表示にします");
      killingBtn.style.display = "none";
    }
  } catch (e) {
    console.error("ユーザー情報の取得に失敗:", e);
    killingBtn.style.display = "none";
  }
});

// ボタンの状態を強制的に修正する関数
function fixKillButton() {
  console.log("殺害ボタンの修正を実行");

  const killingBtn = document.querySelector(".killingButton");
  if (!killingBtn) {
    console.error("殺害ボタンが見つかりません");
    return false;
  }

  // CSSスタイルを強制的に設定
  killingBtn.style.cssText = `
    display: block !important;
    position: fixed !important;
    bottom: 20px !important;
    right: 20px !important;
    width: 120px !important;
    height: 80px !important;
    background-color: #ff4444 !important;
    color: white !important;
    border: none !important;
    border-radius: 10px !important;
    cursor: pointer !important;
    z-index: 1000 !important;
    font-size: 14px !important;
    pointer-events: auto !important;
    opacity: 1 !important;
    visibility: visible !important;
  `;

  // すべてのイベントリスナーを削除して再設定
  const newBtn = killingBtn.cloneNode(true);
  killingBtn.parentNode.replaceChild(newBtn, killingBtn);

  // 新しいクリックイベントを設定
  newBtn.addEventListener("click", async function (event) {
    event.preventDefault();
    event.stopPropagation();
    console.log("修正されたボタンがクリックされました！");

    try {
      await executeKill();
    } catch (error) {
      console.error("殺害実行エラー:", error);
    }
  });

  console.log("殺害ボタンを修正しました");
  return true;
}

// 最も近い殺害対象を見つける関数
async function findNearestKillTarget() {
  try {
    const myInfo = await getMyInfo();
    if (!myInfo.user || !myInfo.user.position) {
      return null;
    }

    // position が文字列の場合のみJSON.parseを実行
    let position;
    if (typeof myInfo.user.position === "string") {
      position = JSON.parse(myInfo.user.position);
    } else {
      position = myInfo.user.position;
    }
    console.log("現在の位置:", position);

    // 近くのユーザーを取得
    let nearbyUsers = [];

    try {
      const res = await fetch(
        `/api/users/nearby?lng=${position.lng}&lat=${position.lat}`
      );

      if (res.status === 404) {
        // nearby エンドポイントが存在しない場合、全ユーザーを取得してフィルタ
        console.log(
          "nearbyエンドポイントが存在しないため、全ユーザーから検索します"
        );
        const allRes = await fetch("/api/users");
        const allData = await allRes.json();
        const allUsers = allData.users || [];

        // 距離でフィルタ（約100m以内）
        nearbyUsers = allUsers.filter((user) => {
          if (!user.position) return false;

          let userPos;
          try {
            userPos =
              typeof user.position === "string"
                ? JSON.parse(user.position)
                : user.position;
          } catch (e) {
            return false;
          }

          const distance = Math.hypot(
            userPos.lat - position.lat,
            userPos.lng - position.lng
          );
          return distance < 0.001; // 約100m
        });
      } else {
        const nearbyData = await res.json();

        // エラーレスポンスかどうかチェック
        if (nearbyData.error) {
          console.log("近くのユーザー取得エラー:", nearbyData.error);
          return null;
        }

        // 配列でない場合もチェック
        nearbyUsers = nearbyData.users || nearbyData;
      }
    } catch (error) {
      console.error("nearby API呼び出しエラー:", error);
      return null;
    }
    if (!Array.isArray(nearbyUsers)) {
      console.log("近くのユーザーが配列ではありません:", nearbyUsers);
      return null;
    }

    // 殺害可能な対象をフィルタリング
    const killableTargets = nearbyUsers.filter((u) => {
      // 自分自身は除外
      if (u.device_id === myInfo.user.device_id) {
        console.log(`自分自身を除外: ${u.name}`);
        return false;
      }

      // 死亡済みユーザーは除外
      if (!u.is_alive) {
        console.log(`死亡済みユーザーを除外: ${u.name}`);
        return false;
      }

      // 人狼（marder）は除外（人狼同士は殺せない）
      if (u.type === "marder") {
        console.log(`人狼ユーザーを除外: ${u.name}`);
        return false;
      }

      // 村人のみが殺害対象
      if (u.type === "villager") {
        console.log(`殺害可能な村人: ${u.name}`);
        return true;
      }

      // その他の役職も除外
      console.log(`その他の役職を除外: ${u.name} (${u.type})`);
      return false;
    });

    console.log("殺害可能な対象:", killableTargets);

    if (killableTargets.length === 0) {
      console.log("殺害可能な対象が見つかりません");
      return null;
    }
    // 距離でソートして最も近いユーザーを返す
    killableTargets.sort((a, b) => {
      // a.position と b.position も安全にパース
      let aPos, bPos;

      if (typeof a.position === "string") {
        aPos = JSON.parse(a.position);
      } else {
        aPos = a.position;
      }

      if (typeof b.position === "string") {
        bPos = JSON.parse(b.position);
      } else {
        bPos = b.position;
      }

      const d1 = Math.hypot(aPos.lat - position.lat, aPos.lng - position.lng);
      const d2 = Math.hypot(bPos.lat - position.lat, bPos.lng - position.lng);
      return d1 - d2;
    });

    const target = killableTargets[0];

    // target.position も安全にパース
    let targetPos;
    if (typeof target.position === "string") {
      targetPos = JSON.parse(target.position);
    } else {
      targetPos = target.position;
    }
    const distance = Math.hypot(
      targetPos.lat - position.lat,
      targetPos.lng - position.lng
    );

    console.log(
      `最も近い殺害対象: ${target.name} (${target.type}), 距離: ${Math.round(
        distance * 111000
      )}m`
    );

    return {
      ...target,
      distance: distance,
    };
  } catch (error) {
    console.error("最近接対象の検索に失敗:", error);
    return null;
  }
}


let meetingState;

// 殺害を実行する関数
async function executeKill() {
  console.log("殺害実行を開始");

  try {
    // 会議中は殺害不可
    const meetingResponse = await fetch("/api/meeting/status");
    const meetingData = await meetingResponse.json();
    meetingState = meetingData;
    if (
      meetingData.success &&
      meetingData.meeting &&
      meetingData.meeting.isActive
    ) {
      if (window.showNotification) {
        window.showNotification("会議中は殺害できません", "error");
      } else {
        alert("会議中は殺害できません");
      }
      return;
    }
  } catch (e) {
    console.warn("会議状態の確認に失敗:", e);
  }

  // 最も近い対象を取得
  const target = await findNearestKillTarget();

  if (!target) {
    if (window.showNotification) {
      window.showNotification("近くに殺害可能な対象がいません", "error");
    } else {
      alert("近くに人がいません");
    }
    return;
  }

  console.log("殺害対象:", target);

  // 確認ダイアログ
  const distance = Math.round(target.distance * 111000); // おおよそのメートル換算
  const confirmKill = confirm(
    `${target.name}を殺害しますか？\n（距離: 約${distance}m）`
  );
  if (!confirmKill) {
    console.log("殺害をキャンセルしました");
    return;
  }
  // WebSocketを通じて殺害を送信
  if (
    window.globalSocket &&
    window.globalSocket.readyState === WebSocket.OPEN
  ) {
    console.log("WebSocket経由で殺害を送信");
    const killData = {
      type: "kill",
      deviceId: getUserId(),
      targetDeviceId: target.device_id,
    };
    console.log("送信する殺害データ:", killData);
    console.log(
      "殺害者デバイスID:",
      getUserId(),
      "typeof:",
      typeof getUserId()
    );
    console.log(
      "殺害対象デバイスID:",
      target.device_id,
      "typeof:",
      typeof target.device_id
    );
    console.log("殺害対象情報:", target);

    window.globalSocket.send(JSON.stringify(killData));
  } else {
    console.log("API経由で殺害を実行");
    // WebSocketが利用できない場合はAPI経由
    try {
      const killResponse = await fetch(`/api/users/${target.device_id}/alive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alive: false }),
      });

      if (killResponse.ok) {
        if (window.showNotification) {
          window.showNotification(`${target.name}を殺害しました`, "success");
        } else {
          alert(`${target.name}を殺しました！`);
        }
      } else {
        throw new Error("殺害APIが失敗しました");
      }
    } catch (error) {
      console.error("殺害API呼び出しエラー:", error);
      if (window.showNotification) {
        window.showNotification("殺害に失敗しました", "error");
      } else {
        alert("殺害に失敗しました");
      }
    }
  }
}

// 殺害ボタンのテスト用関数
function testKillButton() {
  console.log("=== 殺害ボタンテスト ===");

  const killingBtn = document.querySelector(".killingButton");
  console.log("殺害ボタン要素:", killingBtn);

  if (killingBtn) {
    console.log("ボタンスタイル:", {
      display: killingBtn.style.display,
      visibility: killingBtn.style.visibility,
      opacity: killingBtn.style.opacity,
      disabled: killingBtn.disabled,
      onclick: killingBtn.onclick ? "設定済み" : "未設定",
    });

    console.log(
      "ボタンのイベントリスナー数:",
      getEventListeners ? getEventListeners(killingBtn) : "取得不可"
    );

    // 強制的にボタンを表示してテスト
    killingBtn.style.display = "block";
    killingBtn.style.visibility = "visible";
    killingBtn.style.opacity = "1";
    killingBtn.disabled = false;

    // テスト用クリックイベントを追加
    killingBtn.addEventListener("click", function testClick() {
      console.log("テストクリックが検出されました！");
      killingBtn.removeEventListener("click", testClick);
    });

    console.log("ボタンを強制表示し、テストイベントを追加しました");
    console.log("ボタンをクリックしてテストしてください");
  } else {
    console.error("殺害ボタンが見つかりません");
    // HTMLを確認
    console.log("利用可能なボタン要素:");
    document.querySelectorAll("button").forEach((btn, index) => {
      console.log(`${index}: ${btn.className} - ${btn.textContent.trim()}`);
    });
  }
}

// 最近接対象をテストする関数
async function testNearestTarget() {
  console.log("=== 最近接対象テスト ===");

  try {
    const target = await findNearestKillTarget();
    if (target) {
      console.log("最も近い対象:", target);
      console.log(`名前: ${target.name}`);
      console.log(`距離: 約${Math.round(target.distance * 111000)}m`);
      console.log(`位置: ${target.position}`);
    } else {
      console.log("殺害可能な対象が見つかりません");
    }
  } catch (error) {
    console.error("テスト中にエラーが発生:", error);
  }
}

// 強制的に殺害を実行する関数（デバッグ用）
async function forceKill() {
  console.log("=== 強制殺害テスト ===");
  console.warn("これはデバッグ用の関数です");

  try {
    await executeKill();
  } catch (error) {
    console.error("強制殺害テスト中にエラー:", error);
  }
}

// 現在のユーザー情報を表示
async function showMyInfo() {
  try {
    const myInfo = await getMyInfo();
    console.log("現在のユーザー情報:", myInfo);
    return myInfo;
  } catch (error) {
    console.error("ユーザー情報の取得に失敗:", error);
  }
}

// 定期的に会議の状態をチェックして meetingState を更新する
async function updateMeetingStatus() {
  try {
    const response = await fetch("/api/meeting/status");
    if (response.ok) {
      const data = await response.json();
      meetingState = data;
    } else {
      console.error("会議状態の取得に失敗:", response.status);
      meetingState = { success: false, error: "Failed to fetch status" };
    }
  } catch (error) {
    console.error("会議状態の更新中にエラー:", error);
    meetingState = { success: false, error: error.message };
  }
}

// 5秒ごとに会議の状態を更新
setInterval(updateMeetingStatus, 5000);
// ページ読み込み時に即時実行
document.addEventListener("DOMContentLoaded", updateMeetingStatus);

// 殺害テスト用のデバッグ関数をグローバルに公開
window.killDebug = {
  testKillButton,
  showMyInfo,
  testNearestTarget,
  forceKill,
  findNearestKillTarget,
  fixKillButton,
};

window.tasks = tasks;
window.renderTasks = renderTasks;
window.loadAndRenderTasks = loadAndRenderTasks;
window.meetingState = meetingState;
