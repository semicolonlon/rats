const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const qr = require("qrcode");

// Load and validate missions
const missionsConfigPath = path.resolve(__dirname, "./missions.json");
let missionsConfig = { missions: [] };
try {
  const data = fs.readFileSync(missionsConfigPath, "utf8");
  const parsed = JSON.parse(data);
  if (Array.isArray(parsed.missions)) {
    missionsConfig.missions = parsed.missions
      .filter(
        (m) =>
          typeof m.id === "number" && m.missionName && m.placeName && m.position
      )
      .map((m) => ({
        id: m.id,
        missionName: m.missionName.trim(),
        placeName: m.placeName.trim(),
        position: { lat: m.position.lat, lng: m.position.lng },
      }));

    missionsConfig.missions.forEach((mission) => {
      qr.toFile(
        path.resolve(__dirname, "..", "qr_codes", `${mission.id}.png`),
        `${mission.id}`,
        { errorCorrectionLevel: "H", version: 4 }
      )
        .then(() => {
          console.log(`QR code generated for mission ${mission.id}`);
        })
        .catch((err) => {
          console.error(
            `Failed to generate QR code for mission ${mission.id}:`,
            err
          );
        });
    });
  }
} catch {
  // Invalid or missing missions.json
}

// Return missions
function getMissionsList() {
  return missionsConfig.missions;
}

