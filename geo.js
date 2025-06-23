export let ido = null;
export let keido = null;
export let angleG = null;

var num = 0; // 位置情報を取得した回数をカウントする変数
var watch_id;
var isTracking = false; // 追跡状態の管理
const allow_accuracy = 20; // 位置情報の精度がこの値以下ならば有効とする

// ユーザーIDをチェックする処理
var userId;

// サーバーにログを送信するヘルパー関数
function logToServer(message) {
  fetch("/api/log", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: message }),
  }).catch((error) => console.error("logToServer error:", error)); // このエラーはブラウザコンソールにのみ表示
}

// --- 位置情報の関数---

// 位置情報の継続取得を開始
function getCurrentLocation() {
  if (isTracking) {
    console.log("既に位置情報を取得中です");
    return;
  }

  watch_id = navigator.geolocation.watchPosition(
    displayLocationInfo, // 成功時のコールバック（test2→displayLocationInfo）
    handleLocationError, // エラー時のコールバック
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 2000,
    }
  );

  isTracking = true;
  console.log("位置情報の継続取得を開始しました");
}

// 位置情報を取得して表示する関数
function displayLocationInfo(position) {
  // numが数値かチェックして修正
  if (typeof num !== "number" || isNaN(num)) {
    num = 0;
    console.warn("numを0にリセットしました");
  }

  // カウンターを増加
  num++;

  var geo_text = "緯度:" + position.coords.latitude + "\n";
  geo_text += "経度:" + position.coords.longitude + "\n";

  var date = new Date(position.timestamp);
  geo_text += "取得時刻:" + date.toLocaleString() + "\n";
  geo_text += "取得回数:" + num + "\n";

  // 精度情報も追加
  if (position.coords.accuracy) {
    geo_text += "精度:" + Math.round(position.coords.accuracy) + "m\n";
  }

  // geotest.html用の表示処理。要素がなくてもエラーにならないようにする。
  const idoEl = document.getElementById("ido");
  if (idoEl) idoEl.innerHTML = position.coords.latitude;
  const keidoEl = document.getElementById("keido");
  if (keidoEl) keidoEl.innerHTML = position.coords.longitude;
  const timestampEl = document.getElementById("timestamp");
  if (timestampEl) timestampEl.innerHTML = date.toLocaleString();
  const accuracyEl = document.getElementById("accuracy");
  if (accuracyEl)
    accuracyEl.innerHTML = Math.round(position.coords.accuracy) + "m";

  console.log("位置情報:", geo_text);
  if (position.coords.accuracy > allow_accuracy) {
    console.warn(
      "位置情報の精度が許容範囲を超えています:",
      position.coords.accuracy
    );
    return; // 精度が許容範囲を超えている場合は処理を中断
  }
  // サーバーに位置情報を送信
  const deviceId = getCookie("user_id");
  if (deviceId) {
    updatePosition(
      deviceId,
      position.coords.latitude,
      position.coords.longitude
    );
  }
}

// エラーハンドリング関数
function handleLocationError(error) {
  let errorMessage = "";
  switch (error.code) {
    case error.PERMISSION_DENIED:
      errorMessage = "位置情報の使用が拒否されました";
      break;
    case error.POSITION_UNAVAILABLE:
      errorMessage = "位置情報が取得できません";
      break;
    case error.TIMEOUT:
      errorMessage = "位置情報の取得がタイムアウトしました";
      break;
    default:
      errorMessage = "不明なエラーが発生しました";
      break;
  }

  console.error("位置情報エラー:", errorMessage);
  alert("位置情報エラー: " + errorMessage);
}

// ---向いている方向の取得---
// OS識別用
let os;

// DOM構築完了イベントハンドラ登録
window.addEventListener("DOMContentLoaded", init);

// 初期化
function init() {
  // 簡易的なOS判定
  os = detectOSSimply();
  logToServer(`[geo.js init] OS判定結果: ${os}`);
  console.log("[geo.js init] OS判定結果:", os);

  if (os == "iphone") {
    logToServer("[geo.js init] iPhoneとして初期化します。");
    console.log("[geo.js init] iPhoneとして初期化します。");
    // safari用。DeviceOrientation APIの使用をユーザに許可して貰う
    const permitButton = document.querySelector("#permit");
    if (permitButton) {
      permitButton.addEventListener("click", permitDeviceOrientationForSafari);
    } else {
      logToServer(
        "[geo.js init] #permit ボタンが見つかりません。Safariではユーザー操作による許可が必要です。"
      );
      console.log(
        "[geo.js init] #permit ボタンが見つかりません。Safariではユーザー操作による許可が必要です。"
      );
    }

    // イベントリスナーは無条件で登録しておく
    window.addEventListener("deviceorientation", orientation, true);
  } else if (os == "android") {
    logToServer("[geo.js init] Androidとして初期化します。");
    console.log("[geo.js init] Androidとして初期化します。");
    window.addEventListener("deviceorientationabsolute", orientation, true);
  } else {
    // logToServer("[geo.js init] PC環境のため、向きセンサーは使用しません。");
    console.log("[geo.js init] PC環境のため、向きセンサーは使用しません。");
  }
}

