const INTERVAL_MS = 2000; // ポーリング間隔

let THRESHOLD = null;

// config.json をブラウザ fetch で読み込む
async function loadConfig() {
  try {
    const res = await fetch("/config.json");
    const json = await res.json();
    THRESHOLD = json.playerThreshold;
  } catch (err) {
    console.error("設定読み込みエラー:", err);
    THRESHOLD = 4; // フォールバック値
  }
}

async function updateCount() {
  if (THRESHOLD == null) return; // config 未読込時は何もしない

  try {
    const res = await fetch("/api/users");
    const json = await res.json();
    const users = Array.isArray(json.users) ? json.users : [];

    // カウント更新（任意: UI上に表示する場合）
    document.getElementById(
      "player-count"
    ).textContent = `${users.length} / ${THRESHOLD}`;
    document.getElementById("remain").textContent = Math.max(
      THRESHOLD - users.length,
      0
    );

    // 閾値到達で自動遷移
    if (users.length >= THRESHOLD) {
      // 相対パス・絶対パスは環境に合わせて修正
      window.location.replace("/index.html");
    }

    const listElem = document.getElementById("player-list");
    listElem.innerHTML = ""; // 既存のリストをクリア

    users.forEach((user) => {
      const li = document.createElement("li");

      const nameSpan = document.createElement("span");
      nameSpan.textContent = user.name;
      nameSpan.style.marginRight = "10px";

      const colorDot = document.createElement("span");
      colorDot.style.display = "inline-block";
      colorDot.style.width = "10px";
      colorDot.style.height = "10px";
      colorDot.style.backgroundColor = user.color || "#ccc"; // デフォルト色
      colorDot.style.borderRadius = "50%";
      colorDot.style.marginRight = "5px";

      li.appendChild(colorDot);
      li.appendChild(nameSpan);
      listElem.appendChild(li);
    });
  } catch (err) {
    console.error("ユーザー数取得エラー:", err);
  }
}

(async () => {
  await loadConfig();
  updateCount();
  setInterval(updateCount, INTERVAL_MS);
})();