// SQLite setup
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "./game.db");
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (!err) db.run("PRAGMA foreign_keys = ON");
});

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      position TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('marder','villager')),
      is_alive INTEGER NOT NULL DEFAULT 1,
      color TEXT NOT NULL DEFAULT '#000000',
      angle REAL NOT NULL DEFAULT 180
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mission_id INTEGER,
      position TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      content TEXT,
      place TEXT,
      deadline TEXT NOT NULL DEFAULT (datetime('now', '+1.5 hour')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_mission
     ON tasks(user_id, mission_id)`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      position TEXT NOT NULL,
      timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS message_recipients (
      message_id INTEGER,
      recipient_id INTEGER,
      PRIMARY KEY(message_id, recipient_id),
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS votes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_id     INTEGER NOT NULL,           -- 投票したユーザー
  target_id    INTEGER NOT NULL,           -- 投票先のユーザー
  timestamp    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(voter_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(target_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(voter_id)             -- 同一人物への重複投票を防止（要件に応じて外してもOK）
)`
  );
  
  db.run(
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      reported_user_id INTEGER,
      timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );
  // 死体管理テーブル（シンプル版）
  db.run(
    `CREATE TABLE IF NOT EXISTS bodies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      victim_id INTEGER NOT NULL,
      victim_name TEXT NOT NULL,
      killer_id INTEGER,
      killer_name TEXT,
      death_position TEXT NOT NULL,
      death_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(victim_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(killer_id) REFERENCES users(id) ON DELETE SET NULL
    )`
  );

  // 会議状態テーブル（既存のものを拡張）
  db.run(
    `CREATE TABLE IF NOT EXISTS game_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_meeting_active INTEGER NOT NULL DEFAULT 0,
      meeting_start_time DATETIME,
      meeting_duration INTEGER DEFAULT 300,
      meeting_trigger TEXT,  -- 'report' または 'manual'
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );

  db.run(`INSERT OR IGNORE INTO game_state (id, is_meeting_active) VALUES (1, 0)`);
});

// 通報機能
async function addReport(deviceId, reportedUserId = null) {
  const user = await getUserByDevice(deviceId);
  if (!user) throw new Error("User not found");

  let reportedUser = null;
  if (reportedUserId) {
    reportedUser = await getUserByDevice(reportedUserId);
    if (!reportedUser) throw new Error("Reported user not found");
  }

  await runAsync(
    "INSERT INTO reports (reporter_id, reported_user_id) VALUES (?, ?)",
    [user.id, reportedUser ? reportedUser.id : null]
  );

  // 通報後、自動的に会議を開始
  await setMeetingState(true, 5, 'report');
  return true;
}

// 通報履歴を取得
async function getReports() {
  const rows = await allAsync(
    `SELECT 
      r.id,
      r.timestamp,
      reporter.name as reporter_name,
      reported.name as reported_name,
      reported.device_id as reported_device_id
     FROM reports r
     JOIN users reporter ON r.reporter_id = reporter.id
     LEFT JOIN users reported ON r.reported_user_id = reported.id
     ORDER BY r.timestamp DESC`
  );
  
  return rows.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    reporter: row.reporter_name,
    reportedUser: row.reported_name,
    reportedDeviceId: row.reported_device_id
  }));
}

// 会議状態管理
async function setMeetingState(isActive, durationMinutes = 5, trigger = 'manual') {
  const durationSeconds = durationMinutes * 60;
  
  if (isActive) {
    await runAsync(
      `UPDATE game_state SET 
        is_meeting_active = 1, 
        meeting_start_time = CURRENT_TIMESTAMP,
        meeting_duration = ?,
        meeting_trigger = ?,
        updated_at = CURRENT_TIMESTAMP 
       WHERE id = 1`,
      [durationSeconds, trigger]
    );
  } else {
    await runAsync(
      `UPDATE game_state SET 
        is_meeting_active = 0,
        meeting_start_time = NULL,
        meeting_trigger = NULL,
        updated_at = CURRENT_TIMESTAMP 
       WHERE id = 1`
    );
  }
}

async function getMeetingState() {
  const row = await getAsync("SELECT * FROM game_state WHERE id = 1");
  if (!row) return null;
  
  return {
    isActive: Boolean(row.is_meeting_active),
    startTime: row.meeting_start_time,
    duration: row.meeting_duration,
    trigger: row.meeting_trigger
  };
}

// 投票関連

//投票を記録
async function addVote(voterDeviceId, targetDeviceId) {
  const voter = await getUserByDevice(voterDeviceId);
  const target = await getUserByDevice(targetDeviceId);
  if (!voter || !target) throw new Error("User not found");

  // 既存の投票をチェック
  const existingVote = await getAsync(
    "SELECT * FROM votes WHERE voter_id = ?",
    [voter.id]
  );

  if (existingVote) {
    // 同じ対象への投票の場合はエラー
    if (existingVote.target_id === target.id) {
      throw new Error("Already voted for this user");
    }
    
    // 異なる対象の場合は投票先を更新
    await runAsync(
      "UPDATE votes SET target_id = ?, timestamp = CURRENT_TIMESTAMP WHERE voter_id = ?",
      [target.id, voter.id]
    );
    return { action: "updated", previousTargetId: existingVote.target_id };
  } else {
    // 新規投票
    await runAsync("INSERT INTO votes (voter_id, target_id) VALUES (?, ?)", [
      voter.id,
      target.id,
    ]);
    return { action: "created" };
  }
}

async function getUserVoteStatus(deviceId) {
  const user = await getUserByDevice(deviceId);
  if (!user) throw new Error("User not found");
  
  const vote = await getAsync(
    "SELECT u.name as target_name, u.device_id as target_device_id FROM votes v JOIN users u ON v.target_id = u.id WHERE v.voter_id = ?",
    [user.id]
  );
  
  return vote ? { 
    hasVoted: true, 
    targetName: vote.target_name,
    targetDeviceId: vote.target_device_id 
  } : { hasVoted: false };
}

// 投票数集計
async function getVoteCounts() {
  const rows = await allAsync(
    `SELECT u.id AS userId, u.name, COUNT(v.id) AS count
     FROM votes v
     JOIN users u ON u.id = v.target_id
     GROUP BY v.target_id
     ORDER BY count DESC`
  );
  return rows;
}

// タスクの統計を取得（勝利判定用）
async function getTaskStats() {
  const totalTasks = await getAsync(
    "SELECT COUNT(*) as count FROM tasks"
  );
  
  const completedTasks = await getAsync(
    "SELECT COUNT(*) as count FROM tasks WHERE is_done = 1"
  );
  
  const villagerTasks = await getAsync(
    `SELECT COUNT(*) as count FROM tasks 
     JOIN users ON tasks.user_id = users.id 
     WHERE users.type = 'villager'`
  );
  
  const completedVillagerTasks = await getAsync(
    `SELECT COUNT(*) as count FROM tasks 
     JOIN users ON tasks.user_id = users.id 
     WHERE users.type = 'villager' AND tasks.is_done = 1`
  );

  return {
    totalTasks: totalTasks.count,
    completedTasks: completedTasks.count,
    villagerTasks: villagerTasks.count,
    completedVillagerTasks: completedVillagerTasks.count
  };
}

// Async helpers
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      return err ? reject(err) : resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      return err ? reject(err) : resolve(rows);
    });
  });
}

async function updateUserType(deviceId, type) {
  const user = await getUserByDevice(deviceId);
  if (!user) return false;
  await runAsync("UPDATE users SET type = ? WHERE id = ?", [type, user.id]);
  return true;
}

// Calculate nearby users within radius (m)
async function getNearbyUserIds(lat, lng, radius = 20) {
  const users = await allAsync("SELECT id, position FROM users");
  const toRad = (deg) => (deg * Math.PI) / 180;
  return users.reduce((ids, { id, position }) => {
    try {
      const { lat: uLat, lng: uLng } = JSON.parse(position);
      const dLat = (uLat - lat) * 111320;
      const dLng = (uLng - lng) * ((40075000 * Math.cos(toRad(lat))) / 360);
      if (Math.hypot(dLat, dLng) <= radius) ids.push(id);
    } catch {
      // ignore parse errors
    }
    return ids;
  }, []);
}

// Get detailed information of nearby users
async function getNearbyUsers(lat, lng, radius = 20) {
  const userIds = await getNearbyUserIds(lat, lng, radius);
  if (!userIds.length) return [];
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await allAsync(
    `SELECT id, name, position, color, angle, is_alive, type FROM users WHERE id IN (${placeholders})`,
    userIds
  );
  return rows.map((user) => ({
    id: user.id,
    name: user.name,
    position: JSON.parse(user.position),
    color: user.color,
    angle: user.angle,
    isAlive: Boolean(user.is_alive),
    type: user.type,
  }));
}

// Send message to nearby users
async function sendMessage(deviceId, content, radius = 30) {
  const user = await getUserByDevice(deviceId);
  if (!user) throw new Error("User not found");

  const row = await getAsync("SELECT position FROM users WHERE id = ?", [
    user.id,
  ]);
  const position = JSON.parse(row.position);
  const { lat, lng } = position;

  const result = await runAsync(
    "INSERT INTO messages(sender_id, content, position) VALUES (?, ?, ?)",
    [user.id, content, JSON.stringify(position)]
  );

  let recipients;
  if (radius === null || radius === undefined) {
    // 無制限の場合（会議中など）は全ユーザーを対象
    const allUsers = await allAsync("SELECT id FROM users");
    recipients = allUsers.map(u => u.id);
    console.log(`メッセージを全ユーザーに送信: ${recipients.length}人`);
  } else {
    // 通常の場合は範囲内のユーザーのみ
    recipients = await getNearbyUserIds(lat, lng, radius);
    console.log(`メッセージを範囲内ユーザーに送信: ${recipients.length}人 (範囲: ${radius}m)`);
  }

  for (const rid of recipients) {
    await runAsync(
      "INSERT OR IGNORE INTO message_recipients(message_id, recipient_id) VALUES (?, ?)",
      [result.lastID, rid]
    );
  }

  return result.lastID;
}

// Retrieve received messages
async function getMessagesForDevice(deviceId) {
  const user = await getUserByDevice(deviceId);
  if (!user) throw new Error("User not found");

  const rows = await allAsync(
    `SELECT m.id, m.sender_id, u.name AS sender_name, m.content, m.position, m.timestamp
     FROM messages m
     JOIN message_recipients mr ON m.id = mr.message_id
     JOIN users u ON m.sender_id = u.id
     WHERE mr.recipient_id = ?
     ORDER BY m.timestamp DESC`,
    [user.id]
  );

  return rows.map((r) => ({
    id: r.id,
    sender_id: r.sender_id,
    sender_name: r.sender_name,
    content: r.content,
    position: JSON.parse(r.position),
    timestamp: r.timestamp,
  }));
}

async function updateTaskTime(id, newTime) {
  await runAsync("UPDATE tasks SET time = ? WHERE id = ?", [newTime, id]);
  return true;
}

// Assign a random mission
async function addTask(deviceId) {
  const user = await getUserByDevice(deviceId);
  if (!user) throw new Error("User not found");

  let missions = getMissionsList();
  if (missions.length === 0) {
    console.warn("No missions available. Adding default mission.");
    // デフォルトミッションを追加
    missions = [
      {
        id: 1,
        missionName: "Default Mission",
        placeName: "Default Place",
        position: { lat: 0, lng: 0 },
      },
    ];
  }

  const assigned = await allAsync(
    "SELECT mission_id FROM tasks WHERE user_id = ? AND mission_id IS NOT NULL",
    [user.id]
  );
  const usedIds = assigned.map((r) => r.mission_id);
  const available = missions.filter((m) => !usedIds.includes(m.id));
  if (!available.length)
    throw new Error("No missions available after filtering.");

  const mission = available[Math.floor(Math.random() * available.length)];
  const result = await runAsync(
    `INSERT INTO tasks(user_id, mission_id, position, is_done, content, place)
     VALUES(?, ?, ?, 0, ?, ?)`,
    [
      user.id,
      mission.id,
      JSON.stringify(mission.position),
      mission.missionName,
      mission.placeName,
    ]
  );

  return result.lastID;
}

// Fetch tasks for a user
async function getTasksByUserId(userId) {
  const rows = await allAsync(
    `
    SELECT
    id,
    mission_id,
    position,
    is_done,
    content,
    place,
    deadline,
    CAST(strftime('%s', deadline) - strftime('%s','now') AS INTEGER) AS remainingSeconds
    FROM tasks
    WHERE user_id = ?
    ORDER BY id`,
    [userId]
  );

  return rows.map((r) => ({
    id: r.id,
    mission_id: r.mission_id,
    position: JSON.parse(r.position),
    isDone: Boolean(r.is_done),
    content: r.content,
    place: r.place,
    deadline: r.deadline,
    remainingTime: Number(r.remainingSeconds),
  }));
}

// Fetch a single task by ID
async function getTasksById(id) {
  const row = await getAsync(
    `SELECT id AS id, user_id AS userId, mission_id, position, is_done AS isDone, content, place
     FROM tasks WHERE id = ?`,
    [id]
  );
  return row
    ? {
        ...row,
        position: JSON.parse(row.position),
        isDone: Boolean(row.isDone),
      }
    : null;
}

// Fetch all tasks
async function getAllTasks() {
  const rows = await allAsync(
    `SELECT id, user_id, mission_id, position, is_done, content, place, time
     FROM tasks ORDER BY id`
  );

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    mission_id: r.mission_id,
    position: JSON.parse(r.position),
    isDone: Boolean(r.is_done),
    content: r.content,
    place: r.place,
  }));
}

// Delete or update tasks
async function deleteTask(id) {
  await runAsync("DELETE FROM tasks WHERE id = ?", [id]);
  return true;
}
async function setTaskDone(id, done = true) {
  await runAsync("UPDATE tasks SET is_done = ? WHERE id = ?", [
    done ? 1 : 0,
    id,
  ]);
  return true;
}

// User management
async function addUser(deviceId, name, color) {
  const exists = await getUserByDevice(deviceId);
  if (exists) return exists.id;
  const result = await runAsync(
    `INSERT INTO users(device_id, name, position, type, color)
     VALUES(?, ?, ?, 'villager', ?)`,
    [deviceId, name, JSON.stringify({ lat: 0, lng: 0 }), color]
  );
  return result.lastID;
}

async function updateUserPosition(deviceId, lat, lng) {
  const user = await getUserByDevice(deviceId);
  if (!user) return false;
  await runAsync("UPDATE users SET position = ? WHERE id = ?", [
    JSON.stringify({ lat, lng }),
    user.id,
  ]);
  return true;
}

async function updateUserAngle(deviceId, angle) {
  const user = await getUserByDevice(deviceId);
  if (!user || angle < 0 || angle >= 360) return false;
  await runAsync("UPDATE users SET angle = ? WHERE id = ?", [angle, user.id]);
  return true;
}

async function updateUserAliveStatus(deviceId, alive) {
  const user = await getUserByDevice(deviceId);
  if (!user) return false;
  await runAsync("UPDATE users SET is_alive = ? WHERE id = ?", [
    alive ? 1 : 0,
    user.id,
  ]);
  return true;
}

async function getAllUsers() {
  return allAsync("SELECT * FROM users");
}
async function isDeviceRegistered(deviceId) {
  return !!(await getAsync("SELECT 1 FROM users WHERE device_id = ? LIMIT 1", [
    deviceId,
  ]));
}
async function getUserByDevice(deviceId) {
  const row = await getAsync(
    `SELECT 
       id,
       device_id,
       name,
       position,
       type,
       is_alive,
       color,
       angle
     FROM users
     WHERE device_id = ?
     LIMIT 1`,
    [deviceId]
  );
  if (!row) return null;

  let positionObj;
  try {
    positionObj = JSON.parse(row.position);
  } catch {
    // 万一パースに失敗したらデフォルト座標を返す
    positionObj = { lat: 0, lng: 0 };
  }
  return {
    id: row.id,
    device_id: row.device_id,
    name: row.name,
    position: positionObj,
    type: row.type,
    is_alive: row.is_alive === 1,
    color: row.color,
    angle: row.angle,
  };
}
async function getUserIdByDevice(deviceId) {
  const row = await getAsync(
    "SELECT id FROM users WHERE device_id = ? LIMIT 1",
    [deviceId]
  );
  return row ? row.id : null;
}

// Close connection
function closeDatabase() {
  db.close();
}

async function hasNearbyUsers(deviceId, radius = 20) {
  const user = await getUserByDevice(deviceId);
  if (!user) return false;

  const row = await getAsync("SELECT position FROM users WHERE id = ?", [
    user.id,
  ]);
  if (!row) return false;

  const position = JSON.parse(row.position);
  const { lat, lng } = position;

  const nearbyUserIds = await getNearbyUserIds(lat, lng, radius);

  // 自分以外のユーザーがいるかチェック
  return nearbyUserIds.filter((id) => id !== user.id).length > 0;
}

// 投票をリセットする関数を追加
async function resetVotes() {
  await runAsync("DELETE FROM votes");
  return true;
}

// 死体管理関数（シンプル版）

// 死体を登録する（殺害時に呼び出し）
async function addBody(victimDeviceId, killerDeviceId = null) {
  const victim = await getUserByDevice(victimDeviceId);
  if (!victim) throw new Error("Victim not found");
  
  let killer = null;
  if (killerDeviceId) {
    killer = await getUserByDevice(killerDeviceId);
  }
  
  // 被害者の現在位置を取得
  const deathPosition = JSON.stringify(victim.position);
  
  const result = await runAsync(
    `INSERT INTO bodies (
      victim_id, victim_name, killer_id, killer_name, death_position
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      victim.id,
      victim.name,
      killer ? killer.id : null,
      killer ? killer.name : null,
      deathPosition
    ]
  );
  
  console.log("死体を登録しました: " + victim.name + " (ID: " + result.lastID + ")");
  return result.lastID;
}