// ジャイロスコープと地磁気をセンサーから取得
let offsetAngle = 0;
let isCalibrated = false;

function orientation(event) {
  // logToServer(`[geo.js orientation] イベント発火: alpha=${event.alpha}, beta=${event.beta}, gamma=${event.gamma}, webkitCompassHeading=${event.webkitCompassHeading}`);
  // console.log("[geo.js orientation] orientationイベントが発火しました。", event);

  let absolute = event.absolute;
  let alpha = event.alpha;
  let beta = event.beta;
  let gamma = event.gamma;

  // 値が取得できない場合のエラーハンドリングを追加
  if (alpha === null || alpha === undefined) {
    logToServer("[geo.js orientation] 方向データ(alpha)が取得できません");
    console.warn("方向データが取得できません");
    return;
  }

  let degrees;
  if (os == "iphone") {
    // webkitCompasssHeading値を採用
    degrees = event.webkitCompassHeading;
    // webkitCompassHeadingが取得できない場合はalphaを使用
    if (degrees === null || degrees === undefined) {
      degrees = alpha;
    }
  } else {
    // deviceorientationabsoluteイベントのalphaを補正
    degrees = compassHeading(alpha, beta, gamma);
  }

  // degreesが有効でない場合のチェック
  if (degrees === null || degrees === undefined || isNaN(degrees)) {
    logToServer(
      `[geo.js orientation] 有効な角度データが取得できませんでした。degrees=${degrees}`
    );
    console.warn("有効な方向データが取得できません");
    return;
  }

  // 初回だけ基準値を決める
  if (!isCalibrated) {
    offsetAngle = -degrees; // 「現在向いている方向」をゼロに補正
    isCalibrated = true;
  }

  // 補正後の角度を計算（北が0度になるように）
  let corrected = (degrees + offsetAngle + 360) % 360;

  // 8方位の配列と数式で方向を決定
  const labels = ["北", "北東", "東", "東南", "南", "南西", "西", "北西"];
  const idx = Math.floor((corrected + 22.5) / 45) % 8;
  const direction = labels[idx];

  // HTMLに安全に値を設定
  const directionElement = document.querySelector("#direction");
  const absoluteElement = document.querySelector("#absolute");
  const alphaElement = document.querySelector("#alpha");
  const betaElement = document.querySelector("#beta");
  const gammaElement = document.querySelector("#gamma");

  if (directionElement)
    directionElement.innerHTML = direction + " : " + Math.round(corrected);
  if (absoluteElement) absoluteElement.innerHTML = absolute;
  if (alphaElement) alphaElement.innerHTML = Math.round(alpha);
  if (betaElement) betaElement.innerHTML = Math.round(beta);
  if (gammaElement) gammaElement.innerHTML = Math.round(gamma);
  console.log("角度情報更新成功:", corrected);
  // サーバーに角度情報を送信
  sendAngleToServer(corrected);
}

// 端末の傾き補正（Android用）
// https://www.w3.org/TR/orientation-event/
function compassHeading(alpha, beta, gamma) {
  const degtorad = Math.PI / 180;

  // convert to radians
  const _x = beta ? beta * degtorad : 0;
  const _y = gamma ? gamma * degtorad : 0;
  const _z = alpha ? alpha * degtorad : 0;

  const cX = Math.cos(_x);
  const cY = Math.cos(_y);
  const cZ = Math.cos(_z);
  const sX = Math.sin(_x);
  const sY = Math.sin(_y);
  const sZ = Math.sin(_z);

  // Calculate Vx and Vy components
  const Vx = -cZ * sY - sZ * sX * cY;
  const Vy = -sZ * sY + cZ * sX * cY;

  // Use atan2 for more robust heading calculation
  const heading = Math.atan2(Vx, Vy) * (180 / Math.PI);
  return (heading + 360) % 360;
}

