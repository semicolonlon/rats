// server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { StringDecoder } = require("string_decoder");
const config = require("./config.json");
const os = require("os"); // 追加
const WebSocket = require("ws");

// SQLite データベースのパスを設定
const DB_PATH = path.resolve(__dirname, "JS", "game.db");
console.log("[database] opening sqlite file at:", DB_PATH);

const {
  addUser,
  updateUserPosition,
  updateUserAngle,
  updateUserAliveStatus,
  getAllUsers,
  isDeviceRegistered,
  getUserByDevice,
  getMissionsList,
  addTask,
  getTasksByUserId,
  getTasksById,
  deleteTask,
  setTaskDone,
  updateTaskTime,
  sendMessage,
  getMessagesForDevice,
  closeDatabase,
  getAllTasks,
  addVote,
  getVoteCounts,
  getUserVoteStatus,
  updateUserType,
  addReport,
  getReports,
  setMeetingState,
  getMeetingState,
  resetVotes,
  getTaskStats,
  addBody,
  getAllBodies,
  getBodyCount,
  getBodiesByKiller,
} = require("./JS/database.js");
const { send } = require("process");

// ポート設定
const PORT = process.env.PORT || config.port;

// 静的ファイルを置くディレクトリ
const publicDir = path.resolve(__dirname);

// CORS ヘッダーを付与
function setCORSHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// JSON レスポンス送信
function sendJSON(res, statusCode, obj) {
  const data = JSON.stringify(obj);
  // ヘッダーに CORS と Content-Type, Content-Length を含める
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(data);
}

// リクエストボディを JSON としてパース
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf-8");
    let body = "";
    req.on("data", (chunk) => {
      body += decoder.write(chunk);
    });
    req.on("end", () => {
      body += decoder.end();
      if (!body) {
        resolve(null);
      } else {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (err) {
          reject(new Error("Invalid JSON"));
        }
      }
    });
    req.on("error", (err) => {
      reject(err);
    });
  });
}

// 静的ファイル配信
function serveStaticFile(req, res, pathname) {
  let filePath = pathname;
  if (filePath === "/") {
    filePath = "/index.html";
  }
  const absPath = path.resolve(publicDir, "." + filePath);
  if (!absPath.startsWith(publicDir)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }
  fs.stat(absPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      // "Access-Control-Allow-Origin": "*", // 必要なら有効化
    });
    fs.createReadStream(absPath)
      .pipe(res)
      .on("error", (err) => {
        console.error("File stream error:", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("500 Internal Server Error");
      });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const [key, val] = part.split("=").map((s) => s.trim());
    if (!key) return acc;
    acc[key] = decodeURIComponent(val);
    return acc;
  }, {});
}

