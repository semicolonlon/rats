// wsInit.js
document.addEventListener("DOMContentLoaded", () => {
  function getUserId() {
    const m = document.cookie.match(/(^| )user_id=([^;]+)/);
    return m ? m[2] : null;
  }

  const uid = getUserId();
  if (!uid) {
    console.log("WebSocket: No user ID found in cookie");
    return;
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

  // 他のスクリプトでも利用できるように
  window.globalSocket = socket;
});