// 簡易OS判定
function detectOSSimply() {
  let ret;
  const button = document.querySelector(".permitWrapper");
  if (
    navigator.userAgent.indexOf("iPhone") > 0 ||
    navigator.userAgent.indexOf("iPad") > 0 ||
    navigator.userAgent.indexOf("iPod") > 0
  ) {
    // iPad OS13のsafariはデフォルト「Macintosh」なので別途要対応
    ret = "iphone";
  } else if (navigator.userAgent.indexOf("Android") > 0) {
    ret = "android";
    if (button) {
      button.classList.add("expand");
    }
  } else {
    ret = "pc";
    if (button) {
      button.classList.add("expand");
    }
  }

  return ret;
}

// iPhone + Safariの場合はDeviceOrientation APIの使用許可をユーザに求める
function permitDeviceOrientationForSafari() {
  DeviceOrientationEvent.requestPermission()
    .then((response) => {
      if (response === "granted") {
        window.addEventListener(
          "deviceorientation",
          orientation, // detectDirection → orientation に修正
          true
        );
        const button = document.querySelector(".permitWrapper");
        if (button) {
          button.classList.toggle("expand");
          localStorage.setItem("dorAllowed", "1");
        }
        console.log("DeviceOrientation APIの使用が許可されました");
      } else {
        console.log("DeviceOrientation APIの使用が拒否されました");
        alert("方向の取得にはDeviceOrientationの許可が必要です");
      }
    })
    .catch((error) => {
      console.error("DeviceOrientation API許可の取得に失敗:", error);
      alert("方向の取得機能でエラーが発生しました");
    });
}
function checkpermit() {
  const button = document.querySelector(".permitWrapper");
  if (button && localStorage.getItem("dorAllowed") === "1") {
    button.classList.add("expand");
    window.addEventListener("deviceorientation", orientation, true);
  }
}

// --cookie関連の処理--

// CookieからユーザーIDを取得し、なければ新規作成して保存する処理

// Cookieから値を取り出す関数
function getCookie(name) {
  const value = document.cookie
    .split("; ")
    .find((row) => row.startsWith(name + "="));
  return value ? value.split("=")[1] : null;
}

// Cookieに値を保存する関数
function setCookie(name, value, days) {
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  document.cookie = `${name}=${value}; expires=${expires.toUTCString()}; path=/`;
}

function displayCookie() {
  userId = getCookie("user_id");
  if (!userId) {
    // 初めて来た人なのでIDを作って保存
    userId = "user-" + Math.random().toString(36).substring(2, 10);
    setCookie("user_id", userId, 30); // 30日間有効
    console.log("はじめまして ID：" + userId);
  } else {
    // 前に来た人
    console.log("おかえりなさい ID：" + userId);
  }

  // HTMLに表示
  const cookieElement = document.getElementById("cookie");
  if (cookieElement) {
    cookieElement.innerHTML = `ユーザーID: ${userId}`;
  }

  return userId;
}

// サーバーのベースURL
const SERVER_URL = "";

// ユーザーが存在するかチェック
async function checkUserExists(deviceId) {
  try {
    const response = await fetch(`${SERVER_URL}/api/users/${deviceId}/exists`);
    const data = await response.json();
    return data.exists;
  } catch (error) {
    console.error("ユーザー存在確認エラー:", error);
    return false;
  }
}