// 全ての死体情報を取得
async function getAllBodies() {
  const bodies = await allAsync(
    "SELECT * FROM bodies ORDER BY death_time DESC"
  );
  
  return bodies.map(body => ({
    id: body.id,
    victimId: body.victim_id,
    victimName: body.victim_name,
    killerId: body.killer_id,
    killerName: body.killer_name,
    deathPosition: JSON.parse(body.death_position),
    deathTime: body.death_time
  }));
}

// 死体の総数を取得
async function getBodyCount() {
  const result = await getAsync(
    "SELECT COUNT(*) as count FROM bodies"
  );
  return result.count;
}

// 特定の殺害者の死体一覧
async function getBodiesByKiller(killerDeviceId) {
  const killer = await getUserByDevice(killerDeviceId);
  if (!killer) throw new Error("Killer not found");
  
  const bodies = await allAsync(
    "SELECT * FROM bodies WHERE killer_id = ? ORDER BY death_time DESC",
    [killer.id]
  );
  
  return bodies.map(body => ({
    id: body.id,
    victimName: body.victim_name,
    position: JSON.parse(body.death_position),
    deathTime: body.death_time
  }));
}

module.exports = {
  getMissionsList,
  addUser,
  updateUserPosition,
  updateUserAngle,
  updateUserAliveStatus,
  getAllUsers,
  isDeviceRegistered,
  getUserByDevice,
  getUserIdByDevice,
  addTask,
  getTasksByUserId,
  getTasksById,
  getAllTasks,
  deleteTask,
  setTaskDone,
  getNearbyUserIds,
  getNearbyUsers,
  sendMessage,
  getMessagesForDevice,
  closeDatabase,
  hasNearbyUsers,
  updateTaskTime,
  addVote,
  getVoteCounts,
  getUserVoteStatus,
  updateUserType,
  addReport,
  getReports,
  setMeetingState,
  getMeetingState,  resetVotes,
  getTaskStats,
  // 死体管理関数（シンプル版）
  addBody,
  getAllBodies,
  getBodyCount,
  getBodiesByKiller,
};