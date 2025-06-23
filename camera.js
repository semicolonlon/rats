// camera.js
document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("video");
  const canvas = document.getElementById("camera-canvas");
  const closeBtn = document.querySelector(".camera-close");
  const wrapper = document.querySelector(".cameraWrapper");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let found = false,
    onCamera = false;
  let currentTaskId = null;
  let currentMissionId = null;

  // タスクボタン → カメラ起動／停止
  document.body.addEventListener("click", (event) => {
    const btn = event.target.closest(".task-button");
    if (!btn) return;

    // ボタンが押されたタスクを探す
    const taskId = btn.dataset.taskId;
    const task = window.tasks.find((t) => String(t.id) === taskId);

    // 既に完了済み(task.done===true)なら何もしない
    if (task && task.done) {
      btn.disabled = true;
      return;
    }

    currentTaskId = btn.dataset.taskId;
    currentMissionId = btn.dataset.missionId;
    found = false; // 毎回リセット

    if (!onCamera) startCamera();
    else stopCamera();
    wrapper.classList.toggle("expand");
  });

  // 閉じるボタン
  closeBtn.addEventListener("click", () => {
    stopCamera();
    wrapper.classList.remove("expand");
  });

  function startCamera() {
    navigator.mediaDevices
      .getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
        facingMode: { exact: "environment" },
      })
      .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play();
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          onCamera = true;
          requestAnimationFrame(checkImage);
        };
      })
      .catch((err) => console.error("カメラ起動失敗:", err));
  }

  function stopCamera() {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    onCamera = false;
  }

  async function checkImage() {
    if (!onCamera || found) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );
    const code = jsQR(data, width, height);
    if (code) {
      found = true; // まずループ停止フラグを立てる

      if (code.data !== currentMissionId) {
        if (window.showNotification) {
          window.showNotification(
            "QRコードの内容がタスクIDと一致しません",
            "error"
          );
        } else {
          alert("QRコードの内容がタスクIDと一致しません。");
        }
      } else {
        try {
          const res = await fetch(`/api/task/${currentTaskId}/done`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ done: true }),
          });
          if (!res.ok) throw new Error("タスク完了の更新に失敗");

          // タスク完了の通知を表示
          const task = window.tasks.find((t) => String(t.id) === currentTaskId);
          const taskName = task ? task.mission_name : "タスク";
          if (window.showNotification) {
            window.showNotification(`${taskName}を完了しました！`, "success");
          } // 正しい関数名で再読込＋再描画
          await window.loadAndRenderTasks();

          // ゲーム進捗を即座に更新
          if (window.updateGameProgress) {
            setTimeout(() => window.updateGameProgress(), 500);
          }
        } catch (err) {
          console.error("タスク完了の更新エラー:", err);
          if (window.showNotification) {
            window.showNotification("タスク完了の更新に失敗しました", "error");
          } else {
            alert("タスク完了の更新に失敗しました。");
          }
        }
      }

      // 撮影停止＆オーバーレイ閉じ
      stopCamera();
      wrapper.classList.remove("expand");
    } else {
      // 見つからなければ次フレーム
      requestAnimationFrame(checkImage);
    }
  }
});