// 新規ユーザー登録
async function registerUser(deviceId, name, color) {
  try {
    const response = await fetch(`${SERVER_URL}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: deviceId,
        name: name,
        color: color,
      }),
    });
    const data = await response.json();
    if (data.success) {
      console.log("ユーザー登録成功:", data.userId);
      return data.userId;
    }
    return null;
  } catch (error) {
    console.error("ユーザー登録エラー:", error);
    return null;
  }
}

// 向き情報をサーバーに送信（orientationイベント内で使用）
async function sendAngleToServer(degrees) {
  const deviceId = getCookie("user_id");
  if (deviceId && !isNaN(degrees)) {
    await updateAngle(deviceId, degrees);
  }
}

// 位置情報とユーザー情報をサーバーに送信する関数
async function sendInfoToServer() {
  const deviceId = displayCookie(); // ユーザーIDを取得

  // 位置情報を取得
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      try {
        // ユーザーが存在するかチェック
        const userExists = await checkUserExists(deviceId);

        if (!userExists) {
          // ユーザーが存在しない場合は新規登録
          const userName = prompt(
            "ユーザー名を入力してください:",
            "ユーザー" + Math.floor(Math.random() * 1000)
          );
          const userColor =
            "#" + Math.floor(Math.random() * 16777215).toString(16); // ランダムカラー

          const userId = await registerUser(deviceId, userName, userColor);
          if (!userId) {
            console.error("ユーザー登録に失敗しました");
            return;
          }
        }

        // 位置情報を更新
        const success = await updatePosition(deviceId, latitude, longitude);
        if (success) {
          console.log(
            `位置情報をサーバーに送信しました: ${latitude}, ${longitude}`
          );
        }
      } catch (error) {
        console.error("サーバー通信エラー:", error);
      }
    },
    (error) => {
      console.error("位置情報の取得に失敗:", error);
      // 位置情報が取得できない場合でもユーザー登録だけは試行
      initializeUserOnly(deviceId);
    }
  );
}

// 位置情報なしでユーザー初期化のみ実行
async function initializeUserOnly(deviceId) {
  try {
    const userExists = await checkUserExists(deviceId);
    if (!userExists) {
      const userName = prompt(
        "ユーザー名を入力してください:",
        "ユーザー" + Math.floor(Math.random() * 1000)
      );
      const userColor = "#" + Math.floor(Math.random() * 16777215).toString(16);

      const userId = await registerUser(deviceId, userName, userColor);
      if (userId) {
        console.log("ユーザー登録完了（位置情報なし）");
      }
    }
  } catch (error) {
    console.error("ユーザー初期化エラー:", error);
  }
}

// サーバー接続確認
async function checkServerConnection() {
  try {
    const response = await fetch(`${SERVER_URL}/api/users`, {
      method: "GET",
      timeout: 5000,
    });
    return response.ok;
  } catch (error) {
    console.error("サーバー接続エラー:", error);
    return false;
  }
}

// 位置情報を更新
async function updatePosition(deviceId, latitude, longitude) {
  ido = latitude;
  keido = longitude;
  console.log(
    `[geo.js] サーバーへ位置情報を送信します。デバイスID: ${deviceId}, 緯度: ${latitude}, 経度: ${longitude}`
  );
  try {
    const response = await fetch("/api/users/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: deviceId,
        latitude: latitude,
        longitude: longitude,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.success) {
      console.log("位置情報更新成功");
      return true;
    }
    return false;
  } catch (error) {
    if (
      error.name === "TypeError" &&
      error.message.includes("Failed to fetch")
    ) {
      console.warn(
        "サーバーに接続できません。サーバーが起動しているか確認してください。"
      );
    } else {
      console.error("位置情報更新エラー:", error);
    }
    return false;
  }
}

// 角度情報を更新
async function updateAngle(deviceId, angle) {
  angleG = angle;
  //console.log(`[geo.js] サーバーへ角度情報を送信します。デバイスID: ${deviceId}, 角度: ${angle}`);
  try {
    const response = await fetch("/api/users/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: deviceId,
        angle: angle,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.success) {
      console.log("角度情報更新成功:", angle);
      return true;
    }
    return false;
  } catch (error) {
    if (
      error.name === "TypeError" &&
      error.message.includes("Failed to fetch")
    ) {
      console.warn("サーバーに接続できません（角度更新）");
    } else {
      console.error("角度情報更新エラー:", error);
    }
    return false;
  }
}

// ページ読み込み時にユーザー初期化とデータ送信開始
window.addEventListener("load", async () => {
  displayCookie(); // ユーザーIDを初期化
  checkpermit(); // DeviceOrientation APIの許可状態を確認

  // サーバー接続確認
  const serverAvailable = await checkServerConnection();
  if (!serverAvailable) {
    console.warn(
      "サーバーに接続できません。サーバーが起動しているか確認してください。"
    );
    alert(
      "サーバーに接続できません。サーバーを起動してからリロードしてください。"
    );
    return;
  }

  // 初回のサーバー送信を実行
  try {
    await sendInfoToServer();
    await getCurrentLocation(); // 位置情報の継続取得を開始
  } catch (error) {
    console.error("初期化エラー:", error);
  }

  // 定期的な生存確認（30秒間隔）
  setInterval(async () => {
    const deviceId = getCookie("user_id");
    if (deviceId) {
      try {
        // PUTからGETに変更
        const response = await fetch(
          `${SERVER_URL}/api/users/${deviceId}/heartbeat`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
            // bodyは不要（GETリクエストのため）
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            console.log("生存確認送信成功");
          }
        }
      } catch (error) {
        console.warn(
          "生存確認エラー（サーバー未接続の可能性）:",
          error.message
        );
      }
    }
  }, 30000);
});
export function returnInfo() {
  return {
    ido,
    keido,
    angleG,
  };
}