const server = http.createServer(async (req, res) => {
  setCORSHeaders(res);

  if (req.method === "OPTIONS") {
    setCORSHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();
  const isAPI = pathname.startsWith("/api/");

  if (!isAPI) {
    // GET でルート、index.html、waiting.html へのアクセス時にサインイン・参加人数判定
    if (
      method === "GET" &&
      (pathname === "/" ||
        pathname === "/index.html" ||
        pathname === "/waiting.html")
    ) {
      const cookies = parseCookies(req);
      const deviceId = cookies["user_id"];
      if (!deviceId) {
        // Cookieなし => サインイン
        res.writeHead(302, { Location: "/signin.html" });
        res.end();
        return;
      }
      let exists;
      try {
        exists = await isDeviceRegistered(deviceId);
      } catch (err) {
        console.error("Error in isDeviceRegistered:", err);
        // 内部エラー時はサインイン画面へ送るかエラー画面へ送るか判断。ここではサインイン。
        res.writeHead(302, { Location: "/signin.html" });
        res.end();
        return;
      }
      if (!exists) {
        res.writeHead(302, { Location: "/signin.html" });
        res.end();
        return;
      }
      // 参加人数判定
      let users;
      try {
        users = await getAllUsers();
      } catch (err) {
        console.error("Error in getAllUsers:", err);
        // エラー時は待機画面を表示 or エラー表示。ここでは待機画面にフォールバック。
        serveStaticFile(req, res, "/waiting.html");
        return;
      }
      const ready =
        Array.isArray(users) && users.length >= config.playerThreshold;
      if ((pathname === "/" || pathname === "/index.html") && !ready) {
        res.writeHead(302, { Location: "/waiting.html" });
        res.end();
        return;
      }
      if ((pathname === "/" || pathname === "/waiting.html") && ready) {
        res.writeHead(302, { Location: "/index.html" });
        res.end();
        return;
      }
    }
    // 静的ファイル配信
    // publicDir が存在しないときは 404
    if (fs.existsSync(publicDir)) {
      serveStaticFile(req, res, pathname);
    } else {
      sendJSON(res, 404, { error: "Not Found" });
    }
    return;
  }

  if (method === "GET" && !isAPI) {
    // publicDir が存在すれば:
    if (fs.existsSync(publicDir)) {
      serveStaticFile(req, res, pathname);
      return;
    }
    // publicDir が無ければ 404
    sendJSON(res, 404, { error: "Not Found" });
    return;
  }

  // --- ユーザー関連 ---

  // 人狼を1人だけ決定する関数
  async function assignMarderIfNeeded() {
    const users = await getAllUsers();
    const marders = users.filter((u) => u.type === "marder");
    if (marders.length === 0 && users.length > 0) {
      // まだ人狼がいなければランダムで1人選ぶ
      const idx = Math.floor(Math.random() * users.length);
      const marder = users[idx];
      // updateUserTypeはdatabase.jsでエクスポートされている必要あり
      if (typeof updateUserType === "function") {
        await updateUserType(marder.device_id, "marder");
        console.log(`[人狼決定] ${marder.name} (${marder.device_id})`);
      }
    }
  }

  // POST /api/users
  if (pathname === "/api/users" && method === "POST") {
    // 新規ユーザー追加
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (
      !body ||
      typeof body.deviceId !== "string" ||
      typeof body.name !== "string" ||
      typeof body.color !== "string"
    ) {
      sendJSON(res, 400, {
        error:
          "Invalid request body. require { deviceId: string, name: string, color: string }",
      });
      return;
    }
    try {
      const userId = await addUser(body.deviceId, body.name, body.color);
      console.log(
        `新規ユーザー登録: ID=${userId}, デバイス=${body.deviceId}, 名前=${body.name}`
      );
      sendJSON(res, 201, { success: true, userId });
    } catch (err) {
      console.error("Error in addUser:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/users
  if (pathname === "/api/users" && method === "GET") {
    await assignMarderIfNeeded(); // ここで人狼を決定
    try {
      const users = await getAllUsers();

      sendJSON(res, 200, { success: true, users });
    } catch (err) {
      console.error("Error in getAllUsers:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/users/:deviceId/exists
  if (pathname.match(/^\/api\/users\/[^\/]+\/exists$/) && method === "GET") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    try {
      const exists = await isDeviceRegistered(deviceId);
      sendJSON(res, 200, { success: true, exists });
    } catch (err) {
      console.error("Error in isDeviceRegistered:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/users/:deviceId
  if (pathname.match(/^\/api\/users\/[^\/]+$/) && method === "GET") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    try {
      const user = await getUserByDevice(deviceId);
      if (user) {
        sendJSON(res, 200, { success: true, user });
      } else {
        sendJSON(res, 404, { error: "User not found" });
      }
    } catch (err) {
      console.error("Error in getUserByDevice:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // PUT /api/users/:deviceId/position
  if (pathname.match(/^\/api\/users\/[^\/]+\/position$/) && method === "PUT") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (!body || typeof body.lat !== "number" || typeof body.lng !== "number") {
      sendJSON(res, 400, {
        error: "Invalid request body. require { lat: number, lng: number }",
      });
      return;
    }
    try {
      const ok = await updateUserPosition(deviceId, body.lat, body.lng);
      if (ok) {
        console.log(
          `位置情報更新: デバイス=${deviceId}, 緯度=${body.lat}, 経度=${body.lng}`
        );
        sendJSON(res, 200, { success: true });
      } else {
        sendJSON(res, 404, { error: "User not found" });
      }
    } catch (err) {
      console.error("Error in updateUserPosition:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // PUT /api/users/:deviceId/angle
  if (pathname.match(/^\/api\/users\/[^\/]+\/angle$/) && method === "PUT") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (!body || typeof body.angle !== "number") {
      sendJSON(res, 400, {
        error: "Invalid request body. require { angle: number }",
      });
      return;
    }
    try {
      const ok = await updateUserAngle(deviceId, body.angle);
      if (ok) {
        // console.log(`角度情報更新: デバイス=${deviceId}, 角度=${body.angle}度`);
        sendJSON(res, 200, { success: true });
      } else {
        sendJSON(res, 404, { error: "User not found or invalid angle" });
      }
    } catch (err) {
      console.error("Error in updateUserAngle:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // PUT /api/users/:deviceId/alive
  if (pathname.match(/^\/api\/users\/[^\/]+\/alive$/) && method === "PUT") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (!body || typeof body.alive !== "boolean") {
      sendJSON(res, 400, {
        error: "Invalid request body. require { alive: boolean }",
      });
      return;
    }
    try {
      const ok = await updateUserAliveStatus(deviceId, body.alive);      if (ok) {        console.log(`生存状況更新: デバイス=${deviceId}, 生存=${body.alive}`);
        if (body.alive === false) {
          // 死体をデータベースに登録（一般的な死亡のため殺害者はnull）
          try {
            await addBody(deviceId, null);
            console.log(`死体登録完了(一般): 被害者=${deviceId}`);
          } catch (bodyError) {
            console.error("死体登録エラー(一般):", bodyError);
            // 死体登録エラーでも死亡処理は継続
          }
          
          console.log(`死亡通知を送信します: ${deviceId}`);
          let notificationSent = false;
          for (const [ws, id] of clients.entries()) {
            if (id === deviceId && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "killed" }));
              console.log(`WebSocket通知送信完了: ${deviceId}`);
              notificationSent = true;
            }
          }
          if (!notificationSent) {
            console.log(`WebSocket通知対象が見つかりません: ${deviceId}, 登録クライアント数: ${clients.size}`);
            // デバッグ用: 登録されているクライアントの一覧を表示
            const registeredClients = Array.from(clients.values());
            console.log(`登録済みクライアント: [${registeredClients.join(', ')}]`);
          }
        }
        
        sendJSON(res, 200, { success: true });        // 死亡した場合はWebSocketで通知
      } else {
        sendJSON(res, 404, { error: "User not found" });
      }
    } catch (err) {
      console.error("Error in updateUserAliveStatus:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // POST /api/log (クライアントからのログ受信)
  if (pathname === "/api/log" && method === "POST") {
    try {
      const body = await parseRequestBody(req);
      if (body && body.message) {
        console.log(`[CLIENT-LOG] ${body.message}`);
      }
      sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error("Error in /api/log:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // --- ミッション関連 ---

  // GET /api/missions
  if (pathname === "/api/missions" && method === "GET") {
    try {
      const missions = getMissionsList();
      sendJSON(res, 200, { success: true, missions });
    } catch (err) {
      console.error("Error in getMissionsList:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // --- タスク関連 ---

  // GET /api/tasks (すべてのタスク取得)
  if (pathname === "/api/tasks" && method === "GET") {
    try {
      const tasks = await getAllTasks();
      sendJSON(res, 200, { success: true, tasks });
    } catch (err) {
      console.error("Error in getAllTasks:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }
  // POST /api/tasks/:deviceId  (ランダムミッション割当)
  if (pathname.match(/^\/api\/tasks\/[^\/]+$/) && method === "POST") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
      // リクエストボディを解析
    let body = {};
    try {
      body = await parseRequestBody(req);
      console.log("タスク追加リクエストボディ:", body);
    } catch (error) {
      console.log("リクエストボディの解析に失敗、デフォルト設定を使用:", error.message);
      // ボディが無い場合はデフォルト設定を使用
    }
    
    try {
      const user = await getUserByDevice(deviceId);
      if (!user) {
        sendJSON(res, 404, { error: "User not found" });
        return;
      }      const taskIds = [];
      const isLowPriority = body && body.priority === 'low';
      const reason = (body && body.reason) || 'normal';
      
      console.log(`タスク追加処理: デバイス=${deviceId}, 優先度=${isLowPriority ? 'low' : 'normal'}, 理由=${reason}`);
      
      // 時間切れによる追加の場合は1個、通常は3個
      const taskCount = reason === 'time_expired' ? 1 : 3;
      
      for (let i = 0; i < taskCount; i++) {
        const taskId = await addTask(deviceId);
        taskIds.push(taskId);
      }
      
      // 低優先度の場合は追加情報をレスポンスに含める
      const response = { 
        success: true, 
        taskIds,
        priority: isLowPriority ? 'low' : 'normal',
        reason 
      };      
      sendJSON(res, 201, response);
    } catch (err) {
      // User not found や No missions available など
      console.error("Error in addTask:", err);
      // 例外メッセージに応じてステータスを変えても良い (ここでは 400 or 404 or 500)
      const msg = err.message || "";
      if (msg.includes("User not found")) {
        sendJSON(res, 404, { error: "User not found" });
      } else if (msg.includes("No missions available")) {
        sendJSON(res, 400, { error: "No missions available" });
      } else {
        sendJSON(res, 500, { error: "Internal server error" });
      }
    }
    return;
  }

  // GET /api/tasks/:deviceId  (ユーザーのタスク一覧取得)
  if (pathname.match(/^\/api\/tasks\/[^\/]+$/) && method === "GET") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    try {
      const user = await getUserByDevice(deviceId);
      if (!user) {
        sendJSON(res, 404, { error: "User not found" });
        return;
      }
      const tasks = await getTasksByUserId(user.id);
      sendJSON(res, 200, { success: true, tasks });
    } catch (err) {
      console.error("Error in getTasksByUserId:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/task/:id (タスク詳細取得)
  if (pathname.match(/^\/api\/task\/\d+$/) && method === "GET") {
    const id = parseInt(pathname.split("/")[2], 10);
    try {
      const task = await getTasksById(id);
      if (task) {
        sendJSON(res, 200, { success: true, task });
      } else {
        sendJSON(res, 404, { error: "Task not found" });
      }
    } catch (err) {
      console.error("Error in getTasksById:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // DELETE /api/task/:id (タスク削除)
  if (pathname.match(/^\/api\/task\/\d+$/) && method === "DELETE") {
    const id = parseInt(pathname.split("/")[2], 10);
    try {
      const ok = await deleteTask(id);
      // deleteTask は true を返す想定
      sendJSON(res, 200, { success: ok });
    } catch (err) {
      console.error("Error in deleteTask:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // PATCH /api/task/:id/done  (完了切替)
  if (pathname.match(/^\/api\/task\/\d+\/done$/) && method === "PATCH") {
    const id = parseInt(pathname.split("/")[3], 10);
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }

    console.log("[PATCH /api/task/:id/done] id=", id, " body=", body);
    if (!body || typeof body.done !== "boolean") {
      sendJSON(res, 400, {
        error: "Invalid request body. require { done: boolean }",
      });
      return;
    }
    try {
      const ok = await setTaskDone(id, body.done);
      sendJSON(res, 200, { success: ok });
    } catch (err) {
      console.error("Error in setTaskDone:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // PATCH /api/task/:id/time (残り時間更新)
  if (pathname.match(/^\/api\/task\/\d+\/time$/) && method === "PATCH") {
    const id = parseInt(pathname.split("/")[2], 10);
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (!body || typeof body.remainingTime !== "number") {
      sendJSON(res, 400, {
        error: "Invalid request body. require { remainingTime: number }",
      });
      return;
    }
    try {
      const ok = await updateTaskTime(id, body.remainingTime);
      sendJSON(res, 200, { success: ok });
    } catch (err) {
      console.error("Error in updateTaskTime:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // --- メッセージ関連 ---
  // POST /api/messages/:deviceId  (メッセージ送信)
  if (pathname.match(/^\/api\/messages\/[^\/]+$/) && method === "POST") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }
    if (
      !body ||
      typeof body.content !== "string" ||
      (body.radius !== undefined && typeof body.radius !== "number")
    ) {
      sendJSON(res, 400, {
        error:
          "Invalid request body. require { content: string, radius?: number }",
      });
      return;
    }
    try {
      // 会議中かどうかをチェック
      const meetingState = await getMeetingState();
      let effectiveRadius = body.radius;
      
      if (meetingState && meetingState.isActive) {
        // 会議中は範囲を無制限に設定
        effectiveRadius = null;
        console.log(`会議中なので無制限に変更: ${deviceId}`);
        const vote_box = document.querySelector(".voteBox");
        if (vote_box) {
          vote_box.classList.remove("voteWrapper");
        }
      }else {
        const vote_box = document.querySelector(".voteBox");
        if (vote_box) {
          vote_box.classList.add("voteWrapper");
        }
      }

      const messageId = await sendMessage(deviceId, body.content, effectiveRadius);
      sendJSON(res, 201, { 
        success: true, 
        messageId,
        isMeetingChat: meetingState && meetingState.isActive,
        effectiveRadius: effectiveRadius
      });
    } catch (err) {
      console.error("Error in sendMessage:", err);
      const msg = err.message || "";
      if (msg.includes("User not found")) {
        sendJSON(res, 404, { error: "User not found" });
      } else {
        sendJSON(res, 500, { error: "Internal server error" });
      }
    }
    return;
  }

  // GET /api/messages/:deviceId  (受信メッセージ取得)
  if (pathname.match(/^\/api\/messages\/[^\/]+$/) && method === "GET") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    try {
      const messages = await getMessagesForDevice(deviceId);
      sendJSON(res, 200, { success: true, messages });
    } catch (err) {
      console.error("Error in getMessagesForDevice:", err);
      const msg = err.message || "";
      if (msg.includes("User not found")) {
        sendJSON(res, 404, { error: "User not found" });
      } else {
        sendJSON(res, 500, { error: "Internal server error" });
      }
    }
    return;
  }

  // POST /api/users/update (geo.jsからの位置・角度情報更新)
  if (pathname === "/api/users/update" && method === "POST") {
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }

    if (!body || !body.deviceId) {
      sendJSON(res, 400, {
        error: "Invalid request body. require { deviceId }",
      });
      return;
    }

    const { deviceId, latitude, longitude, angle } = body;
    // console.log(
    //   `[server.js] /api/users/update 受信: デバイスID=${deviceId}`,
    //   body
    // );

    try {
      if (typeof latitude === "number" && typeof longitude === "number") {
        await updateUserPosition(deviceId, latitude, longitude);
        // console.log(
        //   `[server.js] 位置情報をDBに保存しました: デバイスID=${deviceId}, 緯度=${latitude}, 経度=${longitude}`
        // );
      }
      if (typeof angle === "number") {
        await updateUserAngle(deviceId, angle);
        // console.log(
        //   `[server.js] 角度情報をDBに保存しました: デバイスID=${deviceId}, 角度=${angle}`
        // );
      }
      sendJSON(res, 200, { success: true, message: "User updated" });
    } catch (err) {
      console.error("Error in /api/users/update:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/vote-status/:deviceId (投票状況確認)
  if (pathname.match(/^\/api\/vote-status\/[^\/]+$/) && method === "GET") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    try {
      const voteStatus = await getUserVoteStatus(deviceId);
      sendJSON(res, 200, voteStatus);
    } catch (error) {
      console.error("Error getting vote status:", error);
      if (error.message === "User not found") {
        sendJSON(res, 404, { error: "User not found" });
      } else {
        sendJSON(res, 500, { error: "Internal server error" });
      }
    }
    return;
  }

  // GET /api/vote-counts (投票結果取得)
  if (pathname === "/api/vote-counts" && method === "GET") {
    try {
      const counts = await getVoteCounts();
      sendJSON(res, 200, { success: true, counts });
    } catch (error) {
      console.error("Error getting vote counts:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // POST /api/report (通報機能)
  if (pathname === "/api/report" && method === "POST") {
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }

    const { deviceId, reportedUserId } = body;
    if (!deviceId) {
      sendJSON(res, 400, { error: "deviceId is required" });
      return;
    }

    try {
      await addReport(deviceId, reportedUserId);

      // WebSocketで全員に通報通知
      const payload = JSON.stringify({
        type: "reportNotification",
        message: "通報がありました。会議を開始します。",
      });

      for (const [ws] of clients.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }

      sendJSON(res, 200, { success: true, message: "Report submitted" });
    } catch (error) {
      console.error("Error in report:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/reports (通報履歴取得)
  if (pathname === "/api/reports" && method === "GET") {
    try {
      const reports = await getReports();
      sendJSON(res, 200, { success: true, reports });
    } catch (error) {
      console.error("Error getting reports:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // POST /api/meeting/start (会議開始)
  if (pathname === "/api/meeting/start" && method === "POST") {
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      body = {};
    }

    const { durationMinutes = 1, trigger = "manual" } = body;    try {
      await setMeetingState(true, durationMinutes, trigger);

      // 死体情報を取得（キルログ用）
      const bodies = await getAllBodies();
      const killLogs = bodies.map(body => ({
        victimName: body.victimName,
        killerName: body.killerName || '不明',
        deathTime: body.deathTime
      }));

      // WebSocketで会議開始通知
      const payload = JSON.stringify({
        type: "meetingStarted",
        duration: durationMinutes * 60,
        trigger,
        killLogs: killLogs // キルログを含める
      });

      for (const [ws] of clients.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }

      // 会議タイマー設定（既存タイマーがあればクリア）
      if (meetingTimeout) clearTimeout(meetingTimeout);
      meetingTimeout = setTimeout(async () => {
        await endMeeting();
        meetingTimeout = null;
      }, durationMinutes * 60 * 1000);

      sendJSON(res, 200, { success: true, message: "Meeting started" });
    } catch (error) {
      console.error("Error starting meeting:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // POST /api/meeting/end (会議終了)
  if (pathname === "/api/meeting/end" && method === "POST") {
    try {
      // 手動終了時はタイマーをクリア
      if (meetingTimeout) {
        clearTimeout(meetingTimeout);
        meetingTimeout = null;
      }
      const result = await endMeeting();
      sendJSON(res, 200, { success: true, result });
    } catch (error) {
      console.error("Error ending meeting:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/meeting/status (会議状態取得)
  if (pathname === "/api/meeting/status" && method === "GET") {
    try {
      const meetingState = await getMeetingState();
      sendJSON(res, 200, { success: true, meeting: meetingState });
    } catch (error) {
      console.error("Error getting meeting status:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // POST /api/kill (殺害機能)
  if (pathname === "/api/kill" && method === "POST") {
    let body;
    try {
      body = await parseRequestBody(req);
    } catch {
      sendJSON(res, 400, { error: "Invalid JSON" });
      return;
    }

    const { killerDeviceId, victimDeviceId } = body;
    if (!killerDeviceId || !victimDeviceId) {
      sendJSON(res, 400, {
        error: "killerDeviceId and victimDeviceId are required",
      });
      return;
    }

    try {
      // 殺害者が人狼かチェック
      const killer = await getUserByDevice(killerDeviceId);
      if (!killer || killer.type !== "marder") {
        sendJSON(res, 403, { error: "Only marders can kill" });
        return;
      }      // 被害者を殺害
      const ok = await updateUserAliveStatus(victimDeviceId, false);
      if (!ok) {
        sendJSON(res, 404, { error: "Victim not found" });
        return;
      }

      // 死体をデータベースに登録
      try {
        await addBody(victimDeviceId, killerDeviceId);
        console.log(`死体登録完了: 被害者=${victimDeviceId}, 殺害者=${killerDeviceId}`);
      } catch (bodyError) {
        console.error("死体登録エラー:", bodyError);
        // 死体登録エラーでも殺害処理は継続
      }

      // WebSocketで被害者に死亡通知
      for (const [ws, id] of clients.entries()) {
        if (id === victimDeviceId && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "killed",
              message: "あなたは殺されました",
            })
          );
        }
      }

      sendJSON(res, 200, { success: true, message: "Kill successful" });
    } catch (error) {
      console.error("Error in kill:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/game/status (ゲーム状態取得)
  if (pathname === "/api/game/status" && method === "GET") {
    try {
      const [users, meetingState, voteCounts] = await Promise.all([
        getAllUsers(),
        getMeetingState(),
        getVoteCounts(),
      ]);

      const aliveUsers = users.filter((u) => u.is_alive);
      const villagers = aliveUsers.filter((u) => u.type === "villager");
      const marders = aliveUsers.filter((u) => u.type === "marder");

      const gameStatus = {
        totalUsers: users.length,
        aliveUsers: aliveUsers.length,
        villagers: villagers.length,
        marders: marders.length,
        meeting: meetingState,
        votes: voteCounts,
        gamePhase: meetingState?.isActive ? "meeting" : "playing",
      };

      sendJSON(res, 200, { success: true, gameStatus });
    } catch (error) {
      console.error("Error getting game status:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/users/nearby - 近くのユーザーを取得
  if (pathname === "/api/users/nearby" && method === "GET") {
    try {
      const query = new URLSearchParams(req.url.split('?')[1] || '');
      const lng = parseFloat(query.get('lng'));
      const lat = parseFloat(query.get('lat'));
      
      if (isNaN(lng) || isNaN(lat)) {
        sendJSON(res, 400, { error: 'Invalid coordinates' });
        return;
      }
      
      const users = await getAllUsers();
      const nearbyUsers = users.filter(user => {
        if (!user.position) return false;
        
        let userPos;
        try {
          userPos = typeof user.position === 'string' ? JSON.parse(user.position) : user.position;
        } catch (e) {
          return false;
        }
        
        // 距離計算（簡易版、約100m以内）
        const distance = Math.hypot(userPos.lat - lat, userPos.lng - lng);
        return distance < 0.001; // 約100m
      });
      
      sendJSON(res, 200, nearbyUsers);
    } catch (err) {
      console.error("Error in /api/users/nearby:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/user/:deviceId/status (ユーザーの死亡状況チェック)
  if (pathname.match(/^\/api\/user\/[^\/]+\/status$/) && method === "GET") {
    const deviceId = decodeURIComponent(pathname.split("/")[3]);
    try {
      const user = await getUserByDevice(deviceId);
      if (user) {
        sendJSON(res, 200, { 
          success: true, 
          user: {
            device_id: user.device_id,
            name: user.name,
            is_alive: user.is_alive
          }
        });
      } else {
        sendJSON(res, 404, { error: "User not found" });
      }    } catch (err) {
      console.error("Error in user status check:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/game/progress (ゲーム進捗情報取得)
  if (pathname === "/api/game/progress" && method === "GET") {
    try {
      const gameResult = await checkGameEndConditions();
      
      if (gameResult.ended) {
        sendJSON(res, 200, {
          success: true,
          gameEnded: true,
          winner: gameResult.winner,
          reason: gameResult.reason
        });
      } else {
        sendJSON(res, 200, {
          success: true,
          gameEnded: false,
          progress: gameResult.progress
        });
      }
    } catch (err) {
      console.error("Error in game progress:", err);
      sendJSON(res, 500, { error: "Internal server error" });
    }    return;
  }

  // POST /api/meeting/auto/start (自動会議開始)
  if (pathname === "/api/meeting/auto/start" && method === "POST") {
    try {
      if (autoMeetingInterval) {
        sendJSON(res, 400, { error: "Auto meeting is already active" });
        return;
      }
      
      startAutoMeeting();
      sendJSON(res, 200, { success: true, message: "Auto meeting started" });
    } catch (error) {
      console.error("Error starting auto meeting:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // POST /api/meeting/auto/stop (自動会議停止)
  if (pathname === "/api/meeting/auto/stop" && method === "POST") {
    try {
      stopAutoMeeting();
      sendJSON(res, 200, { success: true, message: "Auto meeting stopped" });
    } catch (error) {
      console.error("Error stopping auto meeting:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;
  }

  // GET /api/meeting/auto/status (自動会議状態取得)
  if (pathname === "/api/meeting/auto/status" && method === "GET") {
    try {
      const isActive = autoMeetingInterval !== null;
      sendJSON(res, 200, { 
        success: true, 
        autoMeeting: {
          isActive,
          intervalMinutes: 10
        }  
      });
    } catch (error) {
      console.error("Error getting auto meeting status:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }    return;
  }

  // GET /api/chat/debug (チャット機能デバッグ情報)
  if (pathname === "/api/chat/debug" && method === "GET") {
    try {
      const users = await getAllUsers();
      const meetingState = await getMeetingState();
      const connectedClients = Array.from(clients.values());
      
      sendJSON(res, 200, {
        success: true,
        debug: {
          totalUsers: users.length,
          connectedClients: connectedClients.length,
          clientList: connectedClients,
          meetingActive: meetingState?.isActive || false,
          users: users.map(u => ({
            deviceId: u.device_id,
            name: u.name,
            position: u.position,
            isAlive: u.is_alive
          }))
        }
      });
    } catch (error) {
      console.error("Error getting chat debug info:", error);
      sendJSON(res, 500, { error: "Internal server error" });
    }
    return;  }

  // 未対応エンドポイント
  sendJSON(res, 404, { error: "Not Found" });
});

// 新しい勝利判定（タスクベース）
async function checkGameEndConditions() {
  try {
    const users = await getAllUsers();
    const taskStats = await getTaskStats();
    
    // 村人の生存状況をチェック
    const villagers = users.filter(u => u.type === 'villager');
    const aliveVillagers = villagers.filter(u => u.is_alive);
    const marders = users.filter(u => u.type === 'marder');
    const aliveMarders = marders.filter(u => u.is_alive);
    
    // 勝利条件1: 全ての村人が死んだら人狼の勝利
    if (aliveVillagers.length <= aliveMarders.length) {
      return {
        ended: true,
        winner: 'marders',
        reason: '全ての村人が死亡しました'
      };
    }
    
    // 勝利条件2: 村人のタスクの数 * (5/4) 程度が達成されていたら村人側の勝利
    const requiredTasks = Math.ceil(taskStats.villagerTasks * 0.75); // 5/4 = 1.25
    const tasksRemaining = requiredTasks - taskStats.completedVillagerTasks;
    
    console.log(`タスク進捗: ${taskStats.completedVillagerTasks}/${requiredTasks} (村人タスク総数: ${taskStats.villagerTasks})`);
    
    if (taskStats.completedVillagerTasks >= requiredTasks) {
      return {
        ended: true,
        winner: 'villagers',
        reason: `必要なタスクを達成しました (${taskStats.completedVillagerTasks}/${requiredTasks})`
      };
    }
    
    // ゲーム継続中の場合、進捗情報を返す
    return {
      ended: false,
      progress: {
        completedTasks: taskStats.completedVillagerTasks,
        requiredTasks: requiredTasks,
        tasksRemaining: tasksRemaining,
        villagerTasks: taskStats.villagerTasks,
        aliveVillagers: aliveVillagers.length,
        totalVillagers: villagers.length
      }
    };
    
  } catch (error) {
    console.error("Error in checkGameEndConditions:", error);
    return { ended: false };
  }
}

// 新しい勝利判定（タスクベース）
async function checkGameEndConditions() {
  try {
    const users = await getAllUsers();
    const taskStats = await getTaskStats();
    
    // 村人の生存状況をチェック
    const villagers = users.filter(u => u.type === 'villager');
    const aliveVillagers = villagers.filter(u => u.is_alive);
    const marders = users.filter(u => u.type === 'marder');
    const aliveMarders = marders.filter(u => u.is_alive);
    
    // 勝利条件1: 全ての村人が死んだら人狼の勝利
    if (aliveVillagers.length === 0) {
      return {
        ended: true,
        winner: 'marders',
        reason: '全ての村人が死亡しました'
      };
    }
    
    // 勝利条件2: 村人のタスクの数 * (5/4) 程度が達成されていたら村人側の勝利
    const requiredTasks = Math.ceil(taskStats.villagerTasks * 0.75); // 5/4 = 1.25
    const tasksRemaining = requiredTasks - taskStats.completedVillagerTasks;
    
    console.log(`タスク進捗: ${taskStats.completedVillagerTasks}/${requiredTasks} (村人タスク総数: ${taskStats.villagerTasks})`);
    
    if (taskStats.completedVillagerTasks >= requiredTasks) {
      return {
        ended: true,
        winner: 'villagers',
        reason: `必要なタスクを達成しました (${taskStats.completedVillagerTasks}/${requiredTasks})`
      };
    }
      // ゲーム継続中の場合、進捗情報を返す
    return {
      ended: false,
      progress: {
        completedTasks: taskStats.completedVillagerTasks,
        requiredTasks: requiredTasks,
        tasksRemaining: tasksRemaining,
        villagerTasks: taskStats.villagerTasks,
        aliveVillagers: aliveVillagers.length,
        totalVillagers: villagers.length,
        aliveWerewolves: aliveMarders.length
      }
    };
    
  } catch (error) {
    console.error("Error in checkGameEndConditions:", error);
    return { ended: false };
  }
}

const wss = new WebSocket.Server({ server });
const clients = new Map();
// ミーティング終了用のタイマーID
let meetingTimeout = null;

// WebSocketのハートビート（タイムアウト防止）
const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
      console.log("WebSocket connection timed out. Terminating.");
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(() => {}); // empty callback
  });
}, 30000); // 30秒ごとにping

wss.on("connection", async (ws, req) => {
  console.log("New WebSocket connection established from:", req.socket.remoteAddress);
  ws.isAlive = true; // 生存フラグを初期化

  ws.on('pong', () => {
    ws.isAlive = true; // pongが返ってきたら生存フラグを立てる
    console.log("Received pong from client");
  });

  try {
    // getGlobalMessagesはdatabase.jsに存在しないため、一旦コメントアウトします。
    // const history = await getGlobalMessages();
    // ws.send(
    //   JSON.stringify({
    //     type: "global_history",
    //     messages: history.map((msg) => ({
    //       id: msg.id,
    //       senderId: msg.sender_id,
    //       senderName: msg.sender_name,
    //       content: msg.content,
    //       timestamp: msg.timestamp,
    //     })),
    //   })
    // );
  } catch (err) {
    console.error("Error fetching global messages:", err);
  }

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return ws.send(JSON.stringify({ error: "Invalid JSON format" }));
    }    // Register client on init message
    if (msg.type === "init" && typeof msg.deviceId === "string") {
      clients.set(ws, msg.deviceId);
      console.log(`WebSocket client registered: ${msg.deviceId}, Total clients: ${clients.size}`);
      return;    }    if (msg.type === "chat") {
      try {
        // 会議中かどうかをチェック
        const meetingState = await getMeetingState();
        let effectiveRadius = msg.radius;
        
        if (meetingState && meetingState.isActive) {
          // 会議中は範囲を無制限に設定
          effectiveRadius = null;
          console.log(`会議中のため、チャット範囲を無制限に変更しました`);
        }
        
        const messageId = await sendMessage(
          msg.deviceId,
          msg.content,
          effectiveRadius
        );

        // メッセージを受信したユーザーを取得
        const allUsers = await getAllUsers();
        const messageRecipients = new Set();
        
        for (const user of allUsers) {
          const messages = await getMessagesForDevice(user.device_id);
          const receivedMessage = messages.find(m => m.id === messageId);
          if (receivedMessage) {
            messageRecipients.add(user.device_id);
          }
        }

        console.log(`メッセージを受信するユーザー: ${Array.from(messageRecipients).join(', ')}`);

        // 送信者のメッセージ詳細を取得
        const senderMessages = await getMessagesForDevice(msg.deviceId);
        const latest = senderMessages.find((m) => m.id === messageId);

        if (latest) {
          const payload = JSON.stringify({
            type: "chat",
            id: latest.id,
            senderId: latest.sender_id,
            senderName: latest.sender_name,
            content: latest.content,
            timestamp: latest.timestamp,
            isMeetingChat: meetingState && meetingState.isActive, // 会議中フラグ追加
          });

          // メッセージを受信する権限のあるクライアントのみに送信
          for (const [ws, deviceId] of clients.entries()) {
            if (ws.readyState === WebSocket.OPEN && messageRecipients.has(deviceId)) {
              ws.send(payload);
            }
          }
        }
      } catch (err) {
        console.error("Error in WebSocket message handling:", err);
        ws.send(JSON.stringify({ error: "Internal server error" }));
      }
    }else if (msg.type === "vote") {
      try {
        const result = await addVote(msg.deviceId, msg.targetId);
        const counts = await getVoteCounts();

        const payload = JSON.stringify({
          type: "vote_update",
          counts,
        });

        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        }

        // 投票者に成功メッセージを送信
        if (result.action === "updated") {
          ws.send(
            JSON.stringify({
              type: "vote_success",
              message: "投票先を変更しました",
              action: "updated",
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "vote_success",
              message: "投票が完了しました",
              action: "created",
            })
          );
        }
      } catch (error) {
        console.error("Error in WebSocket vote handling:", error);
        // エラータイプに応じて適切なメッセージを送信
        if (error.message === "Already voted for this user") {
          ws.send(
            JSON.stringify({
              type: "vote_error",
              error: "already_voted",
              message: "既にこのユーザーに投票済みです",
            })
          );
        } else if (error.message === "User not found") {
          ws.send(
            JSON.stringify({
              type: "vote_error",
              error: "user_not_found",
              message: "ユーザーが見つかりません",
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "vote_error",
              error: "server_error",
              message: "投票に失敗しました",
            })
          );
        }
      }
    } else if (msg.type === "report") {
      try {
        await addReport(msg.deviceId, msg.reportedUserId);

        const payload = JSON.stringify({
          type: "reportNotification",
          message: "通報がありました。会議を開始します。",
        });

        for (const [ws] of clients.entries()) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
          }
        }

        ws.send(JSON.stringify({
          type: "report_success",
          message: "通報しました。",
        }));
      } catch (error) {
        console.error("Error in WebSocket report handling:", error);
        ws.send(JSON.stringify({ 
          type: "report_error",
          message: "通報に失敗しました",
        }));      }
    } else if(msg.type === "kill") {
      console.log("WebSocket殺害処理開始:", msg);
      try {        // 殺害者の検証
        const killer = await getUserByDevice(msg.deviceId);
        if(!killer) {
          console.log("殺害者が見つかりません:", msg.deviceId);
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "ユーザーが見つかりません",
          }));
          return;
        }
        console.log("殺害者情報:", { deviceId: killer.device_id, name: killer.name, type: killer.type });
        
        if(killer.type !== "marder") {
          console.log("人狼以外の殺害試行:", killer.type);
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "人狼のみが殺害できます",
          }));
          return;
        }

        // 対象ユーザーの検証
        const target = await getUserByDevice(msg.targetDeviceId);
        if(!target) {
          console.log("殺害対象が見つかりません:", msg.targetDeviceId);
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "対象ユーザーが見つかりません",
          }));
          return;
        }
        console.log("殺害対象情報:", { deviceId: target.device_id, name: target.name, type: target.type });

        // 自分自身を殺害しようとしていないかチェック
        console.log("デバイスID比較:", { killerDeviceId: killer.device_id, targetDeviceId: target.device_id, equal: killer.device_id === target.device_id });
        if(killer.device_id === target.device_id) {
          console.log("自分自身への殺害試行:", killer.name);
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "自分自身を殺害することはできません",
          }));
          return;
        }

        // 人狼同士の殺害を防止
        if(target.type === "marder") {
          console.log("人狼同士の殺害試行:", killer.name, "->", target.name);
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "人狼同士は殺害できません",
          }));
          return;
        }

        // 村人のみが殺害対象
        if(target.type !== "villager") {
          console.log("村人以外への殺害試行:", killer.name, "->", target.name, "(", target.type, ")");
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "村人のみが殺害対象です",
          }));
          return;
        }

        if(!target.is_alive) {
          console.log("既に死亡しているユーザーへの殺害試行:", target.name);
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "対象ユーザーは既に死亡しています",
          }));
          return;
        }        // 殺害実行
        const ok = await updateUserAliveStatus(msg.targetDeviceId, false);
        if(!ok) {
          console.log("殺害処理が失敗しました");
          ws.send(JSON.stringify({
            type: "kill_error",
            message: "殺害処理に失敗しました",
          }));
          return;
        }

        console.log(`殺害成功: ${killer.name} が ${target.name} を殺害しました`);

        // 死体をデータベースに登録
        try {
          await addBody(msg.targetDeviceId, msg.deviceId);
          console.log(`死体登録完了(WebSocket): 被害者=${msg.targetDeviceId}, 殺害者=${msg.deviceId}`);
        } catch (bodyError) {
          console.error("死体登録エラー(WebSocket):", bodyError);
          // 死体登録エラーでも殺害処理は継続
        }

        // 被害者に死亡通知
        for(const [victimWs, id] of clients.entries()) {
          if(id === msg.targetDeviceId && victimWs.readyState === WebSocket.OPEN) {
            victimWs.send(JSON.stringify({
              type: "killed",
              message: "あなたは殺されました",
            }));
            console.log("被害者に死亡通知を送信しました");
            break;
          }
        }

        // 殺害者に成功通知
        ws.send(JSON.stringify({
          type: "kill_success",
          message: `${target.name}を殺害しました`,
        }));

        // 全クライアントに殺害発生を通知（オプション）
        const killNotification = JSON.stringify({
          type: "kill_notification",
          message: "殺害が発生しました",
          victimName: target.name
        });
        
        for(const [clientWs] of clients.entries()) {
          if(clientWs.readyState === WebSocket.OPEN && clientWs !== ws) {
            clientWs.send(killNotification);
          }
        }
        
      } catch (error) {
        console.error("Error in WebSocket kill handling:", error);
        ws.send(JSON.stringify({
          type: "kill_error",          message: "殺害処理中にエラーが発生しました",
        }));
      }
    }
  });
  ws.on("close", () => {
    const deviceId = clients.get(ws);
    clients.delete(ws);
    console.log(`WebSocket connection closed. Device: ${deviceId}, Remaining clients: ${clients.size}`);
  });

  ws.on("error", (error) => {
    console.log("WebSocket error:", error);
  });
});

// サーバー終了時にハートビートのインターバルをクリア
wss.on('close', function close() {
  clearInterval(interval);
});

// 会議終了処理
async function endMeeting() {
  try {
    console.log("会議終了処理を開始します");
    
    const voteCounts = await getVoteCounts();
    console.log("投票結果を取得しました:", voteCounts);
    
    let executedUser = null;
    
    if (voteCounts.length > 0) {
      // 最多得票者を処刑
      const maxVotes = Math.max(...voteCounts.map(v => v.count));
      const candidates = voteCounts.filter(v => v.count === maxVotes);
      const targetUser = candidates.length === 1
        ? candidates[0]
        : candidates[Math.floor(Math.random() * candidates.length)];
      console.log("処刑対象:", targetUser);
      
      // 全ユーザーからIDで一致するユーザーを探して device_id を取得
      const allUsers = await getAllUsers();
      const user = allUsers.find(u => u.id === targetUser.userId);
      if (user) {
        await updateUserAliveStatus(user.device_id, false);
        executedUser = {
          name: targetUser.name,
          deviceId: user.device_id
        };
      }
     }
     
     // 投票をリセット
     console.log("投票をリセットしています...");
     await resetVotes();
     
     // 会議状態をリセット
     console.log("会議状態をリセットしています...");
     await setMeetingState(false);
     
     // ゲーム終了判定（新しいタスクベースシステム）
     console.log("ゲーム終了判定を実行しています...");
     const gameResult = await checkGameEndConditions();
     console.log("ゲーム終了判定結果:", gameResult);
     
     let gameEnded = null;
     
     if (gameResult.ended) {
       gameEnded = {
         ended: true,
         winner: gameResult.winner,
         reason: gameResult.reason
       };
     }
     
     // WebSocket通知
     console.log("WebSocket通知を送信しています...");
     const payload = JSON.stringify({
       type: "meetingEnded",
       executed: executedUser,
       gameEnded
     });
     
     for (const [ws] of clients.entries()) {
       if (ws.readyState === WebSocket.OPEN) {
         ws.send(payload);
       }
     }
     
     console.log("会議終了処理が完了しました");
     return { executed: executedUser, gameEnded };
  } catch (error) {
    console.error("Error in endMeeting:", error);
    console.error("Error stack:", error.stack);
    throw error;
  }
}

// サーバ起動
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log("WebSocket server is ready for connections");

  // 実際のIPアドレスを取得して表示
  const networkInterfaces = os.networkInterfaces();
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`Network access: http://${net.address}:${PORT}`);
      }
    }
  }
});

// 10分間隔で自動会議を開始する機能
let autoMeetingInterval = null;

// 自動会議機能を開始
function startAutoMeeting() {
  console.log("自動会議機能を開始します（10分間隔）");
  
  autoMeetingInterval = setInterval(async () => {
    try {
      // 現在会議中でないかチェック
      const currentMeetingState = await getMeetingState();
      if (currentMeetingState && currentMeetingState.isActive) {
        console.log("既に会議中のため、自動会議をスキップします");
        return;
      }

      // 生存プレイヤーが2人以上いるかチェック
      const users = await getAllUsers();
      const aliveUsers = users.filter(u => u.is_alive);
      
      if (aliveUsers.length < 2) {
        console.log("生存プレイヤーが少ないため、自動会議をスキップします");
        return;
      }      console.log("定期会議を開始します");

      // 会議状態を設定（1分間）
      await setMeetingState(true, 1, 'auto');

      // 死体情報を取得（キルログ用）
      const bodies = await getAllBodies();
      const killLogs = bodies.map(body => ({
        victimName: body.victimName,
        killerName: body.killerName || '不明',
        deathTime: body.deathTime
      }));

      // WebSocketで会議開始通知
      const payload = JSON.stringify({
        type: "meetingStarted",
        duration: 1 * 60, // 1分
        trigger: "auto",
        message: "定期会議が開始されました",
        killLogs: killLogs // キルログを含める
      });

      for (const [ws] of clients.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }

      // 5分後に会議を自動終了
      setTimeout(async () => {
        try {
          await endMeeting();
          console.log("定期会議が終了しました");
        } catch (error) {
          console.error("定期会議の終了中にエラーが発生しました:", error);
        }
      }, 1 * 60 * 1000); // 1分

    } catch (error) {
      console.error("自動会議の開始中にエラーが発生しました:", error);
    }
  }, 10 * 60 * 1000); // 10分間隔
}

// 自動会議機能を停止
function stopAutoMeeting() {
  if (autoMeetingInterval) {
    clearInterval(autoMeetingInterval);
    autoMeetingInterval = null;
    console.log("自動会議機能を停止しました");
  }
}

// サーバー起動後に自動会議を開始
setTimeout(async () => {
  // 30秒後に即座に最初の会議を開始
  try {
    const users = await getAllUsers();
    const aliveUsers = users.filter(u => u.is_alive);
    
    if (aliveUsers.length >= 2) {      console.log("サーバー起動30秒後の初回会議を開始します");
      // 会議状態を設定（1分間）
      await setMeetingState(true, 1, 'startup');

      // 死体情報を取得（キルログ用）
      const bodies = await getAllBodies();
      const killLogs = bodies.map(body => ({
        victimName: body.victimName,
        killerName: body.killerName || '不明',
        deathTime: body.deathTime
      }));

      // WebSocketで会議開始通知
      const payload = JSON.stringify({
        type: "meetingStarted",
        duration: 1 * 60, // 1分
        trigger: "startup",
        message: "初回会議が開始されました",
        killLogs: killLogs // キルログを含める
      });

      for (const [ws] of clients.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }

      // 5分後に会議を自動終了
      setTimeout(async () => {
        try {
          await endMeeting();
          console.log("初回会議が終了しました");
        } catch (error) {
          console.error("初回会議の終了中にエラーが発生しました:", error);
        }
      }, 1 * 60 * 1000); // 1分
    } else {
      console.log("生存プレイヤーが少ないため、初回会議をスキップします");
    }
  } catch (error) {
    console.error("初回会議の開始中にエラーが発生しました:", error);
  }
  
  // その後、通常の10分間隔での自動会議を開始
  startAutoMeeting();
}, 30000); // サーバー起動30秒後に初回会議を開始し、自動会議機能も開始

// 終了時に DB をクローズ
process.on("SIGINT", () => {
  console.log("Shutting down server...");
  stopAutoMeeting(); // 自動会議タイマーを停止
  closeDatabase();
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down server...");
  stopAutoMeeting(); // 自動会議タイマーを停止
  closeDatabase();
  process.exit(0);
});
