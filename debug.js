// デバッグ用ユーティリティ
// ブラウザのコンソールで使用可能

// 現在のゲーム状態を確認
async function checkGameStatus() {
  try {
    const response = await fetch('/api/game/status');
    const data = await response.json();
    console.table(data.gameStatus);
    return data;
  } catch (error) {
    console.error('ゲーム状態の取得に失敗:', error);
  }
}

// 全ユーザーを表示
async function showAllUsers() {
  try {
    const response = await fetch('/api/users');
    const data = await response.json();
    console.table(data.users);
    return data.users;
  } catch (error) {
    console.error('ユーザー一覧の取得に失敗:', error);
  }
}

// WebSocket接続テスト
function testWebSocket() {
  if (window.globalSocket) {
    const ws = window.globalSocket;
    console.log('WebSocket状態:', {
      readyState: ws.readyState,
      url: ws.url,
      protocol: ws.protocol
    });
    
    // テストメッセージ送信
    if (ws.readyState === WebSocket.OPEN) {
      console.log('テストメッセージを送信中...');
      ws.send(JSON.stringify({
        type: 'test',
        message: 'WebSocket接続テスト'
      }));
    } else {
      console.error('WebSocket接続が確立されていません');
    }
  } else {
    console.error('WebSocketオブジェクトが見つかりません');
  }
}

// 投票状況を確認
async function checkVoteStatus() {
  try {
    const response = await fetch('/api/vote-counts');
    const data = await response.json();
    console.table(data.counts);
    return data.counts;
  } catch (error) {
    console.error('投票状況の取得に失敗:', error);
  }
}

// 会議状態を確認
async function checkMeetingStatus() {
  try {
    const response = await fetch('/api/meeting/status');
    const data = await response.json();
    console.log('会議状態:', data.meeting);
    return data.meeting;
  } catch (error) {
    console.error('会議状態の取得に失敗:', error);
  }
}

// 全体的なヘルスチェック
async function healthCheck() {
  console.log('=== システムヘルスチェック ===');
  
  console.log('1. ゲーム状態:');
  await checkGameStatus();
  
  console.log('2. ユーザー一覧:');
  await showAllUsers();
  
  console.log('3. WebSocket:');
  testWebSocket();
  
  console.log('4. 投票状況:');
  await checkVoteStatus();
  
  console.log('5. 会議状態:');
  await checkMeetingStatus();
  
  console.log('=== ヘルスチェック完了 ===');
}

// 殺害機能のテスト
async function testKillFunction() {
  console.log("=== 殺害機能テスト ===");
  
  // 1. ボタンの存在確認
  const killingBtn = document.querySelector(".killingButton");
  console.log("1. 殺害ボタン:", killingBtn ? "存在" : "見つからない");
  
  if (killingBtn) {
    console.log("   - 表示状態:", killingBtn.style.display);
    console.log("   - クリックイベント:", killingBtn.onclick ? "設定済み" : "未設定");
  }
  
  // 2. ユーザー情報確認
  try {
    const response = await fetch(`/api/users/${encodeURIComponent(getUserId())}`);
    const userData = await response.json();
    console.log("2. 現在のユーザー:", userData);
    
    if (userData.user) {
      console.log("   - タイプ:", userData.user.type);
      console.log("   - 生存状態:", userData.user.is_alive);
      console.log("   - 位置情報:", userData.user.position);
    }
  } catch (error) {
    console.error("2. ユーザー情報取得エラー:", error);
  }
  
  // 3. WebSocket接続確認
  console.log("3. WebSocket状態:");
  console.log("   - globalSocket:", window.globalSocket ? "存在" : "なし");
  if (window.globalSocket) {
    console.log("   - readyState:", window.globalSocket.readyState);
    console.log("   - URL:", window.globalSocket.url);
  }
  
  // 4. 近くのユーザー確認（位置情報があれば）
  try {
    const allUsers = await showAllUsers();
    const aliveUsers = allUsers.filter(u => u.is_alive);
    console.log("4. 生存ユーザー数:", aliveUsers.length);
    console.log("   - 生存ユーザー:", aliveUsers.map(u => u.name).join(", "));
  } catch (error) {
    console.error("4. ユーザー一覧取得エラー:", error);
  }
  
  console.log("=== テスト完了 ===");
}

function getUserId() {
  const m = document.cookie.match(/(^| )user_id=([^;]+)/);
  return m ? m[2] : null;
}

// グローバルに公開
window.debugUtils = {
  checkGameStatus,
  showAllUsers,
  testWebSocket,
  checkVoteStatus,
  checkMeetingStatus,
  healthCheck,
  testKillFunction,
  getUserId
};

console.log('デバッグユーティリティが読み込まれました。');
console.log('使用方法: debugUtils.healthCheck()、debugUtils.testKillFunction() または個別の関数を実行');
